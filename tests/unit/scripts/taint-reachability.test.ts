// Which taint implementation the shipped tool actually uses.
//
// The repository contains three:
//
//   A. the `taint_analysis` MCP tool's own heuristic walk over graph nodes
//   B. `TaintAnalysisEngine`, a graph-based source→sink path finder
//   C. `TaintPropagator` + `InterprocSolver` + `TaintPipeline`, a CFG-based intra- and inter-procedural
//      analysis with its own test suite
//
// **C is not reachable from the MCP package**, and neither is B. The tool returns a note saying so in as many
// words: "Full taint analysis requires data-flow graph construction."
//
// This test is **structural**: it reads imports rather than behaviour, which is unusual here and deliberate. The
// fact it pins — that a finished, tested subsystem has no consumer — is a fact about the wiring, and it cannot be
// observed by calling the tool. It fails the day someone connects A to B or C, which is when the note in the tool
// should be removed too.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['node_modules', 'dist', '.turbo'].includes(entry)) continue;
      out.push(...filesUnder(full));
    } else if (full.endsWith('.ts') && !full.includes('__tests__')) out.push(full);
  }
  return out;
}

describe('taint reachability', () => {
  it('finds the CFG-based subsystem unreferenced from the MCP package', () => {
    const sources = filesUnder('packages/mcp/src');
    const referencing = sources.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /TaintPropagator|InterprocSolver|TaintPipeline/.test(text);
    });

    expect(sources.length).toBeGreaterThan(20);
    expect(referencing).toEqual([]);
  });

  it('finds the graph-based engine unreferenced from the MCP package', () => {
    const referencing = filesUnder('packages/mcp/src').filter((file) =>
      /TaintAnalysisEngine/.test(readFileSync(file, 'utf8')),
    );

    expect(referencing).toEqual([]);
  });

  it('keeps the tool honest about what it does', () => {
    // The sentence the tool returns. If the wiring above is ever done, this note is wrong and this test fails —
    // which is the intended way for the two to arrive together.
    const tool = readFileSync('packages/mcp/src/tools/pdg.ts', 'utf8');

    expect(tool).toMatch(/Full taint analysis requires data-flow graph construction/);
  });

  it('has exactly one production producer, and it is named', () => {
    // `FunctionCfg` is the type the whole CFG-based subsystem reads: the propagator, the reaching-definitions
    // analysis, the PDG builder, the pipeline. **Every assignment of its `stmtFacts` field in this repository is
    // inside a `__tests__` directory.** The analyser's own CFG builder produces a different type,
    // `ControlFlowGraph`, and nothing bridges the two.
    //
    // This assertion has already done its job once. It was written on 2026-09-18 to say "no production file
    // assigns `stmtFacts`", and it failed the next morning, when `cfg/from-parsed-files.ts` became the first
    // producer. It now names that producer instead of forbidding all of them: **a second one would fail this**, and
    // that is the point — the count is one, and adding another is a decision rather than an accident.
    const files = filesUnder('packages').filter((file) => !file.includes('__tests__'));
    const producing = files.filter((file) => /stmtFacts:\s*\{/.test(readFileSync(file, 'utf8')));

    expect(files.length).toBeGreaterThan(100);
    expect(producing).toEqual(['packages/intelligence/src/cfg/from-parsed-files.ts']);
  });

  it('keeps the CFG-based subsystem itself intact and tested', () => {
    // The other side of the same fact: the subsystem is not dead code to be deleted, it is unconnected work with a
    // suite of its own.
    const security = readdirSync('packages/intelligence/src/security');

    expect(security).toContain('taint-propagator.ts');
    expect(security).toContain('interproc-solver.ts');
    expect(security).toContain('taint-pipeline.ts');
    expect(
      readdirSync('packages/intelligence/src/__tests__').some((f) =>
        f.startsWith('taint-pipeline'),
      ),
    ).toBe(true);
  });
});
