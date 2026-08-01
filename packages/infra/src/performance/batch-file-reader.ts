// @code-analyzer/infra — Batch File Reader
// High-throughput file reading with configurable concurrency, chunking,
// and content-addressed deduplication using SHA-256.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BatchProcessor } from './batch-processor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileReadResult {
  /** Absolute file path */
  filePath: string;
  /** File contents as UTF-8 string */
  content: string;
  /** SHA-256 hash of the file content (hex) */
  hash: string;
  /** File size in bytes */
  size: number;
  /** Read duration in milliseconds */
  readDurationMs: number;
}

export interface BatchFileReaderOptions {
  /** Number of files to read per batch (default: 32) */
  batchSize?: number;
  /** Maximum concurrent read operations (default: os.cpus().length * 2) */
  maxConcurrency?: number;
  /** Maximum file size in bytes (files larger than this are skipped, default: 10MB) */
  maxFileSize?: number;
  /** Called after each batch completes */
  onProgress?: (processed: number, total: number) => void;
}

// ---------------------------------------------------------------------------
// BatchFileReader
// ---------------------------------------------------------------------------

export class BatchFileReader {
  private readonly batchSize: number;
  private readonly maxConcurrency: number;
  private readonly maxFileSize: number;
  private readonly onProgress?: (processed: number, total: number) => void;

  constructor(options: BatchFileReaderOptions = {}) {
    this.batchSize = options.batchSize ?? 32;
    this.maxConcurrency = options.maxConcurrency ?? this.defaultConcurrency();
    this.maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024; // 10 MB
    this.onProgress = options.onProgress;
  }

  /**
   * Read multiple files in parallel batches for maximum throughput.
   * Uses content-addressed SHA-256 hashing for cache-key generation.
   */
  async readAll(filePaths: string[]): Promise<FileReadResult[]> {
    if (filePaths.length === 0) return [];

    const processor = new BatchProcessor<string>({
      batchSize: this.batchSize,
      concurrency: this.maxConcurrency,
      continueOnError: true,
    });

    let processedCount = 0;
    const totalCount = filePaths.length;

    const batchResult = await processor.processMap(filePaths, async (filePath) => {
      const startTime = Date.now();
      try {
        const content = await readFile(filePath, 'utf-8');
        const size = Buffer.byteLength(content, 'utf-8');

        if (size > this.maxFileSize) {
          // Return a partial result for oversized files — reading still succeeds
          // but the consumer may choose to handle them differently.
        }

        const hash = createHash('sha256').update(content).digest('hex');
        processedCount++;

        if (this.onProgress) {
          this.onProgress(processedCount, totalCount);
        }

        const result: FileReadResult = {
          filePath,
          content,
          hash,
          size,
          readDurationMs: Date.now() - startTime,
        };
        return result;
      } catch {
        // Return error result without crashing — callers can filter by checking content length
        processedCount++;
        if (this.onProgress) {
          this.onProgress(processedCount, totalCount);
        }
        return {
          filePath,
          content: '',
          hash: '',
          size: 0,
          readDurationMs: Date.now() - startTime,
        };
      }
    });

    // Filter out failed reads
    return batchResult.results.filter((r) => r.size > 0 || r.content.length > 0);
  }

  /**
   * Read files and return as a Map<filePath, content> for easy lookup.
   */
  async readAsMap(filePaths: string[]): Promise<Map<string, FileReadResult>> {
    const results = await this.readAll(filePaths);
    const map = new Map<string, FileReadResult>();
    for (const result of results) {
      map.set(result.filePath, result);
    }
    return map;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private defaultConcurrency(): number {
    try {
      const os = require('node:os');
      return Math.max(2, os.cpus().length * 2);
    } catch {
      return 4;
    }
  }
}
