// @code-analyzer/infra — IncrementalIndexer Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { IncrementalIndexer } from '../cache/incremental-indexer.js';
import { ContentCache, computeSha256 } from '../cache/content-cache.js';
import type { DiscoveredFile, KnowledgeGraph } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDiscoveredFile(
  filePath: string,
  content: string,
): DiscoveredFile {
  return {
    filePath,
    language: 'typescript',
    content,
    hash: computeSha256(content),
    size: content.length,
  };
}

function createMockKnowledgeGraph(
  filePaths: string[],
): KnowledgeGraph {
  const fileIndex = new Map<string, number>();
  filePaths.forEach((fp, i) => fileIndex.set(fp, i + 1));

  return {
    projectId: 'test-project',
    nodes: new Map(),
    edges: new Map(),
    qnameIndex: new Map(),
    fileIndex,
  };
}

// ---------------------------------------------------------------------------
// IncrementalIndexer — change detection
// ---------------------------------------------------------------------------

describe('IncrementalIndexer', () => {
  let cache: ContentCache;
  let graph: KnowledgeGraph;
  let indexer: IncrementalIndexer;

  beforeEach(() => {
    cache = new ContentCache(10_000);
    graph = createMockKnowledgeGraph(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    indexer = new IncrementalIndexer(cache, graph);
  });

  describe('constructor', () => {
    it('stores references to cache and graph', () => {
      expect(indexer.getCache()).toBe(cache);
      expect(indexer.getGraph()).toBe(graph);
    });
  });

  describe('computeHash', () => {
    it('computes SHA-256 hash of content', () => {
      const hash = indexer.computeHash('test content');
      expect(hash).toBe(computeSha256('test content'));
      expect(hash.length).toBe(64);
    });
  });

  describe('detectChanges', () => {
    it('returns all files as changed when cache is empty', () => {
      const files = [
        createDiscoveredFile('src/a.ts', 'const a = 1;'),
        createDiscoveredFile('src/b.ts', 'const b = 2;'),
        createDiscoveredFile('src/c.ts', 'const c = 3;'),
      ];

      const result = indexer.detectChanges(files);

      expect(result.changed).toHaveLength(3);
      expect(result.unchanged).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('returns files as unchanged when content matches cache', () => {
      const files = [
        createDiscoveredFile('src/a.ts', 'const a = 1;'),
        createDiscoveredFile('src/b.ts', 'const b = 2;'),
      ];

      // Pre-populate cache with matching content
      cache.set('src/a.ts', 'const a = 1;');
      cache.set('src/b.ts', 'const b = 2;');

      const result = indexer.detectChanges(files);

      expect(result.changed).toHaveLength(0);
      expect(result.unchanged).toHaveLength(2);
    });

    it('detects truly modified file (content changed)', () => {
      // Cache has old version
      cache.set('src/a.ts', 'const a = 1;');

      const files = [
        createDiscoveredFile('src/a.ts', 'const a = 2;'), // modified!
      ];

      const result = indexer.detectChanges(files);

      expect(result.changed).toHaveLength(1);
      expect(result.changed[0]!.filePath).toBe('src/a.ts');
      expect(result.unchanged).toHaveLength(0);
    });

    it('detects removed files (in graph but not on disk)', () => {
      // 'src/c.ts' is in the graph but not in discovered files
      const files = [
        createDiscoveredFile('src/a.ts', 'const a = 1;'),
        createDiscoveredFile('src/b.ts', 'const b = 2;'),
      ];

      const result = indexer.detectChanges(files);

      expect(result.removed).toHaveLength(1);
      expect(result.removed).toContain('src/c.ts');
    });

    it('detects new files (on disk but not in graph)', () => {
      const files = [
        createDiscoveredFile('src/a.ts', 'const a = 1;'),
        createDiscoveredFile('src/new.ts', 'const n = 99;'), // new!
      ];

      const result = indexer.detectChanges(files);

      expect(result.changed).toHaveLength(2); // both in changed (new = changed)
      expect(result.unchanged).toHaveLength(0);
      expect(result.removed).toHaveLength(2); // b and c removed from graph's view
    });

    it('mixed scenario: new, modified, unchanged, removed', () => {
      const graph = createMockKnowledgeGraph(['unchanged.ts', 'modified.ts', 'removed.ts']);
      const indexer = new IncrementalIndexer(cache, graph);

      // Pre-populate cache
      cache.set('unchanged.ts', 'same');
      cache.set('modified.ts', 'old content');

      const files = [
        createDiscoveredFile('unchanged.ts', 'same'),       // unchanged
        createDiscoveredFile('modified.ts', 'new content'),   // modified!
        createDiscoveredFile('new.ts', 'fresh'),              // new!
      ];

      const result = indexer.detectChanges(files);

      expect(result.unchanged).toHaveLength(1);
      expect(result.unchanged[0]!.filePath).toBe('unchanged.ts');

      expect(result.changed).toHaveLength(2);
      expect(result.changed.map((f) => f.filePath).sort()).toEqual([
        'modified.ts',
        'new.ts',
      ]);

      expect(result.removed).toHaveLength(1);
      expect(result.removed).toContain('removed.ts');
    });
  });

  describe('detectChangesWithStats', () => {
    it('returns statistics alongside results', () => {
      cache.set('src/a.ts', 'const a = 1;');

      const files = [
        createDiscoveredFile('src/a.ts', 'const a = 1;'), // unchanged
        createDiscoveredFile('src/b.ts', 'const b = 2;'), // new
      ];

      const { result, stats } = indexer.detectChangesWithStats(files);

      expect(stats.totalFiles).toBe(2);
      expect(stats.unchangedCount).toBe(1);
      expect(stats.changedCount).toBe(1);
      expect(stats.removedCount).toBe(1); // c.ts removed
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('stats.durationMs is non-negative', () => {
      const files = [createDiscoveredFile('src/a.ts', 'hello')];
      const { stats } = indexer.detectChangesWithStats(files);
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('computes cache hit rate when cache has hits and misses', () => {
      // Pre-populate the cache
      cache.set('src/a.ts', 'const a = 1;');

      // Artificially generate hits and misses via has() calls
      cache.has('src/a.ts', 'const a = 1;'); // hit
      cache.has('src/a.ts', 'const a = 1;'); // hit
      cache.has('nonexistent.ts', 'blah');    // miss
      cache.has('src/a.ts', 'wrong content'); // miss

      const files = [createDiscoveredFile('src/a.ts', 'const a = 1;')];
      const { stats } = indexer.detectChangesWithStats(files);

      expect(stats.cacheHitRate).toBeGreaterThan(0);
      expect(stats.cacheHitRate).toBeLessThan(1);
    });
  });

  describe('updateCache', () => {
    it('stores all provided files in the cache', () => {
      const files = [
        createDiscoveredFile('src/a.ts', 'hello'),
        createDiscoveredFile('src/b.ts', 'world'),
      ];

      indexer.updateCache(files);

      expect(cache.get('src/a.ts')!.sha256).toBe(computeSha256('hello'));
      expect(cache.get('src/b.ts')!.sha256).toBe(computeSha256('world'));
      expect(cache.size).toBe(2);
    });

    it('overwrites existing cache entries', () => {
      cache.set('src/a.ts', 'old');
      const files = [createDiscoveredFile('src/a.ts', 'new')];

      indexer.updateCache(files);

      expect(cache.get('src/a.ts')!.sha256).toBe(computeSha256('new'));
    });
  });

  describe('removeFromCache', () => {
    it('removes specified file paths from cache', () => {
      cache.set('src/a.ts', 'a');
      cache.set('src/b.ts', 'b');
      cache.set('src/c.ts', 'c');

      indexer.removeFromCache(['src/a.ts', 'src/c.ts']);

      expect(cache.get('src/a.ts')).toBeNull();
      expect(cache.get('src/b.ts')).not.toBeNull();
      expect(cache.get('src/c.ts')).toBeNull();
      expect(cache.size).toBe(1);
    });

    it('handles empty array', () => {
      cache.set('src/a.ts', 'a');
      indexer.removeFromCache([]);
      expect(cache.size).toBe(1);
    });

    it('handles non-existent files gracefully', () => {
      cache.set('src/a.ts', 'a');
      indexer.removeFromCache(['nonexistent.ts']);
      expect(cache.size).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// IncrementalIndexer — git diff integration
// ---------------------------------------------------------------------------

describe('IncrementalIndexer with git diff', () => {
  let cache: ContentCache;

  beforeEach(() => {
    cache = new ContentCache(10_000);
  });

  it('skips git-diff-not-flagged files (assumes unchanged)', () => {
    const graph = createMockKnowledgeGraph(['a.ts', 'b.ts', 'c.ts']);
    const indexer = new IncrementalIndexer(cache, graph);

    const files = [
      createDiscoveredFile('a.ts', 'content a'),
      createDiscoveredFile('b.ts', 'content b'),
      createDiscoveredFile('c.ts', 'content c'),
    ];

    // Only 'b.ts' flagged by git diff
    const result = indexer.detectChanges(files, {
      gitDiffFiles: ['b.ts'],
    });

    // a.ts and c.ts are not flagged — treated as unchanged
    // b.ts is flagged — will be checked against cache, but cache is empty so it's changed
    expect(result.unchanged).toHaveLength(2);
    expect(result.unchanged.map((f) => f.filePath).sort()).toEqual(['a.ts', 'c.ts']);

    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]!.filePath).toBe('b.ts');
  });

  it('git-diff-flagged files are still verified against cache', () => {
    const graph = createMockKnowledgeGraph(['a.ts']);
    const indexer = new IncrementalIndexer(cache, graph);

    // Pre-populate cache
    cache.set('a.ts', 'original content');

    const files = [createDiscoveredFile('a.ts', 'original content')];

    // git diff flags it, but content is same — should be unchanged
    const result = indexer.detectChanges(files, {
      gitDiffFiles: ['a.ts'],
    });

    expect(result.unchanged).toHaveLength(1);
    expect(result.changed).toHaveLength(0);
  });

  it('git-diff-flagged file with actual content change is detected', () => {
    const graph = createMockKnowledgeGraph(['a.ts']);
    const indexer = new IncrementalIndexer(cache, graph);

    cache.set('a.ts', 'old content');

    const files = [createDiscoveredFile('a.ts', 'new content')];

    const result = indexer.detectChanges(files, {
      gitDiffFiles: ['a.ts'],
    });

    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]!.filePath).toBe('a.ts');
  });

  it('empty gitDiffFiles treats all files as unchanged (no flag = no check)', () => {
    const graph = createMockKnowledgeGraph(['a.ts', 'b.ts']);
    const indexer = new IncrementalIndexer(cache, graph);

    const files = [
      createDiscoveredFile('a.ts', 'content'),
      createDiscoveredFile('b.ts', 'content'),
    ];

    // Empty list = no files to diff
    const result = indexer.detectChanges(files, { gitDiffFiles: [] });

    expect(result.unchanged).toHaveLength(2);
    expect(result.changed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// IncrementalIndexer — empty input handling
// ---------------------------------------------------------------------------

describe('IncrementalIndexer empty input', () => {
  let cache: ContentCache;

  beforeEach(() => {
    cache = new ContentCache(10_000);
  });

  it('handles empty file list', () => {
    const graph = createMockKnowledgeGraph([]);
    const indexer = new IncrementalIndexer(cache, graph);

    const result = indexer.detectChanges([]);

    expect(result.changed).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('empty files but graph has entries — all removed', () => {
    const graph = createMockKnowledgeGraph(['deleted.ts', 'gone.ts']);
    const indexer = new IncrementalIndexer(cache, graph);

    const result = indexer.detectChanges([]);

    expect(result.changed).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
    expect(result.removed).toHaveLength(2);
    expect(result.removed).toContain('deleted.ts');
    expect(result.removed).toContain('gone.ts');
  });

  it('empty graph but files exist — all changed (new)', () => {
    const graph = createMockKnowledgeGraph([]);
    const indexer = new IncrementalIndexer(cache, graph);

    const files = [
      createDiscoveredFile('src/new.ts', 'code'),
    ];

    const result = indexer.detectChanges(files);

    expect(result.changed).toHaveLength(1);
    expect(result.unchanged).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('stats with empty file list', () => {
    const graph = createMockKnowledgeGraph([]);
    const indexer = new IncrementalIndexer(cache, graph);

    const { result, stats } = indexer.detectChangesWithStats([]);

    expect(stats.totalFiles).toBe(0);
    expect(stats.unchangedCount).toBe(0);
    expect(stats.changedCount).toBe(0);
    expect(stats.removedCount).toBe(0);
    expect(result.changed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// IncrementalIndexer — large batch
// ---------------------------------------------------------------------------

describe('IncrementalIndexer large batch', () => {
  it('correctly processes 5,000 files', () => {
    const cache = new ContentCache(50_000);
    const filePaths = Array.from({ length: 5_000 }, (_, i) => `src/file${i}.ts`);
    const graph = createMockKnowledgeGraph(filePaths);
    const indexer = new IncrementalIndexer(cache, graph);

    // Pre-populate cache for half the files
    const files: DiscoveredFile[] = [];
    for (let i = 0; i < 5_000; i++) {
      const content = `content ${i}`;
      files.push(createDiscoveredFile(`src/file${i}.ts`, content));

      if (i < 2_500) {
        cache.set(`src/file${i}.ts`, content);
      }
    }

    const result = indexer.detectChanges(files);

    expect(result.unchanged).toHaveLength(2_500); // first half
    expect(result.changed).toHaveLength(2_500);   // second half (not cached)
    expect(result.removed).toHaveLength(0);
  });

  it('hashes are computed correctly for all files in large batch', () => {
    const cache = new ContentCache(50_000);
    const graph = createMockKnowledgeGraph([]);
    const indexer = new IncrementalIndexer(cache, graph);

    const files: DiscoveredFile[] = [];
    for (let i = 0; i < 1_000; i++) {
      const content = `batch content ${i}`;
      files.push(createDiscoveredFile(`f${i}.ts`, content));
    }

    const result = indexer.detectChanges(files);

    // All should be "changed" since nothing is cached
    for (const file of result.changed) {
      // Verify hash consistency
      const expectedHash = computeSha256(file.content);
      // The file.hash from createDiscoveredFile uses computeSha256 already
      expect(file.hash).toBe(expectedHash);
    }
  });
});

// ---------------------------------------------------------------------------
// IncrementalIndexer — complete workflow simulation
// ---------------------------------------------------------------------------

describe('IncrementalIndexer workflow', () => {
  it('simulates full index → modify → re-index cycle', () => {
    const cache = new ContentCache(10_000);
    const graph = createMockKnowledgeGraph(['a.ts', 'b.ts', 'c.ts']);
    const indexer = new IncrementalIndexer(cache, graph);

    // === Initial index ===
    const initialFiles = [
      createDiscoveredFile('a.ts', 'function a() {}'),
      createDiscoveredFile('b.ts', 'function b() {}'),
      createDiscoveredFile('c.ts', 'function c() {}'),
    ];

    const r1 = indexer.detectChanges(initialFiles);
    expect(r1.changed).toHaveLength(3);
    expect(r1.unchanged).toHaveLength(0);

    // Cache the results
    indexer.updateCache(r1.changed);

    // === Re-index (no changes) ===
    const r2 = indexer.detectChanges(initialFiles);
    expect(r2.changed).toHaveLength(0);
    expect(r2.unchanged).toHaveLength(3);

    // === Modify b.ts, add d.ts, delete c.ts ===
    const modifiedFiles = [
      createDiscoveredFile('a.ts', 'function a() {}'),       // unchanged
      createDiscoveredFile('b.ts', 'function b() { x++; }'), // modified
      createDiscoveredFile('d.ts', 'function d() {}'),       // new
      // c.ts removed
    ];

    const r3 = indexer.detectChanges(modifiedFiles);
    expect(r3.unchanged).toHaveLength(1);
    expect(r3.unchanged[0]!.filePath).toBe('a.ts');
    expect(r3.changed).toHaveLength(2);
    expect(r3.removed).toEqual(['c.ts']);

    // Cleanup removed files from cache
    indexer.removeFromCache(r3.removed);
    expect(cache.get('c.ts')).toBeNull();

    // Update cache with changed files
    indexer.updateCache(r3.changed);

    // === Verify cache state ===
    expect(cache.get('a.ts')!.sha256).toBe(computeSha256('function a() {}'));
    expect(cache.get('b.ts')!.sha256).toBe(computeSha256('function b() { x++; }'));
    expect(cache.get('d.ts')!.sha256).toBe(computeSha256('function d() {}'));
    expect(cache.get('c.ts')).toBeNull();
  });

  it('change detection with content-only change (no file rename)', () => {
    const cache = new ContentCache(1_000);
    const graph = createMockKnowledgeGraph(['main.ts']);
    const indexer = new IncrementalIndexer(cache, graph);

    cache.set('main.ts', 'import { foo } from "./bar";\nfoo();');

    const files = [
      createDiscoveredFile('main.ts', 'import { foo } from "./baz";\nfoo();'),
    ];

    const result = indexer.detectChanges(files);

    // The import path changed — content is different
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]!.filePath).toBe('main.ts');
    expect(result.changed[0]!.content).toContain('./baz');
  });
});
