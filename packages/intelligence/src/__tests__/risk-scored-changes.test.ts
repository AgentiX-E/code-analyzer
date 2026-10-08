// The product's sentence, as two assertions.
//
// *"A symbol that changed and is only used inside the diff is usually fine; a symbol that changed and is used at four
// sites the author never opened is where the defects live."*
//
// **The first half and the second half are the two cases below**, in that order, because **a scorer that rates
// everything the same satisfies neither**. The interesting property is not that risky symbols score high - it is that
// **safe ones score low**, and a test that only checks the first cannot tell the difference.

import { describe, expect, it } from 'vitest';

import { scoreChangedSymbols } from '../impact/risk-scored-changes.js';

import type { KnowledgeGraph } from '@code-analyzer/shared';

/** Nodes and edges by hand, because this is a test of the rule rather than of a run. */
function graphWith(
  nodes: Array<{ id: number; name: string; filePath: string; projectId?: string }>,
  edges: Array<{ sourceId: number; targetId: number; type: string }>,
): KnowledgeGraph {
  return {
    nodes: new Map(nodes.map((n) => [n.id, { ...n, label: 'Function', projectId: n.projectId ?? 'p' }])),
    edges: new Map(edges.map((e, i) => [i, { id: i, projectId: 'p', ...e }])),
  } as unknown as KnowledgeGraph;
}

const CALLS = 'CALLS';
const CROSS_REPO_CALLS = 'CROSS_REPO_CALLS';
const IMPORTS = 'IMPORTS';

describe('scoring a change by who depends on it', () => {
  it('scores a symbol used only inside its own file at zero', () => {
    // **The sentence's first half**, and the assertion that makes the score a discriminator: *"only used inside the
    // diff is usually fine."*
    const graph = graphWith(
      [
        { id: 1, name: 'helper', filePath: 'src/a.ts' },
        { id: 2, name: 'caller', filePath: 'src/a.ts' },
      ],
      [{ sourceId: 2, targetId: 1, type: CALLS }],
    );

    const report = scoreChangedSymbols(graph, [{ name: 'helper', filePath: 'src/a.ts' }]);

    expect(report.changes[0]!.consumersInFile).toBe(1);
    expect(report.changes[0]!.consumersOutsideFile).toBe(0);
    // **Zero, not merely lower.** A symbol nobody outside the file uses is the case the sentence calls fine.
    expect(report.changes[0]!.risk).toBe(0);
  });

  it('scores a symbol used from other files higher than one used from its own', () => {
    const graph = graphWith(
      [
        { id: 1, name: 'shared', filePath: 'src/a.ts' },
        { id: 2, name: 'localOnly', filePath: 'src/b.ts' },
        { id: 3, name: 'inFileCaller', filePath: 'src/b.ts' },
        { id: 4, name: 'farCaller', filePath: 'src/c.ts' },
        { id: 5, name: 'farCaller2', filePath: 'src/d.ts' },
      ],
      [
        { sourceId: 3, targetId: 2, type: CALLS },
        { sourceId: 4, targetId: 1, type: CALLS },
        { sourceId: 5, targetId: 1, type: CALLS },
      ],
    );

    const report = scoreChangedSymbols(graph, [
      { name: 'shared', filePath: 'src/a.ts' },
      { name: 'localOnly', filePath: 'src/b.ts' },
    ]);

    const shared = report.changes.find((c) => c.name === 'shared')!;
    const local = report.changes.find((c) => c.name === 'localOnly')!;

    // **Both directions again**: the far-reaching one is high *and* the local one is zero.
    expect(shared.consumersOutsideFile).toBe(2);
    expect(shared.risk).toBeGreaterThan(local.risk);
    expect(local.risk).toBe(0);
    // **And the ordering is the report's**, because a caller should not have to re-derive it.
    expect(report.changes[0]!.name).toBe('shared');
    expect(report.maxRisk).toBe(shared.risk);
  });

  it('weighs a cross-repository consumer above a same-repository one', () => {
    // **No test in this repository can reach another repository**, which is why the term is separate and heavier.
    const graph = graphWith(
      [
        { id: 1, name: 'api', filePath: 'src/a.ts', projectId: 'repo-a' },
        { id: 2, name: 'otherRepoCaller', filePath: 'src/x.ts', projectId: 'repo-b' },
      ],
      [{ sourceId: 2, targetId: 1, type: CROSS_REPO_CALLS }],
    );

    const report = scoreChangedSymbols(graph, [{ name: 'api', filePath: 'src/a.ts' }]);
    const scored = report.changes[0]!;

    expect(scored.consumersInOtherRepos).toBe(1);
    // **Outside-file and other-repository both fire**, so the score is above either alone.
    expect(scored.risk).toBeGreaterThan(0.5);
    expect(scored.reasons.some((r) => /another repository/.test(r))).toBe(true);
  });

  it('scores an import as reach, not only a call', () => {
    // **A symbol reached by an import is reached**, and `IMPORTS` edges only started existing this week.
    const graph = graphWith(
      [
        { id: 1, name: 'exported', filePath: 'src/a.ts' },
        { id: 2, name: 'importer', filePath: 'src/b.ts' },
      ],
      [{ sourceId: 2, targetId: 1, type: IMPORTS }],
    );

    const report = scoreChangedSymbols(graph, [{ name: 'exported', filePath: 'src/a.ts' }]);

    expect(report.changes[0]!.consumersOutsideFile).toBe(1);
    expect(report.changes[0]!.risk).toBeGreaterThan(0);
  });

  it('says the reach is unknown when the symbol is not in the graph', () => {
    const graph = graphWith([{ id: 1, name: 'something', filePath: 'src/a.ts' }], []);

    const report = scoreChangedSymbols(graph, [{ name: 'renamedAway', filePath: 'src/a.ts' }]);

    // **Zero risk and a reason that names why**, rather than a silent zero that reads like "nothing depends on it".
    expect(report.changes[0]!.risk).toBe(0);
    expect(report.changes[0]!.reasons.join(' ')).toMatch(/not found in the graph/);
  });

  it('reports the call-edge count, because zero makes every score zero', () => {
    const graph = graphWith(
      [
        { id: 1, name: 'a', filePath: 'src/a.ts' },
        { id: 2, name: 'b', filePath: 'src/b.ts' },
      ],
      [],
    );

    const report = scoreChangedSymbols(graph, [{ name: 'a', filePath: 'src/a.ts' }]);

    // **The same guard as the dead-code detector and the census**, and for the same reason: without edges every
    // symbol looks unreached and a scorer would rate the whole codebase safe.
    expect(report.callsEdgeCount).toBe(0);
    expect(report.changes[0]!.risk).toBe(0);
  });
});
