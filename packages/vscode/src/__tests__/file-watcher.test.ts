// @code-analyzer/vscode — File Watcher Tests

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  FileWatcherService,
  DEFAULT_WATCHER_CONFIG,
} from '../services/file-watcher.js';
import type {
  WatcherConfig,
  FileSystemWatcher,
  WatcherFactory,
} from '../services/file-watcher.js';
import { EngineBridge } from '../services/engine-bridge.js';

// ---------------------------------------------------------------------------
// Fake FileSystemWatcher for testing
// ---------------------------------------------------------------------------

interface FakeWatcher {
  onDidCreateListeners: Array<(uri: { fsPath: string }) => void>;
  onDidChangeListeners: Array<(uri: { fsPath: string }) => void>;
  onDidDeleteListeners: Array<(uri: { fsPath: string }) => void>;
}

function createFakeWatcher(): FileSystemWatcher & { _fake: FakeWatcher } {
  const fake: FakeWatcher = {
    onDidCreateListeners: [],
    onDidChangeListeners: [],
    onDidDeleteListeners: [],
  };

  return {
    _fake: fake,
    onDidCreate(listener: (uri: { fsPath: string }) => void) {
      fake.onDidCreateListeners.push(listener);
      return { dispose() {} };
    },
    onDidChange(listener: (uri: { fsPath: string }) => void) {
      fake.onDidChangeListeners.push(listener);
      return { dispose() {} };
    },
    onDidDelete(listener: (uri: { fsPath: string }) => void) {
      fake.onDidDeleteListeners.push(listener);
      return { dispose() {} };
    },
    dispose() {},
  };
}

function makeWatcherFactory(): WatcherFactory & { watchers: Array<FileSystemWatcher & { _fake: FakeWatcher }> } {
  const watchers: Array<FileSystemWatcher & { _fake: FakeWatcher }> = [];

  return {
    watchers,
    createFileSystemWatcher(pattern: string): FileSystemWatcher {
      const w = createFakeWatcher();
      watchers.push(w);
      return w;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileWatcherService', () => {
  let engine: EngineBridge;

  beforeEach(() => {
    engine = new EngineBridge();
    engine.setProjectId('test');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('start/stop', () => {
    it('starts without error', () => {
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, DEFAULT_WATCHER_CONFIG, factory);
      watcher.start();
      expect(watcher.running).toBe(true);
      expect(factory.watchers.length).toBe(DEFAULT_WATCHER_CONFIG.filePatterns.length);
      watcher.dispose();
    });

    it('does not start when disabled in config', () => {
      const config: WatcherConfig = { ...DEFAULT_WATCHER_CONFIG, enabled: false };
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, config, factory);
      watcher.start();
      expect(watcher.running).toBe(false);
      watcher.dispose();
    });

    it('stops cleanly', () => {
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, DEFAULT_WATCHER_CONFIG, factory);
      watcher.start();
      expect(watcher.running).toBe(true);
      watcher.stop();
      expect(watcher.running).toBe(false);
      expect(watcher.pendingCount).toBe(0);
    });

    it('does not start twice', () => {
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, DEFAULT_WATCHER_CONFIG, factory);
      watcher.start();
      const count = factory.watchers.length;
      watcher.start(); // second start — no-op
      expect(factory.watchers.length).toBe(count);
      watcher.dispose();
    });

    it('dispose calls stop', () => {
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, DEFAULT_WATCHER_CONFIG, factory);
      watcher.start();
      expect(watcher.running).toBe(true);
      watcher.dispose();
      expect(watcher.running).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // File Change Detection
  // -------------------------------------------------------------------------

  describe('file change detection', () => {
    it('adds file to pending changes on change event', () => {
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, DEFAULT_WATCHER_CONFIG, factory);
      watcher.start();

      const fw = factory.watchers[0]!;
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/auth.ts' });

      expect(watcher.getChangedFiles()).toContain('/src/auth.ts');
      expect(watcher.pendingCount).toBe(1);
      watcher.dispose();
    });

    it('adds file to pending changes on create event', () => {
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, DEFAULT_WATCHER_CONFIG, factory);
      watcher.start();

      const fw = factory.watchers[0]!;
      fw._fake.onDidCreateListeners[0]!({ fsPath: '/src/newFile.ts' });

      expect(watcher.getChangedFiles()).toContain('/src/newFile.ts');
      watcher.dispose();
    });

    it('adds file to pending changes on delete event', () => {
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, DEFAULT_WATCHER_CONFIG, factory);
      watcher.start();

      const fw = factory.watchers[0]!;
      fw._fake.onDidDeleteListeners[0]!({ fsPath: '/src/oldFile.ts' });

      expect(watcher.getChangedFiles()).toContain('/src/oldFile.ts');
      watcher.dispose();
    });

    it('deduplicates pending changes', () => {
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, DEFAULT_WATCHER_CONFIG, factory);
      watcher.start();

      const fw = factory.watchers[0]!;
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/auth.ts' });
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/auth.ts' });

      expect(watcher.pendingCount).toBe(1);
      watcher.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // Debouncing
  // -------------------------------------------------------------------------

  describe('debouncing', () => {
    it('batches multiple changes within debounce window', () => {
      const factory = makeWatcherFactory();
      const config: WatcherConfig = { ...DEFAULT_WATCHER_CONFIG, debounceMs: 100 };
      const watcher = new FileWatcherService(engine, config, factory);
      watcher.start();

      const fw = factory.watchers[0]!;
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/file1.ts' });
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/file2.ts' });
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/file3.ts' });

      // All three should be pending before flushing
      expect(watcher.pendingCount).toBe(3);

      watcher.dispose();
    });

    it('resets debounce timer on new change', () => {
      const factory = makeWatcherFactory();
      const config: WatcherConfig = { ...DEFAULT_WATCHER_CONFIG, debounceMs: 100 };
      const watcher = new FileWatcherService(engine, config, factory);
      watcher.start();

      const fw = factory.watchers[0]!;

      // First change
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/file1.ts' });
      vi.advanceTimersByTime(50);

      // Second change resets timer
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/file2.ts' });
      vi.advanceTimersByTime(50);

      // Still pending because timer was reset
      expect(watcher.pendingCount).toBe(2);

      // Advance past full debounce time
      vi.advanceTimersByTime(100);

      watcher.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // Pattern Matching (Exclusions)
  // -------------------------------------------------------------------------

  describe('pattern matching (exclusions)', () => {
    it('excludes node_modules files', () => {
      const factory = makeWatcherFactory();
      const config: WatcherConfig = {
        ...DEFAULT_WATCHER_CONFIG,
        excludePatterns: ['**/node_modules/**'],
      };
      const watcher = new FileWatcherService(engine, config, factory);
      watcher.start();

      const fw = factory.watchers[0]!;
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/project/node_modules/pkg/index.js' });

      expect(watcher.pendingCount).toBe(0);
      watcher.dispose();
    });

    it('excludes dist files', () => {
      const factory = makeWatcherFactory();
      const config: WatcherConfig = {
        ...DEFAULT_WATCHER_CONFIG,
        excludePatterns: ['**/dist/**'],
      };
      const watcher = new FileWatcherService(engine, config, factory);
      watcher.start();

      const fw = factory.watchers[0]!;
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/project/dist/bundle.js' });

      expect(watcher.pendingCount).toBe(0);
      watcher.dispose();
    });

    it('excludes .git files', () => {
      const factory = makeWatcherFactory();
      const config: WatcherConfig = {
        ...DEFAULT_WATCHER_CONFIG,
        excludePatterns: ['**/.git/**'],
      };
      const watcher = new FileWatcherService(engine, config, factory);
      watcher.start();

      const fw = factory.watchers[0]!;
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/project/.git/config' });

      expect(watcher.pendingCount).toBe(0);
      watcher.dispose();
    });

    it('includes source files that are not excluded', () => {
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, DEFAULT_WATCHER_CONFIG, factory);
      watcher.start();

      const fw = factory.watchers[0]!;
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/project/src/main.ts' });

      expect(watcher.pendingCount).toBe(1);
      expect(watcher.getChangedFiles()).toContain('/project/src/main.ts');
      watcher.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // Incremental Indexing
  // -------------------------------------------------------------------------

  describe('incremental indexing', () => {
    it('triggers incremental reindex after debounce', async () => {
      const factory = makeWatcherFactory();
      const config: WatcherConfig = { ...DEFAULT_WATCHER_CONFIG, debounceMs: 100 };
      const watcher = new FileWatcherService(engine, config, factory);
      watcher.start();

      // Spy on the engine's incrementalReindex method
      const reindexSpy = vi.spyOn(engine, 'incrementalReindex');

      const fw = factory.watchers[0]!;
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/auth.ts' });

      // Advance timer past debounce
      vi.advanceTimersByTime(100);
      // Wait for the async flush
      await vi.runAllTimersAsync();

      expect(reindexSpy).toHaveBeenCalledWith(['/src/auth.ts']);
      expect(watcher.pendingCount).toBe(0);

      reindexSpy.mockRestore();
      watcher.dispose();
    });

    it('batches multiple files in one reindex call', async () => {
      const factory = makeWatcherFactory();
      const config: WatcherConfig = { ...DEFAULT_WATCHER_CONFIG, debounceMs: 100 };
      const watcher = new FileWatcherService(engine, config, factory);
      watcher.start();

      const reindexSpy = vi.spyOn(engine, 'incrementalReindex');

      const fw = factory.watchers[0]!;
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/file1.ts' });
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/file2.ts' });
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/file3.ts' });

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      expect(reindexSpy).toHaveBeenCalledTimes(1);
      expect(reindexSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['/src/file1.ts', '/src/file2.ts', '/src/file3.ts']),
      );

      reindexSpy.mockRestore();
      watcher.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // getChangedFiles
  // -------------------------------------------------------------------------

  describe('getChangedFiles', () => {
    it('returns empty array when no changes', () => {
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, DEFAULT_WATCHER_CONFIG, factory);
      watcher.start();

      expect(watcher.getChangedFiles()).toEqual([]);
      watcher.dispose();
    });

    it('returns pending file paths', () => {
      const factory = makeWatcherFactory();
      const watcher = new FileWatcherService(engine, DEFAULT_WATCHER_CONFIG, factory);
      watcher.start();

      const fw = factory.watchers[0]!;
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/a.ts' });
      fw._fake.onDidChangeListeners[0]!({ fsPath: '/src/b.ts' });

      const files = watcher.getChangedFiles();
      expect(files).toHaveLength(2);
      expect(files).toContain('/src/a.ts');
      expect(files).toContain('/src/b.ts');
      watcher.dispose();
    });
  });
});
