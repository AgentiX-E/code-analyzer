// The call graph the pipeline was given and did not pass on.
//
// `TaintPipeline.analyze` took a `CallGraphEdge[]` named with a leading underscore — the convention that says a
// parameter is unused — and `InterprocSolver.loadCallGraph` existed with no caller. Both are now connected, and
// `buildFunctionSummary` reads `cfg.callSites` and derives `resolved` from the functions it was given, instead of
// emitting one fabricated call-argument entry per block of each finding's path.
//
// **These tests are structural**, like `taint-reachability.test.ts`: wiring is not observable by calling the method,
// and `summariesAnalyzed` counted functions while the parameter was ignored too.
//
// **Every negative assertion reads `codeOnly`.** The first versions read the raw file and failed against the
// comments explaining the changes — twice, in two consecutive commits, the second time against a comment written
// minutes earlier in the same commit. A pattern that matches prose about code is the defect this repository has
// spent many commits on. **Strip comments before asserting anything about source.**

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PIPELINE = 'packages/intelligence/src/security/taint-pipeline.ts';
const SOLVER = 'packages/intelligence/src/security/interproc-solver.ts';

/** Source with line comments removed, so an assertion cannot match an explanation of the code. */
function codeOnly(file: string): string {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

describe('the pipeline passes the call graph to the solver', () => {
  it('no longer names the parameter as unused', () => {
    const signature = readFileSync(PIPELINE, 'utf8')
      .split('\n')
      .find((line) => line.includes('analyze(cfgs: Map<string, FunctionCfg>'));

    expect(signature).toBeDefined();
    // The signature line, not the file: the header comment names the old parameter.
    expect(signature).not.toContain('_');
    expect(signature).toContain('callGraph: CallGraphEdge[]');
  });

  it('calls loadCallGraph, which exists on the solver', () => {
    expect(codeOnly(PIPELINE)).toMatch(/this\.solver\.loadCallGraph\(callGraph\)/);
    expect(codeOnly(SOLVER)).toMatch(/loadCallGraph\(edges: readonly CallGraphEdge\[\]\): void/);
  });

  it('derives resolution from the analysed functions instead of hardcoding it', () => {
    // An earlier assertion pinned the opposite: the summary builder wrote an empty callee name and `false` for
    // every entry, so `solve()` skipped all of them. That pin was written to fail here, and it did.
    expect(codeOnly(PIPELINE)).not.toMatch(/calleeName: ''/);
    expect(codeOnly(PIPELINE)).toMatch(/resolved: knownFunctions\.has\(call\.calleeName\)/);
    expect(codeOnly(SOLVER)).toMatch(/if \(!s2c\.resolved\) continue;/);
  });

  it('reads call sites from the CFG rather than fabricating them', () => {
    expect(codeOnly(PIPELINE)).toMatch(/for \(const call of cfg\.callSites \?\? \[\]\)/);
    // The fabrication: one entry per block of the finding's path, with a line number derived from the block index.
    expect(codeOnly(PIPELINE)).not.toMatch(/for \(const block of finding\.path\)/);
    expect(codeOnly(PIPELINE)).not.toMatch(/callLine: block \* 100/);
  });

  it('reports the functions it was given as the resolution set', () => {
    expect(codeOnly(PIPELINE)).toMatch(/const knownFunctions = new Set\(cfgs\.keys\(\)\)/);
  });
});
