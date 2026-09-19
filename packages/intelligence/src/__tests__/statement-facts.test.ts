// `stmtFacts` from captures: one definition, one use, and the reasons for every choice made.
//
// The half that is here is a derivation over captures the pipeline already produces. Source and sink sites come from
// the provider extraction instead, joined to bindings by line — that is `buildOccurrences` below.

import { describe, it, expect } from 'vitest';

import { buildOccurrences, buildStatementFacts } from '../cfg/statement-facts.js';

import type { UnifiedCapture } from '@code-analyzer/shared';

function capture(tag: string, name: string | undefined, startLine: number): UnifiedCapture {
  return {
    tag,
    name,
    text: name ?? '',
    startLine,
    endLine: startLine,
    startByte: 0,
    endByte: 0,
  } as UnifiedCapture;
}

describe('buildStatementFacts', () => {
  it('makes a binding from a definition capture and a def site for it', () => {
    const { bindings, stmtFacts } = buildStatementFacts(
      [capture('variable.def', 'req', 12)],
      10,
      20,
    );

    expect(bindings).toEqual([
      { index: 0, name: 'req', kind: 'local', declLine: 12, declColumn: 0, synthetic: false },
    ]);
    // The key is line-relative to the function's start: 12 - 10 = 2.
    expect(stmtFacts.defs.get(2)).toEqual([
      { point: { blockIndex: 0, stmtIndex: 2, line: 12 }, bindingIdx: 0, kind: 'must' },
    ]);
  });

  it('pairs a use with the binding a definition introduced', () => {
    const { stmtFacts } = buildStatementFacts(
      [capture('variable.def', 'req', 12), capture('variable.access', 'req', 15)],
      10,
      20,
    );

    expect(stmtFacts.uses.get(5)).toEqual([
      { point: { blockIndex: 0, stmtIndex: 5, line: 15 }, bindingIdx: 0 },
    ]);
  });

  it('ignores a use of a name no definition introduced', () => {
    // Without a binding there is no index to record, and inventing one would point taint at the wrong variable.
    const { stmtFacts } = buildStatementFacts(
      [capture('variable.access', 'globalThing', 15)],
      10,
      20,
    );

    expect(stmtFacts.uses.size).toBe(0);
  });

  it('ignores captures outside the function', () => {
    const { bindings, stmtFacts } = buildStatementFacts(
      [capture('variable.def', 'elsewhere', 5), capture('variable.def', 'inside', 12)],
      10,
      20,
    );

    expect(bindings.map((b) => b.name)).toEqual(['inside']);
    expect(stmtFacts.defs.size).toBe(1);
  });

  it('gives one binding per name, so a redefinition does not create a second', () => {
    const { bindings } = buildStatementFacts(
      [capture('variable.def', 'x', 12), capture('variable.def', 'x', 14)],
      10,
      20,
    );

    expect(bindings).toHaveLength(1);
  });

  it('skips a capture past STRIDE lines into its function rather than letting keys collide', () => {
    const { bindings, stmtFacts } = buildStatementFacts(
      [capture('variable.def', 'far', 10 + 1024)],
      10,
      1100,
    );

    // The binding is still created: the variable exists whether or not its statement can be keyed. Only the def site
    // is dropped, and a binding with no def site produces no source.
    expect(bindings.map((b) => b.name)).toEqual(['far']);
    expect(stmtFacts.defs.size).toBe(0);
  });

  it('leaves the source and sink maps empty here, because they come from the extraction', () => {
    const { stmtFacts } = buildStatementFacts([capture('variable.def', 'req', 12)], 10, 20);

    expect(stmtFacts.sourceSites.size).toBe(0);
    expect(stmtFacts.sinkSites.size).toBe(0);
    expect(stmtFacts.sanitizerSites.size).toBe(0);
  });

  it('ignores a definition capture with no name', () => {
    const { bindings } = buildStatementFacts([capture('variable.def', undefined, 12)], 10, 20);

    expect(bindings).toHaveLength(0);
  });
});

describe('buildOccurrences', () => {
  const bindings = [
    {
      index: 0,
      name: 'key',
      kind: 'local' as const,
      declLine: 12,
      declColumn: 0,
      synthetic: false,
    },
  ];

  it('joins a source to the binding its line declares', () => {
    // The extraction names the expression — `process.env.API_KEY` — and the binding is `key`. The line is what they
    // share, which is what `const key = process.env.API_KEY` puts them on.
    const { sourceSites } = buildOccurrences(
      [{ sourceType: 'env_var', line: 12, text: 'process.env.API_KEY' }],
      [],
      bindings,
      10,
    );

    expect(sourceSites.get(2)).toEqual({
      bindingIdx: 0,
      point: { blockIndex: 0, stmtIndex: 2, line: 12 },
      category: 'env_var',
      description: 'process.env.API_KEY',
      line: 12,
    });
  });

  it('skips a source whose line declares no binding rather than inventing an index', () => {
    // A taint fact pointing at a binding that does not exist would send the analysis somewhere arbitrary.
    const { sourceSites } = buildOccurrences(
      [{ sourceType: 'env_var', line: 14, text: 'process.env.X' }],
      [],
      bindings,
      10,
    );

    expect(sourceSites.size).toBe(0);
  });

  it('keeps a sink, which needs no binding', () => {
    const { sinkSites } = buildOccurrences(
      [],
      [{ sinkType: 'eval', line: 15, text: 'eval(input)' }],
      [],
      10,
    );

    expect(sinkSites.get(5)).toEqual({
      point: { blockIndex: 0, stmtIndex: 5, line: 15 },
      kind: 'eval',
      description: 'eval(input)',
      line: 15,
    });
  });

  it('skips a line outside the function, on both sides', () => {
    const { sourceSites, sinkSites } = buildOccurrences(
      [{ sourceType: 'env_var', line: 5, text: 'x' }],
      [{ sinkType: 'eval', line: 5, text: 'y' }],
      [
        {
          index: 0,
          name: 'k',
          kind: 'local' as const,
          declLine: 5,
          declColumn: 0,
          synthetic: false,
        },
      ],
      10,
    );

    expect(sourceSites.size).toBe(0);
    expect(sinkSites.size).toBe(0);
  });
});
