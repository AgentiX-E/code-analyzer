// @code-analyzer/vscode — File Watcher Service
// Watches the workspace for file changes and triggers incremental re-indexing.
// Uses debouncing to batch rapid changes and avoid excessive re-analysis.

import type { EngineBridge } from './engine-bridge.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface WatcherConfig {
  /** Debounce delay in milliseconds (default: 2000ms) */
  debounceMs: number;
  /** File patterns to watch (e.g., ['**\/*.ts', '**\/*.js']) */
  filePatterns: string[];
  /** File patterns to exclude (e.g., ['**\/node_modules\/**']) */
  excludePatterns: string[];
  /** Whether the watcher is enabled */
  enabled: boolean;
}

export const DEFAULT_WATCHER_CONFIG: WatcherConfig = {
  debounceMs: 2000,
  filePatterns: [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.mjs',
    '**/*.cjs',
    '**/*.py',
    '**/*.go',
    '**/*.rs',
    '**/*.java',
    '**/*.kt',
  ],
  excludePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/__pycache__/**',
    '**/*.min.js',
    '**/*.d.ts',
  ],
  enabled: true,
};

// ---------------------------------------------------------------------------
// File System Watcher interface (testable without vscode)
// ---------------------------------------------------------------------------

export interface FileSystemWatcher {
  /** Register a callback for file creation events */
  onDidCreate: (listener: (uri: { fsPath: string }) => void) => { dispose(): void };
  /** Register a callback for file change events */
  onDidChange: (listener: (uri: { fsPath: string }) => void) => { dispose(): void };
  /** Register a callback for file deletion events */
  onDidDelete: (listener: (uri: { fsPath: string }) => void) => { dispose(): void };
  /** Dispose the watcher */
  dispose(): void;
}

export interface WatcherFactory {
  createFileSystemWatcher(
    pattern: string,
    ignoreCreateEvents?: boolean,
    ignoreChangeEvents?: boolean,
    ignoreDeleteEvents?: boolean,
  ): FileSystemWatcher;
}

// ---------------------------------------------------------------------------
// FileWatcherService
// ---------------------------------------------------------------------------

export class FileWatcherService {
  private watchers: FileSystemWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges = new Set<string>();
  private isRunning = false;
  private disposables: Array<{ dispose(): void }> = [];

  constructor(
    private engine: EngineBridge,
    private config: WatcherConfig = DEFAULT_WATCHER_CONFIG,
    private factory?: WatcherFactory,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start watching the workspace for file changes.
   */
  start(): void {
    if (this.isRunning || !this.config.enabled) return;
    this.isRunning = true;

    // Create watchers for each file pattern
    for (const pattern of this.config.filePatterns) {
      const w = this.factory
        ? this.factory.createFileSystemWatcher(pattern)
        : this.createDefaultWatcher(pattern);

      const d1 = w.onDidChange((uri) => this.onFileChanged(uri));
      const d2 = w.onDidCreate((uri) => this.onFileChanged(uri));
      const d3 = w.onDidDelete((uri) => this.onFileChanged(uri));

      this.disposables.push(d1, d2, d3);
      this.watchers.push(w);
    }
  }

  /**
   * Stop watching the workspace.
   */
  stop(): void {
    if (!this.isRunning) return;

    // Clear pending changes and debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChanges.clear();

    // Dispose event listeners
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;

    // Dispose watchers
    for (const w of this.watchers) {
      w.dispose();
    }
    this.watchers.length = 0;

    this.isRunning = false;
  }

  /**
   * Check if the file watcher is currently running.
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Get the list of files that have pending changes (not yet indexed).
   */
  getChangedFiles(): string[] {
    return [...this.pendingChanges];
  }

  /**
   * Get the number of pending file changes.
   */
  get pendingCount(): number {
    return this.pendingChanges.size;
  }

  /**
   * Dispose the file watcher and clean up resources.
   */
  dispose(): void {
    this.stop();
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Handle a file change event with debouncing.
   * Batches rapid changes and triggers a single incremental re-index.
   */
  private async onFileChanged(uri: { fsPath: string }): Promise<void> {
    const filePath = uri.fsPath;

    // Skip files matching exclude patterns
    if (this.shouldExclude(filePath)) return;

    this.pendingChanges.add(filePath);

    // Reset debounce timer on each change
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      await this.flushPendingChanges();
    }, this.config.debounceMs);
  }

  /**
   * Flush all pending changes and trigger incremental re-indexing.
   */
  private async flushPendingChanges(): Promise<void> {
    const changes = [...this.pendingChanges];
    if (changes.length === 0) return;

    this.pendingChanges.clear();

    try {
      await this.engine.incrementalReindex(changes);
    } catch {
      // Silently handle reindexing errors (e.g., engine not initialized)
    }
  }

  /**
   * Check if a file path should be excluded from watching.
   */
  private shouldExclude(filePath: string): boolean {
    for (const pattern of this.config.excludePatterns) {
      if (this.matchGlob(filePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple glob matching for exclude patterns.
   * Supports **, *, and literal path matching.
   */
  private matchGlob(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const escaped = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<DOUBLESTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<DOUBLESTAR>>/g, '.*');

    const regex = new RegExp(escaped);
    return regex.test(filePath);
  }

  /**
   * Create a default no-op file system watcher when no factory is provided.
   * Used in tests and non-VS Code environments.
   */
  private createDefaultWatcher(_pattern: string): FileSystemWatcher {
    return {
      onDidCreate: () => ({ dispose() {} }),
      onDidChange: () => ({ dispose() {} }),
      onDidDelete: () => ({ dispose() {} }),
      dispose() {},
    };
  }
}
