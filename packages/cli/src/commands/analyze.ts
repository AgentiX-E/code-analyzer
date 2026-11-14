// @code-analyzer/cli — Analyze Command
// Indexes a repository into the code knowledge graph using the full
// 18-phase DAG pipeline. Produces structured output suitable for
// piping to other tools.

import { existsSync } from 'node:fs';
import { EOL } from 'node:os';
import { resolve, relative } from 'node:path';

import {
  PipelineOrchestrator,
  type PipelineResult,
  type PhaseResult,
} from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { CodeAnalyzerConfig, PipelineContext } from '@code-analyzer/shared';

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
  /**
   * Globs a file must match to be analysed. **Empty means the whole checkout**, which is what every run did before
   * the flag existed.
   *
   * **This is the flag that decides what an analysis costs.** A checkout of fifteen thousand Java files that holds a
   * hundred and twenty-eight Kotlin files was analysed in full to rank those hundred and twenty-eight; `--include
   * "**\/*.kt"` is the same question for the price of the files it is about.
   */
  include?: string[];
  /** Extra exclusion globs, **added to the default ones rather than replacing them**. */
  exclude?: string[];
  /**
   * The configuration this run resolved — defaults, configuration files and environment, in that order.
   *
   * **Absent means the defaults**, which is what every caller did before the CLI learned to read a configuration file.
   * Present means the values here are what the run uses, with the three flags above still winning, because a flag is a
   * decision about one run and a file is a decision about the project.
   */
  config?: CodeAnalyzerConfig;
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

export async function loadPhases() {
  // The full phase list is registered inside the analyzer package.
  // We dynamically import createAllPhases to generate the default phases.
  const { createAllPhases } = await import('@code-analyzer/analyzer');
  return createAllPhases();
}

/**
 * **The pipeline context, built in one place.**
 *
 * `search` indexes a checkout before it asks a question, and it has to build the same context `analyze` builds - same
 * defaults, same root, same include/exclude amendments. Two copies of that construction would be two definitions of what
 * a checkout is, and the day they disagreed the answer would depend on which command produced it.
 *
 * **The configuration is built from the defaults and then amended**, because a partial object handed to the orchestrator
 * is *not* replaced by the defaults (`if (!ctx.config)`), and a `maxFiles` of `undefined` makes
 * `results.length >= undefined` false - an unbounded walk behind a command that looks configured.
 */
export function buildPipelineContext(
  repoPath: string,
  projectId: string,
  options: Pick<AnalyzeOptions, 'config' | 'include' | 'exclude'> & { signal?: AbortSignal } = {},
): PipelineContext {
  const defaults = options.config ?? getDefaultConfig();
  const config: typeof defaults = {
    ...defaults,
    // **The root, said once more where the schema keeps it.** No phase of this pipeline reads it - they read
    // `ctx.rootPath` - and a configuration whose own root disagrees with the run's is a trap left for the first phase
    // that does.
    rootPath: repoPath,
    includePatterns: options.include ?? defaults.includePatterns,
    excludePatterns:
      options.exclude === undefined
        ? defaults.excludePatterns
        : [...defaults.excludePatterns, ...options.exclude],
  };

  return {
    projectId,
    repoPath,
    rootDir: repoPath,
    config,
    graph: undefined,
    signal: options.signal,
    metadata: {},
  } as unknown as PipelineContext;
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
export async function analyzeRepository(options: AnalyzeOptions): Promise<AnalyzeOutput> {
  const repoPath = resolve(options.path);
  // **A project id in the configuration file is a statement about the project**, so it beats the derived one and loses
  // to the flag. The derived value (`relative(cwd, repo)`) is what every run used before the file existed.
  const configuredId = options.config?.projectId ?? '';
  const projectId =
    options.projectId ??
    (configuredId !== '' ? configuredId : relative(process.cwd(), repoPath) || 'default');
  const startTime = Date.now();
  const errors: string[] = [];

  if (!options.path || !existsSync(repoPath)) {
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

      const ctx = buildPipelineContext(repoPath, projectId, {
        ...(options.config === undefined ? {} : { config: options.config }),
        ...(options.include === undefined ? {} : { include: options.include }),
        ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
        signal: controller.signal,
      });

      const orchestrator = new PipelineOrchestrator(phases);
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
export function formatAnalyzeResult(
  result: AnalyzeOutput,
  format: 'text' | 'json' | 'summary',
): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];
  const status = result.success ? '✓' : '✗';

  if (format === 'summary') {
    lines.push(
      `${status} ${result.projectId}: ${result.graph.nodeCount} nodes, ${result.graph.edgeCount} edges, ${result.graph.fileCount} files`,
    );
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
