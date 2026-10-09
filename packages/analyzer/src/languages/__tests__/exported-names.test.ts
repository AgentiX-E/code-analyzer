// One walk instead of sixty-six, and the two must agree.
//
// **The method exists to replace a quadratic, so the only interesting question is whether it answers the same.** A
// faster wrong answer is worse than a slow right one, and **this file is a differential test rather than a fixture**:
// it takes real files, collects the set in one walk, and **compares it against the per-symbol predicate the phase
// used to call** - so **a disagreement anywhere shows up as a failing case rather than as a changed index.**

import { readFileSync, existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { getOrLoadProvider } from '../../pipeline/phase-helpers.js';

/** Real files, checked in, so the test does not depend on a checkout. */
const FILES = [
  'packages/shared/src/types/capture-tags.ts',
  'packages/shared/src/constants/edge-types.ts',
  'packages/shared/src/index.ts',
];

describe('exportedNames agrees with the predicate it replaces', () => {
  it('collects the same names the per-symbol check would have confirmed', async () => {
    const provider = await getOrLoadProvider('typescript');
    expect(provider).not.toBeNull();
    if (!provider) return;

    let compared = 0;
    for (const file of FILES) {
      if (!existsSync(file)) continue;
      const source = readFileSync(file, 'utf8');

      // **The set, in one walk.**
      // **Optional on the interface**, so the case skips rather than casting: a provider without it is one the
      // phase falls back for, which is a supported state rather than a test failure.
      if (!provider.exportedNames) continue;
      const collected = provider.exportedNames(source);

      // **The answer the old path produced**, by parsing the file and asking about every capture name it emitted.
      const captures = provider.parse(source, file);
      const named = captures.map((c) => c.name).filter((n): n is string => typeof n === 'string');
      const perSymbol = new Set(named.filter((n) => provider.isExported(source, n)));

      // **Every name the predicate confirms is in the set.** The other direction is not asserted, and the reason is
      // the point of collecting rather than verifying: **a set may hold a name no capture happened to mention** -
      // that is what makes it a set of the file's exports rather than of the captures' questions.
      for (const name of perSymbol) {
        expect(collected.has(name)).toBe(true);
        compared += 1;
      }
    }

    // **And the differential ran on something**, so a test that compared zero names fails instead of passing.
    expect(compared).toBeGreaterThan(0);
  }, 600_000);

  it('says nothing about a file with no exports', async () => {
    const provider = await getOrLoadProvider('typescript');
    if (!provider) return;

    // **A collection must not manufacture exports**, and the cheapest way to check is a file with none.
    if (!provider.exportedNames) return;
    const names = provider.exportedNames('const x = 1;\nfunction f() { return x; }\n');
    expect(names.size).toBe(0);
  }, 600_000);
});
