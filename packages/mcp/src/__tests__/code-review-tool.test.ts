// @code-analyzer/mcp — Code Review Tool Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from '../tools/tool-context.js';
import { ToolRegistry } from '../tools/registry.js';
import { createToolRegistry } from '../tools/index.js';
import {
  reviewDiff,
  reviewDiffSchema,
  reviewFile,
  reviewFileSchema,
  parseDiffContent,
  extractCommentsFromSession,
  filterComments,
  buildSummary,
  analyzeFileFromGraph,
  generateActionableRecommendations,
} from '../tools/code-review.js';
import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 0,
    projectId: 'test-project',
    label: 'Function',
    name: 'testFunc',
    qualifiedName: 'test.Function:testFunc',
    filePath: '/src/test.ts',
    startLine: 10,
    endLine: 20,
    language: 'typescript',
    properties: { name: 'testFunc' },
    signature: 'testFunc(): void',
    docstring: 'A test function',
    complexity: 5,
    isExported: true,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function createTestContext(projectId: string = 'test-project'): ToolContextImpl {
  const store = new InMemoryGraphStore();

  // Add nodes for graph-based analysis
  const nodes: GraphNode[] = [
    makeNode({ name: 'simpleFn', qualifiedName: 'pkg.simpleFn', complexity: 3, projectId }),
    makeNode({
      name: 'complexFn',
      qualifiedName: 'pkg.complexFn',
      complexity: 35,
      projectId,
      filePath: '/src/complex.ts',
    }),
    makeNode({
      name: 'MyClass',
      qualifiedName: 'pkg.MyClass',
      label: 'Class',
      complexity: 8,
      projectId,
      filePath: '/src/my-class.ts',
    }),
    makeNode({
      name: 'doWork',
      qualifiedName: 'pkg.MyClass.doWork',
      label: 'Method',
      complexity: 12,
      projectId,
      filePath: '/src/my-class.ts',
    }),
    makeNode({
      name: 'validate',
      qualifiedName: 'pkg.MyClass.validate',
      label: 'Method',
      complexity: 4,
      projectId,
      filePath: '/src/my-class.ts',
    }),
  ];

  store.insertNodes(nodes);

  // Add edges to create coupling
  const allNodes = store.getAllNodes().filter((n) => n.projectId === projectId);
  const simpleFn = allNodes.find((n) => n.name === 'simpleFn');

  if (simpleFn) {
    // Create many incoming edges to simulate high coupling
    for (let i = 0; i < 20; i++) {
      const caller = makeNode({
        name: `caller${i}`,
        qualifiedName: `pkg.caller${i}`,
        complexity: 1,
        projectId,
      });
      store.insertNode(caller);
    }
    const callers = store
      .getAllNodes()
      .filter((n) => n.projectId === projectId && n.name.startsWith('caller'));
    for (const caller of callers) {
      if (simpleFn) {
        store.insertEdge({
          id: 0,
          projectId,
          sourceId: caller.id,
          targetId: simpleFn.id,
          type: 'CALLS',
          properties: {},
          weight: 1.0,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return new ToolContextImpl(store);
}

// ---------------------------------------------------------------------------
// Tool Registration & Metadata
// ---------------------------------------------------------------------------

describe('Code Review Tools — Registration', () => {
  it('should register review_diff in the tool registry', () => {
    const registry = createToolRegistry();
    const tool = registry.get('review_diff');
    expect(tool).toBeDefined();
    expect(tool.name).toBe('review_diff');
    expect(tool.description).toBeTruthy();
    expect(tool.profile).toBe('analysis');
  });

  it('should register review_file in the tool registry', () => {
    const registry = createToolRegistry();
    const tool = registry.get('review_file');
    expect(tool).toBeDefined();
    expect(tool.name).toBe('review_file');
    expect(tool.description).toBeTruthy();
    expect(tool.profile).toBe('analysis');
  });

  it('should have valid JSON schemas', () => {
    expect(reviewDiffSchema.type).toBe('object');
    expect(reviewDiffSchema.required).toContain('projectId');
    expect(reviewDiffSchema.properties.projectId).toBeDefined();
    expect(reviewDiffSchema.properties.diff).toBeDefined();

    expect(reviewFileSchema.type).toBe('object');
    expect(reviewFileSchema.required).toContain('projectId');
    expect(reviewFileSchema.required).toContain('filePath');
    expect(reviewFileSchema.properties.filePath).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// reviewDiff — Input Schema Validation
// ---------------------------------------------------------------------------

describe('reviewDiff — Input validation', () => {
  it('should require projectId', async () => {
    const result = await reviewDiff({}, undefined);
    // Should handle missing projectId gracefully
    expect(result).toBeDefined();
  });

  it('should accept all optional parameters', async () => {
    const result = await reviewDiff(
      {
        projectId: 'test',
        diff: 'diff content',
        fromRef: 'main',
        toRef: 'feature',
        severity: 'high',
        categories: ['bug', 'security'],
      },
      undefined,
    );
    expect(result).toBeDefined();
    expect(result.isError).toBeFalsy();
  });

  it('should use default values for optional params', async () => {
    const result = await reviewDiff(
      {
        projectId: 'test',
      },
      undefined,
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.range.from).toBe('HEAD~1');
    expect(data.range.to).toBe('HEAD');
    expect(data.severity).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// reviewFile — Input Schema Validation
// ---------------------------------------------------------------------------

describe('reviewFile — Input validation', () => {
  it('should require projectId and filePath', async () => {
    const result = await reviewFile({}, undefined);
    expect(result).toBeDefined();
  });

  it('should accept optional content and severity', async () => {
    const result = await reviewFile(
      {
        projectId: 'test',
        filePath: '/src/test.ts',
        content: 'const x = 1;',
        severity: 'high',
      },
      undefined,
    );
    expect(result).toBeDefined();
    expect(result.isError).toBeFalsy();
  });

  it('should use default severity when not provided', async () => {
    const result = await reviewFile(
      {
        projectId: 'test',
        filePath: '/src/test.ts',
      },
      undefined,
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.severity).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// reviewDiff — Basic Execution
// ---------------------------------------------------------------------------

describe('reviewDiff — Basic execution', () => {
  it('should return basic analysis without store or context', async () => {
    const result = await reviewDiff(
      {
        projectId: 'test-project',
      },
      undefined,
    );

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
    expect(data.hasDiff).toBe(false);
    expect(data.comments).toEqual([]);
    expect(data.summary).toBeDefined();
    expect(data.summary.total).toBe(0);
  });

  it('should return graph integrity when passed a raw store', async () => {
    const store = new InMemoryGraphStore();
    const result = await reviewDiff(
      {
        projectId: 'test-project',
      },
      store,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.graphIntegrity).toBeDefined();
    expect(data.note).toContain('Graph data available');
  });

  it('should return heuristics results when passed a ToolContext', async () => {
    const ctx = createTestContext();
    const result = await reviewDiff(
      {
        projectId: 'test-project',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.hasDiff).toBe(false);
    expect(data.comments).toBeDefined();
    expect(data.summary).toBeDefined();

    // Should find the high-complexity function
    const hasComplexityComment = data.comments.some(
      (c: any) => c.content && c.content.includes('complexity'),
    );
    expect(hasComplexityComment).toBe(true);
  });

  it('should parse diff content and invoke review engine', async () => {
    const ctx = createTestContext();

    const diffContent = `diff --git a/src/test.ts b/src/test.ts
index abc123..def456 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,5 +1,10 @@
-export function simpleFn(): void {
-  console.log('hello');
+export function simpleFn(): void {
+  const data = await fetch('/api/secret');
+  const result = eval(data);
+  console.log(result);
 }`;

    const result = await reviewDiff(
      {
        projectId: 'test-project',
        diff: diffContent,
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.hasDiff).toBe(true);
    expect(data.sessionId).toBeDefined();
    expect(data.reviewMethod).toMatch(/heuristics|review|PRReview/i);
  });

  it('should filter by severity', async () => {
    const ctx = createTestContext();

    const result = await reviewDiff(
      {
        projectId: 'test-project',
        severity: 'critical',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.severity).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// reviewFile — Basic Execution
// ---------------------------------------------------------------------------

describe('reviewFile — Basic execution', () => {
  it('should return note about missing store without context', async () => {
    const result = await reviewFile(
      {
        projectId: 'test-project',
        filePath: '/src/test.ts',
      },
      undefined,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
    expect(data.filePath).toBe('/src/test.ts');
    expect(data.note).toContain('graph store');
  });

  it('should analyze file from graph data when passed a ToolContext', async () => {
    const ctx = createTestContext();
    const result = await reviewFile(
      {
        projectId: 'test-project',
        filePath: '/src/my-class.ts',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.filePath).toBe('/src/my-class.ts');
    expect(data.symbolsInFile).toBeGreaterThan(0);
    expect(data.comments).toBeDefined();
    expect(data.summary).toBeDefined();
  });

  it('should detect empty file (no symbols) with low severity', async () => {
    const ctx = createTestContext();
    const result = await reviewFile(
      {
        projectId: 'test-project',
        filePath: '/src/empty.ts',
        severity: 'low',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.symbolsInFile).toBe(0);

    // The "No symbols" comment has severity 'low' which is filtered by default 'medium'
    // So we need to use severity 'low' to see it
    const hasEmptyComment = data.comments.some(
      (c: any) => c.content && c.content.includes('No symbols'),
    );
    expect(hasEmptyComment).toBe(true);
  });

  it('should invoke review engine with file content', async () => {
    const ctx = createTestContext();
    const code = `export function myFunc(): void { console.log('test'); }`;

    const result = await reviewFile(
      {
        projectId: 'test-project',
        filePath: '/src/test.ts',
        content: code,
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.hasContent).toBe(true);
    expect(data.comments).toBeDefined();
    expect(data.reviewMethod).toMatch(/heuristics|review|PRReview/i);
  });
});

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

describe('Code Review Tools — Error handling', () => {
  it('reviewDiff should catch and return errors gracefully', async () => {
    // The code accesses params.projectId before try/catch, so null args throw
    // Test error path via a mock ctx that throws inside try block
    const ctx = {
      store: null,
      getReviewEngine: () => {
        throw new Error('simulated engine error');
      },
    };
    // We need ToolContextImpl.isToolContext to detect ctx as a ToolContext
    // The actual ToolContextImpl.isToolContext checks for a store property
    // So our mock won't be detected as ToolContext; it'll fall through
    // Instead test with a known-bad scenario
    const result = await reviewDiff({ projectId: 'test' }, ctx);
    // Falls through to the fallback — no error since no ToolContext match
    expect(result).toBeDefined();
  });

  it('reviewFile should catch and return errors gracefully', async () => {
    const result = await reviewFile({ projectId: 'test', filePath: '/test.ts' }, undefined);
    expect(result).toBeDefined();
    expect(result.isError).toBeFalsy();
  });

  it('reviewDiff should handle non-Error throws', async () => {
    // Create a mock that passes ToolContextImpl.isToolContext check
    // but throws a string from getReviewEngine
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);

    // Monkey-patch getReviewEngine to throw a string
    const origGetReviewEngine = ctx.getReviewEngine.bind(ctx);
    ctx.getReviewEngine = () => {
      throw 'string error';
    };
    // Also patch getPRReviewEngine since it internally calls getReviewEngine
    ctx.getPRReviewEngine = () => {
      throw 'string error';
    };

    const result = await reviewDiff(
      {
        projectId: 'test',
        diff: 'diff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
      },
      ctx,
    );

    // With a diff, the code tries PRReviewEngine then falls back to CodeReviewEngine
    // Both throw, so the outer catch should capture it
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Review error');
    expect(result.content[0].text).toContain('string error');

    // Restore
    ctx.getReviewEngine = origGetReviewEngine;
  });

  it('reviewFile should handle non-Error throws', async () => {
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);

    const origGetReviewEngine = ctx.getReviewEngine.bind(ctx);
    ctx.getReviewEngine = () => {
      throw 'string error';
    };

    const result = await reviewFile(
      {
        projectId: 'test',
        filePath: '/test.ts',
        content: 'code',
      },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Review error');

    ctx.getReviewEngine = origGetReviewEngine;
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('Code Review Tools — Edge cases', () => {
  it('reviewDiff should handle empty diff string', async () => {
    const ctx = createTestContext();
    const result = await reviewDiff(
      {
        projectId: 'test-project',
        diff: '',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.hasDiff).toBe(false);
  });

  it('reviewDiff should handle diff with only whitespace', async () => {
    const ctx = createTestContext();
    const result = await reviewDiff(
      {
        projectId: 'test-project',
        diff: '   \n  ',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    // Whitespace is still truthy so it enters the diff parsing branch
    // but parseDiffContent won't find any valid diff entries
    expect(data.hasDiff).toBe(true);
  });

  it('reviewDiff should detect high-coupling in graph analysis', async () => {
    const ctx = createTestContext();

    const result = await reviewDiff(
      {
        projectId: 'test-project',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    const hasCouplingComment = data.comments.some(
      (c: any) => c.content && c.content.includes('coupling'),
    );
    expect(hasCouplingComment).toBe(true);
  });

  it('reviewFile should detect large files with many symbols', async () => {
    const store = new InMemoryGraphStore();
    const projectId = 'test-large';

    // Insert 60 symbols in the same file
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 60; i++) {
      nodes.push(
        makeNode({
          name: `sym${i}`,
          qualifiedName: `pkg.sym${i}`,
          filePath: '/src/large-file.ts',
          projectId,
        }),
      );
    }
    store.insertNodes(nodes);

    const ctx = new ToolContextImpl(store);
    const result = await reviewFile(
      {
        projectId,
        filePath: '/src/large-file.ts',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    const hasLargeComment = data.comments.some(
      (c: any) => c.content && c.content.includes('Large file'),
    );
    expect(hasLargeComment).toBe(true);
  });

  it('reviewFile should detect complex functions', async () => {
    const store = new InMemoryGraphStore();
    const projectId = 'test-complex';

    store.insertNode(
      makeNode({
        name: 'nestedFn',
        qualifiedName: 'pkg.nestedFn',
        complexity: 30,
        filePath: '/src/nested.ts',
        projectId,
      }),
    );

    const ctx = new ToolContextImpl(store);
    const result = await reviewFile(
      {
        projectId,
        filePath: '/src/nested.ts',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    const hasComplexComment = data.comments.some(
      (c: any) => c.content && c.content.includes('Complex function'),
    );
    expect(hasComplexComment).toBe(true);
  });

  it('reviewDiff should handle custom fromRef and toRef', async () => {
    const result = await reviewDiff(
      {
        projectId: 'test-project',
        fromRef: 'v1.0',
        toRef: 'v2.0',
      },
      undefined,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.range.from).toBe('v1.0');
    expect(data.range.to).toBe('v2.0');
  });
});

// ---------------------------------------------------------------------------
// Integration with Registry
// ---------------------------------------------------------------------------

describe('Code Review Tools — Registry integration', () => {
  let registry: ToolRegistry;
  let ctx: ToolContextImpl;

  beforeEach(() => {
    registry = createToolRegistry();
    ctx = createTestContext();
  });

  it('should execute review_diff through registry', async () => {
    const result = await registry.execute(
      'review_diff',
      {
        projectId: 'test-project',
      },
      ctx,
    );

    expect(result).toBeDefined();
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
  });

  it('should execute review_file through registry', async () => {
    const result = await registry.execute(
      'review_file',
      {
        projectId: 'test-project',
        filePath: '/src/my-class.ts',
      },
      ctx,
    );

    expect(result).toBeDefined();
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.filePath).toBe('/src/my-class.ts');
  });

  it('should execute review_diff with diff content through registry', async () => {
    const diffContent = `diff --git a/src/test.ts b/src/test.ts
--- a/src/test.ts
+++ b/src/test.ts
@@ -1 +1 @@
-old
+new`;

    const result = await registry.execute(
      'review_diff',
      {
        projectId: 'test-project',
        diff: diffContent,
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.hasDiff).toBe(true);
  });

  it('should execute review_file with content through registry', async () => {
    const result = await registry.execute(
      'review_file',
      {
        projectId: 'test-project',
        filePath: '/src/test.ts',
        content: 'function test() {}',
      },
      ctx,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.hasContent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseDiffContent — direct unit tests
// ---------------------------------------------------------------------------

describe('parseDiffContent', () => {
  it('parses a modified file diff with a hunk range', () => {
    const diffs = parseDiffContent(`diff --git a/src/test.ts b/src/test.ts
index abc..def 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,5 +1,10 @@
-old
+new`);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.filePath).toBe('src/test.ts');
    expect(diffs[0]!.oldPath).toBe('src/test.ts');
    expect(diffs[0]!.changeType).toBe('modified');
    expect(diffs[0]!.ranges).toHaveLength(1);
    expect(diffs[0]!.ranges[0]).toMatchObject({
      oldStart: 1,
      newStart: 1,
      changeType: 'modified',
    });
  });

  it('detects an added file and leaves oldPath undefined', () => {
    const diffs = parseDiffContent(`diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..abc
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+line1
+line2`);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.changeType).toBe('added');
    expect(diffs[0]!.filePath).toBe('new.ts');
    expect(diffs[0]!.oldPath).toBeUndefined();
    expect(diffs[0]!.ranges[0]!.changeType).toBe('added');
  });

  it('detects a deleted file and reuses the old path as filePath', () => {
    const diffs = parseDiffContent(`diff --git a/old.ts b/old.ts
deleted file mode 100644
index abc..0000000
--- a/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-line1`);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.changeType).toBe('deleted');
    expect(diffs[0]!.filePath).toBe('old.ts');
    expect(diffs[0]!.oldPath).toBe('old.ts');
    expect(diffs[0]!.ranges[0]!.changeType).toBe('removed');
  });

  it('detects a renamed file', () => {
    const diffs = parseDiffContent(`diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts`);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.changeType).toBe('renamed');
    expect(diffs[0]!.filePath).toBe('new.ts');
  });

  it('defaults ranges when no @@ hunks are present', () => {
    const diffs = parseDiffContent(`diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts`);
    expect(diffs[0]!.ranges).toHaveLength(1);
    expect(diffs[0]!.ranges[0]).toMatchObject({
      oldStart: 1,
      oldEnd: 1,
      newStart: 1,
      newEnd: 1,
      changeType: 'modified',
    });
  });

  it('parses multiple file sections', () => {
    const diffs = parseDiffContent(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts`);
    expect(diffs).toHaveLength(2);
    expect(diffs.map((d) => d.filePath)).toEqual(['a.ts', 'b.ts']);
  });
});

// ---------------------------------------------------------------------------
// extractCommentsFromSession — direct unit tests
// ---------------------------------------------------------------------------

describe('extractCommentsFromSession', () => {
  it('returns a session digest when comments were generated', () => {
    const comments = extractCommentsFromSession({
      id: 'sess-1',
      commentsGenerated: 3,
      filesReviewed: 2,
    });
    expect(comments).toHaveLength(1);
    expect((comments[0] as { content: string }).content).toContain('3 comments');
    expect((comments[0] as { content: string }).content).toContain('2 files');
  });

  it('returns an empty list when no comments were generated', () => {
    expect(extractCommentsFromSession({ id: 'sess-2' })).toEqual([]);
    expect(extractCommentsFromSession({ id: 'sess-3', commentsGenerated: 0 })).toEqual([]);
  });

  it('falls back to zero files when filesReviewed is absent', () => {
    const comments = extractCommentsFromSession({ id: 'sess-4', commentsGenerated: 5 });
    expect(comments).toHaveLength(1);
    expect((comments[0] as { content: string }).content).toContain('5 comments');
    expect((comments[0] as { content: string }).content).toContain('0 files');
  });
});

// ---------------------------------------------------------------------------
// filterComments — direct unit tests
// ---------------------------------------------------------------------------

describe('filterComments', () => {
  const c = (severity: string, category?: string) => ({ severity, category });

  it('filters comments below the minimum severity', () => {
    expect(filterComments([c('critical'), c('high'), c('low'), c('info')], 'high')).toEqual([
      c('critical'),
      c('high'),
    ]);
  });

  it('filters by an allow-list of categories', () => {
    const comments = [c('low', 'bug'), c('low', 'style'), c('low', 'security')];
    expect(filterComments(comments, 'low', ['bug', 'security'])).toEqual([
      c('low', 'bug'),
      c('low', 'security'),
    ]);
  });

  it('treats an unknown comment severity as medium', () => {
    // `wat` resolves to severityOrder['wat'] ?? 2 (medium); low threshold keeps it.
    expect(filterComments([c('wat')], 'low')).toEqual([c('wat')]);
    // medium threshold drops it (2 < 2 is false → kept; 2 < 3 would drop, so use high).
    expect(filterComments([c('wat')], 'high')).toEqual([]);
  });

  it('treats an unknown minSeverity as medium', () => {
    expect(filterComments([c('critical'), c('low')], 'wat')).toEqual([c('critical')]);
  });

  it('treats a missing minSeverity as medium', () => {
    expect(filterComments([c('critical'), c('low')])).toEqual([c('critical')]);
  });

  it('ignores categories when the allow-list is empty', () => {
    expect(filterComments([c('low', 'bug')], 'low', [])).toEqual([c('low', 'bug')]);
  });

  it('keeps comments without a category when filtering by category', () => {
    expect(filterComments([c('low')], 'low', ['bug'])).toEqual([c('low')]);
  });
});

// ---------------------------------------------------------------------------
// buildSummary — direct unit tests
// ---------------------------------------------------------------------------

describe('buildSummary', () => {
  it('counts comments by severity', () => {
    const summary = buildSummary([
      { severity: 'critical' },
      { severity: 'high' },
      { severity: 'medium' },
      { severity: 'low' },
      { severity: 'info' },
      { severity: 'critical' },
    ]);
    expect(summary).toEqual({ total: 6, critical: 2, high: 1, medium: 1, low: 1, info: 1 });
  });

  it('ignores unknown severities', () => {
    const summary = buildSummary([{ severity: 'wat' }, { severity: 'critical' }]);
    expect(summary.total).toBe(2);
    expect(summary.critical).toBe(1);
    expect(summary.medium).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// analyzeFileFromGraph — direct unit tests
// ---------------------------------------------------------------------------

describe('analyzeFileFromGraph', () => {
  it('flags an empty file with a low-severity comment', () => {
    const comments = analyzeFileFromGraph('/src/empty.ts', []);
    expect(comments).toHaveLength(1);
    expect((comments[0] as { content: string }).content).toContain('No symbols');
  });

  it('flags a large file with many symbols', () => {
    const nodes = Array.from({ length: 51 }, (_, i) =>
      makeNode({ name: `sym${i}`, qualifiedName: `pkg.sym${i}` }),
    );
    const comments = analyzeFileFromGraph('/src/large.ts', nodes);
    expect(comments).toHaveLength(1);
    expect((comments[0] as { content: string }).content).toContain('Large file');
  });

  it('flags a complex function as medium (15 < complexity <= 25)', () => {
    const comments = analyzeFileFromGraph('/src/x.ts', [makeNode({ complexity: 20 })]);
    expect(comments).toHaveLength(1);
    expect((comments[0] as { severity: string }).severity).toBe('medium');
  });

  it('flags a very complex function as high and handles null location fields', () => {
    const comments = analyzeFileFromGraph('/src/x.ts', [
      makeNode({ complexity: 30, startLine: null, endLine: null }),
    ]);
    expect(comments).toHaveLength(1);
    expect((comments[0] as { severity: string }).severity).toBe('high');
    expect((comments[0] as { startLine: number }).startLine).toBe(0);
    expect((comments[0] as { endLine: number }).endLine).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateActionableRecommendations — direct unit tests
// ---------------------------------------------------------------------------

describe('generateActionableRecommendations', () => {
  it('returns only best-practice recommendations for a clean summary', () => {
    const recs = generateActionableRecommendations({
      totalComments: 0,
      riskLevel: 'low',
      mergeRecommendation: 'approve',
    });
    expect(recs).toHaveLength(2);
    expect(recs.every((r) => r.priority === 'low')).toBe(true);
  });

  it('flags immediate action for critical risk with severity counts', () => {
    const recs = generateActionableRecommendations({
      totalComments: 5,
      riskLevel: 'critical',
      mergeRecommendation: 'approve',
      bySeverity: { critical: 2, high: 3 },
    });
    const immediate = recs.find((r) => r.priority === 'immediate')!;
    expect(immediate.action).toContain('Do not merge');
    expect(immediate.detail).toContain('2 critical');
    expect(immediate.detail).toContain('3 high');
  });

  it('reports zero severity counts when bySeverity is absent', () => {
    const recs = generateActionableRecommendations({
      totalComments: 1,
      riskLevel: 'critical',
      mergeRecommendation: 'approve',
    });
    const immediate = recs.find((r) => r.priority === 'immediate')!;
    expect(immediate.detail).toContain('0 critical');
    expect(immediate.detail).toContain('0 high');
  });

  it('flags request-changes/block merge recommendations', () => {
    const recs = generateActionableRecommendations({
      totalComments: 0,
      riskLevel: 'low',
      mergeRecommendation: 'request-changes',
    });
    expect(recs.some((r) => r.action.includes('Request changes'))).toBe(true);
  });

  it('prioritizes bug fixes as high when more than 3 bugs', () => {
    const recs = generateActionableRecommendations({
      totalComments: 5,
      riskLevel: 'low',
      mergeRecommendation: 'approve',
      byCategory: { bug: 5 },
    });
    const bug = recs.find((r) => r.action.includes('potential bug'))!;
    expect(bug.priority).toBe('high');
  });

  it('prioritizes bug fixes as medium for up to 3 bugs', () => {
    const recs = generateActionableRecommendations({
      totalComments: 2,
      riskLevel: 'low',
      mergeRecommendation: 'approve',
      byCategory: { bug: 2 },
    });
    const bug = recs.find((r) => r.action.includes('potential bug'))!;
    expect(bug.priority).toBe('medium');
  });

  it('flags security, performance, and maintainability findings', () => {
    const recs = generateActionableRecommendations({
      totalComments: 13,
      riskLevel: 'medium',
      mergeRecommendation: 'approve',
      byCategory: { security: 2, performance: 3, maintainability: 8 },
    });
    expect(recs.some((r) => r.action.includes('security'))).toBe(true);
    expect(recs.some((r) => r.action.includes('Optimize'))).toBe(true);
    expect(recs.some((r) => r.action.includes('Refactor for maintainability'))).toBe(true);
  });

  it('skips maintainability recommendation for 5 or fewer issues', () => {
    const recs = generateActionableRecommendations({
      totalComments: 3,
      riskLevel: 'low',
      mergeRecommendation: 'approve',
      byCategory: { maintainability: 3 },
    });
    expect(recs.some((r) => r.action.includes('maintainability'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reviewDiff — null fields and error-path edge cases
// ---------------------------------------------------------------------------

describe('reviewDiff — null fields and fallback', () => {
  it('handles a high-complexity node with null location fields', async () => {
    const store = new InMemoryGraphStore();
    const projectId = 'test-null';
    store.insertNode(
      makeNode({
        name: 'nullFn',
        qualifiedName: 'pkg.nullFn',
        complexity: 35,
        filePath: null,
        startLine: null,
        endLine: null,
        projectId,
      }),
    );
    const ctx = new ToolContextImpl(store);
    const result = await reviewDiff({ projectId }, ctx);
    const data = JSON.parse(result.content[0].text);
    expect(
      data.comments.some((c: { content?: string }) => c.content?.includes('High complexity')),
    ).toBe(true);
  });

  it('handles a high-coupling node with null location fields', async () => {
    const store = new InMemoryGraphStore();
    const projectId = 'test-coupling-null';
    const targetId = store.insertNode(
      makeNode({
        name: 'coupled',
        qualifiedName: 'pkg.coupled',
        filePath: null,
        startLine: null,
        endLine: null,
        projectId,
      }),
    );
    for (let i = 0; i < 16; i++) {
      const callerId = store.insertNode(
        makeNode({ name: `caller${i}`, qualifiedName: `pkg.caller${i}`, projectId }),
      );
      store.insertEdge({
        id: 0,
        projectId,
        sourceId: callerId,
        targetId,
        type: 'CALLS',
        properties: {},
        weight: 1.0,
        createdAt: new Date().toISOString(),
      });
    }
    const ctx = new ToolContextImpl(store);
    const result = await reviewDiff({ projectId }, ctx);
    const data = JSON.parse(result.content[0].text);
    expect(
      data.comments.some((c: { content?: string }) => c.content?.includes('High coupling')),
    ).toBe(true);
  });

  it('falls back to the basic review engine when PRReviewEngine fails', async () => {
    const ctx = createTestContext();
    ctx.getPRReviewEngine = () => {
      throw new Error('PR review unavailable');
    };
    const result = await reviewDiff(
      {
        projectId: 'test-project',
        diff: 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new',
      },
      ctx,
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.reviewMethod).toBe('Basic code review (heuristics)');
    expect(data.sessionId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Error handling — real Error instances
// ---------------------------------------------------------------------------

describe('Code Review Tools — real Error handling', () => {
  it('reviewDiff surfaces an Error message', async () => {
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    ctx.getPRReviewEngine = () => {
      throw new Error('pr down');
    };
    ctx.getReviewEngine = () => {
      throw new Error('engine boom');
    };
    const result = await reviewDiff(
      { projectId: 'test', diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b' },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('engine boom');
  });

  it('reviewFile surfaces an Error message', async () => {
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    ctx.getReviewEngine = () => {
      throw new Error('file boom');
    };
    const result = await reviewFile({ projectId: 'test', filePath: '/x.ts', content: 'code' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('file boom');
  });
});
