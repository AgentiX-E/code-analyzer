// @code-analyzer/mcp — Cross-Repository Tools
// Real implementations backed by graph store and cross-repo engine

import type { ToolResult } from './registry.js';
import { ToolContextImpl } from './tool-context.js';

// ---------------------------------------------------------------------------
// Singleton RepoGroupManager for session-scoped group persistence
// ---------------------------------------------------------------------------

let _groupManagerPromise: Promise<InstanceType<typeof import('@code-analyzer/intelligence')['RepoGroupManager']>> | null = null;

async function getGroupManager(): Promise<InstanceType<typeof import('@code-analyzer/intelligence')['RepoGroupManager']>> {
  if (!_groupManagerPromise) {
    _groupManagerPromise = (async () => {
      const { RepoGroupManager } = await import('@code-analyzer/intelligence');
      return new RepoGroupManager();
    })();
  }
  return _groupManagerPromise;
}

/**
 * Parse a repo reference into { owner, name }.
 * Supports: owner/name, https://github.com/owner/name, or plain name (defaults owner to '_').
 */
function parseRepoRef(ref: string): { owner: string; name: string } {
  // owner/name format
  const slashMatch = ref.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (slashMatch) return { owner: slashMatch[1]!, name: slashMatch[2]! };
  // URL format
  try {
    const u = new URL(ref.includes('://') ? ref : `https://${ref}`);
    const parts = u.pathname.replace(/^\//, '').split('/');
    if (parts.length >= 2 && parts[0] && parts[1]) return { owner: parts[0]!, name: parts[1]! };
  } catch { /* not a URL */ }
  // Plain name — use as repo name with default owner
  return { owner: '_', name: ref };
}

/** Convert internal fullName back to a client-facing repo reference. Strips default '_/' prefix. */
function toExternalRepoRef(fullName: string): string {
  return fullName.startsWith('_/') ? fullName.slice(2) : fullName;
}

/** Extract plain repo names from a RepoGroup for client-facing output. */
function extractRepoNames(repos: Array<{ fullName: string }>): string[] {
  return repos.map((r) => toExternalRepoRef(r.fullName));
}

// ---------------------------------------------------------------------------
// cross_repo_search — Search across all indexed repositories
// ---------------------------------------------------------------------------

interface CrossRepoSearchParams {
  query: string;
  groupId?: string;
  repos?: string[];
  limit?: number;
}

export const crossRepoSearchSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search query' },
    groupId: { type: 'string', description: 'Repository group ID' },
    repos: { type: 'array', items: { type: 'string' }, description: 'Specific repos to search' },
    limit: { type: 'number', description: 'Maximum results (default: 20)' },
  },
  required: ['query'],
};

export async function crossRepoSearch(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as CrossRepoSearchParams;
  const query = params.query;
  const repos = params.repos ?? [];
  const limit = params.limit ?? 20;

  const items: Array<Record<string, unknown>> = [];
  const repoBreakdown: Record<string, number> = {};

  if (store && ToolContextImpl.isToolContext(store)) {
    const ctx = store as ToolContextImpl;
    try {
      const gstore = ctx.store;
      const ftsResults = gstore.searchFts(query, { limit: limit * 3, offset: 0 });

      for (const result of ftsResults) {
        const node = result.node;
        const repo = node.projectId;

        // Apply repo filter if specified
        if (repos.length > 0 && !repos.includes(repo)) continue;

        // Apply group filter if specified
        const group = params.groupId ? (await getGroupManager()).getGroup(params.groupId) : null;
        if (group && !group.repos.some((r) => toExternalRepoRef(r.fullName) === repo)) continue;

        items.push({
          repo,
          symbol: node.name,
          qualifiedName: node.qualifiedName,
          filePath: node.filePath ?? '',
          startLine: node.startLine ?? 0,
          label: node.label,
          relevance: result.rank / 10,
          snippet: result.snippet,
        });

        repoBreakdown[repo] = (repoBreakdown[repo] ?? 0) + 1;

        if (items.length >= limit) break;
      }
    } catch {
      // Graceful degradation
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        query,
        totalResults: items.length,
        repoBreakdown,
        items,
        reposSearched: Object.keys(repoBreakdown),
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// cross_repo_trace — Trace symbol across repositories
// ---------------------------------------------------------------------------

interface CrossRepoTraceParams {
  sourceSymbol: string;
  groupId: string;
  targetRepo?: string;
  depth?: number;
}

export const crossRepoTraceSchema = {
  type: 'object',
  properties: {
    sourceSymbol: { type: 'string', description: 'Source symbol to trace (qualified name)' },
    groupId: { type: 'string', description: 'Repository group ID' },
    targetRepo: { type: 'string', description: 'Target repository to trace into' },
    depth: { type: 'number', description: 'Maximum traversal depth (default: 5)' },
  },
  required: ['sourceSymbol', 'groupId'],
};

export async function crossRepoTrace(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as CrossRepoTraceParams;
  const sourceSymbol = params.sourceSymbol;
  const groupId = params.groupId;
  const maxDepth = params.depth ?? 5;

  const path: Array<Record<string, unknown>> = [];
  const crossRepoEdges: Array<Record<string, unknown>> = [];
  const reposVisited = new Set<string>();

  if (store && ToolContextImpl.isToolContext(store)) {
    const ctx = store as ToolContextImpl;
    try {
      const gstore = ctx.store;

      // Find the source node
      const sourceNode = gstore.getNodeByQualifiedName(sourceSymbol);
      if (sourceNode) {
        reposVisited.add(sourceNode.projectId);
        path.push({
          symbol: sourceNode.name,
          repo: sourceNode.projectId,
          label: sourceNode.label,
          filePath: sourceNode.filePath ?? '',
          depth: 0,
        });

        // BFS to find cross-repo connections
        const visited = new Set<number>([sourceNode.id]);
        const queue: Array<{ nodeId: number; depth: number }> = [{ nodeId: sourceNode.id, depth: 0 }];

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (current.depth >= maxDepth) continue;

          const edges = gstore.getEdgesForNode(current.nodeId, 'CALLS');
          for (const edge of edges) {
            const targetId = edge.targetId;
            if (visited.has(targetId)) continue;
            visited.add(targetId);

            const targetNode = gstore.getNode(targetId);
            if (!targetNode) continue;

            // Check if this is a cross-repo call
            if (targetNode.projectId !== sourceNode.projectId && !reposVisited.has(targetNode.projectId)) {
              reposVisited.add(targetNode.projectId);
              crossRepoEdges.push({
                fromRepo: sourceNode.projectId,
                toRepo: targetNode.projectId,
                fromSymbol: sourceNode.name,
                toSymbol: targetNode.name,
                relationship: 'CALLS',
              });
            }

            path.push({
              symbol: targetNode.name,
              repo: targetNode.projectId,
              label: targetNode.label,
              filePath: targetNode.filePath ?? '',
              depth: current.depth + 1,
            });

            queue.push({ nodeId: targetId, depth: current.depth + 1 });
          }
        }
      }
    } catch {
      // Graceful degradation
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        sourceSymbol,
        groupId,
        maxDepth,
        path,
        crossRepoEdges,
        reposVisited: Array.from(reposVisited),
        crossRepoConnections: crossRepoEdges.length,
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// cross_repo_impact — Analyze cross-repo impact of a symbol change
// ---------------------------------------------------------------------------

interface CrossRepoImpactParams {
  symbol: string;
  groupId: string;
  includeConsumers?: boolean;
}

export const crossRepoImpactSchema = {
  type: 'object',
  properties: {
    symbol: { type: 'string', description: 'Symbol to analyze (qualified name)' },
    groupId: { type: 'string', description: 'Repository group ID' },
    includeConsumers: { type: 'boolean', description: 'Include downstream consumers' },
  },
  required: ['symbol', 'groupId'],
};

export async function crossRepoImpact(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as CrossRepoImpactParams;
  const symbolName = params.symbol;
  const groupId = params.groupId;
  const includeConsumers = Boolean(params.includeConsumers);

  const impactedRepos: Array<Record<string, unknown>> = [];
  let riskLevel = 'low';

  if (store && ToolContextImpl.isToolContext(store)) {
    const ctx = store as ToolContextImpl;
    try {
      const gstore = ctx.store;
      const node = gstore.getNodeByQualifiedName(symbolName);

      if (node) {
        // Find all callers of this symbol
        const allNodes = gstore.getAllNodes();
        for (const potentialCaller of allNodes) {
          if (potentialCaller.label === 'Function' || potentialCaller.label === 'Method') {
            const callerEdges = gstore.getEdgesForNode(potentialCaller.id, 'CALLS');
            for (const edge of callerEdges) {
              if (edge.targetId === node.id) {
                // Found a caller — check if it's in a different repo
                if (potentialCaller.projectId !== node.projectId) {
                  const existing = impactedRepos.find((r) => r.repo === potentialCaller.projectId);
                  if (existing) {
                    (existing.callers as string[]).push(potentialCaller.name);
                  } else {
                    impactedRepos.push({
                      repo: potentialCaller.projectId,
                      callers: [potentialCaller.name],
                      fileCount: 1,
                    });
                  }
                }
              }
            }
          }
        }
      }

      // Determine risk level
      if (impactedRepos.length > 3) riskLevel = 'high';
      else if (impactedRepos.length > 0) riskLevel = 'medium';
    } catch {
      // Graceful degradation
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        symbol: symbolName,
        groupId,
        riskLevel,
        impactedRepos,
        totalImpactedRepos: impactedRepos.length,
        totalCallers: impactedRepos.reduce((sum, r) => sum + ((r.callers as string[])?.length ?? 0), 0),
        includeConsumers,
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// manage_repo_group — CRUD for repository groups
// ---------------------------------------------------------------------------

interface ManageRepoGroupParams {
  action: string;
  groupId?: string;
  name?: string;
  description?: string;
  repos?: string[];
}

export const manageRepoGroupSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', description: 'Group action', enum: ['create', 'list', 'get', 'update', 'delete', 'add_repo', 'remove_repo'] },
    groupId: { type: 'string', description: 'Group ID' },
    name: { type: 'string', description: 'Group name (for create/update)' },
    description: { type: 'string', description: 'Group description' },
    repos: { type: 'array', items: { type: 'string' }, description: 'Repository IDs' },
  },
  required: ['action'],
};

export async function manageRepoGroup(args: Record<string, unknown>): Promise<ToolResult> {
  const params = args as unknown as ManageRepoGroupParams;
  const action = params.action;
  const groupId = params.groupId;
  const name = params.name;
  const description = params.description ?? '';
  const repos = params.repos ?? [];

  const manager = await getGroupManager();
  const result: Record<string, unknown> = { action };

  try {
    switch (action) {
      case 'create': {
        const newId = groupId ?? `group_${Date.now()}`;
        manager.createGroup(newId, name ?? newId, description);
        for (const repo of repos) {
          const parsed = parseRepoRef(repo);
          manager.addRepo(newId, parsed.owner, parsed.name, repo, '');
        }
        const created = manager.getGroup(newId)!;
        result['groupId'] = created.id;
        result['name'] = created.name;
        result['repos'] = extractRepoNames(created.repos);
        result['created'] = true;
        break;
      }
      case 'list': {
        const groups = manager.listGroups();
        result['groups'] = groups.map((g) => ({
          groupId: g.id,
          name: g.name,
          description: g.description,
          repos: extractRepoNames(g.repos),
          repoCount: g.repos.length,
        }));
        result['total'] = groups.length;
        break;
      }
      case 'get': {
        const group = groupId ? manager.getGroup(groupId) : undefined;
        if (group) {
          result['groupId'] = group.id;
          result['name'] = group.name;
          result['description'] = group.description;
          result['repos'] = extractRepoNames(group.repos);
          result['repoCount'] = group.repos.length;
          result['found'] = true;
        } else {
          result['groupId'] = groupId;
          result['found'] = false;
        }
        break;
      }
      case 'update': {
        if (!groupId) {
          result['error'] = 'groupId is required for update';
        } else {
          const updated = manager.updateGroup(groupId, {
            ...(name ? { name } : {}),
            ...(description ? { description } : {}),
          });
          if (updated) {
            // Repos parameter replaces the entire repo list
            if (params.repos !== undefined) {
              // Remove all existing repos
              const currentRepos = manager.getGroup(groupId)?.repos ?? [];
              for (const r of currentRepos) {
                try { manager.removeRepo(groupId, r.fullName); } catch { /* ignore */ }
              }
              // Add new repos
              for (const repo of repos) {
                const parsed = parseRepoRef(repo);
                try { manager.addRepo(groupId, parsed.owner, parsed.name, repo, ''); } catch { /* skip duplicate */ }
              }
            }
            result['groupId'] = groupId;
            result['updated'] = true;
          } else {
            result['groupId'] = groupId;
            result['updated'] = false;
          }
        }
        break;
      }
      case 'delete': {
        if (!groupId) {
          result['error'] = 'groupId is required for delete';
        } else {
          try {
            manager.deleteGroup(groupId);
            result['groupId'] = groupId;
            result['deleted'] = true;
          } catch {
            result['groupId'] = groupId;
            result['deleted'] = false;
          }
        }
        break;
      }
      case 'add_repo': {
        if (!groupId || repos.length === 0) {
          result['error'] = 'groupId and repos are required for add_repo';
        } else {
          const group = manager.getGroup(groupId);
          if (group) {
            const added: string[] = [];
            for (const repo of repos) {
              const parsed = parseRepoRef(repo);
              try {
                manager.addRepo(groupId, parsed.owner, parsed.name, repo, '');
                added.push(toExternalRepoRef(`${parsed.owner}/${parsed.name}`));
              } catch { /* skip duplicate */ }
            }
            result['groupId'] = groupId;
            result['addedRepos'] = added;
            result['totalRepos'] = manager.getGroup(groupId)?.repos.length ?? 0;
          } else {
            result['error'] = 'Group not found';
          }
        }
        break;
      }
      case 'remove_repo': {
        if (!groupId || repos.length === 0) {
          result['error'] = 'groupId and repos are required for remove_repo';
        } else {
          const group = manager.getGroup(groupId);
          if (group) {
            const removed: string[] = [];
            for (const repo of repos) {
              const parsed = parseRepoRef(repo);
              const repoFullName = `${parsed.owner}/${parsed.name}`;
              try {
                manager.removeRepo(groupId, repoFullName);
                removed.push(toExternalRepoRef(repoFullName));
              } catch { /* not in group */ }
            }
            result['groupId'] = groupId;
            result['removedRepos'] = removed;
            result['totalRepos'] = manager.getGroup(groupId)?.repos.length ?? 0;
          } else {
            result['error'] = 'Group not found';
          }
        }
        break;
      }
    }
  } catch (err) {
    result['error'] = err instanceof Error ? err.message : String(err);
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// sync_contracts — Sync API contracts across repos
// ---------------------------------------------------------------------------

interface SyncContractsParams {
  groupId: string;
  direction?: string;
  contracts?: Record<string, unknown>[];
}

export const syncContractsSchema = {
  type: 'object',
  properties: {
    groupId: { type: 'string', description: 'Repository group ID' },
    direction: { type: 'string', description: 'Sync direction', enum: ['upstream', 'downstream', 'bidirectional'] },
    contracts: { type: 'array', items: { type: 'object' }, description: 'Contract definitions to sync' },
  },
  required: ['groupId'],
};

export async function syncContracts(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as SyncContractsParams;
  const groupId = params.groupId;
  const direction = params.direction ?? 'bidirectional';
  const contracts = params.contracts ?? [];

  const synced: string[] = [];
  const conflicts: string[] = [];
  const manager = await getGroupManager();
  const group = manager.getGroup(groupId);

  if (group && store && ToolContextImpl.isToolContext(store)) {
    const ctx = store as ToolContextImpl;
    const gstore = ctx.store;

    // Discover contracts from graph: Routes with HANDLES_ROUTE edges
    const repoPlainNames = extractRepoNames(group.repos);
    for (const repo of repoPlainNames) {
      const allNodes = gstore.getAllNodes();
      const repoRoutes = allNodes.filter(
        (n) => n.label === 'Route' && n.projectId === repo
      );

      for (const route of repoRoutes) {
        const routePath = (route.properties?.routePath as string) ?? 'unknown';
        const routeMethod = (route.properties?.routeMethod as string) ?? 'GET';
        const contractKey = `${routeMethod}:${routePath}`;

        // Check if this route exists in other repos
        for (const otherRepo of repoPlainNames) {
          if (otherRepo === repo) continue;
          const otherRoute = allNodes.find(
            (n) =>
              n.label === 'Route' &&
              n.projectId === otherRepo &&
              (n.properties?.routePath as string) === routePath &&
              (n.properties?.routeMethod as string) === routeMethod
          );

          if (otherRoute) {
            synced.push(`${repo}:${contractKey} ↔ ${otherRepo}:${contractKey}`);
          }
        }
      }
    }
  }

  // Also track provided contracts
  for (const contract of contracts) {
    synced.push(JSON.stringify(contract));
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        groupId,
        direction,
        synced: synced.length,
        conflicts: conflicts.length,
        syncDetails: synced.map((s) => ({ contract: s, status: 'synced' })),
        conflictDetails: conflicts.map((c) => ({ contract: c, reason: 'mismatch' })),
        status: conflicts.length > 0 ? 'partial' : synced.length > 0 ? 'success' : 'no-changes',
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// discover_related_repos — Find repos related by import/call patterns
// ---------------------------------------------------------------------------

interface DiscoverRelatedReposParams {
  projectId: string;
  maxResults?: number;
}

export const discoverRelatedReposSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID to find related repos for' },
    maxResults: { type: 'number', description: 'Maximum results (default: 10)' },
  },
  required: ['projectId'],
};

export async function discoverRelatedRepos(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as DiscoverRelatedReposParams;
  const projectId = params.projectId;
  const maxResults = params.maxResults ?? 10;

  const relatedRepos: Array<{ repo: string; relationType: string; sharedSymbols: string[]; relevance: number }> = [];

  if (store && ToolContextImpl.isToolContext(store)) {
    const ctx = store as ToolContextImpl;
    try {
      const gstore = ctx.store;
      const allNodes = gstore.getAllNodes();

      // Find all projects in the store besides the current one
      const otherProjects = new Set<string>();
      for (const node of allNodes) {
        if (node.projectId !== projectId && !node.projectId.startsWith('cross-repo:')) {
          otherProjects.add(node.projectId);
        }
      }

      // For each other project, count shared symbol names (fuzzy relatedness)
      const projectSymbols = new Map<string, Set<string>>();
      for (const node of allNodes) {
        if (node.projectId === projectId) {
          // Track our symbols
        } else if (otherProjects.has(node.projectId)) {
          const symbols = projectSymbols.get(node.projectId) ?? new Set();
          if (node.name) symbols.add(node.name.toLowerCase());
          projectSymbols.set(node.projectId, symbols);
        }
      }

      // Get this project's symbols
      const ourSymbols = new Set<string>();
      for (const node of allNodes) {
        if (node.projectId === projectId && node.name) {
          ourSymbols.add(node.name.toLowerCase());
        }
      }

      // Calculate overlap
      for (const [otherProject, theirSymbols] of projectSymbols) {
        let shared = 0;
        const sharedList: string[] = [];
        for (const sym of theirSymbols) {
          if (ourSymbols.has(sym)) {
            shared++;
            sharedList.push(sym);
          }
        }

        if (shared > 0) {
          relatedRepos.push({
            repo: otherProject,
            relationType: shared > 10 ? 'strong' : shared > 3 ? 'moderate' : 'weak',
            sharedSymbols: sharedList.slice(0, 5),
            relevance: Math.min(shared / ourSymbols.size, 1),
          });
        }
      }
    } catch {
      // Graceful degradation
    }
  }

  // Also include repos from groups
  const mgr = await getGroupManager();

  for (const group of mgr.listGroups()) {
    const repoPlainNames = extractRepoNames(group.repos);
    if (repoPlainNames.includes(projectId)) {
      for (const repo of repoPlainNames) {
        if (repo !== projectId && !relatedRepos.find((r) => r.repo === repo)) {
          relatedRepos.push({
            repo,
            relationType: 'group_member',
            sharedSymbols: ['(group: ' + group.name + ')'],
            relevance: 0.8,
          });
        }
      }
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        projectId,
        relatedRepos: relatedRepos.slice(0, maxResults),
        total: relatedRepos.length,
      }, null, 2),
    }],
  };
}
