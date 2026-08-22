// @code-analyzer/core — Quarantine Manager
// Tracks files that caused crashes or errors during pipeline execution.
// Quarantined files are excluded from subsequent runs to prevent repeat failures.
// Uses a JSON file at .code-analyzer-cache/quarantine.json.

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A file that has been quarantined due to processing errors.
 */
export interface QuarantinedFile {
  /** Absolute or relative path to the problematic file. */
  filePath: string;
  /** Error message describing what went wrong. */
  error: string;
  /** Pipeline phase during which the error occurred. */
  phaseId: string;
  /** Unix timestamp (ms) when the file was quarantined. */
  timestamp: number;
  /** Number of times this file has been retried before quarantine. */
  retryCount: number;
}

/**
 * Manages quarantined files for crash recovery and resilience.
 *
 * Files that cause errors during pipeline execution are tracked so they
 * can be excluded from future runs or retried after analysis. The quarantine
 * list is persisted to disk for durability across process restarts.
 *
 * Uses a JSON file at `.code-analyzer-cache/quarantine.json`.
 */
export class QuarantineManager {
  private readonly filePath: string;
  private readonly cacheDir: string;

  /**
   * @param cacheDir - Directory for quarantine files (default: .code-analyzer-cache)
   */
  constructor(cacheDir: string = '.code-analyzer-cache') {
    this.cacheDir = cacheDir;
    this.filePath = path.join(cacheDir, 'quarantine.json');
  }

  /**
   * Quarantine a file that caused an error.
   * If the file is already quarantined, its retry count is incremented.
   *
   * @param file - File to quarantine (path, error, phaseId, retryCount)
   */
  quarantine(file: Omit<QuarantinedFile, 'timestamp'>): void {
    const list = this.loadList();

    // Check if already quarantined — update retry count
    const existing = list.find((f) => f.filePath === file.filePath);
    if (existing) {
      existing.error = file.error;
      existing.phaseId = file.phaseId;
      existing.retryCount += 1;
      existing.timestamp = Date.now();
    } else {
      list.push({
        filePath: file.filePath,
        error: file.error,
        phaseId: file.phaseId,
        timestamp: Date.now(),
        retryCount: file.retryCount ?? 1,
      });
    }

    this.saveList(list);
  }

  /**
   * Get all currently quarantined files.
   *
   * @returns Array of quarantined file records
   */
  getQuarantined(): QuarantinedFile[] {
    return this.loadList();
  }

  /**
   * Get the set of quarantined file paths for quick lookup.
   */
  getQuarantinedPaths(): Set<string> {
    return new Set(this.loadList().map((f) => f.filePath));
  }

  /**
   * Check if a specific file is quarantined.
   *
   * @param filePath - Path to check
   */
  isQuarantined(filePath: string): boolean {
    return this.loadList().some((f) => f.filePath === filePath);
  }

  /**
   * Remove a specific file from quarantine.
   *
   * @param filePath - File to clear from quarantine
   */
  clear(filePath: string): void {
    const list = this.loadList().filter((f) => f.filePath !== filePath);
    this.saveList(list);
  }

  /**
   * Clear all quarantined files.
   */
  clearAll(): void {
    this.saveList([]);
  }

  /**
   * Get the number of quarantined files.
   */
  getCount(): number {
    return this.loadList().length;
  }

  /**
   * Get quarantined files for a specific phase.
   *
   * @param phaseId - Pipeline phase to filter by
   */
  getByPhase(phaseId: string): QuarantinedFile[] {
    return this.loadList().filter((f) => f.phaseId === phaseId);
  }

  /**
   * Get files that may be ready for retry (low retry count, old enough).
   *
   * @param maxRetries - Maximum retry count threshold (default: 3)
   * @param minAgeMs - Minimum age in ms before retry (default: 5 minutes)
   */
  getRetryableFiles(maxRetries: number = 3, minAgeMs: number = 5 * 60 * 1000): QuarantinedFile[] {
    const now = Date.now();
    return this.loadList().filter(
      (f) => f.retryCount <= maxRetries && now - f.timestamp > minAgeMs,
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private loadList(): QuarantinedFile[] {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) return [];

      return parsed.filter(
        (f: unknown): f is QuarantinedFile =>
          typeof f === 'object' &&
          f !== null &&
          typeof (f as QuarantinedFile).filePath === 'string',
      );
    } catch {
      return [];
    }
  }

  private saveList(list: QuarantinedFile[]): void {
    this.ensureCacheDir();
    const tmpPath = this.filePath + '.tmp';

    fs.writeFileSync(tmpPath, JSON.stringify(list, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }
}
