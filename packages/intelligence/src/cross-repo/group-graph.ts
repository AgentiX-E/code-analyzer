// @code-analyzer/intelligence — a repository's pipeline graph, expressed in the workspace's coordinates
//
// **Two indexers, two coordinate systems, and neither one can be removed.** `PipelineOrchestrator` is handed a root and
// joins it, so every path it writes is absolute; `CrossRepoIndexer` writes repository-relative paths because a
// workspace addresses a file by (repository, path). Handing a pipeline graph to a workspace without converting it is
// not a small mistake, and this module exists because the mistake has three separate consequences, all of which look
// like a different bug:
//
//   1. **`projectId` is empty on `File` nodes.** The pipeline's file pass writes them without one, and
//      `getRepoNodes(projectId)` is what every walk in this subsystem starts from - so the workspace holds the files
//      and cannot see them. Measured on `pallets/flask` 3.0.3: 127 `File` nodes, **0** reachable through
//      `getRepoNodes`.
//   2. **`filePath` is absolute.** `linkCrossRepoImports` reads `join(localPath, node.filePath)` and would join the
//      checkout onto itself - the same defect that made a published bug-localisation figure read zero.
//   3. **`qualifiedName` carries the absolute path**, and a citation quotes it. A qualified name that names the
//      machine it was indexed on is not an identity.
//
// **What is deliberately not converted.** The pipeline's `IMPORTS` edges are dropped rather than merged: they carry
// **no `importedSymbols`**, and every consumer in this subsystem - `filesExposing`, `traceSymbolDependencies`, the
// symbol-filtered impact answer - reads the names the import statement asked for. The workspace builds those edges
// itself, with names. Where the workspace's own reader resolves nothing (a Java or Kotlin package, which the manifest
// reader in this package does not resolve), the pipeline's edge is the only evidence that the import exists, so it
// travels as a *deferred* pair and is inserted **only if nothing else produced an edge for that pair**.

import { isAbsolute, relative, resolve, sep } from 'node:path';

import { EDGE_IMPORTS } from '@code-analyzer/shared';

import type { NewGraphNode } from '@code-analyzer/infra';
import type { GraphNode, KnowledgeGraph, NodeLabel, RelationshipType } from '@code-analyzer/shared';

/** Where a repository's graph came from: the checkout the pipeline read and the project it belongs to. */
export interface MergeScope {
  /** The root the pipeline was run over. **The same string, not an equivalent one.** */
  readonly rootPath: string;
  /** The project id every node and edge in this graph is filed under. */
  readonly projectId: string;
  /**
   * The languages a workspace holds. A node whose language is absent from this set is **not carried**.
   *
   * **The pipeline reads prose, and a workspace does not.** Its scanner admits `.md` and `.pdf` because a
   * documentation site is part of a repository; the file discovery in `CrossRepoIndexer` admits neither. Merging
   * without this distinction changed the answers: asked where express mounts middleware, the workspace answered
   * `Charter.md:22` and `History.md:1502`, and the file the question is about fell out of the nine candidates a
   * twelve-block context can hold. **A workspace indexes the languages its own discovery reads**, and widening that
   * set is a change with its own measurement.
   */
  readonly languages?: ReadonlySet<string>;
}

/** An edge whose endpoints are **indices into `MergedGraph.nodes`**, because the store owns node identity. */
export interface MergedEdge {
  readonly source: number;
  readonly target: number;
  readonly type: RelationshipType;
  readonly properties: Record<string, unknown>;
  readonly weight: number;
}

/** What the conversion refused to carry, by reason. **A silent drop is a lie about completeness.** */
export interface MergeDrops {
  /** Nodes whose file lies outside the checkout. */
  readonly outsideCheckout: number;
  /** Edges dropped because an endpoint was dropped. */
  readonly unmapped: number;
  /** `IMPORTS` edges held back for the workspace's own reader to replace. */
  readonly deferredImports: number;
  /**
   * `IMPORTS` edges from a file to itself, which the pipeline emits for `from . import x`.
   *
   * **A relation a file has to itself is not evidence of anything.** Counted rather than deferred, because a walk
   * that follows it reports the file it started from as the file that depends on it.
   */
  readonly selfImports: number;
  /** Nodes in a language a workspace does not hold - documentation, configuration, templates. */
  readonly outsideLanguages: number;
}

export interface MergedGraph {
  readonly nodes: NewGraphNode[];
  readonly edges: MergedEdge[];
  /**
   * Pipeline `IMPORTS` pairs that survived, as indices into `nodes`.
   *
   * **Not inserted by this function**, because the workspace's import pass has not run yet and an edge inserted
   * here would duplicate every pair that pass resolves. The caller inserts one only where nothing else did.
   */
  readonly deferredImports: Array<{ source: number; target: number }>;
  readonly drops: MergeDrops;
}

/**
 * The repository-relative, POSIX path of `filePath`, or `null` when it is not inside `rootPath`.
 *
 * **`null` rather than a path that walks out.** `relative()` answers `../elsewhere/x.py` for a file outside the root,
 * and that string is worse than useless here: it is a path a citation would print and a resolver would join, and no
 * checkout contains it. The caller counts what it refused.
 *
 * **Both sides are resolved first**, because a group may hold a relative checkout path - the shape that turned a
 * published figure into a second zero - and because `..` segments in either side make a textual comparison a guess.
 */
export function toRepoPath(rootPath: string, filePath: string): string | null {
  const root = resolve(rootPath);
  const target = resolve(filePath);
  const walked = relative(root, target);
  if (walked === '' || walked === '..') return null;
  if (walked.startsWith(`..${sep}`) || isAbsolute(walked)) return null;
  return walked.split(sep).join('/');
}

/**
 * The checkout prefixes a qualified name can carry, longest first.
 *
 * **The absolute form contains the given one as a suffix** when the group was registered with a relative path
 * (`benchmarks/corpora/qa/flask-3.0.3`), so stripping the shorter one first would leave `/workspace/repos/.../` behind.
 */
function checkoutPrefixes(rootPath: string): string[] {
  const forms = new Set([`${resolve(rootPath)}${sep}`, `${resolve(rootPath)}/`]);
  forms.add(`${rootPath}${sep}`);
  forms.add(`${rootPath}/`);
  return [...forms]
    .filter((form) => form.length > 1)
    .sort((left, right) => right.length - left.length);
}

/** A node as the workspace stores it, or `null` when its file is not in the checkout. */
function rewriteNode(
  node: GraphNode,
  scope: MergeScope,
  prefixes: readonly string[],
): NewGraphNode | null {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = node;

  if (rest.filePath === null || rest.filePath === '') {
    // **A node with no file is still a node** - a community, a project, a module - and it is filed under the project
    // like every other one. Its qualified name cannot carry a path, so there is nothing to convert.
    return {
      ...rest,
      projectId: scope.projectId,
      qualifiedName: scopeName(rest.qualifiedName, rest.label, null, scope, prefixes),
    };
  }

  const repoPath = toRepoPath(scope.rootPath, rest.filePath);
  if (repoPath === null) return null;

  return {
    ...rest,
    projectId: scope.projectId,
    filePath: repoPath,
    qualifiedName: scopeName(rest.qualifiedName, rest.label, repoPath, scope, prefixes),
    properties: { ...rest.properties, filePath: repoPath },
  };
}

/**
 * The name a node is addressed by **inside a workspace**.
 *
 * **A qualified name that is unique in one repository is not unique in four of them**, and the store holds one
 * namespace. Measured on the four released checkouts, the collision was not exotic: every repository has `.github`
 * and `.devcontainer` folders with the same relative path, and the community detector numbers its communities from
 * one in every repository, so `community:1` existed four times. The second repository's nodes were then merged onto
 * the first's - and because the upgrade pass in `buildCrossRepoGraph` reads "an edge whose target is in another
 * project", the first repository's folder edges became **375 cross-repository dependencies** that no import, call or
 * contract supports.
 *
 * **Two forms, because the workspace already has two.** A file is `file:<project>:<path>`, which is what
 * `ensureFileNode` writes and what keeps one file to one node when both passes run. Everything else is
 * `project:<project>:<rest>` - the form the pipeline itself uses for a symbol - so a name the pipeline already scoped
 * is left exactly as it was.
 */
function scopeName(
  qualifiedName: string,
  label: NodeLabel,
  repoPath: string | null,
  scope: MergeScope,
  prefixes: readonly string[],
): string {
  if (label === 'File') return `file:${scope.projectId}:${repoPath ?? ''}`;

  const stripped = stripCheckout(qualifiedName, prefixes);
  const ownProject = `project:${scope.projectId}`;
  if (stripped === ownProject || stripped.startsWith(`${ownProject}:`)) return stripped;
  return `${ownProject}:${stripped}`;
}

function stripCheckout(text: string, prefixes: readonly string[]): string {
  let out = text;
  for (const prefix of prefixes) out = out.split(prefix).join('');
  return out;
}

/**
 * A repository's pipeline graph, ready to insert into the store a workspace reads.
 *
 * The node order is the graph's own insertion order, and the edge order is its own, so two runs over one checkout
 * produce the same store — which is what lets a test assert an index and a caller compare two runs.
 */
export function mergePipelineGraph(graph: KnowledgeGraph, scope: MergeScope): MergedGraph {
  const prefixes = checkoutPrefixes(scope.rootPath);
  const nodes: NewGraphNode[] = [];
  const indexOf = new Map<number, number>();
  let outsideCheckout = 0;
  let outsideLanguages = 0;

  for (const node of graph.nodes.values()) {
    // **A language the workspace does not hold is not a conversion failure, it is a scope**: the node is complete,
    // the workspace has decided not to hold it, and the count says so.
    if (node.language !== null && scope.languages && !scope.languages.has(node.language)) {
      outsideLanguages++;
      continue;
    }
    const rewritten = rewriteNode(node, scope, prefixes);
    if (rewritten === null) {
      outsideCheckout++;
      continue;
    }
    indexOf.set(node.id, nodes.length);
    nodes.push(rewritten);
  }

  const edges: MergedEdge[] = [];
  const deferredImports: Array<{ source: number; target: number }> = [];
  let unmapped = 0;
  let selfImports = 0;

  for (const edge of graph.edges.values()) {
    const source = indexOf.get(edge.sourceId);
    const target = indexOf.get(edge.targetId);
    if (source === undefined || target === undefined) {
      unmapped++;
      continue;
    }
    if (edge.type === EDGE_IMPORTS) {
      if (source === target) selfImports++;
      else deferredImports.push({ source, target });
      continue;
    }
    edges.push({
      source,
      target,
      type: edge.type,
      properties: { ...edge.properties },
      weight: edge.weight,
    });
  }

  return {
    nodes,
    edges,
    deferredImports,
    drops: {
      outsideCheckout,
      unmapped,
      deferredImports: deferredImports.length,
      selfImports,
      outsideLanguages,
    },
  };
}
