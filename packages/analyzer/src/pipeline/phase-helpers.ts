// @code-analyzer/analyzer — Pipeline Phase Helpers

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve, join, sep } from 'node:path';

import { getLanguageFromFilename, CAPTURE_TAGS, PhaseLogger } from '@code-analyzer/shared';

// **A document extractor, not a language provider.** A PDF has no grammar and no symbols; **what it has is text**,
// and the scan phase is where text becomes indexable - so the extraction belongs here rather than in a parser.
import { extractPdfText } from '../languages/pdf-text.js';
import { rootsFor } from '../resolution/package-roots.js';

import type { LanguageProvider } from '../languages/provider.js';
import type { PackageRoots } from '../resolution/package-roots.js';
import type {
  PipelinePhase,
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
  SymbolDefinition,
  ReferenceSite,
  ScopeTree,
  NodeLabel,
  UnifiedCapture,
} from '@code-analyzer/shared';

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
// Shared phase-failure result
// ---------------------------------------------------------------------------

/**
 * Build a failed PhaseExecutionResult for a thrown error. Coerces non-Error
 * throws (e.g. a thrown string) into a message and normalizes the logger input.
 */
export function toPhaseFailure(
  err: unknown,
  phaseId: PipelinePhaseId,
  logger: PhaseLogger,
  rootPath?: string,
): PhaseExecutionResult {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), {
    phaseId,
    filePath: rootPath,
  });
  return { phaseId, status: 'failed', error: message };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.next',
  'target',
  '.cache',
  '.idea',
  '.vscode',
  'coverage',
  '.nyc_output',
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

/**
 * Does gitignore ignore this path?
 *
 * **`!pattern` re-includes, and the last rule that matches decides** - that is git's rule, and without it
 * `spring-petclinic`'s `.gitignore` (`*.css` followed by `!petclinic.css`) dropped the one stylesheet the project
 * explicitly tracks, so the CSS provider saw an empty corpus on a real repository while every fixture passed.
 * A rule is evaluated in file order rather than answered by the first pattern that happens to match.
 */
export function matchesGitignore(relativePath: string, patterns: string[]): boolean {
  let ignored = false;
  for (const raw of patterns) {
    const negated = raw.startsWith('!');
    const pattern = negated ? raw.slice(1) : raw;
    if (pattern.length === 0) continue;
    if (matchesOneGitignoreRule(relativePath, pattern)) ignored = !negated;
  }
  return ignored;
}

function matchesOneGitignoreRule(relativePath: string, pattern: string): boolean {
  const isDirectoryRule = pattern.endsWith('/');
  const anchored = pattern.startsWith('/');
  const body = (isDirectoryRule ? pattern.slice(0, -1) : pattern).replace(/^\//, '');
  if (body.length === 0) return false;

  if (anchored) {
    // **A leading slash means the repository root**, so only the path as written can match.
    return matchesGitignoreBody(relativePath, body, false);
  }

  // **A rule that names a directory also applies to everything inside it**, so every ancestor of the path is a
  // candidate. Without this, `dist/` missed `packages/x/dist`, which is the shape a monorepo actually has.
  const segments = relativePath.split('/').filter((segment) => segment.length > 0);
  for (let depth = 1; depth <= segments.length; depth++) {
    const candidate = segments.slice(0, depth).join('/');
    if (matchesGitignoreBody(candidate, body, true)) return true;
  }
  return false;
}

function matchesGitignoreBody(candidate: string, body: string, allowBasename: boolean): boolean {
  if (body.includes('*') || body.includes('?')) {
    const regex = gitignoreGlobToRegex(body);
    return regex.test(candidate) || (allowBasename && regex.test(basename(candidate)));
  }
  return candidate === body || (allowBasename && basename(candidate) === body);
}

/** `**` crosses directory separators; a single `*` does not; everything else is literal. */
function gitignoreGlobToRegex(glob: string): RegExp {
  // **Split on `**` rather than substituting a sentinel.** The first version used a control character as a placeholder
  // and `no-control-regex` rejected it - correctly: a printable glob has no business carrying one. Splitting is also the
  // clearer statement of the rule, since `**` is the only part that may cross a separator.
  const escapeLiteral = (part: string): string => part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = glob
    .split('**')
    .map((part) => escapeLiteral(part).replace(/\*/g, '[^/]*').replace(/\?/g, '.'))
    .join('.*');
  return new RegExp('^' + body + '$');
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
  readSource: SourceReader = readSourceFromDisk,
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
      await walkDirectory(
        rootPath,
        fullPath,
        results,
        gitignorePatterns,
        maxFileSize,
        maxFiles,
        readSource,
      );
    } else if (entry.isFile()) {
      if (shouldSkipFile(fullPath, relPath)) continue;
      if (matchesGitignore(relPath, gitignorePatterns)) continue;

      const language = getLanguageFromFilename(fullPath);
      if (!language) continue; // Skip files with unknown language

      try {
        const fileStat = await stat(fullPath);
        if (fileStat.size > maxFileSize) continue;

        // **A PDF is read as bytes and decoded, not read as text**, and that dispatch lives behind `readSource`
        // so a caller that cannot read from this filesystem at all (a test, an archive) still exercises the
        // same code path. See `pdf-text.ts` and `2026-10-09-deliberate-omissions-audited.md`.
        const content = await readSource(fullPath, language);
        if (language === 'pdf' && content.length === 0) continue;
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

/** Reads one source file as text. **A seam with a production default**: see `walkDirectory`. */
export type SourceReader = (filePath: string, language: string) => Promise<string>;

async function readSourceFromDisk(filePath: string, language: string): Promise<string> {
  if (language === 'pdf') {
    const bytes = await readFile(filePath);
    return extractPdfText(bytes).text;
  }
  return readFile(filePath, 'utf-8');
}

// ---------------------------------------------------------------------------
// Helper: file a decorator on the definition it decorates
// ---------------------------------------------------------------------------

/** Tags that begin a definition a decorator can precede. */
const DECORATABLE_TAGS: ReadonlySet<string> = new Set([
  CAPTURE_TAGS.FUNCTION_DEF,
  CAPTURE_TAGS.METHOD_DEF,
  CAPTURE_TAGS.CLASS_DEF,
  CAPTURE_TAGS.CONSTRUCTOR_DEF,
  CAPTURE_TAGS.PROPERTY_DEF,
]);

/**
 * Write each decorator onto the definition below it, as `decoratorNames`.
 *
 * **The tag was emitted by eight language providers and read by no phase** — `CAPTURE_TAGS.DECORATOR` exists, Java,
 * Kotlin, C#, C-like, Python, Rust and the rest all push captures for `@app.route`, `@pytest.fixture`, `@Test` and
 * `@RestController`, and the parse phase walked straight past them. **So the graph knew that a function is invoked by
 * a framework and threw it away**, which is the same shape of defect as `CALLS` before iteration 41: a producer with
 * no consumer looks exactly like a feature that works.
 *
 * **The rule is ordering, because that is what a decorator is**: the annotation sits on the lines immediately above the
 * definition it applies to, so a decorator attaches to the nearest following definition in its own file. A decorator
 * with no definition after it — a trailing one in a file that failed to parse — attaches to nothing and is skipped
 * rather than guessed at.
 *
 * **The join is in the pipeline rather than in each provider** because a provider that had to pair its own captures
 * would have to hold the same rule eight times, and seven of them would eventually disagree.
 */
export function attachDecorators(captures: UnifiedCapture[]): void {
  let decorators: UnifiedCapture[] = [];
  for (const capture of captures) {
    if (capture.tag === CAPTURE_TAGS.DECORATOR) decorators.push(capture);
  }
  if (decorators.length === 0) return;

  const definitions = captures
    .filter((capture) => DECORATABLE_TAGS.has(capture.tag) && capture.properties !== undefined)
    .sort((left, right) => left.startLine - right.startLine);
  if (definitions.length === 0) return;

  decorators = decorators.sort((left, right) => left.startLine - right.startLine);
  for (const decorator of decorators) {
    const target = definitions.find((definition) => definition.startLine > decorator.startLine);
    if (target === undefined) continue;
    const name = decorator.name ?? decorator.text;
    if (name === undefined || name.length === 0) continue;
    const known = target.properties?.['decoratorNames'];
    target.properties =
      typeof known === 'string' && known.length > 0
        ? { ...target.properties, decoratorNames: `${known},${name}` }
        : { ...target.properties, decoratorNames: name };
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

/**
 * What stood before the last `.` in a method call — `self` in `self.get(key)`.
 *
 * **Only a method call has one, and only when the provider wrote the callee out.** A `FUNCTION_CALL` capture is a
 * bare name by definition, and a provider that stores just the name leaves this `undefined`, which the resolver reads
 * as "a bare call". Both are the case where a declaration in the caller's own scope is the right answer; the case
 * that is *not* is `request.args.get(key)`, and this is what tells it apart.
 */
export function receiverOf(
  tag: string,
  text: string | undefined,
  targetName: string,
): string | undefined {
  if (tag !== CAPTURE_TAGS.METHOD_CALL) return undefined;
  if (typeof text !== 'string') return undefined;
  const cut = text.lastIndexOf('.');
  if (cut <= 0) return undefined;
  // A provider that stored the callee as `name` alone has no receiver to report.
  if (text.slice(cut + 1) !== targetName) return undefined;
  return text.slice(0, cut);
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

export function groupCaptures(captures: UnifiedCapture[], filePath: string): CaptureGroup {
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
      const qualifiedName = containerName ? `${containerName}.${name}` : `file:${filePath}:${name}`;

      symbols.push({
        name,
        kind,
        qualifiedName,
        startLine: capture.startLine,
        endLine: capture.endLine,
        signature: capture.properties?.['signature'],
        returnType: capture.properties?.['returnType'],
        docstring: capture.properties?.['docstring'],
        containerName,
        // **The export bit the capture already carries.** It was hardcoded `false` here with a comment promising a
        // provider would decide it later, and nothing ever did: the parse phase computes `properties.exported` from
        // `provider.isExported(...)` three lines before this call and this line threw it away, so **every node in
        // every graph had `isExported: false`** — 5 859 nodes on `pallets/flask@3.0.3`, 0 of them exported — and every
        // consumer asking "is this part of the API" was answered "no". The reachability pass asks exactly that, which
        // is how the defect surfaced.
        isExported: capture.properties?.['exported'] === 'true',
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
      const receiver = receiverOf(tag, capture.text, targetName);

      references.push({
        sourceFile: filePath,
        sourceLine: capture.startLine,
        sourceColumn: 0,
        targetName,
        referenceKind,
        ...(receiver === undefined ? {} : { receiver }),
      });
    }
  }

  // Build scope tree (simple flat structure per file)
  const scopeTree: ScopeTree = {
    name: basename(filePath),
    kind: 'File',
    startLine: 1,
    endLine: captures.length > 0 ? captures.reduce((max, c) => Math.max(max, c.endLine), 0) : 1,
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
  // **The provider exists and nothing could load it**: `xml.ts` names itself `xml`, and this map had no such key, so
  // `getOrLoadProvider('xml')` answered null for every XML file - and no file was ever named `xml` either.
  xml: async () => {
    const { XmlProvider } = await import('../languages/xml.js');
    return new XmlProvider();
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

/**
 * A Python module specifier, which is either relative dots (`from .helpers`, and `from . import x` where the specifier
 * is a bare `.`), or a dotted package path (`from flask.helpers`). **None of them is a filesystem path**, and all are
 * matched by this expression so the resolver only tries Python rules on something that is one.
 */
const PYTHON_MODULE_SPECIFIER = /^(?:\.*[A-Za-z_][\w.]*|\.+)$/;

/**
 * A Java import: `a.b.C`. **No relative form exists**, so a leading dot rules it out, and the last segment is a type
 * name rather than a module.
 */
const JAVA_TYPE_SPECIFIER = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/;

/**
 * The file a Java import names, or `null` when it is not in this project.
 *
 * **One candidate**: the type's dotted path below the package root, with `.java` appended. **A wildcard
 * (`import a.b.*`) names many files rather than one**, so it resolves to nothing here — an edge to whichever file
 * happened to sort first would be an edge nobody can defend.
 */
function resolveJavaType(
  specifier: string,
  sourceFile: string,
  projectRoot: string,
  extensions: readonly string[] = ['.java'],
): string | null {
  const segments = specifier.split('.').filter((part) => part.length > 0);
  const base = packageAnchor(segments[0] ?? '', sourceFile, projectRoot);
  const dotted = segments.join(sep);
  // **Kotlin's imports are Java's** - `import kotlinx.coroutines.internal.MainDispatcherLoader` is a dotted package path
  // and the file is `MainDispatcherLoader.kt` - so the same anchoring applies and only the extension differs. Without
  // this, `kotlinx.coroutines` indexed with **zero IMPORTS edges** (measured by the feature matrix), which leaves
  // change-impact with nothing to walk in a Kotlin repository.
  for (const extension of extensions) {
    const candidate = join(base, `${dotted}${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The file a Python import names, or `null` when there is none on disk.
 *
 * **Two rules, and each is the language's rather than a guess:**
 *
 * - **Relative dots** count from the importing module's package: `.helpers` is `helpers.py` beside the importer, and
 *   `..utils` is one directory up.
 * - **A dotted name with no dots in front** is resolved against **the package the importer itself belongs to**, found
 *   by locating the import's first segment in the importer's own path. `src/flask/app.py` importing `flask.helpers`
 *   means `src/flask/helpers.py` — **not** a `flask` package installed in `node_modules`, which is where the generic
 *   branch was looking.
 *
 * **A module is a file or a package**, so `__init__.py` is a candidate: `from . import x` names a package, and a
 * resolver that only tried `<name>.py` would call every one of those imports unresolved.
 */
/**
 * The directory a dotted package name is relative to, found from the importer's own path.
 *
 * **Both Python's absolute imports and Java's imports mean "this package, from its root"**, and the root is the
 * directory *above* the first segment the importer's own path contains: `.../src/flask/app.py` importing `flask.x`
 * is anchored at `.../src`, and `.../src/main/java/org/.../OwnerController.java` importing `org.x` is anchored at
 * `.../src/main/java`. **Without the importer's path there is no way to tell a project package from an installed
 * one**, which is why the generic branch could only look in `node_modules`.
 */
function packageAnchor(firstSegment: string, sourceFile: string, projectRoot: string): string {
  const directories = dirname(sourceFile).split(sep);
  const anchor = firstSegment.length > 0 ? directories.lastIndexOf(firstSegment) : -1;
  return anchor > 0 ? directories.slice(0, anchor).join(sep) : projectRoot;
}

function resolvePythonModule(
  specifier: string,
  sourceFile: string,
  projectRoot: string,
  roots?: PackageRoots,
): string | null {
  const dots = /^\.+/.exec(specifier)?.[0].length ?? 0;
  const segments = specifier
    .slice(dots)
    .split('.')
    .filter((part) => part.length > 0);

  const bases: string[] = [];
  if (dots > 0) {
    let base = dirname(sourceFile);
    for (let level = 1; level < dots; level += 1) base = dirname(base);
    bases.push(base);
  } else {
    bases.push(packageAnchor(segments[0] ?? '', sourceFile, projectRoot));
    // **A checkout of a library holds the library, and its own tests import it by name.** `from flask import redirect`
    // in `examples/tutorial/flaskr/auth.py` names the *installed* flask, so a resolver anchored at the importing file
    // looked for `<root>/flask/__init__.py` and found nothing: measured on `pallets/flask` 3.0.3, every import from
    // an example or a test into the library resolved to zero files, which is most of the repository. The source roots
    // below are where a package lives when it is not installed - `src` by the src-layout convention, `lib` and
    // `python` by long habit - and trying them costs one stat per missing candidate.
    for (const layout of ['src', 'lib', 'python']) {
      const candidate = join(projectRoot, layout);
      if (!bases.includes(candidate)) bases.push(candidate);
    }
  }

  const relative = segments.join(sep);
  for (const base of bases) {
    for (const candidate of moduleCandidates(base, relative)) {
      if (existsSync(candidate)) return candidate;
    }
  }

  // **Then the roots the project's own layout declares, which is what an absolute import means in a program that is
  // not the library.** The bases above are the importer's package, the repository root, and the `src`/`lib`/`python`
  // conventions - none of which is where `examples/tutorial/flaskr` lives. A relative import is already anchored at
  // its own package, so this arm is only for an absolute one.
  if (dots === 0) {
    for (const root of rootsFor(roots, segments[0] ?? '')) {
      for (const candidate of moduleCandidates(root, relative)) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/**
 * The files a dotted module can be, under one root.
 *
 * **A module is a file or a package**, so both shapes are candidates: `flask.helpers` is `helpers.py`, and
 * `flask.json` is `json/__init__.py`. Shared by the anchoring bases and the declared roots because the question is
 * the same one asked of a different directory.
 */
function moduleCandidates(base: string, relative: string): string[] {
  return relative.length === 0
    ? [join(base, '__init__.py')]
    : [join(base, `${relative}.py`), join(base, relative, '__init__.py')];
}

export function resolveImportPath(
  importPath: string,
  sourceFilePath: string,
  projectRoot: string,
  roots?: PackageRoots,
): string | null {
  // **Python's module syntax, which the branches below cannot read.** `from .helpers import x` is a dotted *module*
  // name and not a path, so `resolve(sourceDir, '.helpers')` produced `.../flask/.helpers` and found nothing; and
  // `from flask.helpers import x` was looked up in `node_modules`. **The result was an import graph of exactly zero
  // edges for every Python repository** - `crossFileDeps: 0` on `pallets/flask`, measured - while the TS/JS corpus the
  // resolver was written for worked. **A language whose imports cannot be resolved is a language whose callers cannot
  // be found**, which is the whole of story 3.
  if (sourceFilePath.endsWith('.py') && PYTHON_MODULE_SPECIFIER.test(importPath)) {
    const resolved = resolvePythonModule(importPath, sourceFilePath, projectRoot, roots);
    if (resolved) return resolved;
  }

  // **Java's imports are package paths too**, and they were looked up in `node_modules` like a JavaScript package:
  // `import org.springframework.samples.petclinic.model.Owner;` resolved to nothing, so **a Spring application had an
  // import graph of exactly zero edges** - measured on `spring-projects/spring-petclinic`, 50 Java files, 0 edges.
  if (
    (sourceFilePath.endsWith('.java') || sourceFilePath.endsWith('.kt')) &&
    JAVA_TYPE_SPECIFIER.test(importPath)
  ) {
    const resolved = resolveJavaType(
      importPath,
      sourceFilePath,
      projectRoot,
      sourceFilePath.endsWith('.kt') ? ['.kt', '.java'] : ['.java'],
    );
    if (resolved) return resolved;
  }

  // Relative import
  if (importPath.startsWith('.')) {
    const sourceDir = dirname(sourceFilePath);
    const resolved = resolve(sourceDir, importPath);

    // **The TypeScript convention, which this function did not know.** Source in a TS project writes
    // `import { x } from './math.js'` and **the file on disk is `math.ts`** - the `.js` is what the *emitted* file
    // will be called. **A resolver that only appends extensions to the specifier therefore fails on every relative
    // import in the corpus**, which is why `IMPORTS` edges were zero on every run and `importers_of` had nothing to
    // return. **Rewriting the emitted extension back to its source form comes first**, because it is the common case
    // in this project and in every TS project with `moduleResolution: node16`.
    const rewritten: string[] = [];
    for (const [from, to] of [
      ['.js', '.ts'],
      ['.js', '.tsx'],
      ['.mjs', '.mts'],
      ['.cjs', '.cts'],
    ] as const) {
      if (resolved.endsWith(from)) rewritten.push(`${resolved.slice(0, -from.length)}${to}`);
    }

    // Then the plain candidates, for specifiers that already name a source file.
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.js'];
    for (const candidate of rewritten) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
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
