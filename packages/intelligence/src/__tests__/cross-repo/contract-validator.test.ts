// @code-analyzer/intelligence — Contract Validator Tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { CrossRepoIndexer } from '../../cross-repo/cross-repo-indexer.js';
import { RepoGroupManager } from '../../cross-repo/repo-group-manager.js';
import { ContractValidator } from '../../cross-repo/contract-validator.js';
import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextNodeId = 1;
function nextNodeId(): number {
  return _nextNodeId++;
}

function createGraphNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: nextNodeId(),
    projectId: 'test-project',
    label: 'Function',
    name: `fn-${nextNodeId()}`,
    qualifiedName: `fn-${nextNodeId()}()`,
    filePath: 'src/test.ts',
    startLine: 1,
    endLine: 10,
    language: 'typescript',
    properties: { name: `fn-${nextNodeId()}` },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createIndexerWithNodes(repoId: string, nodes: GraphNode[]) {
  const store = new InMemoryGraphStore();
  for (const node of nodes) {
    store.insertNode({ ...node, projectId: repoId, properties: { ...node.properties, repoId } });
  }
  const groupManager = new RepoGroupManager();
  groupManager.createGroup('test-group', 'Test Group', 'Test description');
  groupManager.addRepo('test-group', 'org', 'repo-a', 'https://github.com/org/repo-a', '/tmp/a');
  groupManager.addRepo('test-group', 'org', 'repo-b', 'https://github.com/org/repo-b', '/tmp/b');
  const indexer = new CrossRepoIndexer(store, groupManager);
  return { indexer, store, groupManager };
}

// ---------------------------------------------------------------------------
// ContractValidator Tests
// ---------------------------------------------------------------------------

describe('ContractValidator', () => {
  let validator: ContractValidator;
  let indexer: CrossRepoIndexer;

  beforeEach(() => {
    const store = new InMemoryGraphStore();
    const groupManager = new RepoGroupManager();
    indexer = new CrossRepoIndexer(store, groupManager);
    validator = new ContractValidator(indexer);
  });

  describe('extractContracts', () => {
    it('should extract contracts from indexed nodes', () => {
      const { indexer: idx } = createIndexerWithNodes('org/repo-a', [
        createGraphNode({ id: 1, name: 'getUser', label: 'Function', qualifiedName: 'getUser(id: string): User', filePath: 'src/api.ts' }),
        createGraphNode({ id: 2, name: 'UserService', label: 'Class', qualifiedName: 'UserService', filePath: 'src/services.ts' }),
        createGraphNode({ id: 3, name: 'IAuthProvider', label: 'Interface', qualifiedName: 'IAuthProvider', filePath: 'src/auth.ts' }),
      ]);

      const v = new ContractValidator(idx);
      const contracts = v.extractContracts('org/repo-a');

      expect(contracts.repo).toBe('org/repo-a');
      expect(contracts.symbols.length).toBe(3);

      const func = contracts.symbols.find((s) => s.name === 'getUser')!;
      expect(func.kind).toBe('function');
      expect(func.visibility).toBe('public');

      const cls = contracts.symbols.find((s) => s.name === 'UserService')!;
      expect(cls.kind).toBe('class');

      const iface = contracts.symbols.find((s) => s.name === 'IAuthProvider')!;
      expect(iface.kind).toBe('interface');
    });

    it('should handle empty repos gracefully', () => {
      const contracts = validator.extractContracts('non-existent-repo');
      expect(contracts.repo).toBe('non-existent-repo');
      expect(contracts.symbols.length).toBe(0);
    });

    it('should infer visibility from node properties', () => {
      const { indexer: idx } = createIndexerWithNodes('org/repo-a', [
        createGraphNode({ id: 1, name: 'publicFn', label: 'Function', properties: { name: 'publicFn' } }),
        createGraphNode({ id: 2, name: 'privateFn', label: 'Function', properties: { name: 'privateFn', visibility: 'private' } }),
        createGraphNode({ id: 3, name: 'protectedFn', label: 'Function', properties: { name: 'protectedFn', visibility: 'protected' } }),
      ]);

      const v = new ContractValidator(idx);
      const contracts = v.extractContracts('org/repo-a');

      const pub = contracts.symbols.find((s) => s.name === 'publicFn')!;
      expect(pub.visibility).toBe('public');

      const priv = contracts.symbols.find((s) => s.name === 'privateFn')!;
      expect(priv.visibility).toBe('private');

      const prot = contracts.symbols.find((s) => s.name === 'protectedFn')!;
      expect(prot.visibility).toBe('protected');
    });

    it('should handle all symbol kinds', () => {
      const { indexer: idx } = createIndexerWithNodes('org/repo-a', [
        createGraphNode({ id: 1, name: 'MyEnum', label: 'Enum' }),
        createGraphNode({ id: 2, name: 'MyType', label: 'TypeAlias' }),
        createGraphNode({ id: 3, name: 'myVar', label: 'Variable' }),
      ]);

      const v = new ContractValidator(idx);
      const contracts = v.extractContracts('org/repo-a');

      expect(contracts.symbols.find((s) => s.name === 'MyEnum')!.kind).toBe('enum');
      expect(contracts.symbols.find((s) => s.name === 'MyType')!.kind).toBe('type');
      expect(contracts.symbols.find((s) => s.name === 'myVar')!.kind).toBe('variable');
      // Module label nodes are skipped by extractContracts
    });

    it('should skip nodes without names', () => {
      const { indexer: idx } = createIndexerWithNodes('org/repo-a', [
        createGraphNode({ id: 1, name: '', label: 'File', qualifiedName: 'file:org/repo-a:src/empty.ts' }),
        createGraphNode({ id: 2, name: 'validFn', label: 'Function', qualifiedName: 'validFn()' }),
      ]);

      const v = new ContractValidator(idx);
      const contracts = v.extractContracts('org/repo-a');

      expect(contracts.symbols.length).toBe(1);
      expect(contracts.symbols[0]!.name).toBe('validFn');
    });
  });

  describe('compareContracts', () => {
    it('should detect removed symbols', () => {
      const before = {
        repo: 'test',
        symbols: [
          { name: 'oldFn', kind: 'function' as const, signature: 'oldFn()', visibility: 'public' as const, filePath: 'a.ts' },
          { name: 'keepFn', kind: 'function' as const, signature: 'keepFn()', visibility: 'public' as const, filePath: 'b.ts' },
        ],
      };
      const after = {
        repo: 'test',
        symbols: [
          { name: 'keepFn', kind: 'function' as const, signature: 'keepFn()', visibility: 'public' as const, filePath: 'b.ts' },
        ],
      };

      const changes = validator.compareContracts(before, after);
      expect(changes.length).toBe(1);
      expect(changes[0]!.type).toBe('removed');
      expect(changes[0]!.symbol).toBe('oldFn');
      expect(changes[0]!.severity).toBe('critical');
    });

    it('should detect added symbols', () => {
      const before = {
        repo: 'test',
        symbols: [
          { name: 'existingFn', kind: 'function' as const, signature: 'existingFn()', visibility: 'public' as const, filePath: 'a.ts' },
        ],
      };
      const after = {
        repo: 'test',
        symbols: [
          { name: 'existingFn', kind: 'function' as const, signature: 'existingFn()', visibility: 'public' as const, filePath: 'a.ts' },
          { name: 'newFn', kind: 'function' as const, signature: 'newFn()', visibility: 'public' as const, filePath: 'b.ts' },
        ],
      };

      const changes = validator.compareContracts(before, after);
      const added = changes.find((c) => c.type === 'added');
      expect(added).toBeDefined();
      expect(added!.symbol).toBe('newFn');
      expect(added!.severity).toBe('low');
    });

    it('should detect signature changes', () => {
      const before = {
        repo: 'test',
        symbols: [
          { name: 'updateFn', kind: 'function' as const, signature: 'updateFn(a: string)', visibility: 'public' as const, filePath: 'a.ts' },
        ],
      };
      const after = {
        repo: 'test',
        symbols: [
          { name: 'updateFn', kind: 'function' as const, signature: 'updateFn(a: string, b: number)', visibility: 'public' as const, filePath: 'a.ts' },
        ],
      };

      const changes = validator.compareContracts(before, after);
      expect(changes.length).toBe(1);
      expect(changes[0]!.type).toBe('signature_changed');
      expect(changes[0]!.severity).toBe('high');
    });

    it('should detect visibility changes', () => {
      const before = {
        repo: 'test',
        symbols: [
          { name: 'helperFn', kind: 'function' as const, signature: 'helperFn()', visibility: 'public' as const, filePath: 'a.ts' },
        ],
      };
      const after = {
        repo: 'test',
        symbols: [
          { name: 'helperFn', kind: 'function' as const, signature: 'helperFn()', visibility: 'private' as const, filePath: 'a.ts' },
        ],
      };

      const changes = validator.compareContracts(before, after);
      expect(changes.length).toBe(1);
      expect(changes[0]!.type).toBe('visibility_changed');
      expect(changes[0]!.severity).toBe('high');
    });

    it('should return empty array for identical contracts', () => {
      const contracts = {
        repo: 'test',
        symbols: [
          { name: 'fn', kind: 'function' as const, signature: 'fn()', visibility: 'public' as const, filePath: 'a.ts' },
        ],
      };

      const changes = validator.compareContracts(contracts, contracts);
      expect(changes.length).toBe(0);
    });

    it('should return empty array for empty contracts', () => {
      const changes = validator.compareContracts(
        { repo: 'test', symbols: [] },
        { repo: 'test', symbols: [] },
      );
      expect(changes.length).toBe(0);
    });
  });

  describe('generateReport', () => {
    it('should generate a markdown report', () => {
      const result = {
        sourceRepo: 'org/repo-a',
        targetRepos: ['org/repo-b'],
        changes: [
          {
            type: 'removed' as const,
            symbol: 'oldFn',
            severity: 'critical' as const,
            description: 'Symbol removed',
            affectedRepos: ['org/repo-b'],
          },
        ],
        breakingCount: 1,
        compatible: false,
        recommendations: ['Fix the issue'],
      };

      const report = validator.generateReport(result);
      expect(report).toContain('# Contract Validation Report');
      expect(report).toContain('org/repo-a');
      expect(report).toContain('org/repo-b');
      expect(report).toContain('REMOVED');
      expect(report).toContain('oldFn');
      expect(report).toContain('Fix the issue');
    });

    it('should handle reports with no changes', () => {
      const result = {
        sourceRepo: 'org/repo-a',
        targetRepos: [],
        changes: [],
        breakingCount: 0,
        compatible: true,
        recommendations: [],
      };

      const report = validator.generateReport(result);
      expect(report).toContain('**Compatible**: Yes ✅');
      expect(report).toContain('**Breaking Changes**: 0');
    });
  });
});
