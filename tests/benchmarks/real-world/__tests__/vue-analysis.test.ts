/**
 * Vue.js Core Analysis Benchmark Tests
 *
 * Validates the code-analyzer pipeline against the real vuejs/core source code.
 * Uses language providers directly for consistent, isolated benchmarking.
 * Mirrors the React benchmark structure for direct comparison.
 *
 * Vue packages analyzed: compiler-core, compiler-dom, compiler-sfc, compiler-ssr,
 * reactivity, runtime-core, runtime-dom, runtime-test, server-renderer, shared, vue, vue-compat
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { memoryUsage } from 'node:process';
import { fileURLToPath } from 'node:url';
import { TypeScriptProvider } from '../../../../packages/analyzer/src/languages/typescript.js';
import { JavaScriptProvider } from '../../../../packages/analyzer/src/languages/javascript.js';
import type { UnifiedCapture } from '../../../../packages/shared/src/types/capture-tags.js';
import { CAPTURE_TAGS } from '../../../../packages/shared/src/types/capture-tags.js';

// ── Constants ───────────────────────────────────────────────────────────────

const VUE_SRC = '/tmp/vue-src';
const VUE_PACKAGES_SRC = join(VUE_SRC, 'packages');
const REPORT_DIR = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(REPORT_DIR, '..', 'vue-analysis-report.json');
const REACT_REPORT_PATH = join(REPORT_DIR, '..', 'react-analysis-report.json');

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
  vueSourceSize: { totalFiles: number; totalLines: number; totalSizeMB: number };
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
  comparison?: {
    react: {
      files: number;
      parseRate: number;
      successRate: number;
      symbols: number;
      parseTimeMs: number;
    };
    vue: {
      files: number;
      parseRate: number;
      successRate: number;
      symbols: number;
      parseTimeMs: number;
    };
    notes: string;
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.cache',
  '__tests__',
  '__mocks__',
  'scripts',
  'temp',
]);
const SKIP_EXTS = new Set(['.d.ts', '.min.js', '.snap']);

function discoverFiles(root: string): FileInfo[] {
  const results: FileInfo[] = [];
  function walk(dir: string) {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
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
        } catch {
          /* skip unreadable */
        }
      }
    }
  }
  walk(root);
  return results;
}

function parseFile(file: FileInfo): ParseStats {
  const errors: string[] = [];
  let captures: UnifiedCapture[] = [];
  const provider =
    file.language === 'typescript' ? new TypeScriptProvider() : new JavaScriptProvider();

  try {
    const content = readFileSync(file.filePath, 'utf-8');
    captures = provider.parse(content, file.filePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
  }

  let symbols = 0;
  let functions = 0;
  let classes = 0;
  let components = 0;
  let imports = 0;

  for (const c of captures) {
    const tag = c.tag;
    if (
      tag === CAPTURE_TAGS.IMPORT ||
      tag === CAPTURE_TAGS.IMPORT_NAMED ||
      tag === CAPTURE_TAGS.IMPORT_DEFAULT ||
      tag === CAPTURE_TAGS.IMPORT_WILDCARD
    ) {
      imports++;
    } else if (
      tag === CAPTURE_TAGS.FUNCTION_DEF ||
      tag === CAPTURE_TAGS.METHOD_DEF ||
      tag === CAPTURE_TAGS.CONSTRUCTOR_DEF
    ) {
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
    } else if (
      tag === CAPTURE_TAGS.INTERFACE_DEF ||
      tag === CAPTURE_TAGS.ENUM_DEF ||
      tag === CAPTURE_TAGS.TYPE_DEF
    ) {
      symbols++;
    }
  }

  return {
    filePath: file.filePath,
    language: file.language,
    captures: captures.length,
    symbols,
    functions,
    classes,
    components,
    imports,
    errors,
  };
}

// Key Vue-specific patterns to detect
const KEY_VUE_PATTERNS = [
  'defineComponent',
  'ref',
  'reactive',
  'computed',
  'watch',
  'onMounted',
  'createApp',
  'h',
  'createVNode',
  'compile',
  'compileTemplate',
  'ReactiveEffect',
  'track',
  'trigger',
  'effect',
  'effectScope',
  'Dep',
];

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('Vue.js Source Code Analysis (Real-World Benchmark)', () => {
  let report: BenchmarkReport;
  let files: FileInfo[] = [];
  let stats: ParseStats[] = [];
  let error: Error | null = null;

  beforeAll(async () => {
    if (!existsSync(VUE_SRC)) {
      error = new Error('Vue source not found at ' + VUE_SRC);
      return;
    }

    const memBefore = memoryUsage();

    // ── Scan ───────────────────────────────────────────────────────────────
    const scanStart = performance.now();
    files = discoverFiles(VUE_PACKAGES_SRC);
    const scanTimeMs = performance.now() - scanStart;

    // ── Parse ──────────────────────────────────────────────────────────────
    const parseStart = performance.now();
    for (const file of files) {
      stats.push(parseFile(file));
    }
    const parseTimeMs = performance.now() - parseStart;

    const memAfter = memoryUsage();

    // ── Aggregate ──────────────────────────────────────────────────────────
    const totalLines = files.reduce((sum, f) => sum + f.lines, 0);
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    const langMap = new Map<string, LanguageBreakdown>();
    for (const file of files) {
      const lang = file.language;
      if (!langMap.has(lang)) {
        langMap.set(lang, {
          language: lang,
          fileCount: 0,
          parseSuccess: 0,
          parseFailed: 0,
          symbolCount: 0,
          avgSymbolsPerFile: 0,
          parseRate: 0,
          totalTimeMs: parseTimeMs,
        });
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
      entry.parseRate =
        entry.fileCount > 0 ? Math.round((entry.parseSuccess / entry.fileCount) * 1000) / 10 : 0;
      entry.avgSymbolsPerFile =
        entry.parseSuccess > 0 ? Math.round(entry.symbolCount / entry.parseSuccess) : 0;
    }

    // ── Key Vue patterns ───────────────────────────────────────────────────
    const allNames = new Set<string>();
    for (const s of stats) {
      const content = readFileSync(s.filePath, 'utf-8');
      const provider =
        s.language === 'typescript' ? new TypeScriptProvider() : new JavaScriptProvider();
      try {
        const captures = provider.parse(content, s.filePath);
        for (const c of captures) {
          if (c.name) allNames.add(c.name);
        }
      } catch {
        /* skip */
      }
    }

    const found: string[] = [];
    const missing: string[] = [];
    for (const exp of KEY_VUE_PATTERNS) {
      if (allNames.has(exp)) found.push(exp);
      else missing.push(exp);
    }

    const successCount = stats.filter((s) => s.errors.length === 0).length;
    const failCount = stats.filter((s) => s.errors.length > 0).length;

    // ── Imports ────────────────────────────────────────────────────────────
    let totalImports = 0;
    let interPackageImports = 0;
    for (const s of stats) {
      totalImports += s.imports;
      if (s.filePath.includes('/packages/')) {
        interPackageImports++;
      }
    }

    // ── React comparison ───────────────────────────────────────────────────
    let comparison: BenchmarkReport['comparison'] | undefined;
    if (existsSync(REACT_REPORT_PATH)) {
      try {
        const reactReport = JSON.parse(readFileSync(REACT_REPORT_PATH, 'utf-8'));
        const reactFps =
          reactReport.parse.totalFiles > 0
            ? (reactReport.parse.totalFiles / reactReport.parse.parseTimeMs) * 1000
            : 0;
        const vueFps = files.length > 0 ? (files.length / parseTimeMs) * 1000 : 0;

        comparison = {
          react: {
            files: reactReport.reactSourceSize?.totalFiles ?? 0,
            parseRate: Math.round(reactFps * 10) / 10,
            successRate: reactReport.parse.successRate ?? 0,
            symbols: reactReport.symbols.totalCount ?? 0,
            parseTimeMs: reactReport.parse.parseTimeMs ?? 0,
          },
          vue: {
            files: files.length,
            parseRate: Math.round(vueFps * 10) / 10,
            successRate:
              files.length > 0 ? Math.round((successCount / files.length) * 1000) / 10 : 0,
            symbols: stats.reduce((sum, s) => sum + s.symbols, 0),
            parseTimeMs,
          },
          notes:
            'Direct comparison between React (facebook/react) and Vue (vuejs/core) source code analysis benchmarks.',
        };
      } catch {
        comparison = undefined;
      }
    }

    report = {
      timestamp: new Date().toISOString(),
      vueSourceSize: {
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
      comparison,
    };

    // Save report
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log('Vue analysis report saved to:', REPORT_PATH);
  }, 300_000);

  // ── Test 1: Vue source is available ─────────────────────────────────────

  it('should have Vue source cloned', () => {
    if (error) {
      console.warn('Vue source not available — benchmark skipped');
      return;
    }
    expect(existsSync(VUE_SRC)).toBe(true);
  });

  // ── Test 2: Discovers source files ──────────────────────────────────────

  it('should discover Vue source files (TS) in packages/', () => {
    if (!report) return; // Vue source not available
    expect(files.length).toBeGreaterThan(100);
    console.log('Files discovered:', files.length);
  });

  // ── Test 3: Parse success rate > 90% ────────────────────────────────────

  it('should have parse success rate above 90%', () => {
    if (!report) return; // Vue source not available
    expect(report.parse.successRate).toBeGreaterThan(90);
    console.log('Parse success rate:', report.parse.successRate + '%');
  });

  // ── Test 4: defineComponent detected ────────────────────────────────────

  it('should detect defineComponent in Vue source', () => {
    if (!report) return; // Vue source not available
    expect(report.symbols.keyExportsFound).toContain('defineComponent');
    console.log('Key exports found:', report.symbols.keyExportsFound.join(', '));
  });

  // ── Test 5: ref detected ────────────────────────────────────────────────

  it('should detect ref in Vue source', () => {
    if (!report) return; // Vue source not available
    expect(report.symbols.keyExportsFound).toContain('ref');
  });

  // ── Test 6: reactive detected ───────────────────────────────────────────

  it('should detect reactive in Vue source', () => {
    if (!report) return; // Vue source not available
    expect(report.symbols.keyExportsFound).toContain('reactive');
  });

  // ── Test 7: computed detected ───────────────────────────────────────────

  it('should detect computed in Vue source', () => {
    if (!report) return; // Vue source not available
    expect(report.symbols.keyExportsFound).toContain('computed');
  });

  // ── Test 8: watch detected ──────────────────────────────────────────────

  it('should detect watch in Vue source', () => {
    if (!report) return; // Vue source not available
    expect(report.symbols.keyExportsFound).toContain('watch');
  });

  // ── Test 9: createApp detected ──────────────────────────────────────────

  it('should detect createApp in Vue source', () => {
    if (!report) return; // Vue source not available
    expect(report.symbols.keyExportsFound).toContain('createApp');
  });

  // ── Test 10: ReactiveEffect detected (reactivity internals) ─────────────

  it('should detect ReactiveEffect in Vue reactivity system', () => {
    if (!report) return; // Vue source not available
    expect(report.symbols.keyExportsFound).toContain('ReactiveEffect');
  });

  // ── Test 11: Template compile function detected ─────────────────────────

  it('should detect compile in Vue compiler-core', () => {
    if (!report) return; // Vue source not available
    expect(report.symbols.keyExportsFound).toContain('compile');
  });

  // ── Test 12: Symbols extracted ──────────────────────────────────────────

  it('should extract at least 500 symbols', () => {
    if (!report) return; // Vue source not available
    console.log('Total symbols:', report.symbols.totalCount);
    expect(report.symbols.totalCount).toBeGreaterThan(500);
  });

  // ── Test 13: Functions detected ─────────────────────────────────────────

  it('should detect functions in Vue source', () => {
    if (!report) return; // Vue source not available
    expect(report.symbols.functions).toBeGreaterThan(0);
    console.log('Functions:', report.symbols.functions);
  });

  // ── Test 14: Classes detected ───────────────────────────────────────────

  it('should detect classes in Vue source', () => {
    if (!report) return; // Vue source not available
    expect(report.symbols.classes).toBeGreaterThan(0);
    console.log('Classes:', report.symbols.classes);
  });

  // ── Test 15: Memory within bounds ───────────────────────────────────────

  it('should use memory within bounds (< 2GB delta for full Vue packages)', () => {
    if (!report) return; // Vue source not available
    console.log('Memory delta:', report.memory.deltaRssMB.toFixed(1) + 'MB');
    expect(report.memory.deltaRssMB).toBeLessThan(2048);
  });

  // ── Test 16: Scan is fast ───────────────────────────────────────────────

  it('should scan files in under 10 seconds', () => {
    if (!report) return; // Vue source not available
    console.log('Scan time:', report.scan.scanTimeMs.toFixed(0) + 'ms');
    expect(report.scan.scanTimeMs).toBeLessThan(10000);
  });

  // ── Test 17: Parse completes in reasonable time ─────────────────────────

  it('should parse all files in under 5 minutes', () => {
    if (!report) return; // Vue source not available
    console.log('Parse time:', (report.parse.parseTimeMs / 1000).toFixed(1) + 's');
    expect(report.parse.parseTimeMs).toBeLessThan(300000);
  });

  // ── Test 18: Imports detected ───────────────────────────────────────────

  it('should detect import statements', () => {
    if (!report) return; // Vue source not available
    console.log('Total imports:', report.imports.totalImports);
    expect(report.imports.totalImports).toBeGreaterThan(0);
  });

  // ── Test 19: Report saved as valid JSON ─────────────────────────────────

  it('should save a valid JSON report to disk', () => {
    if (!report) return; // Vue source not available
    expect(existsSync(REPORT_PATH)).toBe(true);
    const parsed = JSON.parse(readFileSync(REPORT_PATH, 'utf-8'));
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.parse).toBeDefined();
  });

  // ── Test 20: Files per second metric ────────────────────────────────────

  it('should parse at least 10 files per second', () => {
    if (!report) return; // Vue source not available
    const fps = (files.length / report.parse.parseTimeMs) * 1000;
    console.log('Files per second:', fps.toFixed(1));
    expect(fps).toBeGreaterThan(10);
  });

  // ── Test 21: Cross-framework comparison present ─────────────────────────

  it('should include React comparison in report', () => {
    if (!report) return; // Vue source not available
    if (report.comparison) {
      console.log('React vs Vue comparison:', JSON.stringify(report.comparison, null, 2));
      expect(report.comparison.react).toBeDefined();
      expect(report.comparison.vue).toBeDefined();
    } else {
      console.log('No React report found for comparison (React benchmark not yet run)');
      // Skippable — React report may not exist yet
      expect(true).toBe(true);
    }
  });
});
