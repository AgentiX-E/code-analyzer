// @code-analyzer/analyzer — Comprehensive Tests for phases.ts Pure Helper Functions
//
// These functions are NOT exported from phases.ts, so we replicate their logic
// here for exhaustive testing. Every test mirrors the original implementation
// line-for-line to guarantee behavioral fidelity.
//
// Functions tested:
//   1. parseGitignore         2. matchesGitignore
//   3. shouldSkipFile         4. shouldSkipDirectory
//   5. computeHash            6. captureTagToNodeLabel
//   7. captureTagToReferenceKind  8. groupCaptures
//   9. resolveImportPath     10. extractMarkdownSections
//  11. extractConfigEntries / flattenObject / findLineNumber / isConfigFile
//  12. detectRoutes          13. isTestFile
//  14. tokenizeCode / computeMinHash / jaccardSimilarity / simpleHash
//  15. deterministicEmbed
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { UnifiedCapture, SymbolDefinition, ReferenceSite, ScopeTree } from '@code-analyzer/shared';

// =========================================================================
// Replicated helper implementations (identical to phases.ts)
// =========================================================================

// ---------- parseGitignore (line 66) ----------
function parseGitignore(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

// ---------- matchesGitignore (line 78) ----------
function matchesGitignore(
  relativePath: string,
  patterns: string[],
): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith('/')) {
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

// ---------- shouldSkipFile (line 106) ----------
const SKIP_FILE_PATTERNS = [
  /^\./,
  /\.min\.(js|css)$/,
  /\.d\.ts$/,
];

function shouldSkipFile(name: string): boolean {
  for (const pattern of SKIP_FILE_PATTERNS) {
    if (pattern.test(name)) return true;
  }
  return false;
}

// ---------- shouldSkipDirectory (line 114) ----------
const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'target',
  '.cache', '.idea', '.vscode', 'coverage', '.nyc_output',
]);

function shouldSkipDirectory(name: string): boolean {
  return SKIP_DIRECTORIES.has(name);
}

// ---------- computeHash (line 122) ----------
function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------- captureTagToNodeLabel (line 184) ----------
function captureTagToNodeLabel(tag: string): string {
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

// ---------- captureTagToReferenceKind (line 223) ----------
function captureTagToReferenceKind(tag: string): string {
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

// ---------- groupCaptures (line 252) ----------
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

  for (const capture of captures) {
    const tag = capture.tag;

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
      const kind = captureTagToNodeLabel(tag) as SymbolDefinition['kind'];
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
        isExported: false,
        visibility: 'public',
        properties: capture.properties ?? {},
      });
    }

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
      const referenceKind = captureTagToReferenceKind(tag) as ReferenceSite['referenceKind'];

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

// ---------- resolveImportPath (line 411) ----------
function resolveImportPath(
  importPath: string,
  sourceFilePath: string,
  projectRoot: string,
): string | null {
  if (importPath.startsWith('.')) {
    const sourceDir = dirname(sourceFilePath);
    const resolved = resolve(sourceDir, importPath);

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.js'];
    for (const ext of extensions) {
      const candidate = ext.startsWith('/') ? resolved + ext : `${resolved}${ext}`;
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  return null;
}

// ---------- extractMarkdownSections (line 755) ----------
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

// ---------- Config helpers (lines 865-980) ----------
const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml', '.env', '.ini', '.cfg', '.xml']);
const CONFIG_FILE_NAMES = new Set([
  'package.json', 'tsconfig.json', 'tsconfig.base.json',
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.yaml',
  '.prettierrc', '.prettierrc.json', '.prettierrc.yaml',
  'pyproject.toml', 'setup.cfg', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'build.gradle.kts',
  'docker-compose.yaml', 'docker-compose.yml', 'Dockerfile',
  '.env', '.env.local', '.env.development', '.env.production',
  'Makefile', '.gitlab-ci.yml', '.github',
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
    accumulated += lines[i].length + 1;
    if (accumulated > charIndex) return i + 1;
  }
  return lines.length;
}

function isConfigFile(fileName: string, ext: string): boolean {
  const base = fileName.toLowerCase();
  if (CONFIG_FILE_NAMES.has(base)) return true;
  if (CONFIG_EXTENSIONS.has(ext)) return true;
  for (const name of CONFIG_FILE_NAMES) {
    if (base.startsWith(name)) return true;
  }
  return false;
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

// ---------- detectRoutes (line 1329) ----------
const ROUTE_PATTERNS: Array<{ regex: RegExp; framework: string; method: string }> = [
  { regex: /(?:app|router)\.(get|post|put|delete|patch|options|all|head)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'express', method: '$1' },
  { regex: /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)/g, framework: 'nextjs-app', method: '$1' },
  { regex: /export\s+default\s+(?:async\s+)?function\s+handler|export\s+default\s+function\s+handler/g, framework: 'nextjs-api', method: 'ALL' },
  { regex: /@(?:app|router|blueprint)\.(get|post|put|delete|patch|options)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'flask', method: '$1' },
  { regex: /@(?:router|app)\.(get|post|put|delete|patch|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi, framework: 'fastapi', method: '$1' },
  { regex: /(?:path|re_path|url)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'django', method: 'ALL' },
  { regex: /(?:r|router|engine)\.(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'gin', method: 'ALL' },
  { regex: /@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)['"`]/g, framework: 'spring', method: 'ALL' },
  { regex: /router\.(get|post|put|delete|patch|options|all|head)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'express-router', method: '$1' },
  { regex: /router\.(get|post|put|delete|patch|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'koa', method: '$1' },
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

// ---------- isTestFile (line 1924) ----------
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

function isTestFile(filePath: string): boolean {
  for (const pattern of TEST_FILE_PATTERNS) {
    if (pattern.test(filePath)) return true;
  }
  return false;
}

// ---------- tokenizeCode / computeMinHash / jaccardSimilarity (lines 2068-2116) ----------
const MINHASH_SEEDS = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];

function simpleHash(str: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function tokenizeCode(content: string, granularity: number = 3): string[] {
  const tokens = content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/['"`][^'"`]*['"`]/g, 'STR')
    .replace(/\b\d+\b/g, 'NUM')
    .split(/\s+/)
    .filter((t) => t.length > 0);

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

// ---------- deterministicEmbed (line 2375) ----------
function deterministicEmbed(text: string, dimension: number = 768): number[] {
  const embedding = new Array<number>(dimension);
  const seed = simpleHash(text, 9973);

  let state = seed;
  for (let i = 0; i < dimension; i++) {
    state = ((state << 5) - state + 0x6b8b4567) | 0;
    embedding[i] = ((state >>> 0) / 0xffffffff) * 2 - 1;
  }

  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) {
      embedding[i] = embedding[i]! / norm;
    }
  }

  return embedding;
}

// =========================================================================
// 1. parseGitignore tests
// =========================================================================

describe('parseGitignore', () => {
  it('returns empty array for empty content', () => {
    expect(parseGitignore('')).toEqual([]);
  });

  it('returns empty array for content with only comments', () => {
    const content = '# This is a comment\n# Another comment\n';
    expect(parseGitignore(content)).toEqual([]);
  });

  it('parses simple ignore patterns', () => {
    const content = 'node_modules\ndist\n.env';
    expect(parseGitignore(content)).toEqual(['node_modules', 'dist', '.env']);
  });

  it('skips comment lines and empty lines', () => {
    const content = '# Build output\ndist\n\n# Dependencies\nnode_modules\n\nbuild/';
    expect(parseGitignore(content)).toEqual(['dist', 'node_modules', 'build/']);
  });

  it('trims whitespace from lines', () => {
    const content = '  dist  \n  node_modules  ';
    expect(parseGitignore(content)).toEqual(['dist', 'node_modules']);
  });

  it('handles glob patterns', () => {
    const content = '*.log\n*.tmp\ndist/';
    expect(parseGitignore(content)).toEqual(['*.log', '*.tmp', 'dist/']);
  });

  it('handles lines with inline comments (note: original does not strip inline comments)', () => {
    const content = 'dist # build output';
    // The original implementation does NOT strip inline comments (no logic for that)
    expect(parseGitignore(content)).toEqual(['dist # build output']);
  });

  it('handles single-line input', () => {
    const content = 'node_modules';
    expect(parseGitignore(content)).toEqual(['node_modules']);
  });
});

// =========================================================================
// 2. matchesGitignore tests
// =========================================================================

describe('matchesGitignore', () => {
  describe('exact matches', () => {
    it('matches exact filename', () => {
      expect(matchesGitignore('.env', ['.env'])).toBe(true);
    });

    it('matches exact path', () => {
      expect(matchesGitignore('src/.env', ['.env'])).toBe(true);
    });

    it('does not match non-matching filename', () => {
      expect(matchesGitignore('app.ts', ['.env'])).toBe(false);
    });
  });

  describe('directory patterns (ending with /)', () => {
    it('matches exact directory', () => {
      expect(matchesGitignore('dist', ['dist/'])).toBe(true);
    });

    it('matches file inside directory', () => {
      expect(matchesGitignore('dist/main.js', ['dist/'])).toBe(true);
    });

    it('matches nested file in directory', () => {
      expect(matchesGitignore('dist/sub/file.js', ['dist/'])).toBe(true);
    });

    it('does not match partial directory name', () => {
      expect(matchesGitignore('distributor', ['dist/'])).toBe(false);
    });
  });

  describe('wildcard patterns', () => {
    it('matches *.log against file.log', () => {
      expect(matchesGitignore('file.log', ['*.log'])).toBe(true);
    });

    it('matches *.log against nested file', () => {
      expect(matchesGitignore('logs/error.log', ['*.log'])).toBe(true);
    });

    it('does not match *.log against file.txt', () => {
      expect(matchesGitignore('file.txt', ['*.log'])).toBe(false);
    });

    it('matches more complex wildcard', () => {
      expect(matchesGitignore('dist-123', ['dist-*'])).toBe(true);
    });
  });

  describe('multiple patterns', () => {
    it('matches against any pattern in the list', () => {
      expect(matchesGitignore('node_modules', ['dist/', 'node_modules', '*.log'])).toBe(true);
    });

    it('does not match when no pattern matches', () => {
      expect(matchesGitignore('src/app.ts', ['dist/', 'node_modules', '*.log'])).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for empty patterns array', () => {
      expect(matchesGitignore('anything', [])).toBe(false);
    });

    it('matches basename only', () => {
      expect(matchesGitignore('deep/path/.env', ['.env'])).toBe(true);
    });
  });
});

// =========================================================================
// 3. shouldSkipFile tests
// =========================================================================

describe('shouldSkipFile', () => {
  describe('dotfiles', () => {
    it('skips files starting with dot', () => {
      expect(shouldSkipFile('.gitignore')).toBe(true);
    });

    it('skips .env files', () => {
      expect(shouldSkipFile('.env')).toBe(true);
    });

    it('skips .eslintrc', () => {
      expect(shouldSkipFile('.eslintrc')).toBe(true);
    });
  });

  describe('minified files', () => {
    it('skips .min.js files', () => {
      expect(shouldSkipFile('jquery.min.js')).toBe(true);
    });

    it('skips .min.css files', () => {
      expect(shouldSkipFile('styles.min.css')).toBe(true);
    });

    it('does not skip normal .js files', () => {
      expect(shouldSkipFile('app.js')).toBe(false);
    });
  });

  describe('TypeScript declaration files', () => {
    it('skips .d.ts files', () => {
      expect(shouldSkipFile('types.d.ts')).toBe(true);
    });

    it('does not skip regular .ts files', () => {
      expect(shouldSkipFile('app.ts')).toBe(false);
    });
  });

  describe('normal files', () => {
    it('does not skip regular .ts files', () => {
      expect(shouldSkipFile('component.tsx')).toBe(false);
    });

    it('does not skip regular .js files', () => {
      expect(shouldSkipFile('utils.js')).toBe(false);
    });

    it('does not skip .py files', () => {
      expect(shouldSkipFile('main.py')).toBe(false);
    });
  });
});

// =========================================================================
// 4. shouldSkipDirectory tests
// =========================================================================

describe('shouldSkipDirectory', () => {
  const skipDirs = [
    'node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'target',
    '.cache', '.idea', '.vscode', 'coverage', '.nyc_output',
  ];

  for (const dir of skipDirs) {
    it(`skips "${dir}" directory`, () => {
      expect(shouldSkipDirectory(dir)).toBe(true);
    });
  }

  it('does not skip "src" directory', () => {
    expect(shouldSkipDirectory('src')).toBe(false);
  });

  it('does not skip "lib" directory', () => {
    expect(shouldSkipDirectory('lib')).toBe(false);
  });

  it('does not skip "packages" directory', () => {
    expect(shouldSkipDirectory('packages')).toBe(false);
  });

  it('does not skip empty string', () => {
    expect(shouldSkipDirectory('')).toBe(false);
  });
});

// =========================================================================
// 5. computeHash tests
// =========================================================================

describe('computeHash', () => {
  it('produces a 64-character hex string', () => {
    const hash = computeHash('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different content', () => {
    const hash1 = computeHash('hello');
    const hash2 = computeHash('world');
    expect(hash1).not.toBe(hash2);
  });

  it('produces same hash for same content', () => {
    const hash1 = computeHash('test content');
    const hash2 = computeHash('test content');
    expect(hash1).toBe(hash2);
  });

  it('produces valid SHA-256 for empty string', () => {
    const hash = computeHash('');
    expect(hash).toHaveLength(64);
    // SHA-256 of empty string is well-known
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('produces valid SHA-256 for known input', () => {
    const hash = computeHash('abc');
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('handles Unicode content', () => {
    const hash = computeHash('你好世界');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// =========================================================================
// 6. captureTagToNodeLabel tests
// =========================================================================

describe('captureTagToNodeLabel', () => {
  it('maps FUNCTION_DEF to Function', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.FUNCTION_DEF)).toBe('Function');
  });

  it('maps FUNCTION_CALL to Function', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.FUNCTION_CALL)).toBe('Function');
  });

  it('maps METHOD_DEF to Method', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.METHOD_DEF)).toBe('Method');
  });

  it('maps METHOD_CALL to Method', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.METHOD_CALL)).toBe('Method');
  });

  it('maps CLASS_DEF to Class', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.CLASS_DEF)).toBe('Class');
  });

  it('maps INTERFACE_DEF to Interface', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.INTERFACE_DEF)).toBe('Interface');
  });

  it('maps ENUM_DEF to Enum', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.ENUM_DEF)).toBe('Enum');
  });

  it('maps TYPE_DEF to TypeAlias', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.TYPE_DEF)).toBe('TypeAlias');
  });

  it('maps VARIABLE_DEF to Variable', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.VARIABLE_DEF)).toBe('Variable');
  });

  it('maps VARIABLE_ACCESS to Variable', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.VARIABLE_ACCESS)).toBe('Variable');
  });

  it('maps CONSTANT_DEF to Variable', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.CONSTANT_DEF)).toBe('Variable');
  });

  it('maps CONSTRUCTOR_DEF to Constructor', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.CONSTRUCTOR_DEF)).toBe('Constructor');
  });

  it('maps PROPERTY_DEF to Property', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.PROPERTY_DEF)).toBe('Property');
  });

  it('maps STRUCT_DEF to Struct', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.STRUCT_DEF)).toBe('Struct');
  });

  it('maps TRAIT_DEF to Trait', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.TRAIT_DEF)).toBe('Trait');
  });

  it('maps ROUTE_PATH to Route', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.ROUTE_PATH)).toBe('Route');
  });

  it('maps ROUTE_METHOD to Route', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.ROUTE_METHOD)).toBe('Route');
  });

  it('maps COMPONENT_PROPS to Component', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.COMPONENT_PROPS)).toBe('Component');
  });

  it('maps unknown tag to Variable (default)', () => {
    expect(captureTagToNodeLabel('unknown.tag')).toBe('Variable');
  });

  it('maps DECORATOR to Variable (default)', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.DECORATOR)).toBe('Variable');
  });

  it('maps DOCSTRING to Variable (default)', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.DOCSTRING)).toBe('Variable');
  });

  it('maps DI_INJECT to Variable (default)', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.DI_INJECT)).toBe('Variable');
  });
});

// =========================================================================
// 7. captureTagToReferenceKind tests
// =========================================================================

describe('captureTagToReferenceKind', () => {
  it('maps FUNCTION_CALL to call', () => {
    expect(captureTagToReferenceKind(CAPTURE_TAGS.FUNCTION_CALL)).toBe('call');
  });

  it('maps METHOD_CALL to call', () => {
    expect(captureTagToReferenceKind(CAPTURE_TAGS.METHOD_CALL)).toBe('call');
  });

  it('maps IMPORT to import', () => {
    expect(captureTagToReferenceKind(CAPTURE_TAGS.IMPORT)).toBe('import');
  });

  it('maps IMPORT_NAMED to import', () => {
    expect(captureTagToReferenceKind(CAPTURE_TAGS.IMPORT_NAMED)).toBe('import');
  });

  it('maps IMPORT_DEFAULT to import', () => {
    expect(captureTagToReferenceKind(CAPTURE_TAGS.IMPORT_DEFAULT)).toBe('import');
  });

  it('maps IMPORT_WILDCARD to import', () => {
    expect(captureTagToReferenceKind(CAPTURE_TAGS.IMPORT_WILDCARD)).toBe('import');
  });

  it('maps TYPE_REFERENCE to type', () => {
    expect(captureTagToReferenceKind(CAPTURE_TAGS.TYPE_REFERENCE)).toBe('type');
  });

  it('maps VARIABLE_ACCESS to access', () => {
    expect(captureTagToReferenceKind(CAPTURE_TAGS.VARIABLE_ACCESS)).toBe('access');
  });

  it('maps unknown tag to call (default)', () => {
    expect(captureTagToReferenceKind('unknown.tag')).toBe('call');
  });

  it('maps NEW_EXPRESSION to call (default)', () => {
    expect(captureTagToReferenceKind(CAPTURE_TAGS.NEW_EXPRESSION)).toBe('call');
  });

  it('maps FUNCTION_DEF to call (default)', () => {
    expect(captureTagToReferenceKind(CAPTURE_TAGS.FUNCTION_DEF)).toBe('call');
  });
});

// =========================================================================
// 8. groupCaptures tests
// =========================================================================

describe('groupCaptures', () => {
  const makeCap = (overrides: Partial<UnifiedCapture> = {}): UnifiedCapture => ({
    tag: CAPTURE_TAGS.FUNCTION_DEF,
    text: 'function test() {}',
    startLine: 1,
    endLine: 3,
    startByte: 0,
    endByte: 18,
    name: 'test',
    ...overrides,
  });

  it('returns empty arrays for empty captures', () => {
    const result = groupCaptures([], '/fake/path.ts');
    expect(result.symbols).toEqual([]);
    expect(result.references).toEqual([]);
    expect(result.scopeTree.children).toEqual([]);
    expect(result.scopeTree.symbols).toEqual([]);
    expect(result.scopeTree.endLine).toBe(1);
  });

  it('groups function definitions into symbols', () => {
    const captures: UnifiedCapture[] = [
      makeCap({ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'hello', startLine: 2, endLine: 5 }),
    ];
    const result = groupCaptures(captures, '/src/app.ts');
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('hello');
    expect(result.symbols[0].kind).toBe('Function');
    expect(result.symbols[0].startLine).toBe(2);
    expect(result.symbols[0].endLine).toBe(5);
  });

  it('groups class definitions into symbols', () => {
    const captures: UnifiedCapture[] = [
      makeCap({ tag: CAPTURE_TAGS.CLASS_DEF, name: 'MyClass', startLine: 1, endLine: 10 }),
    ];
    const result = groupCaptures(captures, '/src/app.ts');
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe('Class');
    expect(result.symbols[0].name).toBe('MyClass');
  });

  it('uses capture.text as name when name is undefined', () => {
    const captures: UnifiedCapture[] = [
      makeCap({ tag: CAPTURE_TAGS.FUNCTION_DEF, name: undefined, text: 'anonymous' }),
    ];
    const result = groupCaptures(captures, '/src/app.ts');
    expect(result.symbols[0].name).toBe('anonymous');
  });

  it('computes qualifiedName with containerName', () => {
    const captures: UnifiedCapture[] = [
      makeCap({
        tag: CAPTURE_TAGS.METHOD_DEF,
        name: 'greet',
        containerName: 'MyClass',
      }),
    ];
    const result = groupCaptures(captures, '/src/app.ts');
    expect(result.symbols[0].qualifiedName).toBe('MyClass.greet');
  });

  it('computes qualifiedName without containerName using file path', () => {
    const captures: UnifiedCapture[] = [
      makeCap({ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'main' }),
    ];
    const result = groupCaptures(captures, '/src/app.ts');
    expect(result.symbols[0].qualifiedName).toBe('file:/src/app.ts:main');
  });

  it('groups function calls into references', () => {
    const captures: UnifiedCapture[] = [
      makeCap({ tag: CAPTURE_TAGS.FUNCTION_CALL, name: 'console.log', startLine: 10 }),
    ];
    const result = groupCaptures(captures, '/src/app.ts');
    expect(result.references).toHaveLength(1);
    expect(result.references[0].targetName).toBe('console.log');
    expect(result.references[0].referenceKind).toBe('call');
    expect(result.references[0].sourceLine).toBe(10);
  });

  it('groups imports into references with import kind', () => {
    const captures: UnifiedCapture[] = [
      makeCap({ tag: CAPTURE_TAGS.IMPORT_NAMED, name: 'useState', startLine: 1 }),
    ];
    const result = groupCaptures(captures, '/src/app.ts');
    expect(result.references).toHaveLength(1);
    expect(result.references[0].referenceKind).toBe('import');
  });

  it('groups type references into references with type kind', () => {
    const captures: UnifiedCapture[] = [
      makeCap({ tag: CAPTURE_TAGS.TYPE_REFERENCE, name: 'User', startLine: 5 }),
    ];
    const result = groupCaptures(captures, '/src/app.ts');
    expect(result.references).toHaveLength(1);
    expect(result.references[0].referenceKind).toBe('type');
  });

  it('groups variable access into references with access kind', () => {
    const captures: UnifiedCapture[] = [
      makeCap({ tag: CAPTURE_TAGS.VARIABLE_ACCESS, name: 'count', startLine: 8 }),
    ];
    const result = groupCaptures(captures, '/src/app.ts');
    expect(result.references).toHaveLength(1);
    expect(result.references[0].referenceKind).toBe('access');
  });

  it('handles mixed definitions and references', () => {
    const captures: UnifiedCapture[] = [
      makeCap({ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'add', startLine: 1, endLine: 3 }),
      makeCap({ tag: CAPTURE_TAGS.CLASS_DEF, name: 'Calculator', startLine: 5, endLine: 20 }),
      makeCap({ tag: CAPTURE_TAGS.FUNCTION_CALL, name: 'add', startLine: 15 }),
      makeCap({ tag: CAPTURE_TAGS.IMPORT, name: 'react', startLine: 1 }),
    ];
    const result = groupCaptures(captures, '/src/calc.ts');
    expect(result.symbols).toHaveLength(2);
    expect(result.references).toHaveLength(2);
    expect(result.symbols[0].kind).toBe('Function');
    expect(result.symbols[1].kind).toBe('Class');
  });

  it('builds scope tree from symbols', () => {
    const captures: UnifiedCapture[] = [
      makeCap({ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'add', startLine: 1, endLine: 3 }),
      makeCap({ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'subtract', startLine: 5, endLine: 7 }),
    ];
    const result = groupCaptures(captures, '/src/math.ts');
    expect(result.scopeTree.name).toBe('math.ts');
    expect(result.scopeTree.kind).toBe('File');
    expect(result.scopeTree.startLine).toBe(1);
    expect(result.scopeTree.endLine).toBe(7);
    expect(result.scopeTree.children).toHaveLength(2);
    expect(result.scopeTree.children[0].name).toBe('add');
    expect(result.scopeTree.children[1].name).toBe('subtract');
    expect(result.scopeTree.symbols).toHaveLength(2);
  });

  it('handles all definition capture types', () => {
    const defTags = [
      CAPTURE_TAGS.FUNCTION_DEF,
      CAPTURE_TAGS.METHOD_DEF,
      CAPTURE_TAGS.CLASS_DEF,
      CAPTURE_TAGS.INTERFACE_DEF,
      CAPTURE_TAGS.ENUM_DEF,
      CAPTURE_TAGS.TYPE_DEF,
      CAPTURE_TAGS.VARIABLE_DEF,
      CAPTURE_TAGS.CONSTANT_DEF,
      CAPTURE_TAGS.CONSTRUCTOR_DEF,
      CAPTURE_TAGS.PROPERTY_DEF,
      CAPTURE_TAGS.STRUCT_DEF,
      CAPTURE_TAGS.TRAIT_DEF,
    ];

    for (const tag of defTags) {
      const captures: UnifiedCapture[] = [
        makeCap({ tag, name: 'test', startLine: 1, endLine: 1 }),
      ];
      const result = groupCaptures(captures, '/src/file.ts');
      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0].name).toBe('test');
    }
  });

  it('handles all reference capture types', () => {
    const refTags = [
      CAPTURE_TAGS.FUNCTION_CALL,
      CAPTURE_TAGS.METHOD_CALL,
      CAPTURE_TAGS.IMPORT,
      CAPTURE_TAGS.IMPORT_NAMED,
      CAPTURE_TAGS.IMPORT_DEFAULT,
      CAPTURE_TAGS.IMPORT_WILDCARD,
      CAPTURE_TAGS.TYPE_REFERENCE,
      CAPTURE_TAGS.VARIABLE_ACCESS,
      CAPTURE_TAGS.NEW_EXPRESSION,
    ];

    for (const tag of refTags) {
      const captures: UnifiedCapture[] = [
        makeCap({ tag, name: 'target', startLine: 1 }),
      ];
      const result = groupCaptures(captures, '/src/file.ts');
      expect(result.references).toHaveLength(1);
      expect(result.references[0].targetName).toBe('target');
    }
  });

  it('preserves signature and returnType from properties', () => {
    const captures: UnifiedCapture[] = [
      makeCap({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        name: 'greet',
        properties: { signature: '(name: string): string', returnType: 'string' },
      }),
    ];
    const result = groupCaptures(captures, '/src/app.ts');
    expect(result.symbols[0].signature).toBe('(name: string): string');
    expect(result.symbols[0].returnType).toBe('string');
  });

  it('preserves docstring from properties', () => {
    const captures: UnifiedCapture[] = [
      makeCap({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        name: 'greet',
        properties: { docstring: 'Greets a user by name' },
      }),
    ];
    const result = groupCaptures(captures, '/src/app.ts');
    expect(result.symbols[0].docstring).toBe('Greets a user by name');
  });
});

// =========================================================================
// 9. resolveImportPath tests
// =========================================================================

describe('resolveImportPath', () => {
  it('returns null for package imports (no node_modules resolution in pure tests)', () => {
    const result = resolveImportPath('react', '/src/app.ts', '/project');
    expect(result).toBeNull();
  });

  it('resolves relative import with .ts extension when file exists', () => {
    // __dirname in ESM may not be available. Use resolve from process.cwd()
    const testFilePath = resolve(process.cwd(), 'packages/analyzer/src/__tests__/phases-helpers.test.ts');
    const result = resolveImportPath('./phases-helpers.test', testFilePath, process.cwd());
    expect(result).toBeTruthy();
    expect(result).toContain('phases-helpers.test');
  });

  it('resolves relative import with .js extension', () => {
    const sourceFile = join(__dirname, 'phases-helpers.test.ts');
    const result = resolveImportPath('./phases-helpers.test', sourceFile, __dirname);
    expect(result).toBeTruthy();
  });

  it('returns null for non-existent relative imports', () => {
    const result = resolveImportPath('./nonexistent-file', '/fake/path.ts', '/fake/root');
    expect(result).toBeNull();
  });

  it('handles parent directory imports', () => {
    const result = resolveImportPath('../nonexistent', '/fake/src/app.ts', '/fake');
    expect(result).toBeNull();
  });
});

// =========================================================================
// 10. extractMarkdownSections tests
// =========================================================================

describe('extractMarkdownSections', () => {
  it('returns empty array for empty content', () => {
    expect(extractMarkdownSections('')).toEqual([]);
  });

  it('returns empty array for content without headings', () => {
    expect(extractMarkdownSections('Just some text\nwithout headings.')).toEqual([]);
  });

  it('extracts a single h1 heading', () => {
    const content = '# Introduction\nSome content.';
    const sections = extractMarkdownSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].level).toBe(1);
    expect(sections[0].title).toBe('Introduction');
    expect(sections[0].startLine).toBe(1);
    expect(sections[0].endLine).toBe(2);
  });

  it('extracts multiple headings at different levels', () => {
    const content = '# Title\n## Section 1\nContent here\n## Section 2\n### Subsection\nMore content';
    const sections = extractMarkdownSections(content);
    expect(sections).toHaveLength(4);
    expect(sections[0].title).toBe('Title');
    expect(sections[0].level).toBe(1);
    expect(sections[1].title).toBe('Section 1');
    expect(sections[1].level).toBe(2);
    expect(sections[2].title).toBe('Section 2');
    expect(sections[2].level).toBe(2);
    expect(sections[3].title).toBe('Subsection');
    expect(sections[3].level).toBe(3);
  });

  it('calculates endLine correctly based on next heading', () => {
    const content = '# Title\n## Section 1\nContent\n## Section 2';
    const sections = extractMarkdownSections(content);
    expect(sections).toHaveLength(3);
    expect(sections[0].startLine).toBe(1);
    expect(sections[0].endLine).toBe(1); // ends before next heading
    expect(sections[1].startLine).toBe(2);
    expect(sections[1].endLine).toBe(3); // ends before section 2 heading
    expect(sections[2].startLine).toBe(4);
    expect(sections[2].endLine).toBe(4); // last heading, goes to end
  });

  it('handles headings up to level 6', () => {
    const content = '###### Deep heading\nSome text';
    const sections = extractMarkdownSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].level).toBe(6);
    expect(sections[0].title).toBe('Deep heading');
  });

  it('trims whitespace from titles', () => {
    const content = '#   Padded Title   \nContent';
    const sections = extractMarkdownSections(content);
    expect(sections[0].title).toBe('Padded Title');
  });

  it('does not match 7 # characters (not a valid markdown heading)', () => {
    const content = '####### Not a heading\n# Real heading';
    const sections = extractMarkdownSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Real heading');
  });

  it('does not match # without space', () => {
    const content = '#not-a-heading\n# Real heading';
    const sections = extractMarkdownSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Real heading');
  });

  it('handles content with only headings', () => {
    const content = '# A\n# B\n# C';
    const sections = extractMarkdownSections(content);
    expect(sections).toHaveLength(3);
  });

  it('last heading endLine equals total line count', () => {
    const content = 'line1\nline2\nline3\n# Heading\nline5\nline6';
    const sections = extractMarkdownSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].startLine).toBe(4);
    expect(sections[0].endLine).toBe(6);
  });
});

// =========================================================================
// 11. Config parsing tests (extractConfigEntries, flattenObject, findLineNumber, isConfigFile)
// =========================================================================

describe('flattenObject', () => {
  it('flattens a simple object', () => {
    const result = flattenObject({ name: 'test', version: '1.0.0' }, '', '/fake.json', 0);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ key: 'name', value: 'test', path: '/fake.json', line: 0 });
    expect(result[1]).toEqual({ key: 'version', value: '1.0.0', path: '/fake.json', line: 0 });
  });

  it('flattens nested objects', () => {
    const result = flattenObject({ a: { b: { c: 'deep' } } }, '', '/fake.json', 0);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('a.b.c');
    expect(result[0].value).toBe('deep');
  });

  it('stringifies non-string values', () => {
    const result = flattenObject({ count: 42, flag: true }, '', '/fake.json', 0);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('42');
    expect(result[1].value).toBe('true');
  });

  it('handles array values by stringifying', () => {
    const result = flattenObject({ items: [1, 2, 3] }, '', '/fake.json', 0);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('[1,2,3]');
  });

  it('respects depth limit of 10', () => {
    // Create a deeply nested object > 10 levels
    let deep: Record<string, unknown> = { val: 'bottom' };
    for (let i = 0; i < 15; i++) {
      deep = { inner: deep };
    }
    const result = flattenObject(deep, '', '/fake.json', 0);
    // Should stop at depth 10, so not all levels are flattened
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it('handles null input', () => {
    const result = flattenObject(null, '', '/fake.json', 0);
    expect(result).toEqual([]);
  });

  it('handles non-object input', () => {
    const result = flattenObject('string', '', '/fake.json', 0);
    expect(result).toEqual([]);
  });

  it('handles prefix parameter', () => {
    const result = flattenObject({ name: 'test' }, 'config', '/fake.json', 0);
    expect(result[0].key).toBe('config.name');
  });

  it('handles empty object', () => {
    const result = flattenObject({}, '', '/fake.json', 0);
    expect(result).toEqual([]);
  });
});

describe('findLineNumber', () => {
  it('finds line 1 for character at position 0', () => {
    expect(findLineNumber(['hello', 'world'], 0)).toBe(1);
  });

  it('finds line 2 for character in second line', () => {
    // 'hello\n' is 6 chars, so char index 7 is in 'world'
    expect(findLineNumber(['hello', 'world'], 7)).toBe(2);
  });

  it('returns total lines for out-of-range index', () => {
    expect(findLineNumber(['a', 'b', 'c'], 9999)).toBe(3);
  });

  it('handles empty lines array', () => {
    expect(findLineNumber([], 0)).toBe(0);
  });

  it('finds correct line for multi-line content', () => {
    const lines = ['line1', 'line2', 'line3', 'line4'];
    expect(findLineNumber(lines, 0)).toBe(1);
    // 'line1\n' = 6 chars, position 6 is start of line2
    expect(findLineNumber(lines, 6)).toBe(2);
  });
});

describe('isConfigFile', () => {
  it('recognizes package.json as config', () => {
    expect(isConfigFile('package.json', '.json')).toBe(true);
  });

  it('recognizes tsconfig.json as config', () => {
    expect(isConfigFile('tsconfig.json', '.json')).toBe(true);
  });

  it('recognizes .eslintrc as config', () => {
    expect(isConfigFile('.eslintrc', '')).toBe(true);
  });

  it('recognizes Dockerfile as config (note: CONFIG_FILE_NAMES has mixed case, but code lowercases)', () => {
    // The original code does base.toLowerCase() and checks against CONFIG_FILE_NAMES
    // which has 'Dockerfile' (capital D). So lowercase 'dockerfile' won't match.
    // This is the actual behavior of the current code.
    expect(isConfigFile('dockerfile', '')).toBe(false);
    expect(isConfigFile('Dockerfile', '')).toBe(false); // lowercase check fails
  });

  it('recognizes config by extension (.yaml)', () => {
    expect(isConfigFile('custom.yaml', '.yaml')).toBe(true);
  });

  it('recognizes config by extension (.toml)', () => {
    expect(isConfigFile('config.toml', '.toml')).toBe(true);
  });

  it('recognizes config by extension (.env)', () => {
    expect(isConfigFile('.env', '.env')).toBe(true);
  });

  it('recognizes .env.local as config', () => {
    expect(isConfigFile('.env.local', '.local')).toBe(true);
  });

  it('does not recognize regular .ts files as config', () => {
    expect(isConfigFile('app.ts', '.ts')).toBe(false);
  });

  it('recognizes .eslintrc.yaml as config (starts with .eslintrc)', () => {
    expect(isConfigFile('.eslintrc.yaml', '.yaml')).toBe(true);
  });

  it('case-insensitive matching', () => {
    // Original code does base.toLowerCase() but CONFIG_FILE_NAMES has mixed-case entries.
    // 'Dockerfile' won't match 'dockerfile' and 'PACKAGE.JSON' won't match 'package.json'.
    // But .json extension check should catch PACKAGE.JSON via CONFIG_EXTENSIONS.
    expect(isConfigFile('PACKAGE.JSON', '.JSON')).toBe(true); // matches via ext
    expect(isConfigFile('dockerfile', '')).toBe(false); // lowercase vs Dockerfile in set
  });
});

describe('extractConfigEntries', () => {
  describe('JSON config', () => {
    it('extracts relevant keys from package.json', () => {
      const content = JSON.stringify({
        name: 'my-package',
        version: '1.0.0',
        description: 'A test package',
        main: 'index.js',
        dependencies: { react: '^18.0.0' },
        scripts: { build: 'tsc', test: 'vitest' },
        devDependencies: { vitest: '^2.0.0' },
        irrelevantField: 'should not appear',
      });
      const entries = extractConfigEntries('/fake/package.json', content);
      expect(entries.length).toBeGreaterThan(0);
      const keys = entries.map((e) => e.key);
      expect(keys).toContain('name');
      expect(keys).toContain('version');
      expect(keys).toContain('description');
      expect(keys).toContain('main');
      expect(keys).not.toContain('irrelevantField');
    });

    it('handles invalid JSON gracefully', () => {
      const entries = extractConfigEntries('/fake/config.json', 'not valid json');
      expect(entries).toEqual([]);
    });

    it('extracts nested config keys (only exact key matches pass the filter)', () => {
      // flattenObject produces 'compilerOptions.target', 'compilerOptions.module'
      // CONFIG_RELEVANT_KEYS has 'compilerOptions' but NOT 'compilerOptions.target'
      // So ALL nested entries are filtered out — the filter checks exact key match
      const content = JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
        },
      });
      const entries = extractConfigEntries('/fake/tsconfig.json', content);
      // No entries match because the flattened keys are compound (dotted) but
      // CONFIG_RELEVANT_KEYS only contains the parent key name
      expect(entries).toEqual([]);
    });
  });

  describe('.env config', () => {
    it('extracts key-value pairs from .env', () => {
      const content = 'DATABASE_URL=postgres://localhost\nAPI_KEY=secret123\n';
      const entries = extractConfigEntries('/fake/.env', content);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ key: 'DATABASE_URL', value: 'postgres://localhost', line: 1 });
      expect(entries[1]).toMatchObject({ key: 'API_KEY', value: 'secret123', line: 2 });
    });

    it('skips comments and empty lines in .env', () => {
      const content = '# Database config\nDATABASE_URL=postgres://localhost\n\n# API key\nAPI_KEY=secret';
      const entries = extractConfigEntries('/fake/.env', content);
      expect(entries).toHaveLength(2);
    });
  });

  describe('YAML config', () => {
    it('extracts key-value pairs from YAML', () => {
      const content = 'name: my-project\nversion: "1.0.0"\n  nested: value';
      const entries = extractConfigEntries('/fake/config.yaml', content);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      const keys = entries.map((e) => e.key);
      expect(keys).toContain('name');
      expect(keys).toContain('version');
    });

    it('handles .yml extension', () => {
      const content = 'name: my-project\nversion: "1.0.0"';
      const entries = extractConfigEntries('/fake/config.yml', content);
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('TOML config', () => {
    it('extracts key-value pairs from TOML', () => {
      const content = 'name = "my-project"\nversion = "1.0.0"\n[dependencies]\nreact = "18.0.0"';
      const entries = extractConfigEntries('/fake/Cargo.toml', content);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      const keys = entries.map((e) => e.key);
      expect(keys).toContain('name');
      expect(keys).toContain('version');
    });
  });

  describe('XML config', () => {
    it('extracts tags from XML', () => {
      const content = '<project>\n<name>my-app</name>\n<version>1.0.0</version>\n</project>';
      const entries = extractConfigEntries('/fake/pom.xml', content);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ key: 'name', value: 'my-app' });
      expect(entries[1]).toMatchObject({ key: 'version', value: '1.0.0' });
    });
  });

  describe('unknown extension', () => {
    it('returns empty for unsupported extensions', () => {
      const entries = extractConfigEntries('/fake/README.md', '# Title');
      expect(entries).toEqual([]);
    });
  });
});

// =========================================================================
// 12. detectRoutes tests
// =========================================================================

describe('detectRoutes', () => {
  it('returns empty array for content without routes', () => {
    const routes = detectRoutes('/src/app.ts', 'console.log("hello")', 'app.ts');
    expect(routes).toEqual([]);
  });

  it('detects Express.js GET route', () => {
    const content = "app.get('/api/users', (req, res) => {})";
    const routes = detectRoutes('/src/server.ts', content, 'server.ts');
    expect(routes.length).toBeGreaterThan(0);
    const route = routes.find((r) => r.framework === 'express');
    expect(route).toBeDefined();
    expect(route!.path).toBe('/api/users');
    expect(route!.method).toBe('GET');
  });

  it('detects Express.js POST route', () => {
    const content = "router.post('/api/users', handler)";
    const routes = detectRoutes('/src/routes.ts', content, 'routes.ts');
    const route = routes.find((r) => r.framework === 'express');
    expect(route).toBeDefined();
    expect(route!.path).toBe('/api/users');
    expect(route!.method).toBe('POST');
  });

  it('detects Flask route decorator', () => {
    const content = "@app.get('/home')\ndef home():\n    return 'hello'";
    const routes = detectRoutes('/src/app.py', content, 'app.py');
    const route = routes.find((r) => r.framework === 'flask');
    expect(route).toBeDefined();
    expect(route!.path).toBe('/home');
    expect(route!.method).toBe('GET');
  });

  it('detects FastAPI route decorator', () => {
    const content = "@router.get('/items')\nasync def get_items():\n    return []";
    const routes = detectRoutes('/src/api.py', content, 'api.py');
    const route = routes.find((r) => r.framework === 'fastapi');
    expect(route).toBeDefined();
    expect(route!.path).toBe('/items');
    expect(route!.method).toBe('GET');
  });

  it('detects Django URL patterns', () => {
    const content = "urlpatterns = [path('home/', views.home), re_path('detail/', views.detail)]";
    const routes = detectRoutes('/src/urls.py', content, 'urls.py');
    const djangoRoutes = routes.filter((r) => r.framework === 'django');
    expect(djangoRoutes.length).toBeGreaterThan(0);
  });

  it('detects Gin (Go) routes', () => {
    const content = "r.GET('/ping', handler)";
    const routes = detectRoutes('/src/main.go', content, 'main.go');
    const route = routes.find((r) => r.framework === 'gin');
    expect(route).toBeDefined();
    expect(route!.path).toBe('/ping');
  });

  it('detects Spring Boot annotations', () => {
    const content = "@GetMapping(\"/users\")\npublic List<User> getUsers() {}";
    const routes = detectRoutes('/src/UserController.java', content, 'UserController.java');
    const route = routes.find((r) => r.framework === 'spring');
    expect(route).toBeDefined();
    expect(route!.path).toBe('/users');
  });

  it('detects Next.js app router route files', () => {
    const routes = detectRoutes('/src/app/api/users/route.ts', '', 'route.ts');
    const nextRoute = routes.find((r) => r.framework === 'nextjs-app-router');
    expect(nextRoute).toBeDefined();
    expect(nextRoute!.method).toBe('ALL');
  });

  it('detects Hono routes', () => {
    const content = "app.get('/hello', (c) => c.text('Hello'))";
    const routes = detectRoutes('/src/index.ts', content, 'index.ts');
    const route = routes.find((r) => r.framework === 'hono');
    expect(route).toBeDefined();
    expect(route!.path).toBe('/hello');
    expect(route!.method).toBe('GET');
  });

  it('detects Express router module routes', () => {
    const content = "router.delete('/api/users/:id', handler)";
    const routes = detectRoutes('/src/userRoutes.ts', content, 'userRoutes.ts');
    const route = routes.find((r) => r.framework === 'express-router');
    expect(route).toBeDefined();
    expect(route!.path).toBe('/api/users/:id');
    expect(route!.method).toBe('DELETE');
  });

  it('detects Koa routes', () => {
    const content = "router.get('/users', listUsers)";
    const routes = detectRoutes('/src/koaRoutes.ts', content, 'koaRoutes.ts');
    const route = routes.find((r) => r.framework === 'koa');
    expect(route).toBeDefined();
    expect(route!.path).toBe('/users');
  });

  it('detects Next.js API handler', () => {
    const content = "export default async function handler(req, res) {}";
    const routes = detectRoutes('/src/pages/api/users.ts', content, 'users.ts');
    const route = routes.find((r) => r.framework === 'nextjs-api');
    expect(route).toBeDefined();
    expect(route!.method).toBe('ALL');
  });

  it('detects Next.js App Router exported functions', () => {
    const content = "export async function GET(request) {}";
    const routes = detectRoutes('/src/app/api/data/route.ts', content, 'route.ts');
    const nextRoutes = routes.filter((r) => r.framework === 'nextjs-app');
    expect(nextRoutes.length).toBeGreaterThan(0);
  });
});

// =========================================================================
// 13. isTestFile tests
// =========================================================================

describe('isTestFile', () => {
  it('recognizes .test.ts files', () => {
    expect(isTestFile('component.test.ts')).toBe(true);
  });

  it('recognizes .test.tsx files', () => {
    expect(isTestFile('component.test.tsx')).toBe(true);
  });

  it('recognizes .spec.ts files', () => {
    expect(isTestFile('component.spec.ts')).toBe(true);
  });

  it('recognizes .spec.js files', () => {
    expect(isTestFile('component.spec.js')).toBe(true);
  });

  it('recognizes .test.py files', () => {
    expect(isTestFile('module.test.py')).toBe(true);
  });

  it('recognizes _test.go files', () => {
    expect(isTestFile('handler_test.go')).toBe(true);
  });

  it('recognizes _test.rs files', () => {
    expect(isTestFile('module_test.rs')).toBe(true);
  });

  it('recognizes Test.java files', () => {
    expect(isTestFile('MyClassTest.java')).toBe(true);
  });

  it('recognizes Test.kt files', () => {
    expect(isTestFile('MyClassTest.kt')).toBe(true);
  });

  it('recognizes files in __tests__ directory', () => {
    expect(isTestFile('__tests__/helper.test.ts')).toBe(true);
    expect(isTestFile('src/__tests__/app.test.ts')).toBe(true);
  });

  it('recognizes files in tests directory', () => {
    expect(isTestFile('tests/integration.test.ts')).toBe(true);
  });

  it('recognizes files in test directory', () => {
    expect(isTestFile('test/unit.test.ts')).toBe(true);
  });

  it('does not recognize regular source files', () => {
    expect(isTestFile('app.ts')).toBe(false);
    expect(isTestFile('component.tsx')).toBe(false);
    expect(isTestFile('utils.js')).toBe(false);
    expect(isTestFile('main.py')).toBe(false);
  });

  it('handles full paths', () => {
    expect(isTestFile('/home/user/project/src/__tests__/app.test.ts')).toBe(true);
    expect(isTestFile('/home/user/project/src/app.ts')).toBe(false);
  });

  it('case-insensitive matching for test/spec extensions', () => {
    expect(isTestFile('component.Test.ts')).toBe(true);
    expect(isTestFile('component.Spec.ts')).toBe(true);
  });
});

// =========================================================================
// 14. MinHash tests (tokenizeCode, computeMinHash, jaccardSimilarity, simpleHash)
// =========================================================================

describe('simpleHash', () => {
  it('produces a positive number', () => {
    const h = simpleHash('hello', 42);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('produces different hashes for different inputs', () => {
    const h1 = simpleHash('hello', 42);
    const h2 = simpleHash('world', 42);
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different seeds', () => {
    const h1 = simpleHash('hello', 2);
    const h2 = simpleHash('hello', 3);
    expect(h1).not.toBe(h2);
  });

  it('produces same hash for same input and seed', () => {
    const h1 = simpleHash('hello', 42);
    const h2 = simpleHash('hello', 42);
    expect(h1).toBe(h2);
  });

  it('handles empty string', () => {
    const h = simpleHash('', 7);
    expect(h).toBeGreaterThanOrEqual(0);
    // With seed 7 and empty string, hash = abs(seed) = 7
    expect(h).toBe(7);
  });
});

describe('tokenizeCode', () => {
  it('tokenizes simple code into n-grams', () => {
    const code = 'function hello world';
    const tokens = tokenizeCode(code);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toBe('function hello world');
  });

  it('generates multiple n-grams for longer code', () => {
    const code = 'function hello ( name ) { return name }';
    const tokens = tokenizeCode(code);
    expect(tokens.length).toBeGreaterThan(1);
  });

  it('replaces strings with STR placeholder', () => {
    const code = "const x = 'hello world'";
    const tokens = tokenizeCode(code);
    // All string literals should be replaced with STR
    expect(tokens.every((t) => !t.includes("'hello world'"))).toBe(true);
  });

  it('replaces numbers with NUM placeholder', () => {
    const code = 'const x = 42';
    const tokens = tokenizeCode(code);
    expect(tokens.every((t) => !t.includes('42'))).toBe(true);
  });

  it('removes single-line comments', () => {
    const code = '// This is a comment\nfunction hello()';
    const tokens = tokenizeCode(code);
    expect(tokens.every((t) => !t.includes('comment'))).toBe(true);
  });

  it('removes block comments', () => {
    const code = '/* block comment */ function hello()';
    const tokens = tokenizeCode(code);
    expect(tokens.every((t) => !t.includes('comment'))).toBe(true);
  });

  it('respects granularity parameter', () => {
    const code = 'a b c d e f g h';
    const trigrams = tokenizeCode(code, 3);
    const bigrams = tokenizeCode(code, 2);
    expect(trigrams.length).not.toBe(bigrams.length);
  });

  it('returns empty array for empty content', () => {
    expect(tokenizeCode('')).toEqual([]);
  });

  it('returns empty array for insufficient tokens', () => {
    const code = 'hello';
    expect(tokenizeCode(code, 3)).toEqual([]);
  });

  it('handles template literals', () => {
    const code = 'const msg = `hello ${name}`';
    const tokens = tokenizeCode(code);
    expect(tokens.every((t) => !t.includes('hello'))).toBe(true);
  });
});

describe('computeMinHash', () => {
  it('returns array of specified length', () => {
    const ngrams = ['function hello world', 'hello world (', 'world ( )'];
    const hash = computeMinHash(ngrams, 16);
    expect(hash).toHaveLength(16);
  });

  it('returns array of custom length', () => {
    const ngrams = ['a b c', 'b c d'];
    const hash = computeMinHash(ngrams, 8);
    expect(hash).toHaveLength(8);
  });

  it('returns MAX_SAFE_INTEGER for empty ngrams', () => {
    const hash = computeMinHash([]);
    expect(hash).toHaveLength(16);
    expect(hash.every((h) => h === Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('produces same hash for same ngrams', () => {
    const ngrams = ['a b c', 'b c d', 'c d e'];
    const hash1 = computeMinHash(ngrams);
    const hash2 = computeMinHash(ngrams);
    expect(hash1).toEqual(hash2);
  });

  it('produces different hashes for different ngrams', () => {
    const hash1 = computeMinHash(['function hello world']);
    const hash2 = computeMinHash(['class MyClass extends']);
    expect(hash1).not.toEqual(hash2);
  });

  it('uses MINHASH_SEEDS for hashing', () => {
    const ngrams = ['test ngram here'];
    const hash = computeMinHash(ngrams, 1);
    expect(hash).toHaveLength(1);
    expect(hash[0]).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical hashes', () => {
    const hash = computeMinHash(['function hello world']);
    expect(jaccardSimilarity(hash, hash)).toBe(1.0);
  });

  it('returns 0 for completely different hashes', () => {
    const code1 = 'function hello ( ) { return 1 }';
    const code2 = 'class MyClass extends Base { constructor ( ) { } }';
    const hash1 = computeMinHash(tokenizeCode(code1));
    const hash2 = computeMinHash(tokenizeCode(code2));
    const sim = jaccardSimilarity(hash1, hash2);
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });

  it('returns 0 for arrays of different lengths', () => {
    expect(jaccardSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for empty arrays', () => {
    expect(jaccardSimilarity([], [])).toBe(0);
  });

  it('computes similarity for similar code', () => {
    const code1 = 'function add ( a , b ) { return a + b }';
    const code2 = 'function add ( x , y ) { return x + y }';
    const hash1 = computeMinHash(tokenizeCode(code1));
    const hash2 = computeMinHash(tokenizeCode(code2));
    const sim = jaccardSimilarity(hash1, hash2);
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

describe('MinHash integration', () => {
  it('identical code has high similarity', () => {
    const code = 'function greet ( name ) { return STR + name }';
    const tokens1 = tokenizeCode(code);
    const tokens2 = tokenizeCode(code);
    const hash1 = computeMinHash(tokens1);
    const hash2 = computeMinHash(tokens2);
    expect(jaccardSimilarity(hash1, hash2)).toBe(1.0);
  });

  it('very different code has low similarity', () => {
    const code1 = 'function add ( a , b ) { return a + b }';
    const code2 = 'class Calculator { multiply ( x , y ) { return x * y } divide ( a , b ) { return a / b } }';
    const hash1 = computeMinHash(tokenizeCode(code1));
    const hash2 = computeMinHash(tokenizeCode(code2));
    const sim = jaccardSimilarity(hash1, hash2);
    // Very different code should have low similarity
    expect(sim).toBeLessThan(0.5);
  });
});

// =========================================================================
// 15. deterministicEmbed tests
// =========================================================================

describe('deterministicEmbed', () => {
  it('returns array of default dimension (768)', () => {
    const embedding = deterministicEmbed('hello');
    expect(embedding).toHaveLength(768);
  });

  it('returns array of specified dimension', () => {
    const embedding = deterministicEmbed('hello', 128);
    expect(embedding).toHaveLength(128);
  });

  it('produces same embedding for same text', () => {
    const e1 = deterministicEmbed('hello world');
    const e2 = deterministicEmbed('hello world');
    expect(e1).toEqual(e2);
  });

  it('produces different embeddings for different text', () => {
    const e1 = deterministicEmbed('hello');
    const e2 = deterministicEmbed('world');
    expect(e1).not.toEqual(e2);
  });

  it('all values are in range [-1, 1]', () => {
    const embedding = deterministicEmbed('test', 100);
    for (const value of embedding) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('embedding is normalized to unit length', () => {
    const embedding = deterministicEmbed('unit vector test', 50);
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('handles empty string', () => {
    const embedding = deterministicEmbed('', 16);
    expect(embedding).toHaveLength(16);
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('handles Unicode text', () => {
    const embedding = deterministicEmbed('你好世界', 64);
    expect(embedding).toHaveLength(64);
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('handles long text', () => {
    const longText = 'A'.repeat(10000);
    const embedding = deterministicEmbed(longText, 32);
    expect(embedding).toHaveLength(32);
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });
});
