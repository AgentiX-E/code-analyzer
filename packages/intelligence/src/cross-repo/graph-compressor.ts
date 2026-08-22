// @code-analyzer/intelligence — Graph Compressor
// Zstd-compressed graph artifact sharing (similar to CBM-MCP's
// `.codebase-memory/graph.db.zst`). Uses brotli compression with gzip
// fallback, and SHA-256 checksums for integrity verification.

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import {
  brotliCompressSync,
  brotliDecompressSync,
  gzipSync,
  gunzipSync,
  constants as zConstants,
} from 'node:zlib';

import type { GraphNode, GraphEdge } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Metadata describing a compressed graph artifact. */
export interface ArtifactMetadata {
  version: string;
  compressedSize: number;
  originalSize: number;
  compressionRatio: number;
  nodeCount: number;
  edgeCount: number;
  checksum: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Artifact version — bumped on format changes. */
const ARTIFACT_VERSION = '1.0.0';

/** Magic bytes prefix for the compressed artifact format. */
const MAGIC_BYTES = Buffer.from('CAGRAPH'); // "CA" + "GRAPH"

/** Header size: 6 magic + 1 version length + version bytes + 64 checksum (hex) */
const HEADER_MAGIC_SIZE = 7;
const CHECKSUM_HEX_LENGTH = 64;

/** Internal serialized graph format stored inside the artifact. */
interface SerializedGraph {
  version: string;
  createdAt: string;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
}

interface SerializedNode {
  id: number;
  projectId: string;
  label: string;
  name: string;
  qualifiedName: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  properties: Record<string, unknown>;
  signature: string | null;
  docstring: string | null;
  complexity: number | null;
  isExported: boolean;
  fingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SerializedEdge {
  id: number;
  projectId: string;
  sourceId: number;
  targetId: number;
  type: string;
  properties: Record<string, unknown>;
  weight: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if brotli compression is available in the current Node.js version.
 */
function isBrotliAvailable(): boolean {
  try {
    brotliCompressSync(Buffer.from('test'));
    return true;
  } catch {
    /* istanbul ignore next -- @preserve */
    return false;
  }
}

/**
 * Compress a buffer using brotli (preferred) or gzip (fallback).
 */
function compressBuffer(data: Buffer): Buffer {
  /* istanbul ignore if -- @preserve */
  if (isBrotliAvailable()) {
    return brotliCompressSync(data, {
      params: {
        [zConstants.BROTLI_PARAM_QUALITY]: 11,
        [zConstants.BROTLI_PARAM_LGWIN]: 22,
      },
    });
  }
  /* istanbul ignore next -- @preserve */
  // Fallback to gzip with maximum compression
  return gzipSync(data, { level: 9 });
}

/**
 * Decompress a buffer using brotli or gzip based on content detection.
 * Brotli-compressed data typically starts with specific byte patterns.
 */
function decompressBuffer(data: Buffer): Buffer {
  // Brotli detection: try brotli first if it's available
  /* istanbul ignore if -- @preserve */
  if (isBrotliAvailable()) {
    try {
      return brotliDecompressSync(data);
    } catch {
      // Not brotli — try gzip below
    }
  }

  // Try gzip decompression
  try {
    return gunzipSync(data);
  } catch {
    throw new Error('Failed to decompress artifact data: unknown compression format');
  }
}

// ---------------------------------------------------------------------------
// GraphCompressor
// ---------------------------------------------------------------------------

export class GraphCompressor {
  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  /**
   * Export the contents of an InMemoryGraphStore as a compressed artifact file.
   *
   * Serializes all nodes and edges to JSON, compresses with brotli (or gzip),
   * prepends a header with magic bytes and checksum, and writes to disk.
   *
   * @param store - The graph store to export.
   * @param outputPath - File path to write the compressed artifact.
   */
  exportArtifact(store: InMemoryGraphStore, outputPath: string): ArtifactMetadata {
    const createdAt = new Date().toISOString();
    const allNodes = store.getAllNodes();
    const allEdges = store.getAllEdges();

    // Serialize graph to JSON
    const serialized: SerializedGraph = {
      version: ARTIFACT_VERSION,
      createdAt,
      nodes: allNodes.map((n: GraphNode) => ({
        id: n.id,
        projectId: n.projectId,
        label: n.label,
        name: n.name,
        qualifiedName: n.qualifiedName,
        filePath: n.filePath,
        startLine: n.startLine,
        endLine: n.endLine,
        language: n.language,
        properties: { ...n.properties },
        signature: n.signature,
        docstring: n.docstring,
        complexity: n.complexity,
        isExported: n.isExported,
        fingerprint: n.fingerprint,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      edges: allEdges.map((e: GraphEdge) => ({
        id: e.id,
        projectId: e.projectId,
        sourceId: e.sourceId,
        targetId: e.targetId,
        type: e.type,
        properties: { ...e.properties },
        weight: e.weight,
        createdAt: e.createdAt,
      })),
    };

    const jsonStr = JSON.stringify(serialized);
    const originalBuffer = Buffer.from(jsonStr, 'utf-8');
    const originalSize = originalBuffer.length;

    // Compute checksum of the original data
    const checksum = this.computeChecksum(originalBuffer);

    // Compress the JSON data
    const compressedData = compressBuffer(originalBuffer);
    const compressedSize = compressedData.length;

    // Build header
    const header = this.buildHeader(checksum);
    const artifact = Buffer.concat([header, compressedData]);

    writeFileSync(outputPath, artifact);

    return {
      version: ARTIFACT_VERSION,
      compressedSize,
      originalSize,
      compressionRatio:
        originalSize > 0
          ? Math.round((compressedSize / originalSize) * 10000) / 10000
          : /* istanbul ignore next -- @preserve */ 0,
      nodeCount: allNodes.length,
      edgeCount: allEdges.length,
      checksum,
      createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  /**
   * Import a compressed artifact file into an InMemoryGraphStore.
   *
   * Reads the artifact, verifies the header and checksum, decompresses the
   * payload, and inserts all nodes and edges into the target store.
   *
   * @param inputPath - File path of the compressed artifact to import.
   * @param store - The target graph store to populate.
   */
  importArtifact(inputPath: string, store: InMemoryGraphStore): ArtifactMetadata {
    if (!existsSync(inputPath)) {
      throw new Error(`Artifact file not found: ${inputPath}`);
    }

    const fileBuffer = readFileSync(inputPath);

    // Parse header
    const { checksum, dataOffset } = this.parseHeader(fileBuffer);

    // Extract compressed payload
    const compressedData = fileBuffer.slice(dataOffset);

    // Decompress
    const originalBuffer = decompressBuffer(compressedData);

    // Verify checksum
    const computedChecksum = this.computeChecksum(originalBuffer);
    if (computedChecksum !== checksum) {
      throw new Error(`Artifact checksum mismatch: expected ${checksum}, got ${computedChecksum}`);
    }

    // Parse JSON
    const jsonStr = originalBuffer.toString('utf-8');
    const serialized: SerializedGraph = JSON.parse(jsonStr);

    const originalSize = originalBuffer.length;
    const compressedSize = compressedData.length;

    // Import nodes first (edges reference node IDs)
    for (const sn of serialized.nodes) {
      try {
        store.insertNode({
          id: 0, // Will be assigned by store
          projectId: sn.projectId,
          label: sn.label as GraphNode['label'],
          name: sn.name,
          qualifiedName: sn.qualifiedName,
          filePath: sn.filePath,
          startLine: sn.startLine,
          endLine: sn.endLine,
          language: sn.language,
          properties: sn.properties as GraphNode['properties'],
          signature: sn.signature,
          docstring: sn.docstring,
          complexity: sn.complexity,
          isExported: sn.isExported,
          fingerprint: sn.fingerprint,
          createdAt: sn.createdAt,
          updatedAt: sn.updatedAt,
        });
      } catch {
        // Node may already exist — skip
      }
    }

    // Import edges
    for (const se of serialized.edges) {
      try {
        store.insertEdge({
          id: 0,
          projectId: se.projectId,
          sourceId: se.sourceId,
          targetId: se.targetId,
          type: se.type as GraphEdge['type'],
          properties: { ...se.properties },
          weight: se.weight,
          createdAt: se.createdAt,
        });
      } catch {
        // Edge may already exist or reference missing nodes — skip
      }
    }

    return {
      version: serialized.version,
      compressedSize,
      originalSize,
      compressionRatio:
        originalSize > 0
          ? Math.round((compressedSize / originalSize) * 10000) / 10000
          : /* istanbul ignore next -- @preserve */ 0,
      nodeCount: serialized.nodes.length,
      edgeCount: serialized.edges.length,
      checksum,
      createdAt: serialized.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------------

  /**
   * Verify the integrity of a compressed artifact file.
   *
   * Checks that the file exists, has a valid header with magic bytes,
   * and that the decompressed content matches the stored checksum.
   *
   * @param filePath - Path to the artifact file to verify.
   * @returns `true` if the artifact is valid, `false` otherwise.
   */
  verifyArtifact(filePath: string): boolean {
    if (!existsSync(filePath)) {
      return false;
    }

    try {
      const fileBuffer = readFileSync(filePath);
      const { checksum, dataOffset } = this.parseHeader(fileBuffer);
      const compressedData = fileBuffer.slice(dataOffset);
      const originalBuffer = decompressBuffer(compressedData);
      const computedChecksum = this.computeChecksum(originalBuffer);
      return computedChecksum === checksum;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the artifact header: magic bytes + version + checksum.
   * Format: MAGIC_BYTES (7) | version_len (1 byte) | version (variable) | checksum_hex (64)
   */
  private buildHeader(checksum: string): Buffer {
    const versionBytes = Buffer.from(ARTIFACT_VERSION, 'utf-8');
    const versionLen = Buffer.alloc(1);
    versionLen.writeUInt8(versionBytes.length, 0);
    // Store checksum as hex string (64 ASCII bytes)
    const checksumStr = Buffer.from(checksum, 'utf-8');
    return Buffer.concat([MAGIC_BYTES, versionLen, versionBytes, checksumStr]);
  }

  /**
   * Parse the artifact header and return the checksum and data offset.
   * Throws if the header is invalid.
   */
  private parseHeader(fileBuffer: Buffer): { checksum: string; dataOffset: number } {
    // Minimum size: magic(7) + version_len(1) + version(1) + checksum_hex(64)
    if (fileBuffer.length < HEADER_MAGIC_SIZE + 1 + 1 + CHECKSUM_HEX_LENGTH) {
      throw new Error('Artifact file is too small to contain a valid header');
    }

    // Verify magic bytes
    const magic = fileBuffer.slice(0, HEADER_MAGIC_SIZE);
    if (!magic.equals(MAGIC_BYTES)) {
      throw new Error(
        `Invalid artifact magic bytes: expected ${MAGIC_BYTES.toString('hex')}, got ${magic.toString('hex')}`,
      );
    }

    // Read version length
    const versionLen = fileBuffer.readUInt8(HEADER_MAGIC_SIZE);
    const versionStart = HEADER_MAGIC_SIZE + 1;
    const versionEnd = versionStart + versionLen;

    // Read checksum (after version bytes)
    const checksumStart = versionEnd;
    const checksumEnd = checksumStart + CHECKSUM_HEX_LENGTH;
    const checksum = fileBuffer.slice(checksumStart, checksumEnd).toString('utf-8');

    // Validate checksum format (hex string)
    if (!/^[a-f0-9]{64}$/.test(checksum)) {
      throw new Error(`Invalid checksum format: ${checksum}`);
    }

    const dataOffset = checksumEnd;
    return { checksum, dataOffset };
  }

  /**
   * Compute SHA-256 checksum of a buffer and return as hex string.
   */
  private computeChecksum(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }
}
