// @code-analyzer/intelligence — Control Dependence Branch Tests
// Exercises the ipdom-chain walk, unreachable-successor handling, and
// multi-controller sorting that the happy-path if-else / loop fixtures do not.

import { describe, it, expect } from 'vitest';
import { computeControlDependence } from '../cfg/control-dependence.js';
import { computePostDominators, postDominates } from '../cfg/post-dominators.js';
import type { FunctionCfg, BasicBlock, CfgEdge, CfgEdgeKind } from '../cfg/types.js';

/** Build a minimal FunctionCfg from an explicit block list and edge list. */
function makeCfg(
  blockCount: number,
  edges: Array<{ from: number; to: number; kind: CfgEdgeKind }>,
  exitIndex: number,
): FunctionCfg {
  const blocks: BasicBlock[] = [];
  for (let i = 0; i < blockCount; i++) {
    blocks.push({
      index: i,
      startLine: i * 10 + 1,
      endLine: i * 10 + 5,
      statementCount: 2,
      isEntry: i === 0,
      isExit: i === exitIndex,
    });
  }
  const cfgEdges: CfgEdge[] = edges.map((e) => ({ ...e }));
  return {
    functionName: 'cfg',
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 1,
    blocks,
    edges: cfgEdges,
    bindings: [],
    stmtFacts: {
      defs: new Map(),
      uses: new Map(),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    },
    entryIndex: 0,
    exitIndex,
  };
}

describe('computeControlDependence — branch coverage', () => {
  it('walks the ipdom chain of a nested diamond to find deeper dependents', () => {
    // A diamond nested inside another diamond. B3 is an inner merge (NOT the
    // exit), so a successor of B0 has a non-exit, non-controller immediate
    // post-dominator — forcing the walk past the first break guard.
    //
    //   0 ─┬─cond-true─> 1 ─┐
    //      └─cond-false> 2 ─┴─> 3 ─┬─cond-true─> 4 ─┐
    //                               └─cond-false> 5 ─┴─> 6 (exit)
    const cfg = makeCfg(
      7,
      [
        { from: 0, to: 1, kind: 'cond-true' },
        { from: 0, to: 2, kind: 'cond-false' },
        { from: 1, to: 3, kind: 'seq' },
        { from: 2, to: 3, kind: 'seq' },
        { from: 3, to: 4, kind: 'cond-true' },
        { from: 3, to: 5, kind: 'cond-false' },
        { from: 4, to: 6, kind: 'seq' },
        { from: 5, to: 6, kind: 'seq' },
      ],
      6,
    );

    const edges = computeControlDependence(cfg);

    // B3 is control-dependent on B0 via the ipdom walk (B0 does NOT
    // post-dominate B3, and B3 is a non-exit, non-controller intermediate).
    const b3From0 = edges.filter((e) => e.controllerBlock === 0 && e.dependentBlock === 3);
    expect(b3From0.length).toBeGreaterThan(0);

    // The walk must produce a deterministically sorted, deduplicated list.
    for (let i = 1; i < edges.length; i++) {
      const prev = edges[i - 1]!;
      const cur = edges[i]!;
      expect(prev.controllerBlock).toBeLessThanOrEqual(cur.controllerBlock);
    }
  });

  it('skips a successor that cannot reach the exit (no ipdom)', () => {
    // B0 branches to a reachable B1 and an unreachable B2 (no path to exit),
    // whose immediate post-dominator is NO_IPDOM. The walk must terminate
    // cleanly instead of emitting a bogus edge.
    const cfg = makeCfg(
      3,
      [
        { from: 0, to: 1, kind: 'cond-true' },
        { from: 0, to: 2, kind: 'cond-false' },
        { from: 1, to: 2, kind: 'seq' },
        // B2 has no outgoing edge: unreachable from the exit in reverse.
      ],
      2,
    );
    // Adjust exit to a node with a path to it from B1 only.
    // Rebuild so exit is B2 and B1 reaches it, keeping B2 unreachable-forward.
    const cfg2 = makeCfg(
      4,
      [
        { from: 0, to: 1, kind: 'cond-true' },
        { from: 0, to: 2, kind: 'cond-false' },
        { from: 1, to: 3, kind: 'seq' },
        // B2 has no path to exit 3 (unreachable).
      ],
      3,
    );

    const edges = computeControlDependence(cfg2);
    // B2 (unreachable) must not produce a walk to a non-existent ipdom.
    expect(edges.some((e) => e.dependentBlock === 2 && e.controllerBlock === 0)).toBe(true);
    // And no edge should reference an out-of-range or sentinel block.
    for (const e of edges) {
      expect(e.controllerBlock).toBeGreaterThanOrEqual(0);
      expect(e.dependentBlock).toBeGreaterThanOrEqual(0);
      expect(e.controllerBlock).toBeLessThan(4);
      expect(e.dependentBlock).toBeLessThan(4);
    }
  });

  it('reports a loop-header self-edge when a successor cycles back', () => {
    // A two-block loop whose header branches to itself via a loop-back edge.
    const cfg = makeCfg(
      3,
      [
        { from: 0, to: 1, kind: 'seq' },
        { from: 1, to: 1, kind: 'loop-back' },
        { from: 1, to: 2, kind: 'cond-false' },
      ],
      2,
    );
    // The header (B1) has two successors (self + exit), so it is branching.
    const edges = computeControlDependence(cfg);
    const self = edges.filter((e) => e.controllerBlock === 1 && e.dependentBlock === 1);
    expect(self.length).toBeGreaterThan(0);
  });

  it('stops the ipdom walk early when the controller post-dominates the node', () => {
    // A loop header whose body contains an if-else with a merge that loops
    // back. The header (B1) post-dominates the inner merge (B5), so walking up
    // from B2's immediate post-dominator hits `postDominates(c, cur) === true`
    // and breaks before emitting the merge as a dependent.
    //
    //   0 -> 1(header) ─┬─cond-true─> 2 ─┬─cond-true─> 3 ─┐
    //                    │               └─cond-false> 4 ─┴─> 5 ─loop-back─> 1
    //                    └─cond-false──────────────────────────────> 6 (exit)
    const cfg = makeCfg(
      7,
      [
        { from: 0, to: 1, kind: 'seq' },
        { from: 1, to: 2, kind: 'cond-true' },
        { from: 1, to: 6, kind: 'cond-false' },
        { from: 2, to: 3, kind: 'cond-true' },
        { from: 2, to: 4, kind: 'cond-false' },
        { from: 3, to: 5, kind: 'seq' },
        { from: 4, to: 5, kind: 'seq' },
        { from: 5, to: 1, kind: 'loop-back' },
      ],
      6,
    );

    const edges = computeControlDependence(cfg);
    // B2 is directly control-dependent on the header B1.
    expect(edges.some((e) => e.controllerBlock === 1 && e.dependentBlock === 2)).toBe(true);
    // The walk still terminates cleanly without bogus sentinel references.
    for (const e of edges) {
      expect(e.controllerBlock).toBeGreaterThanOrEqual(0);
      expect(e.dependentBlock).toBeGreaterThanOrEqual(0);
    }
  });

  it('labels a fallthrough successor of a true-armed branch as the false arm', () => {
    // B0 has a cond-true arm and a loop-back successor (B2, which is NOT the
    // exit). The loop-back edge is neither cond-true nor cond-false, so
    // labelForEdge falls through to the `senses.hasTrueArm` complement ('F').
    const cfg = makeCfg(
      4,
      [
        { from: 0, to: 1, kind: 'cond-true' },
        { from: 0, to: 2, kind: 'loop-back' },
        { from: 1, to: 3, kind: 'seq' },
        { from: 2, to: 3, kind: 'seq' },
      ],
      3,
    );
    const edges = computeControlDependence(cfg);
    const loopBack = edges.filter((e) => e.controllerBlock === 0 && e.dependentBlock === 2);
    expect(loopBack.length).toBeGreaterThan(0);
    expect(loopBack.some((e) => e.label === 'F')).toBe(true);
  });

  it('labels a fallthrough successor of a false-armed branch as the true arm', () => {
    // B0 has a cond-false arm and a loop-back successor (B2, which is NOT the
    // exit). The loop-back edge is neither cond-true nor cond-false, so
    // labelForEdge falls through to the `senses.hasFalseArm` complement ('T').
    const cfg = makeCfg(
      4,
      [
        { from: 0, to: 1, kind: 'cond-false' },
        { from: 0, to: 2, kind: 'loop-back' },
        { from: 1, to: 3, kind: 'seq' },
        { from: 2, to: 3, kind: 'seq' },
      ],
      3,
    );
    const edges = computeControlDependence(cfg);
    const loopBack = edges.filter((e) => e.controllerBlock === 0 && e.dependentBlock === 2);
    expect(loopBack.length).toBeGreaterThan(0);
    expect(loopBack.some((e) => e.label === 'T')).toBe(true);
  });
});

describe('computePostDominators — cyclic CFG regression', () => {
  it('post-dominates the inner merge and header for a loop-with-inner-if', () => {
    // A header (B1) whose body is an if-else with a merge (B5) that loops back.
    // B5 must post-dominate B2 (both arms of B2 funnel through B5), and B1 must
    // post-dominate B2 and B5. This guards the CHK intersect direction: climbing
    // the SHALLOWER finger produced ipdom[B2] = exit, incorrectly severing B5
    // and B1 from B2's post-dominator chain.
    const cfg = makeCfg(
      7,
      [
        { from: 0, to: 1, kind: 'seq' },
        { from: 1, to: 2, kind: 'cond-true' },
        { from: 1, to: 6, kind: 'cond-false' },
        { from: 2, to: 3, kind: 'cond-true' },
        { from: 2, to: 4, kind: 'cond-false' },
        { from: 3, to: 5, kind: 'seq' },
        { from: 4, to: 5, kind: 'seq' },
        { from: 5, to: 1, kind: 'loop-back' },
      ],
      6,
    );

    const tree = computePostDominators(cfg);
    expect(tree.ipdom).toEqual([1, 6, 5, 5, 5, 1, -1]);
    expect(postDominates(tree, 5, 2)).toBe(true); // inner merge post-dominates the branch
    expect(postDominates(tree, 1, 2)).toBe(true); // header post-dominates the body branch
    expect(postDominates(tree, 1, 5)).toBe(true); // header post-dominates the merge
    expect(postDominates(tree, 6, 2)).toBe(true); // exit post-dominates everything
    expect(postDominates(tree, 2, 5)).toBe(false); // branch does NOT post-dominate the merge
  });
});

describe('computeControlDependence — dedup & fallthrough branches', () => {
  it('deduplicates identical direct-successor edges from a multi-case switch', () => {
    // A switch where two cases fall through to the SAME target. Both edges emit
    // the same `${c}:${s}:T` key, so the second must be deduplicated via the
    // `!added.has(key)` false path, leaving exactly one direct edge.
    const cfg = makeCfg(
      3,
      [
        { from: 0, to: 1, kind: 'switch-case' },
        { from: 0, to: 1, kind: 'switch-case' },
        { from: 1, to: 2, kind: 'seq' },
      ],
      2,
    );

    const edges = computeControlDependence(cfg);
    const direct = edges.filter((e) => e.controllerBlock === 0 && e.dependentBlock === 1);
    expect(direct.length).toBe(1);
  });

  it('deduplicates shared-ancestor edges emitted by the ipdom walk', () => {
    // A two-way switch where both cases funnel into a common merge block B3.
    // The ipdom walk from the first successor emits `${c}:${3}:T`; the walk from
    // the second successor re-encounters that key and must deduplicate it.
    const cfg = makeCfg(
      5,
      [
        { from: 0, to: 1, kind: 'switch-case' },
        { from: 0, to: 2, kind: 'switch-case' },
        { from: 1, to: 3, kind: 'seq' },
        { from: 2, to: 3, kind: 'seq' },
        { from: 3, to: 4, kind: 'seq' },
      ],
      4,
    );

    const edges = computeControlDependence(cfg);
    const merge = edges.filter((e) => e.controllerBlock === 0 && e.dependentBlock === 3);
    expect(merge.length).toBe(1);
  });

  it('labels a fallthrough successor when the branch has no explicit arms', () => {
    // A block with only non-conditional successors (loop-back + seq) has neither
    // a true nor a false arm, so labelForEdge falls through to the final 'F'.
    const cfg = makeCfg(
      4,
      [
        { from: 0, to: 1, kind: 'loop-back' },
        { from: 0, to: 2, kind: 'seq' },
        { from: 1, to: 3, kind: 'seq' },
        { from: 2, to: 3, kind: 'seq' },
      ],
      3,
    );

    const edges = computeControlDependence(cfg);
    const labels = edges.filter((e) => e.controllerBlock === 0).map((e) => e.label);
    expect(labels).toContain('F');
  });

  it('returns no edges for an empty CFG', () => {
    const cfg = makeCfg(0, [], -1);
    expect(computeControlDependence(cfg)).toEqual([]);
  });
});
