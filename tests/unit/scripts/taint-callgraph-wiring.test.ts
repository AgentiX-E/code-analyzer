// The call graph the pipeline was given and did not pass on.
//
// `TaintPipeline.analyze` has always taken a `CallGraphEdge[]`, named `_callGraph` — the underscore saying plainly
// that it was unused. `InterprocSolver.loadCallGraph` existed and had no caller. `solve()` builds its reverse
// callee→caller index from the edges loaded there.
//
// **This test is structural**, like `taint-reachability.test.ts`, and for the same reason: the fact it pins is
// about wiring, and wiring is not observable by calling the method. `summariesAnalyzed` counted functions when the
// parameter was ignored too. What *is* observable changes only once call sites are extracted from the CFG, which is
// the part still missing — so this test guards the connection until then.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PIPELINE = 'packages/intelligence/src/security/taint-pipeline.ts';
const SOLVER = 'packages/intelligence/src/security/interproc-solver.ts';

describe('the pipeline passes the call graph to the solver', () => {
  it('no longer names the parameter as unused', () => {
    const source = readFileSync(PIPELINE, 'utf8');

    // Scoped to the signature: the first version checked the whole file, and failed against the comment added to
    // explain the fix, which names the old parameter. Refined only after reading the file.
    const signature = source
      .split('\n')
      .find((line) => line.includes('analyze(cfgs: Map<string, FunctionCfg>'));
    expect(signature).toBeDefined();
    expect(signature).not.toContain('_callGraph');
    expect(source).toMatch(
      /analyze\(cfgs: Map<string, FunctionCfg>, callGraph: CallGraphEdge\[\]\)/,
    );
  });

  it('calls loadCallGraph, which exists on the solver', () => {
    expect(readFileSync(PIPELINE, 'utf8')).toMatch(/this\.solver\.loadCallGraph\(callGraph\)/);
    expect(readFileSync(SOLVER, 'utf8')).toMatch(
      /loadCallGraph\(edges: readonly CallGraphEdge\[\]\): void/,
    );
  });

  it('still skips a callee the solver could not resolve, which is the remaining gap', () => {
    // `buildFunctionSummary` writes `calleeName: ''` and `resolved: false` for every entry, so `solve()` skips all
    // of them through this line. When real call sites are extracted from the CFG, this assertion is what should be
    // revisited — deliberately, and with the summary builder changing beside it.
    expect(readFileSync(SOLVER, 'utf8')).toMatch(/if \(!s2c\.resolved\) continue;/);
    expect(readFileSync(PIPELINE, 'utf8')).toMatch(/calleeName: ''/);
  });
});
