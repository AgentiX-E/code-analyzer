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
    stratified: [{ label: '0-50 files', attempted: 2, measured: 2, map: 0.4, bm25: 0.22 }],
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
});
