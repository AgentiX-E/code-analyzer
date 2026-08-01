// @code-analyzer/infra — Binary File Detector
// Determines whether a file is binary by reading magic bytes from the
// beginning of the file. Uses a configurable set of binary signatures
// (magic bytes) to classify files, falling back to encoding detection
// for unknown formats.

import * as fs from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BinaryDetectionResult {
  /** Whether the file is classified as binary. */
  isBinary: boolean;
  /** The detected binary format name, or null if not binary. */
  format: string | null;
  /** Human-readable reason for the classification. */
  reason: string;
  /** Number of bytes read for detection. */
  bytesRead: number;
}

export interface BinaryDetectorOptions {
  /** Maximum bytes to read for magic byte detection (default: 4096). */
  maxBytesToRead?: number;
  /** Whether to fall back to encoding detection (default: true). */
  useEncodingDetection?: boolean;
  /** Additional custom binary signatures. */
  customSignatures?: BinarySignature[];
}

interface BinarySignature {
  /** Byte offset where the magic bytes start. */
  offset: number;
  /** Expected byte sequence (hex pairs or string). */
  bytes: number[];
  /** Description of the binary format. */
  format: string;
}

// ---------------------------------------------------------------------------
// Magic Byte Signatures
// ---------------------------------------------------------------------------

const KNOWN_BINARY_SIGNATURES: BinarySignature[] = [
  // Images
  { offset: 0, bytes: [0xff, 0xd8, 0xff], format: 'JPEG image' },
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], format: 'PNG image' },
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38], format: 'GIF image' },
  { offset: 0, bytes: [0x42, 0x4d], format: 'BMP image' },
  { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00], format: 'TIFF image (LE)' },
  { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a], format: 'TIFF image (BE)' },
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], format: 'RIFF container (AVI/WAV/WEBP)' },
  { offset: 0, bytes: [0x00, 0x00, 0x01, 0x00], format: 'ICO icon' },
  { offset: 0, bytes: [0x00, 0x00, 0x01, 0xba], format: 'MPEG video' },
  { offset: 0, bytes: [0x00, 0x00, 0x01, 0xb3], format: 'MPEG video' },

  // Compressed Archives
  { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04], format: 'ZIP archive / Office document' },
  { offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06], format: 'ZIP archive (empty)' },
  { offset: 0, bytes: [0x50, 0x4b, 0x07, 0x08], format: 'ZIP archive (spanned)' },
  { offset: 0, bytes: [0x1f, 0x8b], format: 'GZIP compressed' },
  { offset: 0, bytes: [0x42, 0x5a, 0x68], format: 'BZIP2 compressed' },
  { offset: 0, bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], format: 'XZ compressed' },
  { offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], format: '7-Zip archive' },
  { offset: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], format: 'RAR archive (v1.5)' },
  { offset: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00], format: 'RAR archive (v5)' },
  { offset: 0, bytes: [0x75, 0x73, 0x74, 0x61, 0x72], format: 'TAR archive' },

  // Executables & Object Files
  { offset: 0, bytes: [0x7f, 0x45, 0x4c, 0x46], format: 'ELF executable' },
  { offset: 0, bytes: [0x4d, 0x5a], format: 'PE executable (.exe/.dll)' },
  { offset: 0, bytes: [0xca, 0xfe, 0xba, 0xbe], format: 'Java class file' },
  { offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xce], format: 'Mach-O 32-bit' },
  { offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xcf], format: 'Mach-O 64-bit' },
  { offset: 0, bytes: [0xce, 0xfa, 0xed, 0xfe], format: 'Mach-O 32-bit (reverse)' },
  { offset: 0, bytes: [0xcf, 0xfa, 0xed, 0xfe], format: 'Mach-O 64-bit (reverse)' },
  { offset: 0, bytes: [0x00, 0x61, 0x73, 0x6d], format: 'WebAssembly binary' },

  // Audio
  { offset: 0, bytes: [0x49, 0x44, 0x33], format: 'MP3 audio (ID3 tag)' },
  { offset: 0, bytes: [0xff, 0xfb], format: 'MP3 audio' },
  { offset: 0, bytes: [0xff, 0xf3], format: 'MP3 audio' },
  { offset: 0, bytes: [0xff, 0xf2], format: 'MP3 audio' },
  { offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53], format: 'OGG container' },
  { offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43], format: 'FLAC audio' },
  { offset: 0, bytes: [0x66, 0x74, 0x79, 0x70], format: 'MP4 container' },

  // Documents & Fonts
  { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46], format: 'PDF document' },
  { offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], format: 'MS Office document (OLE)' },
  { offset: 0, bytes: [0x00, 0x01, 0x00, 0x00], format: 'TrueType font' },
  { offset: 0, bytes: [0x4f, 0x54, 0x54, 0x4f], format: 'OpenType font' },
  { offset: 0, bytes: [0x77, 0x4f, 0x46, 0x46], format: 'WOFF font' },
  { offset: 0, bytes: [0x77, 0x4f, 0x46, 0x32], format: 'WOFF2 font' },

  // Database
  { offset: 0, bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00], format: 'SQLite database' },

  // Certificate & Key
  { offset: 0, bytes: [0x30, 0x82], format: 'DER certificate' },
];

/** Common text-based extensions that should never be classified as binary. */
const TEXT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyi', 'pyx',
  'go',
  'java', 'kt', 'kts', 'scala',
  'rs',
  'rb', 'rake',
  'php', 'phtml',
  'c', 'h', 'cpp', 'hpp', 'cc', 'hh', 'cxx', 'hxx',
  'cs',
  'swift',
  'lua',
  'r',
  'zig',
  'dart', 'groovy', 'sc', 'elm',
  'html', 'htm', 'xml', 'xsl', 'xslt', 'svg',
  'css', 'scss', 'sass', 'less',
  'json', 'jsonc', 'json5',
  'yaml', 'yml',
  'toml', 'ini', 'cfg', 'conf',
  'md', 'mdx', 'rst', 'txt', 'text',
  'sh', 'bash', 'zsh', 'fish',
  'sql', 'psql',
  'Dockerfile', 'Makefile', 'dockerignore', 'gitignore',
  'env', 'editorconfig',
]);

// ---------------------------------------------------------------------------
// Binary File Detector
// ---------------------------------------------------------------------------

export class BinaryFileDetector {
  private readonly options: Required<BinaryDetectorOptions>;
  private readonly signatures: BinarySignature[];

  constructor(options: BinaryDetectorOptions = {}) {
    this.options = {
      maxBytesToRead: options.maxBytesToRead ?? 4096,
      useEncodingDetection: options.useEncodingDetection ?? true,
      customSignatures: options.customSignatures ?? [],
    };
    this.signatures = [
      ...KNOWN_BINARY_SIGNATURES,
      ...this.options.customSignatures,
    ];
  }

  /**
   * Detect if a file is binary by reading its magic bytes.
   *
   * @param filePath — absolute path to the file
   * @returns BinaryDetectionResult with classification details
   */
  detectFile(filePath: string): BinaryDetectionResult {
    // Quick check: known text extensions are never binary
    const ext = this.getExtension(filePath);
    if (TEXT_EXTENSIONS.has(ext)) {
      return {
        isBinary: false,
        format: null,
        reason: `File extension ".${ext}" is a known text format`,
        bytesRead: 0,
      };
    }

    // Read the first N bytes of the file for signature matching
    let buffer: Buffer;
    try {
      const fd = fs.openSync(filePath, 'r');
      const size = Math.min(this.options.maxBytesToRead, fs.fstatSync(fd).size);
      buffer = Buffer.alloc(size);
      fs.readSync(fd, buffer, 0, size, 0);
      fs.closeSync(fd);
    } catch {
      return {
        isBinary: true,
        format: null,
        reason: 'Unable to read file — treating as binary for safety',
        bytesRead: 0,
      };
    }

    const bytesRead = buffer.length;

    // Check against known binary signatures
    for (const sig of this.signatures) {
      if (this.matchesSignature(buffer, sig)) {
        return {
          isBinary: true,
          format: sig.format,
          reason: `Detected ${sig.format} via magic bytes at offset ${sig.offset}`,
          bytesRead,
        };
      }
    }

    // Fall back to encoding detection if enabled
    if (this.options.useEncodingDetection) {
      return this.detectByEncoding(buffer, bytesRead);
    }

    return {
      isBinary: false,
      format: null,
      reason: 'No binary signature matched',
      bytesRead,
    };
  }

  /**
   * Detect if a buffer contains binary content by checking for null bytes
   * and non-printable characters. Based on the heuristic used by `git diff`
   * and `file(1)`.
   */
  detectBuffer(buffer: Buffer): BinaryDetectionResult {
    return this.detectByEncoding(buffer, buffer.length);
  }

  /**
   * Add custom binary signatures for project-specific file types.
   */
  registerSignature(signature: BinarySignature): void {
    this.signatures.push(signature);
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private getExtension(filePath: string): string {
    const base = filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath;
    const dotIdx = base.lastIndexOf('.');
    if (dotIdx === -1) return '';
    return base.substring(dotIdx + 1).toLowerCase();
  }

  private matchesSignature(buffer: Buffer, sig: BinarySignature): boolean {
    if (buffer.length < sig.offset + sig.bytes.length) return false;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[sig.offset + i] !== sig.bytes[i]) return false;
    }
    return true;
  }

  private detectByEncoding(
    buffer: Buffer,
    bytesRead: number,
  ): BinaryDetectionResult {
    // Check for a Byte Order Mark (BOM)
    if (this.hasBOM(buffer)) {
      return {
        isBinary: false,
        format: null,
        reason: 'File starts with a Unicode BOM — likely text',
        bytesRead,
      };
    }

    // Count null bytes and non-printable characters in the first N bytes
    let nullCount = 0;
    let nonPrintableCount = 0;
    const sampleSize = Math.min(bytesRead, 8000);

    for (let i = 0; i < sampleSize; i++) {
      const byte = buffer[i]!;
      if (byte === 0x00) {
        nullCount++;
      } else if (byte < 0x07 || (byte > 0x0d && byte < 0x20)) {
        nonPrintableCount++;
      }
    }

    // If >0 null bytes found, treat as binary (consistent with git behavior)
    if (nullCount > 0) {
      return {
        isBinary: true,
        format: null,
        reason: `Contains ${nullCount} null byte(s) in first ${sampleSize} bytes — likely binary`,
        bytesRead,
      };
    }

    // If non-printable chars exceed 10% threshold, treat as binary
    const threshold = sampleSize * 0.1;
    if (nonPrintableCount > threshold) {
      return {
        isBinary: true,
        format: null,
        reason: `Contains ${nonPrintableCount} non-printable characters in first ${sampleSize} bytes — likely binary`,
        bytesRead,
      };
    }

    return {
      isBinary: false,
      format: null,
      reason: `No binary indicators detected in first ${bytesRead} bytes`,
      bytesRead,
    };
  }

  private hasBOM(buffer: Buffer): boolean {
    // UTF-8 BOM: EF BB BF
    if (buffer.length >= 3 &&
        buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return true;
    }
    // UTF-16 LE BOM: FF FE
    if (buffer.length >= 2 &&
        buffer[0] === 0xff && buffer[1] === 0xfe) {
      return true;
    }
    // UTF-16 BE BOM: FE FF
    if (buffer.length >= 2 &&
        buffer[0] === 0xfe && buffer[1] === 0xff) {
      return true;
    }
    return false;
  }
}
