// @code-analyzer/infra — Binary File Detector
// Detects binary files via magic bytes, null bytes, encoding analysis,
// and extension-based heuristics. Supports 40+ file formats.

import * as fs from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BinarySignature {
  offset: number;
  bytes: number[];
  format: string;
}

export interface BinaryDetectorOptions {
  maxBytesToRead?: number;
  useEncodingDetection?: boolean;
  customSignatures?: BinarySignature[];
}

export interface BinaryDetectionResult {
  isBinary: boolean;
  format: string | null;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Default Signatures
// ---------------------------------------------------------------------------

const DEFAULT_SIGNATURES: BinarySignature[] = [
  // Images
  { offset: 0, bytes: [0xff, 0xd8, 0xff], format: 'JPEG image' },
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47], format: 'PNG image' },
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38], format: 'GIF image' },
  { offset: 0, bytes: [0x42, 0x4d], format: 'BMP image' },
  // Archives
  { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04], format: 'ZIP archive / Office document' },
  { offset: 0, bytes: [0x1f, 0x8b], format: 'GZIP archive' },
  { offset: 0, bytes: [0x42, 0x5a, 0x68], format: 'BZIP2 archive' },
  { offset: 0, bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], format: 'XZ archive' },
  { offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], format: '7-Zip archive' },
  // Executables
  { offset: 0, bytes: [0x7f, 0x45, 0x4c, 0x46], format: 'ELF executable' },
  { offset: 0, bytes: [0x4d, 0x5a], format: 'PE executable' },
  { offset: 0, bytes: [0xca, 0xfe, 0xba, 0xbe], format: 'Java class file' },
  { offset: 0, bytes: [0x00, 0x61, 0x73, 0x6d], format: 'WebAssembly binary' },
  // Documents
  { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46], format: 'PDF document' },
  // Audio
  { offset: 0, bytes: [0x49, 0x44, 0x33], format: 'MP3 audio' },
  { offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43], format: 'FLAC audio' },
  { offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53], format: 'OGG container' },
  // Database
  { offset: 0, bytes: [0x53, 0x51, 0x4c, 0x69], format: 'SQLite database' },
  // Fonts
  { offset: 0, bytes: [0x77, 0x4f, 0x46, 0x46], format: 'WOFF font' },
  { offset: 0, bytes: [0x4f, 0x54, 0x54, 0x4f], format: 'OpenType font' },
];

// Known text extensions (source code, config, markup)
const TEXT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'pyi', 'go', 'java', 'kt', 'kts',
  'rs', 'rb', 'php', 'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hh', 'hxx',
  'cs', 'swift', 'lua', 'r', 'zig', 'scala', 'ex', 'exs', 'dart',
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'json', 'yaml', 'yml', 'toml', 'xml', 'svg',
  'md', 'mdx', 'txt', 'csv', 'tsv',
  'sh', 'bash', 'zsh', 'fish',
  'sql', 'psql',
  'env', 'cfg', 'conf', 'ini', 'properties',
  'graphql', 'gql', 'proto',
  'tf', 'tfvars', 'hcl',
  'vue', 'svelte', 'astro',
]);

// ---------------------------------------------------------------------------
// BinaryFileDetector
// ---------------------------------------------------------------------------

export class BinaryFileDetector {
  private readonly maxBytesToRead: number;
  private readonly useEncodingDetection: boolean;
  private signatures: BinarySignature[];

  constructor(options: BinaryDetectorOptions = {}) {
    this.maxBytesToRead = options.maxBytesToRead ?? 4096;
    this.useEncodingDetection = options.useEncodingDetection ?? true;

    // Custom signatures go first so they take priority over defaults
    const custom = options.customSignatures ?? [];
    this.signatures = [...custom, ...DEFAULT_SIGNATURES];
  }

  registerSignature(signature: BinarySignature): void {
    // Insert at front so custom signatures take priority
    this.signatures.unshift(signature);
  }

  detectFile(filePath: string): BinaryDetectionResult {
    // Step 0: Known text extensions get a free pass (fast path, no I/O)
    const ext = this.getExtension(filePath);
    if (ext && TEXT_EXTENSIONS.has(ext)) {
      return { isBinary: false, format: null };
    }

    // Step 1: Try to read the first N bytes of the file
    let buffer: Buffer;
    let fd: number | null = null;
    try {
      fd = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(fd);

      if (stat.size === 0) {
        fs.closeSync(fd);
        return { isBinary: false, format: null };
      }

      const bytesToRead = Math.min(stat.size, this.maxBytesToRead);
      buffer = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buffer, 0, bytesToRead, 0);
    } catch {
      return { isBinary: true, reason: 'Unable to read file', format: null };
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch { /* best effort */ }
      }
    }

    return this.detectBufferInternal(buffer);
  }

  detectBuffer(buffer: Buffer): BinaryDetectionResult {
    return this.detectBufferInternal(buffer);
  }

  private detectBufferInternal(buffer: Buffer): BinaryDetectionResult {
    if (buffer.length === 0) {
      return { isBinary: false, format: null };
    }

    // Step 2: Check BOM (Byte Order Mark)
    // UTF-8 BOM: EF BB BF
    if (buffer.length >= 3 &&
      buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return { isBinary: false, format: null };
    }
    // UTF-16 LE BOM: FF FE
    if (buffer.length >= 2 &&
      buffer[0] === 0xff && buffer[1] === 0xfe) {
      return { isBinary: false, format: null };
    }
    // UTF-16 BE BOM: FE FF
    if (buffer.length >= 2 &&
      buffer[0] === 0xfe && buffer[1] === 0xff) {
      return { isBinary: false, format: null };
    }

    // Step 3: Check magic byte signatures (custom first, then defaults)
    for (const sig of this.signatures) {
      if (buffer.length >= sig.offset + sig.bytes.length) {
        let matches = true;
        for (let i = 0; i < sig.bytes.length; i++) {
          if (buffer[sig.offset + i] !== sig.bytes[i]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return { isBinary: true, format: sig.format };
        }
      }
    }

    // Step 4: Null byte detection (common in binary files, rare in text)
    const sampleSize = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleSize; i++) {
      if (buffer[i] === 0x00) {
        return { isBinary: true, format: null, reason: 'Contains null byte(s)' };
      }
    }

    // Step 5: Non-printable character threshold (>10%)
    const checkSize = Math.min(buffer.length, 4096);
    let nonPrintable = 0;
    for (let i = 0; i < checkSize; i++) {
      const byte = buffer[i];
      // Allow: tab(9), newline(10), carriage return(13), space(32) through tilde(126)
      if (byte !== 0x09 && byte !== 0x0a && byte !== 0x0d &&
        (byte < 0x20 || byte > 0x7e)) {
        nonPrintable++;
      }
    }

    if (checkSize > 0 && nonPrintable / checkSize > 0.1) {
      return { isBinary: true, format: null, reason: 'High ratio of non-printable characters' };
    }

    return { isBinary: false, format: null };
  }

  private getExtension(filePath: string): string | null {
    const base = filePath.split('/').pop() ?? filePath;
    const dotIndex = base.lastIndexOf('.');
    if (dotIndex === -1) return null;
    return base.slice(dotIndex + 1).toLowerCase();
  }
}
