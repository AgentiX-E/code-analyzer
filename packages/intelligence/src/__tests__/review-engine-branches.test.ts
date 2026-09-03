// @code-analyzer/intelligence — Review Engine branch coverage via the public API.

import { describe, it, expect } from 'vitest';
import { CodeReviewEngine, mergeAndDeduplicateComments } from '../review/review-engine.js';
import { SessionStore } from '../review/session-store.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GitDiff, GraphNode, GraphEdge, ReviewComment } from '@code-analyzer/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function tempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `rev-branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    path: '/src/a.ts',
    content: 'comment',
    existingCode: 'x = 1;',
    startLine: 1,
    endLine: 1,
    category: 'bug',
    severity: 'medium',
    filtered: false,
    id: 'c1',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 0,
    projectId: 'test-project',
    label: 'Function',
    name: 'fn',
    qualifiedName: 'pkg.fn',
    filePath: null,
    startLine: null,
    endLine: null,
    language: null,
    properties: { name: 'fn' },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: 0,
    projectId: 'test-project',
    sourceId: 0,
    targetId: 0,
    type: 'CALLS',
    properties: {},
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('mergeAndDeduplicateComments', () => {
  it('returns heuristic comments unchanged when the llm list is empty', () => {
    const heuristic = [makeComment()];
    expect(mergeAndDeduplicateComments(heuristic, [])).toHaveLength(1);
  });

  it('returns llm comments when the heuristic list is empty', () => {
    const llm = [makeComment({ id: 'llm1' })];
    expect(mergeAndDeduplicateComments([], llm)).toHaveLength(1);
  });

  it('keeps an llm comment whose category differs from all heuristic comments', () => {
    const heuristic = [makeComment({ category: 'bug' })];
    const llm = [makeComment({ id: 'llm1', category: 'security' })];
    expect(mergeAndDeduplicateComments(heuristic, llm)).toHaveLength(2);
  });

  it('keeps an llm comment with the same category but non-overlapping lines', () => {
    const heuristic = [makeComment({ category: 'bug', startLine: 1, endLine: 3 })];
    const llm = [makeComment({ id: 'llm1', category: 'bug', startLine: 10, endLine: 12 })];
    expect(mergeAndDeduplicateComments(heuristic, llm)).toHaveLength(2);
  });

  it('deduplicates an llm comment that overlaps a heuristic comment in the same category', () => {
    const heuristic = [makeComment({ category: 'bug', startLine: 1, endLine: 10 })];
    const llm = [makeComment({ id: 'llm1', category: 'bug', startLine: 8, endLine: 12 })];
    expect(mergeAndDeduplicateComments(heuristic, llm)).toHaveLength(1);
  });
});

describe('detectCycles — diamond graph shared node', () => {
  it('does not report a false cycle when a node is reachable via two paths', async () => {
    const dir = tempDir();
    const store = new InMemoryGraphStore();
    const sessionStore = new SessionStore(dir);
    try {
      // Diamond: root -> p1 -> {x, y}, and y -> x. Node x is reachable through
      // two distinct paths, but the graph is a DAG with no cycle. This forces
      // the DFS to re-encounter x after it has been fully processed (BLACK),
      // exercising the already-processed guard in detectCycles.
      const rootId = store.insertNode(
        makeNode({ filePath: '/src/root.ts', name: 'root', qualifiedName: 'pkg.root' }),
      );
      const p1Id = store.insertNode(
        makeNode({ filePath: '/src/p1.ts', name: 'p1', qualifiedName: 'pkg.p1' }),
      );
      const xId = store.insertNode(
        makeNode({ filePath: '/src/x.ts', name: 'x', qualifiedName: 'pkg.x' }),
      );
      const yId = store.insertNode(
        makeNode({ filePath: '/src/y.ts', name: 'y', qualifiedName: 'pkg.y' }),
      );

      // Edge insertion order matters: p1 -> x must precede p1 -> y so that y
      // (scheduled after x) traverses x first, leaving x BLACK when the
      // earlier p1 -> x edge is finally popped.
      store.insertEdge(makeEdge({ sourceId: rootId, targetId: p1Id }));
      store.insertEdge(makeEdge({ sourceId: p1Id, targetId: xId }));
      store.insertEdge(makeEdge({ sourceId: p1Id, targetId: yId }));
      store.insertEdge(makeEdge({ sourceId: yId, targetId: xId }));

      const engine = new CodeReviewEngine(store, { allowMetadataFallback: true }, sessionStore);
      const diff: GitDiff = {
        filePath: '/src/root.ts',
        oldHash: 'a',
        newHash: 'b',
        changeType: 'modified',
        ranges: [],
      };

      const session = await engine.reviewDiff('test-project', [diff]);
      expect(session.status).toBe('completed');

      const { reusedComments } = sessionStore.buildResumeState(session.id);
      expect(
        reusedComments.filter((c) => c.content === 'Circular dependency detected'),
      ).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resumeSession start-record parsing', () => {
  it('recovers projectId, createdAt, and mode from the start record', async () => {
    const dir = tempDir();
    try {
      const engine = new CodeReviewEngine(
        new InMemoryGraphStore(),
        { allowMetadataFallback: true },
        new SessionStore(dir),
      );
      const diff: GitDiff = {
        filePath: '/src/a.ts',
        oldHash: 'a',
        newHash: 'b',
        changeType: 'modified',
        ranges: [],
      };
      const session = await engine.reviewDiff('test-project', [diff]);
      const resumed = await engine.resumeSession(session.id);
      expect(resumed.projectId).toBe('test-project');
      expect(resumed.createdAt).not.toBe('');
      expect(resumed.mode).toBe('diff');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
