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
    // **The corpus this run scored**, which is the denominator the attempt partition is checked against - not
    // `prsAttempted`, which counts only the pull requests the run went and bought.
    prsInDataset: 3,
    secondReviewer: {
      mode: 'record',
      prsAttempted: 3,
      prsFailed: 1,
      recorded: 2,
      replayed: 0,
      missing: [],
      failedPullRequests: [{ key: 'k', goldens: 1, reason: 'it produced nothing', stage: 'run' }],
      // **Widened, because the tests below replace it with rows that carry coordinates and may or may not carry a
      // sentence** - the shape the artifact actually publishes.
      findingsAtItsOwnOperatingPoint: [{ text: 'what they said' }] as Array<{
        path?: string;
        startLine?: number;
        text?: string;
      }>,
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

  it('accepts an empty table when nothing reached the gated point, and refuses one when something did', () => {
    // **The run of `43162733527` is the case.** The reading agent's three findings were all below the actionability
    // gate, so the gated set was empty and its decomposition was empty - and this check failed a run whose artifact was
    // correct, in the job whose output is the only reason the run was dispatched.
    const empty = consistentArtifact();
    empty.truePositives = 0;
    empty.falsePositives = 0;
    empty.falseNegatives = 282;
    empty.byCategory = {
      rows: [],
      totals: { attributedTruePositives: 0, reportedTruePositives: 0, agrees: true },
    };
    expect(failuresOf(empty)).not.toContain('byCategory is a decomposition, not a sample');
    expect(failuresOf(empty)).not.toContain('every byCategory row subtracts its own false positives');

    // **And the check still bites**: a run that scored four true positives and published no rows is the quiet
    // inconsistency this file exists for.
    const scored = consistentArtifact();
    scored.byCategory.rows = [];
    expect(failuresOf(scored)).toContain('byCategory is a decomposition, not a sample');
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
      // **What the run paid for**, so that `mustBeComplete` is decided on the rows a recording run recorded rather than
      // on the rows a replay handed it.
      recorded: mode === 'record' ? 2 : 0,
      replayed: mode === 'record' ? 0 : 2,
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

describe('every scored pull request is accounted for', () => {
  it('fails when a scored pull request is neither replayed, recorded, failed nor missing', () => {
    // **The run of 2026-11-11 reported `prsFailed: 4`, `recorded: 32` and named one failure.** Four failures, one name:
    // the three that were only counted contributed no goldens to the competitor's denominator while contributing nothing
    // to its numerator either - the same asymmetry that was worth 0.0130 of F1 when it happened at the other failure
    // branch, surviving in a second code path. Against that run the check reads **33 accounted for of 36 scored**.
    const artifact = consistentArtifact();
    artifact.prsInDataset = 4;
    expect(failuresOf(artifact)).toContain(
      'every scored pull request is either replayed, recorded, failed or missing',
    );
  });

  it('fails when the failures that were counted are not the failures that were named', () => {
    const artifact = consistentArtifact();
    artifact.secondReviewer.prsFailed = 2;
    expect(failuresOf(artifact)).toContain(
      'the failures that were counted are the failures that were named',
    );
  });

  it('accepts a run with no corpus, rather than claiming a partition of zero', () => {
    const artifact = consistentArtifact();
    artifact.prsInDataset = 0;
    artifact.secondReviewer.recorded = 0;
    artifact.secondReviewer.replayed = 0;
    artifact.secondReviewer.prsFailed = 0;
    artifact.secondReviewer.failedPullRequests = [];
    const failures = failuresOf(artifact);
    expect(failures).not.toContain(
      'every scored pull request is either replayed, recorded, failed or missing',
    );
    expect(failures).not.toContain(
      'the failures that were counted are the failures that were named',
    );
  });
});

describe('a recording run that replayed most of its rows', () => {
  it('is not failed for the rows it did not pay for', () => {
    // **The run of 2026-11-12 was failed by this check while being entirely correct.** Its record predates the `text`
    // field, so it replayed thirty-two rows and bought one, and `1 of 282 competitor rows carry text` was the arithmetic
    // of the mechanism working. The flag now asks whether a recording run kept *any* of the words it paid for.
    const artifact = consistentArtifact();
    artifact.secondReviewer = {
      mode: 'record',
      recorded: 1,
      replayed: 32,
      prsAttempted: 4,
      prsFailed: 3,
      missing: [],
      failedPullRequests: [
        { key: 'a', goldens: 5, reason: 'it produced nothing', stage: 'run' },
        { key: 'b', goldens: 5, reason: 'it produced nothing', stage: 'run' },
        { key: 'c', goldens: 6, reason: 'it produced nothing', stage: 'run' },
      ],
      findingsAtItsOwnOperatingPoint: [
        { path: 'a.ts', startLine: 1, text: 'the one row this run bought' },
        { path: 'b.ts', startLine: 2 },
        { path: 'c.ts', startLine: 3 },
        { path: 'd.ts', startLine: 4 },
      ],
    };
    // **Thirty-six pull requests scored**: thirty-two replayed, one recorded, three failed.
    artifact.prsInDataset = 36;
    expect(competitorTextCoverage(artifact).mustBeComplete).toBe(false);
    // **And the partition still holds on that shape**: one recorded, three failed, against four scored.
    expect(failuresOf(artifact)).toEqual([]);
  });

  it('is failed when it kept none of the words it paid for', () => {
    const artifact = consistentArtifact();
    artifact.secondReviewer = {
      mode: 'record',
      recorded: 2,
      replayed: 0,
      prsAttempted: 2,
      prsFailed: 0,
      missing: [],
      failedPullRequests: [],
      findingsAtItsOwnOperatingPoint: [{ path: 'a.ts', startLine: 1 }],
    };
    artifact.prsInDataset = 2;
    // **Both rows recorded and neither carrying a sentence**, which is the state a `record` run must not publish.
    expect(failuresOf(artifact)).toContain('the competitor’s remarks are readable beside ours');
  });
});

describe('an arm that is switched off', () => {
  it('is not asked to account for rows it never had', () => {
    const artifact = consistentArtifact();
    artifact.secondReviewer = {
      mode: 'off',
      recorded: 0,
      replayed: 0,
      prsAttempted: 0,
      prsFailed: 0,
      missing: [],
      failedPullRequests: [],
      findingsAtItsOwnOperatingPoint: [],
    };
    artifact.prsInDataset = 36;
    const failures = failuresOf(artifact);
    expect(failures).not.toContain(
      'every scored pull request is either replayed, recorded, failed or missing',
    );
    expect(failures).not.toContain('the arm that is switched off runs nothing');
  });

  it('fails when the switched-off arm spent money anyway', () => {
    // **The `on` arm of 2026-11-12 published exactly this**: `mode: "off"` beside `prsAttempted: 36` and 258 competitor
    // rows, because the decision chain fell through to the live branch for the one mode whose purpose is to remove the
    // arm. **A switched-off arm that spent money is worse than a missing one**, and the two fields have to be read
    // together to see it.
    const artifact = consistentArtifact();
    artifact.secondReviewer = {
      mode: 'off',
      recorded: 0,
      replayed: 0,
      prsAttempted: 36,
      prsFailed: 5,
      missing: [],
      failedPullRequests: Array.from({ length: 5 }, (_, at) => ({
        key: `k${String(at)}`,
        goldens: 1,
        reason: 'it produced nothing',
        stage: 'run',
      })),
      findingsAtItsOwnOperatingPoint: [{ path: 'a.ts', startLine: 1, text: 'they said this' }],
    };
    artifact.prsInDataset = 36;
    expect(failuresOf(artifact)).toContain('the arm that is switched off runs nothing');
  });
});
