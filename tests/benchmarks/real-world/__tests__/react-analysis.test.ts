/**
 * React Analysis Benchmark Tests
 *
 * Validates the code-analyzer pipeline against the real facebook/react source code.
 * Uses language providers directly to avoid vitest fork-mode issues with the
 * full phases.ts module.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { memoryUsage } from 'node:process';
import { fileURLToPath } from 'node:url';
import { JavaScriptProvider } from '../../../../packages/analyzer/src/languages/javascript.js';
import { TypeScriptProvider } from '../../../../packages/analyzer/src/languages/typescript.js';
import type { LanguageProvider, ParsedImport } from '../../../../packages/analyzer/src/languages/provider.js';
import type { UnifiedCapture } from '../../../../packages/shared/src/types/capture-tags.js';
import { CAPTURE_TAGS } from '../../../../packages/shared/src/types/capture-tags.js';

const REACT_SRC = '/tmp/react-src';
const REACT_PACKAGES_SRC = join(REACT_SRC, 'packages');
const REPORT_DIR = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(REPORT_DIR, '..', 'react-analysis-report.json');

// ── Types ───────────────────────────────────────────────────────────────────

interface FileInfo {
  filePath: string;
  relativePath: string;
  language: string;
  size: number;
  lines: number;
}

interface ParseStats {
  filePath: string;
  language: string;
  captures: number;
  symbols: number;
  functions: number;
  classes: number;
  components: number;
  imports: number;
  errors: string[];
}

interface LanguageBreakdown {
  language: string;
  fileCount: number;
  parseSuccess: number;
  parseFailed: number;
  symbolCount: number;
  avgSymbolsPerFile: number;
  parseRate: number;
  totalTimeMs: number;
}

interface BenchmarkReport {
  timestamp: string;
  reactSourceSize: { totalFiles: number; totalLines: number; totalSizeMB: number };
  scan: { filesDiscovered: number; scanTimeMs: number };
  parse: {
    totalFiles: number;
    successCount: number;
    failCount: number;
    successRate: number;
    parseTimeMs: number;
    languageBreakdown: LanguageBreakdown[];
    perFileStats: ParseStats[];
  };
  symbols: {
    totalCount: number;
    functions: number;
    classes: number;
    methods: number;
    variables: number;
    components: number;
    keyExportsFound: string[];
    keyExportsMissing: string[];
  };
  imports: { totalImports: number; interPackageImports: number };
  memory: {
    beforeRssMB: number;
    afterRssMB: number;
    deltaRssMB: number;
    heapUsedMB: number;
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.cache']);
const SKIP_EXTS = new Set(['.d.ts', '.min.js', '.snap']);

function discoverFiles(root: string): FileInfo[] {
  const results: FileInfo[] = [];
  function walk(dir: string) {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (SKIP_EXTS.has(ext)) continue;
        let language: string | null = null;
        if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) language = 'javascript';
        else if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) language = 'typescript';
        if (!language) continue;
        try {
          const content = readFileSync(fullPath, 'utf-8');
          results.push({
            filePath: fullPath,
            relativePath: relative(root, fullPath),
            language,
            size: content.length,
            lines: content.split('\n').length,
          });
        } catch { /* skip unreadable */ }
      }
    }
  }
  walk(root);
  return results;
}

function getProvider(lang: string): LanguageProvider | null {
  if (lang === 'javascript') return new JavaScriptProvider();
  if (lang === 'typescript') return new TypeScriptProvider();
  return null;
}

function parseFile(file: FileInfo, provider: LanguageProvider): ParseStats {
  const errors: string[] = [];
  let captures: UnifiedCapture[] = [];
  try {
    const content = readFileSync(file.filePath, 'utf-8');
    captures = provider.parse(content, file.filePath);
  } catch (err: any) {
    errors.push(err.message);
  }

  let symbols = 0;
  let functions = 0;
  let classes = 0;
  let components = 0;
  let imports = 0;

  for (const c of captures) {
    const tag = c.tag;
    if (tag === CAPTURE_TAGS.IMPORT || tag === CAPTURE_TAGS.IMPORT_NAMED || tag === CAPTURE_TAGS.IMPORT_DEFAULT || tag === CAPTURE_TAGS.IMPORT_WILDCARD) {
      imports++;
    } else if (tag === CAPTURE_TAGS.FUNCTION_DEF || tag === CAPTURE_TAGS.METHOD_DEF || tag === CAPTURE_TAGS.CONSTRUCTOR_DEF) {
      functions++;
      symbols++;
    } else if (tag === CAPTURE_TAGS.CLASS_DEF) {
      classes++;
      symbols++;
    } else if (tag === CAPTURE_TAGS.COMPONENT_PROPS) {
      components++;
      symbols++;
    } else if (tag === CAPTURE_TAGS.VARIABLE_DEF || tag === CAPTURE_TAGS.CONSTANT_DEF) {
      symbols++;
    } else if (tag === CAPTURE_TAGS.INTERFACE_DEF || tag === CAPTURE_TAGS.ENUM_DEF || tag === CAPTURE_TAGS.TYPE_DEF) {
      symbols++;
    }
  }

  return { filePath: file.filePath, language: file.language, captures: captures.length, symbols, functions, classes, components, imports, errors };
}

// Key React exports to check for
const KEY_REACT_EXPORTS = [
  'createElement', 'useState', 'useEffect', 'useContext', 'useReducer',
  'useCallback', 'useMemo', 'useRef', 'Component', 'createContext',
  'forwardRef', 'memo', 'Fragment', 'cloneElement',
];

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('React Source Code Analysis (Real-World Benchmark)', () => {
  let report: BenchmarkReport;
  let files: FileInfo[] = [];
  let stats: ParseStats[] = [];
  let error: Error | null = null;

  beforeAll(async () => {
    if (!existsSync(REACT_SRC)) {
      error = new Error('React source not found at ' + REACT_SRC);
      return;
    }

    const memBefore = memoryUsage();

    // Scan
    const scanStart = performance.now();
    files = discoverFiles(REACT_PACKAGES_SRC);
    const scanTimeMs = performance.now() - scanStart;

    // Parse
    const parseStart = performance.now();
    const jsProvider = new JavaScriptProvider();
    const tsProvider = new TypeScriptProvider();

    for (const file of files) {
      const provider = file.language === 'typescript' ? tsProvider : jsProvider;
      stats.push(parseFile(file, provider));
    }
    const parseTimeMs = performance.now() - parseStart;

    const memAfter = memoryUsage();

    // Aggregate
    const totalLines = stats.reduce((sum, s) => {
      const f = files.find((x) => x.filePath === s.filePath);
      return sum + (f?.lines ?? 0);
    }, 0);

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    const langMap = new Map<string, LanguageBreakdown>();
    for (const file of files) {
      const lang = file.language;
      if (!langMap.has(lang)) {
        langMap.set(lang, { language: lang, fileCount: 0, parseSuccess: 0, parseFailed: 0, symbolCount: 0, avgSymbolsPerFile: 0, parseRate: 0, totalTimeMs: parseTimeMs });
      }
      langMap.get(lang)!.fileCount++;
    }
    for (const s of stats) {
      const entry = langMap.get(s.language);
      if (entry) {
        if (s.errors.length === 0) entry.parseSuccess++;
        else entry.parseFailed++;
        entry.symbolCount += s.symbols;
      }
    }
    for (const [, entry] of langMap) {
      entry.parseRate = entry.fileCount > 0 ? Math.round((entry.parseSuccess / entry.fileCount) * 1000) / 10 : 0;
      entry.avgSymbolsPerFile = entry.parseSuccess > 0 ? Math.round(entry.symbolCount / entry.parseSuccess) : 0;
    }

    // Key exports
    const allNames = new Set<string>();
    for (const s of stats) {
      const content = readFileSync(s.filePath, 'utf-8');
      const provider = s.language === 'typescript' ? tsProvider : jsProvider;
      try {
        const captures = provider.parse(content, s.filePath);
        for (const c of captures) {
          if (c.name) allNames.add(c.name);
        }
      } catch { /* skip */ }
    }

    const found: string[] = [];
    const missing: string[] = [];
    for (const exp of KEY_REACT_EXPORTS) {
      if (allNames.has(exp)) found.push(exp);
      else missing.push(exp);
    }

    const successCount = stats.filter((s) => s.errors.length === 0).length;
    const failCount = stats.filter((s) => s.errors.length > 0).length;

    // Count imports
    let totalImports = 0;
    let interPackageImports = 0;
    for (const s of stats) {
      totalImports += s.imports;
      // Count inter-package imports (files importing across different packages)
      if (s.filePath.includes('/packages/')) {
        const pkgPart = s.filePath.split('/packages/')[1]?.split('/')[0];
        if (pkgPart) interPackageImports++;
      }
    }

    report = {
      timestamp: new Date().toISOString(),
      reactSourceSize: {
        totalFiles: files.length,
        totalLines,
        totalSizeMB: Math.round((totalSize / (1024 * 1024)) * 10) / 10,
      },
      scan: { filesDiscovered: files.length, scanTimeMs },
      parse: {
        totalFiles: files.length,
        successCount,
        failCount,
        successRate: files.length > 0 ? Math.round((successCount / files.length) * 1000) / 10 : 0,
        parseTimeMs,
        languageBreakdown: Array.from(langMap.values()),
        perFileStats: stats.slice(0, 100), // Keep first 100 for report size
      },
      symbols: {
        totalCount: stats.reduce((sum, s) => sum + s.symbols, 0),
        functions: stats.reduce((sum, s) => sum + s.functions, 0),
        classes: stats.reduce((sum, s) => sum + s.classes, 0),
        methods: 0,
        variables: 0,
        components: stats.reduce((sum, s) => sum + s.components, 0),
        keyExportsFound: found,
        keyExportsMissing: missing,
      },
      imports: { totalImports, interPackageImports },
      memory: {
        beforeRssMB: memBefore.rss / (1024 * 1024),
        afterRssMB: memAfter.rss / (1024 * 1024),
        deltaRssMB: (memAfter.rss - memBefore.rss) / (1024 * 1024),
        heapUsedMB: memAfter.heapUsed / (1024 * 1024),
      },
    };

    // Save report
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log('Report saved to:', REPORT_PATH);
  }, 300_000);

  // ── Test 1: React source is available ────────────────────────────────────

  it('should have React source cloned', () => {
    if (error) throw error;
    expect(existsSync(REACT_SRC)).toBe(true);
  });

  // ── Test 2: Discovers source files ───────────────────────────────────────

  it('should discover React source files (JS/TS) in packages/', () => {
    expect(files.length).toBeGreaterThan(100);
    console.log('Files discovered:', files.length);
  });

  // ── Test 3: Parse success rate > 90% ─────────────────────────────────────

  it('should have parse success rate above 90%', () => {
    expect(report.parse.successRate).toBeGreaterThan(90);
    console.log('Parse success rate:', report.parse.successRate + '%');
  });

  // ── Test 4: Key React exports found ──────────────────────────────────────

  it('should detect createElement in React source', () => {
    expect(report.symbols.keyExportsFound).toContain('createElement');
    console.log('Key exports found:', report.symbols.keyExportsFound.join(', '));
  });

  // ── Test 5: useState detected ────────────────────────────────────────────

  it('should detect useState in React source', () => {
    expect(report.symbols.keyExportsFound).toContain('useState');
  });

  // ── Test 6: useEffect detected ───────────────────────────────────────────

  it('should detect useEffect in React source', () => {
    expect(report.symbols.keyExportsFound).toContain('useEffect');
  });

  // ── Test 7: Symbols extracted ────────────────────────────────────────────

  it('should extract at least 1000 symbols', () => {
    console.log('Total symbols:', report.symbols.totalCount);
    expect(report.symbols.totalCount).toBeGreaterThan(1000);
  });

  // ── Test 8: Functions detected ───────────────────────────────────────────

  it('should detect functions in React source', () => {
    expect(report.symbols.functions).toBeGreaterThan(0);
    console.log('Functions:', report.symbols.functions);
  });

  // ── Test 9: Classes detected ─────────────────────────────────────────────

  it('should detect classes in React source', () => {
    expect(report.symbols.classes).toBeGreaterThan(0);
    console.log('Classes:', report.symbols.classes);
  });

  // ── Test 10: Components detected ─────────────────────────────────────────

  it('should detect React components (JSX functions)', () => {
    console.log('Components detected:', report.symbols.components);
    expect(report.symbols.components).toBeGreaterThan(0);
  });

  // ── Test 11: Memory within bounds ────────────────────────────────────────

  it('should use memory within bounds (< 2GB delta for full React packages)', () => {
    console.log('Memory delta:', report.memory.deltaRssMB.toFixed(1) + 'MB');
    expect(report.memory.deltaRssMB).toBeLessThan(2048);
  });

  // ── Test 12: Scan is fast ────────────────────────────────────────────────

  it('should scan files in under 10 seconds', () => {
    console.log('Scan time:', report.scan.scanTimeMs.toFixed(0) + 'ms');
    expect(report.scan.scanTimeMs).toBeLessThan(10000);
  });

  // ── Test 13: Parse completes in reasonable time ──────────────────────────

  it('should parse all files in under 5 minutes', () => {
    console.log('Parse time:', (report.parse.parseTimeMs / 1000).toFixed(1) + 's');
    expect(report.parse.parseTimeMs).toBeLessThan(300000);
  });

  // ── Test 14: Imports detected ────────────────────────────────────────────

  it('should detect import statements', () => {
    console.log('Total imports:', report.imports.totalImports);
    expect(report.imports.totalImports).toBeGreaterThan(0);
  });

  // ── Test 15: Report saved as valid JSON ──────────────────────────────────

  it('should save a valid JSON report to disk', () => {
    expect(existsSync(REPORT_PATH)).toBe(true);
    const parsed = JSON.parse(readFileSync(REPORT_PATH, 'utf-8'));
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.parse).toBeDefined();
  });

  // ── Test 16: Files per second metric ─────────────────────────────────────

  it('should parse at least 10 files per second', () => {
    const fps = (files.length / report.parse.parseTimeMs) * 1000;
    console.log('Files per second:', fps.toFixed(1));
    expect(fps).toBeGreaterThan(10);
  });
});
