// **A table that decomposes a figure has to add up to it, and until iteration 124 nothing checked that it did.**
//
// The artifact publishes one true-positive count and three ways of slicing it. Before this file the slices were:
//
//   1. five examples per attribution bucket, out of a hundred and sixty-nine misses - so the one analysis three stage
//      pages asked for, *read the goldens both reviewers missed*, could not be done from the file;
//   2. no per-category reading at all, so `maintainability` was discussed in prose rather than measured;
//   3. no list of the goldens neither reviewer found, which is the ceiling on the whole exercise.
//
// All three exist now, and the failure mode they introduce is quiet: **a breakdown computed by a second rule can disagree
// with the figure it decomposes while both numbers are individually plausible**. The first draft of the category table
// counted findings that matched a golden, which reported 73 where the run scored 39 - because a golden mentioned by three
// lanes is one true positive and three matched findings. This file is what makes that class of error fail loudly.

import { describe, expect, it } from 'vitest';

import {
  auditArtifact,
  competitorTextCoverage,
  formatAudit,
  formatBothMissed,
  summariseBothMissed,
} from '../../../scripts/lib/artifact-audit.mjs';

/** An artifact whose every layer agrees, so that each test can break exactly one thing. */
function consistentArtifact() {
  const rows = [
    { category: 'bug', emitted: 10, truePositives: 4, falsePositives: 6, precision: 0.4 },
    { category: 'test', emitted: 5, truePositives: 0, falsePositives: 5, precision: 0 },
  ];
  return {
    truePositives: 4,
    falsePositives: 11,
    falseNegatives: 6,
    f1: (2 * 4) / (2 * 4 + 11 + 6),
    missedGoldens: {
      total: 6,
      counts: {
        hit: 4,
        noPath: 0,
        fileNotReviewed: 1,
        noFindingOnPath: 0,
        findingOnPathRejected: 1,
      },
      records: [
        {
          pr: 'p',
          goldenIndex: 0,
          bucket: 'hit',
          path: 'a.ts',
          note: '',
          proximity: null,
          nearestFinding: null,
        },
        {
          pr: 'p',
          goldenIndex: 1,
          bucket: 'hit',
          path: 'a.ts',
          note: '',
          proximity: null,
          nearestFinding: null,
        },
        {
          pr: 'p',
          goldenIndex: 2,
          bucket: 'hit',
          path: 'a.ts',
          note: '',
          proximity: null,
          nearestFinding: null,
        },
        {
          pr: 'p',
          goldenIndex: 3,
          bucket: 'hit',
          path: 'a.ts',
          note: '',
          proximity: null,
          nearestFinding: null,
        },
        {
          pr: 'p',
          goldenIndex: 4,
          bucket: 'fileNotReviewed',
          path: 'b.ts',
          note: '',
          proximity: null,
          nearestFinding: null,
        },
        {
          pr: 'p',
          goldenIndex: 5,
          bucket: 'findingOnPathRejected',
          path: 'c.ts',
          note: '',
          proximity: 3,
          nearestFinding: {
            at: 0,
            startLine: 8,
            endLine: 9,
            actionable: true,
            why: ['grounded'],
            text: 'what we said :: instead',
          },
        },
      ],
    },
    byCategory: {
      rows,
      totals: { attributedTruePositives: 4, reportedTruePositives: 4, agrees: true },
    },
    bothMissed: [
      {
        pr: 'p',
        goldenIndex: 9,
        path: 'd.ts',
        note: 'nobody said this',
        ourBucket: 'noFindingOnPath',
      },
    ],
    bothMissedCorpus: { pullRequests: 1, goldens: 10, withoutAttribution: 0 },
    secondReviewer: {
      mode: 'record',
      prsAttempted: 3,
      prsFailed: 1,
      recorded: 2,
      replayed: 0,
      missing: [],
      failedPullRequests: [{ key: 'k', goldens: 1, reason: 'it produced nothing', stage: 'run' }],
      findingsAtItsOwnOperatingPoint: [{ text: 'what they said' }],
    },
  };
}

/** The audit's verdict on one artifact, as the names of the checks that failed. */
function failuresOf(artifact: ReturnType<typeof consistentArtifact>): string[] {
  return auditArtifact(artifact)
    .findings.filter((finding) => !finding.ok)
    .map((finding) => finding.name);
}

describe('an artifact whose detail layers agree', () => {
  it('passes every check', () => {
    const audit = auditArtifact(consistentArtifact());
    expect(failuresOf(consistentArtifact())).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it('says so in one line per check, because a log is the audit rather than a summary of it', () => {
    const audit = auditArtifact(consistentArtifact());
    const text = formatAudit(audit);
    // **One line per check, derived rather than restated**: a hard-coded count is a test that has to be edited whenever
    // a check is added, which is a test people edit to make it pass.
    expect(text.split('\n')).toHaveLength(audit.findings.length);
    expect(audit.findings.every((finding) => finding.ok)).toBe(true);
    expect(text).toContain('ok   byCategory is a decomposition, not a sample');
  });
});

describe('a detail list that is not the list', () => {
  it('fails when records are fewer than the partition they claim to be', () => {
    const artifact = consistentArtifact();
    artifact.missedGoldens.records = artifact.missedGoldens.records.slice(0, 3);
    // **This is the defect the field was added to repair**: five examples per bucket is exactly this shape, and it is
    // what made a three-iteration-old next step impossible to take.
    expect(failuresOf(artifact)).toContain('missedGoldens.records is the whole table');
  });

  it('fails when the records partition into different buckets than the table publishes', () => {
    const artifact = consistentArtifact();
    artifact.missedGoldens.records[0]!.bucket = 'noFindingOnPath';
    // **Two writers of one table is how a table drifts from itself**, and the counts are what every other document
    // quotes - so the records disagreeing with them means one of the two is about a different run.
    expect(failuresOf(artifact)).toContain(
      'missedGoldens.records partitions into missedGoldens.counts',
    );
  });
});

describe('a decomposition that does not add up', () => {
  it('fails when the category rows sum to more than the run scored', () => {
    const artifact = consistentArtifact();
    // The exact error the first draft made: counting findings that matched something rather than goldens that were
    // owned, which counts one golden once per mention.
    artifact.byCategory.rows = [
      { category: 'bug', emitted: 10, truePositives: 7, falsePositives: 3, precision: 0.7 },
      { category: 'test', emitted: 5, truePositives: 2, falsePositives: 3, precision: 0.4 },
    ];
    expect(failuresOf(artifact)).toContain('byCategory rows sum to the run’s true positives');
  });

  it('fails when a row does not subtract its own false positives', () => {
    const artifact = consistentArtifact();
    artifact.byCategory.rows[0]!.falsePositives = 99;
    expect(failuresOf(artifact)).toContain(
      'every byCategory row subtracts its own false positives',
    );
  });

  it('fails when the run itself reported the two walks as disagreeing', () => {
    const artifact = consistentArtifact();
    artifact.byCategory.totals = {
      attributedTruePositives: 4,
      reportedTruePositives: 4,
      agrees: false,
    };
    // **The artifact's own check is believed even when the arithmetic here would pass**, because the two are counted
    // over different objects: this file sums published rows, and the run counted owned goldens.
    expect(failuresOf(artifact)).toContain('byCategory is a decomposition, not a sample');
  });
});

describe('the ceiling has a denominator', () => {
  it('fails when the list cannot exceed the corpus it was drawn from', () => {
    const artifact = consistentArtifact();
    artifact.bothMissedCorpus.goldens = 0;
    expect(failuresOf(artifact)).toContain('bothMissed cannot exceed the corpus it was drawn from');
  });

  it('fails when the ceiling contains a golden our own attribution calls a hit', () => {
    // **The first version of `bothMissed` had exactly this defect**: it read our coverage through the maximum matching,
    // and a golden we demonstrably commented on was reported as a golden nobody found because a different finding of ours
    // owned it. On a 258-golden slice the difference was 20.
    const artifact = consistentArtifact();
    artifact.bothMissed = [
      { pr: 'p', goldenIndex: 1, path: 'a.ts', note: 'we found this', ourBucket: 'hit' },
    ];
    expect(failuresOf(artifact)).toContain('the ceiling holds no golden either side found');
  });

  it('fails when there is no list at all', () => {
    const artifact = consistentArtifact();
    delete (artifact as { bothMissed?: unknown }).bothMissed;
    const failures = failuresOf(artifact);
    expect(failures).toContain('bothMissed names its corpus');
    expect(failures).toContain('bothMissed cannot exceed the corpus it was drawn from');
  });
});

describe('the score from its own four counts', () => {
  it('fails when F1 does not follow from TP, FP and FN', () => {
    const artifact = consistentArtifact();
    artifact.f1 = 0.9;
    expect(failuresOf(artifact)).toContain('precision, recall and F1 follow from TP, FP and FN');
  });

  it('accepts a run that found nothing without dividing by zero', () => {
    const artifact = consistentArtifact();
    artifact.truePositives = 0;
    artifact.byCategory = {
      rows: [],
      totals: { attributedTruePositives: 0, reportedTruePositives: 0, agrees: true },
    };
    artifact.f1 = 0;
    const failures = failuresOf(artifact);
    // **An empty table is a different failure from a wrong one**, and the honest reading of "no rows" is that the
    // decomposition was not produced - not that F1 is wrong.
    expect(failures).toContain('byCategory is a decomposition, not a sample');
    expect(failures).not.toContain('precision, recall and F1 follow from TP, FP and FN');
  });
});

describe('the ceiling, grouped rather than listed', () => {
  /** An artifact whose ceiling is three rows with a deliberate tie, so the ordering rule is exercised. */
  function withCeiling(rows: readonly Record<string, unknown>[]) {
    return { ...consistentArtifact(), bothMissed: rows };
  }

  it('counts the rows by the bucket our own attribution put them in', () => {
    // **This is the column that decides the next device.** A ceiling of `fileNotReviewed` is an input defect; the same
    // number of `findingOnPathRejected` is a targeting defect; a single total hides both.
    const summary = summariseBothMissed(
      withCeiling([
        { pr: 'p1', path: 'src/a/one.ts', ourBucket: 'noFindingOnPath' },
        { pr: 'p1', path: 'src/a/two.ts', ourBucket: 'noFindingOnPath' },
        { pr: 'p2', path: 'lib/b.ts', ourBucket: 'findingOnPathRejected' },
      ]),
    );
    expect(summary.total).toBe(3);
    expect(summary.byOurBucket).toEqual([
      { name: 'noFindingOnPath', count: 2 },
      { name: 'findingOnPathRejected', count: 1 },
    ]);
  });

  it('groups a path by its first two segments, because a leaf directory is not a table row', () => {
    const summary = summariseBothMissed(
      withCeiling([
        { pr: 'p', path: 'internal/checker/ast.go', ourBucket: 'hit' },
        { pr: 'p', path: 'internal/checker/expr.go', ourBucket: 'hit' },
        { pr: 'p', path: 'src/main/java/A.java', ourBucket: 'hit' },
      ]),
    );
    expect(summary.byDirectory).toEqual([
      { name: 'internal/checker', count: 2 },
      { name: 'src/main', count: 1 },
    ]);
  });

  it('counts by pull request and names a tie by name rather than by insertion order', () => {
    // **A table read twice may not name two different first rows**, which is the same rule `largestBucket` follows.
    const summary = summariseBothMissed(
      withCeiling([
        { pr: 'https://github.com/b/b/pull/2', path: 'x/y.ts', ourBucket: 'hit' },
        { pr: 'https://github.com/a/a/pull/1', path: 'x/y.ts', ourBucket: 'hit' },
      ]),
    );
    expect(summary.byPullRequest.map((row) => row.name)).toEqual([
      'https://github.com/a/a/pull/1',
      'https://github.com/b/b/pull/2',
    ]);
  });

  it('says nothing rather than zero when the artifact carries no ceiling', () => {
    const summary = summariseBothMissed({});
    expect(summary.total).toBe(0);
    expect(summary.corpus).toBeNull();
    // **A missing list and an empty list both print zero, and the sentence around it is what distinguishes them** - which
    // is why the command exits non-zero when it was asked for the ceiling by name.
    expect(formatBothMissed(summary)).toContain('does not say which corpus');
  });

  it('prints the corpus the list was drawn from beside the list', () => {
    const text = formatBothMissed(
      summariseBothMissed(withCeiling([{ pr: 'p', path: 'a/b.ts', ourBucket: 'hit' }])),
    );
    expect(text.split('\n')[0]).toContain('goldens neither reviewer found: 1');
  });
});

describe('the competitor’s words', () => {
  /** An artifact with two competitor rows, `withText` of them carrying a sentence. */
  const withTheirs = (mode: string, withText: number) => ({
    secondReviewer: {
      mode,
      findingsAtItsOwnOperatingPoint: [
        { path: 'a.ts', startLine: 1, ...(withText > 0 ? { text: 'their first remark' } : {}) },
        { path: 'b.ts', startLine: 2, ...(withText > 1 ? { text: 'their second remark' } : {}) },
      ],
    },
  });

  it('counts the rows that carry a sentence rather than the rows that exist', () => {
    const coverage = competitorTextCoverage(withTheirs('record', 1));
    expect(coverage.rows).toBe(2);
    expect(coverage.withText).toBe(1);
    expect(coverage.coverage).toBe(0.5);
  });

  it('fails a recording run that paid for the output and kept only its coordinates', () => {
    // **This is the exact shape of the baseline that shipped**: 23 rows per pull request, nine fields each, none of
    // them the remark. A comparison that keeps where a comment landed and not what it said cannot be learned from.
    const artifact = { ...consistentArtifact(), ...withTheirs('record', 0) };
    expect(competitorTextCoverage(artifact).mustBeComplete).toBe(true);
    expect(failuresOf(artifact as unknown as ReturnType<typeof consistentArtifact>)).toContain(
      'the competitor’s remarks are readable beside ours',
    );
  });

  it('accepts a replay against a baseline recorded before the field existed', () => {
    // **A replay cannot have what the baseline does not**, and failing it would fail every run until somebody spends
    // 5.89 USD on a new recording - which is a decision a person makes, not a check.
    const artifact = { ...consistentArtifact(), ...withTheirs('replay', 0) };
    expect(competitorTextCoverage(artifact).mustBeComplete).toBe(false);
    expect(failuresOf(artifact as unknown as ReturnType<typeof consistentArtifact>)).not.toContain(
      'the competitor’s remarks are readable beside ours',
    );
  });

  it('says the artifact has no competitor rows rather than reporting perfect coverage', () => {
    // **Zero of zero is not full coverage.** A run with the competitor arm switched off must not read as complete.
    const coverage = competitorTextCoverage({ secondReviewer: { mode: 'replay' } });
    expect(coverage.rows).toBe(0);
    expect(coverage.coverage).toBe(0);
  });
});

describe('a rejection that names its distance and not its finding', () => {
  it('fails when a rejected golden does not carry the finding it was measured against', () => {
    // **The state of the artifact before this iteration**: `findingOnPathRejected` was the largest bucket in the
    // ceiling and the only thing a row said about it was how far away the nearest finding was. 100 of the 164 sat on the
    // golden's own line, and which finding that was - and whether the actionability gate kept it - could not be read
    // without paying for another run.
    const artifact = consistentArtifact();
    const rejected = artifact.missedGoldens.records.find(
      (row) => row.bucket === 'findingOnPathRejected',
    ) as { nearestFinding: unknown };
    rejected.nearestFinding = null;
    expect(failuresOf(artifact)).toContain('every rejected golden names the finding it rejected');
  });

  it('counts the rejections that sit on a finding’s own line', () => {
    const artifact = consistentArtifact();
    const rejected = artifact.missedGoldens.records.find(
      (row) => row.bucket === 'findingOnPathRejected',
    ) as { proximity: number | null };
    rejected.proximity = 0;
    const detail = auditArtifact(artifact).findings.find(
      (finding) => finding.name === 'the rejections with a finding on their line are counted',
    );
    // **The figure the next device is chosen from**, so it is published rather than left to be recomputed by hand.
    expect(detail?.detail).toContain('1 of 1 rejections');
  });
});

describe('every attempt at the competitor arm is accounted for', () => {
  it('fails when an attempt is neither recorded, replayed, failed nor missing', () => {
    // **The run of 2026-11-11 reported `prsAttempted: 36`, `prsFailed: 4`, `recorded: 32` and named one failure.**
    // Four failures, one name: the three that were only counted contributed no goldens to the competitor's denominator
    // while contributing nothing to its numerator either - the same asymmetry that was worth 0.0130 of F1 when it
    // happened at the other failure branch, surviving in a second code path.
    const artifact = consistentArtifact();
    artifact.secondReviewer.prsAttempted = 4;
    expect(failuresOf(artifact)).toContain(
      'every attempted competitor run is either recorded, replayed, failed or missing',
    );
  });

  it('fails when the failures that were counted are not the failures that were named', () => {
    const artifact = consistentArtifact();
    artifact.secondReviewer.prsFailed = 2;
    expect(failuresOf(artifact)).toContain(
      'the failures that were counted are the failures that were named',
    );
  });

  it('accepts a run that attempted nothing, rather than claiming a partition of zero', () => {
    const artifact = consistentArtifact();
    artifact.secondReviewer.prsAttempted = 0;
    artifact.secondReviewer.recorded = 0;
    artifact.secondReviewer.prsFailed = 0;
    artifact.secondReviewer.failedPullRequests = [];
    const failures = failuresOf(artifact);
    expect(failures).not.toContain(
      'every attempted competitor run is either recorded, replayed, failed or missing',
    );
    expect(failures).not.toContain(
      'the failures that were counted are the failures that were named',
    );
  });
});
