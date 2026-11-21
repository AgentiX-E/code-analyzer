// Every script that can call a model has a ceiling, and the ceiling is a number a reader can find.
//
// **The defect this closes is the one the 2026-11-10 bill was made of.** The benchmark harness had a ceiling - 12 USD,
// with a comment explaining why - and the other four scripts that construct a `DeepSeekProvider` had none. **So the
// most expensive job in the repository was the only one that could not run away**, and the four that could were the four
// nobody had priced. A ledger without a ceiling records a bill after it is paid; a ceiling stops one being incurred.
//
// **The rule is checkable in one pass**: a script that constructs a provider must also construct a `CostLedger` and pass
// `ceilingUsd`, because a ceiling without a ledger has nothing to compare against and the provider refuses that
// combination outright. The count assertion at the bottom is not decoration - a reader that silently finds no scripts
// would certify every file by reading none of them.
//
// **And the rule grew a second door when the benchmark job stopped naming a class.** §127 moved every construction in
// `aacr-bench.mjs` through `createLLMProvider`, which is the point of the registry - and **this reader keyed on
// `new DeepSeekProvider(`, so the most expensive script in the repository silently left the list it is the reason for.**
// A guard whose subject can walk out of its field of view is worse than no guard, because the count still reads as
// satisfied. Both doors are read now, and the ceiling is required behind either.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SCRIPTS = join(ROOT, '.github', 'scripts');

/**
 * **Both ways a script can obtain a model.** A direct construction, and the registry the benchmark job uses since §127 -
 * a reader that knew only the first certified a file it had stopped reading.
 */
const CONSTRUCTS = /new (?:DeepSeek|Zhipu)Provider\(|createLLMProvider\(/u;

const scriptFiles = () =>
  readdirSync(SCRIPTS)
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => ({ name: file, source: readFileSync(join(SCRIPTS, file), 'utf8') }))
    .filter(({ source }) => CONSTRUCTS.test(source));

describe('a script that can call a model declares what it is allowed to spend', () => {
  it('passes a ceiling to every provider it constructs', () => {
    const offenders: string[] = [];
    for (const { name, source } of scriptFiles()) {
      for (const match of source.matchAll(
        /(?:new (?:DeepSeek|Zhipu)Provider|createLLMProvider)\(([\s\S]{0,400}?)\)/gu,
      )) {
        const args = match[1] ?? '';
        if (!args.includes('ceilingUsd')) offenders.push(`${name}: ${args.trim().slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps a ledger beside the ceiling, because a ceiling compares against recorded spend', () => {
    const offenders = scriptFiles()
      .filter(({ source }) => !source.includes('CostLedger'))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it('finds the scripts, so a broken reader cannot pass this file by reading nothing', () => {
    // Four when the rule was written: the benchmark, the competitor corpus, the semantic review and the Martian harness.
    // A script that stops calling a model stops counting, which is why this is a floor rather than an equality.
    expect(scriptFiles().length).toBeGreaterThanOrEqual(3);
    expect(scriptFiles().some(({ name }) => name === 'aacr-bench.mjs')).toBe(true);
  });

  it('reads only the scripts, not the shared library, because the library constructs nothing', () => {
    // The control: `lib/` holds pure functions and a `new DeepSeekProvider(` there would be a construction this reader
    // never sees. Asserting the directory is flat keeps that assumption honest rather than implicit.
    const entries = readdirSync(SCRIPTS);
    expect(entries).toContain('lib');
    expect(scriptFiles().every(({ name }) => !name.includes('/'))).toBe(true);
  });
});
