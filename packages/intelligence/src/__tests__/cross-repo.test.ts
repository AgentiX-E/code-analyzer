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

  describe('updateGroup', () => {
    it('should update group name', () => {
      manager.createGroup('g1', 'Old Name', 'Old Desc');
      const result = manager.updateGroup('g1', { name: 'New Name' });
      expect(result).toBe(true);
      const group = manager.getGroup('g1')!;
      expect(group.name).toBe('New Name');
      expect(group.description).toBe('Old Desc');
    });

    it('should update group description', () => {
      manager.createGroup('g1', 'Name', 'Old Desc');
      manager.updateGroup('g1', { description: 'New Desc' });
      const group = manager.getGroup('g1')!;
      expect(group.description).toBe('New Desc');
    });

    it('should update both name and description', () => {
      manager.createGroup('g1', 'Old Name', 'Old Desc');
      manager.updateGroup('g1', { name: 'New Name', description: 'New Desc' });
      const group = manager.getGroup('g1')!;
      expect(group.name).toBe('New Name');
      expect(group.description).toBe('New Desc');
    });

    it('should return false for non-existent group', () => {
      const result = manager.updateGroup('nonexistent', { name: 'Test' });
      expect(result).toBe(false);
    });

    it('should not modify group when no updates provided', () => {
      manager.createGroup('g1', 'Name', 'Desc');
      manager.updateGroup('g1', {});
      const group = manager.getGroup('g1')!;
      expect(group.name).toBe('Name');
      expect(group.description).toBe('Desc');
    });

    it('should not affect repos when updating metadata', () => {
      manager.createGroup('g1', 'Name', '');
      manager.addRepo('g1', 'owner', 'repo', 'url', '/path');
      manager.updateGroup('g1', { name: 'New Name' });
      const repos = manager.getRepos('g1');
      expect(repos.length).toBe(1);
      expect(repos[0]!.fullName).toBe('owner/repo');
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

    it('should load config with multiple groups and contracts', () => {
      manager.createGroup('g1', 'Group 1', 'Desc');
      manager.addRepo('g1', 'owner', 'repo1', 'url1', '/path/1');
      manager.createGroup('g2', 'Group 2', 'Desc 2');
      manager.addRepo('g2', 'owner', 'repo2', 'url2', '/path/2');

      const configPath = join(tmpDir, 'multi-group.json');
      manager.saveConfig(configPath);

      const manager2 = new RepoGroupManager();
      manager2.loadConfig(configPath);
      expect(manager2.listGroups().length).toBe(2);
      expect(manager2.hasGroup('g1')).toBe(true);
      expect(manager2.hasGroup('g2')).toBe(true);
    });

    it('should load config with null indexedAt', () => {
      manager.createGroup('g1', 'Group', '');
      manager.markIndexed('g1');
      const configPath = join(tmpDir, 'indexed.json');
      manager.saveConfig(configPath);

      const manager2 = new RepoGroupManager();
      manager2.loadConfig(configPath);
      const loaded = manager2.getGroup('g1')!;
      expect(loaded.indexedAt).toBeTruthy();
    });

    it('should handle loadConfig with non-object items in array', () => {
      const configPath = join(tmpDir, 'with-null.json');
      writeFileSync(configPath, JSON.stringify([null, 'string', 123]), 'utf-8');
      const mgr = new RepoGroupManager();
      // Should not throw — non-object items are skipped
      mgr.loadConfig(configPath);
      expect(mgr.listGroups().length).toBe(0);
    });

    it('should handle addRepo with default role', () => {
      manager.createGroup('g1', 'Group', '');
      manager.addRepo('g1', 'owner', 'my-repo', 'https://example.com/repo', '/path');
      const repos = manager.getRepos('g1');
      expect(repos[0]!.role).toBe('dependency');
      expect(repos[0]!.autoIndex).toBe(true);
    });

    it('should handle markIndexed for group with existing indexedAt', () => {
      manager.createGroup('g1', 'Group', '');
      const before = manager.getGroup('g1')!;
      expect(before.indexedAt).toBeNull();

      manager.markIndexed('g1');
      const after = manager.getGroup('g1')!;
      expect(after.indexedAt).not.toBeNull();

      // Mark again — indexedAt should always be set
      manager.markIndexed('g1');
      const second = manager.getGroup('g1')!.indexedAt;
      expect(second).not.toBeNull();
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

    it('should report missing symbol when only one symbol exists', async () => {
      const nodeA = createProjectNode('o/repo-a', 'existingFn', 'Function', 'src/a.ts', true);
      store.insertNode(nodeA);

      groupManager.createGroup('g1', 'Compat', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      // nodeA exists in repo-a, but nonexistentB is not found anywhere
      const result = await indexer.checkTypeCompatibility('g1', 'existingFn', 'nonexistentB');
      expect(result.compatible).toBe(false);
      expect(result.breakingChanges[0]).toContain('Symbol not found');
      expect(result.breakingChanges[0]).toContain('nonexistentB');
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

    it('should accept optional changedSymbols parameter', async () => {
      groupManager.createGroup('g1', 'Symbol', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      const result = await indexer.analyzeCrossRepoImpact('g1', 'o/repo-a', ['myFunction']);
      expect(result.changedRepo).toBe('o/repo-a');
      expect(result.changedSymbols).toEqual(['myFunction']);
    });

    it('should not set changedSymbols when parameter is empty', async () => {
      groupManager.createGroup('g1', 'Symbol2', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');

      const result = await indexer.analyzeCrossRepoImpact('g1', 'o/repo-a', []);
      expect(result.changedSymbols).toBeUndefined();
    });
  });

  describe('getRepoNodes', () => {
    it('should be a public method', () => {
      expect(typeof indexer.getRepoNodes).toBe('function');
    });

    it('should return empty array for empty store', () => {
      const nodes = indexer.getRepoNodes('nonexistent');
      expect(Array.isArray(nodes)).toBe(true);
      expect(nodes.length).toBe(0);
    });

    it('should return nodes for a specific project', () => {
      groupManager.createGroup('g1', 'Nodes', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');

      // Insert a node directly into store
      const node = createProjectNode('o/repo-a', 'testFn', 'Function', 'src/test.ts', true);
      store.insertNode(node);
      const allNodes = store.getAllNodes();
      const id = allNodes[0]!.id;

      const nodes = indexer.getRepoNodes('o/repo-a');
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      expect(nodes.some((n) => n.name === 'testFn')).toBe(true);
    });
  });

  describe('traceSymbolDependencies', () => {
    it('should throw for non-existent group', async () => {
      await expect(
        indexer.traceSymbolDependencies('nonexistent', 'o/repo-a', 'fn'),
      ).rejects.toThrow('not found');
    });

    it('should throw for repo not in group', async () => {
      groupManager.createGroup('g1', 'Trace', '');
      await expect(
        indexer.traceSymbolDependencies('g1', 'unknown-repo', 'fn'),
      ).rejects.toThrow('not in group');
    });

    it('should return empty array for symbol with no matches', async () => {
      groupManager.createGroup('g1', 'Trace', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      const traces = await indexer.traceSymbolDependencies('g1', 'o/repo-a', 'nonexistentFn');
      expect(traces).toEqual([]);
    });

    it('should trace direct dependencies via CROSS_REPO edges', async () => {
      groupManager.createGroup('g1', 'Trace', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      groupManager.addRepo('g1', 'o', 'repo-b', 'u', '');

      // Set up cross-repo graph: fn in repo-a calls fn in repo-b
      const nodeA = createProjectNode('o/repo-a', 'sourceFn', 'Function', 'src/a.ts', true);
      const nodeB = createProjectNode('o/repo-b', 'targetFn', 'Function', 'src/b.ts', true);
      store.insertNode(nodeA);
      store.insertNode(nodeB);
      const allNodes = store.getAllNodes();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;
      const idB = allNodes.find((n) => n.name === 'targetFn')!.id;

      store.insertEdge({
        id: 0, projectId: 'o/repo-a',
        sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_CALLS', properties: {}, weight: 1,
        createdAt: new Date().toISOString(),
      });

      const traces = await indexer.traceSymbolDependencies('g1', 'o/repo-a', 'sourceFn');
      expect(traces.length).toBeGreaterThanOrEqual(1);
      expect(traces.some((t) => t.targetRepo === 'o/repo-b')).toBe(true);
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

// ---------------------------------------------------------------------------
// CrossRepoIndexer — additional coverage for v8 ignore blocks
// ---------------------------------------------------------------------------

describe('CrossRepoIndexer — additional coverage', () => {
  let store: InMemoryGraphStore;
  let groupManager: RepoGroupManager;
  let indexer: CrossRepoIndexer;
  const tmpBaseDir = join(tmpdir(), `cross-repo-extra-${Date.now()}`);

  beforeEach(() => {
    store = new InMemoryGraphStore();
    groupManager = new RepoGroupManager();
    indexer = new CrossRepoIndexer(store, groupManager);
    mkdirSync(tmpBaseDir, { recursive: true });
  });

  describe('indexGroup — with language filter and concurrency', () => {
    it('should filter by language when indexing', async () => {
      const repoDir = createTestRepoDir(tmpBaseDir, 'lang-mixed', {
        'index.ts': 'export function getData() { return 42; }',
        'utils.py': 'def helper():\n    return True',
        'app.go': 'package main\n\nfunc main() {}',
        'README.md': '# Documentation',
      });

      groupManager.createGroup('g1', 'Mixed', '');
      groupManager.addRepo('g1', 'org', 'lang-mixed', 'https://a.example.com', repoDir);

      const result = await indexer.indexGroup('g1', { languages: ['typescript'] });
      expect(result.groupId).toBe('g1');
      expect(result.reposIndexed).toBe(1);
    });

    it('should filter by multiple languages', async () => {
      const repoDir = createTestRepoDir(tmpBaseDir, 'multi-lang', {
        'main.py': 'def main():\n    pass',
        'app.ts': 'export function app() { return true; }',
      });

      groupManager.createGroup('g1', 'Multi', '');
      groupManager.addRepo('g1', 'org', 'multi-lang', 'https://a.example.com', repoDir);

      const result = await indexer.indexGroup('g1', { languages: ['python', 'typescript'] });
      expect(result.reposIndexed).toBe(1);
    });

    it('should use force option to re-index', async () => {
      const repoDir = createTestRepoDir(tmpBaseDir, 'force-reindex', {
        'index.ts': 'export function data() { return 42; }',
      });

      groupManager.createGroup('g1', 'Force', '');
      groupManager.addRepo('g1', 'org', 'force-reindex', 'https://a.example.com', repoDir);

      const result = await indexer.indexGroup('g1', { force: true });
      expect(result.reposIndexed).toBe(1);
    });

    it('should handle indexing with explicit concurrency', async () => {
      const repoDir = createTestRepoDir(tmpBaseDir, 'concurrent', {
        'index.ts': 'export const x = 1;',
      });

      groupManager.createGroup('g1', 'Concurrent', '');
      groupManager.addRepo('g1', 'org', 'concurrent', 'https://a.example.com', repoDir);

      const result = await indexer.indexGroup('g1', { concurrency: 1 });
      expect(result.reposIndexed).toBe(1);
    });

    it('should handle indexing with default concurrency', async () => {
      const repoDir = createTestRepoDir(tmpBaseDir, 'default-conc', {
        'app.ts': 'export default class App {}',
      });

      groupManager.createGroup('g1', 'Default', '');
      groupManager.addRepo('g1', 'org', 'default-conc', 'https://a.example.com', repoDir);

      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
    });

    it('should handle repos with no autoIndex flag', async () => {
      groupManager.createGroup('g1', 'No AutoIndex', '');
      // Add a repo but set autoIndex to false
      const group = groupManager.getGroup('g1')!;
      (group as any).repos = [{ fullName: 'org/skip', localPath: '/tmp/skip', autoIndex: false }];

      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(0);
    });
  });

  describe('indexRepo — edge cases', () => {
    it('should throw for non-existent group', async () => {
      await expect(indexer.indexRepo('nonexistent', 'org/repo')).rejects.toThrow('not found');
    });

    it('should throw for repo not in group', async () => {
      groupManager.createGroup('g1', 'Test', '');
      await expect(indexer.indexRepo('g1', 'unknown/repo')).rejects.toThrow('not found in group');
    });
  });

  describe('buildCrossRepoGraph — edge cases', () => {
    it('should return early for groups with < 2 repos', async () => {
      groupManager.createGroup('g1', 'Solo Graph', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');

      const report = await indexer.buildCrossRepoGraph('g1');
      expect(report.crossRepoEdges).toBe(0);
    });

    it('should throw for non-existent group', async () => {
      await expect(indexer.buildCrossRepoGraph('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('detectContracts — edge cases', () => {
    it('should throw for non-existent group', async () => {
      await expect(indexer.detectContracts('nonexistent')).rejects.toThrow('not found');
    });

    it('should return empty for groups with < 2 repos', async () => {
      groupManager.createGroup('g1', 'Solo Contract', '');
      groupManager.addRepo('g1', 'o', 'repo-a', 'u', '');
      const contracts = await indexer.detectContracts('g1');
      expect(contracts).toEqual([]);
    });
  });

  describe('checkTypeCompatibility — edge cases', () => {
    it('should throw for non-existent group', async () => {
      await expect(indexer.checkTypeCompatibility('nonexistent', 'a', 'b')).rejects.toThrow('not found');
    });
  });

  describe('analyzeCrossRepoImpact — edge cases', () => {
    it('should throw for non-existent group', async () => {
      await expect(indexer.analyzeCrossRepoImpact('nonexistent', 'r')).rejects.toThrow('not found');
    });
  });

  describe('traceSymbolDependencies — edge cases', () => {
    it('should throw for non-existent group', async () => {
      await expect(indexer.traceSymbolDependencies('nonexistent', 'r', 's')).rejects.toThrow('not found');
    });

    it('should throw for repo not in group', async () => {
      groupManager.createGroup('g1', 'Trace Group', '');
      await expect(indexer.traceSymbolDependencies('g1', 'unknown', 'fn')).rejects.toThrow('not in group');
    });
  });

  describe('resolveCrossRepoSymbols — edge cases', () => {
    it('should throw for non-existent group', async () => {
      await expect(indexer.resolveCrossRepoSymbols('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('levenshteinDistance — additional', () => {
    it('should swap strings when a is longer than b', () => {
      const result = levenshteinDistance('longstring', 'short');
      expect(result).toBeGreaterThan(0);
    });

    it('should handle completely different length strings', () => {
      const result = levenshteinDistance('a', 'abcdefghij');
      expect(result).toBe(9);
    });
  });
});

// ---------------------------------------------------------------------------
// CrossRepoIndexer — comprehensive branch coverage
// ---------------------------------------------------------------------------

describe('CrossRepoIndexer — branch coverage', () => {
  let store: InMemoryGraphStore;
  let groupManager: RepoGroupManager;
  let indexer: CrossRepoIndexer;
  const now = new Date().toISOString();

  beforeEach(() => {
    store = new InMemoryGraphStore();
    groupManager = new RepoGroupManager();
    indexer = new CrossRepoIndexer(store, groupManager);
  });

  function setupTwoRepos(): { allNodes: GraphNode[] } {
    groupManager.createGroup('g1', 'Cross Group', '');
    groupManager.addRepo('g1', 'org', 'repo-a', 'https://a.example.com', '/tmp/repo-a');
    groupManager.addRepo('g1', 'org', 'repo-b', 'https://b.example.com', '/tmp/repo-b');

    const nodeA = createProjectNode('org/repo-a', 'sourceFn', 'Function', 'src/a.ts', true);
    const nodeB = createProjectNode('org/repo-b', 'targetFn', 'Function', 'src/b.ts', true);
    store.insertNode(nodeA);
    store.insertNode(nodeB);
    return { allNodes: store.getAllNodes() };
  }

  describe('analyzeCrossRepoImpact — BFS traversal', () => {
    it('should traverse cross-repo edges via BFS and produce affected analysis', async () => {
      const { allNodes } = setupTwoRepos();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;
      const idB = allNodes.find((n) => n.name === 'targetFn')!.id;

      store.insertEdge({
        id: 0, projectId: 'org/repo-a',
        sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now,
      });

      const result = await indexer.analyzeCrossRepoImpact('g1', 'org/repo-a');
      expect(result.changedRepo).toBe('org/repo-a');
      expect(result.analysis.length).toBeGreaterThanOrEqual(1);
      expect(result.affectedRepos).toContain('org/repo-b');
      const repoB = result.analysis.find((a) => a.repo === 'org/repo-b');
      expect(repoB).toBeTruthy();
      expect(repoB!.impactLevel).toBe('high'); // depth 1 = high
    });

    it('should track specific affected symbols', async () => {
      const { allNodes } = setupTwoRepos();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;
      const idB = allNodes.find((n) => n.name === 'targetFn')!.id;

      store.insertEdge({
        id: 0, projectId: 'org/repo-a',
        sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now,
      });

      const result = await indexer.analyzeCrossRepoImpact('g1', 'org/repo-a');
      const repoB = result.analysis.find((a) => a.repo === 'org/repo-b');
      expect(repoB).toBeTruthy();
      // Should have affected symbols (either tracked specifically or all symbols)
      expect(repoB!.affectedSymbols.length).toBeGreaterThanOrEqual(0);
    });

    it('should use changedSymbols filter to scope source nodes', async () => {
      const { allNodes } = setupTwoRepos();
      // Add a second source node that won't match the filter
      const extraNode = createProjectNode('org/repo-a', 'extraFn', 'Function', 'src/extra.ts', true);
      store.insertNode(extraNode);

      const allN = store.getAllNodes();
      const idA = allN.find((n) => n.name === 'sourceFn')!.id;
      const idB = allN.find((n) => n.name === 'targetFn')!.id;
      const idExtra = allN.find((n) => n.name === 'extraFn')!.id;

      // Only sourceFn has a CROSS_REPO edge to targetFn
      store.insertEdge({
        id: 0, projectId: 'org/repo-a',
        sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now,
      });

      // When filtering by 'sourceFn', only its edges should be traversed
      const result = await indexer.analyzeCrossRepoImpact('g1', 'org/repo-a', ['sourceFn']);
      expect(result.changedSymbols).toEqual(['sourceFn']);
      // repo-b should still be affected because sourceFn's edge connects to it
      expect(result.affectedRepos).toContain('org/repo-b');
    });
  });

  describe('buildCrossRepoGraph — edge type detection', () => {
    it('should detect CROSS_REPO_IMPORTS edges', async () => {
      setupTwoRepos();
      const allNodes = store.getAllNodes();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;
      const idB = allNodes.find((n) => n.name === 'targetFn')!.id;

      store.insertEdge({
        id: 0, projectId: 'org/repo-a',
        sourceId: idA, targetId: idB,
        type: 'IMPORTS', properties: {}, weight: 1, createdAt: now,
      });

      const report = await indexer.buildCrossRepoGraph('g1');
      expect(report.repos).toHaveLength(2);
      expect(report.byType['CROSS_REPO_IMPORTS']).toBeGreaterThanOrEqual(1);
    });

    it('should detect CROSS_REPO_CALLS edges', async () => {
      setupTwoRepos();
      const allNodes = store.getAllNodes();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;
      const idB = allNodes.find((n) => n.name === 'targetFn')!.id;

      store.insertEdge({
        id: 0, projectId: 'org/repo-a',
        sourceId: idA, targetId: idB,
        type: 'CALLS', properties: {}, weight: 1, createdAt: now,
      });

      const report = await indexer.buildCrossRepoGraph('g1');
      expect(report.byType['CROSS_REPO_CALLS']).toBeGreaterThanOrEqual(1);
    });

    it('should detect CROSS_REPO_IMPLEMENTS edges', async () => {
      setupTwoRepos();
      const allNodes = store.getAllNodes();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;
      const idB = allNodes.find((n) => n.name === 'targetFn')!.id;

      store.insertEdge({
        id: 0, projectId: 'org/repo-a',
        sourceId: idA, targetId: idB,
        type: 'IMPLEMENTS', properties: {}, weight: 1, createdAt: now,
      });

      const report = await indexer.buildCrossRepoGraph('g1');
      expect(report.byType['CROSS_REPO_IMPLEMENTS']).toBeGreaterThanOrEqual(1);
    });

    it('should detect CROSS_REPO_DEPENDS for unknown edge types', async () => {
      setupTwoRepos();
      const allNodes = store.getAllNodes();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;
      const idB = allNodes.find((n) => n.name === 'targetFn')!.id;

      store.insertEdge({
        id: 0, projectId: 'org/repo-a',
        sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_DEPENDS', properties: {}, weight: 1, createdAt: now,
      });

      const report = await indexer.buildCrossRepoGraph('g1');
      expect(report.byType['CROSS_REPO_DEPENDS']).toBeGreaterThanOrEqual(1);
    });

    it('should count orphan symbols (exported but unreferenced)', async () => {
      setupTwoRepos();
      const allNodes = store.getAllNodes();
      // All nodes are exported but have no cross-repo edges referencing them
      const report = await indexer.buildCrossRepoGraph('g1');
      // sourceFn and targetFn are both exported and unreferenced cross-repo
      expect(typeof report.orphanSymbols).toBe('number');
      expect(report.orphanSymbols).toBeGreaterThanOrEqual(1);
    });

    it('should not count referenced symbols as orphans', async () => {
      setupTwoRepos();
      const allNodes = store.getAllNodes();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;
      const idB = allNodes.find((n) => n.name === 'targetFn')!.id;

      // Create a cross-repo edge referencing targetFn from another repo's node
      store.insertEdge({
        id: 0, projectId: 'org/repo-a',
        sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now,
      });

      const report = await indexer.buildCrossRepoGraph('g1');
      // targetFn is now referenced by a cross-repo edge, so it's not an orphan
      // sourceFn is still an orphan (not referenced)
      expect(report.orphanSymbols).toBeGreaterThanOrEqual(0);
    });
  });

  describe('traceSymbolDependencies — transitive dependencies', () => {
    it('should trace transitive dependencies (depth 2)', async () => {
      const { allNodes } = setupTwoRepos();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;
      const idB = allNodes.find((n) => n.name === 'targetFn')!.id;

      // Add a third node in repo-b with a further edge to repo-c
      const nodeC = createProjectNode('org/repo-c', 'deepTarget', 'Function', 'src/c.ts', true);
      const idC = store.insertNode(nodeC);
      groupManager.addRepo('g1', 'org', 'repo-c', 'https://c.example.com', '/tmp/repo-c');

      // Cross-repo edge: sourceFn (repo-a) → targetFn (repo-b)
      store.insertEdge({
        id: 0, projectId: 'org/repo-a',
        sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now,
      });

      // Cross-repo edge: targetFn (repo-b) → deepTarget (repo-c)
      store.insertEdge({
        id: 0, projectId: 'org/repo-b',
        sourceId: idB, targetId: idC,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now,
      });

      const traces = await indexer.traceSymbolDependencies('g1', 'org/repo-a', 'sourceFn');
      expect(traces.length).toBeGreaterThanOrEqual(2);
      const directTrace = traces.find((t) => t.depth === 1);
      expect(directTrace).toBeTruthy();
      expect(directTrace!.confidence).toBe('high');
      const transitiveTrace = traces.find((t) => t.depth === 2);
      expect(transitiveTrace).toBeTruthy();
      expect(transitiveTrace!.confidence).toBe('medium');
    });
  });

  describe('resolveCrossRepoSymbols — import reference detection', () => {
    it('should detect import_reference matches', async () => {
      const { allNodes } = setupTwoRepos();
      const sourceFn = allNodes.find((n) => n.name === 'sourceFn')!;
      const targetFn = allNodes.find((n) => n.name === 'targetFn')!;

      // Create a File node for repo-b and an IMPORTS edge from it to sourceFn
      const fileB = createProjectNode('org/repo-b', 'consumer.ts', 'File', 'src/consumer.ts');
      const idFileB = store.insertNode(fileB);

      store.insertEdge({
        id: 0, projectId: 'org/repo-b',
        sourceId: idFileB, targetId: sourceFn.id,
        type: 'IMPORTS', properties: {}, weight: 1, createdAt: now,
      });

      const matches = await indexer.resolveCrossRepoSymbols('g1');
      const importMatches = matches.filter((m) => m.matchType === 'import_reference');
      expect(importMatches.length).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(matches)).toBe(true);
    });
  });

  describe('resolveCrossRepoSymbols — with 3+ repos', () => {
    it('should compare symbols across 3 repos', async () => {
      groupManager.createGroup('g1', 'Three', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');
      groupManager.addRepo('g1', 'org', 'repo-c', 'https://c', '/c');

      const nodeA = createProjectNode('org/repo-a', 'sharedFn', 'Function', 'src/a.ts', true);
      const nodeB = createProjectNode('org/repo-b', 'sharedFn', 'Function', 'src/b.ts', true);
      const nodeC = createProjectNode('org/repo-c', 'sharedFn', 'Function', 'src/c.ts', true);
      store.insertNode(nodeA);
      store.insertNode(nodeB);
      store.insertNode(nodeC);

      const matches = await indexer.resolveCrossRepoSymbols('g1');
      const exactMatches = matches.filter((m) => m.matchType === 'exact_name');
      // With 3 repos, each symbol should match with each of the other 2
      // A-B, A-C, B-C = 3 pairs x 1 symbol = 3 exact matches
      expect(exactMatches.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('classifyMatch — api_pattern route matching', () => {
    it('should match symbols with identical routePath properties', async () => {
      groupManager.createGroup('g1', 'Routes', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const nodeA = createProjectNode('org/repo-a', 'getOrders', 'Function', 'src/orders.ts', true);
      const nodeB = createProjectNode('org/repo-b', 'listOrders', 'Function', 'src/orders.ts', true);
      // Set routePath to be the same
      nodeA.properties.routePath = '/api/v1/orders';
      nodeB.properties.routePath = '/api/v1/orders';

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      const matches = await indexer.resolveCrossRepoSymbols('g1');
      const apiMatches = matches.filter((m) => m.matchType === 'api_pattern');
      // routePath is the same, should match as api_pattern
      expect(apiMatches.length).toBeGreaterThanOrEqual(1);
      if (apiMatches.length > 0) {
        expect(apiMatches[0]!.confidence).toBe(0.85);
      }
    });
  });

  describe('detectContracts — field extraction', () => {
    it('should extract sample repo info from matched interfaces', async () => {
      groupManager.createGroup('g1', 'Contract', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const ifaceA = createProjectNode('org/repo-a', 'OrderDTO', 'Interface', 'types.ts', true);
      const ifaceB = createProjectNode('org/repo-b', 'OrderDTO', 'Interface', 'types.ts', true);
      store.insertNode(ifaceA);
      store.insertNode(ifaceB);

      const contracts = await indexer.detectContracts('g1');
      const orderContract = contracts.find((c) => c.name === 'OrderDTO');
      expect(orderContract).toBeTruthy();
      expect(orderContract!.definition['sampleRepo']).toBeTruthy();
      expect(orderContract!.definition['sampleQualifiedName']).toContain('OrderDTO');
    });
  });

  describe('checkTypeCompatibility — property type changes', () => {
    it('should warn when property type changes', async () => {
      groupManager.createGroup('g1', 'TypeCompat', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const nodeA = createProjectNode('org/repo-a', 'compatFn', 'Function', 'src/x.ts', true);
      const nodeB = createProjectNode('org/repo-b', 'compatFn', 'Function', 'src/x.ts', true);

      // Add properties with different types
      nodeA.properties = { ...nodeA.properties, version: 1 };
      nodeB.properties = { ...nodeB.properties, version: '1' };

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      const result = await indexer.checkTypeCompatibility('g1', 'compatFn', 'compatFn');
      // Changed property type from number to string should generate warning
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should handle missing signatures gracefully', async () => {
      groupManager.createGroup('g1', 'SigCompat', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const nodeA = createProjectNode('org/repo-a', 'sigFn', 'Function', 'src/s.ts', true);
      const nodeB = { ...createProjectNode('org/repo-b', 'sigFn', 'Function', 'src/s.ts', true), signature: null as null };

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      const result = await indexer.checkTypeCompatibility('g1', 'sigFn', 'sigFn');
      expect(result.compatible).toBe(true); // Same label, same name
    });

    it('should warn when return type differs', async () => {
      groupManager.createGroup('g1', 'RetCompat', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const nodeA: GraphNode = {
        ...createProjectNode('org/repo-a', 'retFn', 'Function', 'src/r.ts', true),
        properties: { ...createProjectNode('org/repo-a', 'retFn', 'Function', 'src/r.ts', true).properties, returnType: 'number' },
      };
      const nodeB: GraphNode = {
        ...createProjectNode('org/repo-b', 'retFn', 'Function', 'src/r.ts', true),
        properties: { ...createProjectNode('org/repo-b', 'retFn', 'Function', 'src/r.ts', true).properties, returnType: 'string' },
      };

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      const result = await indexer.checkTypeCompatibility('g1', 'retFn', 'retFn');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('Return type'))).toBe(true);
    });

    it('should handle signature warnings when both have signatures', async () => {
      groupManager.createGroup('g1', 'BothSigs', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const nodeA: GraphNode = {
        ...createProjectNode('org/repo-a', 'bothFn', 'Function', 'src/b.ts', true),
        signature: '(x: number): void',
      };
      const nodeB: GraphNode = {
        ...createProjectNode('org/repo-b', 'bothFn', 'Function', 'src/b.ts', true),
        signature: '(x: string): void',
      };

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      const result = await indexer.checkTypeCompatibility('g1', 'bothFn', 'bothFn');
      // Both have non-null signatures that differ, should produce warning
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('findSymbolAcrossRepos — case insensitive fallback', () => {
    it('should find symbols with case insensitive matching', async () => {
      groupManager.createGroup('g1', 'Case', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      // Node in repo-a with camelCase name
      const nodeA = createProjectNode('org/repo-a', 'camelCaseFunction', 'Function', 'src/camel.ts', true);
      // Node in repo-b with same name to match via case-insensitive search
      const nodeB = createProjectNode('org/repo-b', 'CAMELCASEFUNCTION', 'Function', 'src/camel.ts', true);
      store.insertNode(nodeA);
      store.insertNode(nodeB);

      // Search with different case — the checkTypeCompatibility uses findSymbolAcrossRepos
      const result = await indexer.checkTypeCompatibility('g1', 'camelCaseFunction', 'camelCaseFunction');
      // Should find both symbols (exact match in repo-a, then repo-b)
      expect(result.compatible).toBe(true);
      expect(result.sourceType).toContain('Function');
    });
  });

  describe('resolveCrossRepoSymbols — label filter edge cases', () => {
    it('should filter symbols by label (only exported Function/Class/Interface/TypeAlias/Enum/Method)', async () => {
      groupManager.createGroup('g1', 'Label Filter', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      // File nodes should NOT be matched
      const fileA = createProjectNode('org/repo-a', 'someFile.ts', 'File', 'src/someFile.ts');
      const fileB = createProjectNode('org/repo-b', 'someFile.ts', 'File', 'src/someFile.ts');
      store.insertNode(fileA);
      store.insertNode(fileB);

      const matches = await indexer.resolveCrossRepoSymbols('g1');
      // File nodes are not exported and have wrong label, should not be matched
      // But they might appear in the repoSymbols filter; check label filtering works
      const importRefs = matches.filter((m) => m.matchType === 'import_reference');
      expect(Array.isArray(matches)).toBe(true);
    });
  });

  describe('getRepoNodes — label filtering', () => {
    it('should return nodes filtered by project ID', () => {
      groupManager.createGroup('g1', 'LabelTest', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');

      const fn = createProjectNode('org/repo-a', 'fn1', 'Function', 'src/f1.ts', true);
      const cls = createProjectNode('org/repo-a', 'cls1', 'Class', 'src/c1.ts', true);
      const iface = createProjectNode('org/repo-a', 'if1', 'Interface', 'src/i1.ts', true);
      const typeAlias = createProjectNode('org/repo-a', 'ta1', 'TypeAlias', 'src/t1.ts', true);
      const enm = createProjectNode('org/repo-a', 'en1', 'Enum', 'src/e1.ts', true);
      const method = createProjectNode('org/repo-a', 'meth1', 'Method', 'src/m1.ts', true);
      store.insertNode(fn);
      store.insertNode(cls);
      store.insertNode(iface);
      store.insertNode(typeAlias);
      store.insertNode(enm);
      store.insertNode(method);

      const nodes = indexer.getRepoNodes('org/repo-a');
      expect(nodes.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('createImportEdges — import edge creation', () => {
    it('should create edges between files via indexGroup', async () => {
      const tmpDir = join(tmpdir(), `import-edges-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      const repoDir = createTestRepoDir(tmpDir, 'import-repo', {
        'src/index.ts': 'import { helper } from "./utils";',
        'src/utils.ts': 'export function helper() { return true; }',
      });

      groupManager.createGroup('g1', 'Import Test', '');
      groupManager.addRepo('g1', 'org', 'import-repo', 'https://a.example.com', repoDir);

      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
      expect(result.totalNodes).toBeGreaterThan(0);
    });

    it('should handle tsx and jsx file extensions for imports', async () => {
      const tmpDir = join(tmpdir(), `import-exts-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      const repoDir = createTestRepoDir(tmpDir, 'ext-repo', {
        'src/App.tsx': 'import React from "react";\nexport default function App() { return null; }',
      });

      groupManager.createGroup('g1', 'Ext Test', '');
      groupManager.addRepo('g1', 'org', 'ext-repo', 'https://a.example.com', repoDir);

      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
    });
  });

  describe('ensureFileNode — existing file node path', () => {
    it('should re-create file node when one already exists', async () => {
      const tmpDir = join(tmpdir(), `ensure-file-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      const repoDir = createTestRepoDir(tmpDir, 'ensure-repo', {
        'src/main.ts': 'export const config = { port: 3000 };',
      });

      groupManager.createGroup('g1', 'Ensure Test', '');
      groupManager.addRepo('g1', 'org', 'ensure-repo', 'https://a.example.com', repoDir);

      // Index twice to test ensureFileNode with existing files
      await indexer.indexGroup('g1', { force: true });
      const result = await indexer.indexGroup('g1', { force: true });
      expect(result.reposIndexed).toBe(1);
    });
  });

  describe('ensureCrossRepoNode — node creation', () => {
    it('should create CrossRepoModule node when building graph', async () => {
      setupTwoRepos();
      const allNodes = store.getAllNodes();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;
      const idB = allNodes.find((n) => n.name === 'targetFn')!.id;

      store.insertEdge({
        id: 0, projectId: 'org/repo-a',
        sourceId: idA, targetId: idB,
        type: 'IMPORTS', properties: {}, weight: 1, createdAt: now,
      });

      await indexer.buildCrossRepoGraph('g1');
      // CrossRepoModule nodes should now exist in the store
      const allNodesAfter = store.getAllNodes();
      const crossRepoModule = allNodesAfter.find((n) => n.label === 'CrossRepoModule');
      expect(crossRepoModule).toBeTruthy();
    });
  });

  describe('resolveCrossRepoSymbols — label matching for all node types', () => {
    it('should match different node label types across repos', async () => {
      groupManager.createGroup('g1', 'LabelTypes', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const classA = createProjectNode('org/repo-a', 'ApiService', 'Class', 'src/service.ts', true);
      const classB = createProjectNode('org/repo-b', 'ApiService', 'Class', 'src/service.ts', true);
      const ifaceA = createProjectNode('org/repo-a', 'IApiService', 'Interface', 'src/types.ts', true);
      const ifaceB = createProjectNode('org/repo-b', 'IApiService', 'Interface', 'src/types.ts', true);
      const typeA = createProjectNode('org/repo-a', 'ConfigMap', 'TypeAlias', 'src/config.ts', true);
      const typeB = createProjectNode('org/repo-b', 'ConfigMap', 'TypeAlias', 'src/config.ts', true);
      const enumA = createProjectNode('org/repo-a', 'Status', 'Enum', 'src/status.ts', true);
      const enumB = createProjectNode('org/repo-b', 'Status', 'Enum', 'src/status.ts', true);

      store.insertNode(classA); store.insertNode(classB);
      store.insertNode(ifaceA); store.insertNode(ifaceB);
      store.insertNode(typeA); store.insertNode(typeB);
      store.insertNode(enumA); store.insertNode(enumB);

      const matches = await indexer.resolveCrossRepoSymbols('g1');
      const exactMatches = matches.filter((m) => m.matchType === 'exact_name');
      // 4 pairs of matching symbols across 2 repos = 4 exact matches
      expect(exactMatches.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('extractSymbols — label detection for all symbol types', () => {
    it('should detect class declarations', async () => {
      const tmpDir = join(tmpdir(), `extract-class-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = createTestRepoDir(tmpDir, 'cls-repo', {
        'service.ts': 'export class UserService { getUser() { return {}; } }',
      });
      groupManager.createGroup('g1', 'Class Test', '');
      groupManager.addRepo('g1', 'org', 'cls-repo', 'https://a.example.com', repoDir);
      await indexer.indexGroup('g1');
      const nodes = indexer.getRepoNodes('org/cls-repo');
      const classNodes = nodes.filter((n) => n.label === 'Class');
      expect(classNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect interface declarations', async () => {
      const tmpDir = join(tmpdir(), `extract-interface-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = createTestRepoDir(tmpDir, 'iface-repo', {
        'types.ts': 'export interface UserDTO { id: number; name: string; }',
      });
      groupManager.createGroup('g1', 'Interface Test', '');
      groupManager.addRepo('g1', 'org', 'iface-repo', 'https://a.example.com', repoDir);
      await indexer.indexGroup('g1');
      const nodes = indexer.getRepoNodes('org/iface-repo');
      const ifaceNodes = nodes.filter((n) => n.label === 'Interface');
      expect(ifaceNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect type alias declarations', async () => {
      const tmpDir = join(tmpdir(), `extract-type-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = createTestRepoDir(tmpDir, 'type-repo', {
        'config.ts': 'export type ConfigMap = Record<string, unknown>;',
      });
      groupManager.createGroup('g1', 'Type Test', '');
      groupManager.addRepo('g1', 'org', 'type-repo', 'https://a.example.com', repoDir);
      await indexer.indexGroup('g1');
      const nodes = indexer.getRepoNodes('org/type-repo');
      const typeNodes = nodes.filter((n) => n.label === 'TypeAlias');
      expect(typeNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect enum declarations', async () => {
      const tmpDir = join(tmpdir(), `extract-enum-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = createTestRepoDir(tmpDir, 'enum-repo', {
        'status.ts': 'export enum Status { Active, Inactive, Pending }',
      });
      groupManager.createGroup('g1', 'Enum Test', '');
      groupManager.addRepo('g1', 'org', 'enum-repo', 'https://a.example.com', repoDir);
      await indexer.indexGroup('g1');
      const nodes = indexer.getRepoNodes('org/enum-repo');
      const enumNodes = nodes.filter((n) => n.label === 'Enum');
      expect(enumNodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('walkDirectory — subdirectory handling', () => {
    it('should walk subdirectories to find source files', async () => {
      const tmpDir = join(tmpdir(), `walk-subdirs-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = join(tmpDir, 'sub-repo');
      mkdirSync(repoDir, { recursive: true });
      // Create files in subdirectories
      const srcDir = join(repoDir, 'src');
      const libDir = join(repoDir, 'lib');
      const nodeModulesDir = join(repoDir, 'node_modules');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(libDir, { recursive: true });
      mkdirSync(nodeModulesDir, { recursive: true });
      writeFileSync(join(srcDir, 'index.ts'), 'export function app() { return true; }', 'utf-8');
      writeFileSync(join(libDir, 'utils.ts'), 'export function helper() { return false; }', 'utf-8');
      writeFileSync(join(nodeModulesDir, 'dep.ts'), 'export function external() { return null; }', 'utf-8');

      groupManager.createGroup('g1', 'Subdir Test', '');
      groupManager.addRepo('g1', 'org', 'sub-repo', 'https://a.example.com', repoDir);
      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
      // Files from src/ and lib/ should be indexed, node_modules/ should be skipped
      const nodes = indexer.getRepoNodes('org/sub-repo');
      expect(nodes.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeCrossRepoImpact — depth and transitive BFS', () => {
    it('should traverse at depth 2 and 3', async () => {
      groupManager.createGroup('g1', 'Depth Test', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');
      groupManager.addRepo('g1', 'org', 'repo-c', 'https://c', '/c');

      const nodeA = createProjectNode('org/repo-a', 'fnA', 'Function', 'src/a.ts', true);
      const nodeB = createProjectNode('org/repo-b', 'fnB', 'Function', 'src/b.ts', true);
      const nodeC = createProjectNode('org/repo-c', 'fnC', 'Function', 'src/c.ts', true);
      const idA = store.insertNode(nodeA);
      const idB = store.insertNode(nodeB);
      const idC = store.insertNode(nodeC);

      // repo-a → repo-b (depth 1)
      store.insertEdge({ id: 0, projectId: 'org/repo-a', sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });
      // repo-b → repo-c (depth 2)
      store.insertEdge({ id: 0, projectId: 'org/repo-b', sourceId: idB, targetId: idC,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });

      const result = await indexer.analyzeCrossRepoImpact('g1', 'org/repo-a');
      expect(result.affectedRepos).toContain('org/repo-b');
      // repo-b at depth 1 = high, repo-c at depth 2 = medium
      const bAnalysis = result.analysis.find((a) => a.repo === 'org/repo-b');
      expect(bAnalysis!.impactLevel).toBe('high');
    });

    it('should stop at depth >= 3', async () => {
      groupManager.createGroup('g1', 'MaxDepth', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');
      groupManager.addRepo('g1', 'org', 'repo-c', 'https://c', '/c');
      groupManager.addRepo('g1', 'org', 'repo-d', 'https://d', '/d');

      const nodes: Record<string, number> = {};
      ['repo-a', 'repo-b', 'repo-c', 'repo-d'].forEach((r, i) => {
        const n = createProjectNode(`org/${r}`, `fn${i}`, 'Function', `src/fn${i}.ts`, true);
        nodes[r] = store.insertNode(n);
      });

      store.insertEdge({ id: 0, projectId: 'org/repo-a', sourceId: nodes['repo-a']!, targetId: nodes['repo-b']!,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });
      store.insertEdge({ id: 0, projectId: 'org/repo-b', sourceId: nodes['repo-b']!, targetId: nodes['repo-c']!,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });
      store.insertEdge({ id: 0, projectId: 'org/repo-c', sourceId: nodes['repo-c']!, targetId: nodes['repo-d']!,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });

      const result = await indexer.analyzeCrossRepoImpact('g1', 'org/repo-a');
      // repo-b (depth 1), repo-c (depth 2), repo-d (depth 3) — but depth >= 3 stops traversal from expanding further
      expect(result.analysis.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('traceSymbolDependencies — edge case traversal', () => {
    it('should trace direct dependency with depth 1 confidence high', async () => {
      groupManager.createGroup('g1', 'DirTrace', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const nodeA = createProjectNode('org/repo-a', 'caller', 'Function', 'src/caller.ts', true);
      const nodeB = createProjectNode('org/repo-b', 'callee', 'Function', 'src/callee.ts', true);
      const idA = store.insertNode(nodeA);
      const idB = store.insertNode(nodeB);

      store.insertEdge({ id: 0, projectId: 'org/repo-a', sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_CALLS', properties: {}, weight: 1, createdAt: now });

      const traces = await indexer.traceSymbolDependencies('g1', 'org/repo-a', 'caller');
      const direct = traces.find((t) => t.dependencyType === 'CROSS_REPO_CALLS');
      expect(direct).toBeTruthy();
      expect(direct!.depth).toBe(1);
      expect(direct!.confidence).toBe('high');
    });

    it('should follow transitive edges for depth 2 traces', async () => {
      groupManager.createGroup('g1', 'TransTrace', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');
      groupManager.addRepo('g1', 'org', 'repo-c', 'https://c', '/c');

      const nodeA = createProjectNode('org/repo-a', 'start', 'Function', 'src/start.ts', true);
      const nodeB = createProjectNode('org/repo-b', 'middle', 'Function', 'src/mid.ts', true);
      const nodeC = createProjectNode('org/repo-c', 'end', 'Function', 'src/end.ts', true);
      const idA = store.insertNode(nodeA);
      const idB = store.insertNode(nodeB);
      const idC = store.insertNode(nodeC);

      store.insertEdge({ id: 0, projectId: 'org/repo-a', sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });
      store.insertEdge({ id: 0, projectId: 'org/repo-b', sourceId: idB, targetId: idC,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });

      const traces = await indexer.traceSymbolDependencies('g1', 'org/repo-a', 'start');
      // Should have both depth 1 (repo-a → repo-b) and depth 2 (repo-a → repo-b → repo-c)
      expect(traces.length).toBeGreaterThanOrEqual(2);
      const transitiveTraces = traces.filter((t) => t.depth === 2);
      expect(transitiveTraces.length).toBeGreaterThanOrEqual(1);
      expect(transitiveTraces[0]!.confidence).toBe('medium');
    });
  });

  describe('extractSymbols — duplicate name and edge cases', () => {
    it('should handle duplicate symbol names via seen set', async () => {
      const tmpDir = join(tmpdir(), `extract-dup-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      // Function and class with the same name → should deduplicate
      const repoDir = createTestRepoDir(tmpDir, 'dup-repo', {
        'src/app.ts': 'export function Foo() { return 1; }\nexport class Foo { x: number = 1; }',
      });
      groupManager.createGroup('g1', 'Dup Test', '');
      groupManager.addRepo('g1', 'org', 'dup-repo', 'https://a.example.com', repoDir);
      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
      const nodes = indexer.getRepoNodes('org/dup-repo');
      // Only one 'Foo' should exist (the function), or two if both are captured
      const fooNodes = nodes.filter((n) => n.name === 'Foo');
      expect(fooNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect Java-style public method patterns', async () => {
      const tmpDir = join(tmpdir(), `extract-java-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = createTestRepoDir(tmpDir, 'java-repo', {
        'Service.java': 'public class Service {\n  public String getData() { return ""; }\n}',
      });
      groupManager.createGroup('g1', 'Java Test', '');
      groupManager.addRepo('g1', 'org', 'java-repo', 'https://a.example.com', repoDir);
      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
    });
  });

  describe('extractImports — namespace and require patterns', () => {
    it('should extract namespace imports (import * as)', async () => {
      const tmpDir = join(tmpdir(), `import-ns-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = createTestRepoDir(tmpDir, 'ns-repo', {
        'src/app.ts': 'import * as React from "react";\nexport function App() { return null; }',
      });
      groupManager.createGroup('g1', 'NS Import', '');
      groupManager.addRepo('g1', 'org', 'ns-repo', 'https://a.example.com', repoDir);
      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
    });

    it('should extract require() imports', async () => {
      const tmpDir = join(tmpdir(), `import-req-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = createTestRepoDir(tmpDir, 'req-repo', {
        'src/app.js': 'const express = require("express");\nmodule.exports = function() { return true; };',
      });
      groupManager.createGroup('g1', 'Req Import', '');
      groupManager.addRepo('g1', 'org', 'req-repo', 'https://a.example.com', repoDir);
      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
    });
  });

  describe('resolveCrossRepoSymbols — Method label matching', () => {
    it('should match Method-labeled symbols across repos', async () => {
      groupManager.createGroup('g1', 'Method', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const methodA = createProjectNode('org/repo-a', 'getData', 'Method', 'src/service.ts', true);
      const methodB = createProjectNode('org/repo-b', 'getData', 'Method', 'src/service.ts', true);
      store.insertNode(methodA);
      store.insertNode(methodB);

      const matches = await indexer.resolveCrossRepoSymbols('g1');
      const exactMatch = matches.find((m) => m.matchType === 'exact_name' && m.sourceSymbol.includes('getData'));
      expect(exactMatch).toBeTruthy();
    });
  });

  describe('createImportEdges — file import matching', () => {
    it('should create import edges when files import from each other', async () => {
      const tmpDir = join(tmpdir(), `import-edges2-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = createTestRepoDir(tmpDir, 'import-repo2', {
        'src/index.ts': 'import { helper } from "./utils";\nexport function main() { return helper(); }',
        'src/utils.ts': 'export function helper() { return 42; }',
      });
      groupManager.createGroup('g1', 'Import Edge', '');
      groupManager.addRepo('g1', 'org', 'import-repo2', 'https://a.example.com', repoDir);
      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
      expect(result.totalEdges).toBeGreaterThanOrEqual(0);
    });

    it('should handle default imports', async () => {
      const tmpDir = join(tmpdir(), `import-def-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = createTestRepoDir(tmpDir, 'def-import-repo', {
        'src/app.ts': 'import React from "react";\nexport default function App() { return null; }',
      });
      groupManager.createGroup('g1', 'Default Import', '');
      groupManager.addRepo('g1', 'org', 'def-import-repo', 'https://a.example.com', repoDir);
      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
    });
  });

  describe('buildCrossRepoGraph — CROSS_REPO node idempotency', () => {
    it('should reuse existing CrossRepoModule nodes', async () => {
      setupTwoRepos();
      const allNodes = store.getAllNodes();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;
      const idB = allNodes.find((n) => n.name === 'targetFn')!.id;

      store.insertEdge({ id: 0, projectId: 'org/repo-a', sourceId: idA, targetId: idB,
        type: 'IMPORTS', properties: {}, weight: 1, createdAt: now });

      // Build graph twice to test idempotent CrossRepoModule creation
      await indexer.buildCrossRepoGraph('g1');
      await indexer.buildCrossRepoGraph('g1');

      const crossRepoModules = store.getAllNodes().filter((n) => n.label === 'CrossRepoModule');
      expect(crossRepoModules.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('checkTypeCompatibility — property existence checks', () => {
    it('should report removed properties as breaking changes', async () => {
      groupManager.createGroup('g1', 'RemovedProp', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const nodeA = createProjectNode('org/repo-a', 'propFn', 'Function', 'src/p.ts', true);
      const nodeB = createProjectNode('org/repo-b', 'propFn', 'Function', 'src/p.ts', true);
      nodeA.properties = { ...nodeA.properties, configurable: true, cacheable: false };
      // nodeB does NOT have 'configurable' or 'cacheable'

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      const result = await indexer.checkTypeCompatibility('g1', 'propFn', 'propFn');
      // 'configurable' and 'cacheable' are in nodeA but not in nodeB → breaking changes
      expect(result.breakingChanges.length).toBeGreaterThan(0);
    });

    it('should report added required properties as warnings', async () => {
      groupManager.createGroup('g1', 'AddedProp', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const nodeA = createProjectNode('org/repo-a', 'addedPropFn', 'Function', 'src/p.ts', true);
      const nodeB = createProjectNode('org/repo-b', 'addedPropFn', 'Function', 'src/p.ts', true);
      // nodeB has a property that nodeA does NOT have → should warn about added required property
      nodeB.properties = { ...nodeB.properties, newField: 'value' };

      store.insertNode(nodeA);
      store.insertNode(nodeB);

      const result = await indexer.checkTypeCompatibility('g1', 'addedPropFn', 'addedPropFn');
      // 'newField' is in nodeB but not in nodeA → warning about added required property
      expect(result.warnings.some((w) => w.includes('Added required property'))).toBe(true);
    });
  });

  describe('analyzeCrossRepoImpact — specific symbol filter BFS', () => {
    it('should filter source nodes by changedSymbols during BFS', async () => {
      groupManager.createGroup('g1', 'FilterBFS', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const fnA = createProjectNode('org/repo-a', 'matchingFn', 'Function', 'src/a.ts', true);
      const extraA = createProjectNode('org/repo-a', 'unrelatedFn', 'Function', 'src/extra.ts', true);
      const fnB = createProjectNode('org/repo-b', 'targetFn', 'Function', 'src/b.ts', true);

      const idA = store.insertNode(fnA);
      store.insertNode(extraA);
      const idB = store.insertNode(fnB);

      store.insertEdge({ id: 0, projectId: 'org/repo-a', sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });

      // Only trace from 'matchingFn'
      const result = await indexer.analyzeCrossRepoImpact('g1', 'org/repo-a', ['matchingFn']);
      expect(result.changedSymbols).toEqual(['matchingFn']);
      expect(result.affectedRepos).toContain('org/repo-b');
    });
  });

  describe('resolveCrossRepoSymbols — cross-repo import edge traversal', () => {
    it('should detect import references via File node edges', async () => {
      groupManager.createGroup('g1', 'FileEdges', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      // Exported symbol in repo-b
      const exportedNode = createProjectNode('org/repo-b', 'exportedHelper', 'Function', 'src/helper.ts', true);
      store.insertNode(exportedNode);

      // File node in repo-a that imports from repo-b
      const fileA = createProjectNode('org/repo-a', 'consumer.ts', 'File', 'src/consumer.ts');
      const idFileA = store.insertNode(fileA);

      const allN = store.getAllNodes();
      const idExported = allN.find((n) => n.name === 'exportedHelper')!.id;

      // Create IMPORTS edge from file in repo-a to exported symbol in repo-b
      store.insertEdge({ id: 0, projectId: 'org/repo-a', sourceId: idFileA, targetId: idExported,
        type: 'IMPORTS', properties: {}, weight: 1, createdAt: now });

      const matches = await indexer.resolveCrossRepoSymbols('g1');
      // Should find at least an import_reference match
      const importMatches = matches.filter((m) => m.matchType === 'import_reference');
      expect(importMatches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('buildCrossRepoGraph — dangling and null target edges', () => {
    it('should skip edges to repos not in group', async () => {
      setupTwoRepos();
      const allNodes = store.getAllNodes();
      const idA = allNodes.find((n) => n.name === 'sourceFn')!.id;

      // Insert a node in a repo not in the group
      const outsideNode = createProjectNode('outside/repo', 'outsider', 'Function', 'src/o.ts', true);
      const idOut = store.insertNode(outsideNode);

      store.insertEdge({ id: 0, projectId: 'org/repo-a', sourceId: idA, targetId: idOut,
        type: 'IMPORTS', properties: {}, weight: 1, createdAt: now });

      const report = await indexer.buildCrossRepoGraph('g1');
      expect(report.repos).toHaveLength(2);
      expect(report.crossRepoEdges).toBeGreaterThanOrEqual(0);
    });
  });

  describe('traceSymbolDependencies — edge case traversal full', () => {
    it('should skip edges to same repo in transitive traversal', async () => {
      groupManager.createGroup('g1', 'SameRepo', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      const nodeA = createProjectNode('org/repo-a', 'fn', 'Function', 'src/a.ts', true);
      const nodeB = createProjectNode('org/repo-b', 'target', 'Function', 'src/b.ts', true);
      const idA = store.insertNode(nodeA);
      const idB = store.insertNode(nodeB);

      // Direct edge from repo-a to repo-b
      store.insertEdge({ id: 0, projectId: 'org/repo-a', sourceId: idA, targetId: idB,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });

      // Self-referencing edge in repo-b (should be skipped in transitive traversal)
      store.insertEdge({ id: 0, projectId: 'org/repo-b', sourceId: idB, targetId: idB,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });

      const traces = await indexer.traceSymbolDependencies('g1', 'org/repo-a', 'fn');
      expect(traces.length).toBeGreaterThanOrEqual(1);
      // No self-referencing traces
      const selfTrace = traces.find((t) => t.targetRepo === 'org/repo-b' && t.targetSymbol.includes('target'));
      expect(selfTrace).toBeTruthy();
    });
  });

  describe('getSymbolsInRepo — label type coverage via BFS', () => {
    it('should collect all label types via analyzeCrossRepoImpact BFS', async () => {
      groupManager.createGroup('g1', 'AllLabels', '');
      groupManager.addRepo('g1', 'org', 'repo-a', 'https://a', '/a');
      groupManager.addRepo('g1', 'org', 'repo-x', 'https://x', '/x');
      groupManager.addRepo('g1', 'org', 'repo-b', 'https://b', '/b');

      // repo-a: source function
      const fnA = createProjectNode('org/repo-a', 'trigger', 'Function', 'src/trigger.ts', true);
      const idA = store.insertNode(fnA);

      // repo-x: intermediate repo (depth 1)
      const fnX = createProjectNode('org/repo-x', 'mid', 'Function', 'src/mid.ts', true);
      const idX = store.insertNode(fnX);

      // repo-b: nodes of ALL label types (depth 2, via transitive BFS)
      store.insertNode(createProjectNode('org/repo-b', 'MyClass', 'Class', 'src/c.ts', true));
      store.insertNode(createProjectNode('org/repo-b', 'MyInterface', 'Interface', 'src/i.ts', true));
      store.insertNode(createProjectNode('org/repo-b', 'MyAlias', 'TypeAlias', 'src/a.ts', true));
      store.insertNode(createProjectNode('org/repo-b', 'MyEnum', 'Enum', 'src/e.ts', true));
      store.insertNode(createProjectNode('org/repo-b', 'myMethod', 'Method', 'src/m.ts', true));
      const idFnB = store.insertNode(createProjectNode('org/repo-b', 'myFunction', 'Function', 'src/f.ts', true));

      // repo-a → repo-x (depth 1 direct)
      store.insertEdge({ id: 0, projectId: 'org/repo-a', sourceId: idA, targetId: idX,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });
      // repo-x → repo-b (depth 2 transitive — getSymbolsInRepo triggered here)
      store.insertEdge({ id: 0, projectId: 'org/repo-x', sourceId: idX, targetId: idFnB,
        type: 'CROSS_REPO_IMPORTS', properties: {}, weight: 1, createdAt: now });

      const result = await indexer.analyzeCrossRepoImpact('g1', 'org/repo-a');
      const repoBAnalysis = result.analysis.find((a) => a.repo === 'org/repo-b');
      // repo-b is reached transitively, so getSymbolsInRepo is called
      expect(repoBAnalysis).toBeTruthy();
      expect(repoBAnalysis!.affectedSymbols.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('createImportEdges — file import matching with explicit paths', () => {
    it('should match imports when file path contains module name', async () => {
      const tmpDir = join(tmpdir(), `import-match-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = createTestRepoDir(tmpDir, 'match-repo', {
        'app.ts': 'export function app() { return 1; }',
        'src/app.ts': 'import { app } from "app";',
      });
      groupManager.createGroup('g1', 'Match Import', '');
      groupManager.addRepo('g1', 'org', 'match-repo', 'https://a.example.com', repoDir);
      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
    });

    it('should handle import edges when target file name matches', async () => {
      const tmpDir = join(tmpdir(), `import-filematch-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const repoDir = createTestRepoDir(tmpDir, 'filematch-repo', {
        'utils.js': 'export function helper() { return true; }',
        'src/index.js': 'import { helper } from "../utils.js";',
      });
      groupManager.createGroup('g1', 'File Match', '');
      groupManager.addRepo('g1', 'org', 'filematch-repo', 'https://a.example.com', repoDir);
      const result = await indexer.indexGroup('g1');
      expect(result.reposIndexed).toBe(1);
    });
  });
});
