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
  // Absolute paths of files observed at watch time. Used to disambiguate a
  // macOS FSEvents 'rename' (which fires for in-place writes too) into the
  // correct 'add' vs 'modify' signal.
  const knownFiles = new Set<string>();

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

  function watchDirectory(dirPath: string, rootPath: string): void {
    try {
      // Single directory read: record existing files (for add-vs-modify
      // disambiguation) and collect subdirectories to recurse into.
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        // Directory may be unreadable or removed — watch it anyway.
      }

      for (const entry of entries) {
        // Non-directory entries are files (or symlinks) present at watch
        // time; record them so an in-place write (which macOS FSEvents
        // reports as 'rename') resolves to 'modify', not 'add'.
        if (!entry.isDirectory()) {
          knownFiles.add(path.join(dirPath, entry.name));
        }
      }

      const watcher = fs.watch(
        dirPath,
        { persistent: true, recursive: false },
        (eventType, filename) => {
          if (!filename) return;
          const fullPath = path.join(dirPath, filename);
          const relativePath = path.relative(rootPath, fullPath);

          // Ignore events under excluded directories (node_modules and any
          // dot-directory). On macOS fs.watch is backed by FSEvents, which
          // reports recursively even when `recursive: false`, so the
          // directory-walk skip below is insufficient — the guard must also
          // live at the event boundary for cross-platform correctness.
          const segments = relativePath.split(path.sep);
          if (segments.some((s) => s === 'node_modules' || s.startsWith('.'))) {
            return;
          }

          if (eventType === 'rename') {
            try {
              fs.accessSync(fullPath);
              // File exists. macOS reports in-place writes as 'rename', so
              // use knownFiles to distinguish 'add' from 'modify'.
              if (knownFiles.has(fullPath)) {
                queueEvent({ type: 'modify', filePath: relativePath });
              } else {
                knownFiles.add(fullPath);
                queueEvent({ type: 'add', filePath: relativePath });
              }
            } catch {
              knownFiles.delete(fullPath);
              queueEvent({ type: 'delete', filePath: relativePath });
            }
          } else if (eventType === 'change') {
            knownFiles.add(fullPath);
            queueEvent({ type: 'modify', filePath: relativePath });
          }
        },
      );

      watchers.push(watcher);

      // Watch subdirectories (skipping node_modules and dot-directories).
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          watchDirectory(path.join(dirPath, entry.name), rootPath);
        }
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
      knownFiles.clear();
    },
  };
}
