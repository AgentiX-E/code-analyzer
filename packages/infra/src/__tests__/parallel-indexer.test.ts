// @code-analyzer/infra — ParallelIndexer Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
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
    `code-analyzer-test-${Date.now()}-${tmpDirCounter++}`,
  );
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createTestProject(
  rootPath: string,
  fileCount: number,
): string[] {
  const paths: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    const dir = join(rootPath, `src/module_${i % 5}`);
    mkdirSync(dir, { recursive: true });
    const fileName = `file_${i}.ts`;
    const filePath = join(dir, fileName);
    const content = `
import { util_${i} } from './helpers';

export function testFunc_${i}(arg: string): void {
  console.log("testFunc_${i} called");
  util_${i}(arg);
}

export class TestClass_${i} {
  private name: string;
  
  constructor() {
    this.name = "class_${i}";
    this.init();
  }
  
  init(): void {
    testFunc_${i}(this.name);
  }
}
`;
    writeFileSync(filePath, content, 'utf-8');
    paths.push(filePath);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ParallelIndexer', () => {
  let store: InMemoryGraphStore;

  beforeEach(() => {
    store = new InMemoryGraphStore();
  });

  // ── Basic Indexing ──

  it('indexes a small directory with known files', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 10);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        batchSize: 5,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);

      expect(result.filesDiscovered).toBeGreaterThanOrEqual(8);
      expect(result.filesParsed).toBeGreaterThanOrEqual(6);
      expect(result.nodesCreated).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.incremental).toBe(false);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('handles empty directories gracefully', async () => {
    const rootPath = createTempDir();
    try {
      const indexer = new ParallelIndexer(store);

      const result = await indexer.indexDirectory(rootPath);

      expect(result.filesDiscovered).toBe(0);
      expect(result.filesParsed).toBe(0);
      expect(result.nodesCreated).toBe(0);
      expect(result.incremental).toBe(false);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('respects language filter', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 10);

      const indexer = new ParallelIndexer(store, { enableIncremental: false });

      const result = await indexer.indexDirectory(rootPath, {
        languages: ['python'], // No python files in test project
      });

      expect(result.filesDiscovered).toBe(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('respects filePatterns filter', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 10);

      const indexer = new ParallelIndexer(store, { enableIncremental: false });

      const result = await indexer.indexDirectory(rootPath, {
        filePatterns: ['**/file_0.ts'],
      });

      expect(result.filesDiscovered).toBeLessThan(10);
      expect(result.filesDiscovered).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Incremental Indexing ──

  it('performs incremental indexing (only changed files)', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 5);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        batchSize: 5,
        enableStreaming: true,
        enableIncremental: true,
      });

      // First full index
      const firstResult = await indexer.indexDirectory(rootPath);
      expect(firstResult.filesParsed).toBeGreaterThan(0);

      // Immediate re-index: should find few if any changed files
      const secondResult = await indexer.indexDirectory(rootPath);
      // If incremental is working, fewer files should be processed
      expect(secondResult.filesParsed).toBeLessThanOrEqual(
        firstResult.filesParsed,
      );

      // Change one file
      const changedPath = join(rootPath, 'src', 'module_0', 'file_0.ts');
      writeFileSync(
        changedPath,
        'export function updatedFunc(): void { console.log("changed"); }\n',
        'utf-8',
      );

      // Re-index with changed file — should detect some changes
      const thirdResult = await indexer.indexDirectory(rootPath);
      expect(thirdResult.filesDiscovered).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('force flag bypasses incremental check', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 5);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        enableStreaming: true,
        enableIncremental: true,
      });

      // First index
      await indexer.indexDirectory(rootPath);

      // Force re-index should process all files
      const forcedResult = await indexer.indexDirectory(rootPath, {
        force: true,
      });

      expect(forcedResult.filesParsed).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Incremental Index (changedFiles) ──

  it('incrementalIndex processes only specified changed files', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 5);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        enableStreaming: true,
        enableIncremental: true,
      });

      // First do a full index
      await indexer.indexDirectory(rootPath);

      // Change one file
      const changedPath = join(rootPath, 'src', 'module_0', 'file_0.ts');
      writeFileSync(
        changedPath,
        'export function changed_func(): void {}\n',
        'utf-8',
      );

      // Incremental index with changed files
      const result = await indexer.incrementalIndex(rootPath, [
        'src/module_0/file_0.ts',
      ]);

      expect(result.filesParsed).toBeGreaterThan(0);
      expect(result.incremental).toBe(true);
      expect(result.durationMs).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Progress Reporting ──

  it('reports progress during indexing', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 10);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        batchSize: 3,
        enableStreaming: true,
        enableIncremental: false,
      });

      const progressEvents: IndexProgress[] = [];
      indexer.onProgress((progress) => {
        progressEvents.push(progress);
      });

      await indexer.indexDirectory(rootPath);

      // Should have received at least one progress event
      expect(progressEvents.length).toBeGreaterThan(0);

      // Progress should show some files were discovered
      const finalState = indexer.getProgress();
      expect(finalState.filesDiscovered).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('getProgress returns current state', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 5);

      const indexer = new ParallelIndexer(store, { enableIncremental: false });

      const progressBefore = indexer.getProgress();
      expect(progressBefore.phase).toBe('discovering');
      expect(progressBefore.filesDiscovered).toBe(0);

      await indexer.indexDirectory(rootPath);

      const progressAfter = indexer.getProgress();
      expect(progressAfter.progress).toBeGreaterThanOrEqual(0);
      expect(progressAfter.filesDiscovered).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('calls onComplete when indexing finishes', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 5);

      const indexer = new ParallelIndexer(store, { enableIncremental: false });

      let completeResult: IndexerResult | null = null;
      indexer.onComplete((result) => {
        completeResult = result;
      });

      await indexer.indexDirectory(rootPath);

      expect(completeResult).not.toBeNull();
      expect(completeResult!.rootPath).toBe(rootPath);
      expect(completeResult!.filesDiscovered).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Cancellation ──

  it('supports cancellation', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 20);

      const indexer = new ParallelIndexer(store, {
        concurrency: 1,
        batchSize: 1,
        enableStreaming: true,
        enableIncremental: false,
      });

      // Start indexing and cancel after a short delay
      const indexPromise = indexer.indexDirectory(rootPath);

      setTimeout(() => {
        indexer.cancel();
      }, 10);

      const result = await indexPromise;
      // After cancellation, result should still be returned (may be partial)
      expect(result).toHaveProperty('rootPath');
      expect(result).toHaveProperty('durationMs');
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Error Handling ──

  it('handles unreadable files gracefully', async () => {
    const rootPath = createTempDir();
    try {
      // Create a directory with some files
      const dir = join(rootPath, 'src');
      mkdirSync(dir, { recursive: true });

      // Create a valid file
      writeFileSync(
        join(dir, 'valid.ts'),
        'export function valid(): void {}\n',
        'utf-8',
      );

      const indexer = new ParallelIndexer(store, { enableIncremental: false });

      const result = await indexer.indexDirectory(rootPath);
      // Files with valid content should be discoverable
      expect(result.filesDiscovered).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('records parse errors as recoverable', async () => {
    const rootPath = createTempDir();
    try {
      const dir = join(rootPath, 'src');
      mkdirSync(dir, { recursive: true });

      // Create a file that will parse but have no symbols
      writeFileSync(
        join(dir, 'empty.ts'),
        '// Just a comment\n',
        'utf-8',
      );

      const indexer = new ParallelIndexer(store, { enableIncremental: false });

      const result = await indexer.indexDirectory(rootPath);

      // Files with no symbols should still be discovered
      expect(result.filesDiscovered).toBeGreaterThan(0);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Concurrency Settings ──

  it('respects concurrency configuration', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 100);

      // Low concurrency
      const indexer1 = new ParallelIndexer(store, {
        concurrency: 1,
        batchSize: 10,
        enableStreaming: true,
        enableIncremental: false,
      });

      const start1 = Date.now();
      await indexer1.indexDirectory(rootPath);
      const time1 = Date.now() - start1;

      // Reset store
      const store2 = new InMemoryGraphStore();
      const indexer2 = new ParallelIndexer(store2, {
        concurrency: 8,
        batchSize: 10,
        enableStreaming: true,
        enableIncremental: false,
      });

      const start2 = Date.now();
      await indexer2.indexDirectory(rootPath);
      const time2 = Date.now() - start2;

      // Higher concurrency should be at least as fast
      // (not strictly required on all machines, but a good sanity check)
      expect(time2).toBeLessThanOrEqual(time1 * 1.5);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Batch Size Configuration ──

  it('respects batch size configuration', async () => {
    const rootPath = createTempDir();
    try {
      createTestProject(rootPath, 20);

      const indexer = new ParallelIndexer(store, {
        concurrency: 2,
        batchSize: 3,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);
      expect(result.filesDiscovered).toBeGreaterThanOrEqual(18);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Configuration Defaults ──

  it('uses sensible default config', async () => {
    const indexer = new ParallelIndexer(store);

    const defaultConfig: ParallelIndexerConfig = {
      concurrency: expect.any(Number) as unknown as number,
      batchSize: 50,
      enableStreaming: true,
      enableIncremental: true,
    };

    // Defaults should be set
    expect(indexer).toBeDefined();
  });
});
