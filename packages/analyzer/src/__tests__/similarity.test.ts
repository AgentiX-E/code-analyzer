import { describe, it, expect } from 'vitest';
import {
  SimilarityPhase,
  tokenizeCode,
  computeMinHash,
  jaccardSimilarity,
} from '../pipeline/phases/similarity.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { PipelineContext, CodeAnalyzerConfig, DiscoveredFile } from '@code-analyzer/shared';

const PROJ = 'test-proj';
const ROOT = '/proj';

function makeConfig(): CodeAnalyzerConfig {
  return {
    projectId: PROJ,
    rootPath: ROOT,
    excludePatterns: [],
    includePatterns: [],
    maxFileSize: 0,
    maxFiles: 0,
    parseWorkers: 1,
    ignorePaths: [],
  };
}

function makeDiscoveredFile(filePath: string, content: string): DiscoveredFile {
  return { filePath, language: 'typescript', content, hash: 'abc', size: content.length };
}

function makeCtx(
  scanFiles: DiscoveredFile[],
  fileIndex: Map<string, number> = new Map(),
): PipelineContext {
  const store = new InMemoryGraphStore();
  for (const [path, id] of fileIndex) store.fileIndex.set(path, id);
  const ctx: PipelineContext = {
    projectId: PROJ,
    rootPath: ROOT,
    phaseData: new Map([['scan', { discoveredFiles: scanFiles }]]),
    config: makeConfig(),
    graph: store as unknown as PipelineContext['graph'],
  };
  return ctx;
}

describe('tokenizeCode', () => {
  it('strips single-line and block comments', () => {
    const ngrams = tokenizeCode('// secret token\n/* block secret */\nconst x = 1;');
    const joined = ngrams.join(' ');
    expect(joined).not.toContain('secret');
    expect(joined).not.toContain('block');
  });

  it('replaces string literals with STR', () => {
    const ngrams = tokenizeCode('const greeting = "hello world";');
    expect(ngrams.some((n) => n.includes('STR'))).toBe(true);
  });

  it('replaces numeric literals with NUM', () => {
    const ngrams = tokenizeCode('const answer = 42;');
    expect(ngrams.some((n) => n.includes('NUM'))).toBe(true);
  });

  it('returns an empty array for empty content', () => {
    expect(tokenizeCode('')).toEqual([]);
  });

  it('honours a custom granularity', () => {
    expect(tokenizeCode('a b c d', 2)).toEqual(['a b', 'b c', 'c d']);
  });
});

describe('computeMinHash', () => {
  it('returns all sentinel values for empty n-grams', () => {
    const hashes = computeMinHash([]);
    expect(hashes).toHaveLength(16);
    expect(hashes.every((h) => h === Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('produces deterministic hashes below the sentinel for real n-grams', () => {
    const ngrams = ['a b c', 'd e f'];
    const first = computeMinHash(ngrams);
    const second = computeMinHash(ngrams);
    expect(first).toEqual(second);
    expect(first.every((h) => h < Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1 for identical arrays', () => {
    expect(jaccardSimilarity([1, 2, 3], [1, 2, 3])).toBe(1);
  });

  it('returns 0 for empty arrays', () => {
    expect(jaccardSimilarity([], [])).toBe(0);
  });

  it('returns 0 for arrays of unequal length', () => {
    expect(jaccardSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns a fraction for partially matching arrays', () => {
    expect(jaccardSimilarity([1, 2, 3], [1, 9, 9])).toBeCloseTo(1 / 3);
  });
});

describe('SimilarityPhase — defensive branches', () => {
  it('skips discovered files that are absent from the graph file index', async () => {
    // File is in scan data but not in graph.fileIndex -> nodeId is undefined.
    const ctx = makeCtx([makeDiscoveredFile('/proj/a.ts', 'const x = 1;')]);
    const result = await new SimilarityPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { similarPairsFound: number }).similarPairsFound).toBe(0);
  });

  it('reports an Error exception from file content', async () => {
    const throwingFile = {
      filePath: '/proj/a.ts',
      language: 'typescript',
      get content(): string {
        throw new Error('kaboom');
      },
      hash: 'x',
      size: 1,
    } as unknown as DiscoveredFile;
    const ctx = makeCtx([throwingFile], new Map([['/proj/a.ts', 1]]));

    const result = await new SimilarityPhase().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('kaboom');
  });

  it('reports a non-Error exception from file content', async () => {
    const throwingFile = {
      filePath: '/proj/a.ts',
      language: 'typescript',
      get content(): string {
        throw 'boom';
      },
      hash: 'x',
      size: 1,
    } as unknown as DiscoveredFile;
    const ctx = makeCtx([throwingFile], new Map([['/proj/a.ts', 1]]));

    const result = await new SimilarityPhase().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });
});
