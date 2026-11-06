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

  // **The sixth invariant, and it is an equality against the product rather than a floor.**
  //
  // `fileRanking` publishes what the same pool would have scored under five readings of a file. Four of them are
  // candidates and one of them is the product, so the armature has to be checked against the product before any
  // candidate is read: **the shipped arm's own delta must be zero, and on every row the shipped arm's average precision
  // and answer position must be the row's own.** An armature that measured five rules without one of them being the
  // shipped rule would publish four differences between candidates and call one of them the control.
  const fileRanking = at(record, ['fileRanking']);
  const arms = Array.isArray(fileRanking?.arms) ? fileRanking.arms : [];
  guard(
    typeof fileRanking?.shipped === 'string' && arms.length > 1,
    'fileRanking: absent, or holds fewer than two readings - an armature with one arm measures nothing',
  );
  const shippedArm = arms.find((arm) => arm?.aggregation === fileRanking?.shipped);
  guard(
    shippedArm !== undefined,
    `fileRanking: the shipped aggregation ${String(fileRanking?.shipped)} is not among the arms, so nothing in this ` +
      'block is a comparison against the product',
  );
  if (shippedArm !== undefined) {
    guard(
      shippedArm.delta === 0 && shippedArm.wins === 0 && shippedArm.losses === 0,
      `fileRanking.${String(shippedArm.aggregation)}: compared with itself it reports delta ` +
        `${String(shippedArm.delta)}, ${String(shippedArm.wins)} wins and ${String(shippedArm.losses)} losses`,
    );
    guard(
      shippedArm.rows === paired?.rows,
      `fileRanking.${String(shippedArm.aggregation)}: ${String(shippedArm.rows)} paired rows against ` +
        `${String(paired?.rows)} on the figure, so the armature is about a different sample`,
    );
  }
  for (const entry of arms) {
    guard(
      typeof entry?.aggregation === 'string' &&
        typeof entry?.rows === 'number' &&
        typeof entry?.map === 'number',
      `fileRanking: an arm (${String(entry?.aggregation)}) is missing its name, its row count or its mean`,
    );
  }
  // **Per row, because a mean can agree with a mean while the rows behind them do not.** This is the check that would
  // have caught the armature reading a collapsed pool: every file would then score identically under all five arms and
  // the figures would agree, so the assertion is the shipped arm's *per-row* figures rather than its mean alone.
  const rowsOf = Array.isArray(at(record, ['rows'])) ? at(record, ['rows']) : [];
  let checked = 0;
  for (const row of rowsOf) {
    if (row?.skipped !== null || !Array.isArray(row?.fileArms)) continue;
    const shipped = row.fileArms.find((arm) => arm?.aggregation === fileRanking?.shipped);
    if (shipped === undefined) continue;
    checked += 1;
    guard(
      Math.abs(shipped.map - row.map) < 1e-9 && shipped.answerRank === row.answerRank,
      `rows[${String(row.id)}]: the shipped arm reads ${String(shipped.map)}/${String(shipped.answerRank)} where the ` +
        `product published ${String(row.map)}/${String(row.answerRank)} - the armature is not reading the pool the ` +
        'product ranked',
    );
  }
  guard(
    checked >= (sample?.measured ?? 0),
    `fileRanking: ${String(checked)} rows carry an armature against ${String(sample?.measured)} measured - a row ` +
      'without one is an instance the comparison skipped silently',
  );
  // **The seventh invariant: the second control.** A paired difference against **one** comparator is a difference that
  // can be a fit to that comparator, so the artifact publishes a second scorer over the identical index - and the gate
  // requires it to be a control rather than a decoration:
  //
  //   * it exists, is paired, and carries its own configuration, because a control described as "TF-IDF" without its
  //     weighting is a name rather than a method;
  //   * it ran on **exactly the rows** the primary control ran on - two controls over two different sets of checkouts
  //     would make the pair a comparison of samples rather than of formulas;
  //   * every `controlSummary` delta is `ours - control` on the rows that control scored, and every summary row counts
  //     the same paired rows as the comparison it summarises.
  //
  // **Per row as well as in the mean**, for the reason the armature is checked per row: two means can agree while the
  // rows behind them do not, and a control that silently skipped the hard instances would produce exactly that.
  const crossCheck = at(record, ['crossCheck']);
  const crossOverall = at(record, ['crossCheck', 'overall']);
  const crossPaired = at(record, ['crossCheck', 'paired']);
  guard(
    crossCheck !== null &&
      typeof crossOverall?.rows === 'number' &&
      crossOverall.rows > 0 &&
      typeof crossCheck?.configuration?.termFrequency === 'string' &&
      typeof crossCheck?.configuration?.inverseDocumentFrequency === 'string',
    'crossCheck: absent, empty, or silent about its weighting - a second control is a measurement only if its formula ' +
      'is stated',
  );
  guard(
    typeof crossPaired?.rows === 'number' && crossPaired.rows === paired?.rows,
    `crossCheck: ${String(crossPaired?.rows)} paired rows against ${String(paired?.rows)} for the primary control - ` +
      'the two controls must be measured on the same instances',
  );
  guard(
    crossOverall?.rows === at(record, ['baseline', 'overall', 'rows']),
    `crossCheck: ${String(crossOverall?.rows)} control rows against ` +
      `${String(at(record, ['baseline', 'overall', 'rows']))} for BM25 - the second control did not run everywhere the ` +
      'first one did',
  );
  let secondControlRows = 0;
  let unmatchedControlRows = 0;
  for (const row of rowsOf) {
    if (typeof row?.bm25Map !== 'number') continue;
    secondControlRows += 1;
    if (typeof row?.tfidfMap !== 'number') unmatchedControlRows += 1;
  }
  guard(
    unmatchedControlRows === 0,
    `rows: ${String(unmatchedControlRows)} of ${String(secondControlRows)} rows carry a BM25 figure without a TF-IDF ` +
      'one - a control that skips the hard instances is the bias it exists to remove, one formula at a time',
  );
  const controlSummary = Array.isArray(at(record, ['controlSummary']))
    ? at(record, ['controlSummary'])
    : [];
  guard(
    controlSummary.length === 2 && new Set(controlSummary.map((entry) => entry?.name)).size === 2,
    `controlSummary: ${String(controlSummary.length)} entries - it exists to hold both controls, once each`,
  );
  for (const entry of controlSummary) {
    const name = String(entry?.name);
    const pairedRows = typeof entry?.pairedRows === 'number' ? entry.pairedRows : -1;
    guard(
      pairedRows === paired?.rows,
      `controlSummary.${name}: summarises ${String(entry?.pairedRows)} paired rows against ` +
        `${String(paired?.rows)} on the figure`,
    );
    // **The paired control mean, not the control's mean over every row it scored.** Those are two different numbers
    // whenever the controls ran on instances we could not measure - which is the normal case, and which is the exact
    // subtraction that published a 0.0037 Java win in iteration 71. The tolerance is a thousandth because the artifact
    // publishes four decimals and a difference of two rounded means is not the rounded mean of differences.
    if (
      typeof entry?.delta !== 'number' ||
      typeof entry?.oursPaired !== 'number' ||
      typeof entry?.pairedControl !== 'number'
    ) {
      guard(
        pairedRows === 0,
        `controlSummary.${name}: a paired row without a delta, an under-ours mean or a paired control mean`,
      );
      continue;
    }
    guard(
      Math.abs(entry.delta - (entry.oursPaired - entry.pairedControl)) < 1e-3,
      `controlSummary.${name}: delta ${String(entry.delta)} is not ours minus control on the paired rows ` +
        `(${String(entry.oursPaired)} - ${String(entry.pairedControl)})`,
    );
  }

  // **The eighth invariant: the fallback, which is the only column with a figure on every attempted instance.**
  //
  // The comparison this artifact publishes is a mean over a sample, and the sample is what the bounds let through. A
  // fallback that ranks a file by its path and its imports needs no analysis, so it produces a ranking on the instances
  // the analysis refused - **which makes its denominator the run rather than the rankings**, and that is the property
  // the gate has to hold it to. A fallback block whose `overall.rows` were smaller than its `coverage.rows` would be a
  // second mean over a favourable subset wearing the name of a mean over the protocol.
  //
  // **Per row as well**, and the rule is stated in the direction that is hard on us: an instance that had an answer
  // space to rank but carries no fallback figure is a hole the mean would not show.
  const fallbackBlock = at(record, ['fallback']);
  const fallbackCoverage = at(record, ['fallback', 'coverage']);
  const fallbackOverall = at(record, ['fallback', 'overall']);
  guard(
    fallbackBlock !== null &&
      typeof fallbackBlock?.configuration?.document === 'string' &&
      typeof fallbackCoverage?.rows === 'number' &&
      fallbackCoverage.rows > 0,
    'fallback: absent, empty, or silent about the document it ranks - a fallback described as "path and imports" ' +
      'without saying what a document is is a name rather than a method',
  );
  guard(
    fallbackOverall?.rows === fallbackCoverage?.rows,
    `fallback: overall is a mean over ${String(fallbackOverall?.rows)} rows while coverage claims ` +
      `${String(fallbackCoverage?.rows)} - a mean over fewer rows than it claims is a favourable subset`,
  );
  guard(
    typeof fallbackCoverage?.rows === 'number' &&
      typeof sample?.measured === 'number' &&
      fallbackCoverage.rows >= sample.measured,
    `fallback: ${String(fallbackCoverage?.rows)} rows against ${String(sample?.measured)} measured - the fallback ` +
      'exists on the instances the analysis refused, so its coverage cannot be the measured count',
  );
  let rowsWithAnswerSpace = 0;
  let rowsWithoutFallback = 0;
  let rowsWithFallback = 0;
  for (const row of rowsOf) {
    if (typeof row?.fallbackMap === 'number') rowsWithFallback += 1;
    if (typeof row?.corpusFiles !== 'number' || row.corpusFiles <= 0) continue;
    rowsWithAnswerSpace += 1;
    if (typeof row?.fallbackMap !== 'number') rowsWithoutFallback += 1;
  }
  guard(
    rowsWithoutFallback === 0,
    `rows: ${String(rowsWithoutFallback)} of ${String(rowsWithAnswerSpace)} rows had an answer space and no fallback ` +
      'figure - the one column with full coverage is the one a hole is least visible in',
  );
  guard(
    fallbackCoverage?.rows === rowsWithFallback,
    `fallback: coverage claims ${String(fallbackCoverage?.rows)} rows against the ${String(rowsWithFallback)} rows ` +
      'that carry a fallback figure - the two must be the same count, or the coverage is a claim',
  );
  // **The cost of the column, which is the one number that explains a sample smaller than the protocol.** A fallback
  // that reads one head per file before every child is started is paid for out of the instances' clock; publishing the
  // total and the files it read is what turns "nine instances were not examined" into an arithmetic the next run can act
  // on. A block that described the column and not its cost would be a column that appeared to be free.
  const fallbackCost = at(record, ['fallback', 'cost']);
  guard(
    typeof fallbackCost?.totalMs === 'number' && typeof fallbackCost?.filesRead === 'number',
    'fallback.cost: absent - a column that reads a head per file per instance has a cost, and a block that does not ' +
      'publish it is describing a free instrument',
  );
  const fallbackVsOurs = at(record, ['fallback', 'pairedVsOurs']);
  guard(
    typeof fallbackVsOurs?.rows === 'number' && fallbackVsOurs.rows === paired?.rows,
    `fallback.pairedVsOurs: ${String(fallbackVsOurs?.rows)} rows against ${String(paired?.rows)} on the figure - the ` +
      'mechanism test has to be over the instances both instruments ranked',
  );

  // **The ninth invariant: the fused column, which is the product's ranking as it actually returns it.**
  //
  // The fallback above is what the product does *instead of* the analysis on the instances it refuses. This is what it
  // does *with* the file-level arm available: the declaration arm and the file-level arm fused by reciprocal rank on
  // every instance the analysis ran, and the file-level arm alone on the ones it did not. **Three things can go wrong
  // and each has a check**: a mean over fewer rows than the column claims, a mixture whose split is not published, and
  // a row whose `fused` flag contradicts its own `skipped` sentence.
  const fusionCoverage = at(record, ['fusion', 'coverage']);
  const fusionOverall = at(record, ['fusion', 'overall']);
  const fusionBlock = at(record, ['fusion']);
  guard(
    fusionBlock !== null &&
      typeof fusionBlock?.configuration?.fusion === 'string' &&
      /reciprocal rank/u.test(String(fusionBlock?.configuration?.fusion)) &&
      typeof fusionCoverage?.rows === 'number' &&
      fusionCoverage.rows > 0,
    'fusion: absent, empty, or silent about the arithmetic - a fused column that does not name its fusion is a name ' +
      'rather than a method',
  );
  guard(
    fusionOverall?.rows === fusionCoverage?.rows,
    `fusion: overall is a mean over ${String(fusionOverall?.rows)} rows while coverage claims ` +
      `${String(fusionCoverage?.rows)} - the same defect the fallback block was built to prevent`,
  );
  guard(
    typeof fusionCoverage?.rows === 'number' &&
      typeof fusionCoverage?.fused === 'number' &&
      typeof fusionCoverage?.declined === 'number' &&
      fusionCoverage.fused + fusionCoverage.declined === fusionCoverage.rows,
    `fusion: ${String(fusionCoverage?.fused)} fused + ${String(fusionCoverage?.declined)} declined is not ` +
      `${String(fusionCoverage?.rows)} - a mean over a mixture whose split is not published is a mixture`,
  );
  let rowsWithFusion = 0;
  let fusedRows = 0;
  let declinedRows = 0;
  let fusionMapMismatch = 0;
  let fusionFlagMismatch = 0;
  for (const row of rowsOf) {
    if (typeof row?.fusionMap !== 'number') continue;
    rowsWithFusion += 1;
    if (row?.fusionFused === true) fusedRows += 1;
    else declinedRows += 1;
    // **A measured row's fused figure *is* the row's figure.** They are written by two processes - the child computes
    // the ranking, the parent transcribes it - and a disagreement means one of them is describing a different run.
    if (row?.skipped === null && row?.fusionMap !== row?.map) fusionMapMismatch += 1;
    // **And the flag has to match the sentence.** A row that was refused cannot claim two arms: the declaration arm is
    // the analysis that was refused, so a `fused: true` on it would be a claim about a ranking that never existed.
    if ((row?.skipped === null) !== (row?.fusionFused === true)) fusionFlagMismatch += 1;
  }
  guard(
    rowsWithFusion === fusionCoverage?.rows,
    `fusion: coverage claims ${String(fusionCoverage?.rows)} rows against the ${String(rowsWithFusion)} rows that ` +
      'carry a fused figure',
  );
  guard(
    fusedRows === fusionCoverage?.fused && declinedRows === fusionCoverage?.declined,
    `fusion: the rows say ${String(fusedRows)} fused and ${String(declinedRows)} declined where the block says ` +
      `${String(fusionCoverage?.fused)} and ${String(fusionCoverage?.declined)}`,
  );
  guard(
    fusionMapMismatch === 0,
    `rows: ${String(fusionMapMismatch)} measured rows publish a fused figure that is not the row's own - the child ` +
      'computed one ranking and the parent transcribed another',
  );
  guard(
    fusionFlagMismatch === 0,
    `rows: ${String(fusionFlagMismatch)} rows have a fused flag that contradicts their skipped sentence`,
  );
  guard(
    typeof fusionCoverage?.fused === 'number' &&
      typeof sample?.measured === 'number' &&
      fusionCoverage.fused === sample.measured,
    `fusion: ${String(fusionCoverage?.fused)} fused rows against ${String(sample?.measured)} measured - a measured ` +
      'row ran both arms by construction, so the two counts cannot differ',
  );
  const fusionVsDeclarations = at(record, ['fusion', 'pairedVsDeclarations']);
  guard(
    typeof fusionVsDeclarations?.rows === 'number' && fusionVsDeclarations.rows === paired?.rows,
    `fusion.pairedVsDeclarations: ${String(fusionVsDeclarations?.rows)} rows against ${String(paired?.rows)} on the ` +
      'figure - the ablation has to be over the rows the analysis ran',
  );
  if (typeof fusionVsDeclarations?.delta === 'number') {
    guard(
      Math.abs(
        fusionVsDeclarations.delta - (fusionVsDeclarations.ours - fusionVsDeclarations.control),
      ) < 1e-3,
      `fusion.pairedVsDeclarations: delta ${String(fusionVsDeclarations.delta)} is not the difference of its own ` +
        `two means (${String(fusionVsDeclarations.ours)} - ${String(fusionVsDeclarations.control)})`,
    );
  }
  const fallbackDegraded = at(record, ['fallback', 'degraded']);
  guard(
    typeof fallbackDegraded?.map === 'number' &&
      fallbackDegraded.map === fusionOverall?.value &&
      fallbackDegraded?.rows === fusionOverall?.rows,
    `fallback.degraded: ${String(fallbackDegraded?.map)} over ${String(fallbackDegraded?.rows)} rows against the ` +
      `fused column's ${String(fusionOverall?.value)} over ${String(fusionOverall?.rows)} - one composite described ` +
      'twice has to be the same number twice',
  );

  // **The ninth invariant: no band may publish two means over two samples on one line.**
  //
  // The per-language table was repaired for exactly this in iteration 73 and the per-band table was left as it was:
  // `stratified` printed our mean over the rows we measured beside the control's over every row of the band, refused
  // rows included. A band is where that subtraction looks most innocent, because the two numbers sit in one row and the
  // bands are what a reader uses to decide whether the sample is easier. So every band now carries a **paired** object
  // with its own row count, and the gate requires the delta to be the difference of the means beside it.
  const strata = Array.isArray(at(record, ['stratified'])) ? at(record, ['stratified']) : [];
  for (const stratum of strata) {
    const label = String(stratum?.label);
    const vsBm25 = stratum?.vsBm25;
    if (typeof stratum?.measured === 'number' && stratum.measured > 0) {
      guard(
        vsBm25?.rows === stratum.measured,
        `stratified.${label}: ${String(vsBm25?.rows)} paired rows against ${String(stratum.measured)} measured - the ` +
          'control ran on every measured row, so a gap is a row the band dropped',
      );
    }
    if (typeof vsBm25?.delta !== 'number') continue;
    guard(
      Math.abs(vsBm25.delta - (vsBm25.ours - vsBm25.control)) < 1e-3,
      `stratified.${label}: delta ${String(vsBm25.delta)} is not ours minus control on the paired rows ` +
        `(${String(vsBm25.ours)} - ${String(vsBm25.control)})`,
    );
    guard(
      typeof stratum?.fallbackRows === 'number' && stratum.fallbackRows >= stratum.measured,
      `stratified.${label}: ${String(stratum?.fallbackRows)} fallback rows against ${String(stratum?.measured)} ` +
        'measured - a band where the fallback covered less than the analysis did',
    );
    guard(
      typeof stratum?.fusionRows === 'number' && stratum.fusionRows >= stratum.measured,
      `stratified.${label}: ${String(stratum?.fusionRows)} fused rows against ${String(stratum?.measured)} measured ` +
        '- the fused column exists on every attempted row, so a band cannot have fewer than it measured',
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
  const crossPairedLine =
    typeof crossPaired?.meanDelta === 'number'
      ? `| paired vs TF-IDF | ${crossPaired.meanDelta.toFixed(4)} ` +
        `[${Number(crossPaired.lower).toFixed(4)}, ${Number(crossPaired.upper).toFixed(4)}] · ` +
        `p ${Number(crossPaired.pValue).toFixed(4)} | ${String(crossPaired.rows)} rows, the same ones | ` +
        `${crossPaired.rows === paired?.rows ? '✓' : '✗'} |`
      : '| paired vs TF-IDF | not measured | same rows as the primary control | ✗ |';

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
  const fallbackLine =
    typeof fallbackOverall?.value === 'number'
      ? `| fallback: path + imports | ${fallbackOverall.value.toFixed(4)} · ` +
        `${String(fallbackCoverage?.rows)}/${String(sample?.attempted)} instances · vs ours ` +
        `${typeof fallbackVsOurs?.delta === 'number' ? fallbackVsOurs.delta.toFixed(4) : 'none'} | ` +
        `a figure on every attempted row | ${fallbackOverall?.rows === fallbackCoverage?.rows ? '✓' : '✗'} |`
      : '| fallback: path + imports | not measured | a figure on every attempted row | ✗ |';
  const fusionVsDeclarationsLine = at(record, ['fusion', 'pairedVsDeclarations']);
  const fusionLine =
    typeof fusionOverall?.value === 'number'
      ? `| fused: declarations + path/imports | ${fusionOverall.value.toFixed(4)} · ` +
        `${String(fusionCoverage?.rows)}/${String(sample?.attempted)} instances ` +
        `(${String(fusionCoverage?.fused)} fused, ${String(fusionCoverage?.declined)} declined) · vs declarations ` +
        `${typeof fusionVsDeclarationsLine?.delta === 'number' ? fusionVsDeclarationsLine.delta.toFixed(4) : 'none'} | ` +
        "the product's own ranking, on every attempted row | " +
        `${fusionOverall?.rows === fusionCoverage?.rows && fusionMapMismatch === 0 ? '✓' : '✗'} |`
      : "| fused: declarations + path/imports | not measured | the product's own ranking | ✗ |";
  rows.push(sampleLine, pairedLine, crossPairedLine, diagnosisLine, fallbackLine, fusionLine);
  for (const stratum of strata) {
    const vsBm25 = stratum?.vsBm25 ?? {};
    rows.push(
      `| band: ${String(stratum?.label)} | ours ` +
        `${typeof stratum?.ours === 'number' ? stratum.ours.toFixed(4) : 'none'} · BM25 ` +
        `${typeof vsBm25.control === 'number' ? vsBm25.control.toFixed(4) : 'none'} · Δ ` +
        `${typeof vsBm25.delta === 'number' ? vsBm25.delta.toFixed(4) : 'none'} · fallback ` +
        `${typeof stratum?.fallback === 'number' ? stratum.fallback.toFixed(4) : 'none'} · fused ` +
        `${typeof stratum?.fusion === 'number' ? stratum.fusion.toFixed(4) : 'none'} | ` +
        `${String(stratum?.measured)} measured of ${String(stratum?.attempted)} attempted | ` +
        `${typeof vsBm25.delta === 'number' || stratum?.measured === 0 ? '✓' : '✗'} |`,
    );
  }
  // **One line per reading of the pool**, because the block is a comparison and a comparison a reader cannot see is a
  // number with a name. The shipped arm is marked, since it is the control rather than a candidate - and a candidate
  // that loses is a ✓ here, because losing is a finding rather than a failure of the gate.
  for (const entry of arms) {
    const mark = entry?.aggregation === fileRanking?.shipped ? ' (shipped)' : '';
    const delta = typeof entry?.delta === 'number' ? entry.delta : null;
    rows.push(
      `| file aggregation: ${String(entry?.aggregation)}${mark} | ` +
        `${typeof entry?.map === 'number' ? entry.map.toFixed(4) : 'none'} vs ` +
        `${typeof entry?.control === 'number' ? entry.control.toFixed(4) : 'none'} · Δ ` +
        `${delta === null ? 'none' : delta.toFixed(4)} · first ${String(entry?.firstPlaced)} | ` +
        `paired, ${String(entry?.rows)} rows | ${delta === null ? '✗' : '✓'} |`,
    );
  }
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
