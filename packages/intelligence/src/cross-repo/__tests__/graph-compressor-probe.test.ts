// The four branches the brotli probe was hiding, and the two the size guard was.
//
// Both questions are environment facts - can this runtime compress with brotli, and is this graph empty - and the
// file excluded their branches from coverage rather than answer them. `__setBrotliProbe` answers the first, and an
// empty store answers the second.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { __setBrotliProbe, GraphCompressor } from '../graph-compressor.js';

import type { InMemoryGraphStore } from '../graph-compressor.js';

const made: string[] = [];

function tempArtifact(): string {
  const dir = mkdtempSync(join(tmpdir(), 'compressor-'));
  made.push(dir);
  return join(dir, 'graph.bin');
}

/** A store with nothing in it, which is what makes the ratio guard reachable. */
function emptyStore(): InMemoryGraphStore {
  // Only the two read methods are reached by the compressor, and the type is local to the module.
  return {
    getAllNodes: () => [],
    getAllEdges: () => [],
  } as unknown as InMemoryGraphStore;
}

afterEach(() => {
  // The real probe answers again, so no test leaves the module in a state another one inherits.
  __setBrotliProbe(null);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the brotli probe', () => {
  it('compresses and decompresses with brotli when the probe says it is available', () => {
    __setBrotliProbe(() => true);
    const path = tempArtifact();
    const compressor = new GraphCompressor();
    const written = compressor.exportArtifact(emptyStore(), path);
    expect(written.nodeCount).toBe(0);
    // **And the ratio guard is NOT what an empty graph reaches.** The probe that produced this test expected zero and
    // got 0.85: `originalSize` is the length of the serialized envelope, which is never zero, so the `: 0` arm of
    // `originalSize > 0 ? ... : 0` is unreachable - the marker was hiding a **dead branch, not an untested one.**
    // What an empty graph does have is a ratio, and a round trip that keeps it.
    expect(written.originalSize).toBeGreaterThan(0);
    expect(written.compressionRatio).toBeGreaterThan(0);
    expect(compressor.verifyArtifact(path)).toBe(true);
    const read = compressor.importArtifact(path, emptyStore());
    expect(read.nodeCount).toBe(0);
    expect(read.originalSize).toBeGreaterThan(0);
  });

  it('falls back to gzip when the probe says it is not', () => {
    __setBrotliProbe(() => false);
    const path = tempArtifact();
    const compressor = new GraphCompressor();
    const written = compressor.exportArtifact(emptyStore(), path);
    expect(written.nodeCount).toBe(0);
    // Decompression takes its own fallback, which is the fourth branch.
    const read = compressor.importArtifact(path, emptyStore());
    expect(read.nodeCount).toBe(0);
  });
});
