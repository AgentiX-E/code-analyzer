// @code-analyzer/intelligence — Repo Group Manager
// Manages groups of related repositories for cross-repo analysis.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { RepoGroup, GroupRepo } from '@code-analyzer/shared';

/**
 * Manages groups of related repositories.
 * Supports adding/removing repos from groups, creating/deleting groups,
 * and persisting group configurations to JSON files.
 */
export class RepoGroupManager {
  private groups: Map<string, RepoGroup>;

  constructor() {
    this.groups = new Map();
  }

  /**
   * Create a new repo group.
   * @throws If the group ID already exists.
   */
  createGroup(id: string, name: string, description: string): RepoGroup {
    if (!id || !name) {
      throw new Error('Group id and name are required');
    }
    if (this.groups.has(id)) {
      throw new Error(`Group "${id}" already exists`);
    }

    const group: RepoGroup = {
      id,
      name,
      description,
      repos: [],
      contracts: [],
      indexedAt: null,
    };

    this.groups.set(id, group);
    return this.cloneGroup(group);
  }

  /**
   * Delete a repo group by ID.
   * @throws If the group does not exist.
   */
  deleteGroup(id: string): void {
    if (!this.groups.has(id)) {
      throw new Error(`Group "${id}" not found`);
    }
    this.groups.delete(id);
  }

  /**
   * Add a repository to a group.
   * @throws If the group does not exist or the repo name is already registered.
   */
  addRepo(
    groupId: string,
    owner: string,
    name: string,
    _url: string,
    localPath: string,
  ): void {
    const group = this.getGroupInternal(groupId);

    const fullName = `${owner}/${name}`;
    if (group.repos.some((r) => r.fullName === fullName)) {
      throw new Error(`Repo "${fullName}" already exists in group "${groupId}"`);
    }

    const repo: GroupRepo = {
      owner,
      repo: name,
      fullName,
      localPath,
      projectId: null,
      role: 'dependency',
      autoIndex: true,
    };

    group.repos.push(repo);
  }

  /**
   * Remove a repository from a group by repo fullName.
   * @throws If the group does not exist.
   */
  removeRepo(groupId: string, repoId: string): void {
    const group = this.getGroupInternal(groupId);

    const index = group.repos.findIndex((r) => r.fullName === repoId);
    if (index === -1) {
      throw new Error(`Repo "${repoId}" not found in group "${groupId}"`);
    }

    group.repos.splice(index, 1);
  }

  /**
   * Get all repositories in a group.
   * @returns A shallow copy of the repos array.
   */
  getRepos(groupId: string): GroupRepo[] {
    const group = this.getGroupInternal(groupId);
    return [...group.repos];
  }

  /**
   * List all registered groups.
   */
  listGroups(): RepoGroup[] {
    return Array.from(this.groups.values()).map((g) => this.cloneGroup(g));
  }

  /**
   * Get a group by ID.
   */
  getGroup(id: string): RepoGroup | null {
    const group = this.groups.get(id);
    if (!group) return null;
    return this.cloneGroup(group);
  }

  /**
   * Save all groups configuration to a JSON file.
   */
  saveConfig(filePath: string): void {
    /* v8 ignore next 3 */
    const data = this.listGroups();
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Load groups configuration from a JSON file.
   * Replaces all current groups.
   */
  loadConfig(filePath: string): void {
    /* v8 ignore start */
    if (!existsSync(filePath)) {
      throw new Error(`Config file not found: ${filePath}`);
    }

    const raw = readFileSync(filePath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON in config file: ${filePath}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`Config file must contain an array of repo groups`);
    }

    this.groups.clear();

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const g = item as Record<string, unknown>;

      const id = typeof g['id'] === 'string' ? g['id'] : '';
      const name = typeof g['name'] === 'string' ? g['name'] : '';
      const description = typeof g['description'] === 'string' ? g['description'] : '';
      const repos = Array.isArray(g['repos']) ? g['repos'] : [];
      const contracts = Array.isArray(g['contracts']) ? g['contracts'] : [];
      const indexedAt = typeof g['indexedAt'] === 'string'
        ? g['indexedAt']
        : g['indexedAt'] === null
          ? null
          : null;

      const group: RepoGroup = {
        id,
        name,
        description,
        repos: repos.map((r: Record<string, unknown>): GroupRepo => ({
          owner: typeof r['owner'] === 'string' ? r['owner'] : '',
          repo: typeof r['repo'] === 'string' ? r['repo'] : '',
          fullName: typeof r['fullName'] === 'string' ? r['fullName'] : `${r['owner'] || ''}/${r['repo'] || ''}`,
          localPath: typeof r['localPath'] === 'string' ? r['localPath'] : '',
          projectId: typeof r['projectId'] === 'string' ? r['projectId'] : r['projectId'] === null ? null : null,
          role: (r['role'] === 'primary' || r['role'] === 'dependency' || r['role'] === 'consumer')
            ? r['role']
            : 'dependency',
          autoIndex: r['autoIndex'] !== false,
        })),
        contracts: contracts.map((c: Record<string, unknown>) => ({
          id: typeof c['id'] === 'string' ? c['id'] : '',
          name: typeof c['name'] === 'string' ? c['name'] : '',
          description: typeof c['description'] === 'string' ? c['description'] : '',
          uri: typeof c['uri'] === 'string' ? c['uri'] : '',
          version: typeof c['version'] === 'string' ? c['version'] : '0.0.0',
          definition:
            typeof c['definition'] === 'object' && c['definition'] !== null
              ? c['definition'] as Record<string, unknown>
              : {},
          dependencies: Array.isArray(c['dependencies'])
            ? c['dependencies'].map(String)
            : [],
        })),
        indexedAt,
      };

      this.groups.set(id, group);
    }
    /* v8 ignore stop */
  }

  /**
   * Check if a group exists.
   */
  hasGroup(id: string): boolean {
    return this.groups.has(id);
  }

  /**
   * Update a repo's projectId after indexing.
   */
  setRepoProjectId(groupId: string, repoSenderName: string, projectId: string): void {
    const group = this.getGroupInternal(groupId);
    const repo = group.repos.find((r) => r.fullName === repoSenderName);
    if (!repo) {
      throw new Error(`Repo "${repoSenderName}" not found in group "${groupId}"`);
    }
    repo.projectId = projectId;
  }

  /**
   * Mark a group as indexed.
   */
  markIndexed(groupId: string): void {
    const group = this.getGroupInternal(groupId);
    group.indexedAt = new Date().toISOString();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getGroupInternal(id: string): RepoGroup {
    const group = this.groups.get(id);
    if (!group) {
      throw new Error(`Group "${id}" not found`);
    }
    return group;
  }

  private cloneGroup(group: RepoGroup): RepoGroup {
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      repos: group.repos.map((r) => ({ ...r })),
      contracts: group.contracts.map((c) => ({
        ...c,
        definition: { ...c.definition },
        dependencies: [...c.dependencies],
      })),
      indexedAt: group.indexedAt,
    };
  }
}
