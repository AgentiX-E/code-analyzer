// What a call hands back, asked of the table that answers it.
//
// **`bar = helper(param)` is the whole question.** The propagator sees a statement that read a tainted name and wrote
// one; only the callee's summary can say whether the value survived the trip. `CallReturns` composes the two, and the
// composition has more ways to answer "I cannot say" than to answer yes or no — a call the analysis did not resolve, an
// arity that does not line up, an argument the value is not in, a callee that declares no parameters. Every one of them
// has to leave the conservative reading in place, and every one of them is a branch below.
//
// The fixtures are synthetic on purpose: the shapes being exercised (a call site with no recorded argument positions, an
// empty `argArguments`, a definition on a line that calls nothing) are ones a real provider cannot be relied on to emit.
// Everything the pipeline computes — reaching definitions, return summaries, verdicts — is computed from the fixture's
// stated definitions and reads, so no assertion here is made against a summarised assumption.

import { describe, expect, it } from 'vitest';

import { TaintPipeline } from '../security/taint-pipeline.js';

import type { FunctionCfg, StatementFacts } from '../cfg/types.js';
import type { CallSite } from '@code-analyzer/shared';

/** One statement of a one-block fixture. */
interface Stmt {
  readonly line: number;
  /** Bindings this statement writes. */
  readonly defs?: readonly number[];
  /** Bindings this statement reads. */
  readonly reads?: readonly number[];
  /** Binding index of a taint source on this statement. */
  readonly source?: number;
  /** Sink kind on this statement. */
  readonly sink?: string;
  /** Whether this statement is a `return`, which is a fact about the flow out of the function, not a sink. */
  readonly returns?: boolean;
  /** Neutralisers on this statement, by the names they clean. */
  readonly sanitizers?: ReadonlyArray<{
    readonly kinds: readonly string[];
    readonly names: readonly string[];
  }>;
  readonly calls?: readonly CallSite[];
}

/**
 * A function whose whole body is one block, with statements indexed by their position in the list.
 *
 * **`returnLines` is stated only where the fixture is a callee.** A function whose returns were not read is a different
 * answer from one that has no return, and the field being absent is how the fixture says the first.
 */
function oneBlock(
  name: string,
  statements: readonly Stmt[],
  parameters?: readonly number[],
): FunctionCfg {
  const defs = new Map<
    number,
    Array<{
      point: { blockIndex: number; stmtIndex: number; line: number };
      bindingIdx: number;
      kind: 'may' | 'must';
    }>
  >();
  const uses = new Map<
    number,
    Array<{ point: { blockIndex: number; stmtIndex: number; line: number }; bindingIdx: number }>
  >();
  const sourceSites = new Map<
    number,
    {
      point: { blockIndex: number; stmtIndex: number; line: number };
      bindingIdx: number;
      category: string;
      description: string;
      line: number;
    }
  >();
  const sinkSites = new Map<
    number,
    {
      point: { blockIndex: number; stmtIndex: number; line: number };
      kind: string;
      description: string;
      line: number;
    }
  >();
  const sanitizerSites = new Map<
    number,
    {
      point: { blockIndex: number; stmtIndex: number; line: number };
      neutralizedKinds: Set<string>;
      neutralizedNames: Set<string>;
      description: string;
    }
  >();
  const bindings = new Map<number, string>();

  statements.forEach((stmt, stmtIndex) => {
    const point = { blockIndex: 0, stmtIndex, line: stmt.line };
    if (stmt.defs) {
      defs.set(
        stmtIndex,
        stmt.defs.map((bindingIdx) => ({ point, bindingIdx, kind: 'may' as const })),
      );
      for (const bindingIdx of stmt.defs) bindings.set(bindingIdx, `v${bindingIdx}`);
    }
    if (stmt.reads)
      uses.set(
        stmtIndex,
        stmt.reads.map((bindingIdx) => ({ point, bindingIdx })),
      );
    if (stmt.source !== undefined) {
      sourceSites.set(stmtIndex, {
        point,
        bindingIdx: stmt.source,
        category: 'remote-input',
        description: 'request.getParameter',
        line: stmt.line,
      });
    }
    if (stmt.sink !== undefined) {
      sinkSites.set(stmtIndex, { point, kind: stmt.sink, description: stmt.sink, line: stmt.line });
    }
    // One occurrence per statement, which is the shape `StatementFacts.sanitizerSites` imposes.
    const sanitizer = stmt.sanitizers?.[stmt.sanitizers.length - 1];
    if (sanitizer) {
      sanitizerSites.set(stmtIndex, {
        point,
        neutralizedKinds: new Set(sanitizer.kinds),
        neutralizedNames: new Set(sanitizer.names),
        description: `${stmt.line}: escape`,
      });
    }
  });

  // A parameter is declared by a statement that writes it; keep the numbering dense so `parameterIndex` is meaningful.
  for (const bindingIdx of parameters ?? []) bindings.set(bindingIdx, `p${bindingIdx}`);

  const stmtFacts: StatementFacts = {
    defs,
    uses,
    sourceSites,
    sinkSites,
    sanitizerSites,
    ...(parameters === undefined
      ? {}
      : // A callee's returns are the statements that return; the caller is not a callee and reads no returns.
        {
          returnLines: new Set(
            statements.filter((stmt) => stmt.returns === true).map((stmt) => stmt.line),
          ),
        }),
  };

  return {
    functionName: name,
    filePath: `${name}.ts`,
    startLine: 1,
    startColumn: 1,
    blocks: [
      {
        index: 0,
        startLine: 1,
        endLine: statements.length,
        statementCount: statements.length,
        isEntry: true,
        isExit: true,
      },
    ],
    edges: [],
    bindings: [...bindings.keys()]
      .sort((a, b) => a - b)
      .map((index) => ({
        index,
        name: bindings.get(index)!,
        kind: 'local' as const,
        declLine: 1,
        declColumn: 1,
        synthetic: false,
        ...(parameters?.includes(index) === true
          ? { parameterIndex: parameters.indexOf(index) }
          : {}),
      })),
    ...(parameters === undefined ? {} : { parameterBindings: parameters }),
    stmtFacts,
    entryIndex: 0,
    exitIndex: 0,
    // **A call site carries the statement it sits on**, which is what makes "where the result lands" answerable: the
    // statement's definitions are the names it writes. A fixture that left this at 0 would point every call at whichever
    // name happens to be written first in the function.
    callSites: statements.flatMap((stmt, stmtIndex) =>
      (stmt.calls ?? []).map((site) => ({ ...site, stmtIndex })),
    ),
  };
}

function call(
  line: number,
  calleeName: string,
  argBindings: readonly number[],
  argArguments?: readonly number[],
  resultBinding = -1,
): CallSite {
  return {
    blockIndex: 0,
    stmtIndex: 0,
    line,
    calleeName,
    argBindings,
    resultBinding,
    ...(argArguments === undefined ? {} : { argArguments }),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** `read` returns whatever it was passed: line 4 declares the parameter, line 5 returns it. */
function readCallee(): FunctionCfg {
  return oneBlock(
    'read',
    [
      { line: 4, defs: [0] },
      { line: 5, reads: [0], returns: true },
    ],
    [0],
  );
}

/** `ignore` returns a value of its own: the parameter is declared and never read again. */
function ignoreCallee(): FunctionCfg {
  return oneBlock(
    'ignore',
    [
      { line: 4, defs: [0] },
      { line: 5, defs: [1] },
      { line: 6, reads: [1], returns: true },
    ],
    [0],
  );
}

/** A callee that declares no parameters at all. */
function statelessCallee(): FunctionCfg {
  return oneBlock(
    'stateless',
    [
      { line: 4, defs: [0] },
      { line: 5, reads: [0], returns: true },
    ],
    [],
  );
}

/**
 * A callee that reads the request itself and returns what it read.
 *
 * **This is the generative direction, and neither half of it is a parameter.** The callee declares none, so no call
 * result can be derived from an argument; what makes its caller tainted is its own read reaching its own return.
 */
function readRequestCallee(escape = false): FunctionCfg {
  const statements: Stmt[] = [{ line: 4, defs: [0], source: 0 }];
  if (escape) {
    statements.push({
      line: 5,
      defs: [1],
      reads: [0],
      sanitizers: [{ kinds: ['html'], names: ['v0'] }],
    });
    statements.push({ line: 6, reads: [1], returns: true });
  } else {
    statements.push({ line: 5, reads: [0], returns: true });
  }
  return oneBlock('readRequest', statements, []);
}

/** The caller: `v1` comes from the request, `v2` is what the call wrote, and `v2` (or a copy) reaches the sink. */
function caller(calls: readonly CallSite[], hopStatement = false): FunctionCfg {
  const statements: Stmt[] = [
    { line: 1, defs: [1], source: 1 },
    { line: 2, defs: [2], reads: [1], calls },
  ];
  if (hopStatement) {
    // **A definition on a line that calls nothing.** The table is asked about every definition edge, and here the only
    // correct answer is that this line says nothing about any call.
    statements.push({ line: 3, defs: [3], reads: [2] });
    statements.push({ line: 4, reads: [3], sink: 'xss' });
  } else {
    statements.push({ line: 3, reads: [2], sink: 'xss' });
  }
  return oneBlock('caller', statements);
}

/** Run the pipeline over the caller and its callees, and count what it reports. */
function findings(callerCfg: FunctionCfg, callees: readonly FunctionCfg[]): number {
  const cfgs = new Map<string, FunctionCfg>();
  for (const cfg of [callerCfg, ...callees]) cfgs.set(cfg.functionName, cfg);
  return new TaintPipeline().analyze(cfgs, []).findings.length;
}

describe('CallReturns — when a call can answer, and when it cannot', () => {
  it('keeps the flow when the callee returns its argument', () => {
    expect(findings(caller([call(2, 'read', [1])]), [readCallee()])).toBeGreaterThan(0);
  });

  it('stops the flow when the callee never reads the argument', () => {
    expect(findings(caller([call(2, 'ignore', [1])]), [ignoreCallee()])).toBe(0);
  });

  it('lets a carry outrank a clean answer on the same line', () => {
    // Two calls on one line, one of which passes the value through: the line passes the value through.
    expect(
      findings(caller([call(2, 'ignore', [1]), call(2, 'read', [1])]), [
        readCallee(),
        ignoreCallee(),
      ]),
    ).toBeGreaterThan(0);
  });

  it('lets a clean answer stand when no call on the line carries', () => {
    // The other half of the same rule: with only clean calls on the line, the value stops - and a second call that does
    // not receive it at all must not turn that into "cannot say".
    expect(
      findings(caller([call(2, 'ignore', [1]), call(2, 'ignore', [9])]), [ignoreCallee()]),
    ).toBe(0);
  });

  it('says nothing when the arity does not line up with the callee', () => {
    // Argument 1 of a two-argument call is not argument 1 of a one-argument callee, and guessing would be a wrong answer
    // rather than a missing one.
    expect(findings(caller([call(2, 'read', [1, 9])]), [readCallee()])).toBeGreaterThan(0);
  });

  it('says nothing about a callee that declares no parameters', () => {
    expect(findings(caller([call(2, 'stateless', [1])]), [statelessCallee()])).toBeGreaterThan(0);
  });

  it('says nothing about a call whose arguments are not bindings', () => {
    // `argBindings` carries -1 where the argument is not a simple name, and a position that is not known is not a
    // position this analysis can align with a parameter.
    expect(findings(caller([call(2, 'read', [-1])]), [readCallee()])).toBeGreaterThan(0);
  });

  it('reads a definition on a line with no call as saying nothing', () => {
    expect(findings(caller([call(2, 'read', [1])], true), [readCallee()])).toBeGreaterThan(0);
  });

  it('falls back to the index in the argument list when no positions were recorded', () => {
    // The field's contract: an empty `argArguments` means the positions are not known, and the index is the position.
    // Reading `[]` as "recorded, and there are none" dropped the call site entirely and silenced the flow.
    const empty = findings(caller([call(2, 'read', [1], [])]), [readCallee()]);
    const absent = findings(caller([call(2, 'read', [1])]), [readCallee()]);
    expect(empty).toBe(absent);
    expect(empty).toBeGreaterThan(0);
  });

  it('aligns a position through `argArguments` when the flat list is longer', () => {
    // `runCommand(`${prefix} ${term}`)` is one argument holding two bindings: the flat list has two entries and only the
    // argument each sits in can be aligned with a parameter.
    const findingsWithTemplate = findings(caller([call(2, 'read', [1], [0])]), [readCallee()]);
    expect(findingsWithTemplate).toBeGreaterThan(0);
  });
});

describe('a callee that reads the input itself is a source for its caller', () => {
  /** A caller whose statement 2 receives the result of a call and whose statement 3 sinks it. */
  function receives(calls: readonly CallSite[], sinkStatement: Stmt): FunctionCfg {
    return oneBlock('takes', [
      // No source of its own at all: the caller of a generative function passes a request object, not a tainted value.
      { line: 1, defs: [1] },
      { line: 2, defs: [2], reads: [1], calls },
      sinkStatement,
    ]);
  }

  it('finds the flow the caller could not have known about', () => {
    const findings = new TaintPipeline().analyze(
      new Map<string, FunctionCfg>([
        ['takes', receives([call(2, 'readRequest', [1])], { line: 3, reads: [2], sink: 'html' })],
        ['readRequest', readRequestCallee()],
      ]),
      [],
    ).findings;

    expect(findings.length).toBeGreaterThan(0);
    // **The report names the function the value came from.** The line the source is filed on holds a call, and a reader
    // sent there would find nothing; the origin travels with the source so the finding points at the read.
    expect(findings[0]!.source.origin).toBe('readRequest');
    expect(findings[0]!.sourceFn).toBe('readRequest');
    expect(findings[0]!.sinkFn).toBe('takes');
    expect(findings[0]!.callChain).toEqual(['readRequest', 'takes']);
  });

  it('carries the callee’s own escape, so the flow is reported as neutralised', () => {
    const findings = new TaintPipeline().analyze(
      new Map<string, FunctionCfg>([
        ['takes', receives([call(2, 'readRequest', [1])], { line: 3, reads: [2], sink: 'html' })],
        ['readRequest', readRequestCallee(true)],
      ]),
      [],
    ).findings;

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.sanitized).toBe(true);
  });

  it('seeds one value when one line calls the same source twice', () => {
    // `String both = one() + two();` - two calls, one name, one value. A second occurrence would be a second finding for
    // the same flow.
    const twice = new TaintPipeline().analyze(
      new Map<string, FunctionCfg>([
        [
          'takes',
          receives([call(2, 'readRequest', []), call(2, 'readRequest', [])], {
            line: 3,
            reads: [2],
            sink: 'html',
          }),
        ],
        ['readRequest', readRequestCallee()],
      ]),
      [],
    ).findings;

    expect(twice).toHaveLength(1);
  });

  it('has nowhere to put the value when the result is discarded', () => {
    // A call on a statement that writes no name - `helper.log(request)` - cannot leave a tainted value behind, and the
    // statement is skipped rather than the whole function.
    const discarded = new TaintPipeline().analyze(
      new Map<string, FunctionCfg>([
        [
          'takes',
          oneBlock('takes', [
            { line: 1, defs: [1] },
            { line: 2, reads: [1], calls: [call(2, 'readRequest', [1])] },
            { line: 3, reads: [1], sink: 'html' },
          ]),
        ],
        ['readRequest', readRequestCallee()],
      ]),
      [],
    ).findings;

    // The sink reads the request object itself, which this fixture does not taint: nothing was injected, so nothing is
    // reported. The point is that the discarded call did not crash the loop or invent a binding.
    expect(discarded).toHaveLength(0);
  });

  it('places the value at the binding a call declares as its result', () => {
    // **`resultBinding` is what a provider would record when it knows the destination**, and no provider does today - it
    // is -1 everywhere in the corpus. When it is set it outranks the statement's definitions, because the call said
    // where its value goes and a statement can write several names.
    const result = new TaintPipeline().analyze(
      new Map<string, FunctionCfg>([
        [
          'takes',
          oneBlock('takes', [
            { line: 1, defs: [1] },
            { line: 2, defs: [2], reads: [1], calls: [call(2, 'readRequest', [1], undefined, 2)] },
            { line: 3, reads: [2], sink: 'html' },
          ]),
        ],
        ['readRequest', readRequestCallee()],
      ]),
      [],
    ).findings;

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.source.origin).toBe('readRequest');
  });

  it('says nothing about a callee that records no parameter list at all', () => {
    // A CFG built before argument positions existed has no list, and `undefined` there is not the same as a callee with
    // no arguments: it has no position a call site could align with, so no call result can be derived from it.
    const { parameterBindings: _omitted, ...withoutList } = statelessCallee();
    const result = findings(caller([call(2, 'stateless', [1])]), [withoutList]);
    expect(result).toBeGreaterThan(0);
  });

  it('contributes a summary and no findings for a CFG it cannot read', () => {
    // **The file is analysed, not abandoned.** A CFG whose facts cannot be read costs its own findings and nothing else,
    // which is what keeps one malformed function from silencing a whole application.
    const readable = oneBlock('broken', [
      { line: 1, defs: [0], source: 0 },
      { line: 2, reads: [0], sink: 'html' },
    ]);
    const broken = { ...readable } as Record<string, unknown>;
    delete broken['stmtFacts'];
    Object.defineProperty(broken, 'stmtFacts', {
      get() {
        throw new Error('facts unavailable');
      },
    });

    const result = new TaintPipeline().analyze(
      new Map<string, FunctionCfg>([['broken', broken as unknown as FunctionCfg]]),
      [],
    );

    expect(result.findings).toHaveLength(0);
    expect(result.stats.functionsAnalyzed).toBe(1);
  });
});
