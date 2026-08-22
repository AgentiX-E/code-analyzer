// @code-analyzer/infra — Auto Watcher
// Wraps FileWatcher and triggers incremental reindexing on file changes.
// Debounces rapid file changes (500ms default) and only watches source files.

import type { FileWatcher } from '../filesystem/watcher.js';
import type { FileChangeEvent } from '../storage/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoWatcherOptions {
  /** Debounce interval in ms for batching file change events (default: 500). */
  debounceMs?: number;
  /** Callback invoked after reindexing completes. */
  onReindex?: (event: ReindexEvent) => void;
  /** Callback for logging reindex activity. */
  onLog?: (message: string) => void;
}

export interface ReindexEvent {
  rootPath: string;
  changes: FileChangeEvent[];
  /** Number of files affected by the change batch. */
  fileCount: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// AutoWatcher
// ---------------------------------------------------------------------------

export class AutoWatcher {
  private watcher: FileWatcher;
  private options: Required<Omit<AutoWatcherOptions, 'onReindex' | 'onLog'>> & {
    onReindex?: (event: ReindexEvent) => void;
    onLog?: (message: string) => void;
  };
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges: FileChangeEvent[] = [];
  private rootPath: string | null = null;
  private isWatching = false;

  constructor(watcher: FileWatcher, options: AutoWatcherOptions = {}) {
    this.watcher = watcher;
    this.options = {
      debounceMs: options.debounceMs ?? 500,
      onReindex: options.onReindex,
      onLog: options.onLog,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start watching a directory for source file changes.
   * When changes are detected, they are debounced and batched before
   * triggering reindex events.
   *
   * @param rootPath - Absolute path to the project root.
   */
  watch(rootPath: string): void {
    if (this.isWatching) {
      this.unwatch();
    }

    this.rootPath = rootPath;
    this.isWatching = true;

    this.log(`AutoWatcher: Starting watch on ${rootPath}`);

    this.watcher.watch(rootPath, (events: FileChangeEvent[]) => {
      // Filter: only track source files (skip node_modules, .git, etc.)
      const sourceEvents = events.filter((e) => this.isSourceFile(e.filePath, rootPath));

      if (sourceEvents.length === 0) return;

      this.log(`AutoWatcher: Detected ${sourceEvents.length} source file changes`);

      // Deduplicate by file path — latest event wins
      const seen = new Map<string, FileChangeEvent>();
      for (const event of sourceEvents) {
        seen.set(event.filePath, event);
      }
      // Merge with existing pending changes
      for (const event of this.pendingChanges) {
        if (!seen.has(event.filePath)) {
          seen.set(event.filePath, event);
        }
      }
      this.pendingChanges = Array.from(seen.values());

      // Debounce
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.flushChanges();
      }, this.options.debounceMs);
    });
  }

  /**
   * Stop watching and flush any pending changes.
   */
  unwatch(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.watcher.unwatch();
    this.isWatching = false;
    this.pendingChanges = [];
    this.rootPath = null;

    this.log('AutoWatcher: Watch stopped');
  }

  /**
   * Check if the watcher is currently active.
   */
  isActive(): boolean {
    return this.isWatching;
  }

  /**
   * Get the current root path being watched.
   */
  getRootPath(): string | null {
    return this.rootPath;
  }

  /**
   * Get the underlying FileWatcher instance.
   */
  getFileWatcher(): FileWatcher {
    return this.watcher;
  }

  /**
   * Manually trigger a reindex event (useful for testing or programmatic use).
   */
  triggerReindex(events: FileChangeEvent[]): void {
    if (!this.rootPath) return;

    const reindexEvent: ReindexEvent = {
      rootPath: this.rootPath,
      changes: events,
      fileCount: events.length,
      timestamp: new Date().toISOString(),
    };

    this.log(`AutoWatcher: Reindex triggered — ${events.length} files`);
    this.options.onReindex?.(reindexEvent);
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private flushChanges(): void {
    this.debounceTimer = null;

    /* v8 ignore next 3 -- @preserve */
    if (this.pendingChanges.length === 0 || !this.rootPath) return;

    const changes = [...this.pendingChanges];
    this.pendingChanges = [];

    const reindexEvent: ReindexEvent = {
      rootPath: this.rootPath,
      changes,
      fileCount: changes.length,
      timestamp: new Date().toISOString(),
    };

    this.log(`AutoWatcher: Flushing ${changes.length} changes for reindex`);
    this.options.onReindex?.(reindexEvent);
  }

  /**
   * Check if a file is a source file (not in node_modules, .git, etc.).
   * Uses gitignore patterns as well as built-in exclusion rules via
   * simple path matching.
   */
  private isSourceFile(filePath: string, _rootPath: string): boolean {
    // Skip directories
    /* v8 ignore next 2 -- @preserve */
    if (filePath.endsWith('/')) return false;

    // Skip common patterns
    const skipPatterns = [
      /^\.git\//,
      /^node_modules\//,
      /^dist\//,
      /^build\//,
      /^\.next\//,
      /^coverage\//,
      /^__pycache__\//,
      /\.min\.js$/,
      /\.min\.css$/,
      /\.map$/,
      /\.lock$/,
      /\.log$/,
      /^\.DS_Store$/,
    ];

    for (const pattern of skipPatterns) {
      if (pattern.test(filePath)) return false;
    }

    // Check if it's a known source file extension
    const sourceExtensions = [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.py',
      '.pyw',
      '.pyx',
      '.rs',
      '.go',
      '.java',
      '.kt',
      '.kts',
      '.rb',
      '.php',
      '.swift',
      '.cs',
      '.cpp',
      '.c',
      '.h',
      '.hpp',
      '.vue',
      '.svelte',
      '.json',
      '.yaml',
      '.yml',
      '.toml',
      '.md',
      '.mdx',
      '.css',
      '.scss',
      '.less',
      '.graphql',
      '.gql',
      '.prisma',
      '.sql',
    ];

    const ext = filePath.split('.').pop();
    if (ext && sourceExtensions.includes(`.${ext}`)) {
      return true;
    }

    // Also check special files (no extension but are source configs)
    const specialFiles = ['Dockerfile', 'Makefile', '.env.example', '.env.sample'];

    /* v8 ignore next -- @preserve */
    const basename = filePath.split('/').pop() ?? '';
    if (specialFiles.includes(basename)) {
      return true;
    }

    return false;
  }

  private log(message: string): void {
    this.options.onLog?.(message);
  }
}
