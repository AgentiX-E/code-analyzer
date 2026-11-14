// **The benchmark's own arithmetic, and the reason it is not the arithmetic this repository was already doing.**
//
// `Alibaba-Aone/aacr-bench` publishes a metric whose matching procedure is file-level: reference and generated comments
// are grouped by normalised path, the judge is shown *all* of a file's reference comments in one call, and **one
// generated comment may cover several reference comments**. Precision then counts only a comment that covered at least
// one *previously uncovered* reference comment (`hit_new_gt`), walking the generated comments in generation order.
// `docs/metrics.md` of that corpus records the per-comment pairwise protocol - path, then side, then a line-distance
// gate, then one judge call per pair, one-to-one consumption - as deprecated, `--use-deprecated-score` only.
//
// **This repository was computing the deprecated one.** Its matrix is pairwise and its score is a maximum matching, so
// **a comment that states a defect three human reviewers each restated counts once here and three times there**, and
// the figures it publishes are not the figures the corpus defines. That is a measurement defect that no prompt can
// repair, and it was invisible for as long as it was because the number moved when the reviewer moved.
//
// **What these tests hold is the arithmetic, not the verdicts.** The verdicts still come from a pairwise judge - the
// judge is a paid call and its replacement is a separate decision - so the function below takes the matrix that judge
// already produced and applies the corpus's rules to it. **The one place where that is stricter than the protocol it
// imitates is a cross-file verdict**: a pairwise judge can accept a comment on `a.ts` as describing an issue on `b.ts`,
// and the file-level protocol cannot produce that answer at all, so the arithmetic refuses it rather than banking it.
// Refusing a verdict the real protocol could not have reached makes these figures a lower bound on the corpus's, which
// is the only direction a self-report may err in.

import { describe, expect, it } from 'vitest';

import type { Finding, Golden } from '../../../.github/scripts/lib/file-semantic.mjs';
import {
  FILE_SEMANTIC_PROTOCOL,
  groupByPath,
  scoreCorpusFileSemantic,
  scoreFileSemantic,
} from '../../../.github/scripts/lib/file-semantic.mjs';

/** A corpus row, in the shape `attributeGoldens` already reads: a path, a note, and sometimes a line. */
function golden(path: string, note: string, startLine: number | null = null): Golden {
  return { path, note, startLine };
}

/** A finding, in the shape the ranked list already carries. */
function finding(path: string, text: string): Finding {
  return { path, text };
}

describe('the file-level semantic score', () => {
  it('names the protocol it implements, so an artifact cannot be compared with one from another', () => {
    // **`adjudicate: true` was not a device and neither is `f1: 0.1947`.** A figure without the procedure that produced
    // it is a figure two runs can exchange while differing in the arithmetic, which is what §46 exists to stop.
    expect(FILE_SEMANTIC_PROTOCOL).toBe('file-level-semantic-v1');
  });

  it('lets one comment cover several reference comments, which is the whole difference', () => {
    // Three reviewers restating one defect is one of the commonest shapes in a hand-annotated corpus, and the maximum
    // matching this repository used before scored it 1 of 3.
    const score = scoreFileSemantic({
      findings: [finding('src/a.cpp', 'the guard reads past the end of the buffer')],
      goldens: [
        golden('src/a.cpp', 'reads past the end'),
        golden('src/a.cpp', 'off-by-one in the guard'),
        golden('src/a.cpp', 'no bounds check here'),
      ],
      matches: [[0, 1, 2]],
    });

    expect(score.coveredGoldens).toBe(3);
    expect(score.recall).toBe(1);
    // **And one comment counts once in the precision numerator**, because precision is a statement about comments.
    expect(score.hitNewGt).toBe(1);
    expect(score.precision).toBe(1);
  });

  it('counts a comment that only re-covers an already covered reference comment as a miss', () => {
    // `hit_new_gt` is false for it, and the corpus's own definition puts it in the denominator and not the numerator.
    // **A duplicate hit is not a free comment** - it is the same cost to precision as a wrong one - so the greedy walk
    // must never credit a second comment for the same golden.
    const score = scoreFileSemantic({
      findings: [
        finding('src/a.cpp', 'first restatement'),
        finding('src/a.cpp', 'second restatement'),
        finding('src/a.cpp', 'a different defect'),
      ],
      goldens: [golden('src/a.cpp', 'one'), golden('src/a.cpp', 'two')],
      matches: [[0], [0], [1]],
    });

    expect(score.hitNewGt).toBe(2);
    expect(score.duplicateHits).toBe(1);
    expect(score.precision).toBeCloseTo(2 / 3, 10);
    expect(score.coveredGoldens).toBe(2);
    expect(score.recall).toBe(1);
  });

  it('walks in generation order, because that is the order the reviewer chose', () => {
    // **Same two comments, same verdicts, different order, different precision.** The broad comment covers both
    // reference comments; the narrow one covers only the second. Emitted first, the broad one takes both and the narrow
    // one buys nothing (`hit_new_gt` false, so it costs precision); emitted second, both buy a new one.
    //
    // The protocol fixes the order rather than maximising over it, and the reason is that **the order is a fact about
    // the reviewer**: a scorer that searched the permutation would report a number no run produced.
    const goldens = [golden('src/a.ts', 'g0'), golden('src/a.ts', 'g1')];
    const broad = finding('src/a.ts', 'the guard reads past the end');
    const narrow = finding('src/a.ts', 'off-by-one');

    const broadFirst = scoreFileSemantic({
      findings: [broad, narrow],
      goldens,
      matches: [[0, 1], [1]],
    });
    const narrowFirst = scoreFileSemantic({
      findings: [narrow, broad],
      goldens,
      matches: [[1], [0, 1]],
    });

    expect(broadFirst.hitNewGt).toBe(1);
    expect(broadFirst.precision).toBe(0.5);
    expect(narrowFirst.hitNewGt).toBe(2);
    expect(narrowFirst.precision).toBe(1);
    expect(broadFirst.recall).toBe(1);
    expect(narrowFirst.recall).toBe(1);
  });

  it('refuses a verdict the file-level protocol could not have produced', () => {
    // A pairwise judge is shown one golden and one comment and no path, so it can say "these describe the same defect"
    // about two files. **The protocol it is standing in for groups by file and cannot.** Banking that verdict would
    // report a recall the real evaluator will not reproduce, so it is dropped - and the comment still costs precision,
    // because the corpus counts every generated comment.
    const score = scoreFileSemantic({
      findings: [finding('src/a.ts', 'a comment on a'), finding('src/a.ts', 'another on a')],
      goldens: [golden('src/b.ts', 'an issue on b')],
      matches: [[0], []],
    });

    expect(score.coveredGoldens).toBe(0);
    expect(score.recall).toBe(0);
    expect(score.hitNewGt).toBe(0);
    expect(score.crossFileVerdicts).toBe(1);
    expect(score.precision).toBe(0);
  });

  it('charges a comment on a file with no reference comments to precision and to nothing else', () => {
    // The corpus's `generated_notes` is every comment the reviewer emitted, so **silence on a goldless file is free and
    // speech on it is not** - which is the arithmetic behind "volume is not free" and the reason a run cannot buy
    // recall by commenting everywhere.
    const score = scoreFileSemantic({
      findings: [
        finding('src/a.ts', 'a hit'),
        finding('src/empty.ts', 'noise'),
        finding('src/a.ts', 'more'),
      ],
      goldens: [golden('src/a.ts', 'the issue')],
      matches: [[0], [], []],
    });

    expect(score.findings).toBe(3);
    expect(score.hitNewGt).toBe(1);
    expect(score.precision).toBeCloseTo(1 / 3, 10);
  });

  it('keeps a reference comment with no path in the denominator, because the corpus counts it', () => {
    // `expected_notes` is every reference comment with non-empty text. A row the corpus did not locate is still a row a
    // reviewer was supposed to find, so dropping it from the denominator would report a recall nobody can reach. It
    // lands in its own group, which no generated comment is in, and it is counted as missed.
    const score = scoreFileSemantic({
      findings: [finding('src/a.ts', 'the one we found')],
      goldens: [golden('src/a.ts', 'found'), golden('', 'unlocated')],
      matches: [[0], []],
    });

    expect(score.goldens).toBe(2);
    expect(score.coveredGoldens).toBe(1);
    expect(score.recall).toBe(0.5);
  });

  it('is zero rather than not-a-number when there is nothing to score', () => {
    // A run that reviewed nothing and a run that found nothing are different facts, and both have to print. **A NaN
    // propagates into an average and turns a report into a table of NaNs**, which is how one empty arm erases a corpus.
    const none = scoreFileSemantic({ findings: [], goldens: [], matches: [] });
    expect(none.precision).toBe(0);
    expect(none.recall).toBe(0);
    expect(none.f1).toBe(0);

    const goldensOnly = scoreFileSemantic({
      findings: [],
      goldens: [golden('src/a.ts', 'missed')],
      matches: [],
    });
    expect(goldensOnly.precision).toBe(0);
    expect(goldensOnly.recall).toBe(0);
    expect(goldensOnly.f1).toBe(0);

    const findingsOnly = scoreFileSemantic({
      findings: [finding('src/a.ts', 'noise')],
      goldens: [],
      matches: [[]],
    });
    expect(findingsOnly.precision).toBe(0);
    expect(findingsOnly.recall).toBe(0);
  });

  it('treats the same file written with a diff prefix as the same file', () => {
    // The engine's paths come from a diff and the corpus's come from an annotation, and `a/src/x.ts` is not a different
    // file from `src/x.ts`. **A grouping that thinks it is would report every golden on every file as missed**, which is
    // the same defect `normalisePath` was added to `golden-attribution` for.
    const score = scoreFileSemantic({
      findings: [finding('a/src/x.ts', 'the guard')],
      goldens: [golden('src/x.ts', 'reads past the end')],
      matches: [[0]],
    });

    expect(score.coveredGoldens).toBe(1);
    expect(score.recall).toBe(1);
  });

  it('reports the harmonic mean, and only the harmonic mean', () => {
    // 2 of 4 goldens and 2 of 8 comments: 0.5 and 0.25, harmonic 1/3. **Written out because an averaged pair of rates is
    // the commonest arithmetic error in a report of this shape**, and it flatters a lopsided arm.
    const score = scoreFileSemantic({
      findings: Array.from({ length: 8 }, (_, at) => finding('src/a.ts', `c${String(at)}`)),
      goldens: Array.from({ length: 4 }, (_, at) => golden('src/a.ts', `g${String(at)}`)),
      matches: [[0], [1], [], [], [], [], [], []],
    });

    expect(score.precision).toBe(0.25);
    expect(score.recall).toBe(0.5);
    expect(score.f1).toBeCloseTo(1 / 3, 10);
  });

  it('groups each file once, in the order the comments arrived', () => {
    // The judge is shown a file's reference comments as one numbered list, so the grouping is what the protocol is built
    // on: **a call per comment and a list per file**, and a comment that appears twice on one file must not create two
    // lists.
    const grouped = groupByPath({
      findings: [finding('src/a.ts', 'x'), finding('src/b.ts', 'y'), finding('src/a.ts', 'z')],
      goldens: [golden('src/a.ts', 'g1'), golden('src/a.ts', 'g2')],
    });

    expect([...grouped.keys()]).toEqual(['src/a.ts', 'src/b.ts']);
    expect(grouped.get('src/a.ts')?.findings.map((entry) => entry.text)).toEqual(['x', 'z']);
    expect(grouped.get('src/a.ts')?.goldens.map((entry) => entry.note)).toEqual(['g1', 'g2']);
    expect(grouped.get('src/b.ts')?.goldens).toEqual([]);
  });

  it('is a lower bound on the corpus figure rather than a substitute for it', () => {
    // **The judge here is still pairwise.** Applying their arithmetic to our verdicts removes one of the two
    // differences and leaves the other, so the figure is comparable in one direction only - and saying so in the code
    // is cheaper than one run spent discovering it. The protocol string carries the difference so an artifact cannot be
    // mistaken for an official score.
    const score = scoreFileSemantic({
      findings: [finding('src/a.ts', 'the guard')],
      goldens: [golden('src/a.ts', 'reads past the end')],
      matches: [[0]],
    });

    expect(score.protocol).toBe(FILE_SEMANTIC_PROTOCOL);
    expect(score.judge).toBe('pairwise-over-numbered-list');
  });
});

describe('an unknown coordinate is not an accusation', () => {
  it('accepts a verdict about a reference comment whose path was never stored', () => {
    // The recorded competitor rows carry golden **indices** and no paths, because the run that bought them stored the
    // count and not the coordinates. **Refusing those verdicts would charge the competitor for this repository's own
    // omission**, and a comparison in which one arm is punished for the other arm's missing field is not a comparison.
    const score = scoreFileSemantic({
      findings: [finding('src/a.ts', 'the guard reads past the end')],
      goldens: [{ path: '', note: 'reads past the end', startLine: null }],
      matches: [[0]],
    });

    expect(score.coveredGoldens).toBe(1);
    expect(score.crossFileVerdicts).toBe(0);
    expect(score.unlocatedGoldens).toBe(1);
  });

  it('still refuses one when both paths are known', () => {
    // **The loosening is scoped to the missing field and not to the rule**, or the repair would be a way to bank every
    // cross-file verdict in the run that needed it least.
    const score = scoreFileSemantic({
      findings: [finding('src/a.ts', 'a comment on a')],
      goldens: [golden('src/b.ts', 'an issue on b')],
      matches: [[0]],
    });

    expect(score.coveredGoldens).toBe(0);
    expect(score.crossFileVerdicts).toBe(1);
    expect(score.unlocatedGoldens).toBe(0);
  });
});

describe('the corpus figure', () => {
  it('adds the counts and divides, rather than averaging the rates', () => {
    // **The failure this test exists for is the one that flatters a small pull request.** A pull request with two
    // reference comments and one with six must not contribute equally: the corpus's own definition is a ratio of
    // totals, so a mean of two rates is a different number and a wrong one.
    const small = {
      findings: [finding('src/a.ts', 'hit')],
      goldens: [golden('src/a.ts', 'g0'), golden('src/a.ts', 'g1')],
      matches: [[0]],
    };
    const large = {
      findings: [finding('src/b.ts', 'noise'), finding('src/b.ts', 'noise')],
      goldens: [
        golden('src/b.ts', 'g0'),
        golden('src/b.ts', 'g1'),
        golden('src/b.ts', 'g2'),
        golden('src/b.ts', 'g3'),
        golden('src/b.ts', 'g4'),
        golden('src/b.ts', 'g5'),
      ],
      matches: [[], []],
    };

    const corpus = scoreCorpusFileSemantic({ pulls: [small, large] });

    expect(corpus.hitNewGt).toBe(1);
    expect(corpus.findings).toBe(3);
    expect(corpus.coveredGoldens).toBe(1);
    expect(corpus.goldens).toBe(8);
    // 1/3 and 1/8, not (1 + 0) / 2.
    expect(corpus.precision).toBeCloseTo(1 / 3, 10);
    expect(corpus.recall).toBeCloseTo(1 / 8, 10);
    // And no key is lost in the addition: the counters travel with the rate.
    expect(corpus.crossFileVerdicts).toBe(0);
    expect(corpus.unlocatedGoldens).toBe(0);
  });
});
