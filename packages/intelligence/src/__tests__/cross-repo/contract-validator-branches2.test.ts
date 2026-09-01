// @code-analyzer/intelligence — Contract Validator Branch Coverage (round 2)
// Reaches findReposConsumingSymbol's `traces.map((t) => t.targetRepo)` anonymous
// function (the last uncovered function in contract-validator.ts). The real
// CrossRepoIndexer returns empty traces for a graph without cross-repo edges,
// so this test injects a mocked indexer whose traceSymbolDependencies returns
// non-empty (and duplicated) target repos to exercise the Set-dedup map.

import { describe, it, expect } from 'vitest';
import { ContractValidator } from '../../cross-repo/contract-validator.js';
import type { CrossRepoIndexer } from '../../cross-repo/cross-repo-indexer.js';
import type { GraphNode } from '@code-analyzer/shared';

function sourceNode(): GraphNode {
  return {
    id: 1,
    projectId: 'org/repo-a',
    label: 'Function',
    name: 'existingFn',
    qualifiedName: 'existingFn()',
    filePath: 'src/a.ts',
    startLine: 1,
    endLine: 2,
    language: 'typescript',
    properties: { name: 'existingFn' },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: true,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

/** A mocked indexer whose traceSymbolDependencies returns non-empty traces. */
function makeIndexer(): CrossRepoIndexer {
  return {
    getRepoNodes: () => [sourceNode()],
    analyzeCrossRepoImpact: async () => ({ affectedRepos: [], analysis: [] }),
    traceSymbolDependencies: async () => [
      { targetRepo: 'org/repo-b' },
      { targetRepo: 'org/repo-c' },
      { targetRepo: 'org/repo-b' }, // duplicate — exercises the Set dedup
    ],
  } as unknown as CrossRepoIndexer;
}

describe('ContractValidator — findReposConsumingSymbol trace mapping', () => {
  it('deduplicates target repos from dependency traces for a removed symbol', async () => {
    const validator = new ContractValidator(makeIndexer());

    // 'removedFn' is not among the source repo's contracts, so validateCrossRepo
    // treats it as removed and resolves its consumers via findReposConsumingSymbol.
    const result = await validator.validateCrossRepo('test-group', 'org/repo-a', ['removedFn']);

    const removed = result.changes.find((c) => c.type === 'removed');
    expect(removed).toBeDefined();
    expect(removed!.symbol).toBe('removedFn');
    // The duplicate 'org/repo-b' trace collapses via `new Set`.
    expect(removed!.affectedRepos).toEqual(['org/repo-b', 'org/repo-c']);
    expect(result.breakingCount).toBe(1);
    expect(result.compatible).toBe(false);
  });
});

describe('ContractValidator — visibility_changed branch', () => {
  it('flags a private symbol with external consumers as visibility_changed', async () => {
    const node: GraphNode = {
      ...sourceNode(),
      name: 'privateFn',
      qualifiedName: 'privateFn()',
      properties: { name: 'privateFn', visibility: 'private' },
    };
    const indexer = {
      getRepoNodes: () => [node],
      analyzeCrossRepoImpact: async () => ({ affectedRepos: [], analysis: [] }),
      traceSymbolDependencies: async () => [
        { targetRepo: 'org/repo-b' },
        { targetRepo: 'org/repo-c' },
      ],
    } as unknown as CrossRepoIndexer;

    const validator = new ContractValidator(indexer);
    const result = await validator.validateCrossRepo('test-group', 'org/repo-a', ['privateFn']);

    const vis = result.changes.find((c) => c.type === 'visibility_changed');
    expect(vis).toBeDefined();
    expect(vis!.symbol).toBe('privateFn');
    expect(vis!.severity).toBe('high');
    expect(vis!.affectedRepos).toEqual(['org/repo-b', 'org/repo-c']);
    expect(result.breakingCount).toBe(1);
    expect(result.compatible).toBe(false);
  });
});

describe('ContractValidator — qualifiedName fallback', () => {
  it('falls back to node.name when qualifiedName is null', () => {
    const node = {
      ...sourceNode(),
      name: 'noQualified',
      qualifiedName: null,
    } as unknown as GraphNode;
    const indexer = {
      getRepoNodes: () => [node],
    } as unknown as CrossRepoIndexer;

    const validator = new ContractValidator(indexer);
    const contracts = validator.extractContracts('org/repo-a');

    expect(contracts.symbols).toHaveLength(1);
    expect(contracts.symbols[0]!.signature).toBe('noQualified');
  });
});

describe('ContractValidator — findConsumerRepos catch', () => {
  it('degrades to empty target repos when impact analysis rejects', async () => {
    const indexer = {
      getRepoNodes: () => [sourceNode()],
      analyzeCrossRepoImpact: async () => {
        throw new Error('impact analysis failed');
      },
    } as unknown as CrossRepoIndexer;

    const validator = new ContractValidator(indexer);
    const result = await validator.validateCrossRepo('test-group', 'org/repo-a', []);

    expect(result.targetRepos).toEqual([]);
  });
});
