// A function that calls a sink without declaring any parameters.
//
// **`parameterBindings` is optional on `FunctionCfg`**, and the CFG builders do not populate it yet — so **the
// `?? []` in the interprocedural summary is not defensive, it is the state every cfg is in today**. What the summary
// must do then is *nothing*: no parameter can receive a taint wave, so no `paramToSinks` entry may be invented from
// argument positions that belong to a parameter the function does not have.

import { describe, expect, it } from 'vitest';

import { TaintPipeline } from '../security/taint-pipeline.js';

import type { FunctionCfg } from '../cfg/types.js';

function cfgWithoutParameters(): FunctionCfg {
  const point = { line: 3, column: 2, blockIndex: 0, statementIndex: 1 };
  return {
    functionName: 'handler',
    filePath: 'src/handler.ts',
    startLine: 1,
    startColumn: 0,
    blocks: [
      { index: 0, startLine: 1, endLine: 6, statementCount: 2, isEntry: true, isExit: true },
    ],
    edges: [],
    // A local binding exists, but **none of them is a parameter**.
    bindings: [
      { index: 0, name: 'value', kind: 'local', declLine: 2, declColumn: 2, synthetic: false },
    ],
    stmtFacts: {
      defs: new Map(),
      uses: new Map(),
      sourceSites: new Map([
        [
          1,
          {
            bindingIdx: 0,
            point,
            category: 'remote-input',
            description: 'request.body',
            line: 3,
          },
        ],
      ]),
      sinkSites: new Map([
        [
          1,
          {
            point,
            kind: 'sql-injection',
            description: 'db.query',
            line: 3,
          },
        ],
      ]),
      sanitizerSites: new Map(),
    },
    entryIndex: 0,
    exitIndex: 0,
    callSites: [{ calleeName: 'query', line: 3, argBindings: [0], argArguments: [0] }],
  };
}

describe('a function with no parameters', () => {
  it('reports no parameter-to-sink mapping it cannot justify', () => {
    const pipeline = new TaintPipeline();
    const result = pipeline.analyze(new Map([['handler', cfgWithoutParameters()]]), []);

    // The summary is built, and **the absence of `parameterBindings` reads as "no parameters" rather than as an
    // index into an empty list that happens to return -1**.
    expect(result.summariesAnalyzed).toBe(1);
    expect(result.findings).toEqual([]);
  });
});
