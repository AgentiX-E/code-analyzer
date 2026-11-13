// @code-analyzer/intelligence — Federated Search Engine
// Search across all indexed repositories, find symbols, detect duplicates,
// and analyze cross-repo usage patterns.

import { EDGE_DEFINES } from '@code-analyzer/shared';

import { resolveRepoScope, type RepoScope } from './search-scope.js';
import { MinHashSimilarity } from '../similarity/minhash.js';

import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface FederatedSearchOptions {
  /** Optional group ID to scope search */
  groupId?: string;
  /** Filter to specific repos */
  repoFilter?: string[];
  /** Maximum results to return (default 50) */
  maxResults?: number;
  /** Include code snippets in results */
  includeCode?: boolean;
}

export interface FederatedSearchResult {
  totalResults: number;
  repoBreakdown: Record<string, number>;
  results: FederatedSearchItem[];
  /**
   * Selectors from `repoFilter`/`groupId` that named none of the repositories the store offered as candidates.
   *
   * **An empty result set has two causes and only one of them is about the query.** This field is the other one, and
   * it is reported only when there were candidates to resolve against - a query that found nothing at all cannot say
   * which selector was at fault.
   */
  unmatchedRepoFilters: string[];
}

/**
 * What a group id means to the search: the project ids it contains.
 *
 * `RepoGroupManager` satisfies this structurally, so the caller passes the manager it already owns rather than a map
 * it would have to keep in step. **Without a resolver `groupId` throws rather than filtering nothing**, because a
 * scope option that silently selects the empty set is the defect this interface was introduced to end.
 */
export interface RepoScopeResolver {
  projectsInGroup(groupId: string): string[];
}

export interface FederatedSearchItem {
  repo: string;
  symbol: string;
  filePath: string;
  line: number;
  snippet: string;
  relevance: number;
}

export interface FederatedSymbolResult {
  repo: string;
  symbol: string;
  qualifiedName: string;
  filePath: string;
  language: string;
  isExported: boolean;
  matchType: 'exact' | 'partial';
}

export interface DuplicateReport {
  groupId: string;
  totalDuplicates: number;
  duplicates: DuplicateGroup[];
}

export interface DuplicateGroup {
  similarity: number;
  repos: string[];
  files: { repo: string; filePath: string }[];
  lines: number;
}

export interface UsageReport {
  dependencyName: string;
  usedBy: { repo: string; files: string[]; version?: string }[];
  totalRepos: number;
  totalFiles: number;
}

// ---------------------------------------------------------------------------
// FederatedSearchEngine
// ---------------------------------------------------------------------------

export class FederatedSearchEngine {
  private minhash: MinHashSimilarity;

  constructor(
    private store: InMemoryGraphStore,
    private scopes?: RepoScopeResolver,
  ) {
    this.minhash = new MinHashSimilarity(128);
  }

  // -----------------------------------------------------------------------
  // Federated Search
  // -----------------------------------------------------------------------

  /**
   * Search across all indexed repositories.
   * Uses the store's FTS for initial matching, then aggregates by repo.
   */
  async search(
    query: string,
    options: FederatedSearchOptions = {},
  ): Promise<FederatedSearchResult> {
    if (!query) {
      throw new Error('Search query is required');
    }

    const maxResults = options.maxResults ?? 50;

    // Use the store's FTS search
    const ftsResults = this.store.searchFts(query, {
      limit: maxResults * 5,
      offset: 0,
    });

    // **Selectors are resolved against the candidates, not compared to a string.** `repoFilter` used to be a
    // `Set.has` on `node.projectId`, which is `owner/name` on any real workspace and `name` in every unit fixture - so
    // the filter matched on fixtures and matched nothing on the four released repositories it was measured on.
    const scope = this.resolveScope(options);

    const items: FederatedSearchItem[] = [];
    const repoBreakdown: Record<string, number> = {};

    for (const ftsResult of ftsResults) {
      const node = ftsResult.node;
      const repo = node.projectId;

      // Apply repo filter
      if (scope && !scope.selected.has(repo)) continue;

      // Apply label filter — prefer code symbols over internal nodes
      const isSymbolLabel =
        node.label === 'Function' ||
        node.label === 'Class' ||
        node.label === 'Interface' ||
        node.label === 'TypeAlias' ||
        node.label === 'Enum' ||
        node.label === 'Method';

      if (!isSymbolLabel && ftsResults.length > maxResults) continue;

      const item: FederatedSearchItem = {
        repo,
        symbol: node.name,
        filePath: node.filePath ?? '',
        line: node.startLine ?? 0,
        snippet: ftsResult.snippet,
        relevance: ftsResult.rank / 20, // Normalize to ~0-1 scale
      };

      items.push(item);
      repoBreakdown[repo] = (repoBreakdown[repo] ?? 0) + 1;

      if (items.length >= maxResults) break;
    }

    return {
      totalResults: items.length,
      repoBreakdown,
      results: items,
      unmatchedRepoFilters: scope?.unmatched ?? [],
    };
  }

  /**
   * The repositories this question is allowed to answer from, or `null` when it may answer from all of them.
   *
   * `groupId` and `repoFilter` compose: a group is expanded through the resolver it was registered with, and an
   * explicit filter narrows what is left.
   *
   * **Selectors are resolved against the store's projects, not against the query's hits.** Resolving against the hits
   * conflates "this repository exists and holds no match" with "this repository does not exist", which is the
   * difference the caller needs in order to know whether to fix the filter or the question.
   */
  private resolveScope(options: FederatedSearchOptions): RepoScope | null {
    const filter = options.repoFilter;
    const groupId = options.groupId;

    // No scope was asked for, so the question may answer from every repository it likes.
    if (filter === undefined && groupId === undefined) return null;

    const selectors: string[] = [...(filter ?? [])];

    if (groupId !== undefined) {
      if (!this.scopes) {
        throw new Error(
          'groupId requires a repo group resolver: construct FederatedSearchEngine with the RepoGroupManager that owns the group',
        );
      }
      selectors.push(...this.scopes.projectsInGroup(groupId));
    }

    // **A scope was asked for and it names nothing** - a group whose repositories were added but never indexed. The
    // answer is the empty set, not every repository: returning everything here would make an unindexed group the
    // widest scope in the system.
    if (selectors.length === 0) return { selected: new Set<string>(), unmatched: [] };

    return resolveRepoScope(selectors, this.store.getProjectIds());
  }

  // -----------------------------------------------------------------------
  // Find Symbol Across Repos
  // -----------------------------------------------------------------------

  /**
   * Find a symbol across all indexed repositories.
   * Supports exact and partial name matching.
   */
  async findSymbol(name: string, groupId?: string): Promise<FederatedSymbolResult[]> {
    if (!name) {
      throw new Error('Symbol name is required');
    }

    const results: FederatedSymbolResult[] = [];

    // First try exact match via qualified name search
    const exactNode = this.store.getNodeByQualifiedName(name);
    if (exactNode) {
      results.push(this.toSymbolResult(exactNode, 'exact'));
    }

    // Search via FTS for partial matches
    const ftsResults = this.store.searchFts(name, { limit: 100, offset: 0 });

    const seen = new Set<string>();
    if (exactNode) {
      seen.add(`${exactNode.projectId}:${exactNode.qualifiedName}`);
    }

    for (const ftsResult of ftsResults) {
      const node = ftsResult.node;
      const key = `${node.projectId}:${node.qualifiedName}`;

      if (seen.has(key)) continue;
      if (groupId && node.projectId !== groupId) continue;

      // Only return code symbols
      if (
        node.label !== 'Function' &&
        node.label !== 'Class' &&
        node.label !== 'Interface' &&
        node.label !== 'TypeAlias' &&
        node.label !== 'Enum' &&
        node.label !== 'Method' &&
        node.label !== 'Variable'
      ) {
        continue;
      }

      seen.add(key);
      const matchType = node.name === name ? 'exact' : 'partial';
      results.push(this.toSymbolResult(node, matchType));
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Find Duplicates (MinHash-based)
  // -----------------------------------------------------------------------

  /**
   * Find duplicate code across repositories using MinHash similarity.
   */
  async findDuplicates(groupId: string, threshold: number = 0.8): Promise<DuplicateReport> {
    if (!groupId) {
      throw new Error('Group ID is required');
    }

    // Collect all File nodes from the group's repos
    const allNodes = this.store.getAllNodes();
    const groupFiles = allNodes.filter(
      (n) => n.label === 'File' && n.projectId && !n.projectId.startsWith('cross-repo:'),
    );

    // Compute MinHash fingerprints for each file
    // Use name + qualified name as token set (simplified for performance)
    const fingerprints = new Map<number, number[]>();
    for (const file of groupFiles) {
      // Tokenize: use the file's symbols as tokens
      const edges = this.store.getEdgesForNode(file.id, EDGE_DEFINES);
      const tokens: string[] = [];

      // Every edge references an existing node (insertEdge validates endpoints and
      // deleteNode cascades edge removal), so the target lookup always resolves.
      for (const edge of edges) {
        const targetNode = allNodes.find((n) => n.id === edge.targetId)!;
        tokens.push(targetNode.label + ':' + targetNode.name);
      }

      // Fallback: use file qualified name if no symbols
      if (tokens.length === 0) {
        tokens.push(file.qualifiedName);
      }

      const fp = this.minhash.computeFingerprint(tokens);
      fingerprints.set(file.id, fp);
    }

    // Compare all pairs across different repos
    const duplicateGroups: DuplicateGroup[] = [];

    const fileArray = Array.from(groupFiles);
    for (let i = 0; i < fileArray.length; i++) {
      for (let j = i + 1; j < fileArray.length; j++) {
        const fileA = fileArray[i]!;
        const fileB = fileArray[j]!;

        // Skip same-repo comparisons
        if (fileA.projectId === fileB.projectId) continue;

        // Every file in groupFiles receives a fingerprint in the loop above.
        const fpA = fingerprints.get(fileA.id)!;
        const fpB = fingerprints.get(fileB.id)!;

        const similarity = this.minhash.estimateSimilarity(fpA, fpB);
        if (similarity >= threshold) {
          duplicateGroups.push({
            similarity: Math.round(similarity * 100) / 100,
            repos: [fileA.projectId, fileB.projectId],
            files: [
              { repo: fileA.projectId, filePath: fileA.filePath ?? '' },
              { repo: fileB.projectId, filePath: fileB.filePath ?? '' },
            ],
            lines:
              ((fileA.endLine ?? 0) -
                (fileA.startLine ?? 0) +
                (fileB.endLine ?? 0) -
                (fileB.startLine ?? 0)) /
              2,
          });
        }
      }
    }

    return {
      groupId,
      totalDuplicates: duplicateGroups.length,
      duplicates: duplicateGroups,
    };
  }

  // -----------------------------------------------------------------------
  // Cross-Repo Usage
  // -----------------------------------------------------------------------

  /**
   * Get cross-repo usage — which repos use a given dependency.
   */
  async getCrossRepoUsage(dependencyName: string, groupId: string): Promise<UsageReport> {
    if (!dependencyName) {
      throw new Error('Dependency name is required');
    }
    if (!groupId) {
      throw new Error('Group ID is required');
    }

    const usedBy: { repo: string; files: string[]; version?: string }[] = [];
    const allNodes = this.store.getAllNodes();

    // Find all nodes that reference this dependency name
    const referencingNodes = allNodes.filter(
      (n) =>
        n.name.includes(dependencyName) ||
        n.qualifiedName.includes(dependencyName) ||
        (n.signature && n.signature.includes(dependencyName)),
    );

    // Group by repo
    const repoMap = new Map<string, Set<string>>();
    for (const node of referencingNodes) {
      if (node.label === 'File') continue;
      const repo = node.projectId;

      // Filter by group's repos
      if (!repo || repo.startsWith('cross-repo:')) continue;

      const files = repoMap.get(repo) ?? new Set();
      if (node.filePath) {
        files.add(node.filePath);
      }
      repoMap.set(repo, files);
    }

    let totalFiles = 0;
    for (const [repo, files] of repoMap) {
      usedBy.push({
        repo,
        files: Array.from(files),
      });
      totalFiles += files.size;
    }

    return {
      dependencyName,
      usedBy,
      totalRepos: usedBy.length,
      totalFiles,
    };
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

  private toSymbolResult(node: GraphNode, matchType: 'exact' | 'partial'): FederatedSymbolResult {
    return {
      repo: node.projectId,
      symbol: node.name,
      qualifiedName: node.qualifiedName,
      filePath: node.filePath ?? '',
      language: node.language ?? 'unknown',
      isExported: node.isExported,
      matchType,
    };
  }
}
