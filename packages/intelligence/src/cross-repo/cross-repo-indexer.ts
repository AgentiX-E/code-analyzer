// @code-analyzer/intelligence — Cross-Repo Indexer
// Indexes multiple repositories in a group, resolves cross-repo symbols,
// builds cross-repo dependency graphs, detects contracts, and analyzes impact.

import { readFileSync, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, posix, relative } from 'node:path';

import { PipelineOrchestrator, createAllPhases, getOrLoadProvider } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  CAPTURE_TAGS,
  EDGE_IMPORTS,
  EDGE_CALLS,
  EDGE_IMPLEMENTS,
  EDGE_CROSS_REPO_IMPORTS,
  EDGE_CROSS_REPO_CALLS,
  EDGE_CROSS_REPO_IMPLEMENTS,
  EDGE_CROSS_REPO_DEPENDS,
  getLanguageFromFilename,
} from '@code-analyzer/shared';

import { detectPackageIdentities, resolvePackageMember } from './package-identity.js';
import { mergePipelineGraph } from './group-graph.js';

import type { PackageIdentity } from './package-identity.js';
import type { RepoGroupManager } from './repo-group-manager.js';
import type { LanguageProvider } from '@code-analyzer/analyzer';
import type {
  Contract,
  GraphEdge,
  GraphNode,
  GroupRepo,
  NodeLabel,
  PipelineContext,
  UnifiedCapture,
} from '@code-analyzer/shared';

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
  /**
   * Index each repository with **the pipeline** as well as with this class's own pass (default false).
   *
   * **This is the difference between a workspace that holds files and one that holds a call graph.** The pass below
   * builds `File` nodes, symbols and named `IMPORTS` edges, and nothing else - so `CALLS`, `DEFINES`, `CONTAINS`,
   * `TESTS` and the inheritance relations do not exist in a workspace, and the answer surface has no neighbour to
   * expand along. Measured on four released checkouts: 1 201 `IMPORTS` edges and **0 `CALLS`**.
   *
   * It is an option rather than the default because the pipeline reads every file with a grammar and takes minutes on
   * a large tree, while the pass below takes seconds - and a caller who only wants "who imports whom" should not pay
   * for a call graph.
   */
  pipeline?: boolean;
  /**
   * Run the pipeline's **embedding** phase as well (default false).
   *
   * **An index a quota can change is not a fixture.** The embedding phase resolves its backend through a chain that
   * ends at the network when `ZHIPU_API_KEY` is set, so on a machine with the key a workspace index of four
   * checkouts becomes a few thousand API calls that can fail the run for a reason that has nothing to do with the
   * code. Nothing in a workspace reads the vectors either: its search is lexical, and `registerEmbeddings` is never
   * called for it. The phase is therefore **not run**, and a caller that wants the vectors can ask for them.
   */
  embed?: boolean;
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
  /**
   * The store's edges by relation, after indexing.
   *
   * **A census is the only way to state what a workspace can answer.** `totalEdges` says 1 201 and cannot say that
   * every one of them is an import, which is the fact that decided what the product could do with a workspace for
   * three iterations. Written by every indexing path so a gate can read a number rather than a claim.
   */
  edgesByType: Record<string, number>;
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
  /** Symbols that were specifically analyzed. Empty means all symbols in changed repo. */
  changedSymbols?: string[];
  analysis: {
    repo: string;
    affectedSymbols: string[];
    /** Files in `repo` whose import statement names a changed symbol. Empty when the whole repository was asked for. */
    affectedFiles: string[];
    impactLevel: 'critical' | 'high' | 'medium' | 'low';
    reason: string;
  }[];
}

/** A single dependency trace from one symbol to another across repos. */
export interface SymbolDependencyTrace {
  sourceRepo: string;
  sourceSymbol: string;
  sourceFile: string;
  targetRepo: string;
  targetSymbol: string;
  targetFile: string;
  dependencyType: string;
  depth: number;
  confidence: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.next',
  'target',
  '.cache',
  '.idea',
  '.vscode',
  'coverage',
  '.nyc_output',
]);

const SKIP_FILE_PATTERNS = [/^\./, /\.min\.(js|css)$/, /\.d\.ts$/];

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.pyi',
  '.go',
  '.java',
  '.kt',
  '.kts',
  '.cs',
  '.rs',
  '.c',
  '.h',
  '.cpp',
  '.cc',
  '.cxx',
  '.hpp',
  '.hh',
  '.php',
  '.rb',
  '.swift',
  '.dart',
  '.lua',
  '.scala',
  '.zig',
  '.ex',
  '.exs',
]);

/**
 * The languages this workspace indexes, **derived from the extensions its own discovery admits**.
 *
 * **Two readers, one scope, and the scope is the narrower one.** The pipeline's scanner admits `.md`, `.html`, `.yml`
 * and `.json` because a repository contains them; `discoverFiles` above admits none of them. Merging the pipeline's
 * graph without saying so made a workspace answer "where does express mount middleware" with `Charter.md:22` and
 * `History.md:1502` — and pushed the file the question is about out of the nine slots a twelve-block context has.
 * The derivation is by extension rather than by a list, so the two cannot drift.
 */
const WORKSPACE_LANGUAGES: ReadonlySet<string> = new Set(
  [...SOURCE_EXTENSIONS]
    .map((extension) => getLanguageFromFilename(`file${extension}`))
    .filter((language): language is NonNullable<typeof language> => language !== null),
);

// ---------------------------------------------------------------------------
// CrossRepoIndexer
// ---------------------------------------------------------------------------

/**
 * One repository as the linker sees it: the group's entry for it and **the packages its manifest declares**.
 *
 * The two travel together because a specifier is resolved against a checkout's *manifest*, not against its name, and
 * every step of the resolution needs both halves at once.
 */
interface RepoScope {
  readonly repo: GroupRepo;
  readonly identities: readonly PackageIdentity[];
}

export class CrossRepoIndexer {
  constructor(
    private store: InMemoryGraphStore,
    private groupManager: RepoGroupManager,
    /**
     * **How a language's parser is obtained, with the production loader as the default.**
     *
     * **Whether a grammar loads is a fact about the machine** — a native `.node` binary that was built for another
     * platform, a package that failed to install — so **neither "the parser is absent" nor "the parser threw" can be
     * reached by writing a test**. With the seam both are ordinary cases, and the regex fallback below is exercised
     * for the reason it exists rather than being an eighty-line path nothing has ever run.
     */
    private loadProvider: (
      language: string,
    ) => Promise<LanguageProvider | null> = getOrLoadProvider,
  ) {}

  /** Public accessor for the underlying graph store (used by incremental reindexer). */
  getStore(): InMemoryGraphStore {
    return this.store;
  }

  /** Public accessor for the group manager (used by incremental reindexer). */
  getGroupManager(): RepoGroupManager {
    return this.groupManager;
  }

  // -----------------------------------------------------------------------
  // Indexing
  // -----------------------------------------------------------------------

  /**
   * Index all repositories in a group.
   * Runs indexing with configurable concurrency.
   */
  async indexGroup(groupId: string, options: IndexOptions = {}): Promise<IndexResult> {
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
        edgesByType: {},
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
          // **`err` is an `Error`**: everything `indexSingleRepo` can reject with is one — `new Error` for a missing
          // path, and Node's own errors for a failed `readdir` or `readFileSync`. The `String(err)` arm that stood here
          // could not fire, and an arm that cannot fire reads as if a string could arrive from a place that never
          // sends one.
          errors.push(`Failed to index ${repo.fullName}: ${(err as Error).message}`);
        }
      });
      await Promise.all(promises);
    }

    // `indexSingleRepo` keys a repo's nodes by the repo's `fullName`; the cross-repo analysis looks them up
    // through `repo.projectId`, so the group has to record what was used. Without this every repository stays
    // `projectId: null` and the analysis finds nothing.
    for (const repo of repos) {
      this.groupManager.setRepoProjectId(groupId, repo.fullName, repo.fullName);
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
      edgesByType: this.censusOfEdges(),
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
      edgesByType: this.censusOfEdges(),
    };
  }

  /** The store's edges by relation, sorted by relation so two runs print the same string. */
  censusOfEdges(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const edge of this.store.getAllEdges()) {
      counts[edge.type] = (counts[edge.type] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Index a single repo directory — discover files, extract symbols,
   * and populate the graph store.
   * Made public for use by IncrementalReindexer.
   */
  async indexSingleRepo(
    projectId: string,
    localPath: string,
    options: IndexOptions,
  ): Promise<void> {
    if (!existsSync(localPath)) {
      throw new Error(`Path does not exist: ${localPath}`);
    }

    const files = await this.discoverFiles(localPath, options);

    const langFilter = options.languages ? new Set(options.languages) : null;
    const selected = langFilter ? files.filter((f) => langFilter.has(f.language)) : files;

    // **The structural half, when the caller asked for it.** The pipeline's graph is merged first, so every `File`
    // node it created already exists when the pass below asks for one - and `ensureFileNode` then writes nothing,
    // which is what keeps one file to one node.
    const deferred = options.pipeline
      ? await this.indexWithPipeline(projectId, localPath, options)
      : [];

    // Two passes, because an edge can point at a file that has not been visited yet: create every File node
    // first, then resolve the imports. Building an edge as each file is visited meant the target's node did not
    // exist yet, so no import ever resolved and `totalEdges` stayed at zero.
    for (const file of selected) {
      if (!options.pipeline) {
        // **The pipeline's symbols are the ones the graph keeps** when it ran: it asks the language's grammar for
        // kinds, ranges and bodies, where the fallback below reads a list of JavaScript-shaped regexes.
        try {
          const content = readFileSync(file.filePath, 'utf-8');
          const symbols = await this.extractSymbols(
            file.filePath,
            content,
            projectId,
            localPath,
            file.language,
          );
          this.insertNodes(projectId, symbols);
        } catch {
          // Skip files that can't be read or parsed
        }
      }
      this.ensureFileNode(projectId, file.filePath, localPath, file.language);
    }

    // **What this repository can be called, read once per checkout** rather than once per file: the manifests are
    // small, but `indexSingleRepo` visits thousands of files and a repository does not change identity mid-index.
    const identities = detectPackageIdentities(localPath);

    for (const file of selected) {
      try {
        const content = readFileSync(file.filePath, 'utf-8');
        // Extract imports and create edges. Pass the repo-relative path so it
        // matches the `filePath` stored on File nodes.
        const imports = await this.extractImports(file.language, content);
        this.createImportEdges(projectId, relative(localPath, file.filePath), imports, {
          localPath,
          identities,
        });
      } catch {
        // Skip files whose imports can't be read
      }
    }

    // **Last, because it is the fallback for the pass above.** A deferred pair is an import the pipeline resolved and
    // this class's own reader did not - a Java or Kotlin package name, most often - so it is inserted only where the
    // workspace has no edge for that pair at all.
    this.insertDeferredImports(projectId, deferred);
  }

  /**
   * A repository indexed by the pipeline, merged into the workspace store.
   *
   * Returns the deferred import pairs as **store ids**, so the caller can insert them after its own import pass has
   * had its say.
   */
  private async indexWithPipeline(
    projectId: string,
    localPath: string,
    options: IndexOptions,
  ): Promise<Array<{ source: number; target: number }>> {
    const config = getDefaultConfig();
    config.projectId = projectId;
    config.rootPath = localPath;

    // **The context a phase needs, built the way the CLI learned to build it.** `execute` fills in `phaseData` and
    // `graph` itself, and repairs a missing `rootPath` - so the only two fields that must be right here are the two
    // the pipeline indexes: which project, and which directory.
    const context = {
      projectId,
      rootPath: localPath,
      config,
      signal: new AbortController().signal,
      metadata: {},
    } as unknown as PipelineContext;

    // **Every phase but one, and the one left out is the one that reaches the network.** `embed` depends on `dump`
    // and nothing depends on `embed`, so removing it leaves the DAG valid and every structural relation intact.
    const phases = createAllPhases().filter(
      (phase) => options.embed === true || phase.id !== 'embed',
    );

    const result = await new PipelineOrchestrator(phases).execute(context);
    const merged = mergePipelineGraph(result.graph, {
      rootPath: localPath,
      projectId,
      languages: WORKSPACE_LANGUAGES,
    });

    const ids: number[] = [];
    for (const node of merged.nodes) {
      // **A second pass over one checkout re-uses the nodes the first wrote.** `insertNode` refuses a qualified name
      // it already holds, and an edge that skipped the node would dangle - so the id is looked up rather than the
      // node being inserted twice.
      const existing = this.store.getNodeByQualifiedName(node.qualifiedName);
      ids.push(existing ? existing.id : this.store.insertNode(node));
    }

    const now = new Date().toISOString();
    for (const edge of merged.edges) {
      // Invariant: every index in `merged.edges` came from the map `mergePipelineGraph` built over these nodes, so
      // both endpoints exist and `insertEdge` cannot reject the pair.
      this.store.insertEdge({
        projectId,
        sourceId: ids[edge.source]!,
        targetId: ids[edge.target]!,
        type: edge.type,
        properties: edge.properties,
        weight: edge.weight,
        createdAt: now,
      });
    }

    return merged.deferredImports.map((pair) => ({
      source: ids[pair.source]!,
      target: ids[pair.target]!,
    }));
  }

  /** Insert the pipeline's import pairs where this class's reader resolved nothing. */
  private insertDeferredImports(
    projectId: string,
    pairs: ReadonlyArray<{ source: number; target: number }>,
  ): void {
    const now = new Date().toISOString();
    for (const pair of pairs) {
      const already = this.store
        .getEdgesForNode(pair.source, EDGE_IMPORTS)
        .some((edge) => edge.targetId === pair.target);
      if (already) continue;

      this.store.insertEdge({
        projectId,
        sourceId: pair.source,
        targetId: pair.target,
        type: EDGE_IMPORTS,
        // **`resolution: 'pipeline'` rather than `'path'`**, so a consumer can tell an edge whose names are unknown
        // from one whose names this subsystem read. `importedSymbols` is absent rather than `[]` for the same reason:
        // absent says "not read", and an empty list says "read and empty", which is a different claim.
        properties: { resolution: 'pipeline', scope: 'repo' },
        weight: 1,
        createdAt: now,
      });
    }
  }

  /**
   * Discover source files recursively in a directory.
   */
  private async discoverFiles(
    rootPath: string,
    _options: IndexOptions,
  ): Promise<{ filePath: string; language: string }[]> {
    const results: { filePath: string; language: string }[] = [];
    await this.walkDirectory(rootPath, rootPath, results);
    return results;
  }

  private async walkDirectory(
    rootPath: string,
    currentPath: string,
    results: { filePath: string; language: string }[],
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      // Skip directories that cannot be read (missing or permission-denied).
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

        const ext = name.lastIndexOf('.') >= 0 ? name.slice(name.lastIndexOf('.')) : '';
        if (!SOURCE_EXTENSIONS.has(ext)) continue;

        // Invariant: every entry in SOURCE_EXTENSIONS maps to a non-null language
        // in getLanguageFromFilename, so the null branch is unreachable here.
        const language = getLanguageFromFilename(fullPath)!;

        let fileStat;
        try {
          fileStat = await stat(fullPath);
        } catch {
          // Skip files that vanish or become unreadable mid-walk.
          continue;
        }

        if (fileStat.size > 5 * 1024 * 1024) continue; // Skip >5MB files

        results.push({ filePath: fullPath, language });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Symbol Extraction (lightweight, regex-based)
  // -----------------------------------------------------------------------

  /**
   * A file's symbols, **asked of the language's parser first**.
   *
   * **The regexes below are a fallback and were the only path.** `.py` is in `SOURCE_EXTENSIONS`, so a python file was
   * admitted - **and every pattern here is a javascript shape**, so `energy.py` became a file node and
   * `compute_kinetic_energy` never became a symbol. **An end-to-end test over three repositories in three languages
   * is what made that visible**, and it is why this method now asks `getOrLoadProvider` before falling back.
   *
   * **The fallback stays**, because a provider may be absent for a language the extension list still admits - **and a
   * partial answer under a known narrower rule is better than none.** What changed is which of the two is tried
   * first, and the answer for the 31 languages the pipeline already supports.
   */
  /**
   * A provider's captures as graph nodes.
   *
   * **Only the capture tags that name a symbol become nodes.** A capture list also carries docstrings, imports and
   * call sites, and those are not nodes. **The mapping is by tag rather than by guessing from the text**, which is
   * the whole reason to ask a parser instead of a regex.
   *
   * **The docstring of a symbol is kept, and it is what a question is answered from.** Every node here used to be
   * written with `docstring: null`, and the search index is built from name, qualified name, signature and docstring -
   * so a cross-repository workspace answered questions from identifiers alone. The acceptance case on four released
   * checkouts is what made that visible: the express application's methods are named `use`, `route` and `handle`, the
   * word that describes them ("middleware") lives in the comment above each one, and no question using that word
   * could reach the file. **The comment above a declaration is attached to the declaration that follows it**, which is
   * the rule the pipeline's own walk uses.
   */
  private nodesFromCaptures(
    captures: UnifiedCapture[],
    relPath: string,
    projectId: string,
    language: string,
    now: string,
  ): GraphNode[] {
    const labelFor: Record<string, NodeLabel> = {
      [CAPTURE_TAGS.FUNCTION_DEF]: 'Function',
      [CAPTURE_TAGS.CLASS_DEF]: 'Class',
      [CAPTURE_TAGS.INTERFACE_DEF]: 'Interface',
      [CAPTURE_TAGS.TYPE_DEF]: 'TypeAlias',
      [CAPTURE_TAGS.ENUM_DEF]: 'Enum',
      [CAPTURE_TAGS.METHOD_DEF]: 'Method',
      [CAPTURE_TAGS.VARIABLE_DEF]: 'Variable',
    };

    const nodes: GraphNode[] = [];
    const seen = new Set<string>();
    /** The last doc comment seen, waiting for the declaration it documents. **Consumed once.** */
    let pending: { text: string; endLine: number } | null = null;

    for (const capture of captures) {
      if (String(capture.tag) === CAPTURE_TAGS.DOCSTRING) {
        const text = typeof capture.text === 'string' ? capture.text.trim() : '';
        if (text.length > 0) {
          pending = { text, endLine: Number(capture.endLine) || Number(capture.startLine) || 0 };
        }
        continue;
      }

      const label = labelFor[String(capture.tag)];
      if (!label) continue;
      const name = typeof capture.name === 'string' ? capture.name : '';
      if (name.length === 0) continue;
      // **A declaration can be captured twice** and the graph wants one node per name per file.
      if (seen.has(name)) continue;
      seen.add(name);

      const startLine = Number(capture.startLine) || 1;
      const endLine = Number(capture.endLine) || startLine;
      // **A comment belongs to the declaration that follows it, across one blank line.** Two lines of gap, so one
      // blank line is allowed and two are not - and the allowance is there because writing a JSDoc block, a blank
      // line, and then the declaration is a real convention rather than an accident: express's `lib/application.js`
      // does it for every method it defines, and a rule that refused it left `app.use` - the function whose comment
      // says "add middleware to the app router" - with no documentation at all, which is why no question containing
      // that word could reach it. **Two blank lines is a paragraph break**, and a comment above one of those belongs
      // to the file rather than to the declaration below.
      const docstring = pending && startLine - pending.endLine <= 2 ? pending.text : null;
      pending = null;

      nodes.push({
        id: 0, // Will be assigned by store
        projectId,
        label,
        name,
        qualifiedName: `project:${projectId}:${relPath}:${name}`,
        filePath: relPath,
        startLine,
        endLine,
        language,
        properties: { name, filePath: relPath, startLine, endLine, language },
        signature: null,
        docstring,
        complexity: null,
        isExported: false,
        fingerprint: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    return nodes;
  }

  private async extractSymbols(
    filePath: string,
    content: string,
    projectId: string,
    rootPath: string,
    language: string,
  ): Promise<GraphNode[]> {
    const relPath = relative(rootPath, filePath);
    const now = new Date().toISOString();

    // **The provider's answer, when there is one.** The captures carry the symbol kinds and the byte ranges, which is
    // what the graph wants; the regexes below produce only names.
    try {
      const provider = await this.loadProvider(language);
      if (provider) {
        const captures = provider.parse(content, filePath);
        const fromProvider = this.nodesFromCaptures(captures, relPath, projectId, language, now);
        if (fromProvider.length > 0) return fromProvider;
      }
    } catch {
      // A provider that throws is the fallback's reason to exist, not an error to propagate: this method's contract
      // is symbols for a file, and it can still keep it.
    }

    const nodes: GraphNode[] = [];

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
        // Invariant: every funcPattern captures `\w+`, so match[1] is non-empty.
        const name = match[1]!;
        if (seen.has(name)) continue;
        seen.add(name);

        const lineNum = this.getLineNumber(content, match.index);
        const isExported = content
          .slice(Math.max(0, match.index - 50), match.index)
          .includes('export');

        let label: NodeLabel = 'Function';
        if (pattern.source.includes('class')) label = 'Class';
        else if (pattern.source.includes('interface')) label = 'Interface';
        else if (pattern.source.includes('type\\s+')) label = 'TypeAlias';
        else if (pattern.source.includes('enum')) label = 'Enum';
        else if (pattern.source.includes('public') || pattern.source.includes('private'))
          label = 'Method';

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
   * A file's imports, read by the language's own grammar.
   *
   * **This used to be a list of JavaScript-and-Python regexes, and on a Python tree it was wrong.** Python's
   * `from werkzeug.exceptions import (\n  BadRequest,\n)` — the form flask uses on every multi-name import — made
   * the name list `(`, because `[^\n]+` stops at the first line break. Multi-line parenthesised imports are the
   * majority in `src/flask/app.py`, so the names that symbol-level impact filters on were punctuation.
   *
   * **`LanguageProvider.extractImports` is the same reader the main pipeline uses**, so a Python file's imports are
   * the grammar's answer here and in the graph the rest of the product is built from. The regexes survive only for
   * the case they exist for: a machine where the grammar is not installed.
   */
  private async extractImports(
    language: string,
    content: string,
  ): Promise<Array<{ modulePath: string; importedNames: string[] }>> {
    try {
      const provider = await this.loadProvider(language);
      if (provider) {
        return provider.extractImports(content).map((imp) => ({
          modulePath: imp.source,
          // **`import werkzeug.serving` imports a module, not a name**, and the module's members become reachable
          // through the binding. Recording the bound segment (`werkzeug`) instead made every question about
          // `run_simple` unanswerable, because the edge did not mention it; `*` is the same convention the regex
          // reader already used for this shape, and it is read as "any name in this file".
          importedNames: imp.type === 'namespace' || imp.type === 'wildcard' ? ['*'] : imp.names,
        }));
      }
    } catch {
      // A provider that throws is the fallback's reason to exist, not an error to propagate.
    }
    return this.extractImportsByPattern(content);
  }

  /** The regex reader, used only when this machine has no grammar for the language. */
  private extractImportsByPattern(
    content: string,
  ): Array<{ modulePath: string; importedNames: string[] }> {
    const imports: Array<{ modulePath: string; importedNames: string[] }> = [];

    // Match: import { a, b } from 'module'
    const namedImportRe = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = namedImportRe.exec(content)) !== null) {
      // Invariant: `\{([^}]+)\}` always captures a non-empty name list.
      const names = match[1]!
        .split(',')
        .map((s) => s.trim().replace(/^(\w+)\s+as\s+\w+$/, '$1'))
        .filter(Boolean);
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

    // Match: require('module') and const { a, b } = require('module').
    // The optional group matches either the destructuring binding ({ a, b } =)
    // or the plain variable binding (name =), so match[1] is undefined for a
    // non-destructured require.
    const requireRe =
      /(?:const|let|var)\s+(?:\{([^}]+)\}\s*=\s*|\w+\s*=\s*)?require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRe.exec(content)) !== null) {
      const names =
        match[1]
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) ?? [];
      imports.push({ modulePath: match[2]!, importedNames: names });
    }

    // Match: from 'module' import ... (Python)
    //
    // **`([^'"]+)` crossed line breaks**, so on a file with one `from … import …` line the greedy capture ran to the
    // last ` import ` in the file: `from .helpers import shout\nimport os` yielded the module *`.helpers import shout`*
    // and the name *`os`*. A module specifier contains no whitespace, which is what the class now says.
    const pyImportRe = /from\s+['"]?([^\s'"]+)['"]?\s+import\s+([^\n]+)/g;
    while ((match = pyImportRe.exec(content)) !== null) {
      const names = match[2]!
        .split(',')
        .map((s) =>
          s
            .trim()
            .replace(/\s+as\s+\w+/, '')
            .trim(),
        )
        .filter(Boolean);
      imports.push({ modulePath: match[1]!, importedNames: names });
    }

    // Match: import module (Python)
    const pyImportSimpleRe = /^import\s+([^\n]+)/gm;
    while ((match = pyImportSimpleRe.exec(content)) !== null) {
      const names = match[1]!
        .split(',')
        .map((s) =>
          s
            .trim()
            .split(/\s+as\s+/)[0]!
            .trim(),
        )
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
  async resolveCrossRepoSymbols(groupId: string): Promise<CrossRepoSymbolMatch[]> {
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
        const symbolsA = repoSymbols.get(repoA)!;
        const symbolsB = repoSymbols.get(repoB)!;

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
        const symbolsB = repoSymbols.get(repoB)!;

        // Get all imports from repo A's nodes
        for (const nodeA of nodesA) {
          if (nodeA.label !== 'File') continue;
          const edges = this.store.getEdgesForNode(nodeA.id, EDGE_IMPORTS);
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
    const routeA = symA.properties.routePath;
    const routeB = symB.properties.routePath;
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

    // Cross-repo imports can only be resolved here. `indexSingleRepo` runs repositories concurrently, so when
    // `api-gateway` resolves `../../user-service/…` the sibling's nodes may not exist yet — and the loop below
    // only upgrades edges whose target lies in another project, so an import that never resolves can never be
    // seen there.
    await this.linkCrossRepoImports(group.repos);

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
          // **A cross-repo edge is not an input to this pass.** Building the graph a second time is a supported
          // call — `indexGroup` builds it, and a caller that wants a fresh report builds it again — and without
          // this line the second pass upgraded the first pass's `CROSS_REPO_IMPORTS` edges into
          // `CROSS_REPO_DEPENDS` ones. Measured on the flask/werkzeug pair: one call reported 49 cross-repository
          // edges, two calls reported 147.
          if (edge.type.startsWith('CROSS_REPO_')) continue;

          const targetNode = this.store.getNode(edge.targetId);
          if (!targetNode) continue;

          const repoB = targetNode.projectId;
          if (repoB === repoA) continue;
          if (!repos.includes(repoB)) continue;

          // Determine cross-repo relationship type
          let crossRepoType: string;
          switch (edge.type) {
            case EDGE_IMPORTS:
              crossRepoType = EDGE_CROSS_REPO_IMPORTS;
              break;
            case EDGE_CALLS:
              crossRepoType = EDGE_CROSS_REPO_CALLS;
              break;
            case EDGE_IMPLEMENTS:
              crossRepoType = EDGE_CROSS_REPO_IMPLEMENTS;
              break;
            default:
              crossRepoType = EDGE_CROSS_REPO_DEPENDS;
          }

          // Create cross-repo node if not exists
          this.ensureCrossRepoNode(repoA, crossRepoType, now);

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
              // **What the import statement asked for travels with the upgrade.** The cross-repo edge is the one
              // every downstream question reads — impact, trace, the dashboard — and without these two fields it
              // could say "some file in flask imports some file in werkzeug" and nothing more: measured, the
              // symbol-filtered impact answer for `BadRequest` was an empty set while 23 statements named it.
              //
              // `properties` is not optional on an edge, so the `?? {}` that stood here was a fallback for a state
              // the type excludes.
              ...edge.properties,
            },
            weight: edge.weight,
            createdAt: now,
          };

          // Invariant: insertEdge only throws when an endpoint is missing, and both
          // nodeA (from getRepoNodes) and targetNode (non-null above) are guaranteed
          // to exist, so this insert cannot throw.
          this.store.insertEdge(crossRepoEdge);
          crossRepoEdges++;
          byType[crossRepoType] = (byType[crossRepoType] ?? 0) + 1;
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
      const interfaces = nodes.filter((n) => n.label === 'Interface' || n.label === 'TypeAlias');
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

      // Invariant: every repo in `contractingRepos` contributed an interface named
      // `name` to `seeNameCount`, so `find` on the first repo is guaranteed to match.
      const sampleRepo = contractingRepos[0]!;
      const sampleIface = repoInterfaces.get(sampleRepo)!.find((i) => i.name === name)!;
      definition['sampleRepo'] = sampleRepo;
      definition['sampleQualifiedName'] = sampleIface.qualifiedName;

      contracts.push({
        id: `contract:${groupId}:${contractCounter}`,
        name,
        // **`String(...)` because the definition bag is `Record<string, unknown>`**: a template literal would
        // interpolate whatever was stored there, and the reported kind is a word rather than an object.
        description: `Shared ${String(definition['kind'])} contract detected across ${contractingRepos.length} repos`,
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
    const nodeA = this.findSymbolAcrossRepos(
      group.repos.map((r) => r.fullName),
      symbolA,
    );
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
      breakingChanges.push(`Type mismatch: ${nodeA.node.label} vs ${nodeB.node.label}`);
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
        warnings.push(`Signature changed: "${nodeA.node.signature}" → "${nodeB.node.signature}"`);
      }
    }

    // Compare return types
    if (propsA.returnType && propsB.returnType && propsA.returnType !== propsB.returnType) {
      warnings.push(`Return type changed: ${propsA.returnType} → ${propsB.returnType}`);
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
   * @param changedSymbols - Optional filter: only trace impact from these specific symbols
   */
  async analyzeCrossRepoImpact(
    groupId: string,
    changedRepoId: string,
    changedSymbols?: string[],
  ): Promise<CrossRepoImpactResult> {
    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    const repos = group.repos.map((r) => r.fullName);
    if (!repos.includes(changedRepoId)) {
      throw new Error(`Changed repo "${changedRepoId}" is not in group "${groupId}"`);
    }

    const analysis: CrossRepoImpactResult['analysis'] = [];
    const affectedRepos = new Set<string>();

    /*
     * **The names and the set they are matched against are one value, because they are never independent.**
     *
     * They were two: a `Set` for matching, plus the raw array read at four places as `changedSymbols ?? []`. **Not one
     * of those four fallbacks could fire** — the set is non-null only when the array is non-empty — so four arms no
     * test could reach were being counted as if a test were missing. Carrying both in one object turns that from a
     * convention into a fact the type checker states.
     */
    const scope =
      changedSymbols !== undefined && changedSymbols.length > 0
        ? {
            names: changedSymbols,
            lowered: new Set(changedSymbols.map((symbol) => symbol.toLowerCase())),
          }
        : null;

    /*
     * **The walk starts at the declaring file, not at the symbol.**
     *
     * A cross-repository import edge is anchored to files — `werkzeug/http.py` → `flask/wrappers.py` — because an
     * import statement names a module, not a symbol. Starting the BFS at the `Class` node for `BadRequest` therefore
     * found nothing at all: measured on flask 3.0.3 + werkzeug 3.0.3, `analyzeCrossRepoImpact("werkzeug",
     * ["BadRequest"])` returned an empty `affectedRepos` while 23 import statements named `werkzeug.exceptions`.
     * The symbol decides *which* file to start from and *which* imported names count; it does not replace the edge.
     */
    const startIds = scope
      ? new Set([
          ...this.filesExposing(changedRepoId, scope.names),
          ...this.symbolNodeIds(changedRepoId, scope.names),
        ])
      : null;

    // BFS from changed repo along cross-repo edges
    const visited = new Set<string>();
    const queue: Array<{ repo: string; depth: number }> = [];
    queue.push({ repo: changedRepoId, depth: 0 });
    visited.add(changedRepoId);

    // Track which symbols in affected repos are actually impacted, and in which files
    const affectedSymbolMap = new Map<string, Set<string>>();
    const affectedFileMap = new Map<string, Set<string>>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.repo !== changedRepoId) {
        const specificSymbols = affectedSymbolMap.get(current.repo);
        const recorded = specificSymbols !== undefined && specificSymbols.size > 0;
        // With a symbol filter, a repository the filter reached through an unrelated import is not affected by
        // *this* change — reporting it would be the "everything depends on everything" answer that makes impact
        // analysis useless.
        if (scope === null || recorded) {
          affectedRepos.add(current.repo);

          let impactLevel: 'critical' | 'high' | 'medium' | 'low' = 'low';
          if (current.depth === 1) impactLevel = 'high';
          else if (current.depth === 2) impactLevel = 'medium';

          analysis.push({
            repo: current.repo,
            affectedSymbols: recorded
              ? Array.from(specificSymbols).sort()
              : this.getSymbolsInRepo(current.repo).map((n) => n.name),
            affectedFiles: Array.from(affectedFileMap.get(current.repo) ?? []).sort(),
            impactLevel,
            reason: `Repo "${current.repo}" depends on "${changedRepoId}" through cross-repo ${current.depth === 1 ? 'direct' : 'transitive'} dependencies`,
          });
        }
      }

      if (current.depth >= 3) continue;

      // Find all repos this repo depends on via cross-repo edges
      const nodes = this.getRepoNodes(current.repo);
      for (const node of nodes) {
        // When the symbol filter is active at depth 0, only traverse the files that declare the changed symbols
        if (current.depth === 0 && startIds && !startIds.has(node.id)) {
          continue;
        }

        const edgesOut = this.store.getEdgesForNode(node.id);
        for (const edge of edgesOut) {
          if (!edge.type.startsWith('CROSS_REPO_')) continue;
          const targetNode = this.store.getNode(edge.targetId);
          if (!targetNode) continue;
          const targetRepo = targetNode.projectId;

          if (current.repo === changedRepoId) {
            // **What the importer asked for**, read from the edge: the earlier version recorded the *importing
            // file's basename* as an "affected symbol", so a change to `werkzeug.exceptions` reported
            // `app.py, ctx.py, helpers.py` as the symbols flask had lost.
            const imported = this.importedNames(edge);
            const matched =
              scope === null
                ? imported
                : imported.length === 0
                  ? // **An edge that records no names cannot be filtered on them.** `CROSS_REPO_CALLS` and
                    // `CROSS_REPO_IMPLEMENTS` run symbol-to-symbol and carry no `importedSymbols`; treating the
                    // missing list as "nothing matched" silently dropped every one of them.
                    scope.names
                  : imported.includes('*')
                    ? scope.names.filter((name) => scope.lowered.has(name.toLowerCase()))
                    : imported.filter((name) => scope.lowered.has(name.toLowerCase()));

            if (matched.length > 0) {
              const symbols = affectedSymbolMap.get(targetRepo) ?? new Set<string>();
              for (const name of matched) symbols.add(name);
              affectedSymbolMap.set(targetRepo, symbols);

              const files = affectedFileMap.get(targetRepo) ?? new Set<string>();
              if (targetNode.filePath) files.add(targetNode.filePath);
              affectedFileMap.set(targetRepo, files);
            }
          }

          if (visited.has(targetRepo)) continue;
          visited.add(targetRepo);
          queue.push({ repo: targetRepo, depth: current.depth + 1 });
        }
      }
    }

    return {
      changedRepo: changedRepoId,
      // The same condition the walk used, read from the value it produced rather than re-tested here.
      changedSymbols: scope?.names,
      affectedRepos: Array.from(affectedRepos),
      analysis,
    };
  }

  /**
   * The `File` nodes through which the named symbols are reachable, following **re-exports**.
   *
   * **A symbol's blast radius is carried by files, and a file is not always the one that declares it.** `Request`
   * is declared in `werkzeug/wrappers/request.py`, imported by `werkzeug/wrappers/__init__.py`, re-exported by
   * `werkzeug/__init__.py`, and imported *from there* by flask. Starting the walk at the declaring file therefore
   * reached nothing for every one of flask's `from werkzeug import Request` statements — 18 of the 49 measured
   * import pairs on flask 3.0.3 + werkzeug 3.0.3 — because the edge into flask hangs off the re-exporting file.
   *
   * **The walk is bounded by the symbol set, not by a depth**, and the set only grows, so it terminates.
   */
  private filesExposing(repoId: string, symbols: string[]): Set<number> {
    const nodes = this.getRepoNodes(repoId);
    const filesByPath = new Map<string, GraphNode>();
    for (const node of nodes) {
      if (node.label === 'File' && node.filePath) filesByPath.set(node.filePath, node);
    }

    // file id → the symbols of interest that this file exposes
    const exposed = new Map<number, Set<string>>();
    for (const symbol of symbols) {
      const lower = symbol.toLowerCase();
      for (const node of nodes) {
        if (node.label === 'File') continue;
        if (!matchesSymbol(node, lower)) continue;
        const file = node.filePath === null ? undefined : filesByPath.get(node.filePath);
        if (!file) continue;
        const set = exposed.get(file.id) ?? new Set<string>();
        set.add(lower);
        exposed.set(file.id, set);
      }
    }

    const queue = [...exposed.keys()];
    while (queue.length > 0) {
      const fileId = queue.shift()!;
      const carried = exposed.get(fileId)!;

      // Intra-repository edges run importer → imported, so `in` edges are the files that import this one.
      for (const edge of this.store.getEdgesForNode(fileId, EDGE_IMPORTS, 'in')) {
        // An edge with no `scope` predates the field and is an intra-repository import — the only kind that
        // existed when it was written.
        if ((edge.properties?.['scope'] ?? 'repo') !== 'repo') continue;
        const shared = this.importedNames(edge)
          .map((name) => name.toLowerCase())
          .filter((name) => carried.has(name));
        if (shared.length === 0) continue;

        const importer = edge.sourceId;
        const names = exposed.get(importer) ?? new Set<string>();
        const before = names.size;
        for (const name of shared) names.add(name);
        exposed.set(importer, names);
        if (names.size > before) queue.push(importer);
      }
    }

    return new Set(exposed.keys());
  }

  /**
   * The nodes that carry the named symbols themselves.
   *
   * **Some cross-repository edges are symbol-to-symbol** — `CROSS_REPO_CALLS` runs from a function in one
   * repository to the function it calls in another, and nothing about that edge involves a file. A walk that
   * started only from `File` nodes could not see them at all.
   */
  private symbolNodeIds(repoId: string, symbols: string[]): Set<number> {
    const ids = new Set<number>();
    const lowered = symbols.map((symbol) => symbol.toLowerCase());
    for (const node of this.getRepoNodes(repoId)) {
      if (node.label === 'File') continue;
      if (lowered.some((lower) => matchesSymbol(node, lower))) ids.add(node.id);
    }
    return ids;
  }

  /** The names an import statement asked for, as recorded on its edge. */
  private importedNames(edge: GraphEdge): string[] {
    const raw = edge.properties?.['importedSymbols'];
    return Array.isArray(raw) ? raw.map((name) => String(name)) : [];
  }

  /**
   * Trace exact dependency chains from a symbol in one repo to symbols in other repos.
   * Returns precise "symbol X in repo A → symbol Y in repo B" traces via CROSS_REPO_* edges.
   */
  async traceSymbolDependencies(
    groupId: string,
    sourceRepoId: string,
    symbolName: string,
  ): Promise<SymbolDependencyTrace[]> {
    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    const repos = group.repos.map((r) => r.fullName);
    if (sourceRepoId && !repos.includes(sourceRepoId)) {
      throw new Error(`Source repo "${sourceRepoId}" is not in group "${groupId}"`);
    }

    const traces: SymbolDependencyTrace[] = [];

    // An empty `sourceRepoId` means "search every repository in the group", which is how the contract
    // validator asks who consumes a symbol. Rejecting it made this call throw every time, and the caller turns
    // a throw into an empty list — so the answer was always "nobody consumes it".
    const sourceRepos = sourceRepoId ? [sourceRepoId] : repos;

    // Find the symbol node(s), tagged with the repository each belongs to: with an empty source there may be
    // several, and each one's dependents are reached from its own repository.
    const sourceNodes = sourceRepos.flatMap((repo) =>
      this.getRepoNodes(repo)
        .filter(
          (n) =>
            n.name.toLowerCase() === symbolName.toLowerCase() ||
            n.qualifiedName.toLowerCase().includes(symbolName.toLowerCase()),
        )
        .map((node) => ({ repo, node })),
    );

    if (sourceNodes.length === 0) return traces;

    // For each matching source node, follow outgoing CROSS_REPO_* edges
    for (const { repo: sourceRepo, node: sourceNode } of sourceNodes) {
      const edgesOut = this.store.getEdgesForNode(sourceNode.id);

      for (const edge of edgesOut) {
        if (!edge.type.startsWith('CROSS_REPO_')) continue;

        const targetNode = this.store.getNode(edge.targetId);
        if (!targetNode) continue;
        if (targetNode.projectId === sourceRepo) continue;

        const targetRepo = targetNode.projectId;
        if (!repos.includes(targetRepo)) continue;

        // Follow one more level for transitive dependencies
        const transitiveEdges = this.store.getEdgesForNode(targetNode.id);
        for (const tEdge of transitiveEdges) {
          if (!tEdge.type.startsWith('CROSS_REPO_')) continue;
          const transitiveTarget = this.store.getNode(tEdge.targetId);
          if (!transitiveTarget || transitiveTarget.projectId === targetRepo) continue;
          if (!repos.includes(transitiveTarget.projectId)) continue;

          traces.push({
            sourceRepo,
            sourceSymbol: sourceNode.qualifiedName,
            sourceFile: sourceNode.filePath ?? '',
            targetRepo: transitiveTarget.projectId,
            targetSymbol: transitiveTarget.qualifiedName,
            targetFile: transitiveTarget.filePath ?? '',
            dependencyType: `transitive_${tEdge.type}`,
            depth: 2,
            confidence: 'medium',
          });
        }

        traces.push({
          sourceRepo,
          sourceSymbol: sourceNode.qualifiedName,
          sourceFile: sourceNode.filePath ?? '',
          targetRepo,
          targetSymbol: targetNode.qualifiedName,
          targetFile: targetNode.filePath ?? '',
          dependencyType: edge.type,
          depth: 1,
          confidence: 'high',
        });
      }
    }

    // Two relations reach a consumer, and they live at different levels. `CROSS_REPO_CALLS` runs from symbol to
    // symbol — the tests build those by hand. An **import** runs from the file that makes the name available to
    // the file that takes it, which is the only form this pipeline can produce from an import statement. Following
    // only the symbol node missed every importer, so a repository that imports the symbol was never reported.
    //
    // **The files that make the name available include the ones that re-export it.** `from werkzeug import
    // Request` in flask is served by `werkzeug/__init__.py`, not by `wrappers/request.py` where `Request` is
    // declared, so the walk starts from every file in the re-export closure and reports the declaring symbol.
    for (const { repo: declaringRepo, node: declared } of sourceNodes) {
      for (const fileId of this.filesExposing(declaringRepo, [declared.name])) {
        // Read the plain `IMPORTS` edges: they carry the names the importer asked for.
        for (const edge of this.store.getEdgesForNode(fileId, EDGE_IMPORTS)) {
          // **Present because the store refuses an edge whose endpoints are absent** - `insertEdge` throws for an
          // unknown id - so the `if (!importerFile) continue` that stood here guarded a state the storage layer
          // forbids.
          const importerFile = this.store.getNode(edge.targetId)!;
          if (importerFile.projectId === declaringRepo) continue;
          if (!repos.includes(importerFile.projectId)) continue;

          const importedNames = this.importedNames(edge);
          // `*` is a namespace or wildcard import: every name in the file is reachable through it.
          if (
            !importedNames.some((n) => n === '*' || n.toLowerCase() === symbolName.toLowerCase())
          ) {
            continue;
          }

          traces.push({
            sourceRepo: declaringRepo,
            sourceSymbol: declared.qualifiedName,
            sourceFile: declared.filePath ?? '',
            targetRepo: importerFile.projectId,
            targetSymbol: symbolName,
            targetFile: importerFile.filePath ?? '',
            dependencyType: edge.type,
            depth: 1,
            confidence: 'high',
          });

          for (const tEdge of this.store.getEdgesForNode(importerFile.id)) {
            if (!tEdge.type.startsWith('CROSS_REPO_')) continue;
            const transitive = this.store.getNode(tEdge.targetId);
            if (!transitive || transitive.projectId === importerFile.projectId) continue;
            if (!repos.includes(transitive.projectId)) continue;

            traces.push({
              sourceRepo: declaringRepo,
              sourceSymbol: declared.qualifiedName,
              sourceFile: declared.filePath ?? '',
              targetRepo: transitive.projectId,
              targetSymbol: transitive.qualifiedName,
              targetFile: transitive.filePath ?? '',
              dependencyType: `transitive_${tEdge.type}`,
              depth: 2,
              confidence: 'medium',
            });
          }
        }
      }
    }

    return traces;
  }

  /**
   * Get all graph nodes belonging to a specific project/repo.
   * Public method — used by CrossRepoPRReviewEngine and external consumers.
   */
  getRepoNodes(projectId: string): GraphNode[] {
    const result = this.store.queryNodes({
      projectId,
      limit: 500000,
      offset: 0,
    });
    return result.items;
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

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
        // Node may already exist from a previous index pass.
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

    // Invariant: the qualified-name guard above runs synchronously in the same
    // indexing loop, so no duplicate insert can occur and insertNode cannot throw.
    this.store.insertNode({
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
  }

  private createImportEdges(
    projectId: string,
    sourceFile: string,
    imports: Array<{ modulePath: string; importedNames: string[] }>,
    self: { localPath: string; identities: readonly PackageIdentity[] },
  ): void {
    const now = new Date().toISOString();

    const nodes = this.getRepoNodes(projectId);

    for (const imp of imports) {
      // A module specifier is written **relative to the importing file**, while a File node stores a
      // **repo-relative** path. Comparing the two directly never matched: `'src/types.ts'.includes('./types')`
      // is false, so every edge was skipped and `totalEdges` stayed at zero. Resolve first, then compare like
      // with like.
      //
      // **A module can also be named without a path**, which is how a Python package imports itself:
      // `from flask.helpers import send_file` inside `flask/app.py` is not `./helpers`. The same identity that
      // resolves a sibling repository resolves the repository's own package, so the edge exists here too.
      const resolved =
        resolveModulePath(sourceFile, imp.modulePath) ??
        this.resolveOwnPackage(self, imp.modulePath);
      if (!resolved) continue;

      // **A `File` node always carries a path**: `ensureFileNode` writes `relPath`, and the label test above it is what
      // admits the node at all - so the `?? ''` that stood here was a fallback for a state the node cannot be in.
      const targetFileNode = findFileNode(nodes, resolved);

      if (!targetFileNode) continue;

      // Invariant: ensureFileNode() runs immediately before createImportEdges()
      // for the same file, so the source file's File node is always present.
      const sourceFileNode = nodes.find((n) => n.label === 'File' && n.filePath === sourceFile)!;

      // Invariant: both endpoint ids come from getRepoNodes above, so insertEdge
      // cannot throw for a missing node (and edges are not de-duplicated).
      this.store.insertEdge({
        projectId,
        sourceId: sourceFileNode.id,
        targetId: targetFileNode.id,
        type: EDGE_IMPORTS,
        properties: {
          importPath: imp.modulePath,
          importedSymbols: imp.importedNames,
          resolution: 'path',
          // **Which graph this edge belongs to.** Intra-repository imports run importer → imported; cross-repository
          // ones run imported → importer, because every consumer walks *outward* from the thing that changed. The
          // direction alone cannot say which is which, and a walk that guessed wrong followed the dependency
          // downwards and reported the library as the thing that broke.
          scope: 'repo',
        },
        weight: 1,
        createdAt: now,
      });
    }
  }

  /**
   * The repository-relative file a specifier names inside this repository's own package.
   *
   * **A relative specifier never reaches here**: `resolveModulePath` answers for every `.`-prefixed specifier and
   * only returns `null` when the specifier does not start with a dot, so the guard that stood here could not fire.
   */
  private resolveOwnPackage(
    self: { localPath: string; identities: readonly PackageIdentity[] },
    specifier: string,
  ): string | null {
    for (const identity of self.identities) {
      const member = resolvePackageMember(self.localPath, identity, specifier);
      if (member) return member;
    }
    return null;
  }

  /**
   * Resolve imports that point outside their own repository and create the edge. Must run after every
   * repository in the group has been indexed, which is why it is called from `buildCrossRepoGraph` rather than
   * from `indexSingleRepo`.
   *
   * **Two shapes of specifier reach another repository**, and only the first was understood:
   *
   * 1. a path that walks out of the checkout (`../../shared/types`) — the monorepo shape;
   * 2. a **package name** (`werkzeug.wrappers`, `@scope/pkg`, `github.com/foo/bar`, `com.acme.Foo`) — the shape
   *    of two separately released packages, which is what "my other repository" usually means.
   *
   * Measured on flask 3.0.3 + werkzeug 3.0.3, shape 1 resolved nothing and the group graph was empty: 49
   * distinct (file, module) pairs exist and **zero** edges did. Shape 2 is resolved from each repository's own
   * manifest, and the pair is now 49 of 49.
   *
   * **One edge per (imported file, importing file) pair**, carrying every name the importer asked that file for.
   * An edge per statement made the same pair appear up to five times — `from werkzeug.exceptions import A` on one
   * line and `B` on the next — and a consumer counting consumers then counted import statements.
   */
  private async linkCrossRepoImports(repos: GroupRepo[]): Promise<void> {
    const now = new Date().toISOString();

    /*
     * **A repository with no checkout has nothing to resolve against**, and the group allows the state: a group is
     * usually registered before its repositories are cloned. Dropping it once, here, is what lets every step below
     * treat `localPath` as a path rather than as a possibility — and it is why the `if (!localPath) continue` that
     * stood in both resolution loops, plus the `?? ''` beside each, no longer exist.
     *
     * **The group entry and what its manifest declares travel together.** They were two arguments — the list of
     * repositories and a `Map` from name to identities — and the map was read with `?? []` at every use, a fallback
     * for a repository the population loop had already given an entry. Pairing them removes the lookup, and with it
     * the arm that could not fire.
     */
    const scopes: RepoScope[] = [];
    for (const repo of repos) {
      if (!repo.localPath) continue;
      scopes.push({ repo, identities: detectPackageIdentities(repo.localPath) });
    }

    // `imported file` + `importing file` → the import statements that connect them.
    const pairs = new Map<
      string,
      {
        projectId: string;
        sourceId: number;
        targetId: number;
        importPath: string;
        resolution: 'path' | 'package';
        names: Set<string>;
      }
    >();

    for (const { repo } of scopes) {
      const localPath = repo.localPath;
      const projectId = repo.projectId ?? repo.fullName;

      for (const node of this.getRepoNodes(projectId)) {
        if (node.label !== 'File' || !node.filePath) continue;

        let content: string;
        try {
          content = readFileSync(join(localPath, node.filePath), 'utf-8');
        } catch {
          continue;
        }

        const imports = await this.extractImports(node.language ?? '', content);
        for (const imp of imports) {
          const link = this.resolveAcrossRepos(scopes, node, imp.modulePath);
          if (!link || link.target.id === node.id) continue;

          const key = `${link.target.id}->${node.id}`;
          const existing = pairs.get(key);
          if (existing) {
            for (const name of imp.importedNames) existing.names.add(name);
            continue;
          }
          pairs.set(key, {
            // The edge runs from the **imported** repository's file to the importing one. That is the convention
            // the rest of this subsystem assumes: `analyzeCrossRepoImpact` and `traceSymbolDependencies` both walk
            // *outgoing* cross-repo edges, and a repository's "affected" peers are the ones that import it.
            projectId: link.target.projectId,
            sourceId: link.target.id,
            targetId: node.id,
            importPath: imp.modulePath,
            resolution: link.resolution,
            names: new Set(imp.importedNames),
          });
        }
      }
    }

    for (const pair of pairs.values()) {
      // **The same import resolved twice is one edge.** `buildCrossRepoGraph` is called by `indexGroup` and may be
      // called again by a caller that wants a current report; without this check the second call re-inserted every
      // edge and the count doubled.
      const already = this.store
        .getEdgesForNode(pair.sourceId, EDGE_IMPORTS)
        .some((edge) => edge.targetId === pair.targetId);
      if (already) continue;

      this.store.insertEdge({
        projectId: pair.projectId,
        sourceId: pair.sourceId,
        targetId: pair.targetId,
        type: EDGE_IMPORTS,
        properties: {
          importPath: pair.importPath,
          // Sorted so two runs over the same checkout produce the same edge, byte for byte.
          importedSymbols: Array.from(pair.names).sort(),
          resolution: pair.resolution,
          scope: 'workspace',
        },
        weight: 1,
        createdAt: now,
      });
    }
  }

  /** The file in another repository that a specifier names, by path or by package name. */
  private resolveAcrossRepos(
    scopes: readonly RepoScope[],
    importer: GraphNode,
    specifier: string,
  ): { target: GraphNode; resolution: 'path' | 'package' } | null {
    const asPath = resolveModulePath(importer.filePath!, specifier);
    if (asPath && asPath.startsWith('..')) {
      const target = this.findRepoFileByPath(scopes, asPath);
      return target ? { target, resolution: 'path' } : null;
    }

    if (specifier.startsWith('.')) return null;

    for (const { repo, identities } of scopes) {
      const localPath = repo.localPath;
      const projectId = repo.projectId ?? repo.fullName;
      // A package owns its own members through `createImportEdges`; this method is about *another* repository.
      if (projectId === importer.projectId) continue;

      for (const identity of identities) {
        const member = resolvePackageMember(localPath, identity, specifier);
        if (!member) continue;
        const target = findFileNode(this.getRepoNodes(projectId), member);
        if (target) return { target, resolution: 'package' };
      }
    }

    return null;
  }

  /** The File node of another repository in the group, addressed by a path that walked out of this one. */
  private findRepoFileByPath(scopes: readonly RepoScope[], resolved: string): GraphNode | null {
    const wanted = stripExtension(resolved).replace(/^(\.\.\/)+/, '');

    for (const { repo } of scopes) {
      // The path names the repository directory, which is the last segment of `owner/name`. Every scope has a
      // checkout — `linkCrossRepoImports` dropped the ones that did not — so this cannot be empty.
      const dir = basename(repo.localPath);
      if (!wanted.startsWith(dir + '/')) continue;
      const rest = wanted.slice(dir.length + 1);
      return (
        this.getRepoNodes(repo.projectId ?? repo.fullName).find(
          (n) => n.label === 'File' && stripExtension(n.filePath!) === rest,
        ) ?? null
      );
    }
    return null;
  }

  private ensureCrossRepoNode(repo: string, edgeType: string, now: string): number {
    // Look for existing CrossRepo node for this repo
    const allNodes = this.store.getAllNodes();
    const existing = allNodes.find(
      (n) => n.label === 'CrossRepoModule' && n.projectId === repo && n.name === edgeType,
    );
    if (existing) return existing.id;

    // Invariant: the getAllNodes guard above returns on any existing module with
    // the same (repo, edgeType), so a duplicate insert cannot occur here.
    return this.store.insertNode({
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
      const found = nodes.find((n) => n.name.toLowerCase() === lower);
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
        prevRow[i]! + 1, // deletion
        currRow[i - 1]! + 1, // insertion
        prevRow[i - 1]! + cost, // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[a.length]!;
}

/**
 * Turn `('./types', 'src/gateway.ts')` into `'src/types'` — the importer's directory plus the specifier,
 * with the extension dropped — or `null` when the specifier is bare.
 */
/**
 * The repo-relative file stem a specifier names, when the specifier is a path.
 *
 * **Two languages, two syntaxes for "the module next to me".** JavaScript writes `./x` and `../y`; Python writes
 * `.x` and `..y`, where the **dot count is the level**, not a directory. Read as a path, `.request` became
 * `src/werkzeug/wrappers/.request` — a hidden file that does not exist — so every relative Python import in a
 * checkout resolved to nothing. Measured on werkzeug 3.0.3: `wrappers/__init__.py` had **zero** incoming import
 * edges from `wrappers/request.py`, and the re-export chain `request.py → wrappers → werkzeug → flask` that makes
 * `from werkzeug import Request` resolvable did not exist.
 */
function resolveModulePath(sourceFile: string, modulePath: string): string | null {
  if (!modulePath.startsWith('.')) return null;
  const dir = sourceFile.includes('/') ? sourceFile.slice(0, sourceFile.lastIndexOf('/')) : '';

  const dotted = /^(\.+)([^./][^/]*)$/.exec(modulePath);
  if (dotted) {
    // Python's form: `n` dots climb `n - 1` directories, the rest is a dotted module path.
    const climb = '../'.repeat(dotted[1]!.length - 1);
    const rest = dotted[2]!.replace(/\./g, '/');
    return stripExtension(posix.normalize(posix.join(dir, `${climb}${rest}`)));
  }

  return stripExtension(posix.normalize(posix.join(dir, modulePath)));
}

/** Every extension a `File` node can carry, so a stem compares equal to the file it names. */
const SOURCE_EXTENSION_PATTERN =
  /\.(?:tsx?|jsx?|mjs|cjs|pyi?|go|rs|java|kt|kts|rb|php|cs|cpp|cc|cxx|hpp|hh|h|scala|lua|dart|swift|zig|exs?)$/;

/** `'src/types.ts'` -> `'src/types'`; already-extensionless paths are returned unchanged. */
function stripExtension(filePath: string): string {
  return filePath.replace(SOURCE_EXTENSION_PATTERN, '');
}

/** Does this node carry the symbol named `lower`? Exact name, or the tail of a qualified name. */
function matchesSymbol(node: GraphNode, lower: string): boolean {
  const qualified = node.qualifiedName.toLowerCase();
  return (
    node.name.toLowerCase() === lower ||
    qualified.endsWith(`:${lower}`) ||
    qualified.endsWith(`.${lower}`)
  );
}

/**
 * The `File` node a stem names, including the two shapes a directory gives a language.
 *
 * `from .wrappers import Request` names the **package** `wrappers`, and the file that holds it is
 * `wrappers/__init__.py`; JavaScript's `'./lib'` is `lib/index.ts`. Without these alternatives the edge pointed at
 * a directory and matched no node.
 */
function findFileNode(nodes: GraphNode[], stem: string): GraphNode | null {
  const wanted = new Set([
    stripExtension(stem),
    `${stripExtension(stem)}/__init__`,
    `${stripExtension(stem)}/index`,
  ]);
  return (
    nodes.find(
      (n) => n.label === 'File' && n.filePath !== null && wanted.has(stripExtension(n.filePath)),
    ) ?? null
  );
}
