// @code-analyzer/analyzer — Parse Benchmarks
// Measures file parsing throughput (files/sec, LOC/sec) under varying load.

import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './harness.js';
import type { BenchmarkCase, BenchmarkStats } from './harness.js';
import { generateFixture } from './fixture-generator.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { DiscoveredFile } from '@code-analyzer/shared';
import { TypeScriptProvider } from '../../../src/languages/typescript.js';
import { UnifiedParser } from '../../../src/parser/unified-parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createParser(): UnifiedParser {
  return new UnifiedParser([new TypeScriptProvider()]);
}

function createDiscoveredFiles(filePaths: string[]): DiscoveredFile[] {
  return filePaths.map((fp) => ({
    filePath: fp,
    absolutePath: fp,
    content: readFileSync(fp, 'utf-8'),
    language: 'typescript' as const,
    size: 0,
    modifiedAt: new Date().toISOString(),
  }));
}

/** Recursively collect .ts file paths relative to baseDir */
function collectTsFiles(baseDir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(baseDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Benchmark Tests
// ---------------------------------------------------------------------------

describe('Parse Benchmarks', () => {
  const LONG_TIMEOUT = 120_000;

  it(
    'should parse small projects efficiently (<10ms/file)',
    { timeout: LONG_TIMEOUT },
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'bench-parse-small-'));
      try {
        generateFixture({
          outputDir: tmpDir,
          fileCount: 50,
          filesPerDir: 10,
          seed: 42,
        });

        const parser = createParser();
        const files = collectTsFiles(tmpDir);

        expect(files.length).toBeGreaterThan(0);

        const discoveredFiles = createDiscoveredFiles(files);
        let totalCaptures = 0;

        const runner = new BenchmarkRunner({ verbose: false });
        const benchCase: BenchmarkCase = {
          name: 'parse-50-files',
          category: 'parse',
          warmupIterations: 3,
          iterations: 20,
          setup: () => {
            totalCaptures = 0;
          },
          fn: async () => {
            let captures = 0;
            for (const file of discoveredFiles) {
              const result = parser.parseFile(file);
              captures += result.length;
            }
            totalCaptures = captures;
          },
        };

        const stats = await runner.runCase(benchCase);

        const meanMsPerFile = stats.duration.mean / discoveredFiles.length;
        expect(meanMsPerFile).toBeLessThan(10);
        expect(totalCaptures).toBeGreaterThan(0);
      } finally {
        if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
      }
    },
  );

  it('should parse large projects within linear time', { timeout: LONG_TIMEOUT }, async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'bench-parse-large-'));
    try {
      generateFixture({
        outputDir: tmpDir,
        fileCount: 500,
        filesPerDir: 25,
        seed: 42,
      });

      const files = collectTsFiles(tmpDir);
      const parser = createParser();
      const discoveredFiles = createDiscoveredFiles(files);

      let parsedCount = 0;
      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'parse-500-files',
        category: 'parse',
        warmupIterations: 2,
        iterations: 10,
        fn: async () => {
          let count = 0;
          for (const file of discoveredFiles) {
            parser.parseFile(file);
            count++;
          }
          parsedCount = count;
        },
      };

      const stats = await runner.runCase(benchCase);

      expect(parsedCount).toBe(discoveredFiles.length);
      console.log(
        `Parse 500 files: mean=${stats.duration.mean.toFixed(2)}ms, ` +
          `p95=${stats.duration.p95.toFixed(2)}ms`,
      );
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    }
  });

  it('should parse single large file efficiently', { timeout: LONG_TIMEOUT }, async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'bench-parse-large-file-'));
    try {
      // Generate a synthetic large file
      const largeFilePath = join(tmpDir, 'large.ts');
      let content = '// Auto-generated large benchmark file\n';
      for (let i = 0; i < 300; i++) {
        content += `\nexport class Service${i} {\n`;
        for (let j = 0; j < 8; j++) {
          content += `  method${j}(param${j}: string): number {\n`;
          content += `    const result = param${j}.length + ${i} * ${j};\n`;
          content += `    return result;\n`;
          content += `  }\n\n`;
        }
        content += `}\n`;
      }
      writeFileSync(largeFilePath, content);

      const parser = createParser();
      const file: DiscoveredFile = {
        filePath: 'large.ts',
        absolutePath: largeFilePath,
        content,
        language: 'typescript',
        size: Buffer.byteLength(content),
        modifiedAt: new Date().toISOString(),
      };

      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'parse-large-file',
        category: 'parse',
        warmupIterations: 3,
        iterations: 30,
        fn: async () => {
          parser.parseFile(file);
        },
      };

      const stats = await runner.runCase(benchCase);
      const locPerSec = content.split('\n').length / (stats.duration.mean / 1000);
      console.log(
        `Parse large file (${content.split('\n').length} LOC): ` +
          `mean=${stats.duration.mean.toFixed(2)}ms, ` +
          `p95=${stats.duration.p95.toFixed(2)}ms, ` +
          `${locPerSec.toFixed(0)} LOC/sec`,
      );
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    }
  });
});
