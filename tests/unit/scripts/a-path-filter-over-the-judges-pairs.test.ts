// @code-analyzer/code-analyzer — what a path filter over the judge's pairs costs, before one is registered
//
// **The device this file guards is the one that looked free.** The judge is called once per `(finding, golden)` pair, and
// a filter that skips the pairs whose paths differ looks like it removes most of a bill without touching a verdict. §118
// measured it: 87 % of the pairs and 0.0431 of F1, so the filter is a loss and not a saving. That verdict is only worth
// anything if the arithmetic behind it cannot drift, which needs three properties held by test rather than by paragraph.
//
// **The indexing.** `matchedGoldens` holds indices into the pull request's **note-filtered** golden list. Reading
// `comments` instead shifts every index by the number of empty notes before it, and the shift does not make the table
// fail to add up - it makes it add up around the wrong goldens. The fixture puts an empty note *first* so that the two
// readings disagree, and the test requires the filtered one.
//
// **The two columns are two different claims.** `filtered` keeps the artifact's own emission and asks the judge fewer
// questions; `gated` changes the emission, which no product can do because every rule reads the golden's path. A row
// whose two columns were computed from the same expression would report a product feature that does not exist.
//
// **A filter cannot raise the emission count.** Whatever a rule keeps, it cannot admit a finding the shipped cuts
// dropped - and that is asserted at every rule rather than at the strictest one.

import { describe, expect, it } from 'vitest';

import { NO_FILTER, PAIR_RULES, pairAnatomy } from '../../../scripts/lib/judge-pair-anatomy.mjs';

/** A finding in the shape the anatomy reads. */
function finding(overrides: Record<string, unknown> = {}) {
  return {
    pr: 'p1',
    path: 'src/x.ts',
    category: 'bug',
    score: 0.5,
    matchedGoldens: [] as number[],
    ...overrides,
  };
}

/**
 * **An artifact and a corpus whose index 0 is not the first comment.** The first comment has an empty note, so the
 * golden list after the filter starts at the second comment - and a reader that indexed `comments` would credit
 * `src/IGNORED.ts` where this one credits `src/core/x.ts`.
 *
 * **The paths are three segments deep on purpose.** A rule that compares the top two segments is indistinguishable from
 * `same path` on a two-segment tree, so a shallower fixture would report the rules as non-monotone when they are not.
 */
function fixture(overrides: Record<string, unknown> = {}) {
  const corpus = [
    {
      githubPrUrl: 'p1',
      comments: [
        { note: '', path: 'src/IGNORED.ts' },
        { note: 'the first real issue', path: 'src/core/x.ts' },
        { note: 'the second real issue', path: 'src/core/sub/y.ts' },
      ],
    },
  ];
  const bench = {
    rankedFindings: [
      // Same path as golden 0, which the filter kept and `comments` would not have.
      finding({ path: 'src/core/x.ts', matchedGoldens: [0] }),
      // Same directory as golden 1.
      finding({ path: 'src/core/sub/z.ts', matchedGoldens: [1] }),
      // One directory above golden 1: kept by the loose rules, not by `same directory`.
      finding({ path: 'src/core/other/w.ts', matchedGoldens: [1] }),
      // Same top two segments, different directory, credited against nothing.
      finding({ path: 'src/api/k.ts', matchedGoldens: [] }),
      // Forced out by every rule but the control.
      finding({ path: 'docs/readme.md', matchedGoldens: [] }),
    ],
    fullEmission: { truePositives: 2, falseNegatives: 1 },
    // No `emissionRules`, so the shipped emission is the full one and the two columns differ only by the rule.
    spend: { judge: { calls: 9 } },
    ...overrides,
  };
  return { bench, corpus };
}

const rowNamed = (anatomy: ReturnType<typeof pairAnatomy>, name: string) => {
  const row = anatomy.rows.find((entry) => entry.name === name);
  if (row === undefined) throw new Error(`no row named ${name}`);
  return row;
};

describe('the golden indices are the note-filtered ones', () => {
  it('credits the golden the artifact credited, not the comment at that offset', () => {
    const { bench, corpus } = fixture();
    const anatomy = pairAnatomy(bench, corpus);

    // Five findings and two goldens, so ten pairs - and the empty note is not one of them.
    expect(anatomy.allPairs).toBe(10);
    expect(anatomy.goldens).toBe(3);
    // A cross-file credit survives the control: the same-path reading would have found 1.
    expect(anatomy.rows[0]?.filtered.truePositives).toBe(2);
  });

  it('counts a finding whose pull request the corpus does not carry as a finding with no pairs', () => {
    const { bench, corpus } = fixture();
    const withOrphan = {
      ...bench,
      rankedFindings: [...bench.rankedFindings, finding({ pr: 'p9', path: 'src/x.ts' })],
    };
    const anatomy = pairAnatomy(withOrphan, corpus);

    // The orphan contributes no pair, and it does not shift the goldens of the pull request that is present.
    expect(anatomy.allPairs).toBe(10);
    expect(anatomy.rows[0]?.filtered.truePositives).toBe(2);
  });
});

describe('a path filter cannot raise what a review earns', () => {
  it('drops the cross-file credit at every rule stricter than the control', () => {
    const { bench, corpus } = fixture();
    const anatomy = pairAnatomy(bench, corpus);

    // The control keeps both credits...
    expect(rowNamed(anatomy, 'no filter').filtered.truePositives).toBe(2);
    // ...and `src/z.ts` matching `src/y.ts` is the one a same-path rule removes.
    const samePath = rowNamed(anatomy, 'same path');
    expect(samePath.filtered.truePositives).toBe(1);
    expect(samePath.deltaFiltered).toBeLessThan(0);
  });

  it('keeps fewer pairs as the rule gets stricter, never more', () => {
    const { bench, corpus } = fixture();
    const anatomy = pairAnatomy(bench, corpus);

    const pairs = [
      'no filter',
      'same top segment',
      'same top two segments',
      'same directory or one inside the other',
      'same directory',
      'same path',
    ].map((name) => rowNamed(anatomy, name).pairs);

    for (let at = 1; at < pairs.length; at += 1) {
      expect(pairs[at]).toBeLessThanOrEqual(pairs[at - 1] as number);
    }
    // And the control is the whole pool, so the last row is a proper subset of it rather than a second measurement.
    expect(pairs[0]).toBe(anatomy.allPairs);
  });

  it('cannot emit more findings than the full pool, at any rule', () => {
    const { bench, corpus } = fixture();
    const anatomy = pairAnatomy(bench, corpus);

    for (const row of anatomy.rows) {
      expect(row.gated.emitted).toBeLessThanOrEqual(anatomy.full.emitted);
      expect(row.filtered.emitted).toBe(anatomy.shipped.emitted);
    }
  });
});

describe('the two columns price two different claims', () => {
  it('leaves the emission alone in the filtered column and changes it in the gated one', () => {
    const { bench, corpus } = fixture();
    const anatomy = pairAnatomy(bench, corpus);

    // `docs/readme.md` has no pair under `same top segment` either - different top segment from `src/` - so the gate
    // removes it and the filter does not.
    const topSegment = rowNamed(anatomy, 'same top segment');
    expect(topSegment.filtered.emitted).toBe(5);
    expect(topSegment.gated.emitted).toBe(4);
  });

  it('reports the control row as the artifact itself, not as a rule that happens to match everything', () => {
    const { bench, corpus } = fixture();
    const anatomy = pairAnatomy(bench, corpus);
    const control = rowNamed(anatomy, 'no filter');

    expect(control.filtered.f1).toBeCloseTo(anatomy.shipped.f1, 12);
    expect(control.survival).toBe(1);
    // The gate at the control removes only findings that had no pair at all - there are none here.
    expect(control.gated.emitted).toBe(anatomy.full.emitted);
  });

  it('prices each rule against the shipped point rather than against the row above it', () => {
    const { bench, corpus } = fixture();
    const anatomy = pairAnatomy(bench, corpus);

    for (const row of anatomy.rows) {
      expect(row.deltaFiltered).toBeCloseTo(row.filtered.f1 - anatomy.shipped.f1, 12);
      expect(row.deltaGated).toBeCloseTo(row.gated.f1 - anatomy.shipped.f1, 12);
    }
  });
});

describe('the rule list is the one a reader is told it is', () => {
  it('is ordered from the control to the strictest, and every rule is a narrowing of the one before it', () => {
    // A path is matched by every rule, a path in the same directory by every rule but `same path`, and so on - asserted
    // on the rules themselves rather than through an artifact.
    const x = 'src/core/x.ts';
    const sibling = 'src/core/y.ts';
    const cousin = 'src/other/y.ts';
    const stranger = 'docs/y.ts';

    for (const rule of PAIR_RULES) {
      expect(rule.matches(x, x)).toBe(true);
    }
    expect(NO_FILTER.matches(x, stranger)).toBe(true);

    const samePath = PAIR_RULES[0];
    const sameDir = PAIR_RULES[1];
    const sameTop = PAIR_RULES.at(-1);
    if (samePath === undefined || sameDir === undefined || sameTop === undefined) {
      throw new Error('the rule list changed shape');
    }

    expect(samePath.matches(x, sibling)).toBe(false);
    expect(sameDir.matches(x, sibling)).toBe(true);
    expect(sameDir.matches(x, cousin)).toBe(false);
    expect(sameTop.matches(x, cousin)).toBe(true);
    expect(sameTop.matches(x, stranger)).toBe(false);
  });
});
