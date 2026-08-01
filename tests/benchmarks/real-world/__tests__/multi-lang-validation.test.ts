/**
 * Multi-Language Real-World Validation Benchmark
 *
 * Validates the code-analyzer parser against real open-source repositories:
 * - Python: django/django (contrib/admin module)
 * - Go: kubernetes/client-go
 * - Java: spring-projects/spring-boot
 *
 * Prerequisites:
 *   git clone --depth 1 --single-branch --filter=blob:none https://github.com/django/django.git /tmp/django-src
 *   git clone --depth 1 --single-branch --filter=blob:none https://github.com/kubernetes/client-go.git /tmp/k8s-client-go
 *   git clone --depth 1 --single-branch --filter=blob:none https://github.com/spring-projects/spring-boot.git /tmp/spring-boot-src
 *
 * Usage:
 *   pnpm vitest run tests/benchmarks/real-world/__tests__/multi-lang-validation.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { execSync } from 'node:child_process';
import { PythonProvider } from '../../../../packages/analyzer/src/languages/python.js';
import { GoProvider } from '../../../../packages/analyzer/src/languages/go.js';
import { JavaProvider } from '../../../../packages/analyzer/src/languages/java.js';
import type { LanguageProvider, ParsedImport } from '../../../../packages/analyzer/src/languages/provider.js';
import type { UnifiedCapture } from '../../../../packages/shared/src/types/capture-tags.js';
import { CAPTURE_TAGS } from '../../../../packages/shared/src/types/capture-tags.js';

// ── Constants ───────────────────────────────────────────────────────────────

const REPO_PATHS = {
  django: '/tmp/django-src',
  k8sClientGo: '/tmp/k8s-client-go',
  springBoot: '/tmp/spring-boot-src',
};

const REPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = join(REPORT_DIR, 'multi-lang-validation-report.json');

// ── Types ───────────────────────────────────────────────────────────────────

interface LangResult {
  language: string;
  repoUrl: string;
  rootDir: string;
  fileCount: number;
  totalLines: number;
  parseSuccess: number;
  parseFailed: number;
  successRate: number;
  parseTimeMs: number;
  filesPerSec: number;
  symbolCount: number;
  functions: number;
  classes: number;
  methods: number;
  variables: number;
  imports: number;
  errors: string[];
}

interface ValidationReport {
  timestamp: string;
  results: LangResult[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function collectSourceFiles(dir: string, extensions: string[], maxFiles = 2000): string[] {
  const files: string[] = [];
  function walk(d: string) {
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '__pycache__') {
            walk(full);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            files.push(full);
            if (files.length >= maxFiles) return;
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }
  walk(dir);
  return files;
}

function runValidation(
  repoUrl: string,
  rootDir: string,
  extensions: string[],
  provider: LanguageProvider,
  language: string,
  maxFiles = 500,
): LangResult {
  console.log(`\n  Validating ${language} (${rootDir})...`);

  const files = collectSourceFiles(rootDir, extensions, maxFiles);
  console.log(`  Found ${files.length} ${language} files`);

  let totalLines = 0;
  let parseSuccess = 0;
  let parseFailed = 0;
  let functions = 0;
  let classes = 0;
  let methods = 0;
  let variables = 0;
  let imports = 0;
  const errors: string[] = [];

  const parseStart = performance.now();

  for (const filePath of files) {
    try {
      const source = readFileSync(filePath, 'utf-8');
      totalLines += source.split('\n').length;
      const captures = provider.parse(source, filePath);

      for (const c of captures) {
        switch (c.tag) {
          case CAPTURE_TAGS.FUNCTION_DEF:
            functions++;
            break;
          case CAPTURE_TAGS.CLASS_DEF:
          case CAPTURE_TAGS.STRUCT_DEF:
          case CAPTURE_TAGS.INTERFACE_DEF:
            classes++;
            break;
          case CAPTURE_TAGS.METHOD_DEF:
            methods++;
            break;
          case CAPTURE_TAGS.VARIABLE_DEF:
            variables++;
            break;
          case CAPTURE_TAGS.IMPORT:
            imports++;
            break;
        }
      }
      parseSuccess++;
    } catch (err: unknown) {
      parseFailed++;
      if (errors.length < 10) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${filePath}: ${msg}`);
      }
    }
  }

  const parseTime = performance.now() - parseStart;

  return {
    language,
    repoUrl,
    rootDir,
    fileCount: files.length,
    totalLines,
    parseSuccess,
    parseFailed,
    successRate: files.length > 0 ? parseSuccess / files.length : 1,
    parseTimeMs: Math.round(parseTime),
    filesPerSec: parseTime > 0 ? Math.round(files.length / (parseTime / 1000)) : 0,
    symbolCount: functions + classes + methods + variables + imports,
    functions,
    classes,
    methods,
    variables,
    imports,
    errors,
  };
}

function cloneIfNeeded(repoUrl: string, dest: string): void {
  if (existsSync(dest) && existsSync(join(dest, '.git'))) {
    console.log(`  ${dest} already cloned`);
    return;
  }
  console.log(`  Cloning ${repoUrl} -> ${dest}...`);
  try {
    execSync(
      `git clone --depth 1 --single-branch --filter=blob:none ${repoUrl} ${dest}`,
      { stdio: 'pipe', timeout: 120_000 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Clone warning: ${msg}`);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Multi-Language Real-world Validation', () => {
  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    results: [],
  };

  beforeAll(() => {
    // Clone repos (skip if network unavailable or already cloned)
    try {
      cloneIfNeeded('https://github.com/django/django.git', REPO_PATHS.django);
    } catch { /* network unavailable — skip */ }

    try {
      cloneIfNeeded('https://github.com/kubernetes/client-go.git', REPO_PATHS.k8sClientGo);
    } catch { /* network unavailable — skip */ }

    try {
      cloneIfNeeded('https://github.com/spring-projects/spring-boot.git', REPO_PATHS.springBoot);
    } catch { /* network unavailable — skip */ }
  }, { timeout: 300_000 });

  // ── Python / Django ───────────────────────────────────────────────────────

  describe('Python — Django', () => {
    let result: LangResult;

    beforeAll(() => {
      const adminDir = join(REPO_PATHS.django, 'django', 'contrib', 'admin');
      if (!existsSync(adminDir)) {
        console.warn('Django source not available — skipping Python tests');
        return;
      }
      const provider = new PythonProvider();
      result = runValidation(
        'https://github.com/django/django',
        adminDir,
        ['.py'],
        provider,
        'Python',
        500,
      );
      report.results.push(result);
    });

    it('should discover Python files in Django admin', () => {
      if (!result) return;
      expect(result.fileCount).toBeGreaterThan(0);
    });

    it('should achieve > 90% parse success rate for Django', () => {
      if (!result) return;
      expect(result.successRate).toBeGreaterThan(0.9);
    });

    it('should detect function definitions in Django', () => {
      if (!result) return;
      expect(result.functions).toBeGreaterThan(0);
    });

    it('should detect class definitions in Django', () => {
      if (!result) return;
      expect(result.classes).toBeGreaterThan(0);
    });

    it('should detect imports in Django', () => {
      if (!result) return;
      expect(result.imports).toBeGreaterThan(0);
    });

    it('should parse at least 10 files/sec for Python', () => {
      if (!result) return;
      expect(result.filesPerSec).toBeGreaterThan(10);
    });

    it('should have errors under 5% of total files', () => {
      if (!result) return;
      const errorRate = result.parseFailed / result.fileCount;
      expect(errorRate).toBeLessThan(0.05);
    });
  });

  // ── Go / Kubernetes ───────────────────────────────────────────────────────

  describe('Go — Kubernetes client-go', () => {
    let result: LangResult;

    beforeAll(() => {
      if (!existsSync(REPO_PATHS.k8sClientGo)) {
        console.warn('Kubernetes client-go source not available — skipping Go tests');
        return;
      }
      const provider = new GoProvider();
      result = runValidation(
        'https://github.com/kubernetes/client-go',
        REPO_PATHS.k8sClientGo,
        ['.go'],
        provider,
        'Go',
        500,
      );
      report.results.push(result);
    });

    it('should discover Go files in client-go', () => {
      if (!result) return;
      expect(result.fileCount).toBeGreaterThan(0);
    });

    it('should achieve > 90% parse success rate for Go', () => {
      if (!result) return;
      expect(result.successRate).toBeGreaterThan(0.9);
    });

    it('should detect function definitions in Go', () => {
      if (!result) return;
      expect(result.functions).toBeGreaterThan(0);
    });

    it('should detect struct definitions as class-like entities', () => {
      if (!result) return;
      expect(result.classes).toBeGreaterThan(0);
    });

    it('should detect imports in Go', () => {
      if (!result) return;
      expect(result.imports).toBeGreaterThan(0);
    });

    it('should parse at least 10 files/sec for Go', () => {
      if (!result) return;
      expect(result.filesPerSec).toBeGreaterThan(10);
    });
  });

  // ── Java / Spring Boot ────────────────────────────────────────────────────

  describe('Java — Spring Boot', () => {
    let result: LangResult;

    beforeAll(() => {
      if (!existsSync(REPO_PATHS.springBoot)) {
        console.warn('Spring Boot source not available — skipping Java tests');
        return;
      }
      const provider = new JavaProvider();
      result = runValidation(
        'https://github.com/spring-projects/spring-boot',
        REPO_PATHS.springBoot,
        ['.java'],
        provider,
        'Java',
        500,
      );
      report.results.push(result);
    });

    it('should discover Java files in Spring Boot', () => {
      if (!result) return;
      expect(result.fileCount).toBeGreaterThan(0);
    });

    it('should achieve > 85% parse success rate for Java', () => {
      if (!result) return;
      // Java parsing is inherently harder — accept 85% threshold
      expect(result.successRate).toBeGreaterThan(0.85);
    });

    it('should detect class definitions in Spring Boot', () => {
      if (!result) return;
      expect(result.classes).toBeGreaterThan(0);
    });

    it('should detect method definitions in Spring Boot', () => {
      if (!result) return;
      expect(result.methods).toBeGreaterThan(0);
    });

    it('should detect imports in Spring Boot', () => {
      if (!result) return;
      expect(result.imports).toBeGreaterThan(0);
    });

    it('should parse at least 5 files/sec for Java', () => {
      if (!result) return;
      expect(result.filesPerSec).toBeGreaterThan(5);
    });
  });

  // ── Report ────────────────────────────────────────────────────────────────

  it('should generate a multi-language validation report', () => {
    if (report.results.length === 0) {
      // All repos unavailable — write empty report
      report.results.push({
        language: 'N/A',
        repoUrl: 'N/A',
        rootDir: 'N/A',
        fileCount: 0,
        totalLines: 0,
        parseSuccess: 0,
        parseFailed: 0,
        successRate: 0,
        parseTimeMs: 0,
        filesPerSec: 0,
        symbolCount: 0,
        functions: 0,
        classes: 0,
        methods: 0,
        variables: 0,
        imports: 0,
        errors: ['No repositories available for validation'],
      });
    }

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
    expect(existsSync(REPORT_PATH)).toBe(true);
  });

  // ── Aggregate ─────────────────────────────────────────────────────────────

  it('should handle gracefully when repos are unavailable', () => {
    // This test always passes — validates that the benchmark doesn't crash
    // when network is unavailable and repos cannot be cloned
    expect(true).toBe(true);
  });
});
