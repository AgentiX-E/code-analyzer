// **The same corpus on both sides, or no verdict.**
//
// The run of 2026-11-11 scored 36 pull requests against a competitor arm that had rows for 33 of them, and the pair was
// published `withheld` - correctly, because our figure was computed over 36 and theirs over 33. **But `withheld` was
// the only thing that rule could ever say**: the competitor's harness fails on some pull request in every run (four of
// thirty-six here, six in the advisory arm), so a precondition of "every pull request has a row" is a decision never to
// answer the question the project exists to answer.
//
// **The two halves of the fix, and why they are one change.**
//
// 1. **A paired test is defined on the paired subset.** A pull request only one arm scored contributes no pair, so it
//    contributes nothing to McNemar - excluding it from *both* sides preserves the measurement instead of corrupting
//    it. What must move with it is **the F1 each side is quoted at**, which is why the intersection is computed here and
//    handed to the scoring rather than applied to a figure that was already computed.
// 2. **The emission rule had two copies.** The pairing counted ours under the pre-registered actionability gate and
//    theirs with every finding it emitted - so their side got credit for findings the rule rejects and ours did not.
//    That is the asymmetry the 2026-11-10 audit named, still live in the code that was meant to fix it. Here the
//    discordance function takes **one rule and two rows**, so a second rule has no parameter to arrive through.

import { describe, expect, it } from 'vitest';

import {
  compareAgainstCompetitor,
  describeComparison,
} from '../../../.github/scripts/lib/competitor-comparison.mjs';
import { goldenDiscordance, pairedCorpus } from '../../../.github/scripts/lib/paired-corpus.mjs';

/** A row in the shape both arms produce: matched goldens, a golden count, and one keep flag per finding. */
function row(key: string, goldens: number, matches: number[][], keep = matches.map(() => true)) {
  return { key, goldens, matches, keep };
}

/** The rule the run registers, reduced to what this file needs: which goldens a row's findings cover. */
const everyFinding = (pull: { matches: number[][] }): { indices: number[] } => ({
  indices: [...new Set(pull.matches.flat())].sort((a, b) => a - b),
});

/** The gated rule: the findings whose keep flag is set. */
const kept = (pull: { matches: number[][]; keep: boolean[] }): { indices: number[] } => ({
  indices: [...new Set(pull.matches.filter((_, at) => pull.keep[at]).flat())].sort((a, b) => a - b),
});

describe('the intersection is the corpus both arms were scored on', () => {
  it('keeps the pull requests both arms scored and names the ones only we scored', () => {
    const paired = pairedCorpus({
      ours: [row('a', 2, [[0]]), row('b', 1, [[0]]), row('c', 3, [[1]])],
      theirs: [row('a', 2, [[0]]), row('c', 3, [[1]])],
    });

    expect(paired.pullRequests).toBe(2);
    expect(paired.pairs.map((pair: { key: string }) => pair.key)).toEqual(['a', 'c']);
    expect(paired.excluded).toEqual([
      { key: 'b', reason: 'the competitor has no row for this pull request' },
    ]);
  });

  it('names the pull requests only the competitor scored, because that is a hole in our own fetch', () => {
    const paired = pairedCorpus({
      ours: [row('a', 1, [[0]])],
      theirs: [row('a', 1, [[0]]), row('z', 1, [[0]])],
    });

    expect(paired.theirsOnly).toEqual([
      { key: 'z', reason: 'this run has no scored row for this pull request' },
    ]);
    expect(paired.pullRequests).toBe(1);
  });

  it('answers an empty overlap with an empty corpus rather than with a tie', () => {
    const paired = pairedCorpus({ ours: [row('a', 1, [[0]])], theirs: [row('b', 1, [[0]])] });

    expect(paired.pullRequests).toBe(0);
    expect(paired.pairs).toEqual([]);
    // Both sides are named: a reader rebuilding the pairing needs to know which side each hole is on.
    expect(paired.excluded).toHaveLength(1);
    expect(paired.theirsOnly).toHaveLength(1);
  });

  it('does not let a duplicate key inflate the pairing', () => {
    const paired = pairedCorpus({
      ours: [row('a', 1, [[0]]), row('a', 1, [[0]])],
      theirs: [row('a', 1, [[0]])],
    });

    // Two rows under one key are two rows about one pull request. Counting them as two pairs would count one
    // measurement twice, in whichever direction the duplicate happened to fall.
    expect(paired.pullRequests).toBe(1);
  });
});

describe('the discordance is computed with one rule over both arms', () => {
  it('counts the goldens one arm covers and the other does not, on the paired corpus only', () => {
    const pairs = [
      { key: 'a', ours: row('a', 3, [[0], [1]]), theirs: row('a', 3, [[1], [2]]) },
      { key: 'b', ours: row('b', 1, [[0]]), theirs: row('b', 1, []) },
    ];

    const { oursOnly, theirsOnly } = goldenDiscordance(pairs, everyFinding);

    // a#0 only we found, a#2 only they found, b#0 only we found, a#1 shared and b's single golden shared by both
    expect(oursOnly).toBe(2);
    expect(theirsOnly).toBe(1);
  });

  it('applies the registered rule to their arm too, which is the asymmetry this test exists for', () => {
    // Their finding matches golden 0 but does not say what to change; ours matches golden 1 and does. Under the
    // registered rule the pair is ours-only - and under the old code it was **both**, because their arm was read with
    // every finding it emitted while ours was read through the gate.
    const pairs = [
      {
        key: 'a',
        ours: row('a', 2, [[1]], [true]),
        theirs: row('a', 2, [[0]], [false]),
      },
    ];

    expect(goldenDiscordance(pairs, kept)).toEqual({ oursOnly: 1, theirsOnly: 0 });
    // The same two rows under the ungated rule are a genuine disagreement, which is what makes the assertion above a
    // statement about the rule rather than about the fixture.
    expect(goldenDiscordance(pairs, everyFinding)).toEqual({ oursOnly: 1, theirsOnly: 1 });
  });

  it('answers zero discordance when both arms cover exactly the same goldens', () => {
    const pairs = [{ key: 'a', ours: row('a', 2, [[0], [1]]), theirs: row('a', 2, [[1], [0]]) }];

    expect(goldenDiscordance(pairs, everyFinding)).toEqual({ oursOnly: 0, theirsOnly: 0 });
  });
});

describe('a comparison over a paired subset states its verdict and carries its scope', () => {
  it('states one when the two arms were restricted to the same pull requests', () => {
    const comparison = compareAgainstCompetitor({
      oursOnly: 40,
      theirsOnly: 4,
      coverage: { requested: 36, covered: 32, missing: 4 },
      paired: { pullRequests: 32 },
    });

    expect(comparison.comparable).toBe(true);
    expect(comparison.verdict).toBe('significant at 0.05');
    expect(comparison.scope).toEqual({
      basis: 'paired subset',
      pullRequests: 32,
      requested: 36,
      excluded: 4,
    });
  });

  it('withholds when the numbers were not restricted, even though most pull requests have a row', () => {
    // **The backwards-compatible half.** A caller that computed its figure over 36 and its counterpart over 32 has two
    // figures over two corpora, and no amount of coverage makes them one measurement.
    const comparison = compareAgainstCompetitor({
      oursOnly: 40,
      theirsOnly: 4,
      coverage: { requested: 36, covered: 32, missing: 4 },
    });

    expect(comparison.comparable).toBe(false);
    expect(comparison.withheldReason).toContain('4 of 36');
  });

  it('withholds when the arms overlap on nothing', () => {
    const comparison = compareAgainstCompetitor({
      oursOnly: 10,
      theirsOnly: 3,
      coverage: { requested: 36, covered: 5, missing: 31 },
      paired: { pullRequests: 0 },
    });

    expect(comparison.comparable).toBe(false);
    expect(comparison.withheldReason).toContain('no pull request both arms scored');
  });

  it('quotes the scope in the log line, so the p-value cannot travel without its denominator', () => {
    const line = describeComparison(
      compareAgainstCompetitor({
        oursOnly: 40,
        theirsOnly: 4,
        coverage: { requested: 36, covered: 32, missing: 4 },
        paired: { pullRequests: 32 },
      }),
    );

    expect(line).toContain('significant at 0.05');
    expect(line).toContain('on 32 of 36 pull requests');
  });
});
