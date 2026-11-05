#!/usr/bin/env node
// The gate over `benchmarks/lca-bug-localization.json`.
//
// **A figure from somebody else's corpus can fall silently.** The retrieval arm of this benchmark is a chain - scan,
// parse, resolve, index, fuse, number - and any link in it can get worse while every unit test stays green. This
// script states the floor each published figure has to hold and fails when one does not, printing the measured value
// beside the bound it missed.
//
// **The floors are the measured baseline, not an aspiration.** They exist to catch regression and they are raised in
// the same commit that raises the measurement. On the first run of a new instrument they are deliberately low, because
// a floor invented before the first measurement is a guess wearing a gate's clothes - and the honest thing is to say
// so in this file rather than to pretend the number was chosen.
//
// **Why `fpr` is gated as well as `f1`.** Bug localisation rewards naming files, and naming more files raises recall.
// The corpus's own metric punishes that with FPR and precision, and a gate that watched only recall would let the
// product drift into naming the whole repository.
//
// Usage: node scripts/lca-gate.js [--file benchmarks/lca-bug-localization.json]

const { appendFileSync, readFileSync } = require('node:fs');

const FILE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : 'benchmarks/lca-bug-localization.json';

/** Read a nested field, or `undefined` - **a missing figure is a failure, not a zero**. */
function at(record, path) {
  let value = record;
  for (const key of path) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    value = value[key];
  }
  return value;
}

/**
 * Each entry names the figure, where it lives, and its bound.
 *
 * `ceiling` marks a figure that has to stay *below* its bound, which is how FPR and the all-incorrect rate are stated.
 * `optional` marks a figure that only exists when the job had a key; **its absence is reported rather than passed**,
 * because a column that is quietly empty reads like a column that was fine.
 */
const RULES = [
  // **Recall at one file.** The strictest useful statement of "the answer was found": a developer who opens the first
  // file the product names is right. This is the figure the corpus's published tables are hardest on.
  //
  // **Every floor in this block is 0.01, and the reason is written down rather than implied.** The first published
  // run of the instrument reported 0.0000 at all four cuts in all three languages, and that figure was a measurement
  // of the harness: the product reports absolute paths, the corpus records repository-relative ones, and the
  // intersection was therefore empty on every instance. `benchmark/lca-instrument.ts` now owns both conversions and
  // has its own tests. **Those floors (0.01, 0.03, 0.05, 0.08) were therefore fitted to a number produced by a defect**
  // and have been reset: an arm that has never produced a valid figure has never been measured, and the floor is
  // raised in the commit that records the first one.
  ['retrieval.at1.recall', ['overall', 'retrieval', 'at1', 'recall'], 0.01, null, false],
  ['retrieval.at3.recall', ['overall', 'retrieval', 'at3', 'recall'], 0.01, null, false],
  ['retrieval.at5.recall', ['overall', 'retrieval', 'at5', 'recall'], 0.01, null, false],
  ['retrieval.at10.recall', ['overall', 'retrieval', 'at10', 'recall'], 0.01, null, false],
  // **A ceiling at the cut where it means something, and not at the cut where it only measures the cut.** A retriever
  // can buy recall with noise and the corpus's FPR is what charges for it - but the filter is *fixed in advance at k*,
  // so the false positives at k=10 have a floor of (10 - expected files) whatever the retriever does, and a ceiling
  // there would be a statement about arithmetic rather than about quality. **k=1 is the cut that can lie**: naming one
  // file and having it be wrong is the mistake a reader pays for immediately. **`at10.fpr` is still published in the
  // artifact**, with its precision and recall, and it is not gated for the reason above.
  ['retrieval.at1.fpr', ['overall', 'retrieval', 'at1', 'fpr'], null, 0.05, false],
  ['retrieval.at10.precision', ['overall', 'retrieval', 'at10', 'precision'], 0.01, null, false],
  // **The column the published table reports.** `overall.map.value` exists only when an instance produced a ranking,
  // and its floor is a hundredth for the same reason every other floor in this block is: the numbers above it were
  // fitted to a run that turned out to be measuring the harness rather than the retriever, and a floor raised in the
  // commit that records a figure is a ratchet while a floor invented before one is a guess. **The comparator is the
  // paper's `BM25` row at 0.25**, and closing that distance is what the optimisation plan measures itself by - the
  // gate's job is to stop it going backwards while it is being closed.
  ['map', ['overall', 'map', 'value'], 0.01, null, false],
  // **The answer arm**: what the model cited, scored with the same ruler. Present only with a key. **Floors of one
  // hundredth, because this arm has never been measured**: a floor of 0.05 chosen before the first number existed
  // would be a guess that could only fail, and the point of a first measurement is to learn what the number is. It is
  // raised in the commit that records it.
  ['answer.f1', ['overall', 'answer', 'f1'], 0.01, null, true],
  ['answer.precision', ['overall', 'answer', 'precision'], 0.01, null, true],
  ['answer.recall', ['overall', 'answer', 'recall'], 0.01, null, true],
];

function row(name, value, floor, ceiling, optional) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return {
      row: `| ${name} | ${optional ? 'not measured' : 'absent'} | — | ${optional ? '·' : '✗'} |`,
      failure: optional ? null : `${name}: absent`,
    };
  }
  const bound = ceiling === null ? floor : ceiling;
  const ok = ceiling === null ? value >= bound : value <= bound;
  const label = ceiling === null ? `≥ ${floor}` : `≤ ${ceiling}`;
  return {
    row: `| ${name} | ${value.toFixed(4)} | ${label} | ${ok ? '✓' : '✗'} |`,
    failure: ok ? null : `${name}: ${value} against ${label}`,
  };
}

function main() {
  let record;
  try {
    record = JSON.parse(readFileSync(FILE, 'utf-8'));
  } catch (error) {
    console.error(`lca gate: cannot read ${FILE}: ${error.message}`);
    process.exit(1);
  }

  // **A record whose corpus size is unknown is not a passing record.** The mean of zero instances is not a score, and
  // a job that downloaded nothing would otherwise print 0.0000 as if it had measured something.
  const measured = at(record, ['overall', 'measured']);
  if (typeof measured !== 'number' || measured <= 0) {
    console.error(
      `lca gate: ${String(measured)} instances were measured — a mean over none is not a figure, so nothing here passes`,
    );
    process.exit(1);
  }

  const semantic = at(record, ['space', 'semantic']);
  if (semantic !== false && semantic !== true) {
    console.error('lca gate: the artifact does not say whether the semantic half ran');
    process.exit(1);
  }

  // **The cost model is a published figure, so its absence is a failure.** Both refuse rules in this harness are
  // `constant x files` and the instances that ran show that constant wrong by two orders of magnitude, so what the
  // artifact has to carry is the fit that replaces it: the slope, the intercept, the residual that says whether the
  // ceiling can be trusted, and the spread the constant could not express. **A gate on the quality figures alone would
  // let the instrumentation disappear quietly**, and the next refusal would be argued about without it.
  const fit = at(record, ['costModel', 'recommended']);
  const fitLine = (() => {
    if (fit === null || typeof fit !== 'object') {
      return {
        line: '| cost model | not fitted | ≥ 3 rows | ✗ |',
        failure:
          'costModel.recommended: absent — the artifact must publish the memory and clock fit it recommends, or say ' +
          'why neither predictor could be fitted',
      };
    }
    const ok =
      typeof fit.rows === 'number' &&
      fit.rows >= 3 &&
      typeof fit.meanResidualMb === 'number' &&
      typeof fit.r2 === 'number' &&
      typeof fit.constantR2 === 'number' &&
      typeof fit.mbPerFile?.min === 'number' &&
      typeof fit.mbPerFile?.max === 'number';
    return {
      line:
        `| cost model (${String(fit.predictor)}) | ${String(fit.rows)} rows · R² ${Number(fit.r2).toFixed(2)} vs ` +
        `constant ${Number(fit.constantR2).toFixed(2)} · ${Number(fit.meanResidualMb).toFixed(0)} MB residual | ` +
        `≥ 3 rows | ${ok ? '✓' : '✗'} |`,
      failure: ok ? null : 'costModel.recommended: fewer than three rows, or a figure missing',
    };
  })();

  // **The sample and the control, as invariants rather than as aspirations.**
  //
  // A floor on `paired.meanDelta` would be an aspiration - the number has never been measured, and a floor invented
  // before the first measurement can only be a guess wearing a gate's clothes. What *can* be required before any figure
  // is read is that the sample adds up and that the comparison is actually paired:
  //
  //   * `attempted = measured + refused`, because a row is one of the two and a gap is a row nobody counted;
  //   * the control exists on **every** measured row, because a paired comparison that dropped its hardest instances is
  //     the bias it was built to remove;
  //   * `paired.rows = measured`, for the same reason stated as an equality rather than as an inequality.
  //
  // **These are the conditions under which the published mean is a figure at all.** They cost nothing to satisfy when
  // the instrumentation works and fail loudly when it stops, which is what a gate is for.
  const sample = at(record, ['sample']);
  const control = at(record, ['baseline', 'overall']);
  const paired = at(record, ['paired']);
  const invariants = [];
  const guard = (condition, message) => {
    if (!condition) invariants.push(message);
  };
  guard(
    typeof sample?.attempted === 'number' &&
      typeof sample?.measured === 'number' &&
      typeof sample?.refused === 'number',
    'sample: attempted / measured / refused are absent, so the figure does not say what it was computed over',
  );
  if (typeof sample?.attempted === 'number') {
    guard(
      sample.attempted === sample.measured + sample.refused,
      `sample: attempted ${String(sample.attempted)} is not measured plus refused ` +
        `(${String(sample.measured)} + ${String(sample.refused)})`,
    );
    guard(
      sample.planned >= sample.attempted,
      `sample: planned ${String(sample.planned)} is below attempted ${String(sample.attempted)}`,
    );
    guard(
      typeof sample.ofPlanned === 'number' && sample.ofPlanned > 0,
      'sample: ofPlanned is absent or zero, so the run saw none of the protocol',
    );
  }
  guard(
    typeof control?.rows === 'number' &&
      typeof sample?.measured === 'number' &&
      control.rows >= sample.measured,
    `baseline: the control scored ${String(control?.rows)} rows against ${String(sample?.measured)} measured - a ` +
      'control that skips instances is the bias it exists to remove',
  );
  guard(
    typeof paired?.rows === 'number' && paired.rows === sample?.measured,
    `paired: ${String(paired?.rows)} paired rows against ${String(sample?.measured)} measured - every measured ` +
      'instance must be paired, or the comparison is over a different sample than the figure',
  );
  guard(
    Array.isArray(at(record, ['stratified'])) && at(record, ['stratified']).length > 0,
    'stratified: absent - the sample’s difficulty cannot be read without it',
  );

  // **The fourth and fifth invariants, and the reason they are equalities too.**
  //
  // `baseline.byLanguage` used to print our mean and the control's from two different row sets - ours over the measured
  // rows, the control's over every row that carried one - so the Java leg published a 0.0037 win that was the
  // denominators rather than the ranking. A per-language pair is a subtraction a reader will perform, so the gate
  // requires that the two means were averaged over the same rows and that the delta is what they give.
  //
  // And `diagnosis` is a count over that same intersection: a diagnosis over more rows than the pairing would be a
  // statement about a sample the figure it diagnoses was not computed on.
  const diagnosis = at(record, ['diagnosis']);
  const byLanguage = at(record, ['baseline', 'byLanguage']);
  guard(
    typeof diagnosis?.rows === 'number' && diagnosis.rows === paired?.rows,
    `diagnosis: ${String(diagnosis?.rows)} rows against ${String(paired?.rows)} paired - the rank diagnosis and the ` +
      'paired comparison must be about the same instances',
  );
  guard(
    typeof diagnosis?.oursFound === 'number' &&
      typeof diagnosis?.rows === 'number' &&
      diagnosis.oursFound <= diagnosis.rows,
    'diagnosis: more rows contain the answer than there are rows',
  );
  for (const [config, entry] of Object.entries(byLanguage ?? {})) {
    if (typeof entry?.rows !== 'number' || typeof entry?.delta !== 'number') continue;
    guard(
      Math.abs(entry.delta - (entry.ours - entry.map)) < 1e-4,
      `baseline.byLanguage.${config}: delta ${String(entry.delta)} is not ours minus control ` +
        `(${String(entry.ours)} - ${String(entry.map)})`,
    );
  }
  const sampleLine =
    typeof sample?.measured === 'number'
      ? `| sample | ${String(sample.measured)} measured of ${String(sample.attempted)} attempted of ` +
        `${String(sample.planned)} planned · worst case ` +
        `${typeof sample.worstCaseMap === 'number' ? sample.worstCaseMap.toFixed(4) : 'none'} · standardised ` +
        `${typeof sample.standardised?.value === 'number' ? sample.standardised.value.toFixed(4) : 'none'} | ` +
        `measured + refused = attempted | ${invariants.length === 0 ? '✓' : '✗'} |`
      : '| sample | absent | measured + refused = attempted | ✗ |';
  const pairedLine =
    typeof paired?.meanDelta === 'number'
      ? `| paired vs BM25 | ${paired.meanDelta.toFixed(4)} ` +
        `[${Number(paired.lower).toFixed(4)}, ${Number(paired.upper).toFixed(4)}] · ` +
        `p ${Number(paired.pValue).toFixed(4)} | ${String(paired.rows)} rows, all measured | ` +
        `${paired.rows === sample?.measured ? '✓' : '✗'} |`
      : '| paired vs BM25 | not measured | every measured row paired | ✗ |';

  const diagnosisLine =
    typeof diagnosis?.rows === 'number'
      ? `| answer rank | ours ${String(diagnosis.oursFound)}/${String(diagnosis.rows)} found · median ` +
        `${String(diagnosis.oursMedian ?? 'none')} · first ${String(diagnosis.oursFirst)} | BM25 ` +
        `${String(diagnosis.controlFound)}/${String(diagnosis.rows)} found · median ` +
        `${String(diagnosis.controlMedian ?? 'none')} · first ${String(diagnosis.controlFirst)} | ` +
        `${diagnosis.rows === paired?.rows ? '✓' : '✗'} |`
      : '| answer rank | absent | same rows as the pairing | ✗ |';
  const rows = [];
  const failures = [...invariants];
  rows.push(fitLine.line);
  if (fitLine.failure) failures.push(fitLine.failure);
  rows.push(sampleLine, pairedLine, diagnosisLine);
  for (const [name, path, floor, ceiling, optional] of RULES) {
    const { row: line, failure } = row(name, at(record, path), floor, ceiling, optional);
    rows.push(line);
    if (failure) failures.push(failure);
  }

  const summary = [
    '| figure | measured | bound | |',
    '|---|---|---|---|',
    ...rows,
    '',
    `corpus: ${at(record, ['dataset', 'name'])} · ${measured} instances measured`,
    `semantic half: ${semantic ? 'ran' : 'did not run (lexical only)'}`,
    `measured: ${String(at(record, ['measuredAt']))}`,
  ].join('\n');

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  console.log(summary);

  if (failures.length > 0) {
    console.error(
      `\nlca gate: ${failures.length} figure(s) below the bound\n  ${failures.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log('\nlca gate: all figures hold');
}

main();
