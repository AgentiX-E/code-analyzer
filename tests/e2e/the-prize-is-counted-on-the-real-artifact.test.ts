// **The prize, recomputed on the artifacts the repository actually ships.**
//
// Everything in `docs/symbol-adjacency.html`, §166 and §169 is a claim about a file in this tree, so the test that keeps
// the claim honest is the one that runs the instrument against those files and reads the numbers out of it. **A record
// that is only checked against a fixture is a record that agrees with itself.**
//
// Two readings are asserted, because §169 shipped both:
//
// - **the sentence alone** - what §166 measured and what §168.8 showed to be a bag of words: 33 goldens only the
//   competitor credits, 27 adjacent, null `2.13`, and the eighty-one corrections the bar would cost;
// - **the sentence restricted to the names the change writes** - the reading §169 prices: 26 adjacent, the null at `1.37`,
//   the same 75 credited and 0.3896 at 227 comments, and seventeen corrections rather than eighteen.
//
// **The prize surviving the restriction is the finding, and it is not the one §168.8 predicted.** The rebuild was expected
// to cost most of the adjacency; it costs one golden. What it does cost is the *anchor*: fourteen of the twenty-six plan
// entries now point at a different first symbol, because the first token of a sentence was usually an English word. A
// reader who wants to know which claim moved can read the two rows here.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/symbol-adjacency.mjs';
const ARM = 'benchmarks/martian-wide-bench.json';
const REFERENCE = 'benchmarks/aacr/competitor-baseline.json';
const CORPUS = 'benchmarks/martian/positive_samples.json';
const CHANGED = 'benchmarks/martian/changed-lines.json';

/** The instrument takes ten seconds over 500 permutations, and a budget of five is spent seven times. */
const SLOW = 120_000;

function run(extra: string[] = []): string {
  return execFileSync(
    'node',
    [
      SCRIPT,
      '--arm',
      ARM,
      '--reference',
      REFERENCE,
      '--corpus',
      CORPUS,
      '--profile',
      'core',
      '--budget',
      '5',
      ...extra,
    ],
    { encoding: 'utf8' },
  );
}

/** **One invocation for the readings that read the same output**: the instrument spends ten seconds on its nulls. */
let shared: string | null = null;
function output(): string {
  shared ??= run();
  return shared;
}

/**
 * **The restricted reading, taken once for everything that asserts it.**
 *
 * The record is written by the same call that prints the table, so the two cannot disagree: a test that ran the command
 * twice would be asserting that a null distribution with a fixed seed is stable, which is a different test.
 */
let restricted: { out: string; record: Record<string, unknown> } | null = null;
function restrictedOutput(): { out: string; record: Record<string, unknown> } {
  if (restricted === null) {
    const dir = mkdtempSync(join(tmpdir(), 'symbol-changed-'));
    const at = join(dir, 'record.json');
    const out = run(['--changed', CHANGED, '--json', at]);
    restricted = { out, record: JSON.parse(readFileSync(at, 'utf8')) as Record<string, unknown> };
  }
  return restricted;
}

describe('the prize, on the committed artifacts', () => {
  it(
    'reads the thirty-three, the twenty-seven and the two controls',
    () => {
      const out = output();
      expect(out).toContain(
        'SYMBOL-ADJACENCY 33 goldens only they credit · 27 on a symbol we name · cap 1',
      );
      expect(out).toContain('shared                    79 · only ours 18 · only theirs 33');
      // **The null is what makes the count a reading**: swapping the symbol sets between goldens leaves 2.13 on average and
      // never more than 6, so twenty-seven is not a property of the corpus's vocabulary.
      expect(out).toContain('null                      mean 2.13 · p95 5 · max 6');
      // **And the wrong pull request is what makes it about place**: the same symbols against a pool that never saw the diff
      // find two of the thirty-three.
      expect(out).toContain('wrong pull request        2 of 33');
      expect(out).toContain('rank at the budget        27 of 27 inside k=5 · median 1');
      // **No changed-line record was given, so the record does not carry a comparison** - the old reading is not printed
      // twice under two names.
      expect(out).not.toContain('the sentence alone');
    },
    SLOW,
  );

  it(
    'publishes the rate outside the set beside the one inside it',
    () => {
      const out = output();
      // **99 of 125**: co-location is the board's base rate, and the record says so in the same block as the 27.
      expect(out).toContain('the same rate outside     99 of 125 goldens not in the set');
    },
    SLOW,
  );

  it(
    'prices the corrected sentences at 104 credited and 0.3896, with the comments unchanged',
    () => {
      const out = output();
      expect(out).toContain('the ceiling               88');
      expect(out).toContain('the prize (replacement)   ceiling 104 · k=5 75 credited · F1 0.3896');
      // **Both readings of a rewrite land on the same point**, which is why the choice between them did not matter here.
      expect(out).toContain('the prize (additive)      ceiling 104 · k=5 75 credited · F1 0.3896');
      expect(out).toContain('the bar                   F1 0.3735 · 18 of 27 conversions');
    },
    SLOW,
  );

  it(
    'shows the loose end of the sweep, where every golden is adjacent to something',
    () => {
      const out = output();
      // At any token the count is 33 and the null meets it at 31.32: the specificity is the whole measurement.
      expect(out).toMatch(/\n\s+1000\s+33\s+33\s+31\.32 · 33/u);
    },
    SLOW,
  );

  it(
    'writes a record whose guard is the artifact own point',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'symbol-record-'));
      const at = join(dir, 'record.json');
      run(['--json', at]);
      const record = JSON.parse(readFileSync(at, 'utf8'));
      expect(record.version).toBe('symbol-adjacency-v1');
      expect(record.guard).toEqual([
        { field: 'k', published: 402, rebuilt: 402 },
        { field: 'truePositives', published: 80, rebuilt: 80 },
      ]);
      expect(record.sets).toEqual({
        ours: 97,
        theirs: 112,
        shared: 79,
        onlyOurs: 18,
        onlyTheirs: 33,
      });
      expect(record.bar).toEqual({
        target: 0.3735,
        needed: { replacement: 10, additive: 13 },
        clearing: 18,
      });
      expect(record.rule.symbolSet).toBe('the golden sentence');
      expect(record.adjacency.comparison).toBeNull();
    },
    SLOW,
  );

  it(
    'refuses an artifact whose arithmetic disagrees with its own record',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'symbol-broken-'));
      const broken = JSON.parse(readFileSync(ARM, 'utf8'));
      broken.emissionRules.shipped.point.k += 1;
      const at = join(dir, 'arm.json');
      writeFileSync(at, `${JSON.stringify(broken)}\n`, 'utf8');
      let status = 0;
      let stderr = '';
      try {
        run(['--arm', at]);
      } catch (error) {
        const failed = error as { status?: number; stderr?: Buffer | string };
        status = Number(failed.status ?? 1);
        stderr = String(failed.stderr ?? '');
      }
      expect(status).toBe(1);
      expect(stderr).toContain('refusing: the rebuild emits 402 comments / 80 true positives');
    },
    SLOW,
  );
});

describe('the reading §169 prices, restricted to the names the change writes', () => {
  it(
    'reads twenty-six rather than twenty-seven, and says what the old reading was',
    () => {
      const { out } = restrictedOutput();
      expect(out).toContain(
        'SYMBOL-ADJACENCY 33 goldens only they credit · 26 on a symbol we name · cap 1',
      );
      // **The row that makes the restriction interpretable**: the sentence alone still counts twenty-seven, so the
      // difference is one golden and not a rewrite of the measurement.
      expect(out).toContain('the sentence alone        27 of 33 (33 carried a specific token)');
      // Two goldens lose every symbol they carried, because their sentences name only English.
      expect(out).toContain('(31 carried a specific symbol)');
      // **The null moves with the set**, which is the check that the count is still about place: 1.37 against 2.13.
      expect(out).toContain('null                      mean 1.37 · p95 3 · max 5');
      expect(out).toContain('rank at the budget        26 of 26 inside k=5 · median 1');
    },
    SLOW,
  );

  it(
    'finds the prize unchanged to within one golden',
    () => {
      const { out } = restrictedOutput();
      expect(out).toContain('the ceiling               88');
      expect(out).toContain('the prize (additive)      ceiling 103 · k=5 75 credited · F1 0.3896');
      expect(out).toContain('the bar                   F1 0.3735 · 17 of 26 conversions');
      // **The rate outside the set falls with the set**, because a rarity rule applied to fewer symbols admits fewer
      // coincidences: 89 of 125 rather than 99.
      expect(out).toContain('the same rate outside     89 of 125 goldens not in the set');
    },
    SLOW,
  );

  it(
    'records the symbol set it used and the digest of the harvest behind it',
    () => {
      const { record } = restrictedOutput();
      expect(record['rule']).toMatchObject({
        symbolSet:
          'the golden sentence, restricted to names the pull request’s own added lines write',
        cap: 1,
        changedLines: { path: CHANGED, harvested: 50, failed: 0 },
      });
      const changedLines = (record['rule'] as { changedLines: { corpusDigest: string } })
        .changedLines;
      expect(changedLines.corpusDigest).toMatch(/^sha256-[0-9a-f]{64}$/u);
      expect(record['adjacency']).toMatchObject({
        goldensWithSymbols: 31,
        adjacent: 26,
        comparison: { sentence: { withSymbols: 33, adjacent: 27 } },
      });
      expect(record['bar']).toMatchObject({ clearing: 17 });
    },
    SLOW,
  );

  it(
    'refuses a harvest that does not cover the pull requests the set is measured on',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'symbol-uncovered-'));
      const at = join(dir, 'changed.json');
      writeFileSync(
        at,
        `${JSON.stringify({ version: 'changed-lines-v1', corpusDigest: 'sha256-none', pulls: {} })}\n`,
        'utf8',
      );
      let status = 0;
      let stderr = '';
      try {
        run(['--changed', at]);
      } catch (error) {
        const failed = error as { status?: number; stderr?: Buffer | string };
        status = Number(failed.status ?? 1);
        stderr = String(failed.stderr ?? '');
      }
      // **Exit 2 and not a count of zero**: a missing pull request is a record to rebuild, and a golden whose change names
      // nothing is a finding. Conflating them is the defect the coverage field exists to prevent.
      expect(status).toBe(2);
      expect(stderr).toContain('covers no added lines');
      expect(stderr).toContain('pull request(s) the set is measured on');
    },
    SLOW,
  );
});
