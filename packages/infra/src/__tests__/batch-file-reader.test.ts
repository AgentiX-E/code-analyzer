// @code-analyzer/infra — Batch File Reader Tests
// Covers encoding detection, glob pattern matching, batch file reading,
// progress tracking, error handling, and edge cases.

import { describe, it, expect, vi } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  BatchFileReader,
  detectEncoding,
  matchGlob,
  matchesAnyPattern,
} from '../performance/batch-file-reader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;
let testCounter = 0;

async function createTestFile(relativePath: string, content: string): Promise<string> {
  const fullPath = join(testDir, relativePath);
  const dir = join(fullPath, '..');
  await mkdir(dir, { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

async function createTestFileRaw(relativePath: string, buffer: Buffer): Promise<string> {
  const fullPath = join(testDir, relativePath);
  const dir = join(fullPath, '..');
  await mkdir(dir, { recursive: true });
  await writeFile(fullPath, buffer);
  return fullPath;
}

beforeEach(async () => {
  testDir = join(tmpdir(), `batch-file-reader-test-${Date.now()}-${testCounter++}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Cleanup failure is non-fatal
  }
});

// ---------------------------------------------------------------------------
// Encoding Detection Tests
// ---------------------------------------------------------------------------

describe('detectEncoding', () => {
  it('should detect UTF-8 for ASCII content', () => {
    const buffer = Buffer.from('hello world', 'utf-8');
    expect(detectEncoding(buffer)).toBe('utf-8');
  });

  it('should detect UTF-8 for multi-byte characters', () => {
    const buffer = Buffer.from('héllo wörld 你好', 'utf-8');
    expect(detectEncoding(buffer)).toBe('utf-8');
  });

  it('should detect UTF-8 BOM', () => {
    const buffer = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('hello', 'utf-8'),
    ]);
    expect(detectEncoding(buffer)).toBe('utf-8');
  });

  it('should detect UTF-16 LE via BOM', () => {
    const buffer = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('hello', 'utf16le'),
    ]);
    expect(detectEncoding(buffer)).toBe('utf-16');
  });

  it('should detect UTF-16 BE via BOM', () => {
    const buffer = Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      Buffer.from('hello', 'utf16le').swap16(),
    ]);
    expect(detectEncoding(buffer)).toBe('utf-16');
  });

  it('should detect UTF-16 via null byte heuristic', () => {
    // Create a buffer with many null bytes (typical of UTF-16 ASCII text)
    const buf = Buffer.alloc(200);
    for (let i = 0; i < 100; i++) {
      buf[i * 2] = 0x41; // 'A'
      // buf[i*2 + 1] = 0x00 (already zero)
    }
    expect(detectEncoding(buf)).toBe('utf-16');
  });

  it('should return utf-8 for empty buffer', () => {
    expect(detectEncoding(Buffer.alloc(0))).toBe('utf-8');
  });

  it('should return latin1 for non-UTF-8 binary content', () => {
    // Create a buffer with invalid UTF-8 sequences
    const buf = Buffer.from([0x80, 0x81, 0x82, 0x83, 0x48, 0x65, 0x6c, 0x6c]);
    expect(detectEncoding(buf)).toBe('latin1');
  });

  it('should return latin1 for random binary data', () => {
    const buf = randomBytes(256);
    // Override some bytes to ensure they're invalid UTF-8
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = 0xff;
    }
    expect(detectEncoding(buf)).toBe('latin1');
  });

  it('should detect valid 2-byte UTF-8 sequences', () => {
    // 0xC3 0xA9 = é
    const buf = Buffer.from([0x43, 0x6f, 0x64, 0xc3, 0xa9]);
    expect(detectEncoding(buf)).toBe('utf-8');
  });

  it('should detect valid 3-byte UTF-8 sequences', () => {
    // 0xE4 0xBD 0xA0 = 你
    const buf = Buffer.from([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd]);
    expect(detectEncoding(buf)).toBe('utf-8');
  });

  it('should detect valid 4-byte UTF-8 sequences', () => {
    // 0xF0 0x9F 0x98 0x80 = 😀
    const buf = Buffer.from([0xf0, 0x9f, 0x98, 0x80]);
    expect(detectEncoding(buf)).toBe('utf-8');
  });

  it('should detect invalid UTF-8 with truncated sequence', () => {
    // Incomplete 2-byte sequence
    const buf = Buffer.from([0xc3]);
    expect(detectEncoding(buf)).toBe('latin1');
  });

  it('should detect invalid UTF-8 with wrong continuation bytes', () => {
    // Leading byte 0xC3 but continuation is not 0x80-0xBF
    const buf = Buffer.from([0xc3, 0x41]);
    expect(detectEncoding(buf)).toBe('latin1');
  });
});

// ---------------------------------------------------------------------------
// Glob Pattern Matching Tests
// ---------------------------------------------------------------------------

describe('matchGlob', () => {
  it('should match exact filename', () => {
    expect(matchGlob('file.ts', 'file.ts')).toBe(true);
    expect(matchGlob('file.ts', 'other.ts')).toBe(false);
  });

  it('should match * wildcard', () => {
    expect(matchGlob('file.ts', '*.ts')).toBe(true);
    expect(matchGlob('file.js', '*.ts')).toBe(false);
    expect(matchGlob('test/file.ts', 'test/*.ts')).toBe(true);
  });

  it('should match ? wildcard', () => {
    expect(matchGlob('a.ts', '?.ts')).toBe(true);
    expect(matchGlob('ab.ts', '?.ts')).toBe(false);
  });

  it('should match ** for any depth', () => {
    expect(matchGlob('src/a/b/c.ts', 'src/**/*.ts')).toBe(true);
    expect(matchGlob('src/c.ts', 'src/**/*.ts')).toBe(true);
    expect(matchGlob('lib/c.ts', 'src/**/*.ts')).toBe(false);
  });

  it('should match ** at end', () => {
    expect(matchGlob('src/a/b/c', 'src/**')).toBe(true);
    expect(matchGlob('src/c', 'src/**')).toBe(true);
    expect(matchGlob('src/', 'src/**')).toBe(true);
  });

  it('should match character classes', () => {
    expect(matchGlob('file1.ts', 'file[0-9].ts')).toBe(true);
    expect(matchGlob('filea.ts', 'file[0-9].ts')).toBe(false);
    expect(matchGlob('filea.ts', 'file[a-z].ts')).toBe(true);
  });

  it('should handle special regex characters in pattern', () => {
    expect(matchGlob('test+file.ts', 'test+file.ts')).toBe(true);
    expect(matchGlob('test.file.ts', 'test.file.ts')).toBe(true);
    expect(matchGlob('test(file).ts', 'test(file).ts')).toBe(true);
  });

  it('should not match across directory boundaries with *', () => {
    expect(matchGlob('a/b.ts', '*.ts')).toBe(false);
  });

  it('should match complex patterns', () => {
    expect(matchGlob('src/components/Button.tsx', 'src/**/*.tsx')).toBe(true);
    expect(matchGlob('src/components/Button.test.tsx', 'src/**/*.test.tsx')).toBe(true);
    expect(matchGlob('src/components/Button.tsx', 'src/**/*.test.tsx')).toBe(false);
  });
});

describe('matchesAnyPattern', () => {
  it('should return true if any pattern matches', () => {
    expect(matchesAnyPattern('file.ts', ['*.js', '*.ts'])).toBe(true);
  });

  it('should return false if no pattern matches', () => {
    expect(matchesAnyPattern('file.css', ['*.js', '*.ts'])).toBe(false);
  });

  it('should handle empty patterns array', () => {
    expect(matchesAnyPattern('file.ts', [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BatchFileReader Tests
// ---------------------------------------------------------------------------

describe('BatchFileReader', () => {
  // -------------------------------------------------------------------
  // Basic reading
  // -------------------------------------------------------------------

  it('should read a single file', async () => {
    const filePath = await createTestFile('test.txt', 'hello world');
    const reader = new BatchFileReader();

    const results = await reader.readAll([filePath]);

    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toBe(filePath);
    expect(results[0]!.content).toBe('hello world');
    expect(results[0]!.encoding).toBe('utf-8');
    expect(results[0]!.hash).toBeDefined();
    expect(results[0]!.hash).toHaveLength(64);
    expect(results[0]!.size).toBe(11);
    expect(results[0]!.readDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('should read multiple files in parallel', async () => {
    const files: string[] = [];
    for (let i = 0; i < 10; i++) {
      files.push(await createTestFile(`file${i}.txt`, `content ${i}`));
    }

    const reader = new BatchFileReader({ batchSize: 3 });
    const results = await reader.readAll(files);

    expect(results).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(results.find((r) => r.content === `content ${i}`)).toBeDefined();
    }
  });

  it('should return empty array for empty file list', async () => {
    const reader = new BatchFileReader();
    const results = await reader.readAll([]);
    expect(results).toEqual([]);
  });

  it('should detect UTF-8 encoding for files', async () => {
    const filePath = await createTestFile('utf8.txt', 'hello world');
    const reader = new BatchFileReader();

    const results = await reader.readAll([filePath]);
    expect(results[0]!.encoding).toBe('utf-8');
  });

  it('should detect UTF-16 encoding for files', async () => {
    // Create UTF-16 LE file with BOM
    const utf16Bom = Buffer.from([0xff, 0xfe]);
    const content = Buffer.from('hello world', 'utf16le');
    const filePath = await createTestFileRaw('utf16.txt', Buffer.concat([utf16Bom, content]));

    const reader = new BatchFileReader();
    const results = await reader.readAll([filePath]);

    expect(results).toHaveLength(1);
    expect(results[0]!.encoding).toBe('utf-16');
    expect(results[0]!.content).toBe('hello world');
  });

  it('should detect latin1 encoding for binary files', async () => {
    // Create a file with non-UTF-8 binary data
    const buf = Buffer.from([0x80, 0x81, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    const filePath = await createTestFileRaw('latin1.bin', buf);

    const reader = new BatchFileReader();
    const results = await reader.readAll([filePath]);

    expect(results).toHaveLength(1);
    expect(results[0]!.encoding).toBe('latin1');
  });

  // -------------------------------------------------------------------
  // Progress tracking
  // -------------------------------------------------------------------

  it('should report progress via onProgress callback', async () => {
    const files: string[] = [];
    for (let i = 0; i < 5; i++) {
      files.push(await createTestFile(`file${i}.txt`, `content ${i}`));
    }

    const progressCalls: Array<{ processed: number; total: number }> = [];
    const reader = new BatchFileReader({
      batchSize: 2,
      onProgress: (processed, total) => progressCalls.push({ processed, total }),
    });

    await reader.readAll(files);

    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[progressCalls.length - 1]!.processed).toBe(5);
    expect(progressCalls[progressCalls.length - 1]!.total).toBe(5);
  });

  // -------------------------------------------------------------------
  // readAsMap
  // -------------------------------------------------------------------

  it('should return results as a Map', async () => {
    const filePath1 = await createTestFile('a.txt', 'content a');
    const filePath2 = await createTestFile('b.txt', 'content b');

    const reader = new BatchFileReader();
    const map = await reader.readAsMap([filePath1, filePath2]);

    expect(map.size).toBe(2);
    expect(map.get(filePath1)?.content).toBe('content a');
    expect(map.get(filePath2)?.content).toBe('content b');
  });

  it('should return empty map for empty file list', async () => {
    const reader = new BatchFileReader();
    const map = await reader.readAsMap([]);
    expect(map.size).toBe(0);
  });

  // -------------------------------------------------------------------
  // readAllEncoded
  // -------------------------------------------------------------------

  it('should return encoded results as a Map', async () => {
    const filePath = await createTestFile('test.txt', 'hello');
    const reader = new BatchFileReader();
    const map = await reader.readAllEncoded([filePath]);

    expect(map.size).toBe(1);
    expect(map.get(filePath)?.encoding).toBe('utf-8');
  });

  // -------------------------------------------------------------------
  // readGlob
  // -------------------------------------------------------------------

  it('should filter files by glob patterns', async () => {
    const tsFile = await createTestFile('src/app.ts', 'const x = 1;');
    const jsFile = await createTestFile('src/app.js', 'var x = 1;');
    const cssFile = await createTestFile('src/style.css', 'body {}');

    const reader = new BatchFileReader();
    const result = await reader.readGlob([tsFile, jsFile, cssFile], ['**/*.ts']);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.filePath).toBe(tsFile);
    expect(result.patterns).toEqual(['**/*.ts']);
    expect(result.filesDiscovered).toBe(1);
  });

  it('should match multiple glob patterns', async () => {
    const tsFile = await createTestFile('src/app.ts', 'ts');
    const jsFile = await createTestFile('src/app.js', 'js');
    const cssFile = await createTestFile('src/style.css', 'css');

    const reader = new BatchFileReader();
    const result = await reader.readGlob([tsFile, jsFile, cssFile], ['**/*.ts', '**/*.js']);

    expect(result.files).toHaveLength(2);
  });

  it('should return empty when no files match glob', async () => {
    const jsFile = await createTestFile('src/app.js', 'js');
    const reader = new BatchFileReader();
    const result = await reader.readGlob([jsFile], ['**/*.ts']);

    expect(result.files).toEqual([]);
    expect(result.filesDiscovered).toBe(0);
  });

  // -------------------------------------------------------------------
  // getFileSize
  // -------------------------------------------------------------------

  it('should return file size without reading content', async () => {
    const filePath = await createTestFile('test.txt', 'hello world');
    const reader = new BatchFileReader();

    const size = await reader.getFileSize(filePath);
    expect(size).toBe(11);
  });

  it('should return null for non-existent file', async () => {
    const reader = new BatchFileReader();
    const size = await reader.getFileSize('/nonexistent/file.txt');
    expect(size).toBeNull();
  });

  // -------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------

  it('should handle non-existent files gracefully', async () => {
    const filePath = await createTestFile('exists.txt', 'hello');
    const reader = new BatchFileReader();

    const results = await reader.readAll([filePath, '/nonexistent/file.txt']);

    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toBe(filePath);
  });

  it('should handle all files failing', async () => {
    const reader = new BatchFileReader();

    const results = await reader.readAll(['/nonexistent/a.txt', '/nonexistent/b.txt']);

    expect(results).toEqual([]);
  });

  // -------------------------------------------------------------------
  // Max file size
  // -------------------------------------------------------------------

  it('should skip files larger than maxFileSize', async () => {
    const smallFile = await createTestFile('small.txt', 'small');
    // Create a large file
    const largeContent = 'x'.repeat(1000);
    const largeFile = await createTestFile('large.txt', largeContent);

    const reader = new BatchFileReader({ maxFileSize: 50 });
    const results = await reader.readAll([smallFile, largeFile]);

    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toBe(smallFile);
  });

  // -------------------------------------------------------------------
  // Hash computation
  // -------------------------------------------------------------------

  it('should compute SHA-256 hash for file content', async () => {
    const filePath = await createTestFile('test.txt', 'test content');
    const reader = new BatchFileReader();

    const results = await reader.readAll([filePath]);
    expect(results[0]!.hash).toHaveLength(64);
    expect(results[0]!.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should produce different hashes for different content', async () => {
    const file1 = await createTestFile('a.txt', 'content a');
    const file2 = await createTestFile('b.txt', 'content b');

    const reader = new BatchFileReader();
    const results = await reader.readAll([file1, file2]);

    expect(results[0]!.hash).not.toBe(results[1]!.hash);
  });

  it('should produce same hash for identical content', async () => {
    const file1 = await createTestFile('a.txt', 'same content');
    const file2 = await createTestFile('b.txt', 'same content');

    const reader = new BatchFileReader();
    const results = await reader.readAll([file1, file2]);

    expect(results[0]!.hash).toBe(results[1]!.hash);
  });

  // -------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------

  it('should use default configuration', async () => {
    const reader = new BatchFileReader();
    const files: string[] = [];
    for (let i = 0; i < 5; i++) {
      files.push(await createTestFile(`f${i}.txt`, `c${i}`));
    }

    const results = await reader.readAll(files);
    expect(results).toHaveLength(5);
  });

  it('should respect custom batchSize', async () => {
    const reader = new BatchFileReader({ batchSize: 2, maxConcurrency: 1 });
    const files: string[] = [];
    for (let i = 0; i < 6; i++) {
      files.push(await createTestFile(`f${i}.txt`, `c${i}`));
    }

    const results = await reader.readAll(files);
    expect(results).toHaveLength(6);
  });

  it('should respect custom maxConcurrency', async () => {
    const reader = new BatchFileReader({ maxConcurrency: 4 });
    const files: string[] = [];
    for (let i = 0; i < 8; i++) {
      files.push(await createTestFile(`f${i}.txt`, `c${i}`));
    }

    const results = await reader.readAll(files);
    expect(results).toHaveLength(8);
  });

  // -------------------------------------------------------------------
  // readDurationMs
  // -------------------------------------------------------------------

  it('should report read duration', async () => {
    const filePath = await createTestFile('test.txt', 'content');
    const reader = new BatchFileReader();

    const results = await reader.readAll([filePath]);
    expect(results[0]!.readDurationMs).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------

  it('should handle empty file content', async () => {
    const filePath = await createTestFile('empty.txt', '');
    const reader = new BatchFileReader();

    const results = await reader.readAll([filePath]);

    // Empty content is filtered out (content.length > 0 check)
    expect(results).toEqual([]);
  });

  it('should handle file with only whitespace', async () => {
    const filePath = await createTestFile('space.txt', '   ');
    const reader = new BatchFileReader();

    const results = await reader.readAll([filePath]);
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe('   ');
  });

  it('should handle file with special characters', async () => {
    const filePath = await createTestFile('special.txt', 'line1\nline2\t\rline3');
    const reader = new BatchFileReader();

    const results = await reader.readAll([filePath]);
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain('\n');
  });

  it('should handle large number of files', async () => {
    const files: string[] = [];
    for (let i = 0; i < 50; i++) {
      files.push(await createTestFile(`file${i}.txt`, `content ${i}`));
    }

    const reader = new BatchFileReader({ batchSize: 10 });
    const results = await reader.readAll(files);

    expect(results).toHaveLength(50);
  });

  it('should not call onProgress when no callback provided', async () => {
    const filePath = await createTestFile('test.txt', 'hello');
    const reader = new BatchFileReader(); // No onProgress

    // Should not throw
    const results = await reader.readAll([filePath]);
    expect(results).toHaveLength(1);
  });

  it('should detect UTF-8 with BOM content', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const content = Buffer.from('hello world', 'utf-8');
    const filePath = await createTestFileRaw('utf8bom.txt', Buffer.concat([bom, content]));

    const reader = new BatchFileReader();
    const results = await reader.readAll([filePath]);

    expect(results).toHaveLength(1);
    expect(results[0]!.encoding).toBe('utf-8');
  });

  it('should handle progress callback during error paths', async () => {
    const filePath = await createTestFile('ok.txt', 'ok');
    const reader = new BatchFileReader({
      onProgress: () => { /* called */ },
      batchSize: 2,
    });
    // Include a non-existent file to trigger error path with onProgress
    const results = await reader.readAll([filePath, '/nonexistent/file.txt']);
    expect(results).toHaveLength(1);
  });

  it('should handle maxFileSize exceeded with onProgress callback', async () => {
    const largeContent = 'x'.repeat(2000);
    const largeFile = await createTestFile('big.txt', largeContent);
    const smallFile = await createTestFile('small.txt', 'hi');
    const progressCalls: number[] = [];
    const reader = new BatchFileReader({
      maxFileSize: 100,
      onProgress: (processed) => progressCalls.push(processed),
    });
    const results = await reader.readAll([largeFile, smallFile]);
    expect(results).toHaveLength(1);
    expect(progressCalls.length).toBeGreaterThan(0);
  });

  it('should detect UTF-16 BE with BOM through readAll', async () => {
    const utf16BEBom = Buffer.from([0xfe, 0xff]);
    const content = Buffer.from('hello', 'utf16le').swap16();
    const filePath = await createTestFileRaw('utf16be.txt', Buffer.concat([utf16BEBom, content]));
    const reader = new BatchFileReader();
    const results = await reader.readAll([filePath]);
    expect(results).toHaveLength(1);
    expect(results[0]!.encoding).toBe('utf-16');
  });

  it('should detect UTF-8 with invalid 4-byte leading byte (0xF8+)', () => {
    const buf = Buffer.from([0xf8, 0x80, 0x80, 0x80, 0x41]);
    expect(detectEncoding(buf)).toBe('latin1');
  });

  it('should detect invalid UTF-8 with truncated 3-byte sequence', () => {
    // 0xE0 start byte but only 1 continuation byte
    const buf = Buffer.from([0xe0, 0x80]);
    expect(detectEncoding(buf)).toBe('latin1');
  });
});
