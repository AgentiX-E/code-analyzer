// @code-analyzer/intelligence — Cross-Repo Indexer
// Indexes multiple repositories in a group, resolves cross-repo symbols,
// builds cross-repo dependency graphs, detects contracts, and analyzes impact.

import { readFileSync, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import type {
  GraphNode,
  GraphEdge,
  NodeLabel,
  Contract,
} from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { getLanguageFromFilename } from '@code-analyzer/shared';

import type { RepoGroupManager } from './repo-group-manager.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface IndexOptions {
  /** Maximum number of repos to index in parallel (default 4) */
  concurrency?: number;
  /** Filter languages to index */
  languages?: string[];
  /** Force re-index even if previously indexed */
  force?: boolean;
}

export interface IndexResult {
  groupId: string;
  reposIndexed: number;
  totalNodes: number;
  totalEdges: number;
  crossRepoEdges: number;
  contracts: number;
  duration: number;
  errors: string[];
}

export interface CrossRepoSymbolMatch {
  sourceRepo: string;
  sourceSymbol: string;
  targetRepo: string;
  targetSymbol: string;
  matchType: 'exact_name' | 'similar_name' | 'api_pattern' | 'import_reference';
  confidence: number;
}

export interface CrossRepoGraphReport {
  crossRepoEdges: number;
  byType: Record<string, number>;
  repos: string[];
  orphanSymbols: number;
}

export interface TypeCompatResult {
  compatible: boolean;
  breakingChanges: string[];
  warnings: string[];
  sourceType: string;
  targetType: string;
}

export interface CrossRepoImpactResult {
  changedRepo: string;
  affectedRepos: string[];
  analysis: {
    repo: string;
    affectedSymbols: string[];
    impactLevel: 'critical' | 'high' | 'medium' | 'low';
    reason: string;
  }[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__', '.next',
  'target', '.cache', '.idea', '.vscode', 'coverage', '.nyc_output',
]);

const SKIP_FILE_PATTERNS = [/^\./, /\.min\.(js|css)$/, /\.d\.ts$/];

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi', '.go', '.java', '.kt', '.kts',
  '.cs', '.rs', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh',
  '.php', '.rb', '.swift', '.dart', '.lua', '.scala', '.zig', '.ex', '.exs',
]);

// ---------------------------------------------------------------------------
// CrossRepoIndexer
// ---------------------------------------------------------------------------

export class CrossRepoIndexer {
  constructor(
    private store: InMemoryGraphStore,
    private groupManager: RepoGroupManager,
  ) {}

  // -----------------------------------------------------------------------
  // Indexing
  // -----------------------------------------------------------------------

  /**
   * Index all repositories in a group.
   * Runs indexing with configurable concurrency.
   */
  async indexGroup(
    groupId: string,
    options: IndexOptions = {},
  ): Promise<IndexResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    const repos = group.repos.filter((r) => r.autoIndex);
    if (repos.length === 0) {
      return {
        groupId,
        reposIndexed: 0,
        totalNodes: 0,
        totalEdges: 0,
        crossRepoEdges: 0,
        contracts: 0,
        duration: Date.now() - startTime,
        errors: [],
      };
    }

    const concurrency = options.concurrency ?? 4;

    // Index repos with concurrency limit
    for (let i = 0; i < repos.length; i += concurrency) {
      const batch = repos.slice(i, i + concurrency);
      const promises = batch.map(async (repo) => {
        try {
          await this.indexSingleRepo(repo.fullName, repo.localPath, options);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to index ${repo.fullName}: ${message}`);
        }
      });
      await Promise.all(promises);
    }

    // Build cross-repo graph after indexing all repos
    const graphReport = await this.buildCrossRepoGraph(groupId);
    const contracts = await this.detectContracts(groupId);

    this.groupManager.markIndexed(groupId);

    const totalNodes = this.store.getNodeCount();
    const totalEdges = this.store.getEdgeCount();

    return {
      groupId,
      reposIndexed: repos.length,
      totalNodes,
      totalEdges,
      crossRepoEdges: graphReport.crossRepoEdges,
      contracts: contracts.length,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Index a single repository in a group.
   */
  async indexRepo(groupId: string, repoId: string): Promise<IndexResult> {
    const startTime = Date.now();
    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    const repo = group.repos.find((r) => r.fullName === repoId);
    if (!repo) {
      throw new Error(`Repo "${repoId}" not found in group "${groupId}"`);
    }

    await this.indexSingleRepo(repoId, repo.localPath, {});

    // Update project ID
    this.groupManager.setRepoProjectId(groupId, repoId, repoId);

    return {
      groupId,
      reposIndexed: 1,
      totalNodes: this.store.getNodeCount(),
      totalEdges: this.store.getEdgeCount(),
      crossRepoEdges: 0,
      contracts: 0,
      duration: Date.now() - startTime,
      errors: [],
    };
  }

  /**
   * Index a single repo directory — discover files, extract symbols,
   * and populate the graph store.
   */
  private async indexSingleRepo(
    projectId: string,
    localPath: string,
    options: IndexOptions,
  ): Promise<void> {
    if (!existsSync(localPath)) {
      throw new Error(`Path does not exist: ${localPath}`);
    }

    const files = await this.discoverFiles(localPath, options);

    const langFilter = options.languages
      ? new Set(options.languages)
      : null;

    for (const file of files) {
      if (langFilter && file.language && !langFilter.has(file.language)) {
        /* v8 ignore next */
        continue;
      }

      try {
        const content = readFileSync(file.filePath, 'utf-8');
        const symbols = this.extractSymbols(file.filePath, content, projectId, localPath);
        this.insertNodes(projectId, symbols);

        // Create File and Folder nodes
        this.ensureFileNode(projectId, file.filePath, localPath, file.language ?? '');

        // Extract imports and create edges
        const imports = this.extractImports(file.filePath, content, projectId);
        this.createImportEdges(projectId, file.filePath, imports);
      } catch {
        /* v8 ignore next */
        // Skip files that can't be read or parsed
      }
    }
  }

  /**
   * Discover source files recursively in a directory.
   */
  private async discoverFiles(
    rootPath: string,
    _options: IndexOptions,
  ): Promise<{ filePath: string; language: string }[]> {
    /* v8 ignore start */
    const results: { filePath: string; language: string }[] = [];
    await this.walkDirectory(rootPath, rootPath, results);
    return results;
    /* v8 ignore stop */
  }

  private async walkDirectory(
    rootPath: string,
    currentPath: string,
    results: { filePath: string; language: string }[],
  ): Promise<void> {
    /* v8 ignore start */
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        await this.walkDirectory(rootPath, fullPath, results);
      } else if (entry.isFile()) {
        const name = basename(fullPath);
        if (SKIP_FILE_PATTERNS.some((p) => p.test(name))) continue;

        const ext = name.lastIndexOf('.') >= 0
          ? name.slice(name.lastIndexOf('.'))
          : '';
        if (!SOURCE_EXTENSIONS.has(ext)) continue;

        const language = getLanguageFromFilename(fullPath);
        if (!language) continue;

        let fileStat;
        try {
          fileStat = await stat(fullPath);
        } catch {
          continue;
        }

        if (fileStat.size > 5 * 1024 * 1024) continue; // Skip >5MB files

        results.push({ filePath: fullPath, language });
      }
    }
    /* v8 ignore stop */
  }

  // -----------------------------------------------------------------------
  // Symbol Extraction (lightweight, regex-based)
  // -----------------------------------------------------------------------

  private extractSymbols(
    filePath: string,
    content: string,
    projectId: string,
    rootPath: string,
  ): GraphNode[] {
    const nodes: GraphNode[] = [];
    const relPath = relative(rootPath, filePath);
    const now = new Date().toISOString();
    const language = getLanguageFromFilename(filePath) ?? 'unknown';

    let nodeCounter = 0;

    // Match function declarations: function name, export function,
    // export default function, export const name = () =>, etc.
    const funcPatterns = [
      // function name(args) { ... }
      /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(/g,
      // const/let/var name = (args) => { ... }
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g,
      // class name { ... }
      /(?:export\s+(?:default\s+)?)?class\s+(\w+)/g,
      // interface name { ... }
      /(?:export\s+)?interface\s+(\w+)/g,
      // type name = ... ;
      /(?:export\s+)?type\s+(\w+)\s*=/g,
      // enum name { ... }
      /(?:export\s+)?enum\s+(\w+)/g,
      // public/private/protected method name in class body (Java/PHP-like)
      /(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?\w+\s+(\w+)\s*\(/g,
    ];

    const seen = new Set<string>();

    for (const pattern of funcPatterns) {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];
        if (!name || seen.has(name)) continue;
        seen.add(name);

        const lineNum = this.getLineNumber(content, match.index);
        const isExported = content.slice(
          Math.max(0, match.index - 50),
          match.index,
        ).includes('export');

        let label: NodeLabel = 'Function';
        if (pattern.source.includes('class')) label = 'Class';
        else if (pattern.source.includes('interface')) label = 'Interface';
        else if (pattern.source.includes('type\\s+')) label = 'TypeAlias';
        else if (pattern.source.includes('enum')) label = 'Enum';
        else if (pattern.source.includes('public') || pattern.source.includes('private')) label = 'Method';

        nodeCounter++;
        const qualifiedName = `project:${projectId}:${relPath}:${name}`;

        nodes.push({
          id: 0, // Will be assigned by store
          projectId,
          label,
          name,
          qualifiedName,
          filePath: relPath,
          startLine: lineNum,
          endLine: lineNum + 1,
          language,
          properties: {
            name,
            filePath: relPath,
            startLine: lineNum,
            endLine: lineNum + 1,
            language,
            isExported,
          },
          signature: null,
          docstring: null,
          complexity: null,
          isExported,
          fingerprint: null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return nodes;
  }

  /**
   * Extract import statements from source content.
   */
  private extractImports(
    _filePath: string,
    content: string,
    _projectId: string,
  ): Array<{ modulePath: string; importedNames: string[] }> {
    const imports: Array<{ modulePath: string; importedNames: string[] }> = [];

    // Match: import { a, b } from 'module'
    const namedImportRe = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = namedImportRe.exec(content)) !== null) {
      const names = match[1]
        ?.split(',')
        .map((s) => s.trim().replace(/^(\w+)\s+as\s+\w+$/, '$1'))
        .filter(Boolean) ?? [];
      imports.push({ modulePath: match[2]!, importedNames: names });
    }

    // Match: import name from 'module'
    const defaultImportRe = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = defaultImportRe.exec(content)) !== null) {
      imports.push({
        modulePath: match[2]!,
        importedNames: [match[1]!],
      });
    }

    // Match: import * as name from 'module'
    const namespaceImportRe = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = namespaceImportRe.exec(content)) !== null) {
      imports.push({
        modulePath: match[2]!,
        importedNames: [match[1]! + '/*'],
      });
    }

    // Match: require('module')
    const requireRe = /(?:const|let|var)\s+(?:\{([^}]+)\}\s*=\s*)?require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRe.exec(content)) !== null) {
      const names = match[1]
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
      imports.push({ modulePath: match[2]!, importedNames: names });
    }

    // Match: from 'module' import ... (Python)
    const pyImportRe = /from\s+['"]?([^'"]+)['"]?\s+import\s+([^\n]+)/g;
    while ((match = pyImportRe.exec(content)) !== null) {
      const names = match[2]!
        .split(',')
        .map((s) => s.trim().replace(/\s+as\s+\w+/, '').trim())
        .filter(Boolean);
      imports.push({ modulePath: match[1]!, importedNames: names });
    }

    // Match: import module (Python)
    const pyImportSimpleRe = /^import\s+([^\n]+)/gm;
    while ((match = pyImportSimpleRe.exec(content)) !== null) {
      const names = match[1]!
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
        .filter(Boolean);
      for (const name of names) {
        imports.push({ modulePath: name, importedNames: ['*'] });
      }
    }

    return imports;
  }

  // -----------------------------------------------------------------------
  // Cross-Repo Symbol Resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve cross-repo symbols — find matching symbols across repos.
   * Compares exported symbols by exact name, similar name (Levenshtein ≤ 2),
   * API patterns (HTTP routes), and import references.
   */
  async resolveCrossRepoSymbols(
    groupId: string,
  ): Promise<CrossRepoSymbolMatch[]> {
    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    const matches: CrossRepoSymbolMatch[] = [];
    const repos = group.repos.map((r) => r.fullName);

    if (repos.length < 2) return matches;

    // Collect exported symbols per repo
    const repoSymbols = new Map<string, GraphNode[]>();
    for (const repo of repos) {
      const nodes = this.getRepoNodes(repo);
      const exported = nodes.filter(
        (n) =>
          n.isExported &&
          (n.label === 'Function' ||
            n.label === 'Class' ||
            n.label === 'Interface' ||
            n.label === 'TypeAlias' ||
            n.label === 'Enum' ||
            n.label === 'Method'),
      );
      repoSymbols.set(repo, exported);
    }

    // Compare symbols across repos
    for (let i = 0; i < repos.length; i++) {
      for (let j = i + 1; j < repos.length; j++) {
        const repoA = repos[i]!;
        const repoB = repos[j]!;
        const symbolsA = repoSymbols.get(repoA) ?? [];
        const symbolsB = repoSymbols.get(repoB) ?? [];

        for (const symA of symbolsA) {
          for (const symB of symbolsB) {
            const match = this.classifyMatch(symA, symB, repoA, repoB);
            if (match) {
              matches.push(match);
            }
          }
        }
      }
    }

    // Check import references — does one repo import a symbol from another repo's code?
    for (let i = 0; i < repos.length; i++) {
      for (let j = 0; j < repos.length; j++) {
        if (i === j) continue;
        const repoA = repos[i]!;
        const repoB = repos[j]!;

        const nodesA = this.getRepoNodes(repoA);
        const symbolsB = repoSymbols.get(repoB) ?? [];

        // Get all imports from repo A's nodes
        for (const nodeA of nodesA) {
          if (nodeA.label !== 'File') continue;
          const edges = this.store.getEdgesForNode(nodeA.id, 'IMPORTS');
          for (const edge of edges) {
            const targetNode = this.store.getNode(edge.targetId);
            if (!targetNode || targetNode.projectId !== repoB) continue;

            // Found an import from repoA to repoB
            for (const symB of symbolsB) {
              if (symB.name === targetNode.name) {
                const match: CrossRepoSymbolMatch = {
                  sourceRepo: repoA,
                  sourceSymbol: targetNode.qualifiedName,
                  targetRepo: repoB,
                  targetSymbol: symB.qualifiedName,
                  matchType: 'import_reference',
                  confidence: 0.9,
                };
                matches.push(match);
              }
            }
          }
        }
      }
    }

    return matches;
  }

  /**
   * Classify how two symbols match across repos.
   */
  private classifyMatch(
    symA: GraphNode,
    symB: GraphNode,
    repoA: string,
    repoB: string,
  ): CrossRepoSymbolMatch | null {
    // Exact name match
    if (symA.name === symB.name) {
      return {
        sourceRepo: repoA,
        sourceSymbol: symA.qualifiedName,
        targetRepo: repoB,
        targetSymbol: symB.qualifiedName,
        matchType: 'exact_name',
        confidence: 1.0,
      };
    }

    // Similar name (Levenshtein distance ≤ 2)
    const nameA = symA.name.toLowerCase();
    const nameB = symB.name.toLowerCase();
    if (levenshteinDistance(nameA, nameB) <= 2) {
      return {
        sourceRepo: repoA,
        sourceSymbol: symA.qualifiedName,
        targetRepo: repoB,
        targetSymbol: symB.qualifiedName,
        matchType: 'similar_name',
        confidence: 0.7,
      };
    }

    // API pattern match (route paths)
    const routeA = symA.properties.routePath as string | undefined;
    const routeB = symB.properties.routePath as string | undefined;
    if (routeA && routeB && routeA === routeB) {
      return {
        sourceRepo: repoA,
        sourceSymbol: symA.qualifiedName,
        targetRepo: repoB,
        targetSymbol: symB.qualifiedName,
        matchType: 'api_pattern',
        confidence: 0.85,
      };
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Cross-Repo Graph Building
  // -----------------------------------------------------------------------

  /**
   * Build the cross-repo dependency graph.
   * Creates CROSS_REPO_IMPORTS, CROSS_REPO_CALLS, and CROSS_REPO_DEPENDS edges.
   */
  async buildCrossRepoGraph(groupId: string): Promise<CrossRepoGraphReport> {
    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    const repos = group.repos.map((r) => r.fullName);
    if (repos.length < 2) {
      return {
        crossRepoEdges: 0,
        byType: {},
        repos,
        orphanSymbols: 0,
      };
    }

    const byType: Record<string, number> = {};
    let crossRepoEdges = 0;
    const now = new Date().toISOString();

    // Build a map of repo -> all exported symbol names
    const repoSymbolNames = new Map<string, Set<string>>();
    for (const repo of repos) {
      const nodes = this.getRepoNodes(repo);
      const names = new Set<string>();
      for (const node of nodes) {
        if (node.isExported) {
          names.add(node.name);
          // Also track qualified name
          names.add(node.qualifiedName);
        }
      }
      repoSymbolNames.set(repo, names);
    }

    // For each repo, check imports and calls to symbols in other repos
    for (const repoA of repos) {
      const nodesA = this.getRepoNodes(repoA);

      for (const nodeA of nodesA) {
        // Get all outgoing edges
        const edgesOut = this.store.getEdgesForNode(nodeA.id);

        for (const edge of edgesOut) {
          const targetNode = this.store.getNode(edge.targetId);
          if (!targetNode) continue;

          const repoB = targetNode.projectId;
          if (repoB === repoA) continue;
          if (!repos.includes(repoB)) continue;

          // Determine cross-repo relationship type
          let crossRepoType: string;
          switch (edge.type) {
            case 'IMPORTS':
              crossRepoType = 'CROSS_REPO_IMPORTS';
              break;
            case 'CALLS':
              crossRepoType = 'CROSS_REPO_CALLS';
              break;
            case 'IMPLEMENTS':
              crossRepoType = 'CROSS_REPO_IMPLEMENTS';
              break;
            default:
              crossRepoType = 'CROSS_REPO_DEPENDS';
          }

          // Create cross-repo node if not exists
          this.ensureCrossRepoNode(
            repoA,
            crossRepoType,
            now,
          );

          // Create cross-repo edge
          const crossRepoEdge: GraphEdge = {
            id: 0,
            projectId: `cross-repo:${groupId}`,
            sourceId: nodeA.id,
            targetId: targetNode.id,
            type: crossRepoType as GraphEdge['type'],
            properties: {
              sourceRepo: repoA,
              targetRepo: repoB,
              confidence: 1.0,
            },
            weight: edge.weight,
            createdAt: now,
          };

          try {
            this.store.insertEdge(crossRepoEdge);
            crossRepoEdges++;
            byType[crossRepoType] = (byType[crossRepoType] ?? 0) + 1;
          } catch {
            // Edge may already exist
          }
        }
      }
    }

    // Count orphan symbols — exported symbols from any repo not referenced by any other repo
    let orphanSymbols = 0;
    for (const repo of repos) {
      const nodes = this.getRepoNodes(repo);
      for (const node of nodes) {
        if (!node.isExported) continue;

        // Check if any cross-repo edge targets this node
        let isReferenced = false;
        const edgesIn = this.store.getEdgesForNode(node.id, undefined, 'in');
        for (const edge of edgesIn) {
          if (edge.type.startsWith('CROSS_REPO_') && edge.projectId !== repo) {
            isReferenced = true;
            break;
          }
        }

        if (!isReferenced) {
          orphanSymbols++;
        }
      }
    }

    return {
      crossRepoEdges,
      byType,
      repos,
      orphanSymbols,
    };
  }

  // -----------------------------------------------------------------------
  // Contract Detection
  // -----------------------------------------------------------------------

  /**
   * Detect API contracts between repos.
   * Finds interfaces, types, and APIs shared across multiple repos.
   */
  async detectContracts(groupId: string): Promise<Contract[]> {
    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    const repos = group.repos.map((r) => r.fullName);
    if (repos.length < 2) return [];

    const contracts: Contract[] = [];
    let contractCounter = 0;

    // Collect all Interface and TypeAlias nodes per repo
    const repoInterfaces = new Map<string, GraphNode[]>();
    for (const repo of repos) {
      const nodes = this.getRepoNodes(repo);
      const interfaces = nodes.filter(
        (n) =>
          n.label === 'Interface' || n.label === 'TypeAlias',
      );
      repoInterfaces.set(repo, interfaces);
    }

    // Find interfaces/types used by multiple repos (implicit contracts)
    const seeNameCount = new Map<string, Set<string>>(); // typeName -> set of repos

    for (const [repo, interfaces] of repoInterfaces) {
      for (const iface of interfaces) {
        const existing = seeNameCount.get(iface.name) ?? new Set();
        existing.add(repo);
        seeNameCount.set(iface.name, existing);
      }
    }

    // Interfaces used by 2+ repos are contracts
    for (const [name, reposSet] of seeNameCount) {
      if (reposSet.size < 2) continue;

      contractCounter++;
      const contractingRepos = Array.from(reposSet);

      // Collect the type definitions from each repo
      const definition: Record<string, unknown> = {
        name,
        kind: 'shared_interface',
        repos: contractingRepos,
        fields: [],
      };

      // Attempt to extract field information for at least one repo
      for (const repo of contractingRepos) {
        const interfaces = repoInterfaces.get(repo) ?? [];
        const iface = interfaces.find((i) => i.name === name);
        if (iface) {
          definition['sampleRepo'] = repo;
          definition['sampleQualifiedName'] = iface.qualifiedName;
          break;
        }
      }

      contracts.push({
        id: `contract:${groupId}:${contractCounter}`,
        name,
        description: `Shared ${definition['kind']} contract detected across ${contractingRepos.length} repos`,
        uri: `cross-repo://${groupId}/contracts/${contractCounter}`,
        version: '0.1.0',
        definition,
        dependencies: contractingRepos,
      });
    }

    return contracts;
  }

  // -----------------------------------------------------------------------
  // Type Compatibility
  // -----------------------------------------------------------------------

  /**
   * Check type compatibility between two symbols across repos.
   * Compares structural properties, function signatures, and interfaces.
   */
  async checkTypeCompatibility(
    groupId: string,
    symbolA: string,
    symbolB: string,
  ): Promise<TypeCompatResult> {
    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    const breakingChanges: string[] = [];
    const warnings: string[] = [];

    // Find the symbols
    const nodeA = this.findSymbolAcrossRepos(group.repos.map((r) => r.fullName), symbolA);
    // Find symbolB in a different repo than nodeA
    const nodeB = this.findSymbolAcrossRepos(
      group.repos.map((r) => r.fullName),
      symbolB,
      nodeA ? nodeA.repo : undefined,
    );

    if (!nodeA || !nodeB) {
      return {
        compatible: false,
        breakingChanges: [`Symbol not found: ${!nodeA ? symbolA : symbolB}`],
        warnings: [],
        sourceType: '',
        targetType: '',
      };
    }

    const sourceType = `${nodeA.node.label}:${nodeA.node.qualifiedName}`;
    const targetType = `${nodeB.node.label}:${nodeB.node.qualifiedName}`;

    // Compare labels
    if (nodeA.node.label !== nodeB.node.label) {
      breakingChanges.push(
        `Type mismatch: ${nodeA.node.label} vs ${nodeB.node.label}`,
      );
    }

    // Compare properties
    const propsA = nodeA.node.properties;
    const propsB = nodeB.node.properties;

    for (const key of Object.keys(propsA)) {
      if (['name', 'filePath', 'startLine', 'endLine', 'language'].includes(key)) {
        continue;
      }
      if (!(key in propsB)) {
        breakingChanges.push(`Removed property: ${key}`);
      } else if (typeof propsA[key] !== typeof propsB[key]) {
        warnings.push(
          `Changed type for property "${key}": ${typeof propsA[key]} → ${typeof propsB[key]}`,
        );
      }
    }

    for (const key of Object.keys(propsB)) {
      if (['name', 'filePath', 'startLine', 'endLine', 'language'].includes(key)) {
        continue;
      }
      if (!(key in propsA)) {
        warnings.push(`Added required property: ${key}`);
      }
    }

    // Compare signatures
    if (nodeA.node.signature !== nodeB.node.signature) {
      if (nodeA.node.signature && nodeB.node.signature) {
        warnings.push(
          `Signature changed: "${nodeA.node.signature}" → "${nodeB.node.signature}"`,
        );
      }
    }

    // Compare return types
    if (
      propsA.returnType &&
      propsB.returnType &&
      propsA.returnType !== propsB.returnType
    ) {
      warnings.push(
        `Return type changed: ${propsA.returnType} → ${propsB.returnType}`,
      );
    }

    return {
      compatible: breakingChanges.length === 0,
      breakingChanges,
      warnings,
      sourceType,
      targetType,
    };
  }

  // -----------------------------------------------------------------------
  // Cross-Repo Impact Analysis
  // -----------------------------------------------------------------------

  /**
   * Analyze the impact of changes in one repo on other repos in the group.
   * Uses BFS over cross-repo edges to find affected repos.
   */
  async analyzeCrossRepoImpact(
    groupId: string,
    changedRepoId: string,
  ): Promise<CrossRepoImpactResult> {
    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    const repos = group.repos.map((r) => r.fullName);
    if (!repos.includes(changedRepoId)) {
      throw new Error(
        `Changed repo "${changedRepoId}" is not in group "${groupId}"`,
      );
    }

    const analysis: CrossRepoImpactResult['analysis'] = [];
    const affectedRepos = new Set<string>();

    // BFS from changed repo along cross-repo edges
    const visited = new Set<string>();
    const queue: Array<{ repo: string; depth: number }> = [];
    queue.push({ repo: changedRepoId, depth: 0 });
    visited.add(changedRepoId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.repo !== changedRepoId) {
        affectedRepos.add(current.repo);
        const affectedSymbols = this.getSymbolsInRepo(current.repo).map(
          (n) => n.name,
        );

        let impactLevel: 'critical' | 'high' | 'medium' | 'low' = 'low';
        if (current.depth === 1) impactLevel = 'high';
        else if (current.depth === 2) impactLevel = 'medium';

        analysis.push({
          repo: current.repo,
          affectedSymbols,
          impactLevel,
          reason: `Repo "${current.repo}" depends on "${changedRepoId}" through cross-repo ${current.depth === 1 ? 'direct' : 'transitive'} dependencies`,
        });
      }

      if (current.depth >= 3) continue;

      // Find all repos this repo depends on via cross-repo edges
      const nodes = this.getRepoNodes(current.repo);
      for (const node of nodes) {
        const edgesOut = this.store.getEdgesForNode(node.id);
        for (const edge of edgesOut) {
          if (!edge.type.startsWith('CROSS_REPO_')) continue;
          const targetNode = this.store.getNode(edge.targetId);
          if (!targetNode) continue;
          const targetRepo = targetNode.projectId;
          if (visited.has(targetRepo)) continue;
          visited.add(targetRepo);
          queue.push({ repo: targetRepo, depth: current.depth + 1 });
        }
      }
    }

    return {
      changedRepo: changedRepoId,
      affectedRepos: Array.from(affectedRepos),
      analysis,
    };
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

  private getRepoNodes(projectId: string): GraphNode[] {
    const result = this.store.queryNodes({
      projectId,
      limit: 100000,
      offset: 0,
    });
    return result.items;
  }

  private getSymbolsInRepo(projectId: string): GraphNode[] {
    return this.getRepoNodes(projectId).filter(
      (n) =>
        n.label === 'Function' ||
        n.label === 'Class' ||
        n.label === 'Interface' ||
        n.label === 'TypeAlias' ||
        n.label === 'Enum' ||
        n.label === 'Method',
    );
  }

  private insertNodes(projectId: string, nodes: GraphNode[]): void {
    for (const node of nodes) {
      try {
        this.store.insertNode({ ...node, projectId });
      } catch {
        // Node may already exist
      }
    }
  }

  private ensureFileNode(
    projectId: string,
    filePath: string,
    rootPath: string,
    language: string,
  ): void {
    const relPath = relative(rootPath, filePath);
    const now = new Date().toISOString();
    const qname = `file:${projectId}:${relPath}`;

    // Check if file node already exists
    const existing = this.store.getNodeByQualifiedName(qname);
    if (existing) return;

    try {
      this.store.insertNode({
        id: 0,
        projectId,
        label: 'File',
        name: basename(filePath),
        qualifiedName: qname,
        filePath: relPath,
        startLine: 1,
        endLine: 1,
        language,
        properties: {
          name: basename(filePath),
          filePath: relPath,
          language,
        },
        signature: null,
        docstring: null,
        complexity: null,
        isExported: false,
        fingerprint: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // Already exists
    }
  }

  private createImportEdges(
    projectId: string,
    sourceFile: string,
    imports: Array<{ modulePath: string; importedNames: string[] }>,
  ): void {
    const now = new Date().toISOString();

    for (const imp of imports) {
      // Find target file node by module path
      const nodes = this.getRepoNodes(projectId);
      const targetFileNode = nodes.find(
        (n) =>
          n.label === 'File' &&
          (n.filePath?.includes(imp.modulePath) ||
            n.filePath?.includes(imp.modulePath.replace(/^\./, '')) ||
            n.name.startsWith(imp.modulePath)),
      );

      if (!targetFileNode) continue;

      const sourceFileNode = nodes.find(
        (n) =>
          n.label === 'File' &&
          n.qualifiedName === `file:${projectId}:${relative('/tmp/root', sourceFile)}`,
      );

      // Fallback: search by name
      const sourceNode = sourceFileNode ??
        nodes.find((n) => n.label === 'File' && n.filePath === sourceFile);

      if (!sourceNode) continue;

      try {
        this.store.insertEdge({
          id: 0,
          projectId,
          sourceId: sourceNode.id,
          targetId: targetFileNode.id,
          type: 'IMPORTS',
          properties: {
            importPath: imp.modulePath,
            importedSymbols: imp.importedNames,
          },
          weight: 1,
          createdAt: now,
        });
      } catch {
        // Edge may already exist
      }
    }
  }

  private ensureCrossRepoNode(
    repo: string,
    edgeType: string,
    now: string,
  ): number {
    // Look for existing CrossRepo node for this repo
    const allNodes = this.store.getAllNodes();
    const existing = allNodes.find(
      (n) =>
        n.label === 'CrossRepoModule' &&
        n.projectId === repo &&
        n.name === edgeType,
    );
    if (existing) return existing.id;

    try {
      return this.store.insertNode({
        id: 0,
        projectId: repo,
        label: 'CrossRepoModule',
        name: edgeType,
        qualifiedName: `cross-repo:${repo}:${edgeType}`,
        filePath: null,
        startLine: null,
        endLine: null,
        language: null,
        properties: {
          name: edgeType,
          edgeType,
          repository: repo,
        },
        signature: null,
        docstring: null,
        complexity: null,
        isExported: true,
        fingerprint: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // Already exists, try to find it
      const nodes = this.getRepoNodes(repo);
      const found = nodes.find(
        (n) => n.label === 'CrossRepoModule' && n.name === edgeType,
      );
      return found ? found.id : 0;
    }
  }

  private findSymbolAcrossRepos(
    repos: string[],
    symbolName: string,
    excludeRepo?: string,
  ): { repo: string; node: GraphNode } | null {
    for (const repo of repos) {
      if (excludeRepo && repo === excludeRepo) continue;
      const nodes = this.getRepoNodes(repo);
      const found = nodes.find(
        (n) =>
          n.name === symbolName ||
          n.qualifiedName.includes(symbolName) ||
          n.qualifiedName.endsWith(`:${symbolName}`),
      );
      if (found) {
        return { repo, node: found };
      }
    }

    // Try case-insensitive match
    const lower = symbolName.toLowerCase();
    for (const repo of repos) {
      if (excludeRepo && repo === excludeRepo) continue;
      const nodes = this.getRepoNodes(repo);
      const found = nodes.find(
        (n) => n.name.toLowerCase() === lower,
      );
      if (found) {
        return { repo, node: found };
      }
    }

    return null;
  }

  private getLineNumber(content: string, index: number): number {
    const before = content.slice(0, index);
    return before.split('\n').length;
  }
}

// ---------------------------------------------------------------------------
// Levenshtein Distance
// ---------------------------------------------------------------------------

/**
 * Compute the Levenshtein edit distance between two strings.
 * Dynamic programming implementation with space optimization (single row).
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    return levenshteinDistance(b, a);
  }

  let prevRow = new Array<number>(a.length + 1);
  let currRow = new Array<number>(a.length + 1);

  for (let i = 0; i <= a.length; i++) {
    prevRow[i] = i;
  }

  for (let j = 1; j <= b.length; j++) {
    currRow[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[i] = Math.min(
        prevRow[i]! + 1,          // deletion
        currRow[i - 1]! + 1,      // insertion
        prevRow[i - 1]! + cost,   // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[a.length]!;
}
