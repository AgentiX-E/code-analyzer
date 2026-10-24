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
  const point = { blockIndex: 0, stmtIndex: 1, line: 3 };
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
    callSites: [
      {
        blockIndex: 0,
        stmtIndex: 1,
        line: 3,
        calleeName: 'query',
        argBindings: [0],
        argArguments: [0],
        resultBinding: -1,
      },
    ],
  };
}

describe('a function with no parameters', () => {
  it('reports no parameter-to-sink mapping it cannot justify', () => {
    const pipeline = new TaintPipeline();
    const result = pipeline.analyze(new Map([['handler', cfgWithoutParameters()]]), []);

    // **The local finding is real and stays**: the source and the sink are in the same function, so the
    // intra-procedural analysis found them without any parameter at all.
    expect(result.summariesAnalyzed).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.hops).toBe(1);

    // **And nothing interprocedural was invented from it.** A finding that travelled `hops > 1` would mean the summary
    // read an argument position as a parameter the function does not declare — the exact defect the `?? []` must not
    // turn into a positive index.
    expect(result.findings.every((f) => f.hops === 1)).toBe(true);
  });
});
