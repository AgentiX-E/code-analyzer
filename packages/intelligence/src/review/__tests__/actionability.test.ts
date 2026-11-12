import { describe, expect, it } from 'vitest';

import {
  ACTIONABILITY_WEIGHTS,
  collectDiffFacts,
  goldenOwners,
  matchedGoldenIndices,
  maximumMatchingCount,
  point,
  rankFindings,
  scoreSubset,
  topKCurve,
  weighFinding,
} from '../actionability.js';

import type { LocatedFinding } from '../actionability.js';
import type { LLMFinding } from '../llm/prompts.js';

// ---------------------------------------------------------------------------
// A diff whose line numbers are known by hand, so every assertion can be checked against it
// ---------------------------------------------------------------------------

/**
 * One file, one hunk, new-file lines 10, 11, 12, 13 and 14.
 *
 * ```
 * 10  const angle = compute();
 * 11 +const total = angle * 2;
 * 12 +if (total > limit) {
 * 13 +  report(total);
 * 14  }
 * ```
 *
 * Line 11, 12 and 13 are added; 10 and 14 are context. The removed line `-const angle = 0;` has no new-file number,
 * which is the fact the removed-line test below depends on.
 */
const ONE_FILE = [
  'diff --git a/src/geom.ts b/src/geom.ts',
  'index 1111111..2222222 100644',
  '--- a/src/geom.ts',
  '+++ b/src/geom.ts',
  '@@ -10,4 +10,5 @@ export function area(angle: number) {',
  ' const angle = compute();',
  '-const angle = 0;',
  '+const total = angle * 2;',
  '+if (total > limit) {',
  '+  report(total);',
  ' }',
].join('\n');

function finding(overrides: Partial<LLMFinding> = {}): LLMFinding {
  return {
    startLine: 12,
    endLine: 12,
    severity: 'high',
    category: 'bug',
    title: 'Guard is missing around limit comparison',
    description:
      '`limit` is never checked, so total can exceed it and report is called on a bad value.',
    suggestion: 'Add a check before the comparison: `if (limit > 0 && total > limit)`.',
    ...overrides,
  };
}

const facts = collectDiffFacts(ONE_FILE);
const located = (overrides: Partial<LLMFinding> = {}): LocatedFinding => ({
  finding: finding(overrides),
  path: 'src/geom.ts',
});

// ---------------------------------------------------------------------------
// collectDiffFacts
// ---------------------------------------------------------------------------

describe('collectDiffFacts', () => {
  it('records added lines against their new-file line numbers', () => {
    expect([...(facts.added.get('src/geom.ts')?.keys() ?? [])]).toEqual([11, 12, 13]);
    expect(facts.added.get('src/geom.ts')?.get(12)).toBe('if (total > limit) {');
  });

  it('keeps context and removed lines for quotation checks but not as added lines', () => {
    expect(facts.shown.get('src/geom.ts')).toContain('const angle = 0;');
    expect([...(facts.added.get('src/geom.ts')?.values() ?? [])]).not.toContain('const angle = 0;');
  });

  it('gives a later hunk the start line its own header declares', () => {
    const twoHunks = [
      'diff --git a/src/a.ts b/src/a.ts',
      '@@ -1,1 +1,2 @@',
      ' one',
      '+two',
      '@@ -40,1 +41,2 @@',
      ' forty',
      '+fortyone',
    ].join('\n');
    const parsed = collectDiffFacts(twoHunks);
    expect([...(parsed.added.get('src/a.ts')?.keys() ?? [])]).toEqual([2, 42]);
  });

  it('strips the b/ prefix and unquotes a quoted path', () => {
    const parsed = collectDiffFacts(
      ['diff --git a/dir b/dir2', '+++ "b/dir/x y.ts"', '@@ -0,0 +1 @@', '+const x = 1;'].join(
        '\n',
      ),
    );
    expect([...parsed.added.keys()]).toEqual(['dir/x y.ts']);
  });

  it('reads a diff that carries no diff --git header', () => {
    const parsed = collectDiffFacts(
      ['--- a/only.ts', '+++ b/only.ts', '@@ -0,0 +7,1 @@', '+x'].join('\n'),
    );
    expect([...(parsed.added.get('only.ts')?.keys() ?? [])]).toEqual([7]);
  });

  it('ignores a deletion to /dev/null rather than inventing a path', () => {
    const parsed = collectDiffFacts(
      ['diff --git a/gone.ts b/gone.ts', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-x'].join('\n'),
    );
    expect(parsed.added.size).toBe(0);
  });

  it('does not advance the line counter on a removed line', () => {
    const parsed = collectDiffFacts(
      ['diff --git a/a.ts b/a.ts', '@@ -1,3 +1,3 @@', ' keep', '-gone', '+added', ' keep2'].join(
        '\n',
      ),
    );
    expect([...(parsed.added.get('a.ts')?.keys() ?? [])]).toEqual([2]);
  });

  it('skips the no-newline marker and CRLF carriage returns', () => {
    const parsed = collectDiffFacts(
      [
        'diff --git a/a.ts b/a.ts',
        '@@ -1,1 +1,2 @@',
        ' one',
        '+two\r',
        '\\ No newline at end of file',
      ].join('\n'),
    );
    expect(parsed.added.get('a.ts')?.get(2)).toBe('two');
  });

  it('ignores text before the first file header', () => {
    const parsed = collectDiffFacts(
      ['From 1111111 Mon Sep 17 00:00:00 2001', 'subject line'].join('\n'),
    );
    expect(parsed.added.size).toBe(0);
  });

  it('keeps one line map for a path that appears in two sections', () => {
    // **A path can appear twice** when a diff is assembled from two commits, and a second map for the same path would
    // silently discard the first section's lines.
    const parsed = collectDiffFacts(
      [
        'diff --git a/x.ts b/x.ts',
        '@@ -0,0 +1,1 @@',
        '+one',
        'diff --git a/x.ts b/x.ts',
        '@@ -10,0 +11,1 @@',
        '+two',
      ].join('\n'),
    );
    expect([...(parsed.added.get('x.ts')?.keys() ?? [])]).toEqual([1, 11]);
  });

  it('returns no entry for a file whose only lines are removals', () => {
    const parsed = collectDiffFacts(
      ['diff --git a/a.ts b/a.ts', '@@ -1,1 +0,0 @@', '-gone'].join('\n'),
    );
    expect(parsed.added.has('a.ts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// weighFinding — each feature, one at a time
// ---------------------------------------------------------------------------

describe('weighFinding', () => {
  it('scores a grounded, concrete, unhedged finding above 0.6', () => {
    const score = weighFinding(located(), facts);
    expect(score.features.grounded).toBe(true);
    expect(score.features.hedged).toBe(false);
    expect(score.actionable).toBe(true);
    expect(score.score).toBeGreaterThan(0.6);
  });

  it('marks a finding whose range covers only context lines as not grounded and not actionable', () => {
    const score = weighFinding(located({ startLine: 14, endLine: 14 }), facts);
    expect(score.features.grounded).toBe(false);
    expect(score.actionable).toBe(false);
    expect(score.why).toContain(
      'the range covers no added line, so the comment is not about this change',
    );
  });

  it('treats a finding on an unknown path as ungrounded rather than throwing', () => {
    const score = weighFinding({ finding: finding(), path: 'src/absent.ts' }, facts);
    expect(score.features.grounded).toBe(false);
    expect(score.features.quotesDiff).toBe(false);
    expect(score.features.namesSymbol).toBe(false);
  });

  it('accepts a range given backwards, because the model does not always order it', () => {
    expect(weighFinding(located({ startLine: 13, endLine: 11 }), facts).features.grounded).toBe(
      true,
    );
  });

  it('rejects a range that is not a whole number', () => {
    expect(weighFinding(located({ startLine: 12.5, endLine: 13 }), facts).features.grounded).toBe(
      false,
    );
  });

  it('reports quoted code when the description quotes an added line', () => {
    const score = weighFinding(
      located({ description: 'The line `if (total > limit) {` has no guard.', suggestion: null }),
      facts,
    );
    expect(score.features.quotesDiff).toBe(true);
    // No suggestion and no quotation of a whole line would fail the gate; the quotation alone carries it.
    expect(score.actionable).toBe(true);
  });

  it('reports quoted code from the snippet field too', () => {
    const score = weighFinding(
      located({ description: 'see below', snippet: 'report(total);' }),
      facts,
    );
    expect(score.features.quotesDiff).toBe(true);
  });

  it('does not count a short added line as quoted evidence', () => {
    const parsed = collectDiffFacts(
      ['diff --git a/a.ts b/a.ts', '@@ -0,0 +1,1 @@', '+x = 1;'].join('\n'),
    );
    const score = weighFinding(
      { finding: finding({ description: 'x = 1; is wrong', suggestion: null }), path: 'a.ts' },
      parsed,
    );
    // Eleven characters is under the twelve-character floor, so a coincidental short line is not evidence.
    expect(score.features.quotesDiff).toBe(false);
  });

  it('names a symbol the diff touches', () => {
    const score = weighFinding(
      located({ description: 'total can overflow before report is called' }),
      facts,
    );
    expect(score.features.namesSymbol).toBe(true);
  });

  it('does not count a common English word as a named symbol', () => {
    const parsed = collectDiffFacts(
      ['diff --git a/a.ts b/a.ts', '@@ -0,0 +1,1 @@', '+const value = 1;'].join('\n'),
    );
    const score = weighFinding(
      { finding: finding({ description: 'the value is never read here' }), path: 'a.ts' },
      parsed,
    );
    expect(score.features.namesSymbol).toBe(false);
  });

  it('accepts an imperative suggestion as a proposed change', () => {
    expect(
      weighFinding(located({ suggestion: 'Replace the raw call with a guard.' }), facts).features
        .proposesChange,
    ).toBe(true);
  });

  it('accepts a suggestion that shows a replacement block', () => {
    expect(
      weighFinding(located({ suggestion: 'see:\n+if (limit > 0) {' }), facts).features
        .proposesChange,
    ).toBe(true);
  });

  it('rejects a suggestion that is a restatement with no action', () => {
    expect(
      weighFinding(located({ suggestion: 'A potential problem in this area of the code.' }), facts)
        .features.proposesChange,
    ).toBe(false);
  });

  it('rejects an absent suggestion', () => {
    const score = weighFinding(located({ suggestion: null }), facts);
    expect(score.features.proposesChange).toBe(false);
    expect(score.why).toContain('the suggestion names no action and shows no replacement');
  });

  it('penalises hedged language and says so', () => {
    const hedged = weighFinding(
      located({ description: 'This might be a problem when report is called.' }),
      facts,
    );
    const plain = weighFinding(
      located({ description: 'report is called with a bad value here.' }),
      facts,
    );
    expect(hedged.features.hedged).toBe(true);
    expect(hedged.score).toBeLessThan(plain.score);
    expect(hedged.why).toContain('hedged language, which is a claim the model declined to make');
  });

  it('weights severity, and gives info the lowest share', () => {
    const critical = weighFinding(located({ severity: 'critical' }), facts).score;
    const info = weighFinding(located({ severity: 'info' }), facts).score;
    expect(critical).toBeGreaterThan(info);
  });

  it('weights the lane, and gives an unknown lane the neutral middle', () => {
    const security = weighFinding(located({ lane: 'security' }), facts).score;
    const maintainability = weighFinding(located({ lane: 'maintainability' }), facts).score;
    const unknown = weighFinding(located({ lane: 'made-up' }), facts).score;
    expect(security).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(maintainability);
  });

  it('treats a missing lane as the neutral middle too', () => {
    expect(weighFinding(located({ lane: undefined }), facts).score).toBe(
      weighFinding(located({ lane: 'made-up' }), facts).score,
    );
  });

  it('raises the score with agreement and saturates at three lanes', () => {
    const alone = weighFinding(located(), facts).score;
    const two = weighFinding(located({ agreement: 2 }), facts).score;
    const three = weighFinding(located({ agreement: 3 }), facts).score;
    const five = weighFinding(located({ agreement: 5 }), facts).score;
    expect(two).toBeGreaterThan(alone);
    expect(three).toBeGreaterThan(two);
    expect(five).toBe(three);
  });

  it('treats a non-finite or absent agreement as one', () => {
    expect(weighFinding(located({ agreement: Number.NaN }), facts).score).toBe(
      weighFinding(located(), facts).score,
    );
    expect(weighFinding(located({ agreement: 0 }), facts).score).toBe(
      weighFinding(located(), facts).score,
    );
  });

  it('says which of the two conditional terms it could not observe', () => {
    // **A score built from five of the seven terms is not the same ruler as one built from seven.** The reading reviewer
    // has one lane and no lane label, so both conditional terms are unobservable on every finding it files - and a reader
    // comparing its scores with the five lanes' has to be able to see that from the score object rather than from a
    // report. **Measured on a hundred-pull-request run**: median 0.509 for the reading arm against 0.707 for the lanes,
    // of which 0.0967 is these two terms before anything about the comments is considered.
    const lanes = weighFinding(located({ agreement: 2, lane: 'security' }), facts);
    expect(lanes.scoreTerms).toEqual({ agreement: true, lane: true });

    const reading = weighFinding(located({ lane: undefined }), facts);
    expect(reading.scoreTerms).toEqual({ agreement: false, lane: false });

    // **The score itself is untouched**, because re-normalising it so the denominator drops an unobservable term makes a
    // finding with more corroboration score lower - the case above asserts agreement raises it, and both cannot hold.
    expect(reading.score).toBe(
      weighFinding(located({ lane: undefined, agreement: 1 }), facts).score,
    );
  });

  it('clamps the score into [0, 1] and rounds it to four decimals', () => {
    const worst = weighFinding(
      located({
        startLine: 99,
        endLine: 99,
        severity: 'info',
        lane: 'maintainability',
        suggestion: null,
        title: 'A vague remark',
        description: 'maybe a problem somewhere near here',
      }),
      facts,
    );
    expect(worst.score).toBe(0);
    const best = weighFinding(
      located({ severity: 'critical', lane: 'security', agreement: 9 }),
      facts,
    );
    expect(best.score).toBeLessThanOrEqual(1);
    expect(String(best.score).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it('keeps the weights a partition of one, because the score is meant to be a proportion', () => {
    const { hedgePenalty, ...positive } = ACTIONABILITY_WEIGHTS;
    const sum = Object.values(positive).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1);
    expect(hedgePenalty).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// rankFindings
// ---------------------------------------------------------------------------

describe('rankFindings', () => {
  const items: LocatedFinding[] = [
    {
      finding: finding({ startLine: 14, endLine: 14, description: 'maybe the brace is odd' }),
      path: 'src/geom.ts',
    },
    { finding: finding({ startLine: 12, endLine: 12, severity: 'high' }), path: 'src/geom.ts' },
    {
      finding: finding({ startLine: 11, endLine: 11, severity: 'critical', lane: 'security' }),
      path: 'src/geom.ts',
    },
  ];

  it('puts the actionable finding first and the ungrounded one last', () => {
    const ranked = rankFindings(items, facts);
    expect(ranked[ranked.length - 1]?.finding.startLine).toBe(14);
    expect(ranked[0]?.score.score).toBeGreaterThanOrEqual(ranked[1]?.score.score ?? 0);
  });

  it('breaks a tie by agreement, then severity, then input order', () => {
    const a = located({ startLine: 12, endLine: 12, agreement: 3 });
    const b = located({ startLine: 12, endLine: 12, agreement: 3 });
    const ranked = rankFindings([a, b], facts);
    expect(ranked.map((r) => r.index)).toEqual([0, 1]);
  });

  it('is deterministic across repeated calls', () => {
    const first = rankFindings(items, facts).map((r) => r.index);
    const second = rankFindings(items, facts).map((r) => r.index);
    expect(second).toEqual(first);
  });

  it('returns an empty list for an empty input', () => {
    expect(rankFindings([], facts)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// maximumMatchingCount
// ---------------------------------------------------------------------------

describe('maximumMatchingCount', () => {
  it('counts one golden per finding when the matches are disjoint', () => {
    expect(maximumMatchingCount([[0], [1], [2]], 5)).toBe(3);
  });

  it('counts a golden once even when three findings name it', () => {
    expect(maximumMatchingCount([[0], [0], [0]], 5)).toBe(1);
  });

  it('augments rather than settling for the first available golden', () => {
    // The first finding can only be satisfied by golden 0, so the second has to give it up and take golden 1.
    expect(maximumMatchingCount([[0, 1], [0]], 2)).toBe(2);
  });

  it('finds the maximum in a chain that needs two reassignments', () => {
    expect(maximumMatchingCount([[0, 1], [1, 2], [2]], 3)).toBe(3);
  });

  it('ignores an index outside the golden range instead of crashing', () => {
    expect(maximumMatchingCount([[7], [0]], 2)).toBe(1);
  });

  it('ignores a negative index', () => {
    expect(maximumMatchingCount([[-1], [0]], 2)).toBe(1);
  });

  it('returns zero when nothing matches', () => {
    expect(maximumMatchingCount([[], []], 2)).toBe(0);
  });
});

describe('matchedGoldenIndices', () => {
  it('names the goldens rather than counting them, because a paired test needs the pairing', () => {
    expect(matchedGoldenIndices([[2], [0]], 3).sort()).toEqual([0, 2]);
  });

  it('leaves a golden out when every finding that names it is already holding another', () => {
    // One finding, two candidates: the second golden is not covered, and saying so is the point of returning a set.
    expect(matchedGoldenIndices([[0, 1]], 2)).toEqual([0]);
  });

  it('returns an empty set for an empty ranking', () => {
    expect(matchedGoldenIndices([], 4)).toEqual([]);
  });

  it('agrees with the count it now backs', () => {
    const matches = [[0, 1], [1, 2], [2]];
    expect(matchedGoldenIndices(matches, 3)).toHaveLength(maximumMatchingCount(matches, 3));
  });
});

describe('goldenOwners', () => {
  it('names the finding that owns each golden, because a breakdown needs the owner and not the set', () => {
    // Finding 0 found golden 2, finding 1 found golden 0 - so `owners[2] === 0` is the sentence *the first finding
    // carries the third golden*, which is exactly what a per-category reading of a true positive needs.
    expect(goldenOwners([[2], [0]], 3)).toEqual([1, -1, 0]);
  });

  it('displaces a finding to a golden it can find, and reports the displacement', () => {
    // **This is the augmenting path doing the thing a greedy match cannot.** Finding 0 prefers golden 0 and can fall back
    // to golden 1; finding 1 only names golden 0. A greedy match gives golden 0 to finding 0 and loses finding 1.
    expect(goldenOwners([[0, 1], [0]], 2)).toEqual([1, 0]);
  });

  it('leaves a golden unowned rather than inventing an owner for it', () => {
    // `-1` rather than `null` or `undefined`, because a caller iterating the array is asking one question per golden and
    // a sentinel that widens the element type would make every caller handle two shapes of absence.
    expect(goldenOwners([[0, 1]], 3)).toEqual([0, -1, -1]);
  });

  it('ignores a golden index that is outside the corpus', () => {
    // **The judge is a model, and a model that answers with an index the corpus does not have is a pair that must be
    // dropped rather than an error** - the alternative is a run that dies on a hallucinated coordinate after the money
    // has been spent.
    expect(goldenOwners([[-1, 3]], 2)).toEqual([-1, -1]);
  });

  it('is the same matching `matchedGoldenIndices` returns, walk for walk', () => {
    const matches = [[0, 1], [1, 2], [2]];
    const owned = goldenOwners(matches, 3)
      .map((owner, at) => (owner === -1 ? -1 : at))
      .filter((at) => at !== -1);
    expect(owned).toEqual(matchedGoldenIndices(matches, 3));
  });

  it('returns one slot per golden for an empty ranking', () => {
    expect(goldenOwners([], 2)).toEqual([-1, -1]);
  });
});

// ---------------------------------------------------------------------------
// topKCurve and scoreSubset
// ---------------------------------------------------------------------------

describe('topKCurve', () => {
  it('produces one point per finding, and its k matches the prefix length', () => {
    const curve = topKCurve([[0], [1], [2]], 4);
    expect(curve.map((p) => p.k)).toEqual([1, 2, 3]);
    expect(curve[2]).toMatchObject({
      truePositives: 3,
      falsePositives: 0,
      falseNegatives: 1,
      recall: 0.75,
    });
  });

  it('shows precision falling while recall rises when the tail is wrong', () => {
    const curve = topKCurve([[0], [1], [], [], []], 2);
    expect(curve[0]?.precision).toBe(1);
    expect(curve[4]?.precision).toBe(0.4);
    expect(curve[4]?.recall).toBe(1);
  });

  it('returns an empty curve for an empty ranking', () => {
    expect(topKCurve([], 5)).toEqual([]);
  });

  it('does not let a later finding claim a golden an earlier one already covers', () => {
    const curve = topKCurve([[0], [0], [1]], 2);
    expect(curve[1]).toMatchObject({ truePositives: 1, falsePositives: 1 });
  });
});

describe('scoreSubset', () => {
  it('scores a filter rather than a prefix', () => {
    const subset = scoreSubset([[0], [1], []], [true, false, true], 2);
    expect(subset).toMatchObject({ k: 2, truePositives: 1, falsePositives: 1, falseNegatives: 1 });
  });

  it('frees a golden when the finding holding it is dropped', () => {
    // Dropping the first finding lets the second claim golden 0, so the covered count does not fall.
    const subset = scoreSubset([[0], [0]], [false, true], 1);
    expect(subset.truePositives).toBe(1);
  });

  it('scores an empty subset as zero findings against the whole ground truth', () => {
    expect(scoreSubset([[0]], [false], 3)).toMatchObject({
      k: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 3,
      f1: 0,
    });
  });
});

describe('point', () => {
  it('computes f1 from precision and recall rather than from a separate formula path', () => {
    expect(point(1, 1, 1, 1)).toMatchObject({ precision: 0.5, recall: 0.5, f1: 0.5 });
  });

  it('reports zero rather than NaN when there is nothing to divide', () => {
    expect(point(0, 0, 0, 0)).toEqual({
      k: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 0,
      recall: 0,
      f1: 0,
    });
  });
});
