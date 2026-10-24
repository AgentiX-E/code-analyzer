// Functions nothing calls - and the guard that stops the answer from being "all of them".
//
// **The failure this file exists to prevent is a confident wrong answer**, and there is a specific one available: a
// graph with no `CALLS` edges makes **every** function look uncalled. Until this week that was every graph this
// project could produce, so a detector written before the fix would have reported the entire codebase as dead and
// been believed. **The first two cases below are about that**, before any case is about finding anything.

import { describe, expect, it } from 'vitest';

import { findUnreachableFunctions } from '../impact/unreachable-functions.js';

import type { KnowledgeGraph } from '@code-analyzer/shared';

/** A graph built by hand, because this is a test of the rule rather than of a run. */
function graphWith(
  nodes: Array<{ id: number; name: string; filePath: string; label?: string }>,
  edges: Array<{ sourceId: number; targetId: number; type: string }>,
): KnowledgeGraph {
  return {
    nodes: new Map(
      nodes.map((n) => [n.id, { ...n, label: n.label ?? 'Function', projectId: 'p' }]),
    ),
    edges: new Map(edges.map((e, i) => [i, { id: i, projectId: 'p', ...e }])),
  } as unknown as KnowledgeGraph;
}

describe('functions nothing calls', () => {
  it('reports nothing at all when the graph has no call edges', () => {
    // **The case that makes the feature safe to ship.** Every function is uncalled when no call was recorded, and
    // returning them all would be a report of "the whole codebase is dead" - **which is not a finding, it is a
    // missing prerequisite.** The count is returned so the caller can tell the difference.
    const graph = graphWith(
      [
        { id: 1, name: 'helper', filePath: 'src/a.ts' },
        { id: 2, name: 'other', filePath: 'src/b.ts' },
      ],
      [],
    );

    const report = findUnreachableFunctions(graph);

    expect(report.callsEdgeCount).toBe(0);
    expect(report.candidates).toEqual([]);
    // **And nothing was even considered**, which is the honest statement: the question could not be asked.
    expect(report.considered).toBe(0);
  });

  it('finds the function nothing calls once call edges exist', () => {
    const graph = graphWith(
      [
        { id: 1, name: 'entry', filePath: 'src/main.ts' },
        { id: 2, name: 'caller', filePath: 'src/a.ts' },
        { id: 3, name: 'callee', filePath: 'src/a.ts' },
        { id: 4, name: 'orphan', filePath: 'src/b.ts' },
      ],
      [
        { sourceId: 1, targetId: 2, type: 'CALLS' },
        { sourceId: 2, targetId: 3, type: 'CALLS' },
      ],
    );

    const report = findUnreachableFunctions(graph);

    expect(report.callsEdgeCount).toBe(2);
    // **`callee` is called and `caller` is called**, so only `orphan` is a candidate - an assertion about who is
    // *absent* from the list, because a detector that reported everything would satisfy a `toContain` alone.
    const names = report.candidates.map((c) => c.name);
    expect(names).toContain('orphan');
    expect(names).not.toContain('callee');
    expect(names).not.toContain('caller');
  });

  it('does not report an entry point, which the runtime calls and this graph does not', () => {
    const graph = graphWith(
      [
        { id: 1, name: 'main', filePath: 'src/main.ts' },
        { id: 2, name: 'reallyOrphaned', filePath: 'src/b.ts' },
      ],
      [{ sourceId: 2, targetId: 1, type: 'CALLS' }],
    );

    const report = findUnreachableFunctions(graph);
    const names = report.candidates.map((c) => c.name);

    // **`main` is uncalled by construction** - a CLI entry point is invoked by the operating system - and reporting
    // it is a false positive delivered with confidence.
    expect(names).not.toContain('main');
  });

  it('keeps test-file functions out by default, and counts what it kept out', () => {
    const graph = graphWith(
      [
        { id: 1, name: 'used', filePath: 'src/a.ts' },
        { id: 2, name: 'srcOrphan', filePath: 'src/b.ts' },
        { id: 3, name: 'testHelper', filePath: 'src/__tests__/a.test.ts' },
      ],
      [{ sourceId: 2, targetId: 1, type: 'CALLS' }],
    );

    const quiet = findUnreachableFunctions(graph);
    expect(quiet.candidates.map((c) => c.name)).not.toContain('testHelper');
    // **The exclusion is visible rather than silent**, so a reader can ask for it back.
    expect(quiet.excludedByTestCount).toBe(1);

    const loud = findUnreachableFunctions(graph, { includeTests: true });
    expect(loud.candidates.map((c) => c.name)).toContain('testHelper');
    expect(loud.candidates.find((c) => c.name === 'testHelper')?.inATest).toBe(true);
  });

  it('carries the reason for each candidate, so a reader can disagree with it', () => {
    const graph = graphWith(
      [
        { id: 1, name: 'a', filePath: 'src/a.ts' },
        { id: 2, name: 'b', filePath: 'src/b.ts' },
      ],
      [{ sourceId: 2, targetId: 1, type: 'CALLS' }],
    );

    const report = findUnreachableFunctions(graph);

    // **A verdict without a reason cannot be argued with**, and every one of these is a candidate rather than a
    // certainty: the function may be called from outside the repository, through reflection, or by a test.
    expect(report.candidates.length).toBeGreaterThan(0);
    for (const candidate of report.candidates) {
      expect(candidate.reason).toMatch(/CALLS/);
      expect(candidate.filePath.length).toBeGreaterThan(0);
    }
  });
});

// The four things that are not a dead function, each with the reason it is not one.
//
// **Every one of these is a false positive if it is missed**: a class is not a function, an entry point is called by
// the runtime, a test is called by the runner, and a node with no file is a node the detector cannot judge. **A
// detector is judged by what it refuses to report**, which is why these cases sit beside the ones that report.
describe('what is not a dead function', () => {
  it('ignores an edge that is not a call', () => {
    const graph = graphWith(
      [
        { id: 1, name: 'declared', filePath: 'src/a.ts' },
        { id: 2, name: 'file', filePath: 'src/a.ts', label: 'Module' },
      ],
      [{ sourceId: 2, targetId: 1, type: 'DEFINES' }],
    );

    const report = findUnreachableFunctions(graph);

    // **No call edge, so the question cannot be asked** - and the count says so rather than the answer being "all".
    expect(report.callsEdgeCount).toBe(0);
    expect(report.candidates).toEqual([]);
  });

  it('does not consider a node that is not function-like', () => {
    const graph = graphWith(
      [
        { id: 1, name: 'counter', filePath: 'src/a.ts', label: 'Variable' },
        { id: 2, name: 'caller', filePath: 'src/b.ts' },
        { id: 3, name: 'called', filePath: 'src/c.ts' },
      ],
      [{ sourceId: 2, targetId: 3, type: 'CALLS' }],
    );

    const report = findUnreachableFunctions(graph);

    // Two function-like nodes were considered; the variable was not.
    expect(report.considered).toBe(2);
    expect(report.candidates.map((c) => c.name)).not.toContain('counter');
  });

  it('does not report an entry point as unreachable', () => {
    // `main` is called by the runtime, and saying otherwise is a confident false positive.
    const graph = graphWith(
      [
        { id: 1, name: 'main', filePath: 'src/index.ts' },
        { id: 2, name: 'called', filePath: 'src/c.ts' },
        { id: 3, name: 'caller', filePath: 'src/d.ts' },
      ],
      [{ sourceId: 3, targetId: 2, type: 'CALLS' }],
    );

    const report = findUnreachableFunctions(graph);

    expect(report.candidates.map((c) => c.name)).not.toContain('main');
  });

  it('counts a test-only function as excluded rather than dead', () => {
    const graph = graphWith(
      [
        { id: 1, name: 'helperInTest', filePath: 'src/a.test.ts' },
        { id: 2, name: 'called', filePath: 'src/c.ts' },
        { id: 3, name: 'caller', filePath: 'src/d.ts' },
      ],
      [{ sourceId: 3, targetId: 2, type: 'CALLS' }],
    );

    const report = findUnreachableFunctions(graph);

    expect(report.excludedByTestCount).toBe(1);
    expect(report.candidates.map((c) => c.name)).not.toContain('helperInTest');
  });

  it('treats a node with no file path as a node outside any test', () => {
    // `String(node.filePath ?? '')` — a node the parser could not place in a file is not in a test file, and calling
    // it one would silently drop it from the report.
    const graph = graphWith([{ id: 1, name: 'nowhere', filePath: '' }], []);
    graph.nodes.get(1)!.filePath = undefined as unknown as string;
    const withCalls = graphWith(
      [
        { id: 1, name: 'nowhere', filePath: 'src/x.ts' },
        { id: 2, name: 'called', filePath: 'src/c.ts' },
        { id: 3, name: 'caller', filePath: 'src/d.ts' },
      ],
      [{ sourceId: 3, targetId: 2, type: 'CALLS' }],
    );
    withCalls.nodes.get(1)!.filePath = undefined as unknown as string;

    expect(findUnreachableFunctions(graph).candidates).toEqual([]);
    expect(findUnreachableFunctions(withCalls).candidates.map((c) => c.name)).toContain('nowhere');
  });
});
