// **The prize, recomputed on the artifacts the repository actually ships.**
//
// Everything in `docs/symbol-adjacency.html` and §166 is a claim about a file in this tree, so the test that keeps the
// claim honest is the one that runs the instrument against those files and reads the numbers out of it. **A record that
// is only checked against a fixture is a record that agrees with itself.**
//
// What is asserted is the reading rather than its arithmetic: the 33 goldens only the competitor credits, the 27 that sit
// on a symbol we name, the two controls that say the count is about place (null `2.13`, wrong pull request `2`), the rate
// outside the set that says it cannot be aimed (`99 of 125`), the ceiling the corrected sentences would reach (`104` at
// the same 227 comments) and the eighteen corrections the bar costs.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/symbol-adjacency.mjs';
const ARM = 'benchmarks/martian-wide-bench.json';
const REFERENCE = 'benchmarks/aacr/competitor-baseline.json';
const CORPUS = 'benchmarks/martian/positive_samples.json';

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

/** **One invocation for the four readings that read the same output**: the instrument spends ten seconds on its nulls. */
let shared: string | null = null;
function output(): string {
  shared ??= run();
  return shared;
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
