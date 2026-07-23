// @code-analyzer/analyzer — Pipeline Phase Implementations

import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, relative, resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import type {
  PipelinePhase,
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
  ParsedFile,
  SymbolDefinition,
  ReferenceSite,
  ScopeTree,
  NodeLabel,
  KnowledgeGraph,
  SupportedLanguage,
  ResolvedImport,
  NodeProperties,
} from '@code-analyzer/shared';

import { getLanguageFromFilename, CAPTURE_TAGS } from '@code-analyzer/shared';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { LanguageProvider, ParsedImport } from '../languages/provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

import { GraphBuilder } from '../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Phase metadata interface
// ---------------------------------------------------------------------------

export interface ExecutablePhase extends PipelinePhase {
  execute(ctx: PipelineContext): Promise<PhaseExecutionResult>;
}

export interface PhaseExecutionResult {
  phaseId: PipelinePhaseId;
  status: 'success' | 'failed' | 'skipped';
  output?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'target',
  '.cache', '.idea', '.vscode', 'coverage', '.nyc_output',
]);

const SKIP_FILE_PATTERNS = [
  /^\./, // dotfiles (except .gitignore which is handled)
  /\.min\.(js|css)$/,
  /\.d\.ts$/, // TypeScript declaration files
];

// ---------------------------------------------------------------------------
// Helper: parse .gitignore rules
// ---------------------------------------------------------------------------

function parseGitignore(rootPath: string): string[] {
  const gitignorePath = join(rootPath, '.gitignore');
  if (!existsSync(gitignorePath)) {
    return [];
  }
  const content = readFileSync(gitignorePath, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function matchesGitignore(
  relativePath: string,
  patterns: string[],
): boolean {
  for (const pattern of patterns) {
    // Simple glob matching
    if (pattern.endsWith('/')) {
      // Directory pattern
      const dirPattern = pattern.slice(0, -1);
      if (relativePath === dirPattern || relativePath.startsWith(dirPattern + '/')) {
        return true;
      }
    } else if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
      );
      if (regex.test(relativePath) || regex.test(basename(relativePath))) {
        return true;
      }
    } else {
      if (relativePath === pattern || basename(relativePath) === pattern) {
        return true;
      }
    }
  }
  return false;
}

function shouldSkipFile(filePath: string, relPath: string): boolean {
  const name = basename(filePath);
  for (const pattern of SKIP_FILE_PATTERNS) {
    if (pattern.test(name)) return true;
  }
  return false;
}

function shouldSkipDirectory(name: string): boolean {
  return SKIP_DIRECTORIES.has(name);
}

// ---------------------------------------------------------------------------
// Helper: SHA-256 hash
// ---------------------------------------------------------------------------

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Helper: Walk directory recursively
// ---------------------------------------------------------------------------

async function walkDirectory(
  rootPath: string,
  currentPath: string,
  results: DiscoveredFile[],
  gitignorePatterns: string[],
  maxFileSize: number,
  maxFiles: number,
): Promise<void> {
  if (results.length >= maxFiles) return;

  const entries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= maxFiles) return;

    const fullPath = join(currentPath, entry.name);
    const relPath = relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      if (matchesGitignore(relPath + '/', gitignorePatterns)) continue;
      await walkDirectory(rootPath, fullPath, results, gitignorePatterns, maxFileSize, maxFiles);
    } else if (entry.isFile()) {
      if (shouldSkipFile(fullPath, relPath)) continue;
      if (matchesGitignore(relPath, gitignorePatterns)) continue;

      const language = getLanguageFromFilename(fullPath);
      if (!language) continue; // Skip files with unknown language

      try {
        const fileStat = await stat(fullPath);
        if (fileStat.size > maxFileSize) continue;

        const content = await readFile(fullPath, 'utf-8');
        const hash = computeHash(content);

        results.push({
          filePath: fullPath,
          language,
          content,
          hash,
          size: fileStat.size,
        });
      } catch {
        // Skip files that can't be read
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: map UnifiedCapture tag to NodeLabel
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

function captureTagToReferenceKind(tag: string): ReferenceSite['referenceKind'] {
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

// ---------------------------------------------------------------------------
// Helper: convert captures to symbol definitions, references, scope tree
// ---------------------------------------------------------------------------

interface CaptureGroup {
  symbols: SymbolDefinition[];
  references: ReferenceSite[];
  scopeTree: ScopeTree;
}

function groupCaptures(
  captures: UnifiedCapture[],
  filePath: string,
): CaptureGroup {
  const symbols: SymbolDefinition[] = [];
  const references: ReferenceSite[] = [];
  let symbolCounter = 0;

  // Build index of names used in this file for scope tree
  const nameSet = new Set<string>();

  for (const capture of captures) {
    const tag = capture.tag;

    // Check if this is a definition capture
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

      symbols.push({
        name,
        kind,
        qualifiedName,
        startLine: capture.startLine,
        endLine: capture.endLine,
        signature: capture.properties?.signature,
        returnType: capture.properties?.returnType,
        docstring: capture.properties?.docstring,
        containerName,
        isExported: false, // Will be determined by provider
        visibility: 'public',
        properties: capture.properties ?? {},
      });

      nameSet.add(name);
      symbolCounter++;
    }

    // Check if this is a reference capture
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

  // Build scope tree (simple flat structure per file)
  const scopeTree: ScopeTree = {
    name: basename(filePath),
    kind: 'File',
    startLine: 1,
    endLine: captures.length > 0
      ? captures.reduce((max, c) => Math.max(max, c.endLine), 0)
      : 1,
    children: symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      startLine: s.startLine,
      endLine: s.endLine,
      children: [],
      symbols: [s.qualifiedName],
    })),
    symbols: symbols.map((s) => s.qualifiedName),
  };

  return { symbols, references, scopeTree };
}

// ---------------------------------------------------------------------------
// Helper: get language provider instance
// ---------------------------------------------------------------------------

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
};

const providerCache = new Map<string, LanguageProvider>();

async function getOrLoadProvider(language: string): Promise<LanguageProvider | null> {
  const cached = providerCache.get(language);
  if (cached) return cached;

  const loader = providerLoaders[language];
  if (!loader) return null;

  const provider = await loader();
  providerCache.set(language, provider);
  return provider;
}

// ---------------------------------------------------------------------------
// Helper: resolve import path to file path
// ---------------------------------------------------------------------------

function resolveImportPath(
  importPath: string,
  sourceFilePath: string,
  projectRoot: string,
): string | null {
  // Relative import
  if (importPath.startsWith('.')) {
    const sourceDir = dirname(sourceFilePath);
    const resolved = resolve(sourceDir, importPath);

    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.js'];
    for (const ext of extensions) {
      const candidate = ext.startsWith('/') ? resolved + ext : `${resolved}${ext}`;
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  // Package import — try to find in node_modules
  const nodeModulesPath = join(projectRoot, 'node_modules', importPath);
  if (existsSync(nodeModulesPath)) {
    // Try index / main entry
    const packageJsonPath = join(nodeModulesPath, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        const mainEntry = pkg.main || pkg.exports?.['.']?.import || 'index.js';
        const mainPath = join(nodeModulesPath, mainEntry);
        if (existsSync(mainPath)) return mainPath;
      } catch {
        // Ignore parse errors
      }
    }
    // Fall back to index.js or index.ts
    for (const idx of ['index.js', 'index.ts', 'index.tsx']) {
      const idxPath = join(nodeModulesPath, idx);
      if (existsSync(idxPath)) return idxPath;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Phase 1: scan — Discover source files in the project
// ---------------------------------------------------------------------------

export class ScanPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'scan';
  readonly dependencies: PipelinePhaseId[] = [];
  readonly description = 'Discover source files in the project directory';
  readonly parallelizable = false;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const discoveredFiles: DiscoveredFile[] = [];

      // Handle non-existent directories gracefully
      if (!existsSync(ctx.rootPath)) {
        ctx.phaseData.set('scan', { files: [], discoveredFiles: [] });
        return { phaseId: this.id, status: 'success', output: { filesDiscovered: 0 } };
      }

      const gitignorePatterns = parseGitignore(ctx.rootPath);

      await walkDirectory(
        ctx.rootPath,
        ctx.rootPath,
        discoveredFiles,
        gitignorePatterns,
        ctx.config.maxFileSize,
        ctx.config.maxFiles,
      );

      // Store in phaseData
      ctx.phaseData.set('scan', {
        files: discoveredFiles,
        discoveredFiles,
      });

      // Populate ctx.graph with Folder and File nodes if graph is present
      if (ctx.graph) {
        const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);

        for (const file of discoveredFiles) {
          const relPath = relative(ctx.rootPath, file.filePath);
          const dirs = dirname(relPath).split('/').filter((d) => d.length > 0);

          // Ensure folder hierarchy exists
          let folderPath = ctx.rootPath;
          for (const dir of dirs) {
            folderPath = join(folderPath, dir);
            if (!ctx.graph.fileIndex.has(folderPath)) {
              builder.addNode(ctx.graph, 'Folder', folderPath, {
                name: dir,
                filePath: folderPath,
              }, `folder:${folderPath}`);
              // Edge from parent will be created during parse/crossFile phases
            }
          }

          // Create CONTAINS edges from folder to parent
          const parentPath = dirname(folderPath);
          const parentNodeId = ctx.graph.fileIndex.get(parentPath);
          const currentPath = dirs.length > 0 ? join(ctx.rootPath, ...dirs) : ctx.rootPath;
          const currentFolderId = ctx.graph.fileIndex.get(currentPath);
          if (parentNodeId && currentFolderId) {
            builder.addEdge(ctx.graph, parentNodeId, currentFolderId, 'CONTAINS', ctx.projectId);
          }

          // Create File node
          const fileNode = builder.addNode(ctx.graph, 'File', file.filePath, {
            name: basename(file.filePath),
            filePath: file.filePath,
            language: file.language ?? undefined,
          }, `file:${file.filePath}`);

          // Create CONTAINS edge from parent folder to file
          if (currentFolderId) {
            builder.addEdge(ctx.graph, currentFolderId, fileNode.id, 'CONTAINS', ctx.projectId);
          }
        }
      }

      return {
        phaseId: this.id,
        status: 'success',
        output: { filesDiscovered: discoveredFiles.length },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 2: structure — Build directory and module structure
// ---------------------------------------------------------------------------

export class StructurePhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'structure';
  readonly dependencies: PipelinePhaseId[] = ['scan'];
  readonly description = 'Build directory hierarchy and module structure';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (!scanData || !scanData.discoveredFiles) {
        return { phaseId: this.id, status: 'success', output: { directories: 0, modules: 0 } };
      }

      // Group files by directory to count modules
      const dirs = new Set<string>();
      const modules = new Map<string, DiscoveredFile[]>();

      for (const file of scanData.discoveredFiles) {
        const dir = dirname(file.filePath);
        dirs.add(dir);
        const existing = modules.get(dir) ?? [];
        existing.push(file);
        modules.set(dir, existing);
      }

      ctx.phaseData.set('structure', { directories: dirs.size, modules: modules.size });

      return {
        phaseId: this.id,
        status: 'success',
        output: { directories: dirs.size, modules: modules.size },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3: parse — Parse source files with language providers
// ---------------------------------------------------------------------------

export class ParsePhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'parse';
  readonly dependencies: PipelinePhaseId[] = ['scan', 'structure'];
  readonly description = 'Parse source files using language-specific parsers';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (!scanData || !scanData.discoveredFiles) {
        return { phaseId: this.id, status: 'success', output: { filesParsed: 0 } };
      }

      const parsedFiles: ParsedFile[] = [];
      let successCount = 0;
      let failCount = 0;

      for (const file of scanData.discoveredFiles) {
        const lang = file.language;
        if (!lang) continue;

        try {
          const provider = await getOrLoadProvider(lang);
          if (!provider) continue;

          const captures = provider.parse(file.content, file.filePath);

          // Determine if items are exported
          for (const capture of captures) {
            if (capture.name) {
              const isExported = provider.isExported(file.content, capture.name);
              if (capture.properties) {
                capture.properties.exported = String(isExported);
              }
            }
          }

          const { symbols, references, scopeTree } = groupCaptures(captures, file.filePath);

          parsedFiles.push({
            filePath: file.filePath,
            language: lang as SupportedLanguage,
            symbols,
            references,
            scopeTree,
            ast: captures, // Use capture array as AST representation
          });

          // Add symbol nodes to the graph
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
                if (label === 'Method' || label === 'Constructor') {
                  // Method within its parent class
                  if (currentClassNodeId) {
                    builder.addEdge(
                      ctx.graph,
                      currentClassNodeId,
                      node.id,
                      'HAS_METHOD',
                      ctx.projectId,
                    );
                  } else {
                    builder.addEdge(ctx.graph, fileNodeId, node.id, 'DEFINES', ctx.projectId);
                  }
                } else if (label === 'Class') {
                  currentClassNodeId = node.id;
                  builder.addEdge(ctx.graph, fileNodeId, node.id, 'DEFINES', ctx.projectId);

                  // EXTENDS edge for base classes
                  const baseClasses = symbol.properties.baseClasses as string | undefined;
                  if (baseClasses) {
                    // Will be resolved in scopeResolution phase — store for now
                    if (symbol.properties.interfaces) {
                      // Store implements info for later resolution
                    }
                  }
                } else if (label === 'Interface') {
                  builder.addEdge(ctx.graph, fileNodeId, node.id, 'DEFINES', ctx.projectId);
                } else if (label === 'Function') {
                  builder.addEdge(ctx.graph, fileNodeId, node.id, 'DEFINES', ctx.projectId);
                } else {
                  builder.addEdge(ctx.graph, fileNodeId, node.id, 'DEFINES', ctx.projectId);
                }
              }
            }
          }

          successCount++;
        } catch {
          failCount++;
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
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 4: markdown — Process markdown documentation files (STUB)
// ---------------------------------------------------------------------------

export class MarkdownPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'markdown';
  readonly dependencies: PipelinePhaseId[] = ['scan'];
  readonly description = 'Process markdown and documentation files';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { markdownFiles: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Phase 5: config — Process configuration files (STUB)
// ---------------------------------------------------------------------------

export class ConfigPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'config';
  readonly dependencies: PipelinePhaseId[] = ['scan'];
  readonly description = 'Process configuration files (JSON, YAML, TOML, ENV)';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { configFiles: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Phase 6: crossFile — Cross-file dependency analysis
// ---------------------------------------------------------------------------

export class CrossFilePhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'crossFile';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Analyze cross-file dependencies and imports';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const parseData = ctx.phaseData.get('parse') as
        | { parsedFiles: ParsedFile[] }
        | undefined;

      if (!parseData || !parseData.parsedFiles) {
        return { phaseId: this.id, status: 'success', output: { crossFileDeps: 0 } };
      }

      const resolvedImports: ResolvedImport[] = [];
      let importEdgesCreated = 0;

      for (const parsedFile of parseData.parsedFiles) {
        // Collect imports from capture data
        const ast = parsedFile.ast as UnifiedCapture[];
        if (!Array.isArray(ast)) continue;

        const importCaptures = ast.filter(
          (c) =>
            c.tag === CAPTURE_TAGS.IMPORT ||
            c.tag === CAPTURE_TAGS.IMPORT_NAMED ||
            c.tag === CAPTURE_TAGS.IMPORT_DEFAULT ||
            c.tag === CAPTURE_TAGS.IMPORT_WILDCARD,
        );

        for (const imp of importCaptures) {
          const importPath = imp.name ?? imp.text;
          if (!importPath) continue;

          const resolvedFile = resolveImportPath(
            importPath,
            parsedFile.filePath,
            ctx.rootPath,
          );

          const importedNames = imp.properties?.names
            ? imp.properties.names.split(',').filter(Boolean)
            : [];

          resolvedImports.push({
            sourceFile: parsedFile.filePath,
            importPath,
            importedSymbols: importedNames,
            resolvedFiles: resolvedFile ? [resolvedFile] : [],
            semantics: imp.properties?.importType === 'namespace'
              ? 'namespace'
              : imp.properties?.importType === 'default'
                ? 'named'
                : 'named',
          });

          // Create IMPORTS edge if resolved
          if (resolvedFile && ctx.graph) {
            const sourceFileNodeId = ctx.graph.fileIndex.get(parsedFile.filePath);
            const targetFileNodeId = ctx.graph.fileIndex.get(resolvedFile);

            if (sourceFileNodeId && targetFileNodeId) {
              const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
              try {
                builder.addEdge(
                  ctx.graph,
                  sourceFileNodeId,
                  targetFileNodeId,
                  'IMPORTS',
                  ctx.projectId,
                );
                importEdgesCreated++;
              } catch {
                // Edge may already exist or node missing
              }
            }
          }
        }
      }

      ctx.phaseData.set('crossFile', { resolvedImports, importEdgesCreated });

      return {
        phaseId: this.id,
        status: 'success',
        output: { crossFileDeps: importEdgesCreated },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 7: scopeResolution — Resolve scopes and references
// ---------------------------------------------------------------------------

export class ScopeResolutionPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'scopeResolution';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Resolve scope trees and symbol references';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const parseData = ctx.phaseData.get('parse') as
        | { parsedFiles: ParsedFile[] }
        | undefined;

      if (!parseData || !parseData.parsedFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { referencesResolved: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let referencesResolved = 0;

      // Build an index of all known symbols across files
      // qualifiedName -> GraphNode
      const symbolNodes = new Map<string, { nodeId: number; label: NodeLabel }>();
      for (const [, node] of ctx.graph.nodes) {
        if (
          node.label === 'Function' ||
          node.label === 'Class' ||
          node.label === 'Method' ||
          node.label === 'Interface' ||
          node.label === 'Enum' ||
          node.label === 'TypeAlias' ||
          node.label === 'Constructor'
        ) {
          // Store by simple name (for symbol resolution) and qualified name
          symbolNodes.set(node.qualifiedName, { nodeId: node.id, label: node.label });
          symbolNodes.set(node.name, { nodeId: node.id, label: node.label });
        }
      }

      for (const parsedFile of parseData.parsedFiles) {
        const fileNodeId = ctx.graph.fileIndex.get(parsedFile.filePath);
        if (!fileNodeId) continue;

        // Process references — try to resolve CALLS edges
        for (const ref of parsedFile.references) {
          if (ref.referenceKind === 'call') {
            const target = symbolNodes.get(ref.targetName);
            if (target && fileNodeId !== target.nodeId) {
              // Find the source function/method node in the same file
              // This is a simplified approach — we look for the nearest function
              // containing this reference
              for (const symbol of parsedFile.symbols) {
                if (
                  symbol.startLine <= ref.sourceLine &&
                  symbol.endLine >= ref.sourceLine &&
                  (symbol.kind === 'Function' || symbol.kind === 'Method')
                ) {
                  const sourceQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                  const sourceNode = ctx.graph.qnameIndex.get(sourceQname);
                  if (sourceNode && sourceNode !== target.nodeId) {
                    try {
                      builder.addEdge(
                        ctx.graph,
                        sourceNode,
                        target.nodeId,
                        'CALLS',
                        ctx.projectId,
                      );
                      referencesResolved++;
                    } catch {
                      // Edge may already exist
                    }
                  }
                  break;
                }
              }
            }
          }
        }

        // Process class inheritance (EXTENDS edges)
        for (const symbol of parsedFile.symbols) {
          if (symbol.kind === 'Class') {
            const baseClasses = symbol.properties.baseClasses as string | undefined;
            if (baseClasses) {
              for (const baseClass of baseClasses.split(',').map((s) => s.trim()).filter(Boolean)) {
                const target = symbolNodes.get(baseClass);
                if (target) {
                  const sourceQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                  const sourceNodeId = ctx.graph.qnameIndex.get(sourceQname);
                  if (sourceNodeId) {
                    try {
                      builder.addEdge(
                        ctx.graph,
                        sourceNodeId,
                        target.nodeId,
                        'EXTENDS',
                        ctx.projectId,
                      );
                      referencesResolved++;
                    } catch {
                      // Edge may already exist
                    }
                  }
                }
              }
            }

            // IMPLEMENTS edges for interfaces
            const interfaces = symbol.properties.interfaces as string | undefined;
            if (interfaces) {
              for (const iface of interfaces.split(',').map((s) => s.trim()).filter(Boolean)) {
                const target = symbolNodes.get(iface);
                if (target) {
                  const sourceQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                  const sourceNodeId = ctx.graph.qnameIndex.get(sourceQname);
                  if (sourceNodeId) {
                    try {
                      builder.addEdge(
                        ctx.graph,
                        sourceNodeId,
                        target.nodeId,
                        'IMPLEMENTS',
                        ctx.projectId,
                      );
                      referencesResolved++;
                    } catch {
                      // Edge may already exist
                    }
                  }
                }
              }
            }
          }
        }
      }

      ctx.phaseData.set('scopeResolution', { referencesResolved });

      return {
        phaseId: this.id,
        status: 'success',
        output: { referencesResolved },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 8: routes — Detect route handlers (STUB)
// ---------------------------------------------------------------------------

export class RoutesPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'routes';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Detect and catalog API route handlers';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { routesFound: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Phase 9: tools — Detect AI agent tools (STUB)
// ---------------------------------------------------------------------------

export class ToolsPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'tools';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Detect AI agent tool definitions';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { toolsFound: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Phase 10: di — Detect dependency injection (STUB)
// ---------------------------------------------------------------------------

export class DependencyInjectionPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'di';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Detect dependency injection patterns';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { injectionsFound: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Phase 11: pruneLocalSymbols — Prune local-only symbols (STUB)
// ---------------------------------------------------------------------------

export class PruneLocalSymbolsPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'pruneLocalSymbols';
  readonly dependencies: PipelinePhaseId[] = ['scopeResolution'];
  readonly description = 'Prune local-only symbols from the knowledge graph';
  readonly parallelizable = false;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { symbolsPruned: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Phase 12: communities — Detect code communities (STUB)
// ---------------------------------------------------------------------------

export class CommunitiesPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'communities';
  readonly dependencies: PipelinePhaseId[] = ['crossFile'];
  readonly description = 'Detect code communities and module clusters';
  readonly parallelizable = false;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { communitiesFound: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Phase 13: processes — Detect business processes (STUB)
// ---------------------------------------------------------------------------

export class ProcessesPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'processes';
  readonly dependencies: PipelinePhaseId[] = ['scopeResolution', 'routes'];
  readonly description = 'Detect and catalog business process steps';
  readonly parallelizable = false;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { processesFound: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Phase 14: tests — Detect test files and relationships (STUB)
// ---------------------------------------------------------------------------

export class TestsPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'tests';
  readonly dependencies: PipelinePhaseId[] = ['scopeResolution'];
  readonly description = 'Detect test files and their code relationships';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { testsFound: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Phase 15: dump — Dump knowledge graph to storage
// ---------------------------------------------------------------------------

export class DumpPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'dump';
  readonly dependencies: PipelinePhaseId[] = [
    'scopeResolution', 'routes', 'tools', 'di',
    'communities', 'processes', 'tests',
  ];
  readonly description = 'Serialize and dump the knowledge graph to storage';
  readonly parallelizable = false;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return {
          phaseId: this.id,
          status: 'failed',
          error: 'No knowledge graph available to dump',
        };
      }

      // Create a store and dump the graph
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
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 16: similarity — Compute code similarity (STUB — needs embedding infra)
// ---------------------------------------------------------------------------

export class SimilarityPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'similarity';
  readonly dependencies: PipelinePhaseId[] = ['dump'];
  readonly description = 'Compute code similarity between files and functions';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { similarPairsFound: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Phase 17: semantic — Semantic analysis (STUB — needs embedding infra)
// ---------------------------------------------------------------------------

export class SemanticPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'semantic';
  readonly dependencies: PipelinePhaseId[] = ['dump'];
  readonly description = 'Perform semantic analysis on the knowledge graph';
  readonly parallelizable = false;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { semanticRelations: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Phase 18: embed — Generate embeddings (STUB — needs embedding infra)
// ---------------------------------------------------------------------------

export class EmbedPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'embed';
  readonly dependencies: PipelinePhaseId[] = ['dump'];
  readonly description = 'Generate vector embeddings for graph nodes';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    return { phaseId: this.id, status: 'success', output: { embeddingsGenerated: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Factory — Create all phases
// ---------------------------------------------------------------------------

export function createAllPhases(): ExecutablePhase[] {
  return [
    new ScanPhase(),
    new StructurePhase(),
    new ParsePhase(),
    new MarkdownPhase(),
    new ConfigPhase(),
    new CrossFilePhase(),
    new ScopeResolutionPhase(),
    new RoutesPhase(),
    new ToolsPhase(),
    new DependencyInjectionPhase(),
    new PruneLocalSymbolsPhase(),
    new CommunitiesPhase(),
    new ProcessesPhase(),
    new TestsPhase(),
    new DumpPhase(),
    new SimilarityPhase(),
    new SemanticPhase(),
    new EmbedPhase(),
  ];
}
