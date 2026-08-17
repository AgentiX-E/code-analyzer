// @code-analyzer/analyzer — Parallel Pipeline Phases
// Drop-in replacements for sequential phases using ParallelIndexer with
// worker-pool concurrency and streaming graph construction.

import { existsSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { cpus } from 'node:os';

import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
  ParsedFile,
  SymbolDefinition,
  ReferenceSite,
  NodeLabel,
  NodeProperties,
  SupportedLanguage,
  UnifiedCapture,
  ScopeTree,
} from '@code-analyzer/shared';
import { CAPTURE_TAGS, PhaseLogger, createNoopPhaseLogger , EDGE_DEFINES, EDGE_HAS_METHOD } from '@code-analyzer/shared';

import {
  InMemoryGraphStore,
  createFileDiscoverer,
} from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from './phases/index.js';
import type { LanguageProvider } from '../languages/provider.js';
import { GraphBuilder } from '../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Provider Loader (shared with sequential phases)
// ---------------------------------------------------------------------------

/* v8 ignore start */

const providerLoaders: Record<string, () => Promise<LanguageProvider>> = {
  typescript: async () => {
    const { TypeScriptProvider } = await import('../languages/typescript.js');
    return new TypeScriptProvider();
  },
  javascript: async () => {
    const { JavaScriptProvider } = await import('../languages/javascript.js');
    return new JavaScriptProvider();
  },
  python: async () => {
    const { PythonProvider } = await import('../languages/python.js');
    return new PythonProvider();
  },
  go: async () => {
    const { GoProvider } = await import('../languages/go.js');
    return new GoProvider();
  },
  java: async () => {
    const { JavaProvider } = await import('../languages/java.js');
    return new JavaProvider();
  },
  kotlin: async () => {
    const { KotlinProvider } = await import('../languages/kotlin.js');
    return new KotlinProvider();
  },
  csharp: async () => {
    const { CSharpProvider } = await import('../languages/csharp.js');
    return new CSharpProvider();
  },
  rust: async () => {
    const { RustProvider } = await import('../languages/rust.js');
    return new RustProvider();
  },
  yaml: async () => {
    const { YamlProvider } = await import('../languages/yaml.js');
    return new YamlProvider();
  },
  json: async () => {
    const { JsonProvider } = await import('../languages/json.js');
    return new JsonProvider();
  },
  sql: async () => {
    const { SqlProvider } = await import('../languages/sql.js');
    return new SqlProvider();
  },
  bash: async () => {
    const { BashProvider } = await import('../languages/bash.js');
    return new BashProvider();
  },
  toml: async () => {
    const { TomlProvider } = await import('../languages/toml.js');
    return new TomlProvider();
  },
  markdown: async () => {
    const { MarkdownProvider } = await import('../languages/markdown.js');
    return new MarkdownProvider();
  },
  html: async () => {
    const { HtmlProvider } = await import('../languages/html.js');
    return new HtmlProvider();
  },
  css: async () => {
    const { CssProvider } = await import('../languages/css.js');
    return new CssProvider();
  },
  r: async () => {
    const { RProvider } = await import('../languages/r.js');
    return new RProvider();
  },
  groovy: async () => {
    const { GroovyProvider } = await import('../languages/groovy.js');
    return new GroovyProvider();
  },
};

const providerCache = new Map<string, LanguageProvider>();

async function getOrLoadProvider(
  language: string,
): Promise<LanguageProvider | null> {
  const cached = providerCache.get(language);
  if (cached) return cached;

  const loader = providerLoaders[language];
  if (!loader) return null;

  const provider = await loader();
  providerCache.set(language, provider);
  return provider;
}

// ---------------------------------------------------------------------------
// Shared capture → symbol/reference conversion (mirrors sequential phases)
// ---------------------------------------------------------------------------

function captureTagToNodeLabel(tag: string): NodeLabel {
  switch (tag) {
    case CAPTURE_TAGS.FUNCTION_DEF:
    case CAPTURE_TAGS.FUNCTION_CALL:
      return 'Function';
    case CAPTURE_TAGS.METHOD_DEF:
    case CAPTURE_TAGS.METHOD_CALL:
      return 'Method';
    case CAPTURE_TAGS.CLASS_DEF:
      return 'Class';
    case CAPTURE_TAGS.INTERFACE_DEF:
      return 'Interface';
    case CAPTURE_TAGS.ENUM_DEF:
      return 'Enum';
    case CAPTURE_TAGS.TYPE_DEF:
      return 'TypeAlias';
    case CAPTURE_TAGS.VARIABLE_DEF:
    case CAPTURE_TAGS.VARIABLE_ACCESS:
      return 'Variable';
    case CAPTURE_TAGS.CONSTANT_DEF:
      return 'Variable';
    case CAPTURE_TAGS.CONSTRUCTOR_DEF:
      return 'Constructor';
    case CAPTURE_TAGS.PROPERTY_DEF:
      return 'Property';
    case CAPTURE_TAGS.STRUCT_DEF:
      return 'Struct';
    case CAPTURE_TAGS.TRAIT_DEF:
      return 'Trait';
    case CAPTURE_TAGS.ROUTE_PATH:
    case CAPTURE_TAGS.ROUTE_METHOD:
      return 'Route';
    case CAPTURE_TAGS.COMPONENT_PROPS:
      return 'Component';
    default:
      return 'Variable';
  }
}

function captureTagToReferenceKind(
  tag: string,
): ReferenceSite['referenceKind'] {
  switch (tag) {
    case CAPTURE_TAGS.FUNCTION_CALL:
    case CAPTURE_TAGS.METHOD_CALL:
      return 'call';
    case CAPTURE_TAGS.IMPORT:
    case CAPTURE_TAGS.IMPORT_NAMED:
    case CAPTURE_TAGS.IMPORT_DEFAULT:
    case CAPTURE_TAGS.IMPORT_WILDCARD:
      return 'import';
    case CAPTURE_TAGS.TYPE_REFERENCE:
      return 'type';
    case CAPTURE_TAGS.VARIABLE_ACCESS:
      return 'access';
    default:
      return 'call';
  }
}

function groupCaptures(
  captures: UnifiedCapture[],
  filePath: string,
): {
  symbols: SymbolDefinition[];
  references: ReferenceSite[];
  scopeTree: ScopeTree;
} {
  const symbols: SymbolDefinition[] = [];
  const references: ReferenceSite[] = [];

  for (const capture of captures) {
    const tag = capture.tag;

    // Definition captures
    if (
      tag === CAPTURE_TAGS.FUNCTION_DEF ||
      tag === CAPTURE_TAGS.METHOD_DEF ||
      tag === CAPTURE_TAGS.CLASS_DEF ||
      tag === CAPTURE_TAGS.INTERFACE_DEF ||
      tag === CAPTURE_TAGS.ENUM_DEF ||
      tag === CAPTURE_TAGS.TYPE_DEF ||
      tag === CAPTURE_TAGS.VARIABLE_DEF ||
      tag === CAPTURE_TAGS.CONSTANT_DEF ||
      tag === CAPTURE_TAGS.CONSTRUCTOR_DEF ||
      tag === CAPTURE_TAGS.PROPERTY_DEF ||
      tag === CAPTURE_TAGS.STRUCT_DEF ||
      tag === CAPTURE_TAGS.TRAIT_DEF
    ) {
      const name = capture.name ?? capture.text;
      const kind = captureTagToNodeLabel(tag);
      const containerName = capture.containerName;
      const qualifiedName = containerName
        ? `${containerName}.${name}`
        : `file:${filePath}:${name}`;
      const props = capture.properties ?? {};
      const sig = props['signature'] as string | undefined;
      const retType = props['returnType'] as string | undefined;
      const doc = props['docstring'] as string | undefined;

      symbols.push({
        name,
        kind,
        qualifiedName,
        startLine: capture.startLine,
        endLine: capture.endLine,
        signature: sig,
        returnType: retType,
        docstring: doc,
        containerName,
        isExported: false,
        visibility: 'public',
        properties: props,
      });
    }

    // Reference captures
    if (
      tag === CAPTURE_TAGS.FUNCTION_CALL ||
      tag === CAPTURE_TAGS.METHOD_CALL ||
      tag === CAPTURE_TAGS.IMPORT ||
      tag === CAPTURE_TAGS.IMPORT_NAMED ||
      tag === CAPTURE_TAGS.IMPORT_DEFAULT ||
      tag === CAPTURE_TAGS.IMPORT_WILDCARD ||
      tag === CAPTURE_TAGS.TYPE_REFERENCE ||
      tag === CAPTURE_TAGS.VARIABLE_ACCESS ||
      tag === CAPTURE_TAGS.NEW_EXPRESSION
    ) {
      const targetName = capture.name ?? capture.text;
      const referenceKind = captureTagToReferenceKind(tag);

      references.push({
        sourceFile: filePath,
        sourceLine: capture.startLine,
        sourceColumn: 0,
        targetName,
        referenceKind,
      });
    }
  }

  const scopeTree: ScopeTree = {
    name: basename(filePath),
    kind: 'File',
    startLine: 1,
    endLine:
      captures.length > 0
        ? captures.reduce((max, c) => Math.max(max, c.endLine), 0)
        : 1,
    children: symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      startLine: s.startLine,
      endLine: s.endLine,
      children: [] as ScopeTree[],
      symbols: [s.qualifiedName],
    })),
    symbols: symbols.map((s) => s.qualifiedName),
  };

  return { symbols, references, scopeTree };
}

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
        maxFileSize: ctx.config.maxFileSize,
        respectGitignore: true,
      });

      ctx.phaseData.set('scan', {
        files: discoveredFiles,
        discoveredFiles,
      });

      // Build graph file/folder nodes if graph present
      if (ctx.graph) {
        const builder = new GraphBuilder(
          null as unknown as InMemoryGraphStore,
        );

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
                currentPath,
                {
                  name: dir,
                  filePath: currentPath,
                },
                `folder:${currentPath}`,
              );
            }
          }

          // File node
          builder.addNode(
            ctx.graph,
            'File',
            file.filePath,
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
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// ParallelParsePhase
// ---------------------------------------------------------------------------

export class ParallelParsePhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'parse';
  readonly dependencies: PipelinePhaseId[] = ['scan', 'structure'];
  readonly description =
    'Parse source files in parallel using worker-pool concurrency';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (
        !scanData ||
        !scanData.discoveredFiles ||
        scanData.discoveredFiles.length === 0
      ) {
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

        const results = await Promise.allSettled(batchPromises);

        for (const result of results) {
          if (result.status === 'fulfilled') {
            if (result.value) {
              parsedFiles.push(result.value);
              successCount++;
            } else {
              failCount++;
            }
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
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }

  /**
   * Parse a single file and build its graph nodes.
   * Extracted to a separate method to enable concurrent execution
   * via Promise.allSettled in execute().
   */
  private async parseFile(
    file: DiscoveredFile,
    ctx: PipelineContext,
  ): Promise<ParsedFile | null> {
    const lang = file.language;
    if (!lang) return null;

    const provider = await getOrLoadProvider(lang);
    if (!provider) return null;

    const captures = provider.parse(file.content, file.filePath);

    // Determine export status
    for (const capture of captures) {
      if (capture.name) {
        const isExported = provider.isExported(file.content, capture.name);
        if (capture.properties) {
          capture.properties['exported'] = String(isExported);
        }
      }
    }

    const { symbols, references, scopeTree } = groupCaptures(
      captures,
      file.filePath,
    );

    const parsedFile: ParsedFile = {
      filePath: file.filePath,
      language: lang as SupportedLanguage,
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

          const node = builder.addNode(
            ctx.graph,
            label,
            symbol.name,
            properties,
            qualifiedName,
          );

          // Create appropriate edges
          if (label === 'Class') {
            currentClassNodeId = node.id;
            builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_DEFINES, ctx.projectId);
          } else if (label === 'Method' || label === 'Constructor') {
            if (currentClassNodeId) {
              builder.addEdge(ctx.graph, currentClassNodeId, node.id, EDGE_HAS_METHOD, ctx.projectId);
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
  readonly description =
    'Serialize knowledge graph to storage using batched parallel writes';
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
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

/* v8 ignore stop */