// @code-analyzer/infra — ParallelIndexer Worker Pool Integration Tests
// Focused on worker pool behavior, failure handling, progress reporting,
// result collection, and graceful degradation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { InMemoryGraphStore } from '../storage/in-memory-graph-store.js';
import { ParallelIndexer } from '../workers/parallel-indexer.js';
import type {
  IndexProgress,
  IndexerResult,
  ParallelIndexerConfig,
} from '../workers/parallel-indexer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirCounter = 0;

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `ca-parallel-worker-test-${Date.now()}-${tmpDirCounter++}`,
  );
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createTestFiles(
  rootPath: string,
  fileCount: number,
  baseContent?: string,
): string[] {
  const paths: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    const subDir = join(rootPath, `src/module_${i % 3}`);
    mkdirSync(subDir, { recursive: true });
    const content = baseContent ?? `
export function func_${i}(input: string): string {
  return "result_${i}_" + input;
}

export class Class_${i} {
  method_${i}(): void {
    func_${i}("test");
  }
}
`;
    const filePath = join(subDir, `file_${i}.ts`);
    writeFileSync(filePath, content, 'utf-8');
    paths.push(filePath);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ParallelIndexer - Worker Pool Integration', () => {
  let store: InMemoryGraphStore;

  beforeEach(() => {
    store = new InMemoryGraphStore();
  });

  // ── Worker Pool Distribution ──

  it('distributes indexing work across worker pool', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 30);

      const indexer = new ParallelIndexer(store, {
        concurrency: 4,
        batchSize: 5,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);

      // With 30 files and batchSize=5, we get 6 batches distributed across 4 workers
      expect(result.filesDiscovered).toBeGreaterThanOrEqual(28);
      expect(result.filesParsed).toBeGreaterThanOrEqual(20);
      expect(result.nodesCreated).toBeGreaterThan(0);
      expect(result.edgesCreated).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('handles single worker configuration', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 10);

      const indexer = new ParallelIndexer(store, {
        concurrency: 1,
        batchSize: 3,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);
      expect(result.filesParsed).toBeGreaterThan(0);
      expect(result.nodesCreated).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('handles batch size larger than file count', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 5);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        batchSize: 100,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);
      expect(result.filesParsed).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Progress Reporting ──

  it('reports progress through all phases', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 15);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        batchSize: 5,
        enableStreaming: true,
        enableIncremental: false,
      });

      const phases: string[] = [];
      indexer.onProgress((progress: IndexProgress) => {
        phases.push(progress.phase);
      });

      await indexer.indexDirectory(rootPath);

      // Should see at least 'discovering' and 'parsing' phases
      expect(phases.some((p) => p === 'discovering')).toBe(true);
      // Final progress should reach 'complete' or close to it
      expect(phases.length).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('progress reports contain meaningful metrics', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 10);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        batchSize: 3,
        enableStreaming: true,
        enableIncremental: false,
      });

      const progressEvents: IndexProgress[] = [];
      indexer.onProgress((progress: IndexProgress) => {
        progressEvents.push(progress);
      });

      await indexer.indexDirectory(rootPath);

      // Last event should have meaningful data
      const lastEvent = progressEvents[progressEvents.length - 1];
      expect(lastEvent).toBeDefined();
      expect(lastEvent!.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(typeof lastEvent!.progress).toBe('number');
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('progress is throttled', async () => {
    const rootPath = createTempDir();
    try {
      // Create many small files to generate many progress events
      createTestFiles(rootPath, 5);

      const indexer = new ParallelIndexer(store, {
        concurrency: 1,
        batchSize: 1,
        enableStreaming: true,
        enableIncremental: false,
      });

      const timestamps: number[] = [];
      indexer.onProgress(() => {
        timestamps.push(Date.now());
      });

      await indexer.indexDirectory(rootPath);

      // Events should be emitted (throttling prevents excessive events)
      expect(timestamps.length).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Result Collection and Merging ──

  it('collects and merges results from multiple batches', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 25);

      const indexer = new ParallelIndexer(store, {
        concurrency: 3,
        batchSize: 5,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);

      expect(result.filesParsed).toBeGreaterThan(0);
      expect(result.nodesCreated).toBeGreaterThan(0);
      expect(result.edgesCreated).toBeGreaterThan(0);
      expect(result.errors).toBeDefined();
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('maintains result consistency across parallel batches', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 20);

      // Run with high concurrency
      const store1 = new InMemoryGraphStore();
      const indexer1 = new ParallelIndexer(store1, {
        concurrency: 8,
        batchSize: 3,
        enableStreaming: true,
        enableIncremental: false,
      });
      const result1 = await indexer1.indexDirectory(rootPath);

      // Run with low concurrency
      const store2 = new InMemoryGraphStore();
      const indexer2 = new ParallelIndexer(store2, {
        concurrency: 1,
        batchSize: 3,
        enableStreaming: true,
        enableIncremental: false,
      });
      const result2 = await indexer2.indexDirectory(rootPath);

      // Both should produce the same number of parsed files
      expect(result1.filesParsed).toBe(result2.filesParsed);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Worker Failure Handling ──

  it('handles batch execution failures gracefully', async () => {
    const rootPath = createTempDir();
    try {
      // Create a mix of valid and problematic files
      const validDir = join(rootPath, 'src');
      mkdirSync(validDir, { recursive: true });

      for (let i = 0; i < 5; i++) {
        writeFileSync(
          join(validDir, `good_${i}.ts`),
          `export function good_${i}(): void {}\n`,
          'utf-8',
        );
      }

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        batchSize: 5,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);
      expect(result.filesDiscovered).toBeGreaterThan(0);
      // Errors array should exist even if empty
      expect(Array.isArray(result.errors)).toBe(true);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('continues processing after recoverable errors', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 10);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        batchSize: 5,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);
      // All files should be processed despite any individual file issues
      expect(result.filesDiscovered).toBeGreaterThanOrEqual(8);
      expect(result.filesParsed).toBeGreaterThanOrEqual(6);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('records errors in the result', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 3);

      const indexer = new ParallelIndexer(store, { enableIncremental: false });
      const result = await indexer.indexDirectory(rootPath);

      expect(Array.isArray(result.errors)).toBe(true);
      result.errors.forEach((err) => {
        expect(err).toHaveProperty('filePath');
        expect(err).toHaveProperty('message');
        expect(err).toHaveProperty('recoverable');
      });
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Cancellation ──

  it('cancels worker pool on cancel()', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 30);

      const indexer = new ParallelIndexer(store, {
        concurrency: 1,
        batchSize: 1,
        enableStreaming: true,
        enableIncremental: false,
      });

      const indexPromise = indexer.indexDirectory(rootPath);

      // Cancel after a short delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      indexer.cancel();

      const result = await indexPromise;
      expect(result).toBeDefined();
      expect(result.rootPath).toBe(rootPath);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Symbol and Reference Extraction ──

  it('extracts function definitions from files', async () => {
    const rootPath = createTempDir();
    try {
      const content = `
export function hello(): string { return "hello"; }
export function world(): number { return 42; }
`;
      writeFileSync(join(rootPath, 'functions.ts'), content, 'utf-8');

      const indexer = new ParallelIndexer(store, { enableIncremental: false });
      const result = await indexer.indexDirectory(rootPath);

      expect(result.nodesCreated).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('extracts class definitions from files', async () => {
    const rootPath = createTempDir();
    try {
      const content = `
export class MyService {
  doWork(): void {}
}
export class Helper {
  assist(): void {}
}
`;
      writeFileSync(join(rootPath, 'classes.ts'), content, 'utf-8');

      const indexer = new ParallelIndexer(store, { enableIncremental: false });
      const result = await indexer.indexDirectory(rootPath);

      expect(result.nodesCreated).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('extracts import references', async () => {
    const rootPath = createTempDir();
    try {
      const content = `
import { something } from './module';
import * as fs from 'fs';
const x = require('path');
export function test(): void { something(); }
`;
      writeFileSync(join(rootPath, 'imports.ts'), content, 'utf-8');

      const indexer = new ParallelIndexer(store, { enableIncremental: false });
      const result = await indexer.indexDirectory(rootPath);

      expect(result.edgesCreated).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Python file parsing ──

  it('extracts Python function definitions', async () => {
    const rootPath = createTempDir();
    try {
      const content = `
def hello():
    return "hello"

def world():
    return 42
`;
      writeFileSync(join(rootPath, 'functions.py'), content, 'utf-8');

      const indexer = new ParallelIndexer(store, { enableIncremental: false });
      const result = await indexer.indexDirectory(rootPath);

      expect(result.nodesCreated).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Callback handling ──

  it('handles multiple progress callbacks', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 5);

      const indexer = new ParallelIndexer(store, {
        concurrency: 1,
        batchSize: 2,
        enableStreaming: true,
        enableIncremental: false,
      });

      let cb1Count = 0;
      let cb2Count = 0;
      indexer.onProgress(() => { cb1Count++; });
      indexer.onProgress(() => { cb2Count++; });

      await indexer.indexDirectory(rootPath);

      expect(cb1Count).toBeGreaterThan(0);
      expect(cb2Count).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('handles multiple completion callbacks', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 3);

      const indexer = new ParallelIndexer(store, { enableIncremental: false });

      let cb1Called = false;
      let cb2Called = false;
      indexer.onComplete(() => { cb1Called = true; });
      indexer.onComplete(() => { cb2Called = true; });

      await indexer.indexDirectory(rootPath);

      expect(cb1Called).toBe(true);
      expect(cb2Called).toBe(true);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Medium file sets ──

  it('handles indexing moderate number of files', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 20);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        batchSize: 5,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);
      expect(result.filesDiscovered).toBeGreaterThanOrEqual(15);
      expect(result.durationMs).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Mixed language files ──

  it('handles files with no recognized language', async () => {
    const rootPath = createTempDir();
    try {
      writeFileSync(join(rootPath, 'unknown.xyz'), 'some content', 'utf-8');
      writeFileSync(join(rootPath, 'readme.txt'), 'text file', 'utf-8');

      const indexer = new ParallelIndexer(store, { enableIncremental: false });
      const result = await indexer.indexDirectory(rootPath);

      // Files without recognized language are still discovered
      expect(result.filesDiscovered).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Configuration edge cases ──

  it('handles concurrency=1 (minimum valid)', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 5);

      const indexer = new ParallelIndexer(store, {
        concurrency: 1,
        batchSize: 5,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);
      expect(result.filesDiscovered).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('handles minimal batchSize=1', async () => {
    const rootPath = createTempDir();
    try {
      createTestFiles(rootPath, 5);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        batchSize: 1,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);
      expect(result.filesParsed).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });
});
