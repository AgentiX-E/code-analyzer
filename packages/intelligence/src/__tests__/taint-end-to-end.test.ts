// The end-to-end claim, and where exactly it stops.
//
// Everything is wired: the parse phase extracts sources and sinks from a provider, captures give defs, and
// `buildOccurrences` joins them by line. Running it on a real file established three things and then stopped at a
// fourth:
//
//   the extraction finds `http_request` and `sql_exec` from the source text   — passes
//   `groupCaptures` emits `variable.def`, so `id` becomes a binding           — passes
//   `buildOccurrences` joins the source to that binding, and the sink too     — passes
//   **the use of `id` inside `db.query(id)` is a fact**                       — **does not**: `uses` is empty
//
// **The JavaScript query emits `variable.def` but not `variable.access`.** The tag is in the vocabulary and
// `groupCaptures` already handles it, so what is missing is the capture, not the machinery. Until it exists there is
// no def-to-use edge, so the propagator has a source with nowhere to go — which is why the two tests below are
// `it.fails`.

import { JavaScriptProvider } from '@code-analyzer/analyzer';
import { describe, it, expect } from 'vitest';

import { buildFunctionCfgs } from '../cfg/from-parsed-files.js';
import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

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

  // `it.fails` is the assertion written backwards: it passes while the gap is open and **fails the moment the
  // gap closes**, which is when this should become `it` and be read again.
  it.fails('gives the function a use fact for the tainted binding', () => {
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

  it.fails('produces a finding, which needs the use fact above', () => {
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
});
