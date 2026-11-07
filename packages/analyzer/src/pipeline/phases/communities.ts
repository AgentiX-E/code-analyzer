// @code-analyzer/analyzer — Pipeline Phase: Communities

import { leiden } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  PhaseLogger,
  createNoopPhaseLogger,
  EDGE_CALLS,
  EDGE_EXTENDS,
  EDGE_IMPLEMENTS,
  EDGE_IMPORTS,
  EDGE_MEMBER_OF,
} from '@code-analyzer/shared';

import { GraphBuilder } from '../../graph/graph-builder.js';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import type {
  GraphEdge,
  GraphNode,
  PipelinePhaseId,
  PipelineContext,
  KnowledgeGraph,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Communities
// ---------------------------------------------------------------------------

/**
 * The four relationships a community is made of.
 *
 * **These are the edges that say two pieces of code are the same piece of work**: one calls another, one imports
 * another, one extends or implements another. Membership (`MEMBER_OF`), containment (`DEFINES`, `CONTAINS`) and
 * routing (`HANDLES_ROUTE`) are *not* here, because a file and its own contents are not a community — they are one
 * node with a parent.
 */
const STRUCTURAL_EDGES: ReadonlySet<string> = new Set([
  EDGE_CALLS,
  EDGE_IMPORTS,
  EDGE_EXTENDS,
  EDGE_IMPLEMENTS,
]);

/**
 * **A community of one is not a community.**
 *
 * This single number is the whole difference between a partition and a relabelling. Before iteration 97 this phase
 * emitted a `Community` node for every node that had no neighbour, which on `spring-petclinic` meant **10 086
 * communities for 10 340 input nodes — 97.6 % of the input, mean size 1.01** — and every one of them entered the graph
 * as a first-class node, so half the graph became the analyser's own output about the other half.
 */
const MIN_MEMBERS = 2;

/** One detected community, with the name a reader can use and a number that says how tight it is. */
export interface DetectedCommunity {
  /** Node ids, ascending, so a snapshot of this phase is stable across runs. */
  readonly members: readonly number[];
  /** A directory name taken from the members' paths, disambiguated when two communities share one. */
  readonly name: string;
  /** Internal structural edges divided by the pairs available: 1.0 is a clique, 0.0 is a chain that has not closed. */
  readonly cohesion: number;
}

/**
 * A node's file path as a list of segments **relative to the analysed root**.
 *
 * **A name must not depend on where the checkout was unpacked.** `packages/intelligence` already holds this rule at
 * the search layer (`search-name-portability.test.ts`: the same corpus indexed through a longer symlink produced a
 * different lexical MRR, because every document carried the machine's path). Naming a community after
 * `parts[length - 2]` of an absolute path reintroduces it one layer up: analysed at `benchmarks/retrieval-corpus` the
 * cluster was `retrieval-corpus`, and through the symlink it was `a-checkout-with-a-longer-name` — same code, two
 * module maps. Stripping `graph.rootPath` first makes the name a function of the repository's own layout.
 */
function relativeParts(filePath: string, rootPath: string | undefined): string[] {
  const relative =
    rootPath !== undefined && filePath.startsWith(rootPath)
      ? filePath.slice(rootPath.length)
      : filePath;
  return relative.split(/[\\/]/u).filter((part) => part.length > 0);
}

/** Where a node is, as the two things a name can be built from. */
interface Location {
  /** The containing directory relative to the root, or `null` when the file sits at the root itself. */
  readonly directory: string | null;
  /** The file without its extension. Never `null` — a node that has no file has no location at all. */
  readonly file: string;
}

/**
 * The directory and file a node lives in, **read together because they are two answers to one question**.
 *
 * The containing directory, not the repository root: `.../petclinic/model/Owner.java` is `model`. A file at the root
 * has no directory and its own name is the label — the retrieval corpus is one flat directory, and `cluster` for every
 * cluster in it would be a worse answer than `typescript`.
 */
function locationOf(node: GraphNode, rootPath: string | undefined): Location | null {
  if (!node.filePath) return null;
  const parts = relativeParts(node.filePath, rootPath);
  // A path that is only separators — `/`, or the root itself — names nothing.
  if (parts.length === 0) return null;
  const base = parts[parts.length - 1]!;
  const dot = base.lastIndexOf('.');
  return {
    directory: parts.length >= 2 ? parts[parts.length - 2]! : null,
    file: dot > 0 ? base.slice(0, dot) : base,
  };
}

/** The most frequent entry, ties broken alphabetically so the answer does not depend on iteration order. */
function mostFrequent(counts: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Give every community the name of the directory most of its members live in.
 *
 * **`community_0` is not a name.** The BFS pass this replaces numbered its output, and a number says nothing about what
 * the cluster does — a reader had to open every member to learn anything. The directories are already the author's own
 * grouping, so the mode of them is the cheapest honest label available without inventing a summary.
 *
 * Ties break on the alphabetically first directory, so the result does not depend on map iteration order, and two
 * communities that share a mode become `owner` and `owner-2` rather than both claiming one name.
 */
function nameCommunities(
  graph: KnowledgeGraph,
  groups: ReadonlyMap<number, readonly number[]>,
): Map<number, string> {
  const names = new Map<number, string>();
  const used = new Map<string, number>();
  const claimedDirectories = new Set<string>();
  const rootPath = graph.rootPath;
  for (const [communityId, members] of groups) {
    const directories = new Map<string, number>();
    const files = new Map<string, number>();
    for (const id of members) {
      // **Every member came out of the graph** — the ids handed to Leiden are read from `graph.nodes` — so the lookup
      // cannot miss. The alternative, a guard for an impossible state, is a branch no test can reach.
      const location = locationOf(graph.nodes.get(id)!, rootPath);
      if (location === null) continue;
      if (location.directory !== null) {
        directories.set(location.directory, (directories.get(location.directory) ?? 0) + 1);
      }
      files.set(location.file, (files.get(location.file) ?? 0) + 1);
    }
    // **A file at the root has no directory to name, and its own name is the better answer than `cluster`.** The
    // retrieval corpus is a flat directory of one file per language, so every cluster in it sits at depth zero; naming
    // them by file keeps them readable and, unlike the directory, the file name does not move with the checkout.
    const primaryDirectory = mostFrequent(directories);
    const primaryFile = mostFrequent(files);
    // A file at the root has no directory to name, and `cluster` for every cluster in a flat corpus would make them
    // indistinguishable: the file name is the better answer and, unlike the directory, it does not move with the
    // checkout.
    const primary = primaryDirectory ?? primaryFile ?? 'cluster';
    // **The second cluster in a directory is named after the file most of it lives in.** Thirteen communities in
    // `spring-petclinic` share the directory `owner`, and calling them `owner` through `owner-13` puts the number back
    // where the directory name used to be — the reader learns nothing they did not already know from the first one.
    // `owner/OwnerControllerTests` says what the cluster is.
    let name = claimedDirectories.has(primary) ? `${primary}/${primaryFile ?? 'cluster'}` : primary;
    claimedDirectories.add(primary);
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen > 0) name = `${name}-${seen + 1}`;
    names.set(communityId, name);
  }
  return names;
}

/**
 * Detect code communities from the graph's structural edges.
 *
 * **Leiden, and not a name for something else.** The previous implementation said "using the Leiden algorithm" in a
 * comment and ran a BFS connected-component pass: measured on `spring-petclinic`, modularity **0.1362** against
 * Leiden's **0.4100** on the same nodes and the same edges. A connected component is the partition you get when you
 * have no objective at all; a modularity partition is the answer to a stated question.
 *
 * The algorithm is `@code-analyzer/core`'s `leiden`, which is where it had to be moved to: it lived in
 * `@code-analyzer/intelligence`, which depends on `analyzer`, so this phase could not import it without closing a
 * cycle. The strongest algorithm in the repository was reachable from nothing but its own tests.
 *
 * **Nodes no structural edge touches are not passed to the algorithm at all.** They cannot join a community, and
 * feeding them in only to discard their singletons afterwards would make the modularity number describe a graph the
 * phase did not cluster. Passing the filtered node set also keeps `leiden`'s degree bookkeeping correct.
 */
export function detectCommunities(graph: KnowledgeGraph): DetectedCommunity[] {
  const structural: GraphEdge[] = [];
  for (const [, edge] of graph.edges) {
    if (STRUCTURAL_EDGES.has(edge.type) && edge.sourceId !== edge.targetId) structural.push(edge);
  }
  if (structural.length === 0) return [];

  const touched = new Set<number>();
  for (const edge of structural) {
    touched.add(edge.sourceId);
    touched.add(edge.targetId);
  }
  const nodes: GraphNode[] = [];
  for (const id of touched) {
    const node = graph.nodes.get(id);
    if (node !== undefined) nodes.push(node);
  }
  if (nodes.length < MIN_MEMBERS) return [];

  const partition = leiden({ nodes, edges: structural });

  // **A community of one is dropped here, and dropping it is not a conditional.** Written as a filter rather than an
  // `if` because the rule is a property of the output — every community has at least `MIN_MEMBERS` — not a branch some
  // inputs take and others do not.
  const groups = new Map(
    [...partition.communities]
      .filter(([, members]) => members.length >= MIN_MEMBERS)
      .map(([communityId, members]) => [communityId, [...members].sort((a, b) => a - b)] as const),
  );
  const names = nameCommunities(graph, groups);
  const internal = new Map<number, number>();
  const pairs = new Set<string>();
  for (const edge of structural) {
    const from = partition.nodeToCommunity.get(edge.sourceId);
    const to = partition.nodeToCommunity.get(edge.targetId);
    if (from === undefined || from !== to) continue;
    const low = Math.min(edge.sourceId, edge.targetId);
    const high = Math.max(edge.sourceId, edge.targetId);
    const key = `${from}:${low}:${high}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    internal.set(from, (internal.get(from) ?? 0) + 1);
  }

  const communities: DetectedCommunity[] = [];
  for (const [communityId, members] of groups) {
    // `MIN_MEMBERS` guarantees two members, so the number of pairs is at least one.
    const possible = (members.length * (members.length - 1)) / 2;
    communities.push({
      members,
      // Every group was named by the pass above, which walks the same map.
      name: names.get(communityId)!,
      cohesion: (internal.get(communityId) ?? 0) / possible,
    });
  }
  return communities.sort(
    (a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// Phase 12: communities — Detect code communities using modularity-based clustering
// ---------------------------------------------------------------------------

export class CommunitiesPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'communities';
  readonly dependencies: PipelinePhaseId[] = ['crossFile'];
  readonly description = 'Detect code communities and module clusters';
  readonly parallelizable = false;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { communitiesFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      const communities = detectCommunities(ctx.graph);

      for (const community of communities) {
        const node = builder.addNode(
          ctx.graph,
          'Community',
          community.name,
          {
            name: community.name,
            memberCount: community.members.length,
            cohesion: community.cohesion,
          },
          `community:${ctx.projectId}:${community.name}`,
        );

        for (const memberId of community.members) {
          try {
            builder.addEdge(ctx.graph, memberId, node.id, EDGE_MEMBER_OF, ctx.projectId);
          } catch {
            // An edge that already exists is the same edge; nothing is lost by moving on.
          }
        }
      }

      ctx.phaseData.set('communities', {
        communitiesFound: communities.length,
        membersPlaced: communities.reduce((sum, community) => sum + community.members.length, 0),
      });
      return {
        phaseId: this.id,
        status: 'success',
        output: { communitiesFound: communities.length },
      };
    } catch (err) {
      this.logger.error(
        'Phase execution failed',
        err instanceof Error ? err : new Error(String(err)),
        { phaseId: this.id, filePath: ctx?.rootPath },
      );
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
