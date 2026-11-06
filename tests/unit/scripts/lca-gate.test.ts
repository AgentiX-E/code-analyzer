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
    // **The bound the run was admitted under, in the units the memory is paid in.** Added when the admission rule was
    // found charging a per-file rate the run's own regression scores at `R² = -0.02` while publishing a declaration fit
    // at `R² = 0.77` beside it: the gate reads the rule, not only the fit, so the two can no longer disagree.
    fileCap: {
      files: 4_000,
      appliedTo: 'every file in the checkout except .git',
      memory: {
        model: 'declarations',
        mbPerDeclaration: 0.0221,
        fixedMb: 515,
        marginMb: 326,
        declarationsPerFile: 120,
        declarationsAtStart: { kt: 239_954 },
        fileLadder: [
          { declarationsPerFile: 20, files: 11_997 },
          { declarationsPerFile: 60, files: 3_999 },
          { declarationsPerFile: 120, files: 1_999 },
          { declarationsPerFile: 300, files: 799 },
          { declarationsPerFile: 600, files: 399 },
        ],
        mbPerFile: 3.7,
        reserveMb: 1_024,
        budgetFilesAtStart: { kt: 1_999 },
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
      degraded: {
        map: 0.3333,
        rows: 3,
        because: 'a measured row contributes its analysis figure, a refused one this',
      },
      cost: { rows: 3, totalMs: 1_200, meanMs: 400, filesRead: 5_020 },
      byLanguage: { kt: { attempted: 3, value: 0.3, rows: 3 } },
      pairedVsControl: {
        bm25: { rows: 3, ours: 0.3, control: 0.2, delta: 0.1 },
        tfidf: { rows: 3, ours: 0.3, control: 0.21, delta: 0.09 },
      },
      pairedVsOurs: { rows: 2, ours: 0.3, control: 0.4, delta: -0.1 },
    },
    // **The fused column: the product's ranking as it actually returns it.** Two rows ran both arms and one was
    // refused, so the mixture's split is published beside its mean - the defect this block exists to make impossible.
    fusion: {
      name: 'declarations + path/imports (reciprocal rank fusion)',
      configuration: {
        fusion: 'reciprocal rank fusion, unweighted, k = 10',
        arms: ['declarations', 'file-level'],
        k: 10,
      },
      coverage: { rows: 3, attempted: 3, share: 1, fused: 2, declined: 1 },
      overall: { value: 0.3333, rows: 3 },
      byLanguage: { kt: { attempted: 3, fused: 2, value: 0.3333, rows: 3 } },
      pairedVsDeclarations: { rows: 2, ours: 0.4, control: 0.35, delta: 0.05 },
      // **The constant swept, with the shipped rung equal to the fused figure over the measured rows.** The numbers here
      // are the fixture's own: the fused mean over the two measured rows is (0.5 + 0.3) / 2 = 0.4, which is what
      // `pairedVsDeclarations.ours` states, so the shipped rung has to be 0.4 as well.
      byK: [
        {
          k: 3,
          map: 0.37,
          rows: 2,
          vsShipped: { rows: 2, ours: 0.37, control: 0.4, delta: -0.03 },
        },
        {
          k: 5,
          map: 0.39,
          rows: 2,
          vsShipped: { rows: 2, ours: 0.39, control: 0.4, delta: -0.01 },
        },
        { k: 10, map: 0.4, rows: 2, vsShipped: { rows: 2, ours: 0.4, control: 0.4, delta: 0 } },
        {
          k: 30,
          map: 0.41,
          rows: 2,
          vsShipped: { rows: 2, ours: 0.41, control: 0.4, delta: 0.01 },
        },
        {
          k: 60,
          map: 0.42,
          rows: 2,
          vsShipped: { rows: 2, ours: 0.42, control: 0.4, delta: 0.02 },
        },
      ],
      pairedVsControl: {
        bm25: { rows: 3, ours: 0.3333, control: 0.1833, delta: 0.15 },
        tfidf: { rows: 3, ours: 0.3333, control: 0.2067, delta: 0.1267 },
      },
    },
    // **Every band carries a paired object with its own row count**, so the reader cannot subtract our mean over the
    // measured rows from the control's over the whole band - the subtraction that published a 0.0037 Java win.
    stratified: [
      {
        label: '0-50 files',
        attempted: 2,
        measured: 2,
        ours: 0.4,
        declaration: 0.35,
        declarationRows: 2,
        bm25: 0.22,
        bm25Rows: 2,
        tfidf: 0.25,
        tfidfRows: 2,
        vsBm25: { rows: 2, ours: 0.4, control: 0.22, delta: 0.18 },
        vsTfidf: { rows: 2, ours: 0.4, control: 0.25, delta: 0.15 },
        fallback: 0.35,
        fallbackRows: 2,
        fusion: 0.4,
        fusionRows: 2,
      },
      {
        label: '2000+ files',
        attempted: 1,
        measured: 0,
        ours: null,
        declaration: null,
        declarationRows: 0,
        bm25: 0.11,
        bm25Rows: 1,
        tfidf: 0.12,
        tfidfRows: 1,
        vsBm25: { rows: 0, ours: null, control: null, delta: null },
        vsTfidf: { rows: 0, ours: null, control: null, delta: null },
        fallback: 0.2,
        fallbackRows: 1,
        fusion: 0.2,
        fusionRows: 1,
      },
    ],
    // **The armature, with two measured rows behind it.** The shipped arm repeats each row's own figures, which is
    // what the gate checks per row: an armature that collapsed the pool would have five arms that all agree with each
    // other and none of them with the product, and the equality below is what tells the two apart.
    fileRanking: {
      shipped: 'max',
      arms: [
        arm('max', 0, 0, 0, 1, 0.4),
        arm('sum', 0.05, 1, 1, 1, 0.4),
        arm('top2', -0.05, 0, 2, 1, 0.4),
      ],
      poolOnly: [
        arm('max', 0, 0, 0, 2, 0.35),
        arm('sum', 0.05, 1, 1, 1, 0.35),
        arm('top2', 0, 0, 0, 1, 0.35),
      ],
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
        fusionMap: 0.5,
        fusionFused: true,
        declarationMap: 0.4,
        declarationRank: 2,
        fileArms: [
          { aggregation: 'max', map: 0.4, answerRank: 2, fusedMap: 0.5, fusedAnswerRank: 1 },
          { aggregation: 'sum', map: 0.6, answerRank: 1, fusedMap: 0.7, fusedAnswerRank: 1 },
          { aggregation: 'top2', map: 0.45, answerRank: 1, fusedMap: 0.45, fusedAnswerRank: 1 },
        ],
        fusionByK: [
          { k: 3, map: 0.47, rank: 1 },
          { k: 5, map: 0.49, rank: 1 },
          { k: 10, map: 0.5, rank: 1 },
          { k: 30, map: 0.51, rank: 1 },
          { k: 60, map: 0.52, rank: 1 },
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
        fusionMap: 0.3,
        fusionFused: true,
        declarationMap: 0.3,
        declarationRank: 3,
        fileArms: [
          { aggregation: 'max', map: 0.3, answerRank: 3, fusedMap: 0.3, fusedAnswerRank: 3 },
          { aggregation: 'sum', map: 0.2, answerRank: 4, fusedMap: 0.2, fusedAnswerRank: 4 },
          { aggregation: 'top2', map: 0.25, answerRank: 3, fusedMap: 0.25, fusedAnswerRank: 3 },
        ],
        fusionByK: [
          { k: 3, map: 0.27, rank: 3 },
          { k: 5, map: 0.29, rank: 3 },
          { k: 10, map: 0.3, rank: 3 },
          { k: 30, map: 0.31, rank: 3 },
          { k: 60, map: 0.32, rank: 3 },
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
        fusionMap: 0.2,
        fusionFused: false,
        declarationMap: null,
        declarationRank: null,
        fusionByK: [],
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
  control = 0.4,
): Record<string, unknown> {
  return {
    aggregation,
    rows: 2,
    map: control + delta,
    control,
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

  it('**refuses a column that describes itself and not what it cost**', () => {
    // The fallback reads a head per file of every answer space before each child starts, out of the same clock - which
    // is why nine instances of the run that added it were never examined. A block that omits the cost describes a free
    // instrument.
    const run = runGate(
      mutated((record) => {
        delete (record['fallback'] as Record<string, unknown>)['cost'];
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('fallback.cost: absent');
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

  it('**refuses a band that publishes the fusion without the arm it was built from**', () => {
    // The subtraction that published a 0.0022 "cost" on the band the fusion was built for: `ours` is over the band's
    // measured rows and `fusion` over every attempted one, so the difference between them is a denominator. The
    // declaration arm on the same rows is the only partner `ours` has.
    const run = runGate(
      mutated((record) => {
        const strata = record['stratified'] as Array<Record<string, unknown>>;
        delete strata[0]!['declaration'];
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      'the arm `ours` is built from has to be published over the same rows',
    );
  });

  it('refuses a band whose declaration arm ran on fewer rows than the band measured', () => {
    const run = runGate(
      mutated((record) => {
        const strata = record['stratified'] as Array<Record<string, unknown>>;
        strata[0]!['declarationRows'] = 1;
      }),
    );
    expect(run.status).toBe(1);
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
        arms[0]!['fusedMap'] = 0.31;
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

  it('refuses an armature whose pool reading disagrees with the row’s own ablation', () => {
    // **The second equality, and the one iteration 77 needed.** The per-row check used to compare the pool's figures
    // against `map` - which is now the fused figure - so a correct armature failed on 78 rows of a real run. Both
    // readings are compared now, and this case proves the pool side is still checked rather than dropped.
    const run = runGate(
      mutated((record) => {
        const rows = record['rows'] as Record<string, unknown>[];
        const arms = rows[0]!['fileArms'] as Record<string, unknown>[];
        arms[0]!['map'] = 0.44;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('the armature and the ablation are reading different pools');
  });

  it('refuses an armature whose pool ranking leads with a different file than the ablation does', () => {
    // **A mean can be right while the order is wrong**, so the position is checked beside the figure on both readings.
    const run = runGate(
      mutated((record) => {
        const rows = record['rows'] as Record<string, unknown>[];
        const arms = rows[0]!['fileArms'] as Record<string, unknown>[];
        arms[0]!['answerRank'] = 1;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('different pools');
  });

  it('refuses an artifact that publishes one reading of the armature and not the other', () => {
    // **A block that quietly disappeared is a comparison a reader cannot make**: five aggregations fused, five without
    // the fusion, and an artifact holding only one of the two would leave the reader unable to say which figure came
    // from which ranking.
    const run = runGate(
      mutated((record) => {
        delete (record['fileRanking'] as Record<string, unknown>)['poolOnly'];
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('fileRanking.poolOnly');
  });

  it('marks the sample row by its own failures rather than by every failure in the artifact', () => {
    // **The display defect this case freezes.** The sample line printed ✗ whenever anything anywhere had failed, so a
    // run whose arithmetic was exact showed a red row beside `measured + refused = attempted` because the armature had
    // failed - and a reader would have been pointed at the wrong number. The row's ✗ must be about the row's claim.
    const run = runGate(
      mutated((record) => {
        const rows = record['rows'] as Record<string, unknown>[];
        const arms = rows[0]!['fileArms'] as Record<string, unknown>[];
        arms[0]!['fusedMap'] = 0.31;
      }),
    );
    expect(run.status).toBe(1);
    const sampleLine = run.stdout.split('\n').find((line) => line.startsWith('| sample |'));
    expect(sampleLine).toBeDefined();
    expect(sampleLine).toContain('measured + refused = attempted');
    expect(sampleLine?.endsWith('✓ |')).toBe(true);
  });

  it('refuses a record whose shipped constant is not on the ladder', () => {
    // **A sweep that does not contain the product's own value measures four other constants and reports them beside a
    // figure nobody can locate.** The gate requires the shipped constant - 10 since the cross-validation moved it - to
    // be one of the rungs.
    const run = runGate(
      mutated((record) => {
        const fusion = record['fusion'] as Record<string, unknown>;
        fusion['byK'] = (fusion['byK'] as Record<string, unknown>[]).filter(
          (rung) => rung['k'] !== 10,
        );
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('is not on the ladder');
  });

  it('**refuses a ladder that does not bracket the constant it ships**', () => {
    // A one-sided ladder can say that a smaller constant is no worse and cannot say how much worse a larger one is. The
    // first ladder had 10 as its edge rung, which is why the move to 10 arrived without a measurement above it.
    const run = runGate(
      mutated((record) => {
        const fusion = record['fusion'] as Record<string, unknown>;
        fusion['byK'] = (fusion['byK'] as Record<string, unknown>[]).filter(
          (rung) => Number(rung['k']) <= 10,
        );
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('does not bracket the constant it ships');
  });

  it('refuses a ladder of one rung', () => {
    const run = runGate(
      mutated((record) => {
        const fusion = record['fusion'] as Record<string, unknown>;
        fusion['byK'] = (fusion['byK'] as Record<string, unknown>[]).filter(
          (rung) => rung['k'] === 10,
        );
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('a sweep of one constant measures nothing');
  });

  it('refuses a shipped rung that disagrees with the fused figure beside it', () => {
    // **Two names for one number.** The rung at the shipped constant averages the same rows the ablation does, so a
    // disagreement means the ladder was computed over a different ranking than the column.
    const run = runGate(
      mutated((record) => {
        const fusion = record['fusion'] as Record<string, unknown>;
        const rungs = fusion['byK'] as Record<string, unknown>[];
        rungs.find((rung) => rung['k'] === 10)!['map'] = 0.44;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('one number with two names');
  });

  it('refuses a rung compared over a different sample than its own mean', () => {
    const run = runGate(
      mutated((record) => {
        const fusion = record['fusion'] as Record<string, unknown>;
        const rungs = fusion['byK'] as Record<string, unknown>[];
        (rungs.find((rung) => rung['k'] === 30)!['vsShipped'] as Record<string, unknown>)['rows'] =
          1;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('a rung compared over a different sample');
  });

  it('refuses a row whose shipped rung is not the row’s own fused figure', () => {
    const run = runGate(
      mutated((record) => {
        const rows = record['rows'] as Record<string, unknown>[];
        const ladder = rows[0]!['fusionByK'] as Record<string, unknown>[];
        ladder.find((rung) => rung['k'] === 10)!['map'] = 0.49;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('the sweep and the column are two rankings');
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

/**
 * The admission rule, **which the gate now reads rather than trusting**.
 *
 * The iteration that added these cases found the harness refusing instances with `3.7 MB per file` while the same
 * artifact published a regression that scores that rate at `R² = -0.02` - worse than the mean of the sample - beside a
 * declaration fit at `0.77`. **Both numbers were in the artifact and nothing compared them.** Each case below doctors
 * one way that gap can reopen, and the first asserts the record with the corrected rule passes.
 */
describe('lca gate — the admission rule', () => {
  /** Apply one mutation to the memory block of a fresh copy of the baseline. */
  function mutatedMemory(
    change: (memory: Record<string, unknown>) => void,
  ): Record<string, unknown> {
    return mutated((record) => {
      const cap = record['fileCap'] as Record<string, unknown>;
      change(cap['memory'] as Record<string, unknown>);
    });
  }

  it('**passes a record whose bound is charged in the units the run fitted**', () => {
    const run = runGate(baseRecord());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('| admission model | declarations');
  });

  it('**refuses a bound that is still charged per file**', () => {
    // The rule in force before this iteration. A per-file rate is not a model of the work: the sample's own per-file
    // cost spans 1.5 to 2 158.5 MB, so the refusal it produces is a statement about nothing.
    const run = runGate(mutatedMemory((memory) => (memory['model'] = 'files')));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('must be charged at the fitted declaration model');
  });

  it('**refuses a bound whose units are unstated**', () => {
    for (const field of ['mbPerDeclaration', 'fixedMb', 'marginMb', 'declarationsPerFile']) {
      const run = runGate(mutatedMemory((memory) => delete memory[field]));
      expect(run.status, field).toBe(1);
    }
  });

  it('**refuses a ladder that is not a ladder**', () => {
    // Monotone because a denser checkout cannot afford more files at the same ceiling. A ladder whose rungs cross is a
    // table nobody read.
    const run = runGate(
      mutatedMemory((memory) => {
        const ladder = memory['fileLadder'] as Array<Record<string, number>>;
        memory['fileLadder'] = [ladder[0], ladder[2]];
        ladder[1]!['files'] = 99_999;
        memory['fileLadder'] = [ladder[0], ladder[1], ladder[2]];
      }),
    );
    expect(run.status).toBe(1);
  });

  it('**refuses an operating density that is not one of the ladder’s rungs**', () => {
    // A conversion rate nobody published is a number nobody can check, which is the whole reason the ladder is stated.
    const run = runGate(mutatedMemory((memory) => (memory['declarationsPerFile'] = 117.7)));
    expect(run.status).toBe(1);
  });

  it('**refuses a published file bound that is not the rung’s own division**', () => {
    const run = runGate(
      mutatedMemory((memory) => {
        memory['budgetFilesAtStart'] = { kt: 2_038 };
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('divide its published bound consistently');
  });

  it('**refuses a fit that does not beat the rate it replaced**', () => {
    // The invariant the old rule violated: a model no better than the constant it replaces cannot be used to refuse
    // instances, whatever shape it has. The fixture's rate scores -0.393, so a recommendation at -0.5 loses to it.
    const run = runGate(
      mutated((record) => {
        const costModel = record['costModel'] as Record<string, Record<string, unknown>>;
        costModel['recommended']!['r2'] = -0.5;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('beat the per-file rate it replaced');
  });
});

describe('lca gate — the fused column', () => {
  it('**passes a record that publishes the mixture it averaged**', () => {
    const run = runGate(baseRecord());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('fused: declarations + path/imports');
  });

  it('**refuses a fused column that does not name its fusion**, because a name is not a method', () => {
    const run = runGate(
      mutated((record) => {
        delete (record['fusion'] as Record<string, unknown>)['configuration'];
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('fusion: absent, empty, or silent about the arithmetic');
  });

  it('**refuses a mixture whose split does not add up to its rows**', () => {
    // A mean over a mixture that does not publish the mixture is the defect the whole artifact exists to remove: the
    // figure is over rows that ran two arms and rows that ran one, and a reader cannot weigh it without the counts.
    const run = runGate(
      mutated((record) => {
        (record['fusion'] as Record<string, unknown>)['coverage'] = {
          rows: 3,
          attempted: 3,
          share: 1,
          fused: 3,
          declined: 1,
        };
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('a mean over a mixture whose split is not published');
  });

  it('**refuses a row whose fused flag contradicts its skipped sentence**', () => {
    // A refused row cannot claim two arms: the declaration arm *is* the analysis that was refused, so `fused: true` on
    // it is a claim about a ranking that never existed.
    const run = runGate(
      mutated((record) => {
        const rowsList = record['rows'] as Record<string, unknown>[];
        rowsList[2]!['fusionFused'] = true;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('contradicts their skipped sentence');
  });

  it('**refuses a measured row whose fused figure is not the row’s own**', () => {
    // Two processes write this row - the child computes the ranking, the parent transcribes it - so a disagreement
    // means one of them is describing a different run.
    const run = runGate(
      mutated((record) => {
        const rowsList = record['rows'] as Record<string, unknown>[];
        rowsList[0]!['fusionMap'] = 0.4999;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('publish a fused figure that is not the row');
  });

  it('**refuses a fused coverage whose count of two-armed rows is not the measured count**', () => {
    const run = runGate(
      mutated((record) => {
        (record['fusion'] as Record<string, unknown>)['coverage'] = {
          rows: 3,
          attempted: 3,
          share: 1,
          fused: 1,
          declined: 2,
        };
        const rowsList = record['rows'] as Record<string, unknown>[];
        rowsList[1]!['fusionFused'] = false;
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('a measured row ran both arms by construction');
  });

  it('**refuses two descriptions of one composite that disagree**', () => {
    // `fallback.degraded` and `fusion.overall` are the same arithmetic written twice, and the gate is what keeps the
    // two blocks from drifting into two published figures for one quantity.
    const run = runGate(
      mutated((record) => {
        (record['fallback'] as Record<string, unknown>)['degraded'] = { map: 0.34, rows: 3 };
      }),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('one composite described');
  });
});
