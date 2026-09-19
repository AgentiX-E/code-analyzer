// `stmtFacts` from captures: one definition, one use, and the reasons for every choice made.
//
// The half that is here is a derivation over captures the pipeline already produces. The half that is not — source
// and sink sites — needs tags the vocabulary does not have, and these tests do not pretend otherwise.

import { describe, it, expect } from 'vitest';

import { buildStatementFacts } from '../cfg/statement-facts.js';

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
    // `blockIndex * STRIDE + stmtIndex` would wrap into the next block's range. A dropped fact is visible; a
    // colliding one is not.
    const { bindings, stmtFacts } = buildStatementFacts(
      [capture('variable.def', 'far', 10 + 1024)],
      10,
      1100,
    );

    // The binding is still created: the variable exists whether or not its statement can be keyed.
    // Only the def site is dropped, and a binding with no def site produces no source.
    expect(bindings.map((b) => b.name)).toEqual(['far']);
    expect(stmtFacts.defs.size).toBe(0);
  });

  it('leaves the source and sink maps empty, which is the half that is still missing', () => {
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
