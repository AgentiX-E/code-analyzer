// @code-analyzer/intelligence — Federated Search Branch Coverage
// Targets specific FederatedSearchEngine code paths: nullable-field fallbacks in
// `search`, the low-similarity arm of `findDuplicates`, null-metadata duplicate
// reporting, and signature-only matches in `getCrossRepoUsage`.

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/shared';
import { FederatedSearchEngine } from '../../cross-repo/federated-search.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createNode(
  projectId: string,
  name: string,
  label: GraphNode['label'],
  filePath: string | null,
  overrides: Partial<GraphNode> = {},
): GraphNode {
  const now = new Date().toISOString();
  return {
    id: 0,
    projectId,
    label,
    name,
    qualifiedName:
      overrides.qualifiedName ?? `project:${projectId}:${filePath ?? 'unknown'}:${name}`,
    filePath,
    startLine: overrides.startLine !== undefined ? overrides.startLine : 1,
    endLine: overrides.endLine !== undefined ? overrides.endLine : 5,
    language: overrides.language !== undefined ? overrides.language : 'typescript',
    properties: {
      name,
      filePath: filePath ?? '',
      startLine: 1,
      endLine: 5,
      language: 'typescript',
      isExported: false,
    },
    signature: overrides.signature !== undefined ? overrides.signature : null,
    docstring: null,
    complexity: 3,
    isExported: false,
    fingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}

function insertDefinesEdge(
  store: InMemoryGraphStore,
  fileId: number,
  symbolId: number,
  projectId: string,
): void {
  store.insertEdge({
    id: 0,
    projectId,
    sourceId: fileId,
    targetId: symbolId,
    type: 'DEFINES',
    properties: {},
    weight: 1,
    createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FederatedSearchEngine — branch coverage', () => {
  let store: InMemoryGraphStore;
  let engine: FederatedSearchEngine;

  beforeEach(() => {
    store = new InMemoryGraphStore();
    engine = new FederatedSearchEngine(store);
  });

  describe('search null-metadata fallbacks', () => {
    it('should default filePath and line to empty when node metadata is null', async () => {
      const node = createNode('repo-a', 'nullMetaFn', 'Function', null, {
        startLine: null,
        endLine: null,
      });
      store.insertNode(node);

      const result = await engine.search('nullMetaFn');
      expect(result.totalResults).toBeGreaterThanOrEqual(1);
      const item = result.results.find((r) => r.symbol === 'nullMetaFn');
      expect(item).toBeDefined();
      expect(item!.filePath).toBe('');
      expect(item!.line).toBe(0);
    });
  });

  describe('findDuplicates low-similarity arm', () => {
    it('should report zero duplicates when cross-repo files share no symbols', async () => {
      const fileA = store.insertNode(
        createNode('repo-a', 'A.ts', 'File', 'A.ts', { qualifiedName: 'file:repo-a:A.ts' }),
      );
      const fileB = store.insertNode(
        createNode('repo-b', 'B.ts', 'File', 'B.ts', { qualifiedName: 'file:repo-b:B.ts' }),
      );

      const symA = store.insertNode(createNode('repo-a', 'getUser', 'Function', 'A.ts'));
      const symB = store.insertNode(createNode('repo-b', 'createOrder', 'Function', 'B.ts'));

      insertDefinesEdge(store, fileA, symA, 'repo-a');
      insertDefinesEdge(store, fileB, symB, 'repo-b');

      // Different symbol sets produce low MinHash similarity, well below the high threshold.
      const report = await engine.findDuplicates('group', 0.95);
      expect(report.totalDuplicates).toBe(0);
    });
  });

  describe('findDuplicates null-metadata reporting', () => {
    it('should report duplicates with empty filePath and zero lines for null metadata', async () => {
      const fileA = store.insertNode(
        createNode('repo-a', 'Ctrl.ts', 'File', null, {
          qualifiedName: 'file:repo-a:Ctrl.ts',
          startLine: null,
          endLine: null,
        }),
      );
      const fileB = store.insertNode(
        createNode('repo-b', 'Ctrl.ts', 'File', null, {
          qualifiedName: 'file:repo-b:Ctrl.ts',
          startLine: null,
          endLine: null,
        }),
      );

      const symA = store.insertNode(createNode('repo-a', 'listUsers', 'Function', 'Ctrl.ts'));
      const symB = store.insertNode(createNode('repo-b', 'listUsers', 'Function', 'Ctrl.ts'));

      insertDefinesEdge(store, fileA, symA, 'repo-a');
      insertDefinesEdge(store, fileB, symB, 'repo-b');

      const report = await engine.findDuplicates('group', 0.5);
      expect(report.totalDuplicates).toBe(1);
      const dup = report.duplicates[0]!;
      expect(dup.files[0]!.filePath).toBe('');
      expect(dup.files[1]!.filePath).toBe('');
      expect(dup.lines).toBe(0);
    });
  });

  describe('getCrossRepoUsage signature-only match', () => {
    it('should match a dependency referenced only in the signature', async () => {
      const node = createNode('repo-a', 'useDep', 'Function', 'app.ts', {
        signature: 'import lodashXyz from "lodash-xyz"',
      });
      store.insertNode(node);

      const result = await engine.getCrossRepoUsage('lodashXyz', 'group');
      expect(result.dependencyName).toBe('lodashXyz');
      expect(result.totalRepos).toBe(1);
    });
  });
});
