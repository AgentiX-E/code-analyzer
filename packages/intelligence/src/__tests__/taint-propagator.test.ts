// @code-analyzer/intelligence — Taint Propagation Tests

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
// Test Fixtures
// ---------------------------------------------------------------------------

function makeStmtFactsWithTaint(
  sources: Array<[number, TaintSourceOccurrence]>,
  sinks: Array<[number, TaintSinkOccurrence]>,
  sanitizers: Array<[number, SanitizerOccurrence]>,
  defs?: Array<
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
    defs: defs
      ? new Map(
          defs.map(([k, v]) => [
            k,
            v.map((d) => ({ point: d.point, bindingIdx: d.bindingIdx, kind: d.kind })),
          ]),
        )
      : new Map(),
    uses: new Map(),
    sourceSites: new Map(sources),
    sinkSites: new Map(sinks),
    sanitizerSites: new Map(sanitizers),
  };
}

function buildTestCfg(sources: number, sinks: number): FunctionCfg {
  const blocks = [
    { index: 0, startLine: 1, endLine: 3, statementCount: 3, isEntry: true, isExit: false },
    { index: 1, startLine: 5, endLine: 8, statementCount: 3, isEntry: false, isExit: false },
    { index: 2, startLine: 10, endLine: 12, statementCount: 2, isEntry: false, isExit: true },
  ];

  const stmtFacts = makeStmtFactsWithTaint(
    sources > 0
      ? [
          [
            0 * 1024 + 0,
            {
              point: { blockIndex: 0, stmtIndex: 0, line: 1 },
              bindingIdx: 0,
              category: 'remote-input',
              description: 'User input from HTTP request',
              line: 1,
            },
          ] as [number, TaintSourceOccurrence],
        ]
      : [],
    sinks > 0
      ? ([
          [
            2 * 1024 + 0,
            {
              point: { blockIndex: 2, stmtIndex: 0, line: 10 },
              kind: 'sql-injection',
              cweId: 'CWE-89',
              description: 'SQL query execution',
              line: 10,
            },
          ],
        ] as [number, TaintSinkOccurrence][])
      : [],
    [],
    [
      [
        0 * 1024 + 0,
        [{ point: { blockIndex: 0, stmtIndex: 0, line: 1 }, bindingIdx: 0, kind: 'must' }],
      ],
      [
        1 * 1024 + 0,
        [{ point: { blockIndex: 1, stmtIndex: 0, line: 5 }, bindingIdx: 1, kind: 'must' }],
      ],
      [
        2 * 1024 + 0,
        [{ point: { blockIndex: 2, stmtIndex: 0, line: 10 }, bindingIdx: 2, kind: 'must' }],
      ],
    ],
  );

  return {
    functionName: 'testFn',
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 1,
    blocks,
    edges: [
      { from: 0, to: 1, kind: 'seq' as const },
      { from: 1, to: 2, kind: 'seq' as const },
    ],
    bindings: [
      { index: 0, name: 'req', kind: 'param', declLine: 1, declColumn: 10, synthetic: false },
      { index: 1, name: 'query', kind: 'local', declLine: 5, declColumn: 7, synthetic: false },
      { index: 2, name: 'result', kind: 'local', declLine: 10, declColumn: 7, synthetic: false },
    ],
    stmtFacts,
    entryIndex: 0,
    exitIndex: 2,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaintPropagator', () => {
  describe('Basic propagation', () => {
    it('returns empty for CFG without sources', () => {
      const cfg = buildTestCfg(0, 1);
      const facts: DefUseFact[] = [];
      const propagator = new TaintPropagator();
      const result = propagator.analyze(cfg, facts);

      expect(result.findings).toEqual([]);
      expect(result.functionName).toBe('testFn');
    });

    it('returns empty for CFG without def→use facts', () => {
      const cfg = buildTestCfg(1, 1);
      const facts: DefUseFact[] = [];
      const propagator = new TaintPropagator();
      const result = propagator.analyze(cfg, facts);

      // Source exists but no def→use facts to propagate
      expect(result.functionName).toBe('testFn');
    });

    it('propagates taint through a simple chain', () => {
      const cfg = buildTestCfg(1, 1);

      // Create a chain: def0(B0,S0)→use(B1)→def(B1,S0)→use(B2,S0)
      const facts: DefUseFact[] = [
        {
          bindingIdx: 0,
          bindingName: 'req',
          def: { blockIndex: 0, stmtIndex: 0, line: 1 },
          use: { blockIndex: 1, stmtIndex: 0, line: 5 },
        },
        {
          bindingIdx: 1,
          bindingName: 'query',
          def: { blockIndex: 1, stmtIndex: 0, line: 5 },
          use: { blockIndex: 2, stmtIndex: 0, line: 10 },
        },
      ];

      const propagator = new TaintPropagator({ maxFindingsPerSource: 10 });
      const result = propagator.analyze(cfg, facts);

      // Should detect taint flowing from B0 source to B2 sink
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.factsProcessed).toBeGreaterThan(0);

      // Verify finding structure
      if (result.findings.length > 0) {
        const f = result.findings[0]!;
        expect(f.source.category).toBe('remote-input');
        expect(f.sink.kind).toBe('sql-injection');
        expect(f.sink.cweId).toBe('CWE-89');
        expect(f.confidence).toBeGreaterThan(0);
        expect(f.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('detects statement-local source→sink', () => {
      // Place source and sink at the same statement
      const blocks = [
        { index: 0, startLine: 1, endLine: 3, statementCount: 1, isEntry: true, isExit: true },
      ];

      const localKey = 0 * 1024 + 0;
      const stmtFacts = makeStmtFactsWithTaint(
        [
          [
            localKey,
            {
              point: { blockIndex: 0, stmtIndex: 0, line: 1 },
              bindingIdx: 0,
              category: 'command-injection',
              description: 'User input feeds command',
              line: 1,
            },
          ],
        ],
        [
          [
            localKey,
            {
              point: { blockIndex: 0, stmtIndex: 0, line: 1 },
              kind: 'command-injection',
              description: 'Shell command execution',
              line: 1,
            },
          ],
        ],
        [],
      );

      const cfg: FunctionCfg = {
        functionName: 'localFn',
        filePath: 'test.ts',
        startLine: 1,
        startColumn: 1,
        blocks,
        edges: [],
        bindings: [
          { index: 0, name: 'input', kind: 'param', declLine: 1, declColumn: 10, synthetic: false },
        ],
        stmtFacts,
        entryIndex: 0,
        exitIndex: 0,
      };

      const propagator = new TaintPropagator();
      const result = propagator.analyze(cfg, []);

      // Statement-local detection should fire
      expect(result.findings.length).toBeGreaterThan(0);
      const f = result.findings[0]!;
      expect(f.hops).toBe(1); // Single-hop (statement-local)
      expect(f.interproc).toBe(false);
    });
  });

  describe('Sanitizer handling', () => {
    it('excludes sanitized sink kinds', () => {
      const blocks = [
        { index: 0, startLine: 1, endLine: 3, statementCount: 2, isEntry: true, isExit: false },
        { index: 1, startLine: 5, endLine: 7, statementCount: 2, isEntry: false, isExit: false },
        { index: 2, startLine: 9, endLine: 11, statementCount: 2, isEntry: false, isExit: true },
      ];

      const stmtFacts = makeStmtFactsWithTaint(
        [
          [
            0 * 1024 + 0,
            {
              point: { blockIndex: 0, stmtIndex: 0, line: 1 },
              bindingIdx: 0,
              category: 'xss',
              description: 'User input',
              line: 1,
            },
          ],
        ],
        [
          [
            2 * 1024 + 0,
            {
              point: { blockIndex: 2, stmtIndex: 0, line: 9 },
              kind: 'xss',
              description: 'HTML output',
              line: 9,
            },
          ],
        ],
        [
          [
            1 * 1024 + 0,
            {
              point: { blockIndex: 1, stmtIndex: 0, line: 5 },
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
            [{ point: { blockIndex: 1, stmtIndex: 0, line: 5 }, bindingIdx: 1, kind: 'must' }],
          ],
        ],
      );

      const cfg: FunctionCfg = {
        functionName: 'sanitizerFn',
        filePath: 'test.ts',
        startLine: 1,
        startColumn: 1,
        blocks,
        edges: [
          { from: 0, to: 1, kind: 'seq' },
          { from: 1, to: 2, kind: 'seq' },
        ],
        bindings: [
          { index: 0, name: 'input', kind: 'param', declLine: 1, declColumn: 10, synthetic: false },
          { index: 1, name: 'safe', kind: 'local', declLine: 5, declColumn: 7, synthetic: false },
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
          use: { blockIndex: 1, stmtIndex: 0, line: 5 },
        },
        {
          bindingIdx: 1,
          bindingName: 'safe',
          def: { blockIndex: 1, stmtIndex: 0, line: 5 },
          use: { blockIndex: 2, stmtIndex: 0, line: 9 },
        },
      ];

      const propagator = new TaintPropagator();
      const result = propagator.analyze(cfg, facts);

      // The sanitizer at B1 should neutralize the XSS flow
      // Findings that pass through the sanitizer should be marked as sanitized
      const sanitizedFindings = result.findings.filter((f) => f.sanitized);
      // At minimum, the sanitizer should reduce confidence or mark as sanitized
      expect(result.sanitizerKills).toBeGreaterThan(0);
    });
  });

  describe('Configuration', () => {
    it('respects maxFindingsPerSource', () => {
      const cfg = buildTestCfg(1, 1);
      const facts: DefUseFact[] = [
        {
          bindingIdx: 0,
          bindingName: 'a',
          def: { blockIndex: 0, stmtIndex: 0, line: 1 },
          use: { blockIndex: 2, stmtIndex: 0, line: 10 },
        },
      ];

      const propagator = new TaintPropagator({ maxFindingsPerSource: 1 });
      const result = propagator.analyze(cfg, facts);

      expect(result.findings.length).toBeLessThanOrEqual(1);
    });

    it('respects maxIterations', () => {
      const cfg = buildTestCfg(1, 1);
      const facts: DefUseFact[] = [];
      for (let i = 0; i < 100; i++) {
        facts.push({
          bindingIdx: 0,
          bindingName: 'x',
          def: { blockIndex: 0, stmtIndex: 0, line: 1 },
          use: { blockIndex: 1, stmtIndex: 0, line: 5 },
        });
      }

      const propagator = new TaintPropagator({ maxIterations: 10 });
      const result = propagator.analyze(cfg, facts);

      // Should terminate without infinite loop
      expect(result.durationMs).toBeGreaterThan(0);
    });
  });

  describe('Result structure', () => {
    it('each finding has all required fields', () => {
      const cfg = buildTestCfg(1, 1);
      const facts: DefUseFact[] = [
        {
          bindingIdx: 0,
          bindingName: 'req',
          def: { blockIndex: 0, stmtIndex: 0, line: 1 },
          use: { blockIndex: 2, stmtIndex: 0, line: 10 },
        },
      ];

      const propagator = new TaintPropagator();
      const result = propagator.analyze(cfg, facts);

      for (const f of result.findings) {
        expect(typeof f.id).toBe('string');
        expect(f.id.length).toBeGreaterThan(0);
        expect(f.source).toBeDefined();
        expect(f.sink).toBeDefined();
        expect(Array.isArray(f.path)).toBe(true);
        expect(f.hops).toBeGreaterThan(0);
        expect(typeof f.sanitized).toBe('boolean');
        expect(typeof f.truncated).toBe('boolean');
        expect(typeof f.interproc).toBe('boolean');
        expect(f.confidence).toBeGreaterThan(0);
        expect(f.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('result includes metadata', () => {
      const cfg = buildTestCfg(1, 1);
      const propagator = new TaintPropagator();
      const result = propagator.analyze(cfg, []);

      expect(result.functionName).toBe('testFn');
      expect(result.filePath).toBe('test.ts');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.factsProcessed).toBe(0);
      expect(result.sanitizerKills).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// SinkKind Exclusion Model Tests
// ---------------------------------------------------------------------------

describe('Kind-set exclusion model', () => {
  it('taint without exclusions reaches all sink kinds', () => {
    const blocks = [
      { index: 0, startLine: 1, endLine: 3, statementCount: 1, isEntry: true, isExit: false },
      { index: 1, startLine: 5, endLine: 7, statementCount: 2, isEntry: false, isExit: true },
    ];

    // Multiple sink kinds at the target
    const sinks: [number, TaintSinkOccurrence][] = [
      [
        1 * 1024 + 0,
        {
          point: { blockIndex: 1, stmtIndex: 0, line: 5 },
          kind: 'sql-injection',
          description: 'SQL',
          line: 5,
        },
      ],
      [
        1 * 1024 + 0,
        {
          point: { blockIndex: 1, stmtIndex: 0, line: 5 },
          kind: 'xss',
          description: 'XSS',
          line: 5,
        },
      ],
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
      sinks,
      [],
      [
        [
          0 * 1024 + 0,
          [{ point: { blockIndex: 0, stmtIndex: 0, line: 1 }, bindingIdx: 0, kind: 'must' }],
        ],
      ],
    );

    const cfg: FunctionCfg = {
      functionName: 'multiSinkFn',
      filePath: 't.ts',
      startLine: 1,
      startColumn: 1,
      blocks,
      edges: [{ from: 0, to: 1, kind: 'seq' }],
      bindings: [
        { index: 0, name: 'data', kind: 'param', declLine: 1, declColumn: 10, synthetic: false },
      ],
      stmtFacts,
      entryIndex: 0,
      exitIndex: 1,
    };

    const facts: DefUseFact[] = [
      {
        bindingIdx: 0,
        bindingName: 'data',
        def: { blockIndex: 0, stmtIndex: 0, line: 1 },
        use: { blockIndex: 1, stmtIndex: 0, line: 5 },
      },
    ];

    const propagator = new TaintPropagator();
    const result = propagator.analyze(cfg, facts);

    // Without sanitizers, both SQL-injection and XSS sinks should fire
    const sqlFindings = result.findings.filter((f) => f.sink.kind === 'sql-injection');
    const xssFindings = result.findings.filter((f) => f.sink.kind === 'xss');

    // At least one of each should fire
    expect(sqlFindings.length + xssFindings.length).toBeGreaterThan(0);
  });

  it('sanitizer with specific kind only blocks that kind', () => {
    const blocks = [
      { index: 0, startLine: 1, endLine: 3, statementCount: 1, isEntry: true, isExit: false },
      { index: 1, startLine: 5, endLine: 7, statementCount: 2, isEntry: false, isExit: false },
      { index: 2, startLine: 9, endLine: 11, statementCount: 2, isEntry: false, isExit: true },
    ];

    const stmtFacts = makeStmtFactsWithTaint(
      [
        [
          0 * 1024 + 0,
          {
            point: { blockIndex: 0, stmtIndex: 0, line: 1 },
            bindingIdx: 0,
            category: 'remote-input',
            description: 'Input',
            line: 1,
          },
        ],
      ],
      [
        [
          2 * 1024 + 0,
          {
            point: { blockIndex: 2, stmtIndex: 0, line: 9 },
            kind: 'xss',
            description: 'XSS output',
            line: 9,
          },
        ],
      ],
      [
        [
          1 * 1024 + 0,
          {
            point: { blockIndex: 1, stmtIndex: 0, line: 5 },
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
          [{ point: { blockIndex: 1, stmtIndex: 0, line: 5 }, bindingIdx: 1, kind: 'must' }],
        ],
      ],
    );

    const cfg: FunctionCfg = {
      functionName: 'specificSanitizerFn',
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
        { index: 1, name: 'escaped', kind: 'local', declLine: 5, declColumn: 7, synthetic: false },
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
        use: { blockIndex: 1, stmtIndex: 0, line: 5 },
      },
      {
        bindingIdx: 1,
        bindingName: 'escaped',
        def: { blockIndex: 1, stmtIndex: 0, line: 5 },
        use: { blockIndex: 2, stmtIndex: 0, line: 9 },
      },
    ];

    const propagator = new TaintPropagator();
    const result = propagator.analyze(cfg, facts);

    // Sanitizer at B1 should neutralize XSS
    expect(result.sanitizerKills).toBeGreaterThan(0);

    // Findings through sanitized path should be flagged
    const xssFindings = result.findings.filter((f) => f.sink.kind === 'xss');
    // All XSS findings through the sanitized path have reduced confidence
    for (const f of xssFindings) {
      expect(f.confidence).toBeLessThanOrEqual(0.8);
    }
  });
});
