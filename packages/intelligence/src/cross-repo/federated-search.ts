// @code-analyzer/intelligence — Federated Search Engine
// Search across all indexed repositories, find symbols, detect duplicates,
// and analyze cross-repo usage patterns.

import type { GraphNode } from '@code-analyzer/shared';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import { MinHashSimilarity } from '../similarity/minhash.js';

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

  constructor(private store: InMemoryGraphStore) {
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
    const repoFilter = options.repoFilter
      ? new Set(options.repoFilter)
      : null;

    // Use the store's FTS search
    const ftsResults = this.store.searchFts(query, {
      limit: maxResults * 5,
      offset: 0,
    });

    const items: FederatedSearchItem[] = [];
    const repoBreakdown: Record<string, number> = {};

    for (const ftsResult of ftsResults) {
      const node = ftsResult.node;
      const repo = node.projectId;

      // Apply repo filter
      if (repoFilter && !repoFilter.has(repo)) continue;
      if (options.groupId && repo !== options.groupId && !repo.startsWith(options.groupId)) continue;

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
    };
  }

  // -----------------------------------------------------------------------
  // Find Symbol Across Repos
  // -----------------------------------------------------------------------

  /**
   * Find a symbol across all indexed repositories.
   * Supports exact and partial name matching.
   */
  async findSymbol(
    name: string,
    groupId?: string,
  ): Promise<FederatedSymbolResult[]> {
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
  async findDuplicates(
    groupId: string,
    threshold: number = 0.8,
  ): Promise<DuplicateReport> {
    if (!groupId) {
      throw new Error('Group ID is required');
    }

    // Collect all File nodes from the group's repos
    const allNodes = this.store.getAllNodes();
    const groupFiles = allNodes.filter(
      (n) =>
        n.label === 'File' &&
        n.projectId &&
        !n.projectId.startsWith('cross-repo:'),
    );

    // Group files by repo
    const repoFiles = new Map<string, GraphNode[]>();
    for (const file of groupFiles) {
      const repo = file.projectId;
      const list = repoFiles.get(repo) ?? [];
      list.push(file);
      repoFiles.set(repo, list);
    }

    // Compute MinHash fingerprints for each file
    // Use name + qualified name as token set (simplified for performance)
    const fingerprints = new Map<number, number[]>();
    for (const file of groupFiles) {
      // Tokenize: use the file's symbols as tokens
      const edges = this.store.getEdgesForNode(file.id, 'DEFINES');
      const tokens: string[] = [];

      // Use symbol names as tokens for structural similarity
      const allNodesArr = allNodes;
      for (const edge of edges) {
        const targetNode = allNodesArr.find((n) => n.id === edge.targetId);
        if (targetNode) {
          tokens.push(targetNode.label + ':' + targetNode.name);
        }
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
    const processed = new Set<string>();

    const fileArray = Array.from(groupFiles);
    for (let i = 0; i < fileArray.length; i++) {
      for (let j = i + 1; j < fileArray.length; j++) {
        const fileA = fileArray[i]!;
        const fileB = fileArray[j]!;

        // Skip same-repo comparisons
        if (fileA.projectId === fileB.projectId) continue;

        const pairKey = [fileA.id, fileB.id].sort().join(':');
        if (processed.has(pairKey)) continue;
        processed.add(pairKey);

        const fpA = fingerprints.get(fileA.id);
        const fpB = fingerprints.get(fileB.id);
        if (!fpA || !fpB) continue;

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
              ((fileA.endLine ?? 0) - (fileA.startLine ?? 0) +
                (fileB.endLine ?? 0) - (fileB.startLine ?? 0)) /
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
  async getCrossRepoUsage(
    dependencyName: string,
    groupId: string,
  ): Promise<UsageReport> {
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

  private toSymbolResult(
    node: GraphNode,
    matchType: 'exact' | 'partial',
  ): FederatedSymbolResult {
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
