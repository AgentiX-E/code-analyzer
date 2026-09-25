// The end-to-end claim, and where exactly it stops.
//
// Everything is wired: the parse phase extracts sources and sinks from a provider, captures give defs, and
// `buildOccurrences` joins them by line. Running it on a real file established three things and then stopped at a
// fourth:
//
//   the extraction finds `http_request` and `sql_exec` from the source text   — passes
//   `groupCaptures` emits `variable.def`, so `id` becomes a binding           — passes
//   `buildOccurrences` joins the source to that binding, and the sink too     — passes
//   the use of `id` inside `db.query(id)` is a fact                             — passes, since the access capture
//
// and then, by bisection, a fifth thing:
//
//   `TaintPropagator` alone finds the finding                                  — passes: `findings=1`
//   **`TaintPipeline` returns it**                                              — **passes**, since the merge
//
// Everything the propagator needs is present — one binding, one def, one use, one source, one sink, one fact — and it
// produces a finding from them. **The pipeline discards it**, because `TaintPipeline.analyze` returns
// `this.solver.solve()`, and the solver reports only what crosses a function boundary. The propagator's findings are
// used to build each function's summary and then dropped from the result.
//
// That is the whole of the remaining distance, and the bisection is what made it visible: without the direct call
// this would still be "the pipeline produces nothing", which is a hundred lines to search instead of one function.

import { JavaScriptProvider } from '@code-analyzer/analyzer';
import { describe, it, expect } from 'vitest';

import { buildFunctionCfgs } from '../cfg/from-parsed-files.js';
import { computeReachingDefinitions } from '../cfg/reaching-defs.js';
import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';
import { TaintPropagator } from '../security/taint-propagator.js';

import type { ParsedFile } from '@code-analyzer/shared';

const SOURCE = [
  'function handler() {',
  '  const id = req.body.id;',
  '  db.query(id);',
  '}',
  '',
].join('\n');

function parsedFor(provider: JavaScriptProvider): ParsedFile {
  const captures = provider.parse(SOURCE, 'src/a.js');
  return {
    filePath: 'src/a.js',
    language: 'javascript',
    symbols: [
      {
        name: 'handler',
        kind: 'Function',
        qualifiedName: 'file:src/a.js:handler',
        startLine: 1,
        endLine: 4,
        isExported: true,
        properties: {},
      },
    ],
    references: [],
    scopeTree: {},
    ast: captures,
  } as unknown as ParsedFile;
}

describe('a source in a real file', () => {
  const provider = new JavaScriptProvider();

  it('is found by the extraction, and so is the sink', () => {
    expect(provider.extractTaintSources(SOURCE).map((s) => s.sourceType)).toContain('http_request');
    expect(provider.extractTaintSinks(SOURCE).map((s) => s.sinkType)).toContain('sql_exec');
  });

  it('produces a binding and a def for the variable that receives it', () => {
    // The first thing that has to hold, and the most likely to be missing: binding facts come from captures, and
    // whether the JavaScript query emits `variable.def` for `const id = …` is what this establishes.
    const cfgs = buildFunctionCfgs([parsedFor(provider)], new Map());
    const cfg = cfgs.get('file:src/a.js:handler');

    expect(cfg?.bindings.map((b) => b.name)).toContain('id');
    expect(cfg?.stmtFacts.defs.size).toBeGreaterThan(0);
  });

  // This was `it.fails` until the access capture landed. **It turned red the commit after, which is how it was
  // meant to be read** — the gap closed, so the assertion is now stated forwards.
  it('gives the function a use fact for the tainted binding', () => {
    const extraction = new Map([
      [
        'src/a.js',
        {
          sources: provider.extractTaintSources(SOURCE),
          sinks: provider.extractTaintSinks(SOURCE),
        },
      ],
    ]);
    const cfg = buildFunctionCfgs([parsedFor(provider)], new Map(), extraction).get(
      'file:src/a.js:handler',
    );

    expect(cfg?.stmtFacts.sourceSites.size).toBeGreaterThan(0);
    expect(cfg?.stmtFacts.sinkSites.size).toBeGreaterThan(0);

    // A flow needs def -> use, so the use of `id` inside `db.query(id)` has to be a fact. Whether the JavaScript
    // query emits `variable.access` for it is the next thing to establish.
    expect(cfg?.stmtFacts.uses.size).toBeGreaterThan(0);
  });
  // This was `it.fails` for three commits. It turned green the commit after the one that named the cause:
  // `TaintPipeline.analyze` returned `this.solver.solve()` under a comment reading "Merge and return".
  it('produces a finding through the pipeline, which discards what the propagator finds', () => {
    const extraction = new Map([
      [
        'src/a.js',
        {
          sources: provider.extractTaintSources(SOURCE),
          sinks: provider.extractTaintSinks(SOURCE),
        },
      ],
    ]);

    const result = analyzeInterproceduralTaint([parsedFor(provider)], new Map(), extraction);

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]?.sink.kind).toBe('sql_exec');
  });

  it('the propagator alone finds the flow, which says where the remaining gap is', () => {
    // Bisection: the pipeline wraps this call, so if the propagator produces a finding here and the pipeline does
    // not, the gap is in the wrapping — and if it produces nothing here, the gap is inside the propagator.
    const extraction = new Map([
      [
        'src/a.js',
        {
          sources: provider.extractTaintSources(SOURCE),
          sinks: provider.extractTaintSinks(SOURCE),
        },
      ],
    ]);
    const cfg = buildFunctionCfgs([parsedFor(provider)], new Map(), extraction).get(
      'file:src/a.js:handler',
    )!;
    const facts = computeReachingDefinitions(cfg);

    const result = new TaintPropagator().analyze(cfg, facts);

    console.log(
      `  diagnostic: bindings=${cfg.bindings.length} defs=${cfg.stmtFacts.defs.size} uses=${cfg.stmtFacts.uses.size} ` +
        `sources=${cfg.stmtFacts.sourceSites.size} sinks=${cfg.stmtFacts.sinkSites.size} facts=${facts.length} ` +
        `findings=${result.findings.length}`,
    );
    expect(result.findings.length).toBeGreaterThan(0);
  });

  /**
   * A sanitizer on the path, which is the one thing this chain has never shown.
   *
   * `FunctionCfg.sanitizerSites` is now filled, `buildSanitizerIndex` reads it, and the propagator passes that index
   * into its statement-local check. **Whether any of that makes `sanitized` true is a separate question**, and this is
   * the measurement: a source, a sanitizer that neutralises it, and a sink that receives the sanitised binding.
   */
  const SANITIZED = [
    'function handler() {',
    '  const id = req.body.id;',
    '  const safe = escape(id);',
    '  db.query(safe);',
    '}',
    '',
  ].join('\n');

  function parsedSanitizedFor(provider: JavaScriptProvider): ParsedFile {
    const captures = provider.parse(SANITIZED, 'src/a.js');
    return {
      filePath: 'src/a.js',
      language: 'javascript',
      symbols: [
        {
          name: 'handler',
          kind: 'Function',
          qualifiedName: 'file:src/a.js:handler',
          startLine: 1,
          endLine: 5,
          isExported: true,
          properties: {},
        },
      ],
      references: [],
      scopeTree: {},
      ast: captures,
    } as unknown as ParsedFile;
  }

  describe('a sanitizer between the source and the sink', () => {
    const provider = new JavaScriptProvider();

    it('reaches the CFG as a sanitizer site, which is the producer working', () => {
      const extraction = new Map([
        [
          'src/a.js',
          {
            sources: provider.extractTaintSources(SANITIZED),
            sinks: provider.extractTaintSinks(SANITIZED),
            sanitizers: provider.extractSanitizers(SANITIZED),
          },
        ],
      ]);

      const cfgs = buildFunctionCfgs([parsedSanitizedFor(provider)], new Map(), extraction);
      const cfg = cfgs.get('file:src/a.js:handler');

      expect(provider.extractSanitizers(SANITIZED).length).toBeGreaterThan(0);
      expect(cfg?.stmtFacts.sanitizerSites.size).toBeGreaterThan(0);
    });

    it('marks the finding sanitized, if the propagator follows it that far', () => {
      const extraction = new Map([
        [
          'src/a.js',
          {
            sources: provider.extractTaintSources(SANITIZED),
            sinks: provider.extractTaintSinks(SANITIZED),
            sanitizers: provider.extractSanitizers(SANITIZED),
          },
        ],
      ]);

      const result = analyzeInterproceduralTaint(
        [parsedSanitizedFor(provider)],
        new Map(),
        extraction,
      );

      console.log(
        `SANITIZED-FLOW: findings ${result.findings.length}, sanitized ${JSON.stringify(result.findings.map((f) => f.sanitized))}`,
      );
      expect(result.findings.length).toBeGreaterThan(0);
      // The criterion this was written against: `[false]` before the path check, `[true]` after. Asserted now that
      // it holds, and the print stays so a regression shows as a number rather than a red line.
      expect(result.findings[0]?.sanitized).toBe(true);
    });
  });
});
