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

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SCRIPTS = join(ROOT, '.github', 'scripts');

const scriptFiles = () =>
  readdirSync(SCRIPTS)
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => ({ name: file, source: readFileSync(join(SCRIPTS, file), 'utf8') }))
    .filter(({ source }) => source.includes('new DeepSeekProvider('));

describe('a script that can call a model declares what it is allowed to spend', () => {
  it('passes a ceiling to every provider it constructs', () => {
    const offenders: string[] = [];
    for (const { name, source } of scriptFiles()) {
      for (const match of source.matchAll(/new DeepSeekProvider\(([\s\S]{0,400}?)\)/g)) {
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
