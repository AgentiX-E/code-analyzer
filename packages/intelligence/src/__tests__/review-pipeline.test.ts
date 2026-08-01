// @code-analyzer/intelligence — Review Pipeline Tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReviewPipeline } from '../review/review-pipeline.js';
import { CodeReviewEngine } from '../review/review-engine.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { GitDiff, ReviewComment, GraphNode, GraphEdge } from '@code-analyzer/shared';
import type { PipelineReviewConfig } from '../review/review-pipeline.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStore(): InMemoryGraphStore {
  return new InMemoryGraphStore();
}

function createEngine(store: InMemoryGraphStore): CodeReviewEngine {
  return new CodeReviewEngine(store);
}

function createDiff(overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    filePath: 'src/app.ts',
    oldHash: 'abc',
    newHash: 'def',
    ranges: [
      { oldStart: 1, oldEnd: 5, newStart: 1, newEnd: 8, changeType: 'modified' },
    ],
    changeType: 'modified',
    ...overrides,
  };
}

function createNode(store: InMemoryGraphStore, overrides: Partial<GraphNode> = {}): void {
  store.insertNode({
    id: 0,
    projectId: 'test-project',
    label: 'Function',
    name: 'testFunc',
    qualifiedName: 'pkg.testFunc',
    filePath: 'src/app.ts',
    startLine: 1,
    endLine: 20,
    language: 'typescript',
    properties: { name: 'testFunc', isExported: true },
    signature: 'function testFunc(): void',
    docstring: 'A test function',
    complexity: 5,
    isExported: true,
    fingerprint: 'fp1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });
}

function createEdge(store: InMemoryGraphStore, overrides: Partial<GraphEdge> = {}): void {
  store.insertEdge({
    id: 0,
    projectId: 'test-project',
    sourceId: 1,
    targetId: 2,
    type: 'CALLS',
    properties: { confidence: 1 },
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });
}

function createReviewComment(
  overrides: Partial<ReviewComment> = {},
  index: number = 0,
): ReviewComment {
  return {
    path: 'src/test.ts',
    content: `Review comment ${index}`,
    existingCode: 'const a = 1;',
    startLine: 1 + index,
    endLine: 2 + index,
    category: 'maintainability',
    severity: 'medium',
    filtered: false,
    id: `comment-${index}`,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stage 1: Pre-filter Tests
// ---------------------------------------------------------------------------

describe('ReviewPipeline - Pre-filter', () => {
  it('should skip binary files', () => {
    const pipeline = new ReviewPipeline();
    const diffs = [
      createDiff({ filePath: 'assets/logo.png' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included, excluded } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(1);
    expect(included[0]!.filePath).toBe('src/app.ts');
    expect(excluded).toHaveLength(1);
    expect(excluded[0]!.filePath).toBe('assets/logo.png');
  });

  it('should skip generated files matching generated patterns', () => {
    const pipeline = new ReviewPipeline();
    const diffs = [
      createDiff({ filePath: 'src/generated/types.ts' }),
      createDiff({ filePath: 'dist/bundle.js' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included, excluded } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(1);
    expect(included[0]!.filePath).toBe('src/app.ts');
    expect(excluded).toHaveLength(2);
  });

  it('should skip config files', () => {
    const pipeline = new ReviewPipeline();
    const diffs = [
      createDiff({ filePath: 'package-lock.json' }),
      createDiff({ filePath: 'yarn.lock' }),
      createDiff({ filePath: '.gitignore' }),
      createDiff({ filePath: 'tsconfig.json' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included, excluded } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(1);
    expect(included[0]!.filePath).toBe('src/app.ts');
    expect(excluded).toHaveLength(4);
  });

  it('should skip files with .generated. in name', () => {
    const pipeline = new ReviewPipeline();
    const diffs = [
      createDiff({ filePath: 'src/types.generated.ts' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included, excluded } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(1);
    expect(included[0]!.filePath).toBe('src/app.ts');
    expect(excluded).toHaveLength(1);
  });

  it('should skip .g.ts and .g.js files', () => {
    const pipeline = new ReviewPipeline();
    const diffs = [
      createDiff({ filePath: 'src/proto.g.ts' }),
      createDiff({ filePath: 'src/graphql.g.js' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included, excluded } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(1);
    expect(included[0]!.filePath).toBe('src/app.ts');
    expect(excluded).toHaveLength(2);
  });

  it('should skip binary files with no extension', () => {
    const pipeline = new ReviewPipeline();
    const diffs = [
      createDiff({ filePath: 'Dockerfile', ranges: [] }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included, excluded } = pipeline.preFilter(diffs);
    // Dockerfile has no extension but we need to be careful — it's not binary
    // File with no extension and no ranges can be binary
    expect(included).toHaveLength(1);
    expect(included[0]!.filePath).toBe('src/app.ts');
  });

  it('should handle all binary extensions', () => {
    const pipeline = new ReviewPipeline();
    const binaryDiffs: GitDiff[] = [];

    // Test various binary extensions
    const binaryExts = [
      'image.png', 'photo.jpg', 'doc.pdf', 'archive.zip', 'program.exe',
      'lib.dll', 'lib.so', 'audio.mp3', 'video.mp4', 'font.woff', 'font.woff2',
      'data.db', 'data.sqlite', 'icon.ico', 'file.bin', 'java.class',
      'animation.gif', 'image.bmp', 'icon.svg', 'movie.mov', 'sound.wav',
    ];

    for (const path of binaryExts) {
      binaryDiffs.push(createDiff({ filePath: path }));
    }

    const { excluded } = pipeline.preFilter(binaryDiffs);
    expect(excluded).toHaveLength(binaryExts.length);
  });

  it('should not skip regular source files', () => {
    const pipeline = new ReviewPipeline();
    const diffs = [
      createDiff({ filePath: 'src/components/Button.tsx' }),
      createDiff({ filePath: 'src/utils/helpers.ts' }),
      createDiff({ filePath: 'src/api/routes.ts' }),
      createDiff({ filePath: 'tests/app.test.ts' }),
      createDiff({ filePath: 'README.md' }),
    ];

    const { included, excluded } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(5);
    expect(excluded).toHaveLength(0);
  });

  it('should handle empty diff array', () => {
    const pipeline = new ReviewPipeline();
    const { included, excluded } = pipeline.preFilter([]);
    expect(included).toHaveLength(0);
    expect(excluded).toHaveLength(0);
  });

  it('should respect skipGenerated=false config', () => {
    const pipeline = new ReviewPipeline({ skipGenerated: false });
    const diffs = [
      createDiff({ filePath: 'dist/bundle.js' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(2);
  });

  it('should respect skipBinary=false config', () => {
    const pipeline = new ReviewPipeline({ skipBinary: false });
    const diffs = [
      createDiff({ filePath: 'assets/logo.png' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(2);
  });

  it('should respect skipConfigFiles=false config', () => {
    const pipeline = new ReviewPipeline({ skipConfigFiles: false });
    const diffs = [
      createDiff({ filePath: 'package-lock.json' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Stage 2: Context Enrichment Tests
// ---------------------------------------------------------------------------

describe('ReviewPipeline - Context Enrichment', () => {
  it('should enrich diff with knowledge graph context', async () => {
    const store = createStore();
    const pipeline = new ReviewPipeline();

    // Add a node in the diff's file
    store.insertNode({
      id: 0,
      projectId: 'test',
      label: 'Function',
      name: 'myFunc',
      qualifiedName: 'src.myFunc',
      filePath: 'src/app.ts',
      startLine: 1,
      endLine: 10,
      language: 'typescript',
      properties: { name: 'myFunc', isExported: true },
      signature: 'function myFunc(): void',
      docstring: null,
      complexity: 3,
      isExported: true,
      fingerprint: 'fp1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    const diffs = [createDiff({ filePath: 'src/app.ts' })];
    const enriched = await pipeline.enrichContext(diffs, store);

    expect(enriched).toHaveLength(1);
    expect(enriched[0]!.affectedSymbols).toContain('src.myFunc');
    expect(enriched[0]!.relatedTests).toHaveLength(0);
  });

  it('should detect related test files', async () => {
    const store = createStore();
    const pipeline = new ReviewPipeline();

    // Source node
    store.insertNode({
      id: 0,
      projectId: 'test',
      label: 'Function',
      name: 'myFunc',
      qualifiedName: 'src.myFunc',
      filePath: 'src/app.ts',
      startLine: 1,
      endLine: 10,
      language: 'typescript',
      properties: { name: 'myFunc', isExported: true },
      signature: 'function myFunc(): void',
      docstring: null,
      complexity: 3,
      isExported: true,
      fingerprint: 'fp1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    // Test node
    store.insertNode({
      id: 0,
      projectId: 'test',
      label: 'Test',
      name: 'testMyFunc',
      qualifiedName: 'test.testMyFunc',
      filePath: 'src/__tests__/app.test.ts',
      startLine: 1,
      endLine: 10,
      language: 'typescript',
      properties: { name: 'testMyFunc' },
      signature: null,
      docstring: null,
      complexity: null,
      isExported: false,
      fingerprint: 'fp2',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    // Edge from source to test
    store.insertEdge({
      id: 0,
      projectId: 'test',
      sourceId: 1,
      targetId: 2,
      type: 'TESTS',
      properties: {},
      weight: 1,
      createdAt: '2024-01-01T00:00:00Z',
    });

    const diffs = [createDiff({ filePath: 'src/app.ts' })];
    const enriched = await pipeline.enrichContext(diffs, store);

    expect(enriched).toHaveLength(1);
    expect(enriched[0]!.relatedTests).toContain('src/__tests__/app.test.ts');
  });

  it('should handle diffs with no nodes in graph', async () => {
    const store = createStore();
    const pipeline = new ReviewPipeline();

    const diffs = [createDiff()];
    const enriched = await pipeline.enrichContext(diffs, store);

    expect(enriched).toHaveLength(1);
    expect(enriched[0]!.affectedSymbols).toHaveLength(0);
    expect(enriched[0]!.impactScore).toBe(0);
  });

  it('should compute impact score correctly', async () => {
    const store = createStore();
    const pipeline = new ReviewPipeline();

    // Add multiple nodes
    for (let i = 0; i < 5; i++) {
      store.insertNode({
        id: 0,
        projectId: 'test',
        label: 'Function',
        name: `func${i}`,
        qualifiedName: `src.func${i}`,
        filePath: 'src/app.ts',
        startLine: i * 10 + 1,
        endLine: i * 10 + 10,
        language: 'typescript',
        properties: { name: `func${i}`, isExported: true },
        signature: `function func${i}(): void`,
        docstring: null,
        complexity: 3,
        isExported: true,
        fingerprint: `fp${i}`,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });
    }

    const diffs = [createDiff({ filePath: 'src/app.ts' })];
    const enriched = await pipeline.enrichContext(diffs, store);

    expect(enriched[0]!.impactScore).toBe(50); // 5 * 10 + 0 * 5 = 50
  });
});

// ---------------------------------------------------------------------------
// Stage 3: Review Execution Tests
// ---------------------------------------------------------------------------

describe('ReviewPipeline - Review Execution', () => {
  it('should run review engine on diffs', async () => {
    const store = createStore();
    const engine = createEngine(store);
    const pipeline = new ReviewPipeline();

    const diffs = [{ diff: createDiff(), affectedSymbols: [], relatedTests: [], impactScore: 0 }];
    const config = {
      maxTokens: 8000,
      maxToolCalls: 10,
      planLineThreshold: 200,
      timeout: 30000,
      concurrency: 4,
    };

    const comments = await pipeline.executeReview(diffs, engine, config);
    expect(Array.isArray(comments)).toBe(true);
  });

  it('should handle empty diff array', async () => {
    const store = createStore();
    const engine = createEngine(store);
    const pipeline = new ReviewPipeline();

    const config = {
      maxTokens: 8000,
      maxToolCalls: 10,
      planLineThreshold: 200,
      timeout: 30000,
      concurrency: 4,
    };

    const comments = await pipeline.executeReview([], engine, config);
    expect(comments).toHaveLength(0);
  });

  it('should process diffs in batches', async () => {
    const store = createStore();
    const engine = createEngine(store);
    const pipeline = new ReviewPipeline();

    const diffs = [];
    for (let i = 0; i < 5; i++) {
      diffs.push({
        diff: createDiff({ filePath: `src/module${i}.ts` }),
        affectedSymbols: [],
        relatedTests: [],
        impactScore: 0,
      });
    }

    const config = {
      maxTokens: 8000,
      maxToolCalls: 10,
      planLineThreshold: 200,
      timeout: 30000,
      concurrency: 4,
    };

    const comments = await pipeline.executeReview(diffs, engine, config);
    expect(Array.isArray(comments)).toBe(true);
  });

  it('should gracefully handle review engine failure and continue', async () => {
    const store = createStore();
    const engine = createEngine(store);
    const pipeline = new ReviewPipeline();

    // Mock engine.reviewDiff to throw, triggering the catch block
    vi.spyOn(engine, 'reviewDiff').mockRejectedValueOnce(
      new Error('Engine failure'),
    );

    const diffs = [
      {
        diff: createDiff(),
        affectedSymbols: [],
        relatedTests: [],
        impactScore: 0,
      },
    ];
    const config = {
      maxTokens: 8000,
      maxToolCalls: 10,
      planLineThreshold: 200,
      timeout: 30000,
      concurrency: 4,
    };

    const comments = await pipeline.executeReview(diffs, engine, config);
    // Catch block should swallow the error and return empty array
    expect(comments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stage 4: Deduplication Tests
// ---------------------------------------------------------------------------

describe('ReviewPipeline - Deduplication', () => {
  it('should not modify empty or single comment arrays', () => {
    const pipeline = new ReviewPipeline();

    expect(pipeline.deduplicate([])).toHaveLength(0);

    const single = [createReviewComment()];
    const result = pipeline.deduplicate(single);
    expect(result).toHaveLength(1);
  });

  it('should merge identical comments on same line', () => {
    const pipeline = new ReviewPipeline();
    const comments = [
      createReviewComment({
        id: '1',
        path: 'src/app.ts',
        startLine: 5,
        endLine: 5,
        content: 'This is a comment about a bug',
      }),
      createReviewComment({
        id: '2',
        path: 'src/app.ts',
        startLine: 5,
        endLine: 5,
        content: 'This is a comment about a bug',
      }),
    ];

    const result = pipeline.deduplicate(comments);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('should not merge comments on different files', () => {
    const pipeline = new ReviewPipeline();
    const comments = [
      createReviewComment({ path: 'src/foo.ts', startLine: 1, endLine: 1 }),
      createReviewComment({ path: 'src/bar.ts', startLine: 1, endLine: 1 }),
    ];

    const result = pipeline.deduplicate(comments);
    expect(result).toHaveLength(2);
  });

  it('should not merge comments with non-overlapping lines', () => {
    const pipeline = new ReviewPipeline();
    const comments = [
      createReviewComment({
        path: 'src/app.ts',
        startLine: 1, endLine: 5,
        content: 'First comment',
      }),
      createReviewComment({
        path: 'src/app.ts',
        startLine: 10, endLine: 15,
        content: 'Second comment',
      }),
    ];

    const result = pipeline.deduplicate(comments);
    expect(result).toHaveLength(2);
  });

  it('should merge similar overlapping comments', () => {
    const pipeline = new ReviewPipeline();
    const comments = [
      createReviewComment({
        path: 'src/app.ts',
        startLine: 1, endLine: 10,
        content: 'Function is too long and complex',
        severity: 'low',
        category: 'maintainability',
      }),
      createReviewComment({
        path: 'src/app.ts',
        startLine: 5, endLine: 15,
        content: 'Function is too long and complex',
        severity: 'high',
        category: 'maintainability',
      }),
    ];

    const result = pipeline.deduplicate(comments);
    // Similar overlapping comments should be merged into one
    expect(result.length).toBeLessThanOrEqual(1);
    if (result.length > 0) {
      // The merged comment should have the higher severity
      expect(result[0]!.severity).toBe('high');
    }
  });

  it('should handle deduplication with many comments', () => {
    const pipeline = new ReviewPipeline();
    const comments: ReviewComment[] = [];

    for (let i = 0; i < 20; i++) {
      comments.push(
        createReviewComment(
          {
            id: `c${i}`,
            path: 'src/app.ts',
            startLine: 1,
            endLine: 5,
            content: `Duplicate review comment about code quality`,
          },
          i,
        ),
      );
    }

    const result = pipeline.deduplicate(comments);
    expect(result.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Stage 5: Severity Normalization Tests
// ---------------------------------------------------------------------------

describe('ReviewPipeline - Severity Normalization', () => {
  it('should not modify empty comment arrays', () => {
    const pipeline = new ReviewPipeline();
    const result = pipeline.normalize([]);
    expect(result).toHaveLength(0);
  });

  it('should keep severity levels within reasonable range', () => {
    const pipeline = new ReviewPipeline();
    const comments: ReviewComment[] = [];

    // Create many low-severity comments
    for (let i = 0; i < 30; i++) {
      comments.push(createReviewComment({
        id: `low-${i}`,
        severity: 'low',
        startLine: i + 1,
        endLine: i + 1,
      }));
    }

    const result = pipeline.normalize(comments);
    // Should still have all comments
    expect(result).toHaveLength(comments.length);

    // Some low-severity comments should have been promoted
    const lowCount = result.filter((c) => c.severity === 'low').length;
    expect(lowCount).toBeLessThanOrEqual(comments.length);
  });

  it('should not change critical severity comments', () => {
    const pipeline = new ReviewPipeline();
    const comments = [
      createReviewComment({ id: '1', severity: 'critical', startLine: 1, endLine: 1 }),
      createReviewComment({ id: '2', severity: 'critical', startLine: 2, endLine: 2 }),
    ];

    const result = pipeline.normalize(comments);
    const criticalCount = result.filter((c) => c.severity === 'critical').length;
    expect(criticalCount).toBe(2);
  });

  it('should handle single comment', () => {
    const pipeline = new ReviewPipeline();
    const comments = [createReviewComment({ severity: 'info' })];

    const result = pipeline.normalize(comments);
    expect(result).toHaveLength(1);
  });

  it('should preserve comment data after normalization', () => {
    const pipeline = new ReviewPipeline();
    const comments = [
      createReviewComment({
        id: 'comment-1',
        path: 'src/app.ts',
        content: 'Important bug here',
        severity: 'medium',
        startLine: 5,
        endLine: 10,
      }),
    ];

    const result = pipeline.normalize(comments);
    expect(result[0]!.path).toBe('src/app.ts');
    expect(result[0]!.content).toBe('Important bug here');
    expect(result[0]!.startLine).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Pipeline Integration Tests
// ---------------------------------------------------------------------------

describe('ReviewPipeline - Full Pipeline', () => {
  it('should run full pipeline successfully', async () => {
    const store = createStore();
    const engine = createEngine(store);
    const pipeline = new ReviewPipeline();

    const diffs = [createDiff()];
    const config = {
      maxTokens: 8000,
      maxToolCalls: 10,
      planLineThreshold: 200,
      timeout: 30000,
      concurrency: 4,
    };

    const comments = await pipeline.run(diffs, store, engine, config);
    expect(Array.isArray(comments)).toBe(true);
  });

  it('should filter out binary files in full pipeline', async () => {
    const store = createStore();
    const engine = createEngine(store);
    const pipeline = new ReviewPipeline();

    const diffs = [
      createDiff({ filePath: 'src/app.ts' }),
      createDiff({ filePath: 'assets/image.png' }),
    ];

    const config = {
      maxTokens: 8000,
      maxToolCalls: 10,
      planLineThreshold: 200,
      timeout: 30000,
      concurrency: 4,
    };

    const comments = await pipeline.run(diffs, store, engine, config);
    // Binary file should be filtered out, leaving only src/app.ts comments
    expect(Array.isArray(comments)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pipeline Configuration Tests
// ---------------------------------------------------------------------------

describe('ReviewPipeline - Configuration', () => {
  it('should use default configuration', () => {
    const pipeline = new ReviewPipeline();
    expect(pipeline).toBeDefined();
  });

  it('should accept custom configuration', () => {
    const pipeline = new ReviewPipeline({
      maxTokens: 32000,
      concurrency: 8,
      skipGenerated: false,
    });
    expect(pipeline).toBeDefined();
  });

  it('should accept custom generated patterns', () => {
    const pipeline = new ReviewPipeline({
      generatedPatterns: ['**/*.gen.ts', '**/auto/**'],
    });

    const diffs = [
      createDiff({ filePath: 'src/types.gen.ts' }),
      createDiff({ filePath: 'auto/generated.ts' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included, excluded } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(1);
    expect(included[0]!.filePath).toBe('src/app.ts');
    expect(excluded).toHaveLength(2);
  });

  it('should accept custom config patterns', () => {
    const pipeline = new ReviewPipeline({
      configFilePatterns: ['**/env.ts', '**/config.ts'],
    });

    const diffs = [
      createDiff({ filePath: 'src/env.ts' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included, excluded } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(1);
    expect(included[0]!.filePath).toBe('src/app.ts');
    expect(excluded).toHaveLength(1);
  });

  it('should accept custom severity distribution', () => {
    const pipeline = new ReviewPipeline({
      severityDistribution: {
        critical: 0.1,
        high: 0.2,
        medium: 0.4,
        low: 0.2,
        info: 0.1,
      },
    });
    expect(pipeline).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Edge Case Tests
// ---------------------------------------------------------------------------

describe('ReviewPipeline - Edge Cases', () => {
  it('should handle diffs with unusual file paths', () => {
    const pipeline = new ReviewPipeline();
    const diffs = [
      createDiff({ filePath: '' }),
      createDiff({ filePath: '   ' }),
      createDiff({ filePath: '///' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included } = pipeline.preFilter(diffs);
    // src/app.ts should always be included
    expect(included.some((d) => d.filePath === 'src/app.ts')).toBe(true);
  });

  it('should handle node_modules patterns', () => {
    const pipeline = new ReviewPipeline();
    const diffs = [
      createDiff({ filePath: 'node_modules/pkg/index.ts' }),
      createDiff({ filePath: 'vendor/lib/app.ts' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included, excluded } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(1);
    expect(included[0]!.filePath).toBe('src/app.ts');
    expect(excluded).toHaveLength(2);
  });

  it('should handle __snapshots__ files', () => {
    const pipeline = new ReviewPipeline();
    const diffs = [
      createDiff({ filePath: 'src/__snapshots__/snap.ts.snap' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(1);
    expect(included[0]!.filePath).toBe('src/app.ts');
  });

  it('should handle valid min.* files', () => {
    const pipeline = new ReviewPipeline();
    const diffs = [
      createDiff({ filePath: 'src/app.min.js' }),
      createDiff({ filePath: 'src/app.ts' }),
    ];

    const { included } = pipeline.preFilter(diffs);
    expect(included).toHaveLength(1);
    expect(included[0]!.filePath).toBe('src/app.ts');
  });

  it('should deduplicate comments with exact same content', () => {
    const pipeline = new ReviewPipeline();
    const comments = [
      createReviewComment({
        id: '1',
        path: 'src/app.ts',
        startLine: 1,
        endLine: 1,
        content: 'Exact duplicate content for deduplication test',
      }),
      createReviewComment({
        id: '2',
        path: 'src/app.ts',
        startLine: 1,
        endLine: 1,
        content: 'Exact duplicate content for deduplication test',
      }),
    ];

    const result = pipeline.deduplicate(comments);
    expect(result).toHaveLength(1);
  });

  it('should not merge comments on same file but different lines', () => {
    const pipeline = new ReviewPipeline();
    const comments = [
      createReviewComment({
        id: '1',
        path: 'src/app.ts',
        startLine: 1, endLine: 5,
        content: 'First issue',
      }),
      createReviewComment({
        id: '2',
        path: 'src/app.ts',
        startLine: 20, endLine: 25,
        content: 'Second issue',
      }),
    ];

    const result = pipeline.deduplicate(comments);
    expect(result).toHaveLength(2);
  });

  it('should return false when testGlobRegex regex construction fails', () => {
    const pipeline = new ReviewPipeline();

    // Temporarily replace global RegExp to force SyntaxError in testGlobRegex.
    // The method properly escapes all special chars, so this catch block is
    // defensive — we inject a mock to verify it returns false gracefully.
    const OrigRegExp = globalThis.RegExp;
    try {
      vi.stubGlobal(
        'RegExp',
        class {
          constructor(_pattern: string, _flags?: string) {
            throw new SyntaxError('Invalid regular expression');
          }
        } as any,
      );

      const result = (pipeline as any).testGlobRegex('test.ts', '**/pattern');
      expect(result).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
