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
  const nodes = new Map<number, unknown>();
  const realHas = nodes.has.bind(nodes);
  nodes.has = (key: number) => {
    probes += 1;
    return realHas(key);
  };
  const graph = {
    projectId: 'probe',
    nodes,
    edges: new Map(),
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
