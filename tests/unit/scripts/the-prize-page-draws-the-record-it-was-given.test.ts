// **The prize page draws the record, and refuses a record that cannot be one.**
//
// A page about a number this large is a page that will be quoted, so what is tested here is not its typography but the
// two things that make a quote safe. **The first is that the rate outside the set is on the page at all**: 27 of 33 is a
// sentence about the goldens we miss, and 99 of 125 is the sentence that says the same is true of the goldens nobody
// misses, and a renderer that dropped the second would turn a diagnostic into a boast.
//
// **The second is the six refusals**: a version it does not know, a guard that does not reproduce the arm's own point, an
// adjacency larger than the set it is drawn from, a rate whose numerator exceeds its denominator, a plan that points
// outside the pool, and a curve that loses a credit when it converts one more comment. Each of them is a page that would
// otherwise draw a bar no arithmetic produced.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/symbol-adjacency-page.mjs';

/** A record in the shape `scripts/symbol-adjacency.mjs` writes, small enough to check by eye. */
function record(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 'symbol-adjacency-v1',
    measuredAt: '2026-11-26T09:12:00.000Z',
    arm: 'benchmarks/martian-wide-bench.json',
    reference: 'benchmarks/aacr/competitor-baseline.json',
    corpus: 'benchmarks/martian/positive_samples.json',
    profile: 'core',
    budget: 5,
    guard: [{ field: 'k', published: 402, rebuilt: 402 }],
    goldens: 158,
    sets: { ours: 97, theirs: 112, shared: 79, onlyOurs: 18, onlyTheirs: 33 },
    rule: {
      identifier: 'four or more characters, identifier-shaped',
      specificity: 'the number of pull requests whose pool names it',
      cap: 1,
      sweep: [
        {
          cap: 1,
          withSymbols: 33,
          adjacent: 27,
          null: { permutations: 500, seed: 1, mean: 2.13, p95: 5, max: 6 },
        },
        {
          cap: 1000,
          withSymbols: 33,
          adjacent: 33,
          null: { permutations: 500, seed: 1, mean: 31.32, p95: 33, max: 33 },
        },
      ],
    },
    base: { ceiling: 88, atBudget: { k: 227, truePositives: 62, f1: 0.3221 } },
    adjacency: {
      goldensWithSymbols: 33,
      adjacent: 27,
      null: { permutations: 500, seed: 1, mean: 2.13, p95: 5, max: 6 },
      wrongPullRequest: { adjacent: 2, uncontrolled: 1 },
      baseRate: { goldens: 125, withSymbols: 121, adjacent: 99 },
    },
    ranks: { within: 27, median: 1, max: 1 },
    rewrite: {
      converted: 27,
      findings: 24,
      additive: { ceiling: 104, atBudget: { k: 227, truePositives: 75, f1: 0.3896 } },
      replacement: { ceiling: 104, atBudget: { k: 227, truePositives: 75, f1: 0.3896 } },
    },
    bar: { target: 0.3735, needed: { replacement: 10, additive: 13 }, clearing: 18 },
    curve: [
      { converted: 9, credited: 68, f1: 0.3532 },
      { converted: 18, credited: 72, f1: 0.374 },
      { converted: 27, credited: 75, f1: 0.3896 },
    ],
    // **Twenty-seven entries, because the curve is a prefix of the plan**: a fixture whose plan is shorter than its
    // curve would draw a page that says "18 of 1".
    plan: Array.from({ length: 27 }, (_unused, at) => ({
      key: `https://github.com/o/r/pull/1\u0000${String(at)}`,
      golden: at,
      findingAt: 200 + at,
      rank: 1,
      path: 'a.rb',
      symbols: ['topicUser'],
    })),
    ...over,
  };
}

function render(payload: Record<string, unknown>, extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'symbol-page-'));
  const at = join(dir, 'record.json');
  const out = join(dir, 'page.html');
  writeFileSync(at, `${JSON.stringify(payload)}\n`, 'utf8');
  execFileSync('node', [SCRIPT, '--record', at, '--out', out, ...extra], { encoding: 'utf8' });
  return readFileSync(out, 'utf8');
}

function failure(payload: Record<string, unknown>): { status: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'symbol-page-'));
  const at = join(dir, 'record.json');
  writeFileSync(at, `${JSON.stringify(payload)}\n`, 'utf8');
  try {
    execFileSync('node', [SCRIPT, '--record', at, '--out', join(dir, 'page.html')], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const failed = error as { status?: number; stderr?: Buffer | string };
    return { status: Number(failed.status ?? 1), stderr: String(failed.stderr ?? '') };
  }
}

describe('the prize page', () => {
  it('draws the rate on the set and the rate outside it, side by side', () => {
    const html = render(record());
    expect(html).toContain('27 / 33');
    expect(html).toContain('99 / 125');
    // **The paragraph that says a device cannot select on this** is the reason the page exists, so its absence fails.
    expect(html).toContain('cannot select which comment to rewrite');
  });

  it('marks the null on every sweep row, so the count is never read without it', () => {
    const html = render(record());
    expect(html.match(/class="mark"/gu) ?? []).toHaveLength(2);
    expect(html).toContain('2.13');
    expect(html).toContain('31.32');
  });

  it('prints the arm and the correction as two rows of one table', () => {
    const html = render(record());
    expect(html).toContain('what the arm posts');
    expect(html).toContain('the sentences corrected');
    expect(html).toContain('0.3221');
    expect(html).toContain('0.3896');
  });

  it('marks the prefix that clears only when the bar it was given is the one it clears', () => {
    const clear = render(record(), ['--bar', '0.3735']);
    // **Three figures are marked**, because the ladder's corrected row is one of them: two curve rows reach 0.3740 and
    // 0.3896 against a bar of 0.3735, the 0.3532 row does not, and the arm's own 0.3221 does not either.
    expect(clear.match(/class="n pass"/gu) ?? []).toHaveLength(3);
    expect(clear).toContain('18 of 27 corrections clear it');
    const unreachable = render(record({ curve: [{ converted: 27, credited: 63, f1: 0.33 }] }), [
      '--bar',
      '0.3735',
    ]);
    expect(unreachable).toContain('no prefix clears the bar');
  });

  it('refuses a version it does not know', () => {
    const refused = failure(record({ version: 2 }));
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('this page reads symbol-adjacency-v1');
  });

  it('refuses a guard that does not rebuild the arm own point', () => {
    const refused = failure(record({ guard: [{ field: 'k', published: 402, rebuilt: 401 }] }));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('k 402 != 401');
  });

  it('refuses an adjacency larger than the set it is drawn from', () => {
    const refused = failure(
      record({ adjacency: { ...(record()['adjacency'] as object), adjacent: 40 } as unknown }),
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('40 adjacent goldens out of a set of 33');
  });

  it('refuses a rate whose numerator exceeds its denominator', () => {
    const refused = failure(
      record({
        adjacency: {
          ...(record()['adjacency'] as object),
          baseRate: { goldens: 10, withSymbols: 10, adjacent: 11 },
        } as unknown,
      }),
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('11 of 10');
  });

  it('refuses a plan that points outside the pool', () => {
    const refused = failure(
      record({
        plan: [{ key: 'k', golden: 0, findingAt: -3, rank: 1, path: 'a.rb', symbols: [] }],
      }),
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('not a row');
  });

  it('refuses a curve that loses a credit when it converts one more comment', () => {
    // **A maximum matching cannot fall when an edge is added**, so a falling curve came from another arithmetic.
    const refused = failure(
      record({
        curve: [
          { converted: 9, credited: 68, f1: 0.35 },
          { converted: 18, credited: 67, f1: 0.35 },
        ],
      }),
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('falls from 68 to 67');
  });
});
