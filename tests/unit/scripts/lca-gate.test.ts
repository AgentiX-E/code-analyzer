/**
 * Contract tests for the bug-localisation gate.
 *
 * **Iteration 71 added two things to this gate that are not floors.** The published figure is now accompanied by the
 * sample it was computed over and by a control that ran on the instances it was not computed over, and both of those
 * can be present-but-wrong in ways no floor would catch: an `attempted` that does not equal `measured` plus `refused` is
 * a row nobody counted, a control over fewer rows than were measured is a comparison over a different sample, and a
 * paired count below the measured count means the hardest instances quietly left the difference.
 *
 * **So each case here doctors exactly one of those and asserts the gate refuses it**, and the first case asserts the
 * whole record passes - because a gate that fails on everything is as useless as one that passes on nothing.
 *
 * The gate is run as a child process, so what is under test is the command the workflow runs rather than a helper the
 * tests can reach into.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const GATE = resolve(process.cwd(), 'scripts/lca-gate.js');

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/** A record in which every figure the gate reads is present and above its floor. **The baseline the cases mutate.** */
function baseRecord(): Record<string, unknown> {
  return {
    dataset: { name: 'JetBrains-Research/lca-bug-localization' },
    measuredAt: '2026-11-05',
    space: { semantic: false, reason: 'the retrieval arm is lexical by definition' },
    overall: {
      rows: 3,
      planned: 50,
      measured: 2,
      skipped: 1,
      retrieval: {
        at1: { recall: 0.3, precision: 0.4, f1: 0.3, fpr: 0.01 },
        at3: { recall: 0.4, precision: 0.3, f1: 0.3, fpr: 0.02 },
        at5: { recall: 0.45, precision: 0.25, f1: 0.3, fpr: 0.03 },
        at10: { recall: 0.5, precision: 0.2, f1: 0.28, fpr: 0.05 },
      },
      map: { rows: 2, value: 0.4 },
      answer: null,
    },
    costModel: {
      recommended: {
        rows: 3,
        predictor: 'graphNodes',
        interceptMb: 349,
        mbPerByte: 0.00003,
        meanResidualMb: 306,
        maxResidualMb: 1_398,
        mbPerFile: { min: 1.3, median: 8, max: 430 },
        r2: 0.814,
        constantR2: -0.393,
      },
    },
    sample: {
      planned: 50,
      attempted: 3,
      measured: 2,
      refused: 1,
      unreached: 47,
      ofAttempted: 2 / 3,
      ofPlanned: 2 / 50,
      worstCaseMap: 0.2667,
      standardised: { value: 0.31, raw: 0.4, coveredShare: 0.6 },
      refusals: [
        { because: 'the checkout holds 4970 files, above the stated cap of 2000', count: 1 },
      ],
    },
    baseline: {
      name: 'BM25',
      overall: { rows: 3, map: 0.22, oursPaired: 0.4, oursPairedRows: 2 },
      byLanguage: {
        kt: { rows: 2, map: 0.22, ours: 0.4, delta: 0.18 },
      },
    },
    diagnosis: {
      rows: 2,
      oursFound: 2,
      controlFound: 2,
      oursFirst: 1,
      controlFirst: 2,
      oursMedian: 2,
      controlMedian: 1,
    },
    paired: {
      rows: 2,
      wins: 2,
      losses: 0,
      ties: 0,
      meanDelta: 0.18,
      lower: 0.05,
      upper: 0.31,
      pValue: 0.5,
    },
    // **The second control, over the same rows as the first.** Added in iteration 75: the shipped reading was chosen
    // against BM25, so an artifact that only ever measured that one comparator cannot say whether the gap is a property
    // of lexical retrieval or of the formula the decision was tuned against.
    crossCheck: {
      name: 'TF-IDF (cosine)',
      configuration: {
        termFrequency: 'sublinear: 1 + ln(tf)',
        inverseDocumentFrequency: 'smoothed: ln((1 + N) / (1 + df)) + 1',
      },
      overall: { rows: 3, map: 0.25, oursPaired: 0.4, oursPairedRows: 2 },
      byLanguage: { kt: { rows: 2, map: 0.25, ours: 0.4, delta: 0.15 } },
      paired: {
        rows: 2,
        wins: 2,
        losses: 0,
        ties: 0,
        meanDelta: 0.15,
        lower: 0.02,
        upper: 0.28,
        pValue: 0.5,
      },
    },
    controlSummary: [
      {
        name: 'BM25',
        controlRows: 3,
        controlMap: 0.22,
        oursPairedRows: 2,
        oursPaired: 0.4,
        pairedRows: 2,
        delta: 0.18,
        lower: 0.05,
        upper: 0.31,
        pValue: 0.5,
        wins: 2,
        losses: 0,
        ties: 0,
      },
      {
        name: 'TF-IDF (cosine)',
        controlRows: 3,
        controlMap: 0.25,
        oursPairedRows: 2,
        oursPaired: 0.4,
        pairedRows: 2,
        delta: 0.15,
        lower: 0.02,
        upper: 0.28,
        pValue: 0.5,
        wins: 2,
        losses: 0,
        ties: 0,
      },
    ],
    stratified: [{ label: '0-50 files', attempted: 2, measured: 2, map: 0.4, bm25: 0.22 }],
    // **The armature, with two measured rows behind it.** The shipped arm repeats each row's own figures, which is
    // what the gate checks per row: an armature that collapsed the pool would have five arms that all agree with each
    // other and none of them with the product, and the equality below is what tells the two apart.
    fileRanking: {
      shipped: 'max',
      arms: [arm('max', 0, 0, 0, 1), arm('sum', 0.05, 1, 1, 2), arm('top2', -0.05, 0, 1, 1)],
    },
    rows: [
      {
        config: 'kt',
        id: 1,
        repo: 'owner/one',
        skipped: null,
        map: 0.5,
        answerRank: 1,
        bm25Map: 0.3,
        tfidfMap: 0.35,
        fileArms: [
          { aggregation: 'max', map: 0.5, answerRank: 1 },
          { aggregation: 'sum', map: 0.6, answerRank: 1 },
          { aggregation: 'top2', map: 0.45, answerRank: 1 },
        ],
      },
      {
        config: 'kt',
        id: 2,
        repo: 'owner/two',
        skipped: null,
        map: 0.3,
        answerRank: 3,
        bm25Map: 0.14,
        tfidfMap: 0.15,
        fileArms: [
          { aggregation: 'max', map: 0.3, answerRank: 3 },
          { aggregation: 'sum', map: 0.2, answerRank: 4 },
          { aggregation: 'top2', map: 0.25, answerRank: 3 },
        ],
      },
      {
        config: 'kt',
        id: 3,
        repo: 'owner/three',
        skipped: 'the checkout holds 4970 files, above the stated cap of 2000',
        map: 0,
        answerRank: null,
        bm25Map: 0.11,
        tfidfMap: 0.12,
        fileArms: null,
      },
    ],
  };
}

/** One published arm. **The shipped one is compared with itself, so its three counts are a tie per row.** */
function arm(
  aggregation: string,
  delta: number,
  wins: number,
  losses: number,
  firstPlaced: number,
): Record<string, unknown> {
  return {
    aggregation,
    rows: 2,
    map: 0.4 + delta,
    control: 0.4,
    delta,
    wins,
    losses,
    ties: 2 - wins - losses,
    lower: delta - 0.05,
    upper: delta + 0.05,
    pValue: 1,
    firstPlaced,
    found: 2,
  };
}

function runGate(record: unknown): Run {
  const dir = mkdtempSync(join(tmpdir(), 'lca-gate-'));
  const file = join(dir, 'lca-bug-localization.json');
  writeFileSync(file, JSON.stringify(record));
  try {
    const stdout = execFileSync('node', [GATE, '--file', file], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/** Apply one mutation to a fresh copy of the baseline record. */
function mutated(change: (record: Record<string, unknown>) => void): Record<string, unknown> {
  const record = baseRecord();
  change(record);
  return record;
}

describe('lca gate', () => {
  it('passes a record whose sample, control and pairing all add up', () => {
    const run = runGate(baseRecord());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('sample');
    expect(run.stdout).toContain('paired vs BM25');
    expect(run.stdout).toContain('file aggregation: max (shipped)');
    expect(run.stdout).toContain('file aggregation: sum');
  });

  it('refuses an armature that is not comparing against the product', () => {
    // **The shipped arm's own delta is zero or the instrument is broken.** A non-zero value there means the armature
    // and the product disagree about what the product does, and every other arm in the block is then a difference
    // against a rule nobody ships.
    const run = runGate(
      mutated((record) => {
        const arms = (record['fileRanking'] as Record<string, unknown>)['arms'] as Record<
          string,
          unknown
        >[];
        arms[0]!['delta'] = 0.02;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('compared with itself');
  });

  it('refuses an armature whose shipped aggregation is not among its arms', () => {
    const run = runGate(
      mutated((record) => {
        (record['fileRanking'] as Record<string, unknown>)['shipped'] = 'median';
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('not among the arms');
  });

  it('refuses an armature whose shipped arm disagrees with a row of the product', () => {
    // **The check a mean cannot make.** Five arms that all read a collapsed pool agree with each other and disagree
    // with the column the product published; the per-row equality is what separates a measurement from a wiring bug.
    const run = runGate(
      mutated((record) => {
        const rows = record['rows'] as Record<string, unknown>[];
        const arms = rows[1]!['fileArms'] as Record<string, unknown>[];
        arms[0]!['map'] = 0.31;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('not reading the pool');
  });

  it('refuses an armature that skipped a measured instance', () => {
    const run = runGate(
      mutated((record) => {
        const rows = record['rows'] as Record<string, unknown>[];
        rows[1]!['fileArms'] = null;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('skipped silently');
  });

  it('refuses a record with no armature at all', () => {
    const run = runGate(
      mutated((record) => {
        delete record['fileRanking'];
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('fileRanking');
  });

  it('refuses a record whose attempted count is not measured plus refused', () => {
    // **A gap here is a row nobody counted**, and a figure over a denominator nobody can reconstruct is a figure that
    // cannot be checked - which is the defect the whole sample block exists to close.
    const run = runGate(
      mutated((record) => {
        (record['sample'] as Record<string, unknown>)['refused'] = 5;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('attempted');
  });

  it('refuses a control that scored fewer rows than were measured', () => {
    const run = runGate(
      mutated((record) => {
        (record['baseline'] as Record<string, unknown>)['overall'] = { rows: 1, map: 0.2 };
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('baseline');
  });

  it('refuses a paired comparison that dropped a measured instance', () => {
    // **The failure mode the control was built to remove.** A difference over the instances that happened to be easy to
    // pair is the same bias as a mean over the instances that happened to be easy to run.
    const run = runGate(
      mutated((record) => {
        (record['paired'] as Record<string, unknown>)['rows'] = 1;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('paired');
  });

  it('refuses a per-language delta that is not the difference of the two means beside it', () => {
    // **The defect of iteration 71 stated as an invariant.** The Java leg printed a 0.0037 win because our mean and the
    // control's were averaged over different rows; a reader subtracts what is on the line, so the line has to add up.
    const run = runGate(
      mutated((record) => {
        const languages = (record['baseline'] as Record<string, unknown>)['byLanguage'] as Record<
          string,
          Record<string, unknown>
        >;
        languages['kt']!['delta'] = 0.01;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('byLanguage');
  });

  it('refuses a rank diagnosis computed over more rows than the pairing', () => {
    // **Two figures about the same instances have to be about the same instances.** The diagnosis says which defect a
    // low MAP means, and one computed over a wider sample would be describing a different one.
    const run = runGate(
      mutated((record) => {
        (record['diagnosis'] as Record<string, unknown>)['rows'] = 3;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('diagnosis');
  });

  it('refuses a diagnosis that found the answer in more rows than exist', () => {
    const run = runGate(
      mutated((record) => {
        (record['diagnosis'] as Record<string, unknown>)['oursFound'] = 9;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('diagnosis');
  });

  it('refuses a record with no stratification', () => {
    const run = runGate(
      mutated((record) => {
        record['stratified'] = [];
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('stratified');
  });

  it('refuses a record whose sample block is absent entirely', () => {
    const run = runGate(
      mutated((record) => {
        delete record['sample'];
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('sample');
  });

  it('refuses a planned count below the attempted count', () => {
    const run = runGate(
      mutated((record) => {
        (record['sample'] as Record<string, unknown>)['planned'] = 1;
      }),
    );
    expect(run.status).toBe(1);
  });

  it('refuses a run that saw none of the protocol', () => {
    const run = runGate(
      mutated((record) => {
        (record['sample'] as Record<string, unknown>)['ofPlanned'] = 0;
      }),
    );
    expect(run.status).toBe(1);
  });

  it('still refuses a record with no measured instance', () => {
    // **A mean over none is not a figure**, and this case predates the sample block - it is here so that the new
    // invariants cannot be satisfied by a record that measured nothing.
    const run = runGate(
      mutated((record) => {
        (record['overall'] as Record<string, unknown>)['measured'] = 0;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('mean over none');
  });

  it('still refuses a figure below its floor', () => {
    const run = runGate(
      mutated((record) => {
        (record['overall'] as Record<string, unknown>)['map'] = { rows: 2, value: 0 };
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('map');
  });

  // **The second control, and the four ways it can be present without being a control.** A paired difference against
  // one comparator is a difference that can be a fit to it, so the artifact carries a second scorer over the identical
  // index - and each of these cases is a way for that second scorer to look present and measure nothing.
  it('refuses a record with no second control', () => {
    const run = runGate(
      mutated((record) => {
        delete record['crossCheck'];
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('crossCheck');
  });

  it('refuses a second control that is silent about its weighting', () => {
    const run = runGate(
      mutated((record) => {
        (record['crossCheck'] as Record<string, unknown>)['configuration'] = {};
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('weighting');
  });

  it('refuses a second control paired over a different number of rows', () => {
    const run = runGate(
      mutated((record) => {
        (record['crossCheck'] as Record<string, unknown>)['paired'] = {
          rows: 1,
          wins: 1,
          losses: 0,
          ties: 0,
          meanDelta: 0.15,
          lower: 0.02,
          upper: 0.28,
          pValue: 1,
        };
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('same instances');
  });

  it('refuses a second control that ran on fewer rows than the first', () => {
    const run = runGate(
      mutated((record) => {
        (record['crossCheck'] as Record<string, unknown>)['overall'] = {
          rows: 2,
          map: 0.25,
          oursPaired: 0.4,
          oursPairedRows: 2,
        };
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('did not run everywhere');
  });

  it('refuses a control summary whose delta is not ours minus control', () => {
    const run = runGate(
      mutated((record) => {
        const summary = record['controlSummary'] as Array<Record<string, unknown>>;
        summary[1]!['delta'] = 0.4 - 0.25 + 0.01;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('not ours minus control');
  });

  it('refuses a row that carries a BM25 figure without a TF-IDF one', () => {
    const run = runGate(
      mutated((record) => {
        const rows = record['rows'] as Array<Record<string, unknown>>;
        delete rows[2]!['tfidfMap'];
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('without a TF-IDF');
  });
});
