// The reachability primitive, tested as a primitive.
//
// **Everything the engine believes about a value comes from one walk**, and until this file existed that walk was only
// ever observed through the two questions asked of it - findings and return summaries. A mistake in the walk then
// surfaces as a plausible number in a benchmark rather than as a failing assertion, so the walk is exercised here
// directly: every hook, every way a value can stop, and every way a neutraliser can fail to apply.

import { describe, expect, it } from 'vitest';

import { cleansValue, neutralizedAt, propagate } from '../security/flow-reach.js';

import type {
  DefUseFact,
  FunctionCfg,
  SanitizerOccurrence,
  StatementFacts,
  TaintSinkOccurrence,
  TaintSourceOccurrence,
} from '../cfg/types.js';
import type { ReachState, ReachOutcome } from '../security/flow-reach.js';

const STRIDE = 1024;

/** One block of the fixture: what it defines, and the occurrences filed on it. */
interface BlockSpec {
  readonly defs?: readonly number[];
  readonly source?: TaintSourceOccurrence;
  readonly sink?: TaintSinkOccurrence;
  readonly sanitizers?: readonly SanitizerOccurrence[];
}

interface FixtureOptions {
  readonly unreachableLines?: ReadonlySet<number>;
  readonly constantDefs?: ReadonlyMap<number, ReadonlySet<number>>;
}

/**
 * A linear CFG with one statement per block.
 *
 * **`stmtIndex` equals the block index** so a `constantDefs` key names one statement rather than all of them - the
 * reachability facts are keyed by statement index, and a fixture where every statement is index 0 cannot express
 * "this one definition folds".
 */
function buildCfg(
  specs: readonly BlockSpec[],
  names: readonly string[],
  options: FixtureOptions = {},
): FunctionCfg {
  const blocks = specs.map((_spec, index) => ({
    index,
    startLine: index + 1,
    endLine: index + 1,
    statementCount: 1,
    isEntry: index === 0,
    isExit: index === specs.length - 1,
  }));

  const defs = new Map<
    number,
    Array<{
      point: { blockIndex: number; stmtIndex: number; line: number };
      bindingIdx: number;
      kind: 'must';
    }>
  >();
  const sourceSites = new Map<number, TaintSourceOccurrence>();
  const sinkSites = new Map<number, TaintSinkOccurrence>();
  const sanitizerSites = new Map<number, SanitizerOccurrence>();

  specs.forEach((spec, blockIndex) => {
    const key = blockIndex * STRIDE + blockIndex;
    if (spec.defs) {
      defs.set(
        key,
        spec.defs.map((bindingIdx) => ({
          point: { blockIndex, stmtIndex: blockIndex, line: blockIndex + 1 },
          bindingIdx,
          kind: 'must' as const,
        })),
      );
    }
    if (spec.source) sourceSites.set(key, spec.source);
    if (spec.sink) sinkSites.set(key, spec.sink);
    // One occurrence per statement, which is what the field's type says: the sanitizer list of a statement collapses to
    // its last occurrence, so a fixture that filed two on one statement would be testing a shape the type forbids.
    const sanitizer = spec.sanitizers?.[spec.sanitizers.length - 1];
    if (sanitizer) sanitizerSites.set(key, sanitizer);
  });

  const stmtFacts: StatementFacts = {
    defs,
    uses: new Map(),
    sourceSites,
    sinkSites,
    sanitizerSites,
    ...(options.unreachableLines === undefined
      ? {}
      : { unreachableLines: options.unreachableLines }),
    ...(options.constantDefs === undefined ? {} : { constantDefs: options.constantDefs }),
  };

  return {
    functionName: 'reachFn',
    filePath: 'reach.ts',
    startLine: 1,
    startColumn: 1,
    blocks,
    edges: blocks
      .slice(0, -1)
      .map((block) => ({ from: block.index, to: block.index + 1, kind: 'seq' as const })),
    bindings: names.map((name, index) => ({
      index,
      name,
      kind: 'local' as const,
      declLine: index + 1,
      declColumn: 1,
      synthetic: false,
    })),
    stmtFacts,
    entryIndex: 0,
    exitIndex: specs.length - 1,
  };
}

/** Def→use fact: the value written at block `def` is read at block `use`. */
function fact(def: number, use: number, bindingIdx = def, bindingName = `v${def}`): DefUseFact {
  return {
    bindingIdx,
    bindingName,
    def: { blockIndex: def, stmtIndex: def, line: def + 1 },
    use: { blockIndex: use, stmtIndex: use, line: use + 1 },
  };
}

function sourceAt(blockIndex: number, bindingIdx: number): TaintSourceOccurrence {
  return {
    point: { blockIndex, stmtIndex: blockIndex, line: blockIndex + 1 },
    bindingIdx,
    category: 'remote-input',
    description: 'request parameter',
    line: blockIndex + 1,
  };
}

function sinkAt(blockIndex: number): TaintSinkOccurrence {
  return {
    point: { blockIndex, stmtIndex: blockIndex, line: blockIndex + 1 },
    kind: 'sql-injection',
    description: 'query execution',
    line: blockIndex + 1,
  };
}

function escapeAt(blockIndex: number, names: readonly string[]): SanitizerOccurrence {
  return {
    point: { blockIndex, stmtIndex: blockIndex, line: blockIndex + 1 },
    neutralizedKinds: new Set(['sql-injection']),
    neutralizedNames: new Set(names),
    description: 'prepared statement',
  };
}

function seedAt(blockIndex: number, source: TaintSourceOccurrence, bindingIdx = 0): ReachState {
  return {
    bindingIdx,
    point: { blockIndex, stmtIndex: blockIndex, line: blockIndex + 1 },
    exclusions: new Set<string>(),
    source,
    viaBlocks: [blockIndex],
  };
}

/** A three-block fixture: source at B0, a definition at B1, a sink at B2. */
function threeBlocks(
  middle: BlockSpec,
  options: FixtureOptions & { readonly sink?: boolean } = {},
): FunctionCfg {
  return buildCfg(
    [
      { defs: [0], source: sourceAt(0, 0) },
      middle,
      { defs: [2], ...(options.sink === false ? {} : { sink: sinkAt(2) }) },
    ],
    ['input', 'middle', 'query'],
    options,
  );
}

/** One delivery: the statement the value reached, and what it carried when it got there. */
interface Visit {
  /** Block index of the *use* - a `ReachState.point` is where the binding was defined, which is a different thing. */
  readonly at: number;
  readonly exclusions: ReadonlySet<string>;
}

/** Records what every hook was handed, so an assertion is about the walk rather than about a downstream finding. */
function recorder(): {
  visits: Visit[];
  deadEnds: number[];
  definitions: number[];
  hooks: Parameters<typeof propagate>[3];
} {
  const visits: Visit[] = [];
  const deadEnds: number[] = [];
  const definitions: number[] = [];
  return {
    visits,
    deadEnds,
    definitions,
    hooks: {
      onUse: (state, use) => {
        visits.push({ at: use.use.blockIndex, exclusions: state.exclusions });
      },
      onDefinition: (edge) => {
        definitions.push(edge.bindingIdx);
        return undefined;
      },
      onDeadEnd: (_state, use) => {
        deadEnds.push(use.use.blockIndex);
      },
    },
  };
}

const OPTIONS = {
  sanitizers: new Map<number, readonly SanitizerOccurrence[]>(),
  maxIterations: 100,
};

/** The sanitizer index the propagator hands the walk: one bucket per statement key. */
function sanitizerIndexOf(cfg: FunctionCfg): ReadonlyMap<number, readonly SanitizerOccurrence[]> {
  return new Map([...cfg.stmtFacts.sanitizerSites].map(([key, occurrence]) => [key, [occurrence]]));
}

/** The walk over the three-block fixture, with the sanitizers the fixture filed on its middle statement. */
function walk(cfg: FunctionCfg): { outcome: ReachOutcome; seen: ReturnType<typeof recorder> } {
  const seen = recorder();
  const outcome = propagate(
    cfg,
    [fact(0, 1), fact(1, 2)],
    [seedAt(0, sourceAt(0, 0))],
    seen.hooks,
    {
      ...OPTIONS,
      sanitizers: sanitizerIndexOf(cfg),
    },
  );
  return { outcome, seen };
}

describe('cleansValue — three answers, three analyses', () => {
  it('applies to every statement when the arguments could not be read', () => {
    expect(
      cleansValue(
        {
          point: { blockIndex: 0, stmtIndex: 0, line: 1 },
          neutralizedKinds: new Set(['xss']),
          description: 'escape',
        },
        'bar',
      ),
    ).toBe(true);
  });

  it('applies to nothing when the neutraliser read literal arguments only', () => {
    const literal = {
      point: { blockIndex: 0, stmtIndex: 0, line: 1 },
      neutralizedKinds: new Set(['sql-injection']),
      neutralizedNames: new Set<string>(),
      description: 'setString(1, "constant")',
    };
    expect(cleansValue(literal, 'bar')).toBe(false);
    // **A neutraliser that read its arguments and found no value** cleans nothing, and the value it did not name has no
    // name to be matched against: `carriedName === undefined` is the statement-level reading, and the empty set says the
    // statement read only literals.
    expect(cleansValue(literal, undefined)).toBe(true);
  });

  it('names the value it cleans', () => {
    const occurrence = escapeAt(0, ['bar']);
    expect(cleansValue(occurrence, 'bar')).toBe(true);
    // `encodeForHTML(param)` does not clean `bar` in the same call.
    expect(cleansValue(occurrence, 'param')).toBe(false);
  });
});

describe('neutralizedAt — per value, not per statement', () => {
  it('returns the kinds of every occurrence that cleans the carried value', () => {
    const index = new Map<number, readonly SanitizerOccurrence[]>([[7, [escapeAt(0, ['bar'])]]]);
    expect([...neutralizedAt(index, 7, 'bar')]).toEqual(['sql-injection']);
    expect([...neutralizedAt(index, 7, 'param')]).toEqual([]);
  });

  it('has no answer for a statement it never saw', () => {
    expect(neutralizedAt(new Map(), 7, 'bar').size).toBe(0);
  });
});

describe('propagate — the walk itself', () => {
  it('delivers a value to every statement it reaches, once', () => {
    const { outcome, seen } = walk(threeBlocks({ defs: [1] }));

    expect(seen.visits.map((visit) => visit.at)).toEqual([1, 2]);
    expect(outcome.factsProcessed).toBe(2);
    expect(outcome.sanitizerKills).toBe(0);
  });

  it('carries the neutralisation forward when the neutraliser names the value', () => {
    const { outcome, seen } = walk(
      threeBlocks({ defs: [1], sanitizers: [escapeAt(1, ['input'])] }),
    );

    expect(outcome.sanitizerKills).toBe(1);
    // The exclusion is on the *inherited* value, not on the statement that applied it: the definition at B1 is what
    // carries it, and the sink at B2 sees it.
    expect([...seen.visits[1]!.exclusions]).toEqual(['sql-injection']);
  });

  it('does not credit a neutraliser that names another value', () => {
    // `execute(escape(other), param)` escapes one argument and passes the other through, and it is one statement.
    const { outcome, seen } = walk(
      threeBlocks({ defs: [1], sanitizers: [escapeAt(1, ['other'])] }),
    );

    expect(outcome.sanitizerKills).toBe(0);
    expect(seen.visits[1]!.exclusions.size).toBe(0);
  });

  it('does not credit a neutraliser that adds no kind', () => {
    const kindless: SanitizerOccurrence = {
      point: { blockIndex: 1, stmtIndex: 1, line: 2 },
      neutralizedKinds: new Set<string>(),
      neutralizedNames: new Set(['input']),
      description: 'a check, not an escape',
    };
    const { outcome, seen } = walk(threeBlocks({ defs: [1], sanitizers: [kindless] }));

    expect(outcome.sanitizerKills).toBe(0);
    expect(seen.visits[1]!.exclusions.size).toBe(0);
  });

  it('stops where a statement writes no name, and says so', () => {
    // `map.put("k", param)` reads the value and writes nothing: no finding, no error - and the one place a caller has
    // to know about, because the collection hands the value back through an edge this model cannot see.
    const { seen } = walk(
      buildCfg(
        [{ defs: [0], source: sourceAt(0, 0) }, {}, { defs: [2], sink: sinkAt(2) }],
        ['input', 'sink', 'query'],
      ),
    );

    expect(seen.deadEnds).toEqual([1]);
    expect(seen.visits.map((visit) => visit.at)).toEqual([1]);
  });

  it('lets a hook keep a value out of the name it writes', () => {
    const cfg = threeBlocks({ defs: [1] });
    const seen = recorder();
    const hooks = { ...seen.hooks, onDefinition: () => ({ stop: true }) };
    propagate(cfg, [fact(0, 1), fact(1, 2)], [seedAt(0, sourceAt(0, 0))], hooks, OPTIONS);

    // The use at B1 is delivered - the value did reach the statement - but the name it writes does not inherit it.
    expect(seen.visits.map((visit) => visit.at)).toEqual([1]);
  });

  it('lets a hook add the neutralisations the callee applied', () => {
    const cfg = threeBlocks({ defs: [1] });
    const seen = recorder();
    const hooks = {
      ...seen.hooks,
      onDefinition: () => ({ neutralized: new Set(['sql-injection']) }),
    };
    propagate(cfg, [fact(0, 1), fact(1, 2)], [seedAt(0, sourceAt(0, 0))], hooks, OPTIONS);

    expect([...seen.visits[1]!.exclusions]).toEqual(['sql-injection']);
  });

  it('does not hand on a definition the file arithmetic decides', () => {
    // `bar = (7 * 18) + num > 200 ? "constant" : param` gives `bar` one value and it is not the argument's.
    const cfg = threeBlocks({ defs: [1] }, { constantDefs: new Map([[1, new Set([1])]]) });
    const { seen } = walk(cfg);

    expect(seen.visits.map((visit) => visit.at)).toEqual([1]);
  });

  it('does not read a line no path reaches', () => {
    const cfg = threeBlocks({ defs: [1] }, { unreachableLines: new Set([3]) });
    const { seen } = walk(cfg);

    // The sink at B2 sits on line 3, inside an arm a constant condition closes.
    expect(seen.visits.map((visit) => visit.at)).toEqual([1]);
  });

  it('bounds the worklist, so a pathological fixture cannot spin', () => {
    const seen = recorder();
    const outcome = propagate(
      threeBlocks({ defs: [1] }),
      [fact(0, 1), fact(1, 2)],
      [seedAt(0, sourceAt(0, 0))],
      seen.hooks,
      { ...OPTIONS, maxIterations: 1 },
    );

    expect(outcome.iterations).toBe(1);
    expect(seen.visits.map((visit) => visit.at)).toEqual([1]);
  });

  it('is monotone in the exclusion set, so a more dangerous state re-enters the worklist', () => {
    // Two paths to one definition: the clean one is long, the neutralised one is short, so the clean state arrives
    // second and must be reprocessed - that is the only direction that makes the value more dangerous.
    const cfg = buildCfg(
      [
        { defs: [0], source: sourceAt(0, 0) },
        { defs: [1], sanitizers: [escapeAt(1, ['input'])] },
        { defs: [2] },
        { defs: [3] },
        { sink: sinkAt(4) },
      ],
      ['input', 'escaped', 'clean', 'hop', 'query'],
    );
    const seen = recorder();
    propagate(
      cfg,
      [
        fact(0, 1),
        fact(0, 2),
        fact(1, 4, 1, 'escaped'),
        fact(2, 3, 2, 'clean'),
        fact(3, 4, 3, 'hop'),
      ],
      [seedAt(0, sourceAt(0, 0))],
      seen.hooks,
      { ...OPTIONS, sanitizers: sanitizerIndexOf(cfg) },
    );

    // The sink is delivered twice - once carrying the escape, once without it - and the second delivery is the one the
    // monotone rule exists for.
    const atSink = seen.visits.filter((visit) => visit.at === 4);
    expect(atSink.map((visit) => visit.exclusions.size)).toEqual([1, 0]);
  });
});
