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
    nodes: new Map(nodes.map((n) => [n.id, { ...n, label: n.label ?? 'Function', projectId: 'p' }])),
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
