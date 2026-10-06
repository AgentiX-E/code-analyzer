// The node-id allocation, tested by counting probes rather than by timing.
//
// **The defect this exists for.** `addNode` ensures a fresh node's id does not collide with one already in the graph:
//
//   while (graph.nodes.has(node.id)) {
//     node.id = this.nextNodeId++;
//   }
//
// **That is a linear probe, and it is called from a builder whose counter does not know about the graph.** The parse
// phase creates `new GraphBuilder(...)` **inside its per-file loop**, so every file starts allocating from the same
// low id, and the nodes from the previous files are already there. The first node of the thousandth file probes a
// thousand ids before it finds a free one.
//
// **The cost is therefore O(files x nodes)** - and that is what the profile showed: `provider.parse` is about 20 ms
// for a 1,238-line file on the second and later calls, while the phase reported about 770 ms per file. Three hundred
// and eighty-five times the parser's own cost, growing faster than the corpus.
//
// **Why the assertion counts probes and not milliseconds.** A test that asserts "under 100 ms" fails on a loaded
// machine and passes on an idle one, for reasons that have nothing to do with the allocation. The number of `has`
// calls is the defect itself, and it is the same on every machine.

import { describe, expect, it } from 'vitest';

import { GraphBuilder } from '../graph-builder.js';

import type { KnowledgeGraph } from '@code-analyzer/shared';

/** A graph whose `nodes.has` counts how many times it is asked - the probe the defect is made of. */
function countingGraph(): { graph: KnowledgeGraph; probes: () => number } {
  let probes = 0;
  const counted = () => {
    const map = new Map<number, unknown>();
    const realHas = map.has.bind(map);
    map.has = (key: number) => {
      probes += 1;
      return realHas(key);
    };
    return map;
  };
  const graph = {
    projectId: 'probe',
    nodes: counted(),
    // **Both tables, because both allocations probe.** `addEdge` carries the same loop as `addNode`, and edges
    // outnumber nodes in real code, so a count that watched only nodes would miss the larger half.
    edges: counted(),
    qnameIndex: new Map(),
    fileIndex: new Map(),
  } as unknown as KnowledgeGraph;
  return { graph, probes: () => probes };
}

const props = { name: 'x', filePath: '/x.ts', startLine: 1, endLine: 1, language: 'typescript' } as never;

describe('GraphBuilder node-id allocation', () => {
  it('does not probe the graph once per existing node', () => {
    const { graph, probes } = countingGraph();
    // **One builder per batch, the way the parse phase uses one per file.** Five hundred nodes arriving through
    // fifty builders is the shape the phase has, and it is where the linear probe turns into a quadratic one.
    const batches = 50;
    const perBatch = 10;
    for (let batch = 0; batch < batches; batch += 1) {
      const builder = new GraphBuilder(null as never);
      for (let i = 0; i < perBatch; i += 1) {
        builder.addNode(graph, 'Function' as never, `f${batch}_${i}`, props);
      }
    }

    expect(graph.nodes.size).toBe(batches * perBatch);
    // **A builder that knows where the graph ends probes once per node.** The defect probed once per node that
    // already existed, so the bound below is generous by a factor of several on purpose - it fails on the quadratic
    // behaviour and passes on any reasonable constant.
    expect(probes()).toBeLessThan(batches * perBatch * 3);
  });

  it('still refuses to reuse an id, whatever the builder was told', () => {
    const { graph } = countingGraph();
    // Two builders, each starting from its own counter. Both write into the same graph, and the ids must not clash.
    const a = new GraphBuilder(null as never);
    const b = new GraphBuilder(null as never);
    for (let i = 0; i < 40; i += 1) {
      a.addNode(graph, 'Function' as never, `a${i}`, props);
      b.addNode(graph, 'Function' as never, `b${i}`, props);
    }
    expect(graph.nodes.size).toBe(80);
    expect(new Set(graph.nodes.keys()).size).toBe(80);
  });
});

describe('GraphBuilder edge-id allocation', () => {
  it('does not probe the edge table once per existing edge, either', () => {
    const { graph, probes } = countingGraph();
    const batches = 50;
    const perBatch = 10;
    // Nodes first, so the edges have something to join.
    const builder0 = new GraphBuilder(null as never);
    const ids: number[] = [];
    for (let i = 0; i < batches * perBatch; i += 1) {
      ids.push(builder0.addNode(graph, 'Function' as never, `n${i}`, props).id);
    }
    const before = probes();
    for (let batch = 0; batch < batches; batch += 1) {
      const builder = new GraphBuilder(null as never);
      for (let i = 0; i < perBatch; i += 1) {
        builder.addEdge(graph, ids[batch * perBatch + i]!, ids[(batch * perBatch + i + 1) % ids.length]!, 'CALLS' as never, 'probe');
      }
    }
    const edgeProbes = probes() - before;

    expect(graph.edges.size).toBe(batches * perBatch);
    // **The same bound as the node table**, for the same reason: a builder that knows where the graph ends probes
    // once per edge, and the linear probe costs one per edge that already exists.
    expect(edgeProbes).toBeLessThan(batches * perBatch * 3);
  });
});

describe('a builder without a store', () => {
  it('builds nodes, which is what the two phases that pass no store actually do', () => {
    const { graph } = countingGraph();
    // `parse` and `tools` both construct one of these, build nodes, and never dump. **The optional parameter is what
    // lets them say so without a cast**, and this asserts that the usage they have is supported.
    const builder = new GraphBuilder();
    const node = builder.addNode(graph, 'Function' as never, 'f', props);
    const other = builder.addNode(graph, 'Function' as never, 'g', props);
    expect(node.id).not.toBe(other.id);
    expect(graph.nodes.size).toBe(2);
  });

  it('refuses to dump, and says why rather than dereferencing null', () => {
    const { graph } = countingGraph();
    const builder = new GraphBuilder();
    // **The error a cast used to postpone**: `parse.ts` wrote `null as unknown as InMemoryGraphStore`, which compiles
    // and then throws `cannot read properties of null (reading 'insertNode')` the first time a caller dumps.
    expect(() => builder.dumpToStore(graph, 'probe')).toThrow(/without a store/);
    expect(() => builder.dumpToStore(graph, 'probe')).toThrow(/addNode or addEdge/);
  });
});
