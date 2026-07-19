// @code-analyzer/infra — File Watcher
// Filesystem watching using fs.watch with debouncing.

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { FileChangeEvent } from '../storage/types.js';

export interface FileWatcher {
  watch(rootPath: string, callback: (events: FileChangeEvent[]) => void): void;
  unwatch(): void;
}

export function createFileWatcher(): FileWatcher {
  let watchers: fs.FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingEvents: Map<string, FileChangeEvent> = new Map();
  let activeCallback: ((events: FileChangeEvent[]) => void) | null = null;
  const DEBOUNCE_MS = 100;

  function flushEvents(): void {
    if (activeCallback && pendingEvents.size > 0) {
      const events = Array.from(pendingEvents.values());
      pendingEvents.clear();
      activeCallback(events);
    }
  }

  function queueEvent(event: FileChangeEvent): void {
    // Deduplicate: using filePath as key, latest event wins
    pendingEvents.set(event.filePath, event);

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(flushEvents, DEBOUNCE_MS);
  }

  function watchDirectory(
    dirPath: string,
    rootPath: string,
  ): void {
    try {
      const watcher = fs.watch(
        dirPath,
        { persistent: true, recursive: false },
        (eventType, filename) => {
          if (!filename) return;
          const fullPath = path.join(dirPath, filename);
          const relativePath = path.relative(rootPath, fullPath);

          if (eventType === 'rename') {
            // Check if file still exists (add) or was removed (delete)
            try {
              fs.accessSync(fullPath);
              queueEvent({ type: 'add', filePath: relativePath });
            } catch {
              queueEvent({ type: 'delete', filePath: relativePath });
            }
          } else if (eventType === 'change') {
            queueEvent({ type: 'modify', filePath: relativePath });
          }
        },
      );

      watchers.push(watcher);

      // Watch subdirectories
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            watchDirectory(path.join(dirPath, entry.name), rootPath);
          }
        }
      } catch {
        // Directory may have been removed
      }
    } catch {
      // Unable to watch this directory
    }
  }

  return {
    watch(rootPath: string, callback: (events: FileChangeEvent[]) => void): void {
      activeCallback = callback;
      watchDirectory(path.resolve(rootPath), path.resolve(rootPath));
    },

    unwatch(): void {
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // Ignore close errors
        }
      }
      watchers = [];
      activeCallback = null;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pendingEvents.clear();
    },
  };
}
