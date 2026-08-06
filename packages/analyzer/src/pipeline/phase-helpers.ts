// @code-analyzer/analyzer — Pipeline Phase Helpers

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

import { getLanguageFromFilename, CAPTURE_TAGS, PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { LanguageProvider } from '../languages/provider.js';
import type { ParsedImport } from '../languages/provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

import { GraphBuilder } from '../graph/graph-builder.js';
import { TypeRegistry } from '../resolution/type-registry.js';
import { TypeScriptTypeResolver } from '../resolution/typescript-resolver.js';
import { PythonTypeResolver } from '../resolution/python-resolver.js';

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

/* v8 ignore start */

export const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'target',
  '.cache', '.idea', '.vscode', 'coverage', '.nyc_output',
]);

export const SKIP_FILE_PATTERNS = [
  /^\./, // dotfiles (except .gitignore which is handled)
  /\.min\.(js|css)$/,
  /\.d\.ts$/, // TypeScript declaration files
];

// ---------------------------------------------------------------------------
// Helper: parse .gitignore rules
// ---------------------------------------------------------------------------

export function parseGitignore(rootPath: string): string[] {
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

export function matchesGitignore(
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

export function shouldSkipFile(filePath: string, _relPath: string): boolean {
  const name = basename(filePath);
  for (const pattern of SKIP_FILE_PATTERNS) {
    if (pattern.test(name)) return true;
  }
  return false;
}

export function shouldSkipDirectory(name: string): boolean {
  return SKIP_DIRECTORIES.has(name);
}

// ---------------------------------------------------------------------------
// Helper: SHA-256 hash
// ---------------------------------------------------------------------------

export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Helper: Walk directory recursively
// ---------------------------------------------------------------------------

export async function walkDirectory(
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

export function captureTagToNodeLabel(tag: string): NodeLabel {
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

export function captureTagToReferenceKind(tag: string): ReferenceSite['referenceKind'] {
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

export interface CaptureGroup {
  symbols: SymbolDefinition[];
  references: ReferenceSite[];
  scopeTree: ScopeTree;
}

export function groupCaptures(
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
      children: [] as ScopeTree[],
      symbols: [s.qualifiedName],
    })),
    symbols: symbols.map((s) => s.qualifiedName),
  };

  return { symbols, references, scopeTree };
}

// ---------------------------------------------------------------------------
// Helper: get language provider instance
// ---------------------------------------------------------------------------

export const providerLoaders: Record<string, () => Promise<LanguageProvider>> = {
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
  c: async () => {
    const { CProvider } = await import('../languages/c.js');
    return new CProvider();
  },
  cpp: async () => {
    const { CppProvider } = await import('../languages/cpp.js');
    return new CppProvider();
  },
  php: async () => {
    const { PhpProvider } = await import('../languages/php.js');
    return new PhpProvider();
  },
  ruby: async () => {
    const { RubyProvider } = await import('../languages/ruby.js');
    return new RubyProvider();
  },
  swift: async () => {
    const { SwiftProvider } = await import('../languages/swift.js');
    return new SwiftProvider();
  },
  dart: async () => {
    const { DartProvider } = await import('../languages/dart.js');
    return new DartProvider();
  },
  lua: async () => {
    const { LuaProvider } = await import('../languages/lua.js');
    return new LuaProvider();
  },
  scala: async () => {
    const { ScalaProvider } = await import('../languages/scala.js');
    return new ScalaProvider();
  },
  zig: async () => {
    const { ZigProvider } = await import('../languages/zig.js');
    return new ZigProvider();
  },
  elixir: async () => {
    const { ElixirProvider } = await import('../languages/elixir.js');
    return new ElixirProvider();
  },
  hcl: async () => {
    const { HclProvider } = await import('../languages/hcl.js');
    return new HclProvider();
  },
  dockerfile: async () => {
    const { DockerfileProvider } = await import('../languages/dockerfile.js');
    return new DockerfileProvider();
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
  svelte: async () => {
    const { SvelteProvider } = await import('../languages/svelte.js');
    return new SvelteProvider();
  },
};

export const providerCache = new Map<string, LanguageProvider>();

export async function getOrLoadProvider(language: string): Promise<LanguageProvider | null> {
  const cached = providerCache.get(language);
  if (cached) return cached;

  const loader = providerLoaders[language];
  if (!loader) return null;

  const provider = await loader();
  providerCache.set(language, provider);
  return provider;
}

// ---------------------------------------------------------------------------
// Simple string hash helper (used by similarity + embed phases)
// ---------------------------------------------------------------------------

export function simpleHash(str: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Helper: resolve import path to file path
// ---------------------------------------------------------------------------

export function resolveImportPath(
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
