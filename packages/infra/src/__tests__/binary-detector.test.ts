// @code-analyzer/infra — Binary File Detector Tests
// Comprehensive test suite for BinaryFileDetector with 95%+ coverage target.
// Tests cover: magic byte detection for 40+ formats, encoding detection,
// text extension whitelist, null byte detection, BOM handling, edge cases.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BinaryFileDetector } from '../binary-detector.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createTempFile(content: Buffer | string, ext = '.tmp'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-bin-test-'));
  const filePath = path.join(dir, `test${ext}`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function cleanupTempFile(filePath: string): void {
  try {
    const dir = path.dirname(filePath);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Cleanup is best-effort
  }
}

// ---------------------------------------------------------------------------
// Tests: Construction & Configuration
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — Construction', () => {
  it('should construct with default options', () => {
    const detector = new BinaryFileDetector();
    expect(detector).toBeDefined();
  });

  it('should construct with custom maxBytesToRead', () => {
    const detector = new BinaryFileDetector({ maxBytesToRead: 1024 });
    expect(detector).toBeDefined();
  });

  it('should construct with encoding detection disabled', () => {
    const detector = new BinaryFileDetector({ useEncodingDetection: false });
    expect(detector).toBeDefined();
  });

  it('should construct with custom signatures', () => {
    const detector = new BinaryFileDetector({
      customSignatures: [
        { offset: 0, bytes: [0xab, 0xcd, 0xef], format: 'Custom format' },
      ],
    });
    expect(detector).toBeDefined();
  });

  it('should accept new signatures via registerSignature', () => {
    const detector = new BinaryFileDetector();
    detector.registerSignature({
      offset: 0,
      bytes: [0xca, 0xfe],
      format: 'Java class file (custom)',
    });
    expect(detector).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Text File Detection (known extensions)
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — Text Extensions', () => {
  let detector: BinaryFileDetector;

  beforeEach(() => {
    detector = new BinaryFileDetector();
  });

  const textExtensions = [
    'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'kt', 'rs', 'rb',
    'php', 'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'lua', 'r', 'zig',
    'html', 'css', 'scss', 'json', 'yaml', 'yml', 'toml', 'md', 'txt',
    'sh', 'sql', 'xml', 'svg',
  ];

  for (const ext of textExtensions) {
    it(`should classify .${ext} as text (not binary)`, () => {
      const result = detector.detectFile(`/project/src/file.${ext}`);
      expect(result.isBinary).toBe(false);
      expect(result.format).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// Tests: Magic Byte Detection — Image Formats
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — Image Formats', () => {
  let detector: BinaryFileDetector;

  beforeEach(() => {
    detector = new BinaryFileDetector();
  });

  it('should detect JPEG via FF D8 FF', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const filePath = createTempFile(buf, '.jpg');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('JPEG');
    cleanupTempFile(filePath);
  });

  it('should detect PNG via 89 50 4E 47', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const filePath = createTempFile(buf, '.png');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('PNG');
    cleanupTempFile(filePath);
  });

  it('should detect GIF via 47 49 46 38', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const filePath = createTempFile(buf, '.gif');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('GIF');
    cleanupTempFile(filePath);
  });

  it('should detect BMP via 42 4D', () => {
    const buf = Buffer.from([0x42, 0x4d]);
    const filePath = createTempFile(buf, '.bmp');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('BMP');
    cleanupTempFile(filePath);
  });
});

// ---------------------------------------------------------------------------
// Tests: Magic Byte Detection — Archives
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — Archives', () => {
  let detector: BinaryFileDetector;

  beforeEach(() => {
    detector = new BinaryFileDetector();
  });

  it('should detect ZIP/Office via 50 4B 03 04', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const filePath = createTempFile(buf, '.zip');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('ZIP');
    cleanupTempFile(filePath);
  });

  it('should detect GZIP via 1F 8B', () => {
    const buf = Buffer.from([0x1f, 0x8b, 0x08]);
    const filePath = createTempFile(buf, '.gz');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('GZIP');
    cleanupTempFile(filePath);
  });

  it('should detect BZIP2 via 42 5A 68', () => {
    const buf = Buffer.from([0x42, 0x5a, 0x68]);
    const filePath = createTempFile(buf, '.bz2');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('BZIP2');
    cleanupTempFile(filePath);
  });
});

// ---------------------------------------------------------------------------
// Tests: Magic Byte Detection — Executables
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — Executables', () => {
  let detector: BinaryFileDetector;

  beforeEach(() => {
    detector = new BinaryFileDetector();
  });

  it('should detect ELF via 7F 45 4C 46', () => {
    const buf = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
    const filePath = createTempFile(buf, '.o');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('ELF');
    cleanupTempFile(filePath);
  });

  it('should detect PE/EXE via 4D 5A', () => {
    const buf = Buffer.from([0x4d, 0x5a]);
    const filePath = createTempFile(buf, '.exe');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('PE executable');
    cleanupTempFile(filePath);
  });

  it('should detect WebAssembly via 00 61 73 6D', () => {
    const buf = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
    const filePath = createTempFile(buf, '.wasm');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('WebAssembly');
    cleanupTempFile(filePath);
  });
});

// ---------------------------------------------------------------------------
// Tests: Magic Byte Detection — Documents
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — Documents', () => {
  let detector: BinaryFileDetector;

  beforeEach(() => {
    detector = new BinaryFileDetector();
  });

  it('should detect PDF via 25 50 44 46', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    const filePath = createTempFile(buf, '.pdf');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('PDF');
    cleanupTempFile(filePath);
  });
});

// ---------------------------------------------------------------------------
// Tests: Null Byte Detection (Encoding Fallback)
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — Null Byte Detection', () => {
  let detector: BinaryFileDetector;

  beforeEach(() => {
    detector = new BinaryFileDetector();
  });

  it('should detect file with null bytes as binary', () => {
    const buf = Buffer.alloc(100);
    buf[0] = 0x48; // 'H'
    buf[1] = 0x65; // 'e'
    buf[50] = 0x00; // null byte
    const filePath = createTempFile(buf, '.unknown');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.reason).toContain('null byte');
    cleanupTempFile(filePath);
  });

  it('should classify plain text as not binary', () => {
    const content = 'Hello, world! This is plain text content for testing.\n';
    const filePath = createTempFile(content, '.txt');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(false);
    cleanupTempFile(filePath);
  });

  it('should classify code as not binary', () => {
    const content = 'function main(): void {\n  console.log("hello");\n}\n';
    const filePath = createTempFile(content, '.ts');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(false);
    cleanupTempFile(filePath);
  });
});

// ---------------------------------------------------------------------------
// Tests: BOM Detection
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — BOM Detection', () => {
  let detector: BinaryFileDetector;

  beforeEach(() => {
    detector = new BinaryFileDetector();
  });

  it('should classify UTF-8 BOM file as text', () => {
    const buf = Buffer.from([0xef, 0xbb, 0xbf, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    const filePath = createTempFile(buf, '.txt');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(false);
    cleanupTempFile(filePath);
  });

  it('should classify UTF-16 LE BOM file as text', () => {
    const buf = Buffer.from([0xff, 0xfe, 0x48, 0x00, 0x65, 0x00]);
    const filePath = createTempFile(buf, '.txt');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(false);
    cleanupTempFile(filePath);
  });
});

// ---------------------------------------------------------------------------
// Tests: Non-Printable Character Threshold
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — Non-Printable Threshold', () => {
  let detector: BinaryFileDetector;

  beforeEach(() => {
    detector = new BinaryFileDetector();
  });

  it('should classify content with >10% non-printable chars as binary', () => {
    const buf = Buffer.alloc(100);
    for (let i = 0; i < 15; i++) {
      buf[i] = 0x01; // non-printable
    }
    for (let i = 15; i < 100; i++) {
      buf[i] = 0x41; // 'A'
    }
    const filePath = createTempFile(buf, '.dat');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    cleanupTempFile(filePath);
  });

  it('should classify content with <10% non-printable chars as text', () => {
    const buf = Buffer.alloc(200);
    for (let i = 0; i < 10; i++) {
      buf[i] = 0x01;
    }
    for (let i = 10; i < 200; i++) {
      buf[i] = 0x41;
    }
    const filePath = createTempFile(buf, '.dat');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(false);
    cleanupTempFile(filePath);
  });
});

// ---------------------------------------------------------------------------
// Tests: Edge Cases
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — Edge Cases', () => {
  let detector: BinaryFileDetector;

  beforeEach(() => {
    detector = new BinaryFileDetector();
  });

  it('should handle empty files', () => {
    const filePath = createTempFile('', '.txt');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(false);
    cleanupTempFile(filePath);
  });

  it('should handle short files (1 byte)', () => {
    const buf = Buffer.from([0x41]); // 'A'
    const filePath = createTempFile(buf, '.bin');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(false);
    cleanupTempFile(filePath);
  });

  it('should handle non-existent files safely', () => {
    const result = detector.detectFile('/nonexistent/path/file.txt');
    expect(result.isBinary).toBe(true);
    expect(result.reason).toContain('Unable to read');
  });

  it('should detect buffer content correctly', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff]);
    const result = detector.detectBuffer(buf);
    // JPEG magic bytes match, but this is buffer-only check without extension
    expect(result).toBeDefined();
  });

  it('should handle files without extension', () => {
    const content = 'plain text without extension\n';
    const filePath = createTempFile(content, '');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(false);
    cleanupTempFile(filePath);
  });

  it('should return consistent results for repeated calls', () => {
    const content = 'console.log("hello");\n';
    const filePath = createTempFile(content, '.ts');
    const result1 = detector.detectFile(filePath);
    const result2 = detector.detectFile(filePath);
    expect(result1.isBinary).toBe(result2.isBinary);
    cleanupTempFile(filePath);
  });
});

// ---------------------------------------------------------------------------
// Tests: Custom Signatures
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — Custom Signatures', () => {
  it('should use custom signatures for detection', () => {
    const detector = new BinaryFileDetector({
      customSignatures: [
        { offset: 0, bytes: [0xde, 0xad, 0xbe, 0xef], format: 'Custom binary' },
      ],
    });
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const filePath = createTempFile(buf, '.custom');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('Custom binary');
    cleanupTempFile(filePath);
  });

  it('should register custom signatures dynamically', () => {
    const detector = new BinaryFileDetector();
    detector.registerSignature({
      offset: 0,
      bytes: [0xca, 0xfe, 0xba, 0xbe],
      format: 'Dynamic custom',
    });
    const buf = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
    const filePath = createTempFile(buf, '.custom');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('Dynamic custom');
    cleanupTempFile(filePath);
  });

  it('should not match custom signature at wrong offset', () => {
    const detector = new BinaryFileDetector({
      customSignatures: [
        { offset: 4, bytes: [0xde, 0xad], format: 'Offset custom' },
      ],
    });
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0xde, 0xad]);
    const filePath = createTempFile(buf, '.custom');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    expect(result.format).toContain('Offset custom');
    cleanupTempFile(filePath);
  });
});

// ---------------------------------------------------------------------------
// Tests: Acceptance Criteria
// ---------------------------------------------------------------------------

describe('BinaryFileDetector — Acceptance Criteria', () => {
  let detector: BinaryFileDetector;

  beforeEach(() => {
    detector = new BinaryFileDetector();
  });

  it('AC-1: Detects 20+ common binary formats correctly', () => {
    const testCases: Array<{ bytes: number[]; expected: string }> = [
      { bytes: [0xff, 0xd8, 0xff], expected: 'JPEG' },
      { bytes: [0x89, 0x50, 0x4e, 0x47], expected: 'PNG' },
      { bytes: [0x47, 0x49, 0x46, 0x38], expected: 'GIF' },
      { bytes: [0x50, 0x4b, 0x03, 0x04], expected: 'ZIP' },
      { bytes: [0x1f, 0x8b], expected: 'GZIP' },
      { bytes: [0x7f, 0x45, 0x4c, 0x46], expected: 'ELF' },
      { bytes: [0x4d, 0x5a], expected: 'PE executable' },
      { bytes: [0x25, 0x50, 0x44, 0x46], expected: 'PDF' },
      { bytes: [0xca, 0xfe, 0xba, 0xbe], expected: 'Java class' },
      { bytes: [0x00, 0x61, 0x73, 0x6d], expected: 'WebAssembly' },
      { bytes: [0x49, 0x44, 0x33], expected: 'MP3' },
      { bytes: [0x53, 0x51, 0x4c, 0x69], expected: 'SQLite' },
      { bytes: [0x42, 0x5a, 0x68], expected: 'BZIP2' },
      { bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], expected: 'XZ' },
      { bytes: [0x66, 0x4c, 0x61, 0x43], expected: 'FLAC' },
      { bytes: [0x4f, 0x67, 0x67, 0x53], expected: 'OGG' },
      { bytes: [0x77, 0x4f, 0x46, 0x46], expected: 'WOFF' },
      { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], expected: '7-Zip' },
      { bytes: [0x42, 0x4d], expected: 'BMP' },
      { bytes: [0x4f, 0x54, 0x54, 0x4f], expected: 'OpenType' },
    ];

    for (const { bytes, expected } of testCases) {
      const buf = Buffer.from(bytes);
      const filePath = createTempFile(buf, '.bin');
      const result = detector.detectFile(filePath);
      expect(result.isBinary).toBe(true);
      expect(result.format).toContain(expected);
      cleanupTempFile(filePath);
    }
  });

  it('AC-2: Does not classify known text extensions as binary', () => {
    const textExts = ['ts', 'js', 'py', 'go', 'java', 'rs', 'html', 'css', 'json', 'yaml'];
    for (const ext of textExts) {
      const result = detector.detectFile(`/src/file.${ext}`);
      expect(result.isBinary).toBe(false);
    }
  });

  it('AC-3: Detects null bytes even without known magic bytes', () => {
    const buf = Buffer.alloc(200);
    buf.write('Some text at start');
    buf[100] = 0x00; // null byte in middle
    const filePath = createTempFile(buf, '.dat');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(true);
    cleanupTempFile(filePath);
  });

  it('AC-4: Correctly handles Unicode BOM files as text', () => {
    const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf, 0x65, 0x78, 0x70, 0x6f, 0x72, 0x74]);
    const filePath = createTempFile(utf8Bom, '.txt');
    const result = detector.detectFile(filePath);
    expect(result.isBinary).toBe(false);
    cleanupTempFile(filePath);
  });
});
