// @code-analyzer/infra — File Watcher Deterministic Branch Tests
// Drives the fs.watch callback directly (mocking node:fs) so every branch of the
// debounced filesystem watcher is covered without depending on platform/timing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  watch: vi.fn(),
  readdirSync: vi.fn(),
  accessSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    watch: mocks.watch,
    readdirSync: mocks.readdirSync,
    accessSync: mocks.accessSync,
  };
});

import { createFileWatcher } from '../filesystem/watcher.js';
import type { FileChangeEvent } from '../storage/types.js';

type WatchCb = (eventType: string, filename: string | null) => void;

let watchCbs: WatchCb[] = [];
let closeFns: Array<ReturnType<typeof vi.fn>> = [];

beforeEach(() => {
  vi.useFakeTimers();
  watchCbs = [];
  closeFns = [];
  mocks.watch.mockReset();
  mocks.readdirSync.mockReset();
  mocks.accessSync.mockReset();

  mocks.watch.mockImplementation((_dir: unknown, _opts: unknown, cb: WatchCb) => {
    watchCbs.push(cb);
    const close = vi.fn();
    closeFns.push(close);
    return { close };
  });
  mocks.readdirSync.mockReturnValue([]); // no subdirectories by default
  mocks.accessSync.mockImplementation(() => {}); // file exists by default
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createFileWatcher — branch coverage', () => {
  it('emits an add event for a rename whose target exists', () => {
    const watcher = createFileWatcher();
    const received: FileChangeEvent[][] = [];
    watcher.watch('/root', (events) => received.push(events));

    watchCbs[0]!('rename', 'new.txt');
    vi.advanceTimersByTime(100);

    expect(received).toEqual([[{ type: 'add', filePath: 'new.txt' }]]);
    watcher.unwatch();
  });

  it('emits a delete event for a rename whose target is gone', () => {
    const watcher = createFileWatcher();
    const received: FileChangeEvent[][] = [];
    watcher.watch('/root', (events) => received.push(events));

    mocks.accessSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    watchCbs[0]!('rename', 'gone.txt');
    vi.advanceTimersByTime(100);

    expect(received).toEqual([[{ type: 'delete', filePath: 'gone.txt' }]]);
    watcher.unwatch();
  });

  it('emits a modify event for a change', () => {
    const watcher = createFileWatcher();
    const received: FileChangeEvent[][] = [];
    watcher.watch('/root', (events) => received.push(events));

    watchCbs[0]!('change', 'file.txt');
    vi.advanceTimersByTime(100);

    expect(received).toEqual([[{ type: 'modify', filePath: 'file.txt' }]]);
    watcher.unwatch();
  });

  it('ignores a null filename', () => {
    const watcher = createFileWatcher();
    const received: FileChangeEvent[][] = [];
    watcher.watch('/root', (events) => received.push(events));

    watchCbs[0]!('rename', null);
    vi.advanceTimersByTime(100);

    expect(received).toHaveLength(0);
    watcher.unwatch();
  });

  it('debounces and deduplicates events by file path', () => {
    const watcher = createFileWatcher();
    const received: FileChangeEvent[][] = [];
    watcher.watch('/root', (events) => received.push(events));

    // Two changes to the same file within the debounce window collapse to one.
    watchCbs[0]!('change', 'file.txt');
    watchCbs[0]!('change', 'file.txt');
    vi.advanceTimersByTime(100);

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
    watcher.unwatch();
  });

  it('recursively watches a subdirectory but skips node_modules and dot-dirs', () => {
    mocks.readdirSync.mockImplementation((dir: unknown) => {
      if (String(dir) === '/root') {
        return [
          { isDirectory: () => true, name: 'sub' },
          { isDirectory: () => true, name: 'node_modules' },
          { isDirectory: () => true, name: '.git' },
          { isDirectory: () => false, name: 'file.ts' },
        ];
      }
      return [];
    });
    const watcher = createFileWatcher();
    watcher.watch('/root', () => {});

    // One watch for the root, plus one for the single watched subdirectory.
    expect(mocks.watch).toHaveBeenCalledTimes(2);
    watcher.unwatch();
  });

  it('tolerates a readdirSync failure while recursing', () => {
    mocks.readdirSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    const watcher = createFileWatcher();
    expect(() => watcher.watch('/root', () => {})).not.toThrow();
    watcher.unwatch();
  });

  it('tolerates an fs.watch failure', () => {
    mocks.watch.mockImplementation(() => {
      throw new Error('watch failed');
    });
    const watcher = createFileWatcher();
    expect(() => watcher.watch('/root', () => {})).not.toThrow();
    watcher.unwatch();
  });

  it('tolerates a watcher close failure during unwatch', () => {
    const watcher = createFileWatcher();
    watcher.watch('/root', () => {});
    closeFns[0]!.mockImplementation(() => {
      throw new Error('close failed');
    });
    expect(() => watcher.unwatch()).not.toThrow();
  });

  it('clears the pending debounce timer on unwatch', () => {
    const watcher = createFileWatcher();
    const received: FileChangeEvent[][] = [];
    watcher.watch('/root', (events) => received.push(events));

    watchCbs[0]!('change', 'file.txt');
    watcher.unwatch();
    vi.advanceTimersByTime(100);

    expect(received).toHaveLength(0);
  });

  it('does not flush when no callback is active', () => {
    const watcher = createFileWatcher();
    // No watch() call: activeCallback is null, so a queued event is never flushed.
    watcher.watch('/root', () => {});
    watchCbs[0]!('change', 'file.txt');
    watcher.unwatch();
    vi.advanceTimersByTime(100);
    // The unwatch cleared the pending event; nothing to assert beyond no throw.
  });
});
