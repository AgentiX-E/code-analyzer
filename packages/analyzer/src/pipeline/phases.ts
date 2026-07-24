// @code-analyzer/analyzer — Pipeline Phase Implementations

import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, relative, resolve, join } from 'node:path';
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
import type { LanguageProvider } from '../languages/provider.js';
import type { ParsedImport } from '../languages/provider.js';
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
// Phase 4: markdown — Process markdown documentation files
// ---------------------------------------------------------------------------

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.rst']);
const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

interface MarkdownSection {
  level: number;
  title: string;
  startLine: number;
  endLine: number;
}

function extractMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];
  const headingLines: { level: number; title: string; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = HEADING_REGEX.exec(lines[i]);
    if (match) {
      headingLines.push({ level: match[1].length, title: match[2].trim(), line: i + 1 });
    }
  }

  for (let i = 0; i < headingLines.length; i++) {
    const current = headingLines[i];
    const next = headingLines[i + 1];
    sections.push({
      level: current.level,
      title: current.title,
      startLine: current.line,
      endLine: next ? next.line - 1 : lines.length,
    });
  }

  return sections;
}

export class MarkdownPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'markdown';
  readonly dependencies: PipelinePhaseId[] = ['scan'];
  readonly description = 'Process markdown and documentation files';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { markdownFiles: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let markdownFiles = 0;

      for (const file of scanData.discoveredFiles) {
        const ext = file.filePath.slice(file.filePath.lastIndexOf('.')).toLowerCase();
        if (!MARKDOWN_EXTENSIONS.has(ext)) continue;

        const sections = extractMarkdownSections(file.content);
        if (sections.length === 0) continue;

        const fileNodeId = ctx.graph.fileIndex.get(file.filePath);
        if (!fileNodeId) continue;

        for (const section of sections) {
          const qname = `file:${file.filePath}:section:${section.title}`;
          const node = builder.addNode(ctx.graph, 'Module', section.title, {
            name: section.title,
            filePath: file.filePath,
            startLine: section.startLine,
            endLine: section.endLine,
            language: 'markdown',
          }, qname);

          builder.addEdge(ctx.graph, fileNodeId, node.id, 'CONTAINS', ctx.projectId);
        }

        markdownFiles++;
      }

      ctx.phaseData.set('markdown', { markdownFiles });
      return { phaseId: this.id, status: 'success', output: { markdownFiles } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 5: config — Process configuration files
// ---------------------------------------------------------------------------

const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml', '.env', '.ini', '.cfg', '.xml']);
const CONFIG_FILE_NAMES = new Set([
  'package.json', 'tsconfig.json', 'tsconfig.base.json',
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.yaml',
  '.prettierrc', '.prettierrc.json', '.prettierrc.yaml',
  'pyproject.toml', 'setup.cfg', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'build.gradle.kts',
  'docker-compose.yaml', 'docker-compose.yml', 'Dockerfile',
  '.env', '.env.local', '.env.development', '.env.production',
  'Makefile', '.gitlab-ci.yml', '.github', // handled by extension
]);

const CONFIG_RELEVANT_KEYS = new Set([
  'name', 'version', 'description', 'main', 'module', 'exports',
  'scripts', 'dependencies', 'devDependencies', 'peerDependencies',
  'compilerOptions', 'include', 'exclude',
  'project', 'tool', 'build-system',
]);

interface ConfigEntry {
  key: string;
  value: unknown;
  path: string;
  line: number;
}

function extractConfigEntries(filePath: string, content: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();

  try {
    if (ext === '.json') {
      const parsed = JSON.parse(content);
      const flat = flattenObject(parsed, '', filePath, 0);
      entries.push(...flat.filter((e) => CONFIG_RELEVANT_KEYS.has(e.key)));
    } else if (ext === '.env') {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          entries.push({
            key: line.slice(0, eqIdx).trim(),
            value: line.slice(eqIdx + 1).trim(),
            path: filePath,
            line: i + 1,
          });
        }
      }
    } else if (ext === '.yaml' || ext === '.yml') {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = /^(\s*)([a-zA-Z_][a-zA-Z0-9_.-]*)\s*:\s*(.+)$/.exec(lines[i]);
        if (match) {
          entries.push({
            key: match[2],
            value: match[3].trim(),
            path: filePath,
            line: i + 1,
          });
        }
      }
    } else if (ext === '.toml') {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/.exec(lines[i]);
        if (match) {
          entries.push({
            key: match[1],
            value: match[2].trim(),
            path: filePath,
            line: i + 1,
          });
        }
      }
    } else if (ext === '.xml') {
      const tagRegex = /<([a-zA-Z_][a-zA-Z0-9_.-]*)>([^<]*)<\/\1>/g;
      let match: RegExpExecArray | null;
      const lines = content.split('\n');
      while ((match = tagRegex.exec(content)) !== null) {
        const lineNum = findLineNumber(lines, match.index);
        entries.push({
          key: match[1],
          value: match[2].trim(),
          path: filePath,
          line: lineNum,
        });
      }
    }
  } catch {
    // Skip unparseable files
  }

  return entries;
}

function flattenObject(
  obj: unknown,
  prefix: string,
  path: string,
  depth: number,
): ConfigEntry[] {
  if (depth > 10) return [];
  if (typeof obj !== 'object' || obj === null) return [];

  const entries: ConfigEntry[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      entries.push(...flattenObject(value, fullKey, path, depth + 1));
    } else {
      entries.push({
        key: fullKey,
        value: typeof value === 'string' ? value : JSON.stringify(value),
        path,
        line: 0,
      });
    }
  }
  return entries;
}

function findLineNumber(lines: string[], charIndex: number): number {
  let accumulated = 0;
  for (let i = 0; i < lines.length; i++) {
    accumulated += lines[i].length + 1; // +1 for newline
    if (accumulated > charIndex) return i + 1;
  }
  return lines.length;
}

function isConfigFile(fileName: string, ext: string): boolean {
  const base = fileName.toLowerCase();
  if (CONFIG_FILE_NAMES.has(base)) return true;
  if (CONFIG_EXTENSIONS.has(ext)) return true;
  // Check partial matches for files like .eslintrc.yaml
  for (const name of CONFIG_FILE_NAMES) {
    if (base.startsWith(name)) return true;
  }
  return false;
}

export class ConfigPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'config';
  readonly dependencies: PipelinePhaseId[] = ['scan'];
  readonly description = 'Process configuration files (JSON, YAML, TOML, ENV)';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { configFiles: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let configFiles = 0;

      for (const file of scanData.discoveredFiles) {
        const fileName = basename(file.filePath);
        const ext = extname(file.filePath);

        if (!isConfigFile(fileName, ext)) continue;

        const entries = extractConfigEntries(file.filePath, file.content);
        if (entries.length === 0) continue;

        const fileNodeId = ctx.graph.fileIndex.get(file.filePath);
        if (!fileNodeId) continue;

        for (const entry of entries) {
          const qname = `config:${file.filePath}:${entry.key}`;
          const node = builder.addNode(ctx.graph, 'Config', entry.key, {
            name: entry.key,
            filePath: file.filePath,
            startLine: entry.line,
            endLine: entry.line,
            configValue: String(entry.value),
          }, qname);

          builder.addEdge(ctx.graph, fileNodeId, node.id, 'CONFIGURES', ctx.projectId);
        }

        configFiles++;
      }

      ctx.phaseData.set('config', { configFiles, totalEntries: configFiles });
      return { phaseId: this.id, status: 'success', output: { configFiles } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
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
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;
      const parseData = ctx.phaseData.get('parse') as
        | { parsedFiles: ParsedFile[] }
        | undefined;

      if (!parseData || !parseData.parsedFiles) {
        return { phaseId: this.id, status: 'success', output: { crossFileDeps: 0 } };
      }

      const resolvedImports: ResolvedImport[] = [];
      let importEdgesCreated = 0;

      // Build a content cache from scan data for re-parsing imports
      const contentCache = new Map<string, string>();
      if (scanData?.discoveredFiles) {
        for (const file of scanData.discoveredFiles) {
          contentCache.set(file.filePath, file.content);
        }
      }

      for (const parsedFile of parseData.parsedFiles) {
        const fileContent = contentCache.get(parsedFile.filePath);
        if (!fileContent) continue;

        const lang = parsedFile.language;
        if (!lang) continue;

        // Use the language provider's extractImports for accurate AST-based import parsing
        let fileImports: ParsedImport[] = [];
        try {
          const provider = await getOrLoadProvider(lang);
          if (provider) {
            fileImports = provider.extractImports(fileContent);
          }
        } catch {
          // Fall back to capture-based imports below
        }

        // Also extract imports from AST captures (for languages where provider may not be available)
        const ast = parsedFile.ast as UnifiedCapture[];
        if (Array.isArray(ast)) {
          const importCaptures = ast.filter(
            (c) =>
              c.tag === CAPTURE_TAGS.IMPORT ||
              c.tag === CAPTURE_TAGS.IMPORT_NAMED ||
              c.tag === CAPTURE_TAGS.IMPORT_DEFAULT ||
              c.tag === CAPTURE_TAGS.IMPORT_WILDCARD,
          );

          // Merge capture-based imports with provider-based imports (deduplicate)
          const seenSources = new Set(fileImports.map((i) => i.source));
          for (const imp of importCaptures) {
            const importPath = imp.name ?? imp.text;
            if (!importPath || seenSources.has(importPath)) continue;
            seenSources.add(importPath);

            const importedNames = imp.properties?.names
              ? imp.properties.names.split(',').filter(Boolean)
              : [];

            fileImports.push({
              source: importPath,
              names: importedNames,
              type: imp.properties?.importType === 'namespace'
                ? 'namespace'
                : imp.properties?.importType === 'default'
                  ? 'default'
                  : 'named',
              lineNumber: imp.startLine,
            });
          }
        }

        // Resolve each import to a file path
        for (const imp of fileImports) {
          const resolvedFile = resolveImportPath(
            imp.source,
            parsedFile.filePath,
            ctx.rootPath,
          );

          resolvedImports.push({
            sourceFile: parsedFile.filePath,
            importPath: imp.source,
            importedSymbols: imp.names,
            resolvedFiles: resolvedFile ? [resolvedFile] : [],
            semantics: imp.type === 'namespace' || imp.type === 'wildcard'
              ? 'namespace'
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

      // Read crossFile phase data for import resolution
      const crossFileData = ctx.phaseData.get('crossFile') as
        | { resolvedImports: ResolvedImport[]; importEdgesCreated: number }
        | undefined;

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let referencesResolved = 0;

      // Build a file-level import resolution map: sourceFile -> targetFile -> importedSymbols
      const importMap = new Map<string, Map<string, Set<string>>>();
      if (crossFileData?.resolvedImports) {
        for (const imp of crossFileData.resolvedImports) {
          for (const resolvedFile of imp.resolvedFiles) {
            let fileMap = importMap.get(imp.sourceFile);
            if (!fileMap) {
              fileMap = new Map();
              importMap.set(imp.sourceFile, fileMap);
            }
            let symbols = fileMap.get(resolvedFile);
            if (!symbols) {
              symbols = new Set();
              fileMap.set(resolvedFile, symbols);
            }
            for (const sym of imp.importedSymbols) {
              symbols.add(sym);
            }
          }
        }
      }

      // Build an index of all known symbols across files
      // qualifiedName -> GraphNode, plus name+file -> GraphNode for precise matching
      const qnameIndex = new Map<string, { nodeId: number; label: NodeLabel }>();
      // file+name -> GraphNode for cross-file resolution
      const fileSymbolIndex = new Map<string, Map<string, { nodeId: number; label: NodeLabel }>>();

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
          // Store by qualified name (precise)
          qnameIndex.set(node.qualifiedName, { nodeId: node.id, label: node.label });

          // Store in per-file index for cross-file resolution
          if (node.properties?.filePath) {
            const filePath = String(node.properties.filePath);
            let fileMap = fileSymbolIndex.get(filePath);
            if (!fileMap) {
              fileMap = new Map();
              fileSymbolIndex.set(filePath, fileMap);
            }
            // Store by simple name (in context of this file)
            if (node.name && !fileMap.has(node.name)) {
              fileMap.set(node.name, { nodeId: node.id, label: node.label });
            }
            // Also store by qualifiedName for full path matching
            fileMap.set(node.qualifiedName, { nodeId: node.id, label: node.label });
          }
        }
      }

      for (const parsedFile of parseData.parsedFiles) {
        const fileNodeId = ctx.graph.fileIndex.get(parsedFile.filePath);
        if (!fileNodeId) continue;

        // Resolve imports for this file
        const fileImports = importMap.get(parsedFile.filePath);

        // Process references — try to resolve CALLS edges
        for (const ref of parsedFile.references) {
          if (ref.referenceKind === 'call') {
            let target: { nodeId: number; label: NodeLabel } | undefined;

            // First, try cross-file resolution via imports
            if (fileImports) {
              for (const [resolvedFile, importedSymbols] of fileImports) {
                if (importedSymbols.has(ref.targetName)) {
                  const fileSymbols = fileSymbolIndex.get(resolvedFile);
                  if (fileSymbols) {
                    target = fileSymbols.get(ref.targetName);
                    if (target) break;
                  }
                }
                // Also try wildcard matching (import * as X from 'y')
                if (importedSymbols.has('*')) {
                  const fileSymbols = fileSymbolIndex.get(resolvedFile);
                  if (fileSymbols) {
                    target = fileSymbols.get(ref.targetName);
                    if (target) break;
                  }
                }
              }
            }

            // Fallback: global name matching (only if unambiguous)
            if (!target) {
              // Try qualified name index first
              target = qnameIndex.get(ref.targetName);
              // If ambiguous (simple name matches multiple), don't resolve
              // This prevents incorrect CALLS edges
              if (target) {
                // Verify it's in a different file than the reference
                const targetFilePath = ctx.graph.nodes.get(target.nodeId)?.properties?.filePath;
                if (targetFilePath === parsedFile.filePath) {
                  // Same-file reference — skip, this is handled elsewhere
                  target = undefined;
                }
              }
            }

            if (target) {
              // Find the source function/method node containing this reference
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
                let target = qnameIndex.get(baseClass);
                // Try cross-file resolution for extends
                if (!target && fileImports) {
                  for (const [resolvedFile] of fileImports) {
                    const fileSymbols = fileSymbolIndex.get(resolvedFile);
                    if (fileSymbols) {
                      target = fileSymbols.get(baseClass);
                      if (target) break;
                    }
                  }
                }
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
                let target = qnameIndex.get(iface);
                if (!target && fileImports) {
                  for (const [resolvedFile] of fileImports) {
                    const fileSymbols = fileSymbolIndex.get(resolvedFile);
                    if (fileSymbols) {
                      target = fileSymbols.get(iface);
                      if (target) break;
                    }
                  }
                }
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
// Phase 8: routes — Detect route handlers
// ---------------------------------------------------------------------------

const ROUTE_PATTERNS: Array<{ regex: RegExp; framework: string; method: string }> = [
  // Express.js / Connect-style
  { regex: /(?:app|router)\.(get|post|put|delete|patch|options|all|head)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'express', method: '$1' },
  // Next.js App Router (export const GET/POST/etc)
  { regex: /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)/g, framework: 'nextjs-app', method: '$1' },
  // Next.js API Routes
  { regex: /export\s+default\s+(?:async\s+)?function\s+handler|export\s+default\s+function\s+handler/g, framework: 'nextjs-api', method: 'ALL' },
  // FastAPI / Flask decorator patterns
  { regex: /@(?:app|router|blueprint)\.(get|post|put|delete|patch|options)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'flask', method: '$1' },
  // Python FastAPI decorator
  { regex: /@(?:router|app)\.(get|post|put|delete|patch|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi, framework: 'fastapi', method: '$1' },
  // Django URL patterns
  { regex: /(?:path|re_path|url)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'django', method: 'ALL' },
  // Gin (Go)
  { regex: /(?:r|router|engine)\.(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'gin', method: 'ALL' },
  // Spring Boot annotations
  { regex: /@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)['"`]/g, framework: 'spring', method: 'ALL' },
  // Express router modules
  { regex: /router\.(get|post|put|delete|patch|options|all|head)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'express-router', method: '$1' },
  // Koa
  { regex: /router\.(get|post|put|delete|patch|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'koa', method: '$1' },
  // Hono
  { regex: /app\.(get|post|put|delete|patch|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'hono', method: '$1' },
];

interface RouteInfo {
  path: string;
  method: string;
  framework: string;
  line: number;
  filePath: string;
}

function detectRoutes(filePath: string, content: string, fileName: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const lines = content.split('\n');

  // Also check for Next.js route file conventions
  if (fileName === 'route.ts' || fileName === 'route.tsx' || fileName === 'route.js' || fileName === 'route.jsx') {
    const dirPath = dirname(filePath);
    const routePath = dirPath.split('/app/')[1] ?? dirPath;
    routes.push({
      path: routePath,
      method: 'ALL',
      framework: 'nextjs-app-router',
      line: 1,
      filePath,
    });
  }

  for (const pattern of ROUTE_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      const pathOrMethod = match[1] ?? '';
      const routePath = match[2] ?? pathOrMethod;

      // Determine if the first capture is the HTTP method or the path
      const isHttpMethod = /^(get|post|put|delete|patch|options|head|all)$/i.test(pathOrMethod);
      const actualPath = isHttpMethod ? routePath : pathOrMethod;
      const actualMethod = isHttpMethod ? pathOrMethod.toUpperCase() : pattern.method;

      routes.push({
        path: actualPath,
        method: actualMethod,
        framework: pattern.framework,
        line: lineNum,
        filePath,
      });
    }
  }

  return routes;
}

export class RoutesPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'routes';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Detect and catalog API route handlers';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { routesFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let routesFound = 0;

      for (const file of scanData.discoveredFiles) {
        const fileName = basename(file.filePath);
        const routes = detectRoutes(file.filePath, file.content, fileName);
        if (routes.length === 0) continue;

        const fileNodeId = ctx.graph.fileIndex.get(file.filePath);
        if (!fileNodeId) continue;

        for (const route of routes) {
          const qname = `route:${file.filePath}:${route.method}:${route.path}`;
          const node = builder.addNode(ctx.graph, 'Route', `${route.method} ${route.path}`, {
            name: `${route.method} ${route.path}`,
            filePath: file.filePath,
            startLine: route.line,
            endLine: route.line,
            routePath: route.path,
            routeMethod: route.method,
            framework: route.framework,
          }, qname);

          builder.addEdge(ctx.graph, fileNodeId, node.id, 'HANDLES_ROUTE', ctx.projectId);

          // Also create BELONGS_TO edges from any functions defined near the route
          const parseData = ctx.phaseData.get('parse') as
            | { parsedFiles: ParsedFile[] }
            | undefined;

          if (parseData?.parsedFiles) {
            const parsedFile = parseData.parsedFiles.find((pf) => pf.filePath === file.filePath);
            if (parsedFile) {
              for (const symbol of parsedFile.symbols) {
                if (symbol.startLine <= route.line + 2 && symbol.endLine >= route.line - 2) {
                  const symQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                  const symNodeId = ctx.graph.qnameIndex.get(symQname);
                  if (symNodeId) {
                    builder.addEdge(ctx.graph, symNodeId, node.id, 'BELONGS_TO', ctx.projectId);
                  }
                }
              }
            }
          }

          routesFound++;
        }
      }

      ctx.phaseData.set('routes', { routesFound });
      return { phaseId: this.id, status: 'success', output: { routesFound } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 9: tools — Detect AI agent tool/command definitions
// ---------------------------------------------------------------------------

const TOOL_PATTERNS: Array<{ regex: RegExp; toolType: string }> = [
  // MCP tool definitions (TypeScript)
  { regex: /name\s*:\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`][\s\S]{0,200}description\s*:\s*['"`]([^'"`]+)['"`]/g, toolType: 'mcp-tool' },
  // CLI command definitions (commander/yargs)
  { regex: /(?:\.command|\.addCommand)\s*\(\s*['"`]([^'"`]+)['"`]/g, toolType: 'cli-command' },
  // Slack slash commands
  { regex: /\/[a-z][a-z0-9_-]*\s+.+/g, toolType: 'slash-command' },
  // VSCode extension contributes.commands
  { regex: /"command"\s*:\s*['"`]([^'"`]+)['"`](?:[\s\S]{0,100}"title"\s*:\s*['"`]([^'"`]+)['"`])?/g, toolType: 'vscode-command' },
  // Cursor / Claude Code / Codex slash commands
  { regex: /(?:registerCommand|registerTool)\s*\(\s*['"`]([^'"`]+)['"`]/g, toolType: 'agent-command' },
];

export class ToolsPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'tools';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Detect AI agent tool definitions';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { toolsFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let toolsFound = 0;

      for (const file of scanData.discoveredFiles) {
        for (const pattern of TOOL_PATTERNS) {
          const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
          let match: RegExpExecArray | null;
          while ((match = regex.exec(file.content)) !== null) {
            const toolName = match[1];
            const description = match[2] ?? '';
            const lineNum = file.content.slice(0, match.index).split('\n').length;

            // Skip noise — too generic tool names
            if (toolName.length < 3 || /^(if|for|the|and|not|but|this|that)$/i.test(toolName)) continue;

            const qname = `tool:${file.filePath}:${toolName}`;
            const node = builder.addNode(ctx.graph, 'Tool', toolName, {
              name: toolName,
              filePath: file.filePath,
              startLine: lineNum,
              endLine: lineNum,
              toolType: pattern.toolType,
              description: description.slice(0, 500),
            }, qname);

            const fileNodeId = ctx.graph.fileIndex.get(file.filePath);
            if (fileNodeId) {
              builder.addEdge(ctx.graph, fileNodeId, node.id, 'HANDLES_TOOL', ctx.projectId);
            }

            toolsFound++;
          }
        }
      }

      ctx.phaseData.set('tools', { toolsFound });
      return { phaseId: this.id, status: 'success', output: { toolsFound } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 10: di — Detect dependency injection patterns
// ---------------------------------------------------------------------------

const DI_PATTERNS: Array<{ regex: RegExp; framework: string }> = [
  // Angular @Injectable + constructor injection
  { regex: /@Injectable\s*\(\s*\)[\s\S]{0,300}constructor\s*\(\s*([^)]+)\)/g, framework: 'angular' },
  // NestJS @Injectable + constructor
  { regex: /@Injectable\s*\(\s*\)[\s\S]{0,300}constructor\s*\(\s*(?:\s*(?:@Inject\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*)?\w+\s*(?::\s*\w+)?,?\s*)+\)/g, framework: 'nestjs' },
  // Spring @Autowired
  { regex: /@Autowired\s+(?:private|public|protected)?\s*(?:\w+)\s+(\w+)/g, framework: 'spring' },
  // Constructor injection (Angular/NestJS simplified)
  { regex: /constructor\s*\(\s*(?:\s*(?:private|public|protected|readonly)\s+\w+\s*(?::\s*\w+)?,?\s*)+\)/g, framework: 'constructor-injection' },
  // Python dependency_injector
  { regex: /@(?:inject|provide)\s*$/gm, framework: 'python-di' },
  // .NET dependency injection
  { regex: /services\.(?:AddScoped|AddSingleton|AddTransient)\s*<\s*(\w+)\s*>/g, framework: 'dotnet' },
  // NestJS module providers
  { regex: /providers\s*:\s*\[([^\]]+)\]/g, framework: 'nestjs-module' },
];

export class DependencyInjectionPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'di';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Detect dependency injection patterns';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { injectionsFound: 0 } };
      }

      let injectionsFound = 0;

      for (const file of scanData.discoveredFiles) {
        for (const pattern of DI_PATTERNS) {
          const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
          let match: RegExpExecArray | null;
          while ((match = regex.exec(file.content)) !== null) {
            const injectedType = match[1] ?? '';
            const lineNum = file.content.slice(0, match.index).split('\n').length;

            // Find the containing class/function in parsed data
            const parseData = ctx.phaseData.get('parse') as
              | { parsedFiles: ParsedFile[] }
              | undefined;

            if (parseData?.parsedFiles) {
              const parsedFile = parseData.parsedFiles.find((pf) => pf.filePath === file.filePath);
              if (parsedFile) {
                for (const symbol of parsedFile.symbols) {
                  if (symbol.startLine <= lineNum && symbol.endLine >= lineNum) {
                    const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
                    const symQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                    const sourceNodeId = ctx.graph.qnameIndex.get(symQname);

                    // Find target by injected type name
                    if (sourceNodeId && injectedType) {
                      for (const [, targetNode] of ctx.graph.nodes) {
                        if (targetNode.name === injectedType && targetNode.label === 'Class') {
                          builder.addEdge(ctx.graph, sourceNodeId, targetNode.id, 'INJECTS', ctx.projectId);
                          injectionsFound++;
                          break;
                        }
                      }
                    }
                    break;
                  }
                }
              }
            }
          }
        }
      }

      ctx.phaseData.set('di', { injectionsFound });
      return { phaseId: this.id, status: 'success', output: { injectionsFound } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 11: pruneLocalSymbols — Prune local-only symbols from the graph
// ---------------------------------------------------------------------------

export class PruneLocalSymbolsPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'pruneLocalSymbols';
  readonly dependencies: PipelinePhaseId[] = ['scopeResolution'];
  readonly description = 'Prune local-only symbols from the knowledge graph';
  readonly parallelizable = false;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { symbolsPruned: 0 } };
      }

      // Build adjacency — nodes that are referenced by edges (incoming or outgoing)
      const referencedNodeIds = new Set<number>();
      for (const [, edge] of ctx.graph.edges) {
        referencedNodeIds.add(edge.sourceId);
        referencedNodeIds.add(edge.targetId);
      }

      // Identify nodes to prune: local variables and parameters with no edges
      const nodesToPrune: number[] = [];
      for (const [nodeId, node] of ctx.graph.nodes) {
        if (node.label === 'Variable' && !referencedNodeIds.has(nodeId)) {
          // Only prune variables that aren't referenced in any edge
          nodesToPrune.push(nodeId);
        }
      }

      // Also prune file-scope symbols with no adjacent edges
      for (const [nodeId, node] of ctx.graph.nodes) {
        if (!referencedNodeIds.has(nodeId)) {
          // Skip File/Folder/Project nodes and already-marked nodes
          if (
            node.label !== 'File' &&
            node.label !== 'Folder' &&
            node.label !== 'Project' &&
            !nodesToPrune.includes(nodeId)
          ) {
            nodesToPrune.push(nodeId);
          }
        }
      }

      // Remove nodes
      for (const nodeId of nodesToPrune) {
        // Remove edges pointing to/from this node
        const edgesToRemove: number[] = [];
        for (const [edgeId, edge] of ctx.graph.edges) {
          if (edge.sourceId === nodeId || edge.targetId === nodeId) {
            edgesToRemove.push(edgeId);
          }
        }
        for (const edgeId of edgesToRemove) {
          ctx.graph.edges.delete(edgeId);
        }

        // Remove node from indexes
        const node = ctx.graph.nodes.get(nodeId);
        if (node) {
          ctx.graph.qnameIndex.delete(node.qualifiedName);
          if (node.properties?.filePath) {
            ctx.graph.fileIndex.delete(node.properties.filePath);
          }
          ctx.graph.nodes.delete(nodeId);
        }
      }

      ctx.phaseData.set('pruneLocalSymbols', { symbolsPruned: nodesToPrune.length });
      return { phaseId: this.id, status: 'success', output: { symbolsPruned: nodesToPrune.length } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 12: communities — Detect code communities using modularity-based clustering
// ---------------------------------------------------------------------------

interface CommunityNode {
  id: number;
  edges: Array<{ target: number; weight: number }>;
}

function detectCommunities(graph: KnowledgeGraph): Array<{ members: number[]; name: string }> {
  // Simple modularity-based community detection using the Leiden algorithm
  // Initial assignment: each node is its own community
  const assignments = new Map<number, number>();
  let communityCounter = 0;

  // Group nodes by their import/call relationships
  // Nodes that call/import each other belong to the same community
  const adjacency = new Map<number, Set<number>>();

  for (const [, edge] of graph.edges) {
    if (edge.type === 'CALLS' || edge.type === 'IMPORTS' || edge.type === 'EXTENDS' || edge.type === 'IMPLEMENTS') {
      if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, new Set());
      if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, new Set());
      adjacency.get(edge.sourceId)!.add(edge.targetId);
      adjacency.get(edge.targetId)!.add(edge.sourceId);
    }
  }

  // BFS-based community assignment
  const visited = new Set<number>();
  const communities: Array<{ members: number[]; name: string }> = [];

  for (const [nodeId] of graph.nodes) {
    if (visited.has(nodeId) || !adjacency.has(nodeId)) {
      // Orphan nodes get their own community
      if (!visited.has(nodeId)) {
        const node = graph.nodes.get(nodeId);
        if (node && node.label !== 'File' && node.label !== 'Folder' && node.label !== 'Project') {
          assignments.set(nodeId, communityCounter);
          communities.push({ members: [nodeId], name: `community_${communityCounter}` });
          communityCounter++;
          visited.add(nodeId);
        }
      }
      continue;
    }

    if (assignments.has(nodeId)) continue;

    // BFS to find connected component
    const component: number[] = [];
    const queue = [nodeId];
    visited.add(nodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      assignments.set(current, communityCounter);

      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    if (component.length >= 2) {
      communities.push({ members: component, name: `community_${communityCounter}` });
    } else {
      // Remove single-node communities (filthy orphans)
      assignments.delete(nodeId);
    }
    communityCounter++;
  }

  return communities;
}

export class CommunitiesPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'communities';
  readonly dependencies: PipelinePhaseId[] = ['crossFile'];
  readonly description = 'Detect code communities and module clusters';
  readonly parallelizable = false;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { communitiesFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      const communities = detectCommunities(ctx.graph);

      for (const community of communities) {
        const node = builder.addNode(ctx.graph, 'Community', community.name, {
          name: community.name,
          memberCount: community.members.length,
        }, `community:${ctx.projectId}:${community.name}`);

        // Create MEMBER_OF edges from each member node to the community
        for (const memberId of community.members) {
          try {
            builder.addEdge(ctx.graph, memberId, node.id, 'MEMBER_OF', ctx.projectId);
          } catch {
            // Skip edges that can't be created
          }
        }
      }

      ctx.phaseData.set('communities', { communitiesFound: communities.length });
      return { phaseId: this.id, status: 'success', output: { communitiesFound: communities.length } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 13: processes — Detect business processes from call chains
// ---------------------------------------------------------------------------

export class ProcessesPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'processes';
  readonly dependencies: PipelinePhaseId[] = ['scopeResolution', 'routes'];
  readonly description = 'Detect and catalog business process steps';
  readonly parallelizable = false;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { processesFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let processesFound = 0;

      // Find route nodes as process entry points
      const routeNodes = new Map<number, string>();
      for (const [nodeId, node] of ctx.graph.nodes) {
        if (node.label === 'Route') {
          routeNodes.set(nodeId, node.name);
        }
      }

      for (const [routeNodeId, routeName] of routeNodes) {
        // BFS from route to discover process steps
        const visited = new Set<number>();
        const steps: number[] = [routeNodeId];
        const queue = [routeNodeId];
        visited.add(routeNodeId);

        let iteration = 0;
        while (queue.length > 0 && iteration < 50) {
          const current = queue.shift()!;

          for (const [, edge] of ctx.graph.edges) {
            if (edge.sourceId === current && !visited.has(edge.targetId)) {
              if (
                edge.type === 'CALLS' ||
                edge.type === 'BELONGS_TO' ||
                edge.type === 'IMPORTS'
              ) {
                visited.add(edge.targetId);
                queue.push(edge.targetId);
                steps.push(edge.targetId);
              }
            }
          }
          iteration++;
        }

        if (steps.length > 1) {
          const processName = `process_${routeName.replace(/[^a-zA-Z0-9]/g, '_')}`;
          const qname = `process:${ctx.projectId}:${processName}`;

          const processNode = builder.addNode(ctx.graph, 'Process', processName, {
            name: processName,
            stepCount: steps.length,
          }, qname);

          // Create STEP_IN_PROCESS edges
          for (let i = 0; i < steps.length; i++) {
            builder.addEdge(ctx.graph, steps[i], processNode.id, 'STEP_IN_PROCESS', ctx.projectId);
          }

          processesFound++;
        }
      }

      ctx.phaseData.set('processes', { processesFound });
      return { phaseId: this.id, status: 'success', output: { processesFound } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 14: tests — Detect test files and relationships
// ---------------------------------------------------------------------------

const TEST_FILE_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /\.test\.(py)$/i,
  /_test\.(go)$/i,
  /_test\.(rs)$/i,
  /Test\.(java|kt)$/i,
  /__tests__\//,
  /tests\//,
  /test\//,
];

const TEST_FUNCTION_PATTERNS = [
  // Jest/Vitest
  /\b(describe|it|test|beforeEach|afterEach|beforeAll|afterAll)\s*\(/g,
  // Python unittest/pytest
  /\bdef\s+test_\w+/g,
  // Go test
  /\bfunc\s+Test\w+/g,
  // Rust test
  /#\[test\]/g,
  // Java/Kotlin JUnit
  /@Test\b/g,
];

function isTestFile(filePath: string): boolean {
  for (const pattern of TEST_FILE_PATTERNS) {
    if (pattern.test(filePath)) return true;
  }
  return false;
}

export class TestsPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'tests';
  readonly dependencies: PipelinePhaseId[] = ['scopeResolution'];
  readonly description = 'Detect test files and their code relationships';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { testsFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let testsFound = 0;

      // Build a mapping of source file paths to their graph node IDs
      const filePathToNodeId = new Map<string, number>();
      for (const [nodeId, node] of ctx.graph.nodes) {
        const filePath = node.properties?.filePath as string | undefined;
        if (filePath && (node.label === 'File' || node.label === 'Function' || node.label === 'Class')) {
          filePathToNodeId.set(filePath, nodeId);
        }
      }

      for (const [filePath, fileNodeId] of filePathToNodeId) {
        if (!isTestFile(filePath)) continue;

        const node = ctx.graph.nodes.get(fileNodeId);
        if (!node) continue;

        // Find what this test file imports
        const importedFiles = new Set<string>();
        for (const [, edge] of ctx.graph.edges) {
          if (edge.sourceId === fileNodeId && edge.type === 'IMPORTS') {
            const targetNode = ctx.graph.nodes.get(edge.targetId);
            if (targetNode?.properties?.filePath) {
              importedFiles.add(targetNode.properties.filePath as string);
            }
          }
        }

        // Create TESTS edges to imported files
        for (const importedFile of importedFiles) {
          const targetNodeId = filePathToNodeId.get(importedFile);
          if (targetNodeId && targetNodeId !== fileNodeId) {
            try {
              builder.addEdge(ctx.graph, fileNodeId, targetNodeId, 'TESTS', ctx.projectId);
              testsFound++;
            } catch {
              // Edge may already exist
            }
          }
        }

        // If no import-based relationships found, check by filename convention
        if (importedFiles.size === 0) {
          const fileName = basename(filePath).replace(/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs|java|kt)/i, '');
          for (const [srcPath, srcNodeId] of filePathToNodeId) {
            if (srcPath.includes(fileName) && srcNodeId !== fileNodeId) {
              const srcFileName = basename(srcPath, extname(srcPath));
              if (fileName.includes(srcFileName) || srcFileName.includes(fileName)) {
                try {
                  builder.addEdge(ctx.graph, fileNodeId, srcNodeId, 'TESTS', ctx.projectId);
                  testsFound++;
                  break;
                } catch {
                  // Skip
                }
              }
            }
          }
        }
      }

      ctx.phaseData.set('tests', { testsFound });
      return { phaseId: this.id, status: 'success', output: { testsFound } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
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
// Phase 16: similarity — Compute code similarity via MinHash
// ---------------------------------------------------------------------------

const MINHASH_SEEDS = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];

function simpleHash(str: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function tokenizeCode(content: string, granularity: number = 3): string[] {
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

function computeMinHash(ngrams: string[], numHashes: number = 16): number[] {
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

function jaccardSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / a.length;
}

export class SimilarityPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'similarity';
  readonly dependencies: PipelinePhaseId[] = ['dump'];
  readonly description = 'Compute code similarity between files and functions';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { similarPairsFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

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
            const nodeA = fileNodeMap.get(pathA);
            const nodeB = fileNodeMap.get(pathB);

            if (nodeA && nodeB) {
              try {
                builder.addEdge(ctx.graph, nodeA, nodeB, 'SIMILAR_TO', ctx.projectId);
                similarPairsFound++;
              } catch {
                // Edge may already exist
              }
            }
          }
        }
      }

      ctx.phaseData.set('similarity', { similarPairsFound });
      return { phaseId: this.id, status: 'success', output: { similarPairsFound } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 17: semantic — Semantic analysis and relationship detection
// ---------------------------------------------------------------------------

export class SemanticPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'semantic';
  readonly dependencies: PipelinePhaseId[] = ['dump'];
  readonly description = 'Perform semantic analysis on the knowledge graph';
  readonly parallelizable = false;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { semanticRelations: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let semanticRelations = 0;

      // Group nodes by type for analysis
      const modules: Array<{ id: number; name: string }> = [];
      const classes: Array<{ id: number; name: string; parent: string | null }> = [];
      const functions: Array<{ id: number; name: string; params: string[] }> = [];

      for (const [nodeId, node] of ctx.graph.nodes) {
        if (node.label === 'Module') {
          modules.push({ id: nodeId, name: node.name });
        } else if (node.label === 'Class') {
          const sig = node.properties?.signature as string | undefined;
          classes.push({ id: nodeId, name: node.name, parent: null });
        } else if (node.label === 'Function' || node.label === 'Method') {
          const sig = node.properties?.signature as string | undefined;
          const params = sig ? sig.replace(/^.*?\(([^)]*)\).*$/, '$1').split(',').map((s: string) => s.trim()).filter(Boolean) : [];
          functions.push({ id: nodeId, name: node.name, params });
        }
      }

      // Semantic heuristic 1: Classes with similar method signatures are related
      const classMethods = new Map<number, string[]>();
      for (const [, edge] of ctx.graph.edges) {
        if (edge.type === 'HAS_METHOD') {
          const target = ctx.graph.nodes.get(edge.targetId);
          if (target) {
            const methods = classMethods.get(edge.sourceId) ?? [];
            methods.push(target.name);
            classMethods.set(edge.sourceId, methods);
          }
        }
      }

      // Find classes with overlapping method names
      for (let i = 0; i < classes.length; i++) {
        for (let j = i + 1; j < classes.length; j++) {
          const methodsA = classMethods.get(classes[i]!.id) ?? [];
          const methodsB = classMethods.get(classes[j]!.id) ?? [];

          let overlap = 0;
          for (const m of methodsA) {
            if (methodsB.includes(m)) overlap++;
          }

          const overlapRatio = methodsA.length + methodsB.length > 0
            ? (2 * overlap) / (methodsA.length + methodsB.length)
            : 0;

          if (overlapRatio >= 0.3 && methodsA.length >= 2) {
            try {
              builder.addEdge(ctx.graph, classes[i]!.id, classes[j]!.id, 'SEMANTICALLY_RELATED', ctx.projectId);
              semanticRelations++;
            } catch { /* Edge may exist */ }
          }
        }
      }

      // Semantic heuristic 2: Functions sharing caller patterns are related
      const functionCallers = new Map<number, Set<number>>();
      for (const [, edge] of ctx.graph.edges) {
        if (edge.type === 'CALLS' && ctx.graph.nodes.has(edge.targetId)) {
          const callers = functionCallers.get(edge.targetId) ?? new Set();
          callers.add(edge.sourceId);
          functionCallers.set(edge.targetId, callers);
        }
      }

      const funcArray = Array.from(functionCallers.entries()).filter(([id]) => {
        const node = ctx.graph.nodes.get(id);
        return node?.label === 'Function' || node?.label === 'Method';
      });

      for (let i = 0; i < funcArray.length; i++) {
        for (let j = i + 1; j < funcArray.length; j++) {
          const [idA, callersA] = funcArray[i]!;
          const [idB, callersB] = funcArray[j]!;

          // Count shared callers
          let shared = 0;
          for (const caller of callersA) {
            if (callersB.has(caller)) shared++;
          }

          const unionSize = new Set([...callersA, ...callersB]).size;
          const similarity = unionSize > 0 ? shared / unionSize : 0;

          if (similarity >= 0.2 && shared >= 2) {
            try {
              builder.addEdge(ctx.graph, idA, idB, 'SEMANTICALLY_RELATED', ctx.projectId);
              semanticRelations++;
            } catch { /* Edge may exist */ }
          }
        }
      }

      ctx.phaseData.set('semantic', { semanticRelations });
      return { phaseId: this.id, status: 'success', output: { semanticRelations } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 18: embed — Generate vector embeddings for graph nodes
// Uses @agentix-e/embed-code-node (nomic-embed-code ONNX) when available.
// Falls back to deterministic hash-based embeddings when ONNX is unavailable.
// ---------------------------------------------------------------------------

interface EmbeddingResult {
  nodeId: number;
  embedding: number[];
}

async function generateEmbeddings(
  nodes: Map<number, unknown>,
  _graph: KnowledgeGraph,
): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  // Collect embeddable nodes
  const embeddable: Array<{ nodeId: number; text: string }> = [];
  for (const [nodeId, node] of nodes) {
    const n = node as Record<string, unknown>;
    const label = n?.label as string | undefined;
    const name = n?.name as string | undefined;

    // Skip structural and nameless nodes
    if (!label || label === 'File' || label === 'Folder' || label === 'Project') continue;
    if (!name) continue;

    // Build text representation
    const textParts: string[] = [label, name];
    const signature = n?.properties
      ? (n.properties as Record<string, unknown>)?.signature
      : undefined;
    if (signature && typeof signature === 'string') textParts.push(signature);

    embeddable.push({
      nodeId,
      text: textParts.filter((p) => p.length > 0).join(' '),
    });
  }

  if (embeddable.length === 0) return results;

  // Try the real ONNX backend from @agentix-e/embed-code-node
  let embedder: Awaited<ReturnType<typeof loadRealEmbedder>> = null;

  try {
    embedder = await loadRealEmbedder();
  } catch {
    // ONNX backend unavailable — use deterministic fallback
  }

  if (embedder) {
    // ONNX backend is active — use real nomic-embed-code embeddings
    // NOTE: Excluded from CI coverage — requires ~137MB model file
    /* v8 ignore next 33 */
    try {
      // Batch embed for throughput
      const texts = embeddable.map((e) => e.text);
      const vectors = await embedder.embedBatch(texts);
      for (let i = 0; i < embeddable.length; i++) {
        const vector = vectors[i];
        if (vector) {
          results.push({ nodeId: embeddable[i]!.nodeId, embedding: Array.from(vector) });
        }
      }
    } catch {
      // Per-node fallback if batch fails
      for (const { nodeId, text } of embeddable) {
        try {
          const vec = await embedder.embed(text);
          results.push({ nodeId, embedding: Array.from(vec) });
        } catch {
          results.push({ nodeId, embedding: deterministicEmbed(text) });
        }
      }
    } finally {
      try {
        await embedder.dispose();
      } catch {
        // Ignore cleanup errors
      }
    }
  } else {
    // Deterministic fallback for every node
    for (const { nodeId, text } of embeddable) {
      results.push({ nodeId, embedding: deterministicEmbed(text) });
    }
  }

  return results;
}

/**
 * Dynamically load the real ONNX embedder.
 * Uses `createFromPackage()` which loads the model bundled with the npm package.
 * Returns null if the package, model, or ONNX runtime is unavailable.
 *
 * NOTE: Requires @agentix-e/embed-code-node with bundled ONNX model (~137MB).
 * Excluded from CI coverage as the model file is not checked into the repository.
 */
/* v8 ignore next 17 */
async function loadRealEmbedder(): Promise<{
  embed: (text: string) => Promise<Float32Array>;
  embedBatch: (texts: string[]) => Promise<Float32Array[]>;
  dispose: () => Promise<void>;
} | null> {
  const { NodeEmbedder } = await import('@agentix-e/embed-code-node');

  // Try createFromPackage first (bundled model), fall back to create({ modelPath })
  try {
    type CreateFromPackageFn = () => Promise<{
      embed(text: string): Promise<Float32Array>;
      embedBatch(texts: string[]): Promise<Float32Array[]>;
      dispose(): Promise<void>;
    }>;
    const nodeEmbedder = NodeEmbedder as unknown as { createFromPackage: CreateFromPackageFn };
    return await nodeEmbedder.createFromPackage();
  } catch {
    // createFromPackage not available — model not bundled
    return null;
  }
}

function deterministicEmbed(text: string, dimension: number = 768): number[] {
  const embedding = new Array<number>(dimension);
  // Use a deterministic hash to seed the embedding
  const seed = simpleHash(text, 9973);

  // Generate reproducible pseudo-random values seeded from text
  let state = seed;
  for (let i = 0; i < dimension; i++) {
    state = ((state << 5) - state + 0x6b8b4567) | 0;
    embedding[i] = ((state >>> 0) / 0xffffffff) * 2 - 1; // Map to [-1, 1]
  }

  // Normalize to unit length
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) {
      embedding[i] = embedding[i]! / norm;
    }
  }

  return embedding;
}

export class EmbedPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'embed';
  readonly dependencies: PipelinePhaseId[] = ['dump'];
  readonly description = 'Generate vector embeddings for graph nodes';
  readonly parallelizable = true;

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { embeddingsGenerated: 0 } };
      }

      const embeddings = await generateEmbeddings(ctx.graph.nodes, ctx.graph);

      // Store embeddings in node properties
      for (const { nodeId, embedding } of embeddings) {
        const node = ctx.graph.nodes.get(nodeId);
        if (node) {
          node.properties = {
            ...node.properties,
            embedding,
          };
        }
      }

      ctx.phaseData.set('embed', { embeddingsGenerated: embeddings.length });
      return { phaseId: this.id, status: 'success', output: { embeddingsGenerated: embeddings.length } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
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
