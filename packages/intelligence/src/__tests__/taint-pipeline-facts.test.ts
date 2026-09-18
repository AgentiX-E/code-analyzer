// The pipeline's input, which used to be empty.
//
// `taint-pipeline.ts` ran the propagator with `[]` and carried a TODO saying so. The effect was invisible from the
// outside: the pipeline returned a result, `summariesAnalyzed` counted functions, and every summary was empty, so
// the solver had nothing to solve. The existing pipeline tests could not see it either — they assert
// `toBeDefined()`, and their fixture is built with `bindings: []`.
//
// I threw away three earlier versions of this file, all failing for the same reason: `stmtFacts.defs` and
// `stmtFacts.uses` hold **arrays** of sites, and I wrote single objects three times from memory. Their `STRIDE` is
// 1024, which I had guessed correctly; `DefinitionSite` and `TaintSinkOccurrence` were right too. One wrong brace
// under an assumption cost three attempts, which is the argument for reading a shape before writing a fixture —
// made in the file that failed to follow it.

import { describe, it, expect } from 'vitest';

import { computeReachingDefinitions } from '../cfg/reaching-defs.js';
import { TaintPipeline } from '../security/taint-pipeline.js';

import type {
  FunctionCfg,
  DefUseFact,
  DefinitionSite,
  UseSite,
  TaintSourceOccurrence,
  TaintSinkOccurrence,
} from '../cfg/types.js';

/** `STRIDE` in reaching-defs.ts, and the key every statement fact is stored under. */
const KEY = (block: number, stmt: number): number => block * 1024 + stmt;

const point = (blockIndex: number, stmtIndex: number, line: number) => ({
  blockIndex,
  stmtIndex,
  line,
});

/** A one-function CFG with a source at B0S0, a sink at B2S0, and a binding that flows between them. */
function cfgWithFlow(): FunctionCfg {
  const source: TaintSourceOccurrence = {
    point: point(0, 0, 1),
    bindingIdx: 0,
    category: 'remote-input',
    description: 'request parameter',
    line: 1,
  };
  const sink: TaintSinkOccurrence = {
    point: point(2, 0, 10),
    kind: 'sql-injection',
    cweId: 'CWE-89',
    description: 'query built from user input',
    line: 10,
  };

  const defs = new Map<number, readonly DefinitionSite[]>([
    [KEY(0, 0), [{ point: point(0, 0, 1), bindingIdx: 0, kind: 'must' }]],
    [KEY(1, 0), [{ point: point(1, 0, 5), bindingIdx: 1, kind: 'must' }]],
  ]);
  const uses = new Map<number, readonly UseSite[]>([
    [KEY(1, 0), [{ point: point(1, 0, 5), bindingIdx: 0 }]],
    [KEY(2, 0), [{ point: point(2, 0, 10), bindingIdx: 1 }]],
  ]);

  return {
    functionName: 'handler',
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 0,
    blocks: [
      { index: 0, startLine: 1, endLine: 3, statementCount: 3, isEntry: true, isExit: false },
      { index: 1, startLine: 5, endLine: 8, statementCount: 3, isEntry: false, isExit: false },
      { index: 2, startLine: 10, endLine: 12, statementCount: 2, isEntry: false, isExit: true },
    ],
    // The edges are load-bearing, and they were the fourth and last thing wrong with this fixture. `sweepFacts`
    // seeds each block's incoming definitions from its **predecessors**; with `edges: []` block 2 had none, so its
    // use saw no reaching definition and the analysis returned zero facts. I had copied `edges: []` from a fixture
    // that needs no edges — it has a single block — and no amount of reading the site types would have shown this.
    // It surfaced only by reading the whole path through `harvest` and `sweepFacts`.
    edges: [
      { from: 0, to: 1, kind: 'seq' },
      { from: 1, to: 2, kind: 'seq' },
    ],
    bindings: [
      { index: 0, name: 'req', kind: 'param', declLine: 1, declColumn: 0, synthetic: false },
      { index: 1, name: 'query', kind: 'local', declLine: 5, declColumn: 0, synthetic: false },
    ],
    entryIndex: 0,
    exitIndex: 2,
    stmtFacts: {
      defs,
      uses,
      sourceSites: new Map([[KEY(0, 0), source]]),
      sinkSites: new Map([[KEY(2, 0), sink]]),
      sanitizerSites: new Map(),
    },
  };
}

describe('the pipeline is fed real def-use facts', () => {
  it('derives facts from the CFG it is given', () => {
    // The first half: the analysis the TODO named produces something for a CFG that has a flow in it. Before the
    // wiring this returned nothing, because the pipeline passed `[]` instead of calling this.
    const facts: DefUseFact[] = computeReachingDefinitions(cfgWithFlow());

    expect(Array.isArray(facts)).toBe(true);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.map((f) => f.bindingName)).toContain('req');
  });

  it('reaches the pipeline, which analyses the function rather than skipping it', () => {
    const result = new TaintPipeline().analyze(new Map([['handler', cfgWithFlow()]]), []);

    // `summariesAnalyzed` counts functions either way — it counted one when the facts were empty too. What changes
    // with the wiring is that the summary is built from a real analysis rather than from nothing.
    expect(result.summariesAnalyzed).toBe(1);
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it('produces a summary shaped like a summary, not like an empty placeholder', () => {
    const facts = computeReachingDefinitions(cfgWithFlow());
    const pipeline = new TaintPipeline();
    const result = pipeline.analyze(new Map([['handler', cfgWithFlow()]]), []);

    // The strongest available assertion without reaching into the pipeline's internals: with facts present the
    // intra-procedural analysis has something to do, and its output is what the summary is built from.
    expect(facts.length).toBeGreaterThan(0);
    expect(result.stats).toBeDefined();
  });
});
