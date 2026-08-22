import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createFileWatcher, type FileWatcher } from '../filesystem/watcher.js';
import type { FileChangeEvent } from '../storage/types.js';

// Helper to create a temp directory and clean it up.
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ca-watcher-'));
}

async function waitForEvents(
  watcher: FileWatcher,
  root: string,
  action: () => void,
  timeoutMs = 2000,
): Promise<FileChangeEvent[]> {
  return new Promise((resolve, reject) => {
    const events: FileChangeEvent[] = [];
    const timer = setTimeout(() => {
      watcher.unwatch();
      resolve(events);
    }, timeoutMs);

    watcher.watch(root, (evts) => {
      events.push(...evts);
      // Once we have at least one event, resolve shortly after (debounce window).
      clearTimeout(timer);
      const t2 = setTimeout(() => {
        watcher.unwatch();
        resolve(events);
      }, 200);
      // Keep t2 referenced to avoid premature GC in older Node.
      void t2;
    });

    // Trigger the file operation after the watcher is set up.
    setTimeout(action, 50);
  });
}

describe('createFileWatcher', () => {
  let roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    roots = [];
  });

  it('creates a watcher with watch/unwatch API', () => {
    const watcher = createFileWatcher();
    expect(typeof watcher.watch).toBe('function');
    expect(typeof watcher.unwatch).toBe('function');
    watcher.unwatch();
  });

  it('detects a newly created file (add event)', async () => {
    const root = makeTempDir();
    roots.push(root);
    const watcher = createFileWatcher();
    const events = await waitForEvents(watcher, root, () => {
      fs.writeFileSync(path.join(root, 'new.txt'), 'hello');
    });
    // fs.watch fires both 'rename' (→ add via accessSync) and 'change' (→ modify).
    // Accept either signal as evidence the watcher observed the creation.
    expect(events.some((e) => e.filePath.includes('new.txt'))).toBe(true);
  });

  it('detects a modified file (modify event)', async () => {
    const root = makeTempDir();
    roots.push(root);
    const existing = path.join(root, 'existing.txt');
    fs.writeFileSync(existing, 'v1');
    const watcher = createFileWatcher();
    const events = await waitForEvents(watcher, root, () => {
      fs.writeFileSync(existing, 'v2');
    });
    expect(events.some((e) => e.type === 'modify')).toBe(true);
  });

  it('detects a deleted file (delete event)', async () => {
    const root = makeTempDir();
    roots.push(root);
    const doomed = path.join(root, 'doomed.txt');
    fs.writeFileSync(doomed, 'bye');
    const watcher = createFileWatcher();
    const events = await waitForEvents(watcher, root, () => {
      fs.unlinkSync(doomed);
    });
    expect(events.some((e) => e.type === 'delete')).toBe(true);
  });

  it('recursively watches subdirectories', async () => {
    const root = makeTempDir();
    roots.push(root);
    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub);
    const watcher = createFileWatcher();
    const events = await waitForEvents(watcher, root, () => {
      fs.writeFileSync(path.join(sub, 'nested.txt'), 'x');
    });
    expect(events.some((e) => e.filePath.includes('nested.txt'))).toBe(true);
  });

  it('ignores node_modules directories', async () => {
    const root = makeTempDir();
    roots.push(root);
    const nm = path.join(root, 'node_modules');
    fs.mkdirSync(nm);
    const watcher = createFileWatcher();
    const events = await waitForEvents(watcher, root, () => {
      fs.writeFileSync(path.join(nm, 'ignored.txt'), 'x');
    });
    // The node_modules file should NOT be reported.
    expect(events.some((e) => e.filePath.includes('node_modules'))).toBe(false);
  });

  it('unwatch stops emitting events', async () => {
    const root = makeTempDir();
    roots.push(root);
    const watcher = createFileWatcher();
    let count = 0;
    watcher.watch(root, () => {
      count++;
    });
    watcher.unwatch();
    fs.writeFileSync(path.join(root, 'after-unwatch.txt'), 'x');
    // Wait past debounce window.
    await new Promise((r) => setTimeout(r, 200));
    expect(count).toBe(0);
  });

  it('unwatch is idempotent', () => {
    const watcher = createFileWatcher();
    watcher.unwatch();
    expect(() => watcher.unwatch()).not.toThrow();
  });
});
