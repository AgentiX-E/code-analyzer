// @code-analyzer/intelligence — Federated Search Edge Cases
// Supplementary tests for FederatedSearchEngine covering edge cases and
// specific code paths not covered by the main cross-repo test suite.

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
  filePath: string,
  isExported = false,
  overrides: Partial<GraphNode> = {},
): GraphNode {
  const now = new Date().toISOString();
  return {
    id: 0,
    projectId,
    label,
    name,
    qualifiedName: overrides.qualifiedName ?? `project:${projectId}:${filePath}:${name}`,
    filePath,
    startLine: 1,
    endLine: 5,
    language: overrides.language ?? 'typescript',
    properties: overrides.properties ?? {
      name,
      filePath,
      startLine: 1,
      endLine: 5,
      language: 'typescript',
      isExported,
    },
    signature: overrides.signature ?? null,
    docstring: null,
    complexity: 3,
    isExported,
    fingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FederatedSearchEngine — Edge Cases', () => {
  let store: InMemoryGraphStore;
  let engine: FederatedSearchEngine;

  beforeEach(() => {
    store = new InMemoryGraphStore();
    engine = new FederatedSearchEngine(store);
  });

  // -------------------------------------------------------------------
  // findSymbol edge cases
  // -------------------------------------------------------------------

  it('should return empty results when symbol not found anywhere', async () => {
    const results = await engine.findSymbol('nonexistentSymbol_xyz');
    expect(results).toEqual([]);
  });

  it('should skip nodes with non-symbol labels', async () => {
    const fileNode = createNode('repo-a', 'config.json', 'File', 'config.json');
    store.insertNode(fileNode);

    const results = await engine.findSymbol('config');
    // File nodes should be filtered out
    const fileResults = results.filter((r) => r.repo === 'repo-a');
    expect(fileResults.length).toBe(0);
  });

  it('should mark exact name matches correctly', async () => {
    const node = createNode('repo-a', 'exactMatch', 'Function', 'mod.ts', true);
    store.insertNode(node);

    const results = await engine.findSymbol('exactMatch');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const exactResult = results.find((r) => r.symbol === 'exactMatch');
    expect(exactResult).toBeDefined();
    expect(exactResult!.matchType).toBe('exact');
  });

  it('should include Variable nodes in findSymbol results', async () => {
    const node = createNode('repo-a', 'myVar', 'Variable', 'mod.ts', false);
    store.insertNode(node);

    const results = await engine.findSymbol('myVar');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------
  // findDuplicates edge cases
  // -------------------------------------------------------------------

  it('should throw on empty groupId', async () => {
    await expect(engine.findDuplicates('')).rejects.toThrow('Group ID is required');
  });

  it('should return zero duplicates for single-repo group', async () => {
    // Insert two files in the same repo — same-repo is skipped
    const fileA = createNode('repo-a', 'fileA.ts', 'File', 'fileA.ts', false, {
      startLine: 1, endLine: 100, fingerprint: 'abc',
    });
    const fileB = createNode('repo-a', 'fileB.ts', 'File', 'fileB.ts', false, {
      startLine: 1, endLine: 100, fingerprint: 'def',
    });
    store.insertNode(fileA);
    store.insertNode(fileB);

    const report = await engine.findDuplicates('repo-a', 0.5);
    expect(report.totalDuplicates).toBe(0);
  });

  it('should return zero duplicates when store is empty', async () => {
    const report = await engine.findDuplicates('group-empty', 0.8);
    expect(report.totalDuplicates).toBe(0);
    expect(report.duplicates).toEqual([]);
  });

  // -------------------------------------------------------------------
  // getCrossRepoUsage edge cases
  // -------------------------------------------------------------------

  it('should throw on empty dependency name', async () => {
    await expect(engine.getCrossRepoUsage('', 'g1')).rejects.toThrow(
      'Dependency name is required',
    );
  });

  it('should throw on empty group ID', async () => {
    await expect(engine.getCrossRepoUsage('lodash', '')).rejects.toThrow(
      'Group ID is required',
    );
  });

  it('should return empty usage for unknown dependency', async () => {
    const result = await engine.getCrossRepoUsage('unknown-lib', 'g1');
    expect(result.usedBy).toEqual([]);
    expect(result.totalRepos).toBe(0);
    expect(result.totalFiles).toBe(0);
  });

  it('should filter out cross-repo namespace nodes', async () => {
    const crossRepoNode = createNode('cross-repo:bridge', 'someDep', 'Function', 'bridge.ts', false, {
      signature: 'import someDep',
    });
    store.insertNode(crossRepoNode);

    const result = await engine.getCrossRepoUsage('someDep', 'g1');
    // Cross-repo namespace nodes should be excluded
    const crossRepoResults = result.usedBy.filter((u) => u.repo === 'cross-repo:bridge');
    expect(crossRepoResults.length).toBe(0);
  });

  // -------------------------------------------------------------------
  // search edge cases
  // -------------------------------------------------------------------

  it('should apply groupId filter when provided', async () => {
    const nodeA = createNode('group-a', 'targetFunc', 'Function', 'a.ts', true);
    const nodeB = createNode('group-b', 'targetFunc', 'Function', 'b.ts', true);
    store.insertNode(nodeA);
    store.insertNode(nodeB);

    const result = await engine.search('targetFunc', { groupId: 'group-a' });
    expect(result.totalResults).toBeGreaterThanOrEqual(0);
    for (const item of result.results) {
      expect(item.repo).toBe('group-a');
    }
  });

  // -------------------------------------------------------------------
  // toSymbolResult helper
  // -------------------------------------------------------------------

  it('should handle nodes without language in toSymbolResult', async () => {
    const node = createNode('repo-a', 'noLangSymbol', 'Function', 'mod.ts', true);
    node.language = null;
    store.insertNode(node);

    const results = await engine.findSymbol('noLangSymbol');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.language).toBe('unknown');
  });

  it('should handle nodes without filePath in toSymbolResult', async () => {
    const node = createNode('repo-a', 'noFileSymbol', 'Function', '', true);
    node.filePath = null;
    store.insertNode(node);

    const results = await engine.findSymbol('noFileSymbol');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.filePath).toBe('');
  });
});
