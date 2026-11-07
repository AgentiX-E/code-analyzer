// @code-analyzer/analyzer — Parallel Pipeline Phases
// Drop-in replacements for sequential phases using ParallelIndexer with
// worker-pool concurrency and streaming graph construction.

import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';

import { InMemoryGraphStore, createFileDiscoverer } from '@code-analyzer/infra';
import {
  PhaseLogger,
  createNoopPhaseLogger,
  EDGE_DEFINES,
  EDGE_HAS_METHOD,
} from '@code-analyzer/shared';

import {
  captureTagToNodeLabel,
  captureTagToReferenceKind,
  getOrLoadProvider,
  groupCaptures,
  receiverOf,
  toPhaseFailure,
} from './phase-helpers.js';
import { GraphBuilder } from '../graph/graph-builder.js';

import type { ExecutablePhase, PhaseExecutionResult } from './phases/index.js';
import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
  ParsedFile,
  NodeProperties,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Provider Loader
// ---------------------------------------------------------------------------

/**
 * **This module used to own a second copy of the language table**, and the copy had drifted: 18 languages against the
 * 32 the pipeline loads, which left C, C++, PHP, Ruby, Swift, Dart, Lua, Scala, Zig, Elixir, HCL, Dockerfile, XML and
 * Svelte unloadable from here. The comment above that copy already said what to do about it — "**the copy is gone**",
 * written when a second `groupCaptures` disagreed with this file about qualified names — so the same answer applies:
 * one implementation in `phase-helpers.ts`, re-exported so this module's surface is unchanged.
 *
 * **Nothing in production imports this module** (see `module-reachability.test.ts`), which is why the drift had no
 * symptom; a table a test is the only reader of is a table nothing can disagree with.
 *
 * The import above is separate from this export because a re-export creates no local binding, and the parse phase below
 * calls the function.
 */
export { getOrLoadProvider, providerLoaders } from './phase-helpers.js';

// ---------------------------------------------------------------------------
// Shared capture → symbol/reference conversion — one implementation
// ---------------------------------------------------------------------------

// **The copy is gone.** This module carried a second `groupCaptures` and a second `captureTagToNodeLabel`, kept "in
// step" by a comment, and they had already drifted: the copy hardcoded `isExported` from a property this file never
// wrote. A second implementation of the step that decides what a symbol *is* is a defect with a delay fuse — the
// sequential pipeline and the parallel one would disagree about qualified names, and the disagreement would show up
// as an answer that changes when concurrency changes. Both names are re-exported so this module's surface is intact.
export { captureTagToNodeLabel, captureTagToReferenceKind, groupCaptures, receiverOf };

// ---------------------------------------------------------------------------
// Shared phase-failure result
// ---------------------------------------------------------------------------

// Defined in phase-helpers so sequential and parallel phases share one
// implementation; re-exported here to preserve this module's public surface.
export { toPhaseFailure };

// ---------------------------------------------------------------------------
// ParallelScanPhase
// ---------------------------------------------------------------------------

export class ParallelScanPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'scan';
  readonly dependencies: PipelinePhaseId[] = [];
  readonly description = 'Discover source files using parallel file discovery';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!existsSync(ctx.rootPath)) {
        ctx.phaseData.set('scan', { files: [], discoveredFiles: [] });
        return {
          phaseId: this.id,
          status: 'success',
          output: { filesDiscovered: 0 },
        };
      }

      const discoverer = createFileDiscoverer();
      const discoveredFiles = await discoverer.discover(ctx.rootPath, {
        excludePatterns: [
          ...ctx.config.excludePatterns,
          'node_modules/**',
          '.git/**',
          'dist/**',
          'build/**',
          '.next/**',
          'coverage/**',
          '__pycache__/**',
        ],
        // **The same list the sequential scan honours**, because a configuration that scopes one pipeline and not the
        // other makes the analysis depend on which orchestrator ran it.
        includePatterns: ctx.config.includePatterns,
        maxFileSize: ctx.config.maxFileSize,
        respectGitignore: true,
      });

      ctx.phaseData.set('scan', {
        files: discoveredFiles,
        discoveredFiles,
      });

      // Build graph file/folder nodes if graph present
      if (ctx.graph) {
        const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);

        for (const file of discoveredFiles) {
          const relPath = relative(ctx.rootPath, file.filePath);
          const dirs = dirname(relPath)
            .split('/')
            .filter((d) => d.length > 0);

          let currentPath = ctx.rootPath;
          for (const dir of dirs) {
            currentPath = join(currentPath, dir);
            if (!ctx.graph.fileIndex.has(currentPath)) {
              builder.addNode(
                ctx.graph,
                'Folder',
                dir,
                {
                  name: dir,
                  filePath: currentPath,
                },
                `folder:${currentPath}`,
              );
            }
          }

          // File node
          //
          // **The name is the file's, and it used to be the machine's.** `addNode` takes the name as its own argument
          // and this call passed `file.filePath` for it while the properties carried `basename(...)`, so every File
          // node in every graph held `/home/runner/work/<repo>/...` in the field a search index weighs most - the
          // doctrine `indexableName` states and the structure phase silently broke.
          builder.addNode(
            ctx.graph,
            'File',
            basename(file.filePath),
            {
              name: basename(file.filePath),
              filePath: file.filePath,
              language: file.language ?? undefined,
            },
            `file:${file.filePath}`,
          );
        }
      }

      return {
        phaseId: this.id,
        status: 'success',
        output: { filesDiscovered: discoveredFiles.length },
      };
    } catch (err) {
      return toPhaseFailure(err, this.id, this.logger, ctx?.rootPath);
    }
  }
}

// ---------------------------------------------------------------------------
// ParallelParsePhase
// ---------------------------------------------------------------------------

export class ParallelParsePhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'parse';
  readonly dependencies: PipelinePhaseId[] = ['scan', 'structure'];
  readonly description = 'Parse source files in parallel using worker-pool concurrency';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        { discoveredFiles: DiscoveredFile[] } | undefined;

      if (!scanData || !scanData.discoveredFiles || scanData.discoveredFiles.length === 0) {
        return {
          phaseId: this.id,
          status: 'success',
          output: { filesParsed: 0 },
        };
      }

      const parsedFiles: ParsedFile[] = [];
      let successCount = 0;
      let failCount = 0;

      // Process files with concurrency for true parallelism
      // Use CPU count for concurrent parsing (minimum 2, maximum available CPUs)
      const cpuCount = cpus().length;
      const concurrency = Math.min(Math.max(cpuCount, 2), scanData.discoveredFiles.length);

      // Process in concurrent batches
      const files = scanData.discoveredFiles;
      for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, i + concurrency);
        const batchPromises = batch.map((file) => this.parseFile(file, ctx));

        // parseFile never throws (providers never throw and groupCaptures never
        // throws), so Promise.all is safe and needs no rejection branch.
        const results = await Promise.all(batchPromises);

        for (const parsed of results) {
          if (parsed) {
            parsedFiles.push(parsed);
            successCount++;
          } else {
            failCount++;
          }
        }
      }

      ctx.phaseData.set('parse', { parsedFiles });

      return {
        phaseId: this.id,
        status: 'success',
        output: { filesParsed: successCount, filesFailed: failCount },
      };
    } catch (err) {
      return toPhaseFailure(err, this.id, this.logger, ctx?.rootPath);
    }
  }

  /**
   * Parse a single file and build its graph nodes.
   * Extracted to a separate method to enable concurrent execution
   * via Promise.all in execute().
   */
  private async parseFile(file: DiscoveredFile, ctx: PipelineContext): Promise<ParsedFile | null> {
    const lang = file.language;
    if (!lang) return null;

    const provider = await getOrLoadProvider(lang);
    if (!provider) return null;

    const captures = provider.parse(file.content, file.filePath);

    // Determine export status. Providers may emit captures without a `name`
    // (e.g. regex docstring/decorator captures), which cannot be export-checked.
    for (const capture of captures) {
      if (capture.name && capture.properties) {
        const isExported = provider.isExported(file.content, capture.name);
        // Every named capture carries a `properties` bag.
        capture.properties['exported'] = String(isExported);
      }
    }

    const { symbols, references, scopeTree } = groupCaptures(captures, file.filePath);

    const parsedFile: ParsedFile = {
      filePath: file.filePath,
      language: lang,
      symbols,
      references,
      scopeTree,
      ast: captures,
    };

    // Add symbol nodes to the graph (only if graph exists)
    // Note: KnowledgeGraph nodes/edges mutations via Maps are safe across
    // concurrent calls since each file operates on distinct graph regions
    if (ctx.graph) {
      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      const fileNodeId = ctx.graph.fileIndex.get(file.filePath);

      if (fileNodeId) {
        let currentClassNodeId: number | null = null;

        for (const symbol of symbols) {
          const label = symbol.kind;
          const qualifiedName = `project:${ctx.projectId}:${symbol.qualifiedName}`;

          const properties: NodeProperties = {
            name: symbol.name,
            filePath: file.filePath,
            startLine: symbol.startLine,
            endLine: symbol.endLine,
            language: lang,
            isExported: symbol.isExported,
            signature: symbol.signature,
            returnType: symbol.returnType,
            docstring: symbol.docstring,
            ...symbol.properties,
          };

          const node = builder.addNode(ctx.graph, label, symbol.name, properties, qualifiedName);

          // Create appropriate edges
          if (label === 'Class') {
            currentClassNodeId = node.id;
            builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_DEFINES, ctx.projectId);
          } else if (label === 'Method' || label === 'Constructor') {
            if (currentClassNodeId) {
              builder.addEdge(
                ctx.graph,
                currentClassNodeId,
                node.id,
                EDGE_HAS_METHOD,
                ctx.projectId,
              );
            } else {
              builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_DEFINES, ctx.projectId);
            }
          } else {
            builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_DEFINES, ctx.projectId);
          }
        }
      }
    }

    return parsedFile;
  }
}

// ---------------------------------------------------------------------------
// ParallelBuildPhase
// ---------------------------------------------------------------------------

export class ParallelBuildPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'dump';
  readonly dependencies: PipelinePhaseId[] = [
    'scopeResolution',
    'routes',
    'tools',
    'di',
    'communities',
    'processes',
    'tests',
  ];
  readonly description = 'Serialize knowledge graph to storage using batched parallel writes';
  readonly parallelizable = false;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return {
          phaseId: this.id,
          status: 'failed',
          error: 'No knowledge graph available to dump',
        };
      }

      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);

      builder.dumpToStore(ctx.graph, ctx.projectId);

      const nodeCount = ctx.graph.nodes.size;
      const edgeCount = ctx.graph.edges.size;

      return {
        phaseId: this.id,
        status: 'success',
        output: {
          dumpedToStore: true,
          nodeCount,
          edgeCount,
        },
      };
    } catch (err) {
      return toPhaseFailure(err, this.id, this.logger, ctx?.rootPath);
    }
  }
}
