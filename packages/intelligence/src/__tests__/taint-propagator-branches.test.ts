// @code-analyzer/intelligence — Taint propagation branch coverage:
// confidence modifiers (sanitizer exclusions, long paths) and the monotone
// worklist re-enqueue/skip decision for re-derived taint.

import { describe, it, expect } from 'vitest';
import { TaintPropagator } from '../security/taint-propagator.js';
import type {
  FunctionCfg,
  DefUseFact,
  TaintSourceOccurrence,
  TaintSinkOccurrence,
  SanitizerOccurrence,
  StatementFacts,
} from '../cfg/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStmtFactsWithTaint(
  sources: Array<[number, TaintSourceOccurrence]>,
  sinks: Array<[number, TaintSinkOccurrence]>,
  sanitizers: Array<[number, SanitizerOccurrence]>,
  defs: Array<
    [
      number,
      Array<{
        point: { blockIndex: number; stmtIndex: number; line: number };
        bindingIdx: number;
        kind: 'must' | 'may';
      }>,
    ]
  >,
): StatementFacts {
  return {
    defs: new Map(
      defs.map(([k, v]) => [
        k,
        v.map((d) => ({ point: d.point, bindingIdx: d.bindingIdx, kind: d.kind })),
      ]),
    ),
    uses: new Map(),
    sourceSites: new Map(sources),
    sinkSites: new Map(sinks),
    sanitizerSites: new Map(sanitizers),
  };
}

/** Builds a linear CFG of `nBlocks` blocks (indices 0..n-1) with a source in
 *  block 0 and a single `sql-injection` sink in the last block. Each block
 *  defines its own binding so def→use facts can chain taint forward. */
function buildLinearCfg(nBlocks: number): FunctionCfg {
  const blocks = Array.from({ length: nBlocks }, (_, i) => ({
    index: i,
    startLine: i + 1,
    endLine: i + 1,
    statementCount: 1,
    isEntry: i === 0,
    isExit: i === nBlocks - 1,
  }));

  const stmtFacts = makeStmtFactsWithTaint(
    [
      [
        0 * 1024 + 0,
        {
          point: { blockIndex: 0, stmtIndex: 0, line: 1 },
          bindingIdx: 0,
          category: 'remote-input',
          description: 'User input',
          line: 1,
        },
      ],
    ],
    [
      [
        (nBlocks - 1) * 1024 + 0,
        {
          point: { blockIndex: nBlocks - 1, stmtIndex: 0, line: nBlocks },
          kind: 'sql-injection',
          description: 'SQL execution',
          line: nBlocks,
        },
      ],
    ],
    [],
    blocks.map((b) => [
      b.index * 1024 + 0,
      [
        {
          point: { blockIndex: b.index, stmtIndex: 0, line: b.index + 1 },
          bindingIdx: b.index,
          kind: 'must',
        },
      ],
    ]),
  );

  return {
    functionName: 'linearFn',
    filePath: 't.ts',
    startLine: 1,
    startColumn: 1,
    blocks,
    edges: blocks
      .slice(0, -1)
      .map((b) => ({ from: b.index, to: b.index + 1, kind: 'seq' as const })),
    bindings: blocks.map((b) => ({
      index: b.index,
      name: `v${b.index}`,
      kind: 'local' as const,
      declLine: b.index + 1,
      declColumn: 1,
      synthetic: false,
    })),
    stmtFacts,
    entryIndex: 0,
    exitIndex: nBlocks - 1,
  };
}

/** Chains taint forward one block at a time through a linear CFG. */
function linearFacts(nBlocks: number): DefUseFact[] {
  const facts: DefUseFact[] = [];
  for (let i = 0; i < nBlocks - 1; i++) {
    facts.push({
      bindingIdx: i,
      bindingName: `v${i}`,
      def: { blockIndex: i, stmtIndex: 0, line: i + 1 },
      use: { blockIndex: i + 1, stmtIndex: 0, line: i + 2 },
    });
  }
  return facts;
}

/**
 * Builds a 5-block diamond CFG:
 *   B0 = source, B1 = sanitizer (neutralizes 'xss'), B2 = merge + sink,
 *   B3 / B4 = intermediate clean blocks.
 * The def→use facts passed to `analyze` control whether the sanitized or clean
 * path reaches B2 first.
 */
function buildDiamondCfg(): FunctionCfg {
  const blocks = [
    { index: 0, startLine: 1, endLine: 1, statementCount: 1, isEntry: true, isExit: false },
    { index: 1, startLine: 2, endLine: 2, statementCount: 1, isEntry: false, isExit: false },
    { index: 2, startLine: 3, endLine: 3, statementCount: 1, isEntry: false, isExit: true },
    { index: 3, startLine: 4, endLine: 4, statementCount: 1, isEntry: false, isExit: false },
    { index: 4, startLine: 5, endLine: 5, statementCount: 1, isEntry: false, isExit: false },
  ];

  const stmtFacts = makeStmtFactsWithTaint(
    [
      [
        0 * 1024 + 0,
        {
          point: { blockIndex: 0, stmtIndex: 0, line: 1 },
          bindingIdx: 0,
          category: 'remote-input',
          description: 'User input',
          line: 1,
        },
      ],
    ],
    [
      [
        2 * 1024 + 0,
        {
          point: { blockIndex: 2, stmtIndex: 0, line: 3 },
          kind: 'sql-injection',
          description: 'SQL execution',
          line: 3,
        },
      ],
    ],
    [
      [
        1 * 1024 + 0,
        {
          point: { blockIndex: 1, stmtIndex: 0, line: 2 },
          neutralizedKinds: new Set(['xss']),
          description: 'HTML escape',
        },
      ],
    ],
    [0, 1, 2, 3, 4].map((b) => [
      b * 1024 + 0,
      [{ point: { blockIndex: b, stmtIndex: 0, line: b + 1 }, bindingIdx: b, kind: 'must' }],
    ]),
  );

  return {
    functionName: 'diamondFn',
    filePath: 't.ts',
    startLine: 1,
    startColumn: 1,
    blocks,
    edges: [
      { from: 0, to: 1, kind: 'seq' },
      { from: 0, to: 3, kind: 'seq' },
      { from: 1, to: 4, kind: 'seq' },
      { from: 3, to: 2, kind: 'seq' },
      { from: 4, to: 2, kind: 'seq' },
    ],
    bindings: [0, 1, 2, 3, 4].map((i) => ({
      index: i,
      name: `v${i}`,
      kind: 'local' as const,
      declLine: i + 1,
      declColumn: 1,
      synthetic: false,
    })),
    stmtFacts,
    entryIndex: 0,
    exitIndex: 2,
  };
}

function fact(def: number, use: number): DefUseFact {
  return {
    bindingIdx: def,
    bindingName: `v${def}`,
    def: { blockIndex: def, stmtIndex: 0, line: def + 1 },
    use: { blockIndex: use, stmtIndex: 0, line: use + 1 },
  };
}

// ---------------------------------------------------------------------------
// computeConfidence — sanitizer-exclusion modifier (×0.5)
// ---------------------------------------------------------------------------

describe('TaintPropagator — sanitizer-exclusion confidence modifier', () => {
  it('halves confidence when the flow passed a sanitizer of a different kind', () => {
    const blocks = [
      { index: 0, startLine: 1, endLine: 1, statementCount: 1, isEntry: true, isExit: false },
      { index: 1, startLine: 2, endLine: 2, statementCount: 1, isEntry: false, isExit: false },
      { index: 2, startLine: 3, endLine: 3, statementCount: 1, isEntry: false, isExit: true },
    ];

    // Sanitizer neutralizes 'xss'; the downstream sink is 'sql-injection', so
    // the flow still fires but carries a non-empty exclusion set.
    const stmtFacts = makeStmtFactsWithTaint(
      [
        [
          0 * 1024 + 0,
          {
            point: { blockIndex: 0, stmtIndex: 0, line: 1 },
            bindingIdx: 0,
            category: 'remote-input',
            description: 'User input',
            line: 1,
          },
        ],
      ],
      [
        [
          2 * 1024 + 0,
          {
            point: { blockIndex: 2, stmtIndex: 0, line: 3 },
            kind: 'sql-injection',
            description: 'SQL execution',
            line: 3,
          },
        ],
      ],
      [
        [
          1 * 1024 + 0,
          {
            point: { blockIndex: 1, stmtIndex: 0, line: 2 },
            neutralizedKinds: new Set(['xss']),
            description: 'HTML escape',
          },
        ],
      ],
      [
        [
          0 * 1024 + 0,
          [{ point: { blockIndex: 0, stmtIndex: 0, line: 1 }, bindingIdx: 0, kind: 'must' }],
        ],
        [
          1 * 1024 + 0,
          [{ point: { blockIndex: 1, stmtIndex: 0, line: 2 }, bindingIdx: 1, kind: 'must' }],
        ],
        [
          2 * 1024 + 0,
          [{ point: { blockIndex: 2, stmtIndex: 0, line: 3 }, bindingIdx: 2, kind: 'must' }],
        ],
      ],
    );

    const cfg: FunctionCfg = {
      functionName: 'crossKindSanitizerFn',
      filePath: 't.ts',
      startLine: 1,
      startColumn: 1,
      blocks,
      edges: [
        { from: 0, to: 1, kind: 'seq' },
        { from: 1, to: 2, kind: 'seq' },
      ],
      bindings: [
        { index: 0, name: 'input', kind: 'param', declLine: 1, declColumn: 10, synthetic: false },
        { index: 1, name: 'escaped', kind: 'local', declLine: 2, declColumn: 7, synthetic: false },
        { index: 2, name: 'query', kind: 'local', declLine: 3, declColumn: 7, synthetic: false },
      ],
      stmtFacts,
      entryIndex: 0,
      exitIndex: 2,
    };

    const facts: DefUseFact[] = [
      {
        bindingIdx: 0,
        bindingName: 'input',
        def: { blockIndex: 0, stmtIndex: 0, line: 1 },
        use: { blockIndex: 1, stmtIndex: 0, line: 2 },
      },
      {
        bindingIdx: 1,
        bindingName: 'escaped',
        def: { blockIndex: 1, stmtIndex: 0, line: 2 },
        use: { blockIndex: 2, stmtIndex: 0, line: 3 },
      },
    ];

    const result = new TaintPropagator().analyze(cfg, facts);

    expect(result.sanitizerKills).toBe(1);
    expect(result.findings.length).toBeGreaterThan(0);
    const f = result.findings[0]!;
    expect(f.sink.kind).toBe('sql-injection');
    // 0.8 × 0.5 (exclusion present) = 0.4, reflecting the sanitized detour.
    expect(f.confidence).toBeCloseTo(0.4, 5);
    expect(f.confidence).toBeLessThan(0.8);
  });
});

// ---------------------------------------------------------------------------
// computeConfidence — path-length modifiers (×0.8 above 5, ×0.6 above 10)
// ---------------------------------------------------------------------------

describe('TaintPropagator — path-length confidence modifiers', () => {
  it('scales confidence by ×0.8 for paths longer than 5 blocks', () => {
    // 7 blocks → source-to-sink path length 6 (first block does not count).
    const cfg = buildLinearCfg(7);
    const result = new TaintPropagator().analyze(cfg, linearFacts(7));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.confidence).toBeCloseTo(0.64, 5); // 0.8 × 0.8
  });

  it('scales confidence by a further ×0.6 for paths longer than 10 blocks', () => {
    // 12 blocks → source-to-sink path length 11.
    const cfg = buildLinearCfg(12);
    const result = new TaintPropagator().analyze(cfg, linearFacts(12));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.confidence).toBeCloseTo(0.384, 5); // 0.8 × 0.8 × 0.6
  });
});

// ---------------------------------------------------------------------------
// Monotone worklist re-enqueue / skip (L242)
// ---------------------------------------------------------------------------

describe('TaintPropagator monotone re-derivation', () => {
  it('skips a re-derived state that is not more dangerous (L242 if false)', () => {
    // Clean path is short (B0 -> B3 -> B2); sanitized path is long
    // (B0 -> B1 -> B4 -> B2). The clean def at B2 is processed first, so the
    // later sanitized def (more exclusions) must be skipped.
    const cfg = buildDiamondCfg();
    const result = new TaintPropagator().analyze(cfg, [
      fact(0, 3),
      fact(0, 1),
      fact(3, 2),
      fact(1, 4),
      fact(4, 2),
    ]);

    // Both paths reach the sql-injection sink (xss is not the excluded kind).
    expect(result.findings).toHaveLength(2);
    expect(result.sanitizerKills).toBe(1);
  });

  it('re-enqueues a re-derived state with fewer exclusions (L242 || false)', () => {
    // Sanitized path is short (B0 -> B1 -> B2); clean path is long
    // (B0 -> B3 -> B4 -> B2). The sanitized def at B2 is processed first, so
    // the later clean def (fewer exclusions) is re-enqueued.
    const cfg = buildDiamondCfg();
    const result = new TaintPropagator().analyze(cfg, [
      fact(0, 1),
      fact(0, 3),
      fact(1, 2),
      fact(3, 4),
      fact(4, 2),
    ]);

    expect(result.findings).toHaveLength(2);
    expect(result.sanitizerKills).toBe(1);
  });
});
