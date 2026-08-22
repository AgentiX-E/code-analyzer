// @code-analyzer/intelligence — Graph Compressor Tests
// Comprehensive tests for GraphCompressor: export, import, verification,
// checksum integrity, compression, and edge cases.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as nodeZlib from 'node:zlib';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';
import { GraphCompressor } from '../cross-repo/graph-compressor.js';
import type { ArtifactMetadata } from '../cross-repo/graph-compressor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 0,
    projectId: 'test-project',
    label: 'Function',
    name: 'testFunction',
    qualifiedName: 'project:test-project:src/test.ts:testFunction',
    filePath: 'src/test.ts',
    startLine: 10,
    endLine: 20,
    language: 'TypeScript',
    properties: {
      name: 'testFunction',
      filePath: 'src/test.ts',
      startLine: 10,
      endLine: 20,
      language: 'TypeScript',
      isExported: true,
    },
    signature: 'function testFunction(): void',
    docstring: 'A test function',
    complexity: 3,
    isExported: true,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createTestEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: 0,
    projectId: 'test-project',
    sourceId: 1,
    targetId: 2,
    type: 'CALLS',
    properties: { confidence: 1.0 },
    weight: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Populate a store with some test data and return node IDs. */
function populateStore(store: InMemoryGraphStore): { nodeId1: number; nodeId2: number } {
  const nodeId1 = store.insertNode(createTestNode());
  const nodeId2 = store.insertNode(
    createTestNode({
      name: 'anotherFunction',
      qualifiedName: 'project:test-project:src/other.ts:anotherFunction',
      filePath: 'src/other.ts',
      label: 'Class',
      isExported: false,
    }),
  );

  store.insertEdge(createTestEdge({ sourceId: nodeId1, targetId: nodeId2 }));
  return { nodeId1, nodeId2 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphCompressor', () => {
  let compressor: GraphCompressor;
  let tempDir: string;
  let artifactPath: string;

  beforeEach(() => {
    compressor = new GraphCompressor();
    tempDir = mkdtempSync(join(tmpdir(), 'graph-compressor-'));
    artifactPath = join(tempDir, 'graph.db.zst');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------

  describe('exportArtifact', () => {
    it('should export a populated store to a compressed artifact', () => {
      const store = new InMemoryGraphStore();
      populateStore(store);

      const metadata = compressor.exportArtifact(store, artifactPath);

      expect(existsSync(artifactPath)).toBe(true);
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.nodeCount).toBe(2);
      expect(metadata.edgeCount).toBe(1);
      expect(metadata.compressedSize).toBeGreaterThan(0);
      expect(metadata.originalSize).toBeGreaterThan(0);
      expect(metadata.compressionRatio).toBeGreaterThan(0);
      expect(metadata.compressionRatio).toBeLessThan(1); // Should achieve compression
      expect(metadata.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(metadata.createdAt).toBeDefined();
    });

    it('should export an empty store', () => {
      const store = new InMemoryGraphStore();

      const metadata = compressor.exportArtifact(store, artifactPath);

      expect(existsSync(artifactPath)).toBe(true);
      expect(metadata.nodeCount).toBe(0);
      expect(metadata.edgeCount).toBe(0);
    });

    it('should produce a file smaller than uncompressed JSON', () => {
      const store = new InMemoryGraphStore();

      // Add many nodes to make compression meaningful
      for (let i = 0; i < 50; i++) {
        store.insertNode(
          createTestNode({
            name: `func${i}`,
            qualifiedName: `project:test:src/test${i}.ts:func${i}`,
            filePath: `src/test${i}.ts`,
          }),
        );
      }

      const metadata = compressor.exportArtifact(store, artifactPath);

      const fileSize = readFileSync(artifactPath).length;
      // The compressed file should be smaller than the original JSON
      expect(metadata.compressedSize).toBeLessThan(metadata.originalSize);
      // File on disk includes header, so it may be slightly larger than compressedSize
      expect(fileSize).toBeGreaterThan(0);
    });

    it('should handle nodes with null fields', () => {
      const store = new InMemoryGraphStore();
      store.insertNode(
        createTestNode({
          filePath: null,
          startLine: null,
          endLine: null,
          language: null,
          signature: null,
          docstring: null,
          complexity: null,
          fingerprint: null,
        }),
      );

      const metadata = compressor.exportArtifact(store, artifactPath);
      expect(metadata.nodeCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Import
  // -----------------------------------------------------------------------

  describe('importArtifact', () => {
    it('should import an exported artifact into a new store', () => {
      const sourceStore = new InMemoryGraphStore();
      populateStore(sourceStore);
      compressor.exportArtifact(sourceStore, artifactPath);

      const targetStore = new InMemoryGraphStore();
      const metadata = compressor.importArtifact(artifactPath, targetStore);

      expect(metadata.nodeCount).toBe(2);
      expect(metadata.edgeCount).toBe(1);
      expect(targetStore.getNodeCount()).toBe(2);
      expect(targetStore.getEdgeCount()).toBe(1);

      // Verify nodes exist
      const allNodes = targetStore.getAllNodes();
      expect(allNodes.length).toBe(2);
      expect(allNodes.some((n) => n.name === 'testFunction')).toBe(true);
      expect(allNodes.some((n) => n.name === 'anotherFunction')).toBe(true);
    });

    it('should preserve node properties after import', () => {
      const sourceStore = new InMemoryGraphStore();
      const nodeId = sourceStore.insertNode(createTestNode());
      compressor.exportArtifact(sourceStore, artifactPath);

      const targetStore = new InMemoryGraphStore();
      compressor.importArtifact(artifactPath, targetStore);

      const importedNodes = targetStore.getAllNodes();
      expect(importedNodes.length).toBe(1);
      const node = importedNodes[0]!;
      expect(node.name).toBe('testFunction');
      expect(node.label).toBe('Function');
      expect(node.isExported).toBe(true);
      expect(node.complexity).toBe(3);
      expect(node.signature).toBe('function testFunction(): void');
      expect(node.docstring).toBe('A test function');
      expect(node.language).toBe('TypeScript');
    });

    it('should throw when importing non-existent file', () => {
      const store = new InMemoryGraphStore();
      expect(() => {
        compressor.importArtifact(join(tempDir, 'nonexistent.zst'), store);
      }).toThrow('Artifact file not found');
    });

    it('should throw on checksum mismatch (corrupted artifact)', () => {
      const sourceStore = new InMemoryGraphStore();
      populateStore(sourceStore);
      compressor.exportArtifact(sourceStore, artifactPath);

      // Corrupt one byte of the checksum in the header, keeping it as valid hex
      // so that the format check passes but the value no longer matches.
      // Header format: MAGIC(7) + version_len(1) + version(5) + checksum_hex(64)
      const fileBuffer = readFileSync(artifactPath);
      const corrupted = Buffer.from(fileBuffer);
      const checksumStart = 7 + 1 + 5; // = 13

      // Find a checksum byte that is '0' (0x30) or '1' (0x31) and flip it.
      // XOR with 0x01 turns '0'↔'1', keeping it valid hex.
      for (let i = checksumStart; i < checksumStart + 64; i++) {
        const byte = corrupted[i];
        if (byte === 0x30 || byte === 0x31) {
          corrupted[i] = byte ^ 0x01;
          break;
        }
      }

      writeFileSync(artifactPath, corrupted);

      const targetStore = new InMemoryGraphStore();
      expect(() => {
        compressor.importArtifact(artifactPath, targetStore);
      }).toThrow('checksum mismatch');
    });

    it('should throw on invalid header magic bytes', () => {
      writeFileSync(artifactPath, Buffer.alloc(200, 0x00)); // All zeros

      const store = new InMemoryGraphStore();
      expect(() => {
        compressor.importArtifact(artifactPath, store);
      }).toThrow('magic bytes');
    });

    it('should throw on file too small', () => {
      writeFileSync(artifactPath, Buffer.alloc(10, 0x41));

      const store = new InMemoryGraphStore();
      expect(() => {
        compressor.importArtifact(artifactPath, store);
      }).toThrow('too small');
    });

    it('should throw on invalid checksum format in header', () => {
      // Build a header with valid magic but non-hex checksum
      const magic = Buffer.from('CAGRAPH');
      const versionBytes = Buffer.from('1.0.0', 'utf-8');
      const versionLen = Buffer.alloc(1);
      versionLen.writeUInt8(5, 0);
      const badChecksum = Buffer.from('Z'.repeat(64), 'utf-8');
      const header = Buffer.concat([magic, versionLen, versionBytes, badChecksum]);
      const dummyData = Buffer.from('hello world');
      writeFileSync(artifactPath, Buffer.concat([header, dummyData]));

      const store = new InMemoryGraphStore();
      expect(() => {
        compressor.importArtifact(artifactPath, store);
      }).toThrow('checksum format');
    });
  });

  // -----------------------------------------------------------------------
  // Verification
  // -----------------------------------------------------------------------

  describe('verifyArtifact', () => {
    it('should return true for a valid artifact', () => {
      const store = new InMemoryGraphStore();
      populateStore(store);
      compressor.exportArtifact(store, artifactPath);

      expect(compressor.verifyArtifact(artifactPath)).toBe(true);
    });

    it('should return false for non-existent file', () => {
      expect(compressor.verifyArtifact(join(tempDir, 'nope.zst'))).toBe(false);
    });

    it('should return false for a corrupted artifact', () => {
      const store = new InMemoryGraphStore();
      populateStore(store);
      compressor.exportArtifact(store, artifactPath);

      // Corrupt the file
      const buffer = readFileSync(artifactPath);
      const corrupted = Buffer.from(buffer);
      corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 0xff;
      writeFileSync(artifactPath, corrupted);

      expect(compressor.verifyArtifact(artifactPath)).toBe(false);
    });

    it('should return false for a file with invalid header', () => {
      writeFileSync(artifactPath, Buffer.from('not a valid artifact'));

      expect(compressor.verifyArtifact(artifactPath)).toBe(false);
    });

    it('should return false when header has invalid checksum format', () => {
      // Build a header with non-hex checksum
      const magic = Buffer.from('CAGRAPH');
      const versionBytes = Buffer.from('1.0.0', 'utf-8');
      const versionLen = Buffer.alloc(1);
      versionLen.writeUInt8(5, 0);
      const badChecksum = Buffer.from('X'.repeat(64), 'utf-8'); // Non-hex characters
      const header = Buffer.concat([magic, versionLen, versionBytes, badChecksum]);
      // Add some dummy data
      const dummyData = Buffer.from('hello world');
      writeFileSync(artifactPath, Buffer.concat([header, dummyData]));

      // Should fail verification because checksum format is invalid
      expect(compressor.verifyArtifact(artifactPath)).toBe(false);
    });

    it('should return false when file is too small with valid magic', () => {
      // Write a file with magic bytes but too short for full header
      const magic = Buffer.from('CAGRAPH');
      const versionLen = Buffer.alloc(1);
      versionLen.writeUInt8(5, 0);
      writeFileSync(artifactPath, Buffer.concat([magic, versionLen]));

      expect(compressor.verifyArtifact(artifactPath)).toBe(false);
    });

    it('should verify empty artifact', () => {
      const store = new InMemoryGraphStore();
      compressor.exportArtifact(store, artifactPath);

      expect(compressor.verifyArtifact(artifactPath)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Round-trip
  // -----------------------------------------------------------------------

  describe('round-trip', () => {
    it('should preserve all data through export-import cycle', () => {
      const sourceStore = new InMemoryGraphStore();

      // Add various node types
      sourceStore.insertNode(
        createTestNode({
          name: 'funcA',
          qualifiedName: 'proj:test:src/a.ts:funcA',
          label: 'Function',
        }),
      );
      sourceStore.insertNode(
        createTestNode({
          name: 'ClassB',
          qualifiedName: 'proj:test:src/b.ts:ClassB',
          label: 'Class',
          isExported: true,
          complexity: 10,
        }),
      );
      sourceStore.insertNode(
        createTestNode({
          name: 'InterfaceC',
          qualifiedName: 'proj:test:src/c.ts:InterfaceC',
          label: 'Interface',
          isExported: true,
        }),
      );

      // Add edges
      const nodes = sourceStore.getAllNodes();
      if (nodes.length >= 3) {
        sourceStore.insertEdge(
          createTestEdge({
            sourceId: nodes[0]!.id,
            targetId: nodes[1]!.id,
            type: 'CALLS',
            weight: 1,
          }),
        );
        sourceStore.insertEdge(
          createTestEdge({
            sourceId: nodes[1]!.id,
            targetId: nodes[2]!.id,
            type: 'IMPLEMENTS',
            weight: 2,
          }),
        );
      }

      compressor.exportArtifact(sourceStore, artifactPath);

      const targetStore = new InMemoryGraphStore();
      const metadata = compressor.importArtifact(artifactPath, targetStore);

      expect(metadata.nodeCount).toBe(3);
      expect(metadata.edgeCount).toBe(2);
      expect(targetStore.getNodeCount()).toBe(3);
      expect(targetStore.getEdgeCount()).toBe(2);

      const importedNodes = targetStore.getAllNodes();
      expect(importedNodes.some((n) => n.name === 'funcA')).toBe(true);
      expect(importedNodes.some((n) => n.name === 'ClassB')).toBe(true);
      expect(importedNodes.some((n) => n.name === 'InterfaceC')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  describe('ArtifactMetadata', () => {
    it('should include correct version in metadata', () => {
      const store = new InMemoryGraphStore();
      populateStore(store);

      const metadata = compressor.exportArtifact(store, artifactPath);
      expect(metadata.version).toBe('1.0.0');
    });

    it('should compute correct compression ratio', () => {
      const store = new InMemoryGraphStore();

      // Create a store with highly compressible data (repeated patterns)
      for (let i = 0; i < 100; i++) {
        store.insertNode(
          createTestNode({
            name: `repeatedFunction${i}`,
            qualifiedName: `project:test:src/repeated${i}.ts:repeatedFunction${i}`,
            filePath: `src/repeated${i}.ts`,
          }),
        );
      }

      const metadata = compressor.exportArtifact(store, artifactPath);
      expect(metadata.compressionRatio).toBeLessThan(1);
      expect(metadata.compressionRatio).toBeGreaterThan(0);
    });

    it('should include correct node and edge counts', () => {
      const store = new InMemoryGraphStore();
      populateStore(store);

      const metadata = compressor.exportArtifact(store, artifactPath);
      expect(metadata.nodeCount).toBe(2);
      expect(metadata.edgeCount).toBe(1);
    });

    it('should include a valid SHA-256 checksum', () => {
      const store = new InMemoryGraphStore();
      populateStore(store);

      const metadata = compressor.exportArtifact(store, artifactPath);
      expect(metadata.checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should include ISO 8601 createdAt timestamp', () => {
      const store = new InMemoryGraphStore();
      populateStore(store);

      const metadata = compressor.exportArtifact(store, artifactPath);
      expect(metadata.createdAt).toBeDefined();
      // Should be a valid ISO date string
      expect(() => new Date(metadata.createdAt)).not.toThrow();
      expect(new Date(metadata.createdAt).toISOString()).toBe(metadata.createdAt);
    });
  });

  // -----------------------------------------------------------------------
  // Compression fallback (gzip when brotli is unavailable)
  // -----------------------------------------------------------------------

  describe('compression fallback', () => {
    it('should use gzip when brotli compression throws', async () => {
      // Mock brotli to throw, forcing gzip fallback
      vi.doMock('node:zlib', () => ({
        ...vi.importActual('node:zlib'),
        brotliCompressSync: () => {
          throw new Error('brotli not available');
        },
        brotliDecompressSync: () => {
          throw new Error('brotli not available');
        },
      }));

      const { GraphCompressor: MockedCompressor } =
        await import('../cross-repo/graph-compressor.js');

      const c = new MockedCompressor();
      const store = new InMemoryGraphStore();
      populateStore(store);

      const metadata = c.exportArtifact(store, artifactPath);
      expect(existsSync(artifactPath)).toBe(true);

      // Should still be able to import (using gzip)
      const targetStore = new InMemoryGraphStore();
      const importMeta = c.importArtifact(artifactPath, targetStore);
      expect(importMeta.nodeCount).toBe(2);
    });
  });
});
