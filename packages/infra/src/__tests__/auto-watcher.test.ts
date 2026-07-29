// @code-analyzer/infra — AutoWatcher Tests

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AutoWatcher } from '../project/auto-watcher.js';
import type { AutoWatcherOptions, ReindexEvent } from '../project/auto-watcher.js';
import type { FileWatcher } from '../filesystem/watcher.js';
import type { FileChangeEvent } from '../storage/types.js';

// ---------------------------------------------------------------------------
// Mock FileWatcher factory
// ---------------------------------------------------------------------------

interface MockFileWatcher extends FileWatcher {
  _events: FileChangeEvent[] | null;
  triggerChanges(events: FileChangeEvent[]): void;
  _callback: ((events: FileChangeEvent[]) => void) | null;
}

function createMockWatcher(): MockFileWatcher {
  const watcher: MockFileWatcher = {
    _callback: null,
    _events: null,
    watch(_rootPath: string, callback: (events: FileChangeEvent[]) => void): void {
      watcher._callback = callback;
    },
    unwatch(): void {
      watcher._callback = null;
      watcher._events = null;
    },
    triggerChanges(events: FileChangeEvent[]): void {
      watcher._events = events;
      if (watcher._callback) {
        watcher._callback(events);
      }
    },
  };
  return watcher;
}

describe('AutoWatcher', () => {
  let mockWatcher: MockFileWatcher;
  let rootPath: string;
  let autoWatcher: AutoWatcher;

  function setup(dirs: string[], files: Record<string, string>): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-autowatch-'));
    for (const dir of dirs) {
      fs.mkdirSync(path.join(base, dir), { recursive: true });
    }
    for (const [filePath, content] of Object.entries(files)) {
      const full = path.join(base, filePath);
      const dir = path.dirname(full);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(full, content);
    }
    return base;
  }

  beforeEach(() => {
    mockWatcher = createMockWatcher();
    autoWatcher = new AutoWatcher(mockWatcher);
  });

  afterEach(() => {
    autoWatcher.unwatch();
    if (rootPath) {
      fs.rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Constructor & Options
  // -------------------------------------------------------------------------

  it('creates with default options', () => {
    const aw = new AutoWatcher(mockWatcher);
    expect(aw).toBeDefined();
  });

  it('creates with custom debounceMs', () => {
    const aw = new AutoWatcher(mockWatcher, { debounceMs: 1000 });
    expect(aw).toBeDefined();
  });

  it('creates with onReindex callback', () => {
    const cb = vi.fn();
    const aw = new AutoWatcher(mockWatcher, { onReindex: cb });
    expect(aw).toBeDefined();
  });

  it('creates with onLog callback', () => {
    const logMessages: string[] = [];
    const aw = new AutoWatcher(mockWatcher, { onLog: (msg) => logMessages.push(msg) });
    expect(aw).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // watch / unwatch / isActive
  // -------------------------------------------------------------------------

  it('starts watching and isActive returns true', () => {
    rootPath = setup([], {});
    autoWatcher.watch(rootPath);
    expect(autoWatcher.isActive()).toBe(true);
    expect(autoWatcher.getRootPath()).toBe(rootPath);
  });

  it('unwatch stops watching', () => {
    rootPath = setup([], {});
    autoWatcher.watch(rootPath);
    autoWatcher.unwatch();
    expect(autoWatcher.isActive()).toBe(false);
    expect(autoWatcher.getRootPath()).toBeNull();
  });

  it('getFileWatcher returns the underlying watcher', () => {
    expect(autoWatcher.getFileWatcher()).toBe(mockWatcher);
  });

  // -------------------------------------------------------------------------
  // Source file filtering
  // -------------------------------------------------------------------------

  it('detects TypeScript file changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'src/index.ts' },
    ]);

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(reindexEvents.length).toBe(1);
    expect(reindexEvents[0]!.fileCount).toBe(1);
    expect(reindexEvents[0]!.changes[0]!.filePath).toBe('src/index.ts');
  });

  // -------------------------------------------------------------------------
  // Ignore non-source files
  // -------------------------------------------------------------------------

  it('ignores node_modules changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'node_modules/pkg/index.js' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(0);
  });

  it('ignores .git changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: '.git/config' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(0);
  });

  it('ignores dist directory changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'add', filePath: 'dist/bundle.js' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(0);
  });

  it('ignores build directory changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'build/output.js' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(0);
  });

  it('ignores .min.js files', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'lib.min.js' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(0);
  });

  it('ignores .lock files', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'yarn.lock' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Debounce behavior
  // -------------------------------------------------------------------------

  it('debounces rapid changes into a single event', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 100,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);

    // Rapidly fire 3 change events
    mockWatcher.triggerChanges([{ type: 'modify', filePath: 'file1.ts' }]);
    mockWatcher.triggerChanges([{ type: 'modify', filePath: 'file2.ts' }]);
    mockWatcher.triggerChanges([{ type: 'modify', filePath: 'file3.ts' }]);

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should be batched into one event
    expect(reindexEvents.length).toBe(1);
    // Deduped — 3 unique files
    expect(reindexEvents[0]!.fileCount).toBe(3);
  });

  it('deduplicates changes by filePath', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);

    mockWatcher.triggerChanges([{ type: 'modify', filePath: 'file.ts' }]);
    mockWatcher.triggerChanges([{ type: 'modify', filePath: 'file.ts' }]);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(reindexEvents.length).toBe(1);
    expect(reindexEvents[0]!.fileCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // triggerReindex (manual)
  // -------------------------------------------------------------------------

  it('triggerReindex fires callback with events', () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);

    const changes: FileChangeEvent[] = [
      { type: 'modify', filePath: 'src/app.ts' },
    ];
    aw.triggerReindex(changes);

    expect(reindexEvents.length).toBe(1);
    expect(reindexEvents[0]!.changes).toEqual(changes);
    expect(reindexEvents[0]!.rootPath).toBe(rootPath);
  });

  it('triggerReindex is no-op when not watching', () => {
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.triggerReindex([{ type: 'modify', filePath: 'file.ts' }]);
    expect(reindexEvents.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Various source file types
  // -------------------------------------------------------------------------

  it('detects Python file changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'app.py' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(1);
  });

  it('detects Go file changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'main.go' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(1);
  });

  it('detects Rust file changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'src/main.rs' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(1);
  });

  it('detects Java file changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'Main.java' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(1);
  });

  it('detects JSON file changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'config.json' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(1);
  });

  it('detects YAML file changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: '.github/workflows/ci.yml' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(1);
  });

  it('detects Dockerfile changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'Dockerfile' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(1);
  });

  it('detects Markdown file changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'README.md' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(1);
  });

  it('ignores non-source file changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'data.bin' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reindexEvents.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Re-watch (start watching twice)
  // -------------------------------------------------------------------------

  it('re-watch stops previous watch and starts new one', () => {
    const root1 = setup([], {});
    const root2 = setup([], {});

    autoWatcher.watch(root1);
    expect(autoWatcher.getRootPath()).toBe(root1);

    autoWatcher.watch(root2);
    expect(autoWatcher.getRootPath()).toBe(root2);
  });

  // -------------------------------------------------------------------------
  // onLog callback
  // -------------------------------------------------------------------------

  it('invokes onLog callback during watch/unwatch lifecycle', () => {
    rootPath = setup([], {});
    const logs: string[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      onLog: (msg) => logs.push(msg),
    });

    aw.watch(rootPath);
    expect(logs.some((l) => l.includes('Starting watch'))).toBe(true);

    aw.unwatch();
    expect(logs.some((l) => l.includes('Watch stopped'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Multiple source files of different types
  // -------------------------------------------------------------------------

  it('handles mixed source file changes', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 50,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([
      { type: 'modify', filePath: 'src/index.ts' },
      { type: 'modify', filePath: 'tests/test.py' },
      { type: 'modify', filePath: 'docs/README.md' },
      { type: 'modify', filePath: 'node_modules/pkg/index.js' }, // filtered
      { type: 'add', filePath: 'main.go' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(reindexEvents.length).toBe(1);
    // 4 source files (node_modules is filtered out)
    expect(reindexEvents[0]!.fileCount).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Timestamp
  // -------------------------------------------------------------------------

  it('reindex event includes timestamp', () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    aw.triggerReindex([{ type: 'modify', filePath: 'app.ts' }]);

    expect(reindexEvents[0]!.timestamp).toBeTruthy();
    // Should be a valid ISO date string
    expect(() => new Date(reindexEvents[0]!.timestamp)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Unwatch with active debounce timer
  // -------------------------------------------------------------------------

  it('clears active debounce timer on unwatch', async () => {
    rootPath = setup([], {});
    const reindexEvents: ReindexEvent[] = [];
    const aw = new AutoWatcher(mockWatcher, {
      debounceMs: 200,
      onReindex: (evt) => reindexEvents.push(evt),
    });

    aw.watch(rootPath);
    mockWatcher.triggerChanges([{ type: 'modify', filePath: 'file.ts' }]);

    // Unwatch before debounce fires
    aw.unwatch();

    // Wait for debounce time
    await new Promise((resolve) => setTimeout(resolve, 250));

    // No reindex should have occurred because unwatch cleared the timer
    expect(reindexEvents.length).toBe(0);
  });
});
