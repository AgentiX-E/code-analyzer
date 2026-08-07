// @code-analyzer/core — Checkpoint Store
// Persists pipeline checkpoints to enable crash recovery.
// Uses a JSON file at .code-analyzer-cache/checkpoint.json.

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A pipeline checkpoint — captures the state of an in-progress indexing
 * operation so it can be resumed after a crash.
 */
export interface Checkpoint {
  /** Pipeline phase identifier (e.g., 'parse', 'resolve'). */
  phaseId: string;
  /** File paths that have been processed in this phase. */
  processedFiles: string[];
  /** Number of graph nodes created so far. */
  nodeCount: number;
  /** Number of graph edges created so far. */
  edgeCount: number;
  /** Unix timestamp (ms) when the checkpoint was written. */
  timestamp: number;
  /** Arbitrary metadata for phase-specific recovery data. */
  metadata: Record<string, unknown>;
}

/**
 * Manages persistent checkpoint files for crash recovery.
 *
 * Checkpoints are written to a JSON file at `.code-analyzer-cache/checkpoint.json`
 * relative to the current working directory. The store supports save, load, and
 * clear operations with atomic writes to prevent partial corruption.
 */
export class CheckpointStore {
  private readonly filePath: string;
  private readonly cacheDir: string;

  /**
   * @param cacheDir - Directory for checkpoint files (default: .code-analyzer-cache)
   */
  constructor(cacheDir: string = '.code-analyzer-cache') {
    this.cacheDir = cacheDir;
    this.filePath = path.join(cacheDir, 'checkpoint.json');
  }

  /**
   * Save a checkpoint to disk.
   * Uses atomic write (write temp file, then rename) to prevent corruption.
   *
   * @param checkpoint - The checkpoint data to persist
   */
  save(checkpoint: Checkpoint): void {
    this.ensureCacheDir();
    const tmpPath = this.filePath + '.tmp';

    const data = JSON.stringify(
      {
        ...checkpoint,
        timestamp: checkpoint.timestamp || Date.now(),
      },
      null,
      2,
    );

    fs.writeFileSync(tmpPath, data, 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  /**
   * Load the most recent checkpoint from disk.
   *
   * @returns The checkpoint, or null if no checkpoint exists or it's corrupted
   */
  load(): Checkpoint | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<Checkpoint>;

      // Validate required fields
      if (
        typeof parsed.phaseId !== 'string' ||
        !Array.isArray(parsed.processedFiles) ||
        typeof parsed.nodeCount !== 'number' ||
        typeof parsed.edgeCount !== 'number'
      ) {
        return null;
      }

      return {
        phaseId: parsed.phaseId,
        processedFiles: parsed.processedFiles,
        nodeCount: parsed.nodeCount,
        edgeCount: parsed.edgeCount,
        timestamp: parsed.timestamp ?? Date.now(),
        metadata: parsed.metadata ?? {},
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete the checkpoint file from disk.
   */
  clear(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
      // Also clean up any temp file
      const tmpPath = this.filePath + '.tmp';
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Check whether a checkpoint file exists.
   */
  exists(): boolean {
    return fs.existsSync(this.filePath);
  }

  /**
   * Get the absolute path to the checkpoint file.
   */
  getFilePath(): string {
    return path.resolve(this.filePath);
  }

  /**
   * Get the timestamp of the last checkpoint, or 0 if none exists.
   */
  getLastTimestamp(): number {
    const checkpoint = this.load();
    return checkpoint?.timestamp ?? 0;
  }

  /**
   * Return the age of the checkpoint in milliseconds.
   * Returns Infinity if no checkpoint exists.
   */
  getAge(): number {
    const checkpoint = this.load();
    if (!checkpoint) return Infinity;
    return Date.now() - checkpoint.timestamp;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }
}
