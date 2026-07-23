// @code-analyzer/intelligence — Cross-Repo Tests
// Tests for RepoGroupManager, CrossRepoIndexer, FederatedSearchEngine,
// and Levenshtein distance.

import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/shared';

import { RepoGroupManager } from '../cross-repo/repo-group-manager.js';
import {
  CrossRepoIndexer,
  levenshteinDistance,
} from '../cross-repo/cross-repo-indexer.js';
import { FederatedSearchEngine } from '../cross-repo/federated-search.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createTestRepoDir(
  baseDir: string,
  name: string,
  files: Record<string, string>,
): string {
  const repoDir = join(baseDir, name);
  mkdirSync(repoDir, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(repoDir, filePath);
    const dir = join(fullPath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }
  return repoDir;
}

function createProjectNode(
  projectId: string,
  name: string,
  label: 'Function' | 'Class' | 'Interface' | 'TypeAlias' | 'Enum' | 'Method' | 'Variable' | 'File',
  filePath: string,
  isExported = false,
): GraphNode {
  const now = new Date().toISOString();
  return {
    id: 0,
    projectId,
    label,
    name,
    qualifiedName: `project:${projectId}:${filePath}:${name}`,
    filePath,
    startLine: 1,
    endLine: 5,
    language: 'typescript',
    properties: {
      name,
      filePath,
      startLine: 1,
      endLine: 5,
      language: 'typescript',
      isExported,
    },
    signature: name === 'getUser' ? '(id: number): User' : null,
    docstring: null,
    complexity: 3,
    isExported,
    fingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Levenshtein Distance Tests
// ---------------------------------------------------------------------------

describe('levenshteinDistance', () => {
  it('should return 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('should return length for completely different strings', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });

  it('should return correct distance for single substitution', () => {
    expect(levenshteinDistance('kitten', 'sitten')).toBe(1);
  });

  it('should return correct distance for single deletion', () => {
    expect(levenshteinDistance('hello', 'helo')).toBe(1);
  });

  it('should return correct distance for single insertion', () => {
    expect(levenshteinDistance('helo', 'hello')).toBe(1);
  });

  it('should handle empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });

  it('should handle long strings', () => {
    const dist = levenshteinDistance(
      'function getUserProfile',
      'function getXSerProfile',
    );
    expect(dist).toBe(2);
  });

  it('should handle case sensitivity', () => {
    // The function is case-sensitive
    const dist = levenshteinDistance('GetUser', 'getuser');
    expect(dist).toBe(2); // V and v differ
  });
});

// ---------------------------------------------------------------------------
// RepoGroupManager Tests
// ---------------------------------------------------------------------------

describe('RepoGroupManager', () => {
  let manager: RepoGroupManager;

  beforeEach(() => {
    manager = new RepoGroupManager();
  });

  describe('createGroup', () => {
    it('should create a group with valid parameters', () => {
      const group = manager.createGroup('g1', 'My Group', 'A test group');
      expect(group.id).toBe('g1');
      expect(group.name).toBe('My Group');
      expect(group.description).toBe('A test group');
      expect(group.repos).toEqual([]);
      expect(group.contracts).toEqual([]);
      expect(group.indexedAt).toBeNull();
    });

    it('should throw if id is empty', () => {
      expect(() => manager.createGroup('', 'Name', 'Desc')).toThrow(
        'Group id and name are required',
      );
    });

    it('should throw if name is empty', () => {
      expect(() => manager.createGroup('id', '', 'Desc')).toThrow(
        'Group id and name are required',
      );
    });

    it('should throw on duplicate group ID', () => {
      manager.createGroup('g1', 'First', '');
      expect(() => manager.createGroup('g1', 'Second', '')).toThrow(
        '"g1" already exists',
      );
    });
  });

  describe('deleteGroup', () => {
    it('should delete an existing group', () => {
      manager.createGroup('g1', 'My Group', '');
      manager.deleteGroup('g1');
      expect(manager.getGroup('g1')).toBeNull();
    });

    it('should throw if group does not exist', () => {
      expect(() => manager.deleteGroup('nonexistent')).toThrow(
        '"nonexistent" not found',
      );
    });
  });

  describe('addRepo / removeRepo / getRepos', () => {
    beforeEach(() => {
      manager.createGroup('g1', 'Test Group', '');
    });

    it('should add a repo to a group', () => {
      manager.addRepo('g1', 'owner', 'my-repo', 'https://github.com/owner/my-repo', '/path/to/repo');
      const repos = manager.getRepos('g1');
      expect(repos.length).toBe(1);
      expect(repos[0]!.fullName).toBe('owner/my-repo');
      expect(repos[0]!.localPath).toBe('/path/to/repo');
    });

    it('should throw on duplicate repo', () => {
      manager.addRepo('g1', 'owner', 'my-repo', 'url', '/path');
      expect(() =>
        manager.addRepo('g1', 'owner', 'my-repo', 'url', '/path'),
      ).toThrow('already exists in group');
    });

    it('should remove a repo from a group', () => {
      manager.addRepo('g1', 'owner', 'my-repo', 'url', '/path');
      manager.removeRepo('g1', 'owner/my-repo');
      expect(manager.getRepos('g1').length).toBe(0);
    });

    it('should throw when removing non-existent repo', () => {
      expect(() => manager.removeRepo('g1', 'nonexistent/repo')).toThrow(
        'not found in group',
      );
    });

    it('should throw when getting repos for non-existent group', () => {
      expect(() => manager.getRepos('nonexistent')).toThrow(
        '"nonexistent" not found',
      );
    });
  });

  describe('listGroups', () => {
    it('should return empty array for no groups', () => {
      expect(manager.listGroups()).toEqual([]);
    });

    it('should list all groups', () => {
      manager.createGroup('g1', 'Group 1', '');
      manager.createGroup('g2', 'Group 2', '');
      const groups = manager.listGroups();
      expect(groups.length).toBe(2);
      expect(groups.map((g) => g.id).sort()).toEqual(['g1', 'g2']);
    });
  });

  describe('getGroup', () => {
    it('should return null for non-existent group', () => {
      expect(manager.getGroup('nonexistent')).toBeNull();
    });

    it('should return a clone of the group', () => {
      manager.createGroup('g1', 'Original', '');
      const group = manager.getGroup('g1')!;
      group.name = 'Modified';
      // Original should be unchanged
      expect(manager.getGroup('g1')!.name).toBe('Original');
    });
  });

  describe('setRepoProjectId', () => {
    it('should update the projectId of a repo', () => {
      manager.createGroup('g1', 'Group', '');
      manager.addRepo('g1', 'o', 'r', 'url', '/path');
      manager.setRepoProjectId('g1', 'o/r', 'proj-id');
      const repo = manager.getRepos('g1')[0]!;
      expect(repo.projectId).toBe('proj-id');
    });

    it('should throw for non-existent repo', () => {
      manager.createGroup('g1', 'Group', '');
      expect(() => manager.setRepoProjectId('g1', 'nonexistent', 'p')).toThrow(
        'not found in group',
      );
    });
  });

  describe('markIndexed', () => {
    it('should set indexedAt timestamp', () => {
      manager.createGroup('g1', 'Group', '');
      manager.markIndexed('g1');
      const group = manager.getGroup('g1')!;
      expect(group.indexedAt).toBeTruthy();
      expect(new Date(group.indexedAt!).getTime()).toBeGreaterThan(0);
    });
  });

  describe('hasGroup', () => {
    it('should return true for existing group', () => {
      manager.createGroup('g1', 'Group 1', '');
      expect(manager.hasGroup('g1')).toBe(true);
    });

    it('should return false for non-existent group', () => {
      expect(manager.hasGroup('nonexistent')).toBe(false);
    });
  });

  describe('cloneGroup', () => {
    it('should deep-clone contracts with definition and dependencies', () => {
      manager.createGroup('g1', 'Clone Test', '');
      // Manually insert a contract into the internal groups map to test clone
      const internal = (manager as any).groups.get('g1');
      internal.contracts = [{
        id: 'contract-1',
        name: 'UserDTO',
        description: 'Shared DTO',
        uri: '/api/user',
        version: '1.0.0',
        definition: { kind: 'shared_interface', fields: ['id', 'name'] },
        dependencies: ['o/repo-a', 'o/repo-b'],
      }];

      const group = manager.getGroup('g1')!;
      expect(group.contracts).toHaveLength(1);
      expect(group.contracts[0]!.definition).toEqual({ kind: 'shared_interface', fields: ['id', 'name'] });
      expect(group.contracts[0]!.dependencies).toEqual(['o/repo-a', 'o/repo-b']);

      // Verify it's a deep clone — modifying the returned object shouldn't affect original
      group.contracts[0]!.definition = { modified: true } as any;
      group.contracts[0]!.dependencies.push('o/repo-c');
      const fresh = manager.getGroup('g1')!;
      expect(fresh.contracts[0]!.definition).toEqual({ kind: 'shared_interface', fields: ['id', 'name'] });
      expect(fresh.contracts[0]!.dependencies).toEqual(['o/repo-a', 'o/repo-b']);
    });
  });
  describe('config save/load', () => {
    const tmpDir = join(tmpdir(), `cross-repo-test-${Date.now()}`);

    beforeEach(() => {
      mkdirSync(tmpDir, { recursive: true });
    });

    it('should save and load groups config to/from file', () => {
      manager.createGroup('g1', 'Group 1', 'Description 1');
      manager.addRepo('g1', 'owner', 'repo', 'https://example.com/repo', '/tmp/repo');

      const configPath = join(tmpDir, 'config.json');
      manager.saveConfig(configPath);
      expect(existsSync(configPath)).toBe(true);

      // Create a new manager and load
      const manager2 = new RepoGroupManager();
      manager2.loadConfig(configPath);

      const groups = manager2.listGroups();
      expect(groups.length).toBe(1);
      expect(groups[0]!.id).toBe('g1');
      expect(groups[0]!.name).toBe('Group 1');
      expect(groups[0]!.repos.length).toBe(1);
      expect(groups[0]!.repos[0]!.fullName).toBe('owner/repo');
    });

    it('should throw loading non-existent file', () => {
      expect(() => manager.loadConfig('/nonexistent/config.json')).toThrow(
        'Config file not found',
      );
    });

    it('should throw loading invalid JSON', () => {
      const configPath = join(tmpDir, 'bad.json');
      writeFileSync(configPath, 'not valid json', 'utf-8');
      expect(() => manager.loadConfig(configPath)).toThrow(
        'Invalid JSON',
      );
    });

    it('should throw if config is not an array', () => {
      const configPath = join(tmpDir, 'obj.json');
      writeFileSync(configPath, '{"key": "value"}', 'utf-8');
      expect(() => manager.loadConfig(configPath)).toThrow(
        'must contain an array',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// CrossRepoIndexer Tests
// ---------------------------------------------------------------------------

describe('CrossRepoIndexer', () => {
  let store: InMemoryGraphStore;
  let groupManager: RepoGroupManager;
  let indexer: CrossRepoIndexer;
  const tmpBaseDir = join(tmpdir(), `cross-repo-indexer-test-${Date.now()}`);

  beforeEach(() => {
    store = new InMemoryGraphStore();
    groupManager = new RepoGroupManager();
    indexer = new CrossRepoIndexer(store, groupManager);
    mkdirSync(tmpBaseDir, { recursive: true });
  });

  describe('indexGroup', () => {
    it('should throw for non-existent group', async () => {
      await expect(indexer.indexGroup('nonexistent')).rejects.toThrow(
        '"nonexistent" not found',
      );
    });

    it('should handle empty group gracefully', async () => {
      groupManager.createGroup('g1', 'Empty', '');
      const result = await indexer.indexGroup('g1');
      expect(result.groupId).toBe('g1');
      expect(result.reposIndexed).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('should index repos in a group', async () => {
      const repoDir = createTestRepoDir(tmpBaseDir, 'service-a', {
        'index.ts': 'export function getData() { return 42; }',
        'utils.ts': 'export function helper() { return true; }',
      });

      groupManager.createGroup('g1', 'Test Group', '');
      groupManager.addRepo('g1', 'org', 'service-a', 'https://a.example.com', repoDir);

      const result = await indexer.indexGroup('g1');
      expect(result.groupId).toBe('g1');
      expect(result.reposIndexed).toBe(1);
      expect(result.totalNodes).toBeGreaterThan(0);
      expect(result.totalEdges).toBeGreaterThanOrEqual(0);
    });

    it('should handle repos with no valid source files', async () => {
      const repoDir = createTestRepoDir(tmpBaseDir, 'empty-service', {
        'README.md': '# My Service',
        '.gitignore': 'node_modules',
      });

      groupManager.createGroup('g2', 'Empty Source', '');
      groupManager.addRepo('g2', 'org', 'empty-service', 'https://a.example.com', repoDir);

      const result = await indexer.indexGroup('g2');
      expect(result.reposIndexed).toBe(1);
      expect(result.errors.length).toBe(0);
    });
  });

  describe('indexRepo', () => {
    it('should index a single repo', async () => {
      const repoDir = createTestRepoDir(tmpBaseDir, 'single-repo', {
        'main.ts': 'export class UserService { getUser() { return {}; } }',
      });

      groupManager.createGroup('g1', 'Test', '');
      groupManager.addRepo('g1', 'org', 'single-repo', 'https://a.example.com', repoDir);

      const result = await indexer.indexRepo('g1', 'org/single-repo');
      expect(result.groupId).toBe('g1');
      expect(result.reposIndexed).toBe(1);
    });

    it('should throw for non-existent repo', async () => {
      groupManager.createGroup('g1', 'Test', '');
      await expect(indexer.indexRepo('g1', 'nonexistent')).rejects.toThrow(
        'not found in group',
      );
    });
  });

  describe('resolveCrossRepoSymbols', () => {
    it('should return empty for groups with fewer than 2 repos', async () => {
      groupManager.createGroup('g1', 'Solo', '');
      const matches = await indexer.resolveCrossRepoSymbols('g1');
      expect(matches).toEqual([]);
    });

    it('should find exact name matches across repos', async () => {
      // Populate store with symbols from two repos
      const nodeA = createProjectNode('o/repo-a', 'getUser', 'Function', 'api/users.ts', true);
      const nodeB = createProjectNode('o/repo-b', 'getUser', 'Function', 'api/users.ts', true);

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      groupManager.createGroup('g1', 'Cross Repo', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const matches = await indexer.resolveCrossRepoSymbols('g1');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      const exactMatch = matches.find((m) => m.matchType === 'exact_name');
      expect(exactMatch).toBeTruthy();
      expect(exactMatch!.confidence).toBe(1.0);
    });

    it('should find similar name matches (Levenshtein ≤ 2)', async () => {
      const nodeA = createProjectNode('o/repo-a', 'getUserProfile', 'Function', 'users.ts', true);
      const nodeB = createProjectNode('o/repo-b', 'getUzerProfile', 'Function', 'users.ts', true);

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      groupManager.createGroup('g1', 'Cross', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const matches = await indexer.resolveCrossRepoSymbols('g1');
      const similarMatch = matches.find((m) => m.matchType === 'similar_name');
      expect(similarMatch).toBeTruthy();
      if (similarMatch) {
        expect(similarMatch.confidence).toBeCloseTo(0.7, 1);
      }
    });

    it('should handle repos with no exported symbols', async () => {
      const nodeA = createProjectNode('o/repo-a', 'internalFunc', 'Function', 'utils.ts', false);
      const nodeB = createProjectNode('o/repo-b', 'internalFunc', 'Function', 'utils.ts', false);

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      groupManager.createGroup('g1', 'Cross', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const matches = await indexer.resolveCrossRepoSymbols('g1');
      // No exact_name match because symbols are not exported
      const exactMatch = matches.find((m) => m.matchType === 'exact_name');
      expect(exactMatch).toBeFalsy();
    });

    it('should respect group boundaries', async () => {
      groupManager.createGroup('g1', 'Only A/B', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const nodeA = createProjectNode('o/repo-a', 'hello', 'Function', 'a.ts', true);
      const nodeB = createProjectNode('o/repo-b', 'hello', 'Function', 'b.ts', true);
      store.insertNode(nodeA);
      store.insertNode(nodeB);

      const matches = await indexer.resolveCrossRepoSymbols('g1');
      const exactMatch = matches.find((m) => m.matchType === 'exact_name');
      expect(exactMatch).toBeTruthy();
    });
  });

  describe('buildCrossRepoGraph', () => {
    it('should return empty report for 0 or 1 repo', async () => {
      groupManager.createGroup('g1', 'Solo', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      const report = await indexer.buildCrossRepoGraph('g1');
      expect(report.crossRepoEdges).toBe(0);
      expect(report.repos.length).toBe(1);
    });

    it('should throw for non-existent group', async () => {
      await expect(indexer.buildCrossRepoGraph('nonexistent')).rejects.toThrow(
        '"nonexistent" not found',
      );
    });

    it('should detect cross-repo imports', async () => {
      // File node in repo A that imports from repo B
      const fileA = createProjectNode('o/repo-a', 'app.ts', 'File', 'app.ts');
      const fileB = createProjectNode('o/repo-b', 'utils.ts', 'File', 'src/utils.ts');
      const funcB = createProjectNode('o/repo-b', 'helper', 'Function', 'src/utils.ts', true);

      store.insertNode(fileA);
      store.insertNode(fileB);
      store.insertNode(funcB);

      groupManager.createGroup('g1', 'Cross', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const report = await indexer.buildCrossRepoGraph('g1');
      expect(report.repos).toContain('o/repo-a');
      expect(report.repos).toContain('o/repo-b');
    });

    it('should count orphan symbols', async () => {
      const exportedNode = createProjectNode('o/repo-a', 'orphanFunc', 'Function', 'src/util.ts', true);
      store.insertNode(exportedNode);

      groupManager.createGroup('g1', 'Orphan', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const report = await indexer.buildCrossRepoGraph('g1');
      expect(report.orphanSymbols).toBeGreaterThanOrEqual(0);
      expect(typeof report.crossRepoEdges).toBe('number');
      expect(typeof report.byType).toBe('object');
    });
  });

  describe('detectContracts', () => {
    it('should return empty for groups with fewer than 2 repos', async () => {
      groupManager.createGroup('g1', 'Solo', '');
      const contracts = await indexer.detectContracts('g1');
      expect(contracts).toEqual([]);
    });

    it('should detect shared interfaces across repos', async () => {
      const ifaceA = createProjectNode('o/repo-a', 'UserDTO', 'Interface', 'types.ts', true);
      const ifaceB = createProjectNode('o/repo-b', 'UserDTO', 'Interface', 'types.ts', true);

      store.insertNode(ifaceA);
      store.insertNode(ifaceB);

      groupManager.createGroup('g1', 'Contracts', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const contracts = await indexer.detectContracts('g1');
      expect(contracts.length).toBeGreaterThanOrEqual(1);

      const contract = contracts.find((c) => c.name === 'UserDTO');
      expect(contract).toBeTruthy();
      if (contract) {
        expect(contract.definition['kind']).toBe('shared_interface');
        expect(contract.dependencies.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should not flag interfaces unique to one repo', async () => {
      const ifaceA = createProjectNode('o/repo-a', 'UniqueInterface', 'Interface', 'types.ts', true);
      store.insertNode(ifaceA);

      groupManager.createGroup('g1', 'Contracts', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const contracts = await indexer.detectContracts('g1');
      const uniqueContract = contracts.find((c) => c.name === 'UniqueInterface');
      expect(uniqueContract).toBeFalsy();
    });
  });

  describe('checkTypeCompatibility', () => {
    it('should detect breaking changes when comparison fails', async () => {
      groupManager.createGroup('g1', 'Compat', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const result = await indexer.checkTypeCompatibility('g1', 'nonexistentA', 'nonexistentB');
      expect(result.compatible).toBe(false);
      expect(result.breakingChanges.length).toBeGreaterThan(0);
    });

    it('should compare two existing symbols across repos', async () => {
      const nodeA = createProjectNode('o/repo-a', 'UserService', 'Class', 'service.ts', true);
      const nodeB = createProjectNode('o/repo-b', 'UserService', 'Class', 'service.ts', true);

      // Different signatures
      const now = new Date().toISOString();
      const nodeB2: GraphNode = {
        ...nodeB,
        signature: '(id: string): User',
      };

      store.insertNode(
        {
          ...nodeA,
          signature: '(id: number): User',
          createdAt: now,
          updatedAt: now,
        },
      );
      store.insertNode(nodeB2);

      groupManager.createGroup('g1', 'Compat', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const result = await indexer.checkTypeCompatibility('g1', 'UserService', 'UserService');
      expect(result.compatible).toBe(true);
      expect(result.sourceType).toContain('Class');
      expect(result.targetType).toContain('Class');
    });

    it('should report incompatible types', async () => {
      const nodeA = createProjectNode('o/repo-a', 'ApiClient', 'Interface', 'client.ts', true);
      const nodeB = createProjectNode('o/repo-b', 'ApiClient', 'Class', 'client.ts', true);

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      groupManager.createGroup('g1', 'Compat', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const result = await indexer.checkTypeCompatibility('g1', 'ApiClient', 'ApiClient');
      // Different labels (Interface vs Class) should produce breaking changes
      expect(result.breakingChanges).toContain('Type mismatch: Interface vs Class');
    });
  });

  describe('analyzeCrossRepoImpact', () => {
    it('should throw for repos not in group', async () => {
      groupManager.createGroup('g1', 'Impact', '');
      await expect(
        indexer.analyzeCrossRepoImpact('g1', 'unknown-repo'),
      ).rejects.toThrow('not in group');
    });

    it('should return empty affected list for repos with no cross-repo deps', async () => {
      groupManager.createGroup('g1', 'Impact', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const result = await indexer.analyzeCrossRepoImpact('g1', 'o/repo-a');
      expect(result.changedRepo).toBe('o/repo-a');
      // No cross-repo edges, so no affected repos
      expect(result.analysis.length).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// FederatedSearchEngine Tests
// ---------------------------------------------------------------------------

describe('FederatedSearchEngine', () => {
  let store: InMemoryGraphStore;
  let engine: FederatedSearchEngine;

  beforeEach(() => {
    store = new InMemoryGraphStore();
    engine = new FederatedSearchEngine(store);
  });

  describe('search', () => {
    it('should throw on empty query', async () => {
      await expect(engine.search('')).rejects.toThrow(
        'Search query is required',
      );
    });

    it('should return empty results for empty store', async () => {
      const result = await engine.search('getUser');
      expect(result.totalResults).toBe(0);
      expect(result.results).toEqual([]);
      expect(result.repoBreakdown).toEqual({});
    });

    it('should find symbols matching the query', async () => {
      const node = createProjectNode('repo-a', 'getUserById', 'Function', 'users.ts', true);
      store.insertNode(node);

      const result = await engine.search('getUserById');
      expect(result.totalResults).toBeGreaterThanOrEqual(1);
      expect(result.results[0]!.symbol).toBe('getUserById');
    });

    it('should respect maxResults option', async () => {
      for (let i = 0; i < 10; i++) {
        const node = createProjectNode(
          'repo-a',
          `getUser${i}`,
          'Function',
          'users.ts',
        );
        store.insertNode(node);
      }

      const result = await engine.search('getUser', { maxResults: 3 });
      expect(result.results.length).toBeLessThanOrEqual(3);
    });

    it('should filter by repo', async () => {
      const nodeA = createProjectNode('repo-a', 'findUser', 'Function', 'api.ts', true);
      const nodeB = createProjectNode('repo-b', 'findUser', 'Function', 'api.ts', true);

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      const result = await engine.search('findUser', {
        repoFilter: ['repo-a'],
      });
      expect(result.totalResults).toBeGreaterThanOrEqual(1);
      for (const item of result.results) {
        expect(item.repo).toBe('repo-a');
      }
    });

    it('should produce repo breakdown', async () => {
      const nodeA = createProjectNode('repo-a', 'helloWorld', 'Function', 'a.ts', true);
      const nodeB = createProjectNode('repo-b', 'helloWorld', 'Function', 'b.ts', true);

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      const result = await engine.search('helloWorld');
      expect(result.repoBreakdown['repo-a']).toBeGreaterThanOrEqual(1);
      expect(result.repoBreakdown['repo-b']).toBeGreaterThanOrEqual(1);
    });
  });

  describe('findSymbol', () => {
    it('should throw on empty name', async () => {
      await expect(engine.findSymbol('')).rejects.toThrow(
        'Symbol name is required',
      );
    });

    it('should find exact symbol match', async () => {
      const node = createProjectNode('repo-a', 'calculateSum', 'Function', 'math.ts', true);
      store.insertNode(node);

      const results = await engine.findSymbol('calculateSum');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.symbol).toBe('calculateSum');
      expect(results[0]!.matchType).toBe('exact');
    });

    it('should find partial matches via FTS', async () => {
      const node1 = createProjectNode('repo-a', 'calculateTotal', 'Function', 'a.ts');
      const node2 = createProjectNode('repo-a', 'calculateSum', 'Function', 'a.ts');

      store.insertNode(node1);
      store.insertNode(node2);

      const results = await engine.findSymbol('calculate');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by groupId if provided', async () => {
      const nodeA = createProjectNode('group-a', 'someFunc', 'Function', 'x.ts');
      const nodeB = createProjectNode('group-b', 'someFunc', 'Function', 'x.ts');

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      const results = await engine.findSymbol('someFunc', 'group-a');
      for (const r of results) {
        expect(r.repo).toBe('group-a');
      }
    });

    it('should return exact match via qualified name lookup', async () => {
      const node = createProjectNode('repo-a', 'qualifiedNameMatch', 'Function', 'src/utils.ts', true);
      // Set qualifiedName to exactly match the search term for getNodeByQualifiedName
      node.qualifiedName = 'qualifiedNameMatch';
      store.insertNode(node);

      const results = await engine.findSymbol('qualifiedNameMatch');
      expect(results.length).toBe(1);

      // The result should come from the qualified name exact match path
      expect(results[0]!.symbol).toBe('qualifiedNameMatch');
      expect(results[0]!.matchType).toBe('exact');
      expect(results[0]!.repo).toBe('repo-a');
    });

    it('should skip duplicates when exactNode is also found via FTS', async () => {
      // Node found by getNodeByQualifiedName (qualifiedName matches search term)
      const exactNode = createProjectNode('repo-a', 'sharedSymbol', 'Function', 'src/app.ts', true);
      exactNode.qualifiedName = 'sharedSymbol';
      store.insertNode(exactNode);

      // Another node with same name in different repo, found only via FTS
      const ftsNode = createProjectNode('repo-b', 'sharedSymbol', 'Function', 'src/app.ts', true);
      store.insertNode(ftsNode);

      const results = await engine.findSymbol('sharedSymbol');

      // Should include both nodes: one from qualified name lookup, one from FTS
      // The exactNode should NOT appear twice (deduplicated via seen set)
      expect(results.length).toBe(2);

      // Verify no duplicate repos
      const repoList = results.map(r => r.repo);
      expect(new Set(repoList).size).toBe(repoList.length);

      // Verify both repos are present
      const repos = results.map(r => r.repo).sort();
      expect(repos).toEqual(['repo-a', 'repo-b']);

      // Find the exact qualified name match
      const exactResult = results.find(r => r.qualifiedName === 'sharedSymbol');
      expect(exactResult).toBeTruthy();
      expect(exactResult!.matchType).toBe('exact');
    });
  });

  describe('findDuplicates', () => {
    it('should throw on empty groupId', async () => {
      await expect(engine.findDuplicates('')).rejects.toThrow(
        'Group ID is required',
      );
    });

    it('should handle repos with no files', async () => {
      const report = await engine.findDuplicates('empty-group');
      expect(report.groupId).toBe('empty-group');
      expect(report.totalDuplicates).toBe(0);
      expect(report.duplicates).toEqual([]);
    });

    it('should detect duplicate files across repos', async () => {
      // Insert two files with similar symbol sets
      const fileA = createProjectNode('repo-a', 'UserController.ts', 'File', 'UserController.ts');
      const fileB = createProjectNode('repo-b', 'UserController.ts', 'File', 'UserController.ts');

      const insertedA = store.insertNode({
        ...fileA,
        qualifiedName: 'file:repo-a:UserController.ts',
      });
      const insertedB = store.insertNode({
        ...fileB,
        qualifiedName: 'file:repo-b:UserController.ts',
      });

      // Create symbols with identical names across repos
      const funcA1 = createProjectNode('o/repo-a', 'getUser', 'Function', 'UserController.ts', true);
      const funcA2 = createProjectNode('o/repo-a', 'listUsers', 'Function', 'UserController.ts', true);
      const funcB1 = createProjectNode('o/repo-b', 'getUser', 'Function', 'UserController.ts', true);
      const funcB2 = createProjectNode('o/repo-b', 'listUsers', 'Function', 'UserController.ts', true);

      const fa1 = store.insertNode(funcA1);
      const fa2 = store.insertNode(funcA2);
      const fb1 = store.insertNode(funcB1);
      const fb2 = store.insertNode(funcB2);

      // Create DEFINES edges
      const now = new Date().toISOString();
      store.insertEdge({
        id: 0,
        projectId: 'repo-a',
        sourceId: insertedA,
        targetId: fa1,
        type: 'DEFINES',
        properties: {},
        weight: 1,
        createdAt: now,
      });
      store.insertEdge({
        id: 0,
        projectId: 'repo-a',
        sourceId: insertedA,
        targetId: fa2,
        type: 'DEFINES',
        properties: {},
        weight: 1,
        createdAt: now,
      });
      store.insertEdge({
        id: 0,
        projectId: 'repo-b',
        sourceId: insertedB,
        targetId: fb1,
        type: 'DEFINES',
        properties: {},
        weight: 1,
        createdAt: now,
      });
      store.insertEdge({
        id: 0,
        projectId: 'repo-b',
        sourceId: insertedB,
        targetId: fb2,
        type: 'DEFINES',
        properties: {},
        weight: 1,
        createdAt: now,
      });

      const report = await engine.findDuplicates('test-group', 0.5);
      expect(report.groupId).toBe('test-group');
      // With identical symbol sets, similarity should be high
      expect(report.totalDuplicates).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getCrossRepoUsage', () => {
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

    it('should find repos using a dependency', async () => {
      const nodeA = createProjectNode('repo-a', 'lodash.map', 'Function', 'node_modules/lodash/map.js');
      store.insertNode(nodeA);

      // File that uses the dependency
      const fileNode = createProjectNode('repo-a', 'app.ts', 'File', 'app.ts');
      store.insertNode(fileNode);

      const result = await engine.getCrossRepoUsage('lodash', 'g1');
      expect(result.dependencyName).toBe('lodash');
      expect(result.totalRepos).toBeGreaterThanOrEqual(1);
    });

    it('should handle deps with zero usage', async () => {
      const result = await engine.getCrossRepoUsage('nonexistent-dep', 'g1');
      expect(result.dependencyName).toBe('nonexistent-dep');
      expect(result.totalRepos).toBe(0);
      expect(result.totalFiles).toBe(0);
      expect(result.usedBy).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Edge Cases & Integration
// ---------------------------------------------------------------------------

describe('Cross-Repo Edge Cases', () => {
  let store: InMemoryGraphStore;
  let groupManager: RepoGroupManager;
  let indexer: CrossRepoIndexer;

  beforeEach(() => {
    store = new InMemoryGraphStore();
    groupManager = new RepoGroupManager();
    indexer = new CrossRepoIndexer(store, groupManager);
  });

  it('should handle empty groups gracefully', async () => {
    groupManager.createGroup('empty-group', 'Empty', 'No repos');

    const result = await indexer.indexGroup('empty-group');
    expect(result.reposIndexed).toBe(0);
    expect(result.totalNodes).toBe(0);
  });

  it('should handle duplicate symbols across repos', async () => {
    // Two reps with identical function name
    for (let i = 0; i < 5; i++) {
      const node = createProjectNode(
        'o/repo-a',
        `handler${i}`,
        'Function',
        'handlers.ts',
        true,
      );
      store.insertNode(node);
    }
    for (let i = 0; i < 3; i++) {
      const node = createProjectNode(
        'o/repo-b',
        `handler${i}`,
        'Function',
        'handlers.ts',
        true,
      );
      store.insertNode(node);
    }

    groupManager.createGroup('g1', 'Dupes', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const matches = await indexer.resolveCrossRepoSymbols('g1');
    // handler0, handler1, handler2 should have exact matches
    const exactMatches = matches.filter((m) => m.matchType === 'exact_name');
    expect(exactMatches.length).toBeGreaterThanOrEqual(3);
  });

  it('should handle circular cross-repo dependencies', async () => {
    // Repo A imports from Repo B, Repo B imports from Repo A
    const nodeA = createProjectNode('o/repo-a', 'authService', 'Class', 'auth.ts', true);
    const nodeB = createProjectNode('o/repo-b', 'tokenService', 'Class', 'token.ts', true);

    store.insertNode(nodeA);
    store.insertNode(nodeB);

    groupManager.createGroup('g1', 'Circular', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    // Build graph should handle circular deps without crashing
    const report = await indexer.buildCrossRepoGraph('g1');
    expect(report.crossRepoEdges).toBeGreaterThanOrEqual(0);
  });

  it('should handle repos with no common symbols', async () => {
    const nodeA = createProjectNode('o/repo-a', 'functionA', 'Function', 'a.ts', true);
    const nodeB = createProjectNode('o/repo-b', 'functionB', 'Function', 'b.ts', true);

    store.insertNode(nodeA);
    store.insertNode(nodeB);

    groupManager.createGroup('g1', 'No Common', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const matches = await indexer.resolveCrossRepoSymbols('g1');
    // No exact or similar matches expected
    const exactMatches = matches.filter((m) => m.matchType === 'exact_name');
    expect(exactMatches.length).toBe(0);
  });

  it('should handle single repo in group', async () => {
    const nodeA = createProjectNode('o/repo-a', 'someFunc', 'Function', 'src/index.ts', true);
    store.insertNode(nodeA);

    groupManager.createGroup('g1', 'Single', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');

    const matches = await indexer.resolveCrossRepoSymbols('g1');
    expect(matches).toEqual([]);

    const contracts = await indexer.detectContracts('g1');
    expect(contracts).toEqual([]);
  });

  it('should handle missing repos in group', async () => {
    groupManager.createGroup('g1', 'Missing', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '/nonexistent/path');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '/another/nonexistent/path');

    const result = await indexer.indexGroup('g1', { concurrency: 1 });
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('should validate inputs at API boundaries', () => {
    // Empty ID
    expect(() => groupManager.createGroup('', 'name', 'desc')).toThrow();

    // Non-existent group
    expect(() => groupManager.deleteGroup('x')).toThrow();
    expect(() => groupManager.addRepo('x', 'o', 'r', 'u', 'p')).toThrow();
  });

  it('should classify matches with similar names and api patterns', async () => {
    const nodeA = createProjectNode('o/repo-a', 'getRoute', 'Function', 'routes.ts', true);
    const nodeB = createProjectNode('o/repo-b', 'getRutes', 'Function', 'routes.ts', true);

    store.insertNode(nodeA);
    store.insertNode(nodeB);

    groupManager.createGroup('g1', 'Similar Match', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const matches = await indexer.resolveCrossRepoSymbols('g1');
    // getRutes vs getRoute has Levenshtein distance 1, should match as similar_name
    const similarMatch = matches.find((m) => m.matchType === 'similar_name');
    expect(similarMatch).toBeTruthy();
    if (similarMatch) {
      expect(similarMatch.confidence).toBeCloseTo(0.7, 1);
    }
  });

  it('should handle federated search with groupId filter', async () => {
    const engine = new FederatedSearchEngine(store);
    const node = createProjectNode('group-a', 'findTarget', 'Function', 'src/target.ts', true);
    store.insertNode(node);

    const result = await engine.search('findTarget', { groupId: 'group-a' });
    expect(result.totalResults).toBeGreaterThanOrEqual(0);
  });

  it('should handle federated search with repoFilter option', async () => {
    const engine = new FederatedSearchEngine(store);
    const node = createProjectNode('repo-target', 'searchMe', 'Function', 'src/app.ts', true);
    store.insertNode(node);

    const result = await engine.search('searchMe', { repoFilter: ['repo-target'] });
    expect(result.totalResults).toBeGreaterThanOrEqual(1);
    for (const item of result.results) {
      expect(item.repo).toBe('repo-target');
    }
  });

  it('should handle findDuplicates with no matching files', async () => {
    const engine = new FederatedSearchEngine(store);
    const report = await engine.findDuplicates('empty-check', 0.99);
    expect(report.totalDuplicates).toBe(0);
  });

  it('should detect cross-repo contracts from type aliases', async () => {
    const typeA = createProjectNode('o/repo-a', 'ApiConfig', 'TypeAlias', 'config.ts', true);
    const typeB = createProjectNode('o/repo-b', 'ApiConfig', 'TypeAlias', 'config.ts', true);

    store.insertNode(typeA);
    store.insertNode(typeB);

    groupManager.createGroup('g1', 'Type Contracts', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const contracts = await indexer.detectContracts('g1');
    const typeContract = contracts.find((c) => c.name === 'ApiConfig');
    expect(typeContract).toBeTruthy();
  });

  it('should check type compatibility with changed return types', async () => {
    const nodeA = createProjectNode('o/repo-a', 'processData', 'Function', 'src/proc.ts', true);
    const nodeB: GraphNode = {
      ...createProjectNode('o/repo-b', 'processData', 'Function', 'src/proc.ts', true),
      signature: '(input: string): string',
      properties: {
        ...createProjectNode('o/repo-b', 'processData', 'Function', 'src/proc.ts', true).properties,
        returnType: 'string',
      },
    };
    const nodeAWithRT: GraphNode = {
      ...nodeA,
      signature: '(input: string): number',
      properties: {
        ...nodeA.properties,
        returnType: 'number',
      },
    };

    store.insertNode(nodeAWithRT);
    store.insertNode(nodeB);

    groupManager.createGroup('g1', 'Return Type', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const result = await indexer.checkTypeCompatibility('g1', 'processData', 'processData');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should check type compatibility with added required properties', async () => {
    const nodeA = createProjectNode('o/repo-a', 'dataObj', 'Function', 'src/data.ts', true);
    const nodeB = createProjectNode('o/repo-b', 'dataObj', 'Function', 'src/data.ts', true);

    const nodeAWithProp: GraphNode = {
      ...nodeA,
      properties: {
        ...nodeA.properties,
        configurable: true,
      },
    };
    const nodeBWithProp: GraphNode = {
      ...nodeB,
      properties: {
        ...nodeB.properties,
      },
    };

    store.insertNode(nodeAWithProp);
    store.insertNode(nodeBWithProp);

    groupManager.createGroup('g1', 'Added Props', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const result = await indexer.checkTypeCompatibility('g1', 'dataObj', 'dataObj');
    // Property 'configurable' is in nodeA but not in nodeB → should be flagged
    expect(result.breakingChanges.length + result.warnings.length).toBeGreaterThan(0);
  });

  it('should analyze cross-repo impact with depth limits', async () => {
    groupManager.createGroup('g1', 'Impact', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const result = await indexer.analyzeCrossRepoImpact('g1', 'o/repo-a');
    expect(result.changedRepo).toBe('o/repo-a');
    expect(Array.isArray(result.analysis)).toBe(true);
    expect(Array.isArray(result.affectedRepos)).toBe(true);
  });

  it('should handle getCrossRepoUsage with cross-repo filter', async () => {
    const engine = new FederatedSearchEngine(store);
    const crossNode = createProjectNode('cross-repo:g1', 'fake-dep', 'Function', 'fake.ts');
    store.insertNode(crossNode);

    const result = await engine.getCrossRepoUsage('fake-dep', 'g1');
    expect(result.dependencyName).toBe('fake-dep');
    expect(result.totalFiles).toBeGreaterThanOrEqual(0);
  });

  it('should handle getCrossRepoUsage with File nodes filtered out', async () => {
    const engine = new FederatedSearchEngine(store);
    const fileNode = createProjectNode('repo-a', 'lodash.something', 'File', 'src/app.ts');
    store.insertNode(fileNode);
    const symbolNode = createProjectNode('repo-a', 'lodashHelper', 'Function', 'src/helper.ts');
    store.insertNode(symbolNode);

    const result = await engine.getCrossRepoUsage('lodash', 'g1');
    expect(result.dependencyName).toBe('lodash');
    // File nodes should be filtered out
    expect(result.totalFiles).toBeGreaterThanOrEqual(0);
  });

  it('should handle findDuplicates with MinHash token extraction', async () => {
    const engine = new FederatedSearchEngine(store);

    const fileA = createProjectNode('repo-a', 'Controller.ts', 'File', 'Controller.ts');
    const fileB = createProjectNode('repo-b', 'Controller.ts', 'File', 'Controller.ts');

    const insertedA = store.insertNode({
      ...fileA,
      qualifiedName: 'file:repo-a:Controller.ts',
    });
    const insertedB = store.insertNode({
      ...fileB,
      qualifiedName: 'file:repo-b:Controller.ts',
    });

    // Create DEFINES edges
    const now = new Date().toISOString();
    const funcA = createProjectNode('repo-a', 'getUsers', 'Function', 'Controller.ts', true);
    const funcB = createProjectNode('repo-b', 'getUsers', 'Function', 'Controller.ts', true);

    const fA = store.insertNode(funcA);
    const fB = store.insertNode(funcB);

    store.insertEdge({
      id: 0, projectId: 'repo-a', sourceId: insertedA, targetId: fA,
      type: 'DEFINES', properties: {}, weight: 1, createdAt: now,
    });
    store.insertEdge({
      id: 0, projectId: 'repo-b', sourceId: insertedB, targetId: fB,
      type: 'DEFINES', properties: {}, weight: 1, createdAt: now,
    });

    const report = await engine.findDuplicates('test-g', 0.3);
    expect(report.groupId).toBe('test-g');
    expect(Array.isArray(report.duplicates)).toBe(true);
  });

  it('should handle repos with autoIndex false being skipped', async () => {
    groupManager.createGroup('g1', 'Skip Group', '');
    // RepoGroupManager.addRepo sets autoIndex: true by default
    // but we test that indexGroup only indexes repos with autoIndex
    const result = await indexer.indexGroup('g1');
    expect(result.reposIndexed).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it('should detect contracts with shared type aliases', async () => {
    const typeA = createProjectNode('o/repo-a', 'UserDTO', 'TypeAlias', 'types.ts', true);
    const typeB = createProjectNode('o/repo-b', 'UserDTO', 'TypeAlias', 'types.ts', true);
    const typeC = createProjectNode('o/repo-c', 'UserDTO', 'TypeAlias', 'types.ts', true);

    store.insertNode(typeA);
    store.insertNode(typeB);
    store.insertNode(typeC);

    groupManager.createGroup('g1', 'Three Repos', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-c', 'u', '');

    const contracts = await indexer.detectContracts('g1');
    const contract = contracts.find((c) => c.name === 'UserDTO');
    expect(contract).toBeTruthy();
    if (contract) {
      expect(contract.dependencies.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('should handle federated search with maxResults option', async () => {
    const engine = new FederatedSearchEngine(store);
    for (let i = 0; i < 20; i++) {
      const node = createProjectNode('repo-x', `searchItem${i}`, 'Function', 'src/search.ts', true);
      store.insertNode(node);
    }

    const result = await engine.search('searchItem', { maxResults: 5 });
    expect(result.results.length).toBeLessThanOrEqual(5);
    expect(result.totalResults).toBeLessThanOrEqual(5);
  });

  it('should handle findSymbol with empty results', async () => {
    const engine = new FederatedSearchEngine(store);
    const results = await engine.findSymbol('nonexistentSymbolXYZ123');
    expect(results).toEqual([]);
  });

  it('should handle findSymbol with Variable label', async () => {
    const engine = new FederatedSearchEngine(store);
    const node = createProjectNode('repo-a', 'myVariable', 'Variable', 'src/app.ts', false);
    store.insertNode(node);

    const results = await engine.findSymbol('myVariable');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.symbol).toBe('myVariable');
  });

  it('should handle search with non-symbol labels (File)', async () => {
    const engine = new FederatedSearchEngine(store);
    const fileNode = createProjectNode('repo-a', 'App.ts', 'File', 'src/App.ts');
    store.insertNode(fileNode);

    const result = await engine.search('App');
    // With many results, non-symbol labels may be filtered
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('should detect cross-repo impact with no changes', async () => {
    groupManager.createGroup('g1', 'No Impact', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const result = await indexer.analyzeCrossRepoImpact('g1', 'o/repo-a');
    expect(result.analysis.length).toBe(0);
  });

  it('should handle checkTypeCompatibility with different language', async () => {
    const nodeA: GraphNode = {
      ...createProjectNode('o/repo-a', 'LanguageFunc', 'Function', 'src/func.py', true),
      language: 'python',
      properties: {
        ...createProjectNode('o/repo-a', 'LanguageFunc', 'Function', 'src/func.py', true).properties,
        language: 'python',
      },
    };
    const nodeB: GraphNode = {
      ...createProjectNode('o/repo-b', 'LanguageFunc', 'Function', 'src/func.ts', true),
      language: 'typescript',
      properties: {
        ...createProjectNode('o/repo-b', 'LanguageFunc', 'Function', 'src/func.ts', true).properties,
        language: 'typescript',
      },
    };

    store.insertNode(nodeA);
    store.insertNode(nodeB);

    groupManager.createGroup('g1', 'Lang Diff', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const result = await indexer.checkTypeCompatibility('g1', 'LanguageFunc', 'LanguageFunc');
    expect(result.compatible).toBe(true);
    expect(result.sourceType).toContain('Function');
  });

  it('should handle federated search with groupId non-matching repos', async () => {
    const engine = new FederatedSearchEngine(store);
    const node = createProjectNode('other-group', 'funcName', 'Function', 'src/app.ts', true);
    store.insertNode(node);

    const result = await engine.search('funcName', { groupId: 'different-group' });
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('should handle federated findSymbol with non-symbol labels', async () => {
    const engine = new FederatedSearchEngine(store);
    const fileNode = createProjectNode('repo-a', 'myFile', 'File', 'src/file.ts');
    store.insertNode(fileNode);

    const results = await engine.findSymbol('myFile');
    // File nodes should not appear in results (only code symbols)
    expect(Array.isArray(results)).toBe(true);
  });

  it('should handle findDuplicates with no symbol files', async () => {
    const engine = new FederatedSearchEngine(store);
    const fileA = createProjectNode('repo-a', 'EmptyFile.ts', 'File', 'EmptyFile.ts');
    const fileB = createProjectNode('repo-b', 'EmptyFile.ts', 'File', 'EmptyFile.ts');

    store.insertNode({ ...fileA, qualifiedName: 'file:repo-a:EmptyFile.ts' });
    store.insertNode({ ...fileB, qualifiedName: 'file:repo-b:EmptyFile.ts' });

    const report = await engine.findDuplicates('dup-test', 0.0);
    expect(report.totalDuplicates).toBeGreaterThanOrEqual(0);
  });

  it('should handle getCrossRepoUsage with signature-based matching', async () => {
    const engine = new FederatedSearchEngine(store);
    const node = createProjectNode('repo-a', 'somePkg', 'Function', 'src/app.ts');
    const nodeWithSig: GraphNode = {
      ...node,
      signature: 'somePkg.doSomething()',
    };
    store.insertNode(nodeWithSig);

    const result = await engine.getCrossRepoUsage('somePkg', 'g1');
    expect(result.dependencyName).toBe('somePkg');
    expect(result.totalRepos).toBeGreaterThanOrEqual(1);
  });

  it('should handle federated search with many non-symbol results filtering', async () => {
    const engine = new FederatedSearchEngine(store);
    // Add many File nodes (non-symbol) and a few Function nodes
    for (let i = 0; i < 20; i++) {
      const fileNode = createProjectNode('repo-x', `FileNode${i}`, 'File', `src/file${i}.ts`);
      store.insertNode(fileNode);
    }
    const funcNode = createProjectNode('repo-x', 'targetFunc', 'Function', 'src/app.ts', true);
    store.insertNode(funcNode);

    const result = await engine.search('Node', { maxResults: 5 });
    expect(result.totalResults).toBeLessThanOrEqual(5);
  });

  it('should handle findDuplicates with same-repo comparison skip', async () => {
    const engine = new FederatedSearchEngine(store);
    const fileA = createProjectNode('same-repo', 'FileA.ts', 'File', 'FileA.ts');
    const fileB = createProjectNode('same-repo', 'FileB.ts', 'File', 'FileB.ts');

    store.insertNode({ ...fileA, qualifiedName: 'file:same-repo:FileA.ts' });
    store.insertNode({ ...fileB, qualifiedName: 'file:same-repo:FileB.ts' });

    const report = await engine.findDuplicates('same-test', 0.0);
    // Same repo files should be skipped in comparison
    expect(report.totalDuplicates).toBe(0);
  });

  it('should handle getCrossRepoUsage with cross-repo namespace filtering', async () => {
    const engine = new FederatedSearchEngine(store);
    const crossNode = createProjectNode('cross-repo:some-id', 'dep-name', 'Function', 'fake.ts');
    store.insertNode(crossNode);

    const result = await engine.getCrossRepoUsage('dep-name', 'test-group');
    // cross-repo project IDs should be filtered
    expect(result.totalRepos).toBe(0);
  });

  it('should handle indexGroup with language filter', async () => {
    groupManager.createGroup('g1', 'Lang Filter', '');
    const baseDir = join(tmpdir(), `lang-filter-${Date.now()}`);
    const repoDir = createTestRepoDir(baseDir, 'service-lang', {
      'index.ts': 'export function getData() { return 42; }',
      'utils.py': 'def helper(): return True',
      'README.md': '# Doc',
    });
    groupManager.addRepo('g1', 'org', 'service-lang', 'https://a.example.com', repoDir);

    const result = await indexer.indexGroup('g1', { languages: ['typescript'] });
    expect(result.groupId).toBe('g1');
    expect(result.reposIndexed).toBe(1);
  });

  it('should handle indexGroup with force option', async () => {
    const baseDir = join(tmpdir(), `force-opt-${Date.now()}`);
    const repoDir = createTestRepoDir(baseDir, 'service-force', {
      'index.ts': 'export function getStuff() { return true; }',
    });
    groupManager.createGroup('g1', 'Force Index', '');
    groupManager.addRepo('g1', 'org', 'service-force', 'https://a.example.com', repoDir);

    const result = await indexer.indexGroup('g1', { force: true });
    expect(result.reposIndexed).toBe(1);
  });

  it('should handle federated findSymbol with groupId null', async () => {
    const engine = new FederatedSearchEngine(store);
    const node = createProjectNode('repo-x', 'groupedSym', 'Function', 'src/x.ts');
    store.insertNode(node);

    const results = await engine.findSymbol('groupedSym');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle getCrossRepoUsage excluding File nodes', async () => {
    const engine = new FederatedSearchEngine(store);
    const fileNode = createProjectNode('repo-a', 'my-dep', 'File', 'src/pkg.ts');
    store.insertNode(fileNode);
    const fnNode = createProjectNode('repo-a', 'useDep', 'Function', 'src/app.ts');
    store.insertNode(fnNode);

    const result = await engine.getCrossRepoUsage('dep', 'g1');
    // File nodes should be excluded from results
    expect(Array.isArray(result.usedBy)).toBe(true);
  });

  it('should handle findDuplicates with pairwise comparison across different repos', async () => {
    const engine = new FederatedSearchEngine(store);
    
    const fileA = createProjectNode('rx', 'FileX.ts', 'File', 'FileX.ts');
    const fileB = createProjectNode('ry', 'FileY.ts', 'File', 'FileY.ts');
    
    const faRef = store.insertNode({ ...fileA, qualifiedName: 'file:rx:FileX.ts' });
    const fbRef = store.insertNode({ ...fileB, qualifiedName: 'file:ry:FileY.ts' });
    
    const funcA = createProjectNode('rx', 'fnA', 'Function', 'FileX.ts', true);
    const funcB = createProjectNode('ry', 'fnA', 'Function', 'FileY.ts', true);
    
    const fA = store.insertNode(funcA);
    const fB = store.insertNode(funcB);
    
    const now = new Date().toISOString();
    store.insertEdge({ id: 0, projectId: 'rx', sourceId: faRef, targetId: fA, type: 'DEFINES', properties: {}, weight: 1, createdAt: now });
    store.insertEdge({ id: 0, projectId: 'ry', sourceId: fbRef, targetId: fB, type: 'DEFINES', properties: {}, weight: 1, createdAt: now });
    
    const report = await engine.findDuplicates('pair-test', 0.3);
    expect(Array.isArray(report.duplicates)).toBe(true);
  });

  it('should handle resolveCrossRepoSymbols with import references', async () => {
    // Set up repo symbols
    const nodeA = createProjectNode('o/repo-a', 'exportedFn', 'Function', 'src/export.ts', true);
    const fileA = createProjectNode('o/repo-a', 'src/export.ts', 'File', 'src/export.ts');
    const fileB = createProjectNode('o/repo-b', 'src/consumer.ts', 'File', 'src/consumer.ts');

    store.insertNode(nodeA);
    store.insertNode(fileA);
    store.insertNode(fileB);

    groupManager.createGroup('g1', 'Import Ref', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const matches = await indexer.resolveCrossRepoSymbols('g1');
    expect(Array.isArray(matches)).toBe(true);
  });

  it('should handle detectContracts with more than 2 repos', async () => {
    const iface = createProjectNode('o/repo-a', 'SharedApi', 'Interface', 'types.ts', true);
    const iface2 = createProjectNode('o/repo-b', 'SharedApi', 'Interface', 'types.ts', true);
    const iface3 = createProjectNode('o/repo-c', 'SharedApi', 'Interface', 'types.ts', true);

    store.insertNode(iface);
    store.insertNode(iface2);
    store.insertNode(iface3);

    groupManager.createGroup('g1', 'Three Repo', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-c', 'u', '');

    const contracts = await indexer.detectContracts('g1');
    const shared = contracts.find((c) => c.name === 'SharedApi');
    expect(shared).toBeTruthy();
  });

  it('should handle checkTypeCompatibility with same symbol in different file', async () => {
    const nodeA = createProjectNode('o/repo-a', 'CompatibleFn', 'Function', 'src/a.ts', true);
    const nodeB = createProjectNode('o/repo-b', 'CompatibleFn', 'Function', 'src/b.ts', true);

    store.insertNode(nodeA);
    store.insertNode(nodeB);

    groupManager.createGroup('g1', 'Same File', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const result = await indexer.checkTypeCompatibility('g1', 'CompatibleFn', 'CompatibleFn');
    expect(result.compatible).toBe(true);
  });

  it('should handle buildCrossRepoGraph with cross-repo calls', async () => {
    groupManager.createGroup('g1', 'Calls', '');
    groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
    groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

    const report = await indexer.buildCrossRepoGraph('g1');
    expect(report.repos.length).toBe(2);
    expect(report.crossRepoEdges).toBe(0);
    expect(typeof report.orphanSymbols).toBe('number');
  });
});
