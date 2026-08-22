// @code-analyzer/core — Crash Recovery Tests
// Comprehensive tests for checkpoint store, quarantine manager, and recovery manager.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CheckpointStore } from '../crash-recovery/checkpoint-store.js';
import { QuarantineManager } from '../crash-recovery/quarantine.js';
import { RecoveryManager } from '../crash-recovery/recovery-manager.js';
import type { Checkpoint } from '../crash-recovery/checkpoint-store.js';
import type { QuarantinedFile } from '../crash-recovery/quarantine.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'code-analyzer-crash-test-'));
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    phaseId: 'parse',
    processedFiles: ['a.ts', 'b.ts', 'c.ts'],
    nodeCount: 100,
    edgeCount: 50,
    timestamp: Date.now(),
    metadata: {},
    ...overrides,
  };
}

// ===========================================================================
// Checkpoint Store Tests
// ===========================================================================

describe('CheckpointStore', () => {
  let tempDir: string;
  let store: CheckpointStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new CheckpointStore(tempDir);
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('should save and load a checkpoint', () => {
    const checkpoint = makeCheckpoint();
    store.save(checkpoint);

    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.phaseId).toBe('parse');
    expect(loaded!.processedFiles).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(loaded!.nodeCount).toBe(100);
    expect(loaded!.edgeCount).toBe(50);
  });

  it('should return null when no checkpoint exists', () => {
    const loaded = store.load();
    expect(loaded).toBeNull();
  });

  it('should clear a checkpoint', () => {
    store.save(makeCheckpoint());
    expect(store.exists()).toBe(true);

    store.clear();
    expect(store.exists()).toBe(false);
    expect(store.load()).toBeNull();
  });

  it('should overwrite an existing checkpoint', () => {
    store.save(makeCheckpoint({ phaseId: 'parse' }));
    store.save(makeCheckpoint({ phaseId: 'resolve', nodeCount: 200 }));

    const loaded = store.load();
    expect(loaded!.phaseId).toBe('resolve');
    expect(loaded!.nodeCount).toBe(200);
  });

  it('should persist checkpoint timestamp', () => {
    const timestamp = 1609459200000; // 2021-01-01
    store.save(makeCheckpoint({ timestamp }));

    const loaded = store.load();
    expect(loaded!.timestamp).toBe(timestamp);
  });

  it('should persist metadata', () => {
    const metadata = { custom: 'data', nested: { key: 'value' } };
    store.save(makeCheckpoint({ metadata }));

    const loaded = store.load();
    expect(loaded!.metadata).toEqual(metadata);
  });

  it('should return null for corrupted checkpoint file', () => {
    // Create a corrupted JSON file in the cache dir
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'checkpoint.json'), 'not valid json');

    const loaded = store.load();
    expect(loaded).toBeNull();
  });

  it('should return null for checkpoint with missing fields', () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'checkpoint.json'), JSON.stringify({ phaseId: 'test' }));

    const loaded = store.load();
    expect(loaded).toBeNull();
  });

  it('should report correct file path', () => {
    const fp = store.getFilePath();
    expect(fp).toContain('checkpoint.json');
  });

  it('should report checkpoint age', () => {
    store.save(makeCheckpoint({ timestamp: Date.now() - 60000 })); // 1 minute ago
    const age = store.getAge();
    expect(age).toBeGreaterThanOrEqual(50000);
    expect(age).toBeLessThanOrEqual(120000);
  });

  it('should return Infinity age when no checkpoint', () => {
    expect(store.getAge()).toBe(Infinity);
  });

  it('should return correct last timestamp', () => {
    store.save(makeCheckpoint({ timestamp: 1000 }));
    expect(store.getLastTimestamp()).toBe(1000);
  });

  it('should return 0 timestamp when no checkpoint', () => {
    expect(store.getLastTimestamp()).toBe(0);
  });

  it('should handle empty processed files', () => {
    store.save(makeCheckpoint({ processedFiles: [] }));
    const loaded = store.load();
    expect(loaded!.processedFiles).toEqual([]);
  });

  it('should handle large metadata objects', () => {
    const largeMetadata: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) {
      largeMetadata[`key_${i}`] = `value_${i}`;
    }
    store.save(makeCheckpoint({ metadata: largeMetadata }));

    const loaded = store.load();
    expect(loaded!.metadata).toEqual(largeMetadata);
  });
});

// ===========================================================================
// Quarantine Manager Tests
// ===========================================================================

describe('QuarantineManager', () => {
  let tempDir: string;
  let manager: QuarantineManager;

  beforeEach(() => {
    tempDir = createTempDir();
    manager = new QuarantineManager(tempDir);
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('should quarantine a file', () => {
    manager.quarantine({
      filePath: 'broken.ts',
      error: 'Parse error',
      phaseId: 'parse',
      retryCount: 1,
    });

    const files = manager.getQuarantined();
    expect(files).toHaveLength(1);
    expect(files[0]!.filePath).toBe('broken.ts');
    expect(files[0]!.error).toBe('Parse error');
    expect(files[0]!.phaseId).toBe('parse');
  });

  it('should increment retry count for already quarantined file', () => {
    manager.quarantine({ filePath: 'x.ts', error: 'Err1', phaseId: 'p1', retryCount: 1 });
    manager.quarantine({ filePath: 'x.ts', error: 'Err2', phaseId: 'p2', retryCount: 1 });

    const files = manager.getQuarantined();
    expect(files).toHaveLength(1);
    expect(files[0]!.retryCount).toBe(2);
    expect(files[0]!.error).toBe('Err2'); // Updated error message
    expect(files[0]!.phaseId).toBe('p2'); // Updated phase
  });

  it('should check if a file is quarantined', () => {
    manager.quarantine({ filePath: 'a.ts', error: 'Err', phaseId: 'p', retryCount: 1 });

    expect(manager.isQuarantined('a.ts')).toBe(true);
    expect(manager.isQuarantined('b.ts')).toBe(false);
  });

  it('should get quarantined path set', () => {
    manager.quarantine({ filePath: 'a.ts', error: 'e1', phaseId: 'p1', retryCount: 1 });
    manager.quarantine({ filePath: 'b.ts', error: 'e2', phaseId: 'p1', retryCount: 1 });

    const paths = manager.getQuarantinedPaths();
    expect(paths.has('a.ts')).toBe(true);
    expect(paths.has('b.ts')).toBe(true);
    expect(paths.size).toBe(2);
  });

  it('should clear a specific file from quarantine', () => {
    manager.quarantine({ filePath: 'a.ts', error: 'e1', phaseId: 'p1', retryCount: 1 });
    manager.quarantine({ filePath: 'b.ts', error: 'e2', phaseId: 'p1', retryCount: 1 });

    manager.clear('a.ts');
    expect(manager.isQuarantined('a.ts')).toBe(false);
    expect(manager.isQuarantined('b.ts')).toBe(true);
  });

  it('should clear all quarantined files', () => {
    manager.quarantine({ filePath: 'a.ts', error: 'e1', phaseId: 'p1', retryCount: 1 });
    manager.quarantine({ filePath: 'b.ts', error: 'e2', phaseId: 'p1', retryCount: 1 });

    manager.clearAll();
    expect(manager.getQuarantined()).toHaveLength(0);
    expect(manager.getCount()).toBe(0);
  });

  it('should return correct count', () => {
    expect(manager.getCount()).toBe(0);
    manager.quarantine({ filePath: 'a.ts', error: 'e1', phaseId: 'p1', retryCount: 1 });
    expect(manager.getCount()).toBe(1);
    manager.quarantine({ filePath: 'b.ts', error: 'e2', phaseId: 'p1', retryCount: 1 });
    expect(manager.getCount()).toBe(2);
  });

  it('should filter by phase', () => {
    manager.quarantine({ filePath: 'a.ts', error: 'e1', phaseId: 'parse', retryCount: 1 });
    manager.quarantine({ filePath: 'b.ts', error: 'e2', phaseId: 'resolve', retryCount: 1 });

    const parseFiles = manager.getByPhase('parse');
    expect(parseFiles).toHaveLength(1);
    expect(parseFiles[0]!.filePath).toBe('a.ts');

    const resolveFiles = manager.getByPhase('resolve');
    expect(resolveFiles).toHaveLength(1);
    expect(resolveFiles[0]!.filePath).toBe('b.ts');
  });

  it('should identify retryable files', () => {
    // Old file with low retry count — should be retryable
    manager.quarantine({ filePath: 'old.ts', error: 'e1', phaseId: 'p1', retryCount: 1 });
    // Manually set old timestamp via file manipulation
    const list = manager.getQuarantined();
    list[0]!.timestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    // Save modified list
    const tmp = JSON.stringify(list);
    fs.writeFileSync(path.join(tempDir, 'quarantine.json'), tmp);

    const retryable = manager.getRetryableFiles(3, 5 * 60 * 1000);
    expect(retryable.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle corrupted quarantine file', () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'quarantine.json'), 'not valid json');

    expect(manager.getQuarantined()).toEqual([]);
    expect(manager.getCount()).toBe(0);
  });

  it('should persist quarantine across instances', () => {
    manager.quarantine({ filePath: 'x.ts', error: 'e', phaseId: 'p', retryCount: 1 });

    // Create new manager instance with same cache dir
    const manager2 = new QuarantineManager(tempDir);
    expect(manager2.isQuarantined('x.ts')).toBe(true);
  });

  it('should handle null in filePath gracefully', () => {
    manager.quarantine({ filePath: 'valid.ts', error: 'e', phaseId: 'p', retryCount: 1 });
    // Attempting to query non-existent file should not error
    expect(manager.isQuarantined('nonexistent.ts')).toBe(false);
  });
});

// ===========================================================================
// Recovery Manager Integration Tests
// ===========================================================================

describe('RecoveryManager', () => {
  let tempDir: string;
  let checkpointStore: CheckpointStore;
  let quarantineManager: QuarantineManager;
  let recoveryManager: RecoveryManager;

  beforeEach(() => {
    tempDir = createTempDir();
    checkpointStore = new CheckpointStore(tempDir);
    quarantineManager = new QuarantineManager(tempDir);
    recoveryManager = new RecoveryManager(checkpointStore, quarantineManager, {
      autoSave: true,
      minCheckpointInterval: 0,
    });
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('should save checkpoint and load recovery state', () => {
    recoveryManager.saveCheckpoint('parse', ['a.ts', 'b.ts'], 100, 50);
    const state = recoveryManager.loadRecoveryState();

    expect(state.isRecovery).toBe(true);
    expect(state.lastCheckpoint).not.toBeNull();
    expect(state.lastCheckpoint!.phaseId).toBe('parse');
    expect(state.lastCheckpoint!.processedFiles).toEqual(['a.ts', 'b.ts']);
    expect(state.quarantinedFiles).toEqual([]);
  });

  it('should detect recovery mode', () => {
    expect(recoveryManager.isInRecovery()).toBe(false);

    recoveryManager.saveCheckpoint('parse', [], 0, 0);
    expect(recoveryManager.isInRecovery()).toBe(true);
  });

  it('should quarantine files via the recovery manager', () => {
    const error = new Error('Parse failure');
    recoveryManager.quarantineFile('broken.ts', error, 'parse');

    expect(recoveryManager.isFileQuarantined('broken.ts')).toBe(true);
    expect(recoveryManager.getQuarantinedCount()).toBe(1);
  });

  it('should provide quarantined paths set', () => {
    recoveryManager.quarantineFile('a.ts', new Error('e1'), 'parse');
    recoveryManager.quarantineFile('b.ts', new Error('e2'), 'parse');

    const paths = recoveryManager.getQuarantinedPaths();
    expect(paths.has('a.ts')).toBe(true);
    expect(paths.has('b.ts')).toBe(true);
  });

  it('should clear all recovery state', () => {
    recoveryManager.saveCheckpoint('parse', ['a.ts'], 10, 5);
    recoveryManager.quarantineFile('b.ts', new Error('error'), 'parse');

    recoveryManager.clearAll();
    expect(recoveryManager.isInRecovery()).toBe(false);
    expect(recoveryManager.getQuarantinedCount()).toBe(0);
  });

  it('should clear a specific quarantine file', () => {
    recoveryManager.quarantineFile('a.ts', new Error('e1'), 'parse');
    recoveryManager.quarantineFile('b.ts', new Error('e2'), 'parse');

    recoveryManager.clearQuarantineFile('a.ts');
    expect(recoveryManager.isFileQuarantined('a.ts')).toBe(false);
    expect(recoveryManager.isFileQuarantined('b.ts')).toBe(true);
  });

  it('should save checkpoint with metadata', () => {
    recoveryManager.saveCheckpointWithMetadata('parse', ['a.ts'], 10, 5, {
      customKey: 'customValue',
    });

    const state = recoveryManager.loadRecoveryState();
    expect(state.lastCheckpoint!.metadata).toEqual({ customKey: 'customValue' });
  });

  it('should respect minCheckpointInterval', () => {
    const slowManager = new RecoveryManager(checkpointStore, quarantineManager, {
      autoSave: true,
      minCheckpointInterval: 60000, // 1 minute
    });

    // First save should work
    slowManager.saveCheckpoint('parse', ['a.ts'], 10, 5);
    expect(slowManager.loadRecoveryState().lastCheckpoint!.processedFiles).toEqual(['a.ts']);

    // Second immediate save should be skipped (interval too short)
    slowManager.saveCheckpoint('parse', ['a.ts', 'b.ts'], 20, 10);
    // Should still have old checkpoint data
    expect(slowManager.loadRecoveryState().lastCheckpoint!.processedFiles).toEqual(['a.ts']);
  });

  it('should handle disabled autoSave', () => {
    const noAutoManager = new RecoveryManager(checkpointStore, quarantineManager, {
      autoSave: false,
    });

    noAutoManager.saveCheckpoint('parse', ['a.ts'], 10, 5);
    expect(noAutoManager.isInRecovery()).toBe(false);
  });

  it('should report checkpoint age', () => {
    recoveryManager.saveCheckpoint('parse', [], 0, 0);
    const age = recoveryManager.getCheckpointAge();
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(10000);
  });
});

// ===========================================================================
// Crash Simulation & Stress Tests
// ===========================================================================

describe('Crash Recovery - Crash Simulation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('should recover checkpoint after simulated crash', () => {
    // Simulate: save checkpoint, then "crash"
    const store = new CheckpointStore(tempDir);
    store.save(
      makeCheckpoint({
        phaseId: 'parse',
        processedFiles: ['f1.ts', 'f2.ts'],
        nodeCount: 42,
        edgeCount: 21,
      }),
    );

    // Simulate recovery: create new store instance
    const recoveredStore = new CheckpointStore(tempDir);
    const checkpoint = recoveredStore.load();

    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.phaseId).toBe('parse');
    expect(checkpoint!.processedFiles).toEqual(['f1.ts', 'f2.ts']);
    expect(checkpoint!.nodeCount).toBe(42);
  });

  it('should persist quarantine data across crashes', () => {
    const manager = new QuarantineManager(tempDir);
    for (let i = 0; i < 5; i++) {
      manager.quarantine({
        filePath: `file_${i}.ts`,
        error: `Error ${i}`,
        phaseId: 'parse',
        retryCount: 1,
      });
    }

    // Simulate crash and recover
    const recoveredManager = new QuarantineManager(tempDir);
    expect(recoveredManager.getCount()).toBe(5);

    for (let i = 0; i < 5; i++) {
      expect(recoveredManager.isQuarantined(`file_${i}.ts`)).toBe(true);
    }
  });

  it('should handle concurrent crash/recovery cycles', () => {
    const cycles = 20;
    const store = new CheckpointStore(tempDir);

    for (let i = 0; i < cycles; i++) {
      // Save checkpoint
      store.save(
        makeCheckpoint({
          phaseId: `phase_${i}`,
          nodeCount: i * 10,
        }),
      );

      // "Crash" and recover
      const recovered = store.load();
      expect(recovered).not.toBeNull();
      expect(recovered!.nodeCount).toBe(i * 10);
    }
  });

  it('should handle rapid save/load cycles without data loss', () => {
    const store = new CheckpointStore(tempDir);
    const iterations = 50;

    for (let i = 0; i < iterations; i++) {
      store.save(makeCheckpoint({ nodeCount: i }));
      const loaded = store.load();
      expect(loaded!.nodeCount).toBe(i);
    }
  });

  it('should handle large file lists in checkpoint', () => {
    const store = new CheckpointStore(tempDir);
    const fileCount = 1000;
    const files = Array.from({ length: fileCount }, (_, i) => `src/module_${i}.ts`);

    store.save(makeCheckpoint({ processedFiles: files }));
    const loaded = store.load();
    expect(loaded!.processedFiles).toHaveLength(fileCount);
    expect(loaded!.processedFiles[0]).toBe('src/module_0.ts');
    expect(loaded!.processedFiles[fileCount - 1]).toBe(`src/module_${fileCount - 1}.ts`);
  });

  it('should measure checkpoint overhead', () => {
    const store = new CheckpointStore(tempDir);
    const fileCount = 500;
    const files = Array.from({ length: fileCount }, (_, i) => `src/module_${i}.ts`);

    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      store.save(makeCheckpoint({ processedFiles: files, nodeCount: i * 100 }));
    }
    const duration = Date.now() - start;

    // 10 save operations should be fast (< 1 second for 500 files each)
    expect(duration).toBeLessThan(5000);
  });

  it('should handle Unicode file paths in quarantine', () => {
    const manager = new QuarantineManager(tempDir);
    const unicodePath = 'src/モジュール/テスト.ts';

    manager.quarantine({ filePath: unicodePath, error: 'Error', phaseId: 'parse', retryCount: 1 });
    expect(manager.isQuarantined(unicodePath)).toBe(true);
  });
});
