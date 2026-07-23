// @code-analyzer/cli — Analyze Command
// Indexes a repository into the code knowledge graph using the full
// 18-phase DAG pipeline. Produces structured output suitable for
// piping to other tools.

import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { EOL } from 'node:os';
import {
  PipelineOrchestrator,
  type PipelineResult,
  type PhaseResult,
} from '@code-analyzer/analyzer';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type {
  PipelineContext,
  KnowledgeGraph,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalyzeOptions {
  /** Repository path to analyze */
  path: string;
  /** Output format: text, json, or summary */
  format?: 'text' | 'json' | 'summary';
  /** Only run specific phases */
  phases?: string[];
  /** Project ID override */
  projectId?: string;
  /** Timeout in ms */
  timeout?: number;
}

export interface AnalyzeOutput {
  success: boolean;
  projectId: string;
  repoPath: string;
  graph: {
    nodeCount: number;
    edgeCount: number;
    fileCount: number;
    phaseCount: number;
  };
  phases: Array<{
    id: string;
    status: string;
    duration: number;
    output?: unknown;
    error?: string;
  }>;
  duration: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Phase factory (lazy-loaded to avoid tsc overhead)
// ---------------------------------------------------------------------------

let _phases: Array<{ create: () => Promise<{ default: unknown }> }> | null = null;

async function loadPhases() {
  if (!_phases) {
    _phases = [
      { create: () => import('@code-analyzer/analyzer') },
    ];
  }
  // The full phase list is registered inside the analyzer package
  // We create a PipelineOrchestrator with the default phases
  const { createDefaultPhases } = await import('@code-analyzer/analyzer');
  return createDefaultPhases();
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Analyze a repository: discover files, parse ASTs, build knowledge graph.
 *
 * This is the primary entry point for indexing. It runs the full 18-phase
 * pipeline and stores results in an InMemoryGraphStore.
 */
export async function analyzeRepository(
  options: AnalyzeOptions,
): Promise<AnalyzeOutput> {
  const repoPath = resolve(options.path);
  const projectId = (options.projectId ?? relative(process.cwd(), repoPath)) || 'default';
  const startTime = Date.now();
  const errors: string[] = [];

  if (!existsSync(repoPath)) {
    return {
      success: false,
      projectId,
      repoPath,
      graph: { nodeCount: 0, edgeCount: 0, fileCount: 0, phaseCount: 0 },
      phases: [],
      duration: Date.now() - startTime,
      errors: [`Repository not found: ${repoPath}`],
    };
  }

  try {
    // Set up timeout if specified
    const timeout = options.timeout ?? 300_000; // 5 min default
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      // Create graph store and pipeline context
      const store = new InMemoryGraphStore();
      const phases = await loadPhases();

      const ctx: PipelineContext = {
        projectId,
        repoPath,
        rootDir: repoPath,
        graph: undefined,
        signal: controller.signal,
        metadata: {},
      } as PipelineContext;

      const orchestrator = new PipelineOrchestrator(phases as any);
      const result: PipelineResult = await orchestrator.execute(ctx);

      clearTimeout(timer);
      store.close();

      // Extract graph stats
      const graph = result.graph;
      const nodeCount = graph.nodes?.size ?? 0;
      const edgeCount = graph.edges?.size ?? 0;
      const fileCount = graph.fileIndex?.size ?? 0;

      // Collect errors
      for (const err of result.errors ?? []) {
        errors.push(`[${err.phaseId}] ${err.message}`);
      }

      const output: AnalyzeOutput = {
        success: result.status !== 'failed',
        projectId,
        repoPath,
        graph: {
          nodeCount,
          edgeCount,
          fileCount,
          phaseCount: result.phases.length,
        },
        phases: result.phases.map((p: PhaseResult) => ({
          id: p.phaseId,
          status: p.status,
          duration: p.duration,
          output: p.output,
          error: p.error,
        })),
        duration: result.duration,
        errors,
      };

      return output;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      projectId,
      repoPath,
      graph: { nodeCount: 0, edgeCount: 0, fileCount: 0, phaseCount: 0 },
      phases: [],
      duration: Date.now() - startTime,
      errors: [message],
    };
  }
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/**
 * Format analyze output as human-readable text.
 */
export function formatAnalyzeResult(result: AnalyzeOutput, format: 'text' | 'json' | 'summary'): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];
  const status = result.success ? '✓' : '✗';

  if (format === 'summary') {
    lines.push(`${status} ${result.projectId}: ${result.graph.nodeCount} nodes, ${result.graph.edgeCount} edges, ${result.graph.fileCount} files`);
    lines.push(`  Duration: ${result.duration}ms, Phases: ${result.graph.phaseCount}`);
    if (result.errors.length > 0) {
      lines.push(`  Errors: ${result.errors.length}`);
    }
    return lines.join(EOL);
  }

  // Full text format
  lines.push(`${'='.repeat(60)}`);
  lines.push(`Code Analyzer — Repository Analysis`);
  lines.push(`${'='.repeat(60)}`);
  lines.push(`Project:  ${result.projectId}`);
  lines.push(`Path:     ${result.repoPath}`);
  lines.push(`Status:   ${result.success ? 'Complete' : 'Failed'}`);
  lines.push(`Duration: ${result.duration}ms`);
  lines.push(` `);
  lines.push(`${'─'.repeat(40)}`);
  lines.push(`Knowledge Graph`);
  lines.push(`${'─'.repeat(40)}`);
  lines.push(`  Nodes:     ${result.graph.nodeCount}`);
  lines.push(`  Edges:     ${result.graph.edgeCount}`);
  lines.push(`  Files:     ${result.graph.fileCount}`);
  lines.push(` `);
  lines.push(`${'─'.repeat(40)}`);
  lines.push(`Pipeline Phases (${result.graph.phaseCount})`);
  lines.push(`${'─'.repeat(40)}`);

  for (const phase of result.phases) {
    const icon = phase.status === 'success' ? '✓' : phase.status === 'failed' ? '✗' : '○';
    lines.push(`  ${icon} ${phase.id.padEnd(25)} ${phase.duration.toString().padStart(6)}ms`);
    if (phase.error) {
      lines.push(`      Error: ${phase.error}`);
    }
  }

  if (result.errors.length > 0) {
    lines.push(` `);
    lines.push(`${'─'.repeat(40)}`);
    lines.push(`Errors`);
    lines.push(`${'─'.repeat(40)}`);
    for (const err of result.errors) {
      lines.push(`  ✗ ${err}`);
    }
  }

  lines.push(`${'='.repeat(60)}`);
  return lines.join(EOL);
}
