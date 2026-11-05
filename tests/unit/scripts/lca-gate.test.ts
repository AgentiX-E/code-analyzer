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
        controlMap: 0.21,
        oursPairedRows: 2,
        oursPaired: 0.4,
        // **Deliberately different from `controlMap`**, so a gate that subtracted the wrong one fails here rather than
        // in a published artifact: 0.22 is the control's mean over the rows it was paired on, 0.21 over every row it
        // scored, and only the first is the term that `delta` is measured against.
        pairedControl: 0.22,
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
        controlMap: 0.24,
        oursPairedRows: 2,
        oursPaired: 0.4,
        pairedControl: 0.25,
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
    // **The fallback, whose denominator is the run.** `coverage.rows` equals the instances that had an answer space to
    // rank, so `overall` is a mean over the protocol rather than over the part of it that fitted - and `pairedVsOurs`
    // is the mechanism test over the rows both instruments ranked, which is the same intersection as `paired`.
    fallback: {
      name: 'path + imports (file level)',
      configuration: { document: 'the path followed by the module names of its import statements' },
      coverage: { rows: 3, attempted: 3, share: 1, importLines: 12 },
      overall: { value: 0.3, rows: 3 },
      byLanguage: { kt: { attempted: 3, value: 0.3, rows: 3 } },
      pairedVsControl: {
        bm25: { rows: 3, ours: 0.3, control: 0.2, delta: 0.1 },
        tfidf: { rows: 3, ours: 0.3, control: 0.21, delta: 0.09 },
      },
      pairedVsOurs: { rows: 2, ours: 0.3, control: 0.4, delta: -0.1 },
    },
    // **Every band carries a paired object with its own row count**, so the reader cannot subtract our mean over the
    // measured rows from the control's over the whole band - the subtraction that published a 0.0037 Java win.
    stratified: [
      {
        label: '0-50 files',
        attempted: 2,
        measured: 2,
        ours: 0.4,
        bm25: 0.22,
        bm25Rows: 2,
        tfidf: 0.25,
        tfidfRows: 2,
        vsBm25: { rows: 2, ours: 0.4, control: 0.22, delta: 0.18 },
        vsTfidf: { rows: 2, ours: 0.4, control: 0.25, delta: 0.15 },
        fallback: 0.35,
        fallbackRows: 2,
      },
      {
        label: '2000+ files',
        attempted: 1,
        measured: 0,
        ours: null,
        bm25: 0.11,
        bm25Rows: 1,
        tfidf: 0.12,
        tfidfRows: 1,
        vsBm25: { rows: 0, ours: null, control: null, delta: null },
        vsTfidf: { rows: 0, ours: null, control: null, delta: null },
        fallback: 0.2,
        fallbackRows: 1,
      },
    ],
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
        corpusFiles: 20,
        skipped: null,
        map: 0.5,
        answerRank: 1,
        bm25Map: 0.3,
        fallbackMap: 0.4,
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
        corpusFiles: 30,
        skipped: null,
        map: 0.3,
        answerRank: 3,
        bm25Map: 0.14,
        fallbackMap: 0.2,
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
        corpusFiles: 4_970,
        skipped: 'the checkout holds 4970 files, above the stated cap of 2000',
        map: 0,
        answerRank: null,
        bm25Map: 0.11,
        fallbackMap: 0.2,
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

  it('refuses a record whose fallback is silent about the document it ranks', () => {
    // **A fallback described as "path and imports" without saying what a document is is a name rather than a method.**
    // Its configuration is what makes the two words a claim, and the block is required for the same reason the controls'
    // configuration is: a figure whose method is unstated cannot be reproduced from the artifact.
    const run = runGate(
      mutated((record) => {
        delete (record['fallback'] as Record<string, unknown>)['configuration'];
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('fallback: absent, empty, or silent about the document');
  });

  it('refuses a fallback whose mean is over fewer rows than it claims to cover', () => {
    // **The one column whose denominator is the run.** A mean over 2 of 3 attempted instances published beside a
    // coverage of 3 is a favourable subset wearing the name of a mean over the protocol - exactly the defect the
    // fallback exists to remove, reintroduced inside the fallback's own block.
    const run = runGate(
      mutated((record) => {
        (record['fallback'] as Record<string, unknown>)['overall'] = { value: 0.4, rows: 2 };
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('a mean over fewer rows than it claims is a favourable subset');
  });

  it('refuses a row that had an answer space and produced no fallback figure', () => {
    // **Per row, because a mean does not show a hole.** A refused instance is precisely the row a fallback exists for,
    // so an instance with files but no fallback figure is the coverage claim failing where it matters most.
    const run = runGate(
      mutated((record) => {
        const rowsList = record['rows'] as Record<string, unknown>[];
        delete rowsList[2]!['fallbackMap'];
        (record['fallback'] as Record<string, unknown>)['coverage'] = {
          rows: 2,
          attempted: 3,
          share: 2 / 3,
          importLines: 12,
        };
        (record['fallback'] as Record<string, unknown>)['overall'] = { value: 0.3, rows: 2 };
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('had an answer space and no fallback figure');
  });

  it('refuses a band whose delta is not the difference of the means beside it', () => {
    // **The band table is where the wrong subtraction looked most innocent**, because the two numbers sit in one row
    // and the bands are what a reader uses to decide whether the sample is easier. The delta is computed by the merge
    // and checked here against the two means printed next to it.
    const run = runGate(
      mutated((record) => {
        const bands = record['stratified'] as Record<string, unknown>[];
        (bands[0]!['vsBm25'] as Record<string, unknown>)['delta'] = 0.5;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('is not ours minus control on the paired rows');
  });

  it('refuses a band whose control ran on fewer rows than the band measured', () => {
    // **A control that skipped a measured instance is the bias the control exists to remove**, one band at a time: the
    // instances it would skip are the hard ones, and the band's delta would then be computed over the easy remainder.
    const run = runGate(
      mutated((record) => {
        const bands = record['stratified'] as Record<string, unknown>[];
        (bands[0]!['vsBm25'] as Record<string, unknown>)['rows'] = 1;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('a row the band dropped');
  });

  it('refuses a mechanism test over a different intersection than the pairing', () => {
    const run = runGate(
      mutated((record) => {
        (record['fallback'] as Record<string, unknown>)['pairedVsOurs'] = {
          rows: 3,
          ours: 0.3,
          control: 0.4,
          delta: -0.1,
        };
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      'the mechanism test has to be over the instances both instruments ranked',
    );
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
