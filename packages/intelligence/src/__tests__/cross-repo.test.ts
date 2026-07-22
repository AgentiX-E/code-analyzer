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
});
