// @code-analyzer — End-to-end: the ceiling is counted against the other lanes, and the committed arms agree
//
// **The user story, in one sentence**: *I added a lane and I need to know whether it found anything, or whether it said
// what four other lanes had already said with a different sentence.* The second is the ordinary outcome and it looks
// identical in an artifact: both rows carry the same `matchedGoldens` index, and a table that counted them would report
// a gain where there is an echo.
//
// **Why this is an end-to-end case rather than a second unit test.** The unit cases drive the instrument against a
// fixture built to be legible; this one drives it against **the two artifacts the repository actually publishes**, so the
// numbers §162.3 and §164 quote are re-derived on every push - the same rule the cut curves follow after §163.1. A
// committed figure that nothing recomputes is a figure that drifts the first time a row is reindexed.

import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/lane-discovery.mjs';
const CORPUS = 'benchmarks/martian/positive_samples.json';
const WIDE = 'benchmarks/martian-wide-bench.json';
const SHIPPED = 'benchmarks/martian-bench.json';

function read(artifact: string, ...extra: string[]): string {
  return execFileSync(
    'node',
    [SCRIPT, '--arm', artifact, '--corpus', CORPUS, '--profile', 'core', ...extra],
    { encoding: 'utf8' },
  );
}

describe('the ceiling the claim is about', () => {
  it("rebuilds the wide arm's own point before it counts anything", () => {
    // **`k = 402` and `80` true positives are the artifact's own published figures** under `drop test, drop path test,
    // budget 12`, and the guard is what makes the ceiling under them a statement about this run rather than about a
    // pool that was rebuilt some other way.
    const out = read(WIDE);
    expect(out).toContain('guard k 402 · truePositives 80');
    expect(out).toContain('goldens 158');
  });

  it('re-derives the point §162.3 quotes, at the same cut', () => {
    // **`k = 24` is the ceiling the section published** (`84` credited goldens), and `k = 5` is the budget the claim is
    // made at (`62` credited, F1 `0.3221`). Both are read here from the committed artifact and the corpus alone.
    const atFive = read(WIDE, '--budget', '5');
    expect(atFive).toContain('budget 5 · 227 comments · 62 credited');
    expect(atFive).toContain('F1 0.3221');
  });

  it('counts what one lane names that no other lane in the same run names', () => {
    // **`security` is the lane that earns its call and `maintainability` is the one that mostly restates**: 38 and 14
    // credited, of which 21 and 5 are unique to the lane. A table that reported `credited` alone would price both as
    // productive, and §161's marginal is the same question asked from the other end.
    const out = read(WIDE);
    const lane = (name: string): string[] =>
      out
        .split('\n')
        .find((row) => row.startsWith(name))
        ?.trim()
        .split(/\s+/u) ?? [];
    expect(lane('security')[2]).toBe('38');
    expect(lane('security')[3]).toBe('21');
    expect(lane('maintainability')[2]).toBe('14');
    expect(lane('maintainability')[3]).toBe('5');
  });

  it('prices the two committed arms against each other, and the difference adds up', () => {
    // **The wide arm's ceiling is 88 and the shipped arm's is 86**, with 68 shared: so `wide` names 20 goldens the shipped
    // five never do and 18 the other way round. **The union is not a superset**, which is the fact that makes the swap in
    // §164 a question rather than an arithmetic - two different six-lane sets name different goldens.
    const out = execFileSync(
      'node',
      [SCRIPT, '--arm', WIDE, '--reference', SHIPPED, '--corpus', CORPUS, '--profile', 'core'],
      { encoding: 'utf8' },
    );
    expect(out).toContain('their ceiling 86 · shared 68 · only this arm 20 · only theirs 18');
  });
});
