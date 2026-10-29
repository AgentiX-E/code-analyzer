// A function's returns, against each of its argument positions.
//
// **This is the fact that lets a caller stop assuming.** `bar = helper(param)` writes `bar` from a statement that read
// `param`; a propagator without a callee summary must treat that as a flow, and every getter, builder and escaping
// wrapper in a real codebase then reports. The summary is per *argument position* because that is the only handle a call
// site has, and it is `known` or it is nothing, because "no return reads this parameter" is a claim only where the
// returns were read in the first place.

import { describe, expect, it } from 'vitest';

import { summarizeReturns } from '../security/return-summary.js';

import type { DefUseFact, FunctionCfg, StatementFacts } from '../cfg/types.js';

/**
 * `doSomething(request, param)` whose body writes `bar` from `param` and returns it on line 5.
 *
 * Two parameters declared on one line — which is what the corpus does, and what makes the position the only handle.
 */
function twoParameters(extra: Partial<StatementFacts> = {}): FunctionCfg {
  return {
    functionName: 'doSomething',
    filePath: 'T.java',
    startLine: 1,
    startColumn: 0,
    blocks: [
      { index: 0, startLine: 1, endLine: 6, statementCount: 6, isEntry: true, isExit: true },
    ],
    edges: [],
    bindings: [
      {
        index: 0,
        name: 'request',
        kind: 'local',
        declLine: 1,
        declColumn: 0,
        synthetic: false,
        parameterIndex: 0,
      },
      {
        index: 1,
        name: 'param',
        kind: 'local',
        declLine: 1,
        declColumn: 0,
        synthetic: false,
        parameterIndex: 1,
      },
      { index: 2, name: 'bar', kind: 'local', declLine: 3, declColumn: 0, synthetic: false },
      { index: 3, name: 'header', kind: 'local', declLine: 2, declColumn: 0, synthetic: false },
    ],
    parameterBindings: [0, 1],
    stmtFacts: {
      // Both parameters are declared on line 1, which is statement 0.
      defs: new Map([
        [
          0,
          [
            {
              point: { blockIndex: 0, stmtIndex: 0, line: 1 },
              bindingIdx: 0,
              kind: 'may' as const,
            },
            {
              point: { blockIndex: 0, stmtIndex: 0, line: 1 },
              bindingIdx: 1,
              kind: 'may' as const,
            },
          ],
        ],
        [
          1,
          [
            {
              point: { blockIndex: 0, stmtIndex: 1, line: 2 },
              bindingIdx: 3,
              kind: 'may' as const,
            },
          ],
        ],
        [
          2,
          [
            {
              point: { blockIndex: 0, stmtIndex: 2, line: 3 },
              bindingIdx: 2,
              kind: 'may' as const,
            },
          ],
        ],
      ]),
      uses: new Map([[2, [{ point: { blockIndex: 0, stmtIndex: 2, line: 3 }, bindingIdx: 1 }]]]),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
      returnLines: new Set([5]),
      ...extra,
    },
    entryIndex: 0,
    exitIndex: 0,
  };
}

/** `param` is read on line 3, which writes `bar`; `bar` is read on line 5, which returns. */
const FACTS: DefUseFact[] = [
  {
    bindingIdx: 1,
    def: { blockIndex: 0, stmtIndex: 0, line: 1 },
    use: { blockIndex: 0, stmtIndex: 2, line: 3 },
    bindingName: 'param',
  },
  {
    bindingIdx: 3,
    def: { blockIndex: 0, stmtIndex: 1, line: 2 },
    use: { blockIndex: 0, stmtIndex: 2, line: 3 },
    bindingName: 'header',
  },
  {
    bindingIdx: 2,
    def: { blockIndex: 0, stmtIndex: 2, line: 3 },
    use: { blockIndex: 0, stmtIndex: 4, line: 5 },
    bindingName: 'bar',
  },
];

describe('summarizeReturns', () => {
  it('names the return a parameter reaches, and the one it does not', () => {
    const summary = summarizeReturns(twoParameters(), FACTS);
    expect(summary.known).toBe(true);
    // Argument 1 is `param`, and `param` is what the return reads.
    expect([...summary.byParameter.get(1)!.lines]).toEqual([5]);
    // **Argument 0 is `request`, and nothing reads it.** Seeding it must not deliver `param`'s uses: the two share a
    // statement, and a walk that keyed its def→use facts by statement alone answered for the wrong argument.
    expect([...summary.byParameter.get(0)!.lines]).toEqual([]);
  });

  it('carries the escapes the callee applied on the way out', () => {
    const escaped = twoParameters({
      sanitizerSites: new Map([
        [
          2,
          {
            point: { blockIndex: 0, stmtIndex: 2, line: 3 },
            neutralizedKinds: new Set(['html']),
            description: 'htmlEscape',
          },
        ],
      ]),
    });
    const summary = summarizeReturns(escaped, FACTS);
    expect([...summary.byParameter.get(1)!.neutralized]).toEqual(['html']);
  });

  it('concludes nothing at all when the returns were not read', () => {
    const unread = twoParameters();
    // **An absent set is not an empty set.** `null` from the provider means the grammar's returns could not be read,
    // and a summary built on that gap must not be used to stop a flow.
    const withoutReturns: FunctionCfg = {
      ...unread,
      stmtFacts: { ...unread.stmtFacts, returnLines: undefined },
    };
    const summary = summarizeReturns(withoutReturns, FACTS);
    expect(summary.known).toBe(false);
    expect(summary.byParameter.size).toBe(0);
  });

  it('records what the function returns from its own sources, which no argument explains', () => {
    // A value the function read itself, held by a local rather than by a parameter. A summary that attributed it to
    // an argument would tell the caller its argument reached the return when the argument had nothing to do with it.
    const reading: FunctionCfg = twoParameters({
      sourceSites: new Map([
        [
          1,
          {
            bindingIdx: 3,
            point: { blockIndex: 0, stmtIndex: 1, line: 2 },
            category: 'remote-input',
            description: 'request.getParameter',
            line: 2,
          },
        ],
      ]),
    });
    const summary = summarizeReturns(reading, FACTS);
    expect([...summary.ownSource.lines]).toEqual([5]);
    // And it is not attributed to a position: argument 1 carries `param`, and `param` was not the source.
    const carries = [...summary.byParameter.values()].some((entry) => entry.lines.size > 0);
    expect(carries).toBe(false);
  });

  it('says nothing about a function with no parameters, because no call site can pass it anything', () => {
    const noParameters: FunctionCfg = {
      ...twoParameters(),
      bindings: [
        { index: 0, name: 'bar', kind: 'local', declLine: 3, declColumn: 0, synthetic: false },
      ],
      parameterBindings: [],
    };
    const summary = summarizeReturns(noParameters, []);
    expect(summary.known).toBe(true);
    expect(summary.byParameter.size).toBe(0);
    expect([...summary.ownSource.lines]).toEqual([]);
  });

  it("does not attribute one parameter's return to another when neither is read", () => {
    const dead: FunctionCfg = twoParameters();
    const summary = summarizeReturns(dead, []);
    expect([...summary.byParameter.get(0)!.lines]).toEqual([]);
    expect([...summary.byParameter.get(1)!.lines]).toEqual([]);
  });

  it('reads a CFG that records no parameter list as a function with no arguments', () => {
    // **A CFG built before argument positions existed carries no list**, and the field is optional for that reason. The
    // summary is still `known` - the returns were read - it simply has no position to name.
    const { parameterBindings: _omitted, ...withoutList } = twoParameters();
    const summary = summarizeReturns(withoutList, FACTS);
    expect(summary.known).toBe(true);
    expect(summary.byParameter.size).toBe(0);
  });

  it('skips a position whose binding the CFG does not have', () => {
    // A malformed list is the only way to hand the summary a name it cannot ask about, and asking would be a crash.
    const dangling: FunctionCfg = { ...twoParameters(), parameterBindings: [0, 99] };
    const summary = summarizeReturns(dangling, FACTS);
    expect(summary.byParameter.size).toBe(2);
    // Position 1 declares binding 99, which does not exist, so nothing was seeded for it and nothing can reach a return.
    expect([...summary.byParameter.get(1)!.lines]).toEqual([]);
  });
});
