// @code-analyzer/analyzer — Pipeline Phase: Similarity

import type { PipelinePhaseId, PipelineContext, DiscoveredFile } from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger, EDGE_SIMILAR_TO } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { simpleHash } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Similarity helpers
// ---------------------------------------------------------------------------

const MINHASH_SEEDS = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];

export function tokenizeCode(content: string, granularity: number = 3): string[] {
  // AST node-type trigram approximation using whitespace-delimited tokens
  const tokens = content
    .replace(/\/\/.*$/gm, '') // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/['"`][^'"`]*['"`]/g, 'STR') // Replace strings with placeholder
    .replace(/\b\d+\b/g, 'NUM') // Replace numbers with placeholder
    .split(/\s+/)
    .filter((t) => t.length > 0);

  // Generate n-grams
  const ngrams: string[] = [];
  for (let i = 0; i <= tokens.length - granularity; i++) {
    ngrams.push(tokens.slice(i, i + granularity).join(' '));
  }
  return ngrams;
}

export function computeMinHash(ngrams: string[], numHashes: number = 16): number[] {
  const hashes: number[] = new Array(numHashes).fill(Number.MAX_SAFE_INTEGER);

  for (const ngram of ngrams) {
    for (let i = 0; i < numHashes; i++) {
      const h = simpleHash(ngram, MINHASH_SEEDS[i]!);
      if (h < hashes[i]!) {
        hashes[i] = h;
      }
    }
  }

  return hashes;
}

export function jaccardSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / a.length;
}

// ---------------------------------------------------------------------------
// Phase 16: similarity — Compute code similarity via MinHash
// ---------------------------------------------------------------------------

export class SimilarityPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'similarity';
  readonly dependencies: PipelinePhaseId[] = ['dump'];
  readonly description = 'Compute code similarity between files and functions';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { similarPairsFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      const scanData = ctx.phaseData.get('scan') as
        { discoveredFiles: DiscoveredFile[] } | undefined;

      if (!scanData?.discoveredFiles) {
        return { phaseId: this.id, status: 'success', output: { similarPairsFound: 0 } };
      }

      // Compute MinHash for each file
      const fileHashes = new Map<string, number[]>();
      const fileNodeMap = new Map<string, number>();

      for (const file of scanData.discoveredFiles) {
        const nodeId = ctx.graph.fileIndex.get(file.filePath);
        if (!nodeId) continue;

        const ngrams = tokenizeCode(file.content);
        const minhash = computeMinHash(ngrams);
        fileHashes.set(file.filePath, minhash);
        fileNodeMap.set(file.filePath, nodeId);
      }

      // Find similar pairs (threshold: 0.7 Jaccard similarity)
      const fileEntries = Array.from(fileHashes.entries());
      const SIMILARITY_THRESHOLD = 0.7;
      let similarPairsFound = 0;

      for (let i = 0; i < fileEntries.length; i++) {
        for (let j = i + 1; j < fileEntries.length; j++) {
          const [pathA, hashA] = fileEntries[i]!;
          const [pathB, hashB] = fileEntries[j]!;

          const similarity = jaccardSimilarity(hashA, hashB);
          if (similarity >= SIMILARITY_THRESHOLD) {
            // fileHashes and fileNodeMap are populated together for the same
            // files, so every path in fileEntries is guaranteed present here.
            const nodeA = fileNodeMap.get(pathA)!;
            const nodeB = fileNodeMap.get(pathB)!;

            try {
              builder.addEdge(ctx.graph, nodeA, nodeB, EDGE_SIMILAR_TO, ctx.projectId);
              similarPairsFound++;
            } catch {
              // Edge may already exist
            }
          }
        }
      }

      ctx.phaseData.set('similarity', { similarPairsFound });
      return { phaseId: this.id, status: 'success', output: { similarPairsFound } };
    } catch (err) {
      this.logger.error(
        'Phase execution failed',
        err instanceof Error ? err : new Error(String(err)),
        { phaseId: this.id, filePath: ctx?.rootPath },
      );
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
