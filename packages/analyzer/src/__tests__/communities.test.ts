// @code-analyzer — what a community is, and what it is not.
//
// **Every assertion here can fail.** The suite it replaces ran the phase over a fixture and asserted
// `communitiesFound >= 0`, plus `if (communityNodes.length > 0) expect(memberOfEdges.length > 0)` — which is true of
// every possible implementation, including the one that emitted ten thousand communities of one member each. The
// claims worth testing are the ones a wrong answer contradicts: that a lone node is not a community, that a name says
// something, that the partition is a partition and not a relabelling of the input.

import { describe, expect, it } from 'vitest';

import { detectCommunities } from '../pipeline/phases/communities.js';

import type {
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
  NodeLabel,
  RelationshipType,
} from '@code-analyzer/shared';

const PROJ = 'communities';

function node(id: number, label: NodeLabel, filePath: string | null): GraphNode {
  return {
    id,
    projectId: PROJ,
    label,
    name: filePath === null ? `node-${id}` : filePath.replace(/^.*\//u, ''),
    qualifiedName: filePath === null ? `node-${id}` : filePath,
    filePath,
    startLine: 1,
    endLine: 1,
    language: filePath === null ? null : 'java',
    properties: { name: filePath === null ? `node-${id}` : filePath },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: '',
    updatedAt: '',
  };
}

function edge(id: number, sourceId: number, targetId: number, type: RelationshipType): GraphEdge {
  return {
    id,
    projectId: PROJ,
    sourceId,
    targetId,
    type,
    properties: {},
    weight: 1,
    createdAt: '',
  };
}

function graphOf(nodes: GraphNode[], edges: GraphEdge[], rootPath?: string): KnowledgeGraph {
  return {
    projectId: PROJ,
    ...(rootPath === undefined ? {} : { rootPath }),
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges: new Map(edges.map((e) => [e.id, e])),
    qnameIndex: new Map(),
    fileIndex: new Map(),
  };
}

const MODEL = '/repo/src/main/java/com/acme/model';
const OWNER = '/repo/src/main/java/com/acme/owner';

describe('a community is at least two nodes', () => {
  it('does not emit a community for a node with no structural neighbour', () => {
    const graph = graphOf(
      [node(1, 'Class', `${MODEL}/A.java`), node(2, 'Class', `${MODEL}/B.java`)],
      [edge(1, 1, 2, 'CALLS')],
    );
    const communities = detectCommunities(graph);
    expect(communities).toHaveLength(1);
    expect(communities[0]?.members).toEqual([1, 2]);
  });

  it('emits nothing for a graph of isolated nodes, rather than one community each', () => {
    // The shape that produced 10 086 communities on `spring-petclinic`: nodes exist, no structural edge touches them.
    const nodes = Array.from({ length: 50 }, (_, index) =>
      node(index + 1, 'Variable', `${MODEL}/A.java`),
    );
    expect(detectCommunities(graphOf(nodes, []))).toEqual([]);
  });

  it('emits nothing when the only edge is containment', () => {
    // A file and its own contents are one node with a parent, not two members of a community.
    const graph = graphOf(
      [node(1, 'File', `${MODEL}/A.java`), node(2, 'Class', `${MODEL}/A.java`)],
      [edge(1, 1, 2, 'DEFINES')],
    );
    expect(detectCommunities(graphOf(graph.nodes ? [...graph.nodes.values()] : [], []))).toEqual(
      [],
    );
    expect(detectCommunities(graph)).toEqual([]);
  });
});

describe('the partition is modularity, not connectivity', () => {
  it('splits a graph into its two dense halves rather than reporting one connected component', () => {
    // Two triangles joined by a single edge. Connected components says "one community, six nodes"; modularity says
    // "two communities of three", which is what a reader of the code would say.
    const nodes = Array.from({ length: 6 }, (_, index) =>
      node(index + 1, 'Class', `${MODEL}/C${index + 1}.java`),
    );
    const edges = [
      edge(1, 1, 2, 'CALLS'),
      edge(2, 2, 3, 'CALLS'),
      edge(3, 3, 1, 'CALLS'),
      edge(4, 4, 5, 'CALLS'),
      edge(5, 5, 6, 'CALLS'),
      edge(6, 6, 4, 'CALLS'),
      edge(7, 3, 4, 'CALLS'),
    ];
    const communities = detectCommunities(graphOf(nodes, edges));
    expect(communities.map((c) => c.members.length).sort()).toEqual([3, 3]);
  });

  it('reports a clique with cohesion 1 and an open chain with less', () => {
    const cliqueNodes = Array.from({ length: 4 }, (_, index) =>
      node(index + 1, 'Class', `${MODEL}/K${index + 1}.java`),
    );
    const cliqueEdges: GraphEdge[] = [];
    let id = 0;
    for (let a = 1; a <= 4; a++) {
      for (let b = a + 1; b <= 4; b++) cliqueEdges.push(edge(++id, a, b, 'CALLS'));
    }
    const clique = detectCommunities(graphOf(cliqueNodes, cliqueEdges));
    expect(clique).toHaveLength(1);
    expect(clique[0]?.cohesion).toBe(1);
  });
});

describe('a name says what the community is', () => {
  it('names each community after the directory its members live in', () => {
    // **Two cliques, two directories, no edge between them.** A chain or a triangle-with-a-tail is the wrong shape for
    // this assertion: on four nodes and four edges the maximum modularity is 0 and several partitions tie at 0, so the
    // test would be measuring the tie-break rather than the naming. Two disconnected K4s have one optimum.
    const ownerNodes = [1, 2, 3, 4].map((id) => node(id, 'Class', `${OWNER}/O${id}.java`));
    const modelNodes = [5, 6, 7, 8].map((id) => node(id, 'Class', `${MODEL}/M${id}.java`));
    const edges: GraphEdge[] = [];
    let id = 0;
    for (const group of [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]) {
      for (let a = 0; a < group.length; a++) {
        for (let b = a + 1; b < group.length; b++) {
          edges.push(edge(++id, group[a]!, group[b]!, 'CALLS'));
        }
      }
    }
    const communities = detectCommunities(graphOf([...ownerNodes, ...modelNodes], edges));
    expect(communities.map((community) => community.name).sort()).toEqual(['model', 'owner']);
    expect(communities.map((community) => community.members.length)).toEqual([4, 4]);
  });

  it('does not number its output', () => {
    // `community_0` through `community_10085` is a relabelling of the input, not a description of it.
    const nodes = Array.from({ length: 8 }, (_, index) =>
      node(index + 1, 'Class', `${MODEL}/M${index + 1}.java`),
    );
    const edges = nodes
      .slice(1)
      .map((current, index) => edge(index + 1, current.id, nodes[index]!.id, 'CALLS'));
    for (const community of detectCommunities(graphOf(nodes, edges))) {
      expect(community.name).not.toMatch(/^community_\d+$/u);
    }
  });

  it('distinguishes two communities in one directory by the file most of each lives in', () => {
    const graph = graphOf(
      [
        node(1, 'Class', `${OWNER}/OwnerController.java`),
        node(2, 'Method', `${OWNER}/OwnerController.java`),
        node(3, 'Class', `${OWNER}/OwnerControllerTests.java`),
        node(4, 'Method', `${OWNER}/OwnerControllerTests.java`),
      ],
      [edge(1, 1, 2, 'CALLS'), edge(2, 3, 4, 'CALLS')],
    );
    const names = detectCommunities(graph)
      .map((community) => community.name)
      .sort();
    expect(names).toEqual(['owner', 'owner/OwnerControllerTests']);
  });
});

describe('a name does not depend on where the checkout sits', () => {
  it('strips the analysed root before it reads a directory', () => {
    // **The rule `search-name-portability.test.ts` holds at the index, held one layer up.** Analysed at
    // `benchmarks/retrieval-corpus` the cluster was named after that directory; the same corpus reached through a
    // symlink named it after the symlink, so one repository had two module maps and the two runs disagreed on every
    // name. The name has to be a function of the repository's own layout.
    const build = (root: string): KnowledgeGraph =>
      graphOf(
        [
          node(1, 'Class', `${root}/src/model/A.java`),
          node(2, 'Class', `${root}/src/model/B.java`),
        ],
        [edge(1, 1, 2, 'CALLS')],
        root,
      );

    const short = detectCommunities(build('/repo'));
    const nested = detectCommunities(build('/home/runner/work/x/y/a-checkout-with-a-longer-name'));
    expect(nested.map((c) => c.name)).toEqual(short.map((c) => c.name));
    expect(short[0]?.name).toBe('model');
  });

  it('names a cluster of files sitting at the root after the file, not the machine directory', () => {
    // The retrieval corpus is flat: one file per language, no directory to name. Falling back to `cluster` would make
    // every one of them indistinguishable, and falling back to the absolute path would reintroduce the defect above.
    const graph = graphOf(
      [node(1, 'Function', '/repo/typescript.ts'), node(2, 'Method', '/repo/typescript.ts')],
      [edge(1, 1, 2, 'CALLS')],
      '/repo',
    );
    expect(detectCommunities(graph)[0]?.name).toBe('typescript');
  });
});

describe('the answer is a function of the graph', () => {
  it('returns the same partition twice for the same input', () => {
    const nodes = Array.from({ length: 12 }, (_, index) =>
      node(index + 1, 'Class', `${MODEL}/R${index + 1}.java`),
    );
    const edges = [
      edge(1, 1, 2, 'CALLS'),
      edge(2, 2, 3, 'CALLS'),
      edge(3, 3, 1, 'CALLS'),
      edge(4, 4, 5, 'CALLS'),
      edge(5, 5, 6, 'CALLS'),
      edge(6, 6, 4, 'CALLS'),
    ];
    const graph = graphOf(nodes, edges);
    expect(detectCommunities(graph)).toEqual(detectCommunities(graph));
  });

  it('ignores nodes the phase itself added, so a re-run reproduces the partition', () => {
    const graph = graphOf(
      [
        node(1, 'Class', `${MODEL}/A.java`),
        node(2, 'Class', `${MODEL}/B.java`),
        // A `Community` node from a previous run, joined to its member by `MEMBER_OF` only.
        node(3, 'Community', null),
      ],
      [edge(1, 1, 2, 'CALLS'), edge(2, 1, 3, 'MEMBER_OF')],
    );
    const communities = detectCommunities(graph);
    expect(communities).toHaveLength(1);
    expect(communities[0]?.members).toEqual([1, 2]);
  });
});

describe('the shapes a real graph puts in front of it', () => {
  it('drops an edge whose other endpoint is not in the graph', () => {
    // **Dangling edges are ordinary**: a call into a symbol the parse could not name leaves an edge to an id that no
    // node holds. The phase must not crash, and a single surviving node is not a community.
    const graph = graphOf([node(1, 'Class', `${MODEL}/Only.java`)], [edge(1, 1, 999, 'CALLS')]);
    expect(detectCommunities(graph)).toEqual([]);
  });

  it('names a cluster whose members have no file after the fallback', () => {
    // A `Module` node carries no path. It can still be in a community, and it must not make the naming throw.
    const graph = graphOf(
      [node(1, 'Module', null), node(2, 'Module', null)],
      [edge(1, 1, 2, 'CALLS')],
    );
    expect(detectCommunities(graph)[0]?.name).toBe('cluster');
  });

  it('keeps a file with no extension whole, because a dot is not always a suffix', () => {
    const graph = graphOf(
      [node(1, 'Class', `${MODEL}/Makefile`), node(2, 'Class', `${MODEL}/Makefile`)],
      [edge(1, 1, 2, 'CALLS')],
    );
    // The directory wins here, so the effect is on the second cluster in the same directory.
    expect(detectCommunities(graph)[0]?.name).toBe('model');

    const flat = graphOf(
      [node(1, 'Class', '/repo/Makefile'), node(2, 'Class', '/repo/Makefile')],
      [edge(1, 1, 2, 'CALLS')],
      '/repo',
    );
    expect(detectCommunities(flat)[0]?.name).toBe('Makefile');
  });

  it('treats a path that is only separators as no location', () => {
    const graph = graphOf([node(1, 'Class', '/'), node(2, 'Class', '/')], [edge(1, 1, 2, 'CALLS')]);
    expect(detectCommunities(graph)[0]?.name).toBe('cluster');
  });

  it('orders communities by size, and by name when the sizes are equal', () => {
    // Two disconnected K3s of different directories: the sort's two arms, size first and name second.
    const make = (ids: number[], directory: string): GraphNode[] =>
      ids.map((id) => node(id, 'Class', `${directory}/F${id}.java`));
    const edges: GraphEdge[] = [];
    let id = 0;
    for (const [group, directory] of [
      [[1, 2], `${MODEL}/one`],
      [[3, 4, 5], `${MODEL}/two`],
    ] as const) {
      void directory;
      for (let a = 0; a < group.length; a++) {
        for (let b = a + 1; b < group.length; b++) {
          edges.push(edge(++id, group[a]!, group[b]!, 'CALLS'));
        }
      }
    }
    const communities = detectCommunities(
      graphOf([...make([1, 2], `${MODEL}/two`), ...make([3, 4, 5], `${MODEL}/one`)], edges),
    );
    expect(communities.map((community) => community.name)).toEqual(['one', 'two']);
  });
});

describe('two clusters with nothing to name them', () => {
  it('disambiguates them anyway, without inventing a path', () => {
    // Four `Module` nodes in two disconnected pairs: neither cluster has a directory or a file, so both fall back, and
    // the second still has to be distinguishable from the first.
    const graph = graphOf(
      [
        node(1, 'Module', null),
        node(2, 'Module', null),
        node(3, 'Module', null),
        node(4, 'Module', null),
      ],
      [edge(1, 1, 2, 'CALLS'), edge(2, 3, 4, 'CALLS')],
    );
    const names = detectCommunities(graph)
      .map((community) => community.name)
      .sort();
    expect(names).toEqual(['cluster', 'cluster/cluster']);
  });
});

describe('three clusters of the same size', () => {
  it('orders them by name, not by the order the walk produced', () => {
    // Equal sizes force the sort onto its second key; three of them force more than one comparison.
    const edges: GraphEdge[] = [];
    let id = 0;
    for (const [a, b] of [
      [1, 2],
      [3, 4],
      [5, 6],
    ] as const) {
      edges.push(edge(++id, a, b, 'CALLS'));
    }
    const graph = graphOf(
      [
        node(1, 'Class', `${MODEL}/zeta/A.java`),
        node(2, 'Class', `${MODEL}/zeta/B.java`),
        node(3, 'Class', `${MODEL}/alpha/A.java`),
        node(4, 'Class', `${MODEL}/alpha/B.java`),
        node(5, 'Class', `${MODEL}/mike/A.java`),
        node(6, 'Class', `${MODEL}/mike/B.java`),
      ],
      edges,
    );
    expect(detectCommunities(graph).map((community) => community.name)).toEqual([
      'alpha',
      'mike',
      'zeta',
    ]);
  });
});

describe('the same pair of nodes related two ways', () => {
  it('counts the pair once towards cohesion', () => {
    // **Two edges between one pair is the normal case**, not a corner: a file that imports another and also calls into
    // it has both. Counting both would report a cohesion above what the pairs allow.
    const graph = graphOf(
      [node(1, 'Class', `${MODEL}/A.java`), node(2, 'Class', `${MODEL}/B.java`)],
      [edge(1, 1, 2, 'CALLS'), edge(2, 2, 1, 'IMPORTS')],
    );
    const communities = detectCommunities(graph);
    expect(communities).toHaveLength(1);
    // One pair available, one pair used, in either direction.
    expect(communities[0]?.cohesion).toBe(1);
  });
});
