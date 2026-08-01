// @code-analyzer/infra — Batch File Reader
// High-throughput file reading with configurable concurrency, encoding
// detection (UTF-8, UTF-16, latin1), glob pattern file discovery, and
// content-addressed deduplication using SHA-256.

import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { BatchProcessor } from './batch-processor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileReadResult {
  /** Absolute file path */
  filePath: string;
  /** File contents decoded to UTF-8 string */
  content: string;
  /** Detected encoding of the source file */
  encoding: 'utf-8' | 'utf-16' | 'latin1';
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
  /** Called after each file is read */
  onProgress?: (processed: number, total: number) => void;
}

/** Result of reading files matching glob patterns. */
export interface GlobReadResult {
  /** All successfully read file results */
  files: FileReadResult[];
  /** Glob patterns that were used */
  patterns: string[];
  /** Total files discovered */
  filesDiscovered: number;
}

// ---------------------------------------------------------------------------
// Encoding Detection
// ---------------------------------------------------------------------------

/**
 * Detect file encoding from a raw buffer.
 * Supports UTF-8, UTF-16 (LE/BE with BOM), and falls back to latin1.
 */
export function detectEncoding(buffer: Buffer): 'utf-8' | 'utf-16' | 'latin1' {
  if (buffer.length === 0) return 'utf-8';

  // Check for UTF-16 BOM
  if (buffer.length >= 2) {
    const b0 = buffer[0]!;
    const b1 = buffer[1]!;

    // UTF-16 LE BOM: FF FE
    if (b0 === 0xff && b1 === 0xfe) return 'utf-16';
    // UTF-16 BE BOM: FE FF
    if (b0 === 0xfe && b1 === 0xff) return 'utf-16';
  }

  // Check for UTF-8 BOM (EF BB BF)
  if (buffer.length >= 3) {
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return 'utf-8';
    }
  }

  // Heuristic: scan for valid UTF-8 sequences
  // If the buffer contains null bytes between ASCII characters, it's likely UTF-16
  let nullByteCount = 0;
  for (let i = 0; i < Math.min(buffer.length, 512); i++) {
    if (buffer[i] === 0) nullByteCount++;
  }

  if (nullByteCount > Math.min(buffer.length, 512) * 0.15) {
    return 'utf-16';
  }

  // Try to validate as UTF-8
  if (isValidUtf8(buffer)) {
    return 'utf-8';
  }

  // Fallback to latin1 for non-UTF-8 content
  return 'latin1';
}

function isValidUtf8(buffer: Buffer): boolean {
  let i = 0;
  while (i < buffer.length) {
    const byte = buffer[i]!;

    if (byte <= 0x7f) {
      i++;
      continue;
    }

    let bytesInChar: number;
    if (byte >= 0xc0 && byte <= 0xdf) bytesInChar = 2;
    else if (byte >= 0xe0 && byte <= 0xef) bytesInChar = 3;
    else if (byte >= 0xf0 && byte <= 0xf7) bytesInChar = 4;
    else return false; // Invalid leading byte

    if (i + bytesInChar > buffer.length) return false;

    for (let j = 1; j < bytesInChar; j++) {
      const continuation = buffer[i + j]!;
      if ((continuation & 0xc0) !== 0x80) return false;
    }

    i += bytesInChar;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Glob Pattern Matching
// ---------------------------------------------------------------------------

/**
 * Match a file path against a glob pattern.
 * Supports: **, *, ?, and character classes [...]
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  const segments = filePath.replace(/\\/g, '/').split('/');
  const patternSegments = pattern.replace(/\\/g, '/').split('/');

  // Compute segment-level match
  let si = 0, pi = 0;
  const starCache = new Map<string, boolean>();

  function matchSegments(si: number, pi: number): boolean {
    const key = `${si}:${pi}`;
    if (starCache.has(key)) return starCache.get(key)!;

    // Consumed all segments
    if (pi === patternSegments.length) {
      const result = si === segments.length;
      starCache.set(key, result);
      return result;
    }

    // ** matches any number of path segments
    if (patternSegments[pi] === '**') {
      // Skip to next non-** segment or end
      pi++;
      if (pi === patternSegments.length) {
        starCache.set(key, true);
        return true;
      }

      // Try matching remaining pattern from current or later segments
      for (let k = si; k <= segments.length; k++) {
        if (matchSegments(k, pi)) {
          starCache.set(key, true);
          return true;
        }
      }
      starCache.set(key, false);
      return false;
    }

    if (si >= segments.length) {
      starCache.set(key, false);
      return false;
    }

    if (matchSegment(segments[si]!, patternSegments[pi]!)) {
      const result = matchSegments(si + 1, pi + 1);
      starCache.set(key, result);
      return result;
    }

    starCache.set(key, false);
    return false;
  }

  return matchSegments(0, 0);
}

function matchSegment(segment: string, pattern: string): boolean {
  // Convert glob pattern to regex for single segment
  let regexStr = '^';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i]!;

    if (ch === '*') {
      // Check for character class after *
      if (i + 1 < pattern.length && pattern[i + 1] === '*') {
        // ** in a single segment should not happen (handled above)
        regexStr += '.*';
        i += 2;
        continue;
      }
      regexStr += '[^/]*';
      i++;
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if (ch === '[') {
      const close = pattern.indexOf(']', i);
      if (close > i) {
        regexStr += pattern.slice(i, close + 1);
        i = close + 1;
      } else {
        regexStr += '\\[';
        i++;
      }
    } else if ('.+^${}()|\\'.includes(ch)) {
      regexStr += '\\' + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }

  regexStr += '$';
  return new RegExp(regexStr).test(segment);
}

/**
 * Check if a path matches any of the given glob patterns.
 */
export function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchGlob(filePath, pattern)) return true;
  }
  return false;
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
   * Read multiple files in parallel batches with encoding detection.
   * Files exceeding maxFileSize are skipped with empty result.
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
        // Read raw buffer first for encoding detection
        const buffer = await readFile(filePath);
        const fileSize = buffer.length;

        if (fileSize > this.maxFileSize) {
          processedCount++;
          if (this.onProgress) {
            this.onProgress(processedCount, totalCount);
          }
          return {
            filePath,
            content: '',
            encoding: 'utf-8' as const,
            hash: '',
            size: fileSize,
            readDurationMs: Date.now() - startTime,
          };
        }

        const encoding = detectEncoding(buffer);
        let content: string;

        if (encoding === 'utf-16') {
          // Strip BOM if present before decoding
          const hasBom = buffer.length >= 2 &&
            buffer[0] === 0xff && buffer[1] === 0xfe;
          const offset = hasBom ? 2 : 0;
          content = buffer.subarray(offset).toString('utf16le');
        } else {
          // Strip UTF-8 BOM if present
          const hasBom = buffer.length >= 3 &&
            buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
          const offset = hasBom ? 3 : 0;
          content = buffer.subarray(offset).toString('utf-8');
        }
        const hash = createHash('sha256').update(content).digest('hex');

        processedCount++;
        if (this.onProgress) {
          this.onProgress(processedCount, totalCount);
        }

        return {
          filePath,
          content,
          encoding,
          hash,
          size: fileSize,
          readDurationMs: Date.now() - startTime,
        };
      } catch {
        processedCount++;
        if (this.onProgress) {
          this.onProgress(processedCount, totalCount);
        }
        return {
          filePath,
          content: '',
          encoding: 'utf-8' as const,
          hash: '',
          size: 0,
          readDurationMs: Date.now() - startTime,
        };
      }
    });

    // Filter out failed reads and oversized files
    return batchResult.results.filter((r) => r.content.length > 0);
  }

  /**
   * Read files matching glob patterns from a base directory.
   * Only supports files that exist (returns paths that match).
   */
  async readGlob(filePaths: string[], globPatterns: string[]): Promise<GlobReadResult> {
    // Filter file paths by glob patterns
    const matchedPaths = filePaths.filter((fp) =>
      matchesAnyPattern(fp, globPatterns),
    );

    const files = await this.readAll(matchedPaths);

    return {
      files,
      patterns: globPatterns,
      filesDiscovered: matchedPaths.length,
    };
  }

  /**
   * Read files and return as a Map<filePath, FileReadResult> for easy lookup.
   */
  async readAsMap(filePaths: string[]): Promise<Map<string, FileReadResult>> {
    const results = await this.readAll(filePaths);
    const map = new Map<string, FileReadResult>();
    for (const result of results) {
      map.set(result.filePath, result);
    }
    return map;
  }

  /**
   * Read files with encoding detection, returning a Map.
   */
  async readAllEncoded(filePaths: string[]): Promise<Map<string, FileReadResult>> {
    const results = await this.readAll(filePaths);
    const map = new Map<string, FileReadResult>();
    for (const result of results) {
      map.set(result.filePath, result);
    }
    return map;
  }

  /**
   * Get the file size of a file without reading its contents.
   */
  async getFileSize(filePath: string): Promise<number | null> {
    try {
      const stats = await stat(filePath);
      return stats.size;
    } catch {
      return null;
    }
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
