// @code-analyzer/cli — Search Command
//
// **The command answers with the retrieval the benchmarks ran.** It used to answer from a store it had constructed
// empty - `searchGraph` had no way to be told which checkout to search, so every question was asked of nothing and the
// output was a well-formed "0 results" with exit code 0. With a store attached it called `searchFts`, the containment
// channel that finds 173 of 447 rewritten questions where the field-weighted BM25 beside it finds 358
// (`EVAL-CONTRACT.md` §37.7). Both are fixed here, and the fix is structural rather than a patched branch: the command
// indexes the checkout it is given and then asks the same `FederatedSearchEngine` every published figure was measured
// on, through the same `searchEngineFor` the MCP tools and the GraphQL resolver ask.

import { existsSync } from 'node:fs';
import { EOL } from 'node:os';
import { basename, relative, resolve } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { persistGraph, PipelineOrchestrator, type PipelineResult } from '@code-analyzer/analyzer';
import { searchEngineFor, type FusionRuleName } from '@code-analyzer/intelligence';

import { buildPipelineContext, loadPhases } from './analyze.js';

import type { NodeLabel } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchOptions {
  /** Search query */
  query: string;
  /**
   * **The checkout to index and search.**
   *
   * Required when no store is handed in, because the alternative is what this command used to do: search an empty graph
   * and print zero rows. A missing directory is an error with a sentence, not an empty answer.
   */
  directory?: string;
  /** Maximum results */
  limit?: number;
  /** Output format */
  format?: 'text' | 'json' | 'summary';
  /** Node type filter, in the spelling a user types (`function`, `class`, …) */
  type?: string;
  /** Include the snippet in results */
  verbose?: boolean;
  /**
   * **Which fusion rule orders the answer**, when the caller wants something other than the shipped one.
   *
   * `EVAL-CONTRACT.md` §40 measured eight mechanisms and retired four; the ones that remain can only be compared by
   * someone who can run them, and until this option existed that someone was a benchmark harness. A user whose corpus
   * disagrees with ours can now check rather than take it on trust.
   */
  fusionRule?: FusionRuleName;
  /** How much the vector list counts, when vectors were registered by the caller. */
  vectorWeight?: number;
  /** Project identifier, when the indexed directory should be named something other than its path. */
  projectId?: string;
}

export interface SearchResult {
  id: number;
  name: string;
  qualifiedName: string;
  repo: string;
  type: string;
  file: string;
  line: number;
  score: number;
  snippet?: string;
}

export interface SearchOutput {
  success: boolean;
  query: string;
  results: SearchResult[];
  totalResults: number;
  duration: number;
  error?: string;
}

/**
 * The labels a user's `--type` names, and **the spelling is the user's rather than the store's**.
 *
 * A filter that compared `function` to `Function` would drop every row, which is the same class of defect as a scope
 * compared to a string (`§37.7`). The mapping is explicit because the two vocabularies are different vocabularies
 * rather than different casings of one.
 */
const LABEL_BY_TYPE: Record<string, NodeLabel> = {
  function: 'Function',
  method: 'Method',
  class: 'Class',
  interface: 'Interface',
  typealias: 'TypeAlias',
  'type-alias': 'TypeAlias',
  type: 'TypeAlias',
  enum: 'Enum',
  file: 'File',
  module: 'Module',
  variable: 'Variable',
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * **What an indexed checkout is called when the caller did not name it.**
 *
 * Its path relative to where the command was run, which is what a person reading the answer expects - and its own
 * directory name when the command was run inside it, because `relative` is then the empty string and an empty project
 * id is not an id. Exported because it is a rule with two cases and the second one is the case a test cannot reach by
 * running the command.
 */
export function defaultProjectId(root: string, cwd: string = process.cwd()): string {
  return relative(cwd, root) || basename(root);
}

/**
 * Index a checkout into the store, through the same tool the MCP server exposes.
 *
 * **The pipeline is the only thing that knows how to turn files into a graph**, and calling it here rather than
 * re-implementing a walk is what makes the command's answer and the server's answer the same answer. The cost is the
 * cost: this parses the checkout, so a question about a large repository takes as long as indexing it once. `locate`
 * exists for the case where that is too slow and a path-level answer is enough.
 */
async function indexCheckout(
  store: InMemoryGraphStore,
  directory: string,
  projectId: string | undefined,
): Promise<void> {
  const root = resolve(directory);
  if (!existsSync(root)) {
    throw new Error(`Path does not exist: ${root}`);
  }

  // **The pipeline is the only thing that knows how to turn files into a graph**, and this runs it rather than walking
  // the directory a second way: a second walk would be a second definition of what a checkout contains, and the answer
  // it produced would drift from the one the MCP server gives for the same directory.
  const id = projectId ?? defaultProjectId(root);
  const phases = await loadPhases();
  const ctx = buildPipelineContext(root, id);

  const result: PipelineResult = await new PipelineOrchestrator(phases).execute(ctx);

  // **What the store took, not what the pipeline computed.** The two numbers were one number until the graph was
  // discarded, and a command that reported the first while the second was zero is the shape of a defect this product
  // has already had once.
  persistGraph(store, result, id, true);
}

/**
 * Search the knowledge graph for nodes matching a query.
 *
 * **The order is the engine's order.** The two lists the engine fuses, the weight it derives between them and the rule
 * that combines them are the ones `benchmarks/*.json` reports, so a user who re-asks a published question on their own
 * checkout gets the retrieval those figures describe.
 */
export async function searchGraph(
  options: SearchOptions,
  store?: InMemoryGraphStore,
): Promise<SearchOutput> {
  const startTime = Date.now();
  const limit = options.limit ?? 50;

  try {
    const graphStore = store ?? new InMemoryGraphStore();

    if (store === undefined) {
      if (options.directory === undefined) {
        return {
          success: false,
          query: options.query,
          results: [],
          totalResults: 0,
          duration: Date.now() - startTime,
          // **A sentence rather than an empty list**, because "0 results" for a question nobody indexed is the answer
          // that let this command look healthy while it answered from an empty graph.
          error:
            'No checkout named: pass --directory (or -d) with the repository to index and search',
        };
      }
      await indexCheckout(graphStore, options.directory, options.projectId);
    }

    // **"Nothing indexed" is not "nothing found".** One means ask a different question and the other means index
    // something first, and they printed the same zero rows with the same exit code.
    if (graphStore.getProjectIds().length === 0) {
      return {
        success: false,
        query: options.query,
        results: [],
        totalResults: 0,
        duration: Date.now() - startTime,
        error: 'Nothing indexed: the store is empty, so there is no graph to search',
      };
    }

    const labels =
      options.type === undefined
        ? undefined
        : [LABEL_BY_TYPE[options.type.toLowerCase()] ?? (options.type as NodeLabel)];

    const found = await searchEngineFor(graphStore).search(options.query, {
      maxResults: limit,
      ...(labels === undefined ? {} : { labels }),
      ...(options.fusionRule === undefined ? {} : { fusionRule: options.fusionRule }),
      ...(options.vectorWeight === undefined ? {} : { vectorWeight: options.vectorWeight }),
    });

    const results: SearchResult[] = found.results.map((hit) => ({
      id: hit.id,
      name: hit.symbol,
      qualifiedName: hit.qualifiedName,
      repo: hit.repo,
      type: hit.label,
      file: hit.filePath,
      line: hit.line,
      // **The engine's relevance, which is relative to the best answer in this list.** A fused score is a sum of
      // reciprocal ranks and has no meaning outside the list it was computed in; the ratio is what a caller can act on.
      score: hit.relevance,
      ...(options.verbose === true ? { snippet: hit.snippet } : {}),
    }));

    return {
      success: true,
      query: options.query,
      results,
      totalResults: results.length,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      query: options.query,
      results: [],
      totalResults: 0,
      duration: Date.now() - startTime,
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/**
 * Format search output for display.
 */
export function formatSearchResult(
  result: SearchOutput,
  format: 'text' | 'json' | 'summary',
): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];

  if (format === 'summary') {
    lines.push(
      `Found ${result.totalResults} results for "${result.query}" in ${result.duration}ms`,
    );
    return lines.join(EOL);
  }

  // Full text format
  lines.push(`${'='.repeat(60)}`);
  lines.push(`Code Analyzer — Search Results: "${result.query}"`);
  lines.push(`${'='.repeat(60)}`);

  // **The error comes before the count**, because "Found: 0 results" is a sentence about the question and an error is a
  // sentence about the run. A reader who saw the first and stopped had been told their question has no answer in a
  // repository that was never read.
  if (!result.success && result.error) {
    lines.push(`Error: ${result.error}`);
    return lines.join(EOL);
  }

  lines.push(`Found: ${result.totalResults} results in ${result.duration}ms`);
  lines.push(` `);

  for (let i = 0; i < result.results.length; i++) {
    const r = result.results[i]!;
    lines.push(`${'─'.repeat(40)}`);
    lines.push(`[${i + 1}] ${r.name}  (${r.type})  score: ${r.score.toFixed(2)}`);
    if (r.file) {
      lines.push(`    File: ${r.file}:${r.line}`);
    }
    if (r.snippet) {
      lines.push(`    ${r.snippet}`);
    }
  }
  lines.push(`${'='.repeat(60)}`);
  return lines.join(EOL);
}
