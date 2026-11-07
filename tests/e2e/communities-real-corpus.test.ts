// @code-analyzer — the acceptance test for community detection, on a released checkout rather than a fixture.
//
// **A user's story, not a phase's:** "Show me the modules this codebase is made of, and name them." The unit suite
// proves the partition obeys its rules on graphs the test wrote; this one proves the phase says something true about a
// repository nobody wrote for it.
//
// **Why a real checkout is the only honest instrument here.** The defect this suite was written against is invisible
// on a fixture: a fixture has a dozen nodes and a dense structure, so both a BFS pass and Leiden return one sensible
// community. On `spring-petclinic` — 10 340 semantic nodes and 325 structural edges — the BFS pass returned **10 086
// communities, 10 077 of them a single node**, because "community" had degenerated into "node". A fixture cannot
// reproduce that shape; a real repository produces it on every run.
//
// **Three questions, one analysis.** Whether the output is a partition (shape), whether it is a *better* partition than
// the one it replaced (ablation, scored with one modularity formula over one edge set), and whether these assertions
// would have caught the old output (meta — the rules are run against the old partition and must reject it). A suite
// that only asserts the first would pass on a phase that emitted one community containing every node.
//
// **The corpus is fetched, never committed** (`benchmarks/corpora/` is ignored): the workflow downloads the checkout at
// a pinned commit and points `QA_CORPUS_DIR` at the directory holding it. Without it the suite skips rather than
// passing on an empty graph — a skip is visible in the report, a passing empty graph is not.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { describe, expect, it, beforeAll } from 'vitest';

import type { GraphEdge, GraphNode, KnowledgeGraph, PipelineContext } from '@code-analyzer/shared';

const corpusRoot = process.env['QA_CORPUS_DIR'];
const enabled = corpusRoot !== undefined && existsSync(corpusRoot);

/** The checkout whose directory name starts with `prefix`, so a different pinned revision still runs. */
function checkoutNamed(prefix: string): string | null {
  if (!corpusRoot) return null;
  const entry = readdirSync(corpusRoot).find((name) => name.startsWith(prefix));
  return entry ? join(corpusRoot, entry) : null;
}

/** The four relationships a community is made of — the same set the phase reads. */
const STRUCTURAL: ReadonlySet<string> = new Set(['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']);

interface Partition {
  /** Node id to a label that identifies its community; only membership matters, not the label's value. */
  labelOf: Map<number, string>;
  groups: Map<string, number[]>;
}

interface Analysis {
  graph: KnowledgeGraph;
  structuralEdges: GraphEdge[];
  communities: Array<{ name: string; members: number[]; cohesion: number }>;
  semanticNodes: number;
}

async function analyse(rootPath: string): Promise<Analysis> {
  const context = {
    projectId: 'communities-corpus',
    rootPath,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;
  const result = await new PipelineOrchestrator(createAllPhases()).execute(context);
  const graph = result.graph;

  const structuralEdges: GraphEdge[] = [];
  for (const [, edge] of graph.edges) {
    if (STRUCTURAL.has(edge.type) && edge.sourceId !== edge.targetId) structuralEdges.push(edge);
  }

  const members = new Map<number, number[]>();
  for (const [, edge] of graph.edges) {
    if (edge.type !== 'MEMBER_OF') continue;
    const list = members.get(edge.targetId) ?? [];
    list.push(edge.sourceId);
    members.set(edge.targetId, list);
  }
  const communities: Array<{ name: string; members: number[]; cohesion: number }> = [];
  for (const [, node] of graph.nodes) {
    if (node.label !== 'Community') continue;
    communities.push({
      name: node.name,
      members: members.get(node.id) ?? [],
      cohesion: Number(node.properties['cohesion'] ?? 0),
    });
  }
  const semanticNodes = [...graph.nodes.values()].filter(
    (node: GraphNode) => node.label !== 'Community',
  ).length;
  return { graph, structuralEdges, communities, semanticNodes };
}

/**
 * Modularity of a partition, under one formula, over one edge set.
 *
 * `Q = Σ_c [ L_c / m − (d_c / 2m)² ]` with `m` the number of undirected edges, `L_c` the edges inside `c` and `d_c`
 * the sum of its members' degrees. Every partition in this file is scored by this function on the same edges, so the
 * comparison is between partitions and not between scoring methods.
 */
function modularity(edges: readonly GraphEdge[], partition: Partition): number {
  const m = edges.length;
  if (m === 0) return 0;
  const degree = new Map<number, number>();
  const internal = new Map<string, number>();
  const total = new Map<string, number>();
  for (const edge of edges) {
    const from = partition.labelOf.get(edge.sourceId);
    const to = partition.labelOf.get(edge.targetId);
    if (from === undefined || to === undefined) continue;
    degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1);
    degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1);
    total.set(from, (total.get(from) ?? 0) + 1);
    total.set(to, (total.get(to) ?? 0) + 1);
    if (from === to) internal.set(from, (internal.get(from) ?? 0) + 1);
  }
  let q = 0;
  for (const [label, endpoints] of total) {
    q += (internal.get(label) ?? 0) / m - (endpoints / (2 * m)) ** 2;
  }
  return q;
}

/**
 * The partition this phase shipped before iteration 97: breadth-first connected components over the same edges.
 *
 * It is kept here, in the test, because **the ablation needs the thing it is an ablation of**. Its output is a
 * partition in which every node with no structural neighbour is a community of one, which is exactly the shape the
 * assertions below have to reject.
 */
function connectedComponents(nodes: Iterable<GraphNode>, edges: readonly GraphEdge[]): Partition {
  const adjacency = new Map<number, Set<number>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, new Set());
    if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, new Set());
    adjacency.get(edge.sourceId)?.add(edge.targetId);
    adjacency.get(edge.targetId)?.add(edge.sourceId);
  }
  const visited = new Set<number>();
  const labelOf = new Map<number, string>();
  const groups = new Map<string, number[]>();
  let counter = 0;
  const claim = (ids: number[]): void => {
    const label = `community_${counter++}`;
    groups.set(label, ids);
    for (const id of ids) labelOf.set(id, label);
  };
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    if (!adjacency.has(node.id)) {
      // The old behaviour: a lone node became a community, which is how 10 077 came to exist.
      claim([node.id]);
      continue;
    }
    const component: number[] = [];
    const queue = [node.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        queue.push(neighbour);
      }
    }
    claim(component);
  }
  return { labelOf, groups };
}

const checkout = enabled ? checkoutNamed('spring-petclinic-') : null;
const runnable = checkout !== null;

describe.skipIf(!runnable)('communities on a released checkout', () => {
  let analysis: Analysis;
  let shipped: Partition;

  beforeAll(async () => {
    analysis = await analyse(checkout!);
    shipped = {
      labelOf: new Map(
        analysis.communities.flatMap((c, index) =>
          c.members.map((member) => [member, `shipped_${index}`] as const),
        ),
      ),
      groups: new Map(analysis.communities.map((c, index) => [`shipped_${index}`, c.members])),
    };
  }, 600_000);

  it('names modules instead of numbering nodes', () => {
    const { communities, semanticNodes } = analysis;

    // **A community of one is a node with a new name.** The old pass produced 10 077 of them.
    const singletons = communities.filter((community) => community.members.length < 2);
    expect(
      singletons.map((community) => community.name),
      'communities with fewer than two members',
    ).toEqual([]);

    // **Output cannot outgrow input.** 10 086 communities over 10 340 nodes was 97.6 %; a real partition of a
    // repository this size is a handful of modules, and five percent is already a generous ceiling.
    expect(communities.length).toBeGreaterThan(0);
    expect(communities.length).toBeLessThanOrEqual(Math.ceil(semanticNodes * 0.05));

    // **A number is not a name.** `community_0` through `community_9855` told a reader nothing they could not get
    // from the member list, and the numbering was the tell that nothing had been discovered.
    const numbered = communities.filter((community) => /^community_\d+$/u.test(community.name));
    expect(
      numbered.map((community) => community.name),
      'communities named by their index',
    ).toEqual([]);

    // **The names have to be directories that exist in the checkout.** `cluster` is the fallback for a community
    // whose members have no file at all; on a Java service there should be almost none of those.
    const named = communities.filter((community) => !community.name.startsWith('cluster'));
    expect(named.length).toBeGreaterThan(communities.length * 0.8);

    // **And at least one of them is a package this repository actually has**, which is what "the module map is
    // correct" means for a codebase whose layout is public knowledge.
    const known = new Set(['owner', 'model', 'vet', 'system']);
    const matches = communities.filter((community) =>
      community.name.split('/').some((part) => known.has(part)),
    );
    expect(
      matches.length,
      `names found: ${communities.map((community) => community.name).join(', ')}`,
    ).toBeGreaterThan(0);
  });

  it('scores higher modularity than the partition it replaced', () => {
    const before = connectedComponents(analysis.graph.nodes.values(), analysis.structuralEdges);
    const after = modularity(analysis.structuralEdges, shipped);
    const old = modularity(analysis.structuralEdges, before);

    // Measured on this checkout: **0.1362 before, 0.4100 after**. The gap is the difference between "these nodes are
    // in the same connected piece" and "this is the partition that maximises the stated objective".
    expect(after).toBeGreaterThan(old);
    expect(after).toBeGreaterThan(0.2);
    expect(old).toBeLessThan(0.2);
  });

  it('would reject the partition this phase used to emit', () => {
    // **The suite has to be able to fail.** Each rule above is applied to the old partition here; a rule that accepts
    // every partition — `communitiesFound >= 0`, the assertion this suite replaced — passes this test and would have
    // to be rewritten.
    const before = connectedComponents(analysis.graph.nodes.values(), analysis.structuralEdges);
    let violations = 0;
    for (const members of before.groups.values()) if (members.length < 2) violations++;
    expect(violations, 'the old partition had no community of one member').toBeGreaterThan(0);

    expect(before.groups.size).toBeGreaterThan(Math.ceil(analysis.semanticNodes * 0.05));

    const numbered = [...before.groups.keys()].filter((label) => /^community_\d+$/u.test(label));
    expect(numbered.length, 'the old partition was numbered').toBeGreaterThan(0);
  });

  it('reports the same partition twice for the same checkout', async () => {
    const again = await analyse(checkout!);
    const snapshot = (value: Analysis): string =>
      value.communities
        .map((community) => `${community.name}:${community.members.join('.')}`)
        .sort()
        .join('|');
    expect(snapshot(again)).toBe(snapshot(analysis));
  }, 600_000);
});
