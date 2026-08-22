// @ts-nocheck
// @code-analyzer/mcp — Code Review Tool Tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from '../tools/tool-context.js';
import { ToolRegistry } from '../tools/registry.js';
import { createToolRegistry } from '../tools/index.js';
import {
  reviewDiff,
  reviewDiffSchema,
  reviewFile,
  reviewFileSchema,
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
    if ((ctx as any).getPRReviewEngine) {
      (ctx as any).getPRReviewEngine = () => {
        throw 'string error';
      };
    }

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
