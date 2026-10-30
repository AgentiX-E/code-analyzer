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
  ['retrieval.at1.recall', ['overall', 'retrieval', 'at1', 'recall'], 0.01, null, false],
  ['retrieval.at3.recall', ['overall', 'retrieval', 'at3', 'recall'], 0.03, null, false],
  ['retrieval.at5.recall', ['overall', 'retrieval', 'at5', 'recall'], 0.05, null, false],
  ['retrieval.at10.recall', ['overall', 'retrieval', 'at10', 'recall'], 0.08, null, false],
  // **A ceiling at the cut where it means something, and not at the cut where it only measures the cut.** A retriever
  // can buy recall with noise and the corpus's FPR is what charges for it - but the filter is *fixed in advance at k*,
  // so the false positives at k=10 have a floor of (10 - expected files) whatever the retriever does, and a ceiling
  // there would be a statement about arithmetic rather than about quality. **k=1 is the cut that can lie**: naming one
  // file and having it be wrong is the mistake a reader pays for immediately. **`at10.fpr` is still published in the
  // artifact**, with its precision and recall, and it is not gated for the reason above.
  ['retrieval.at1.fpr', ['overall', 'retrieval', 'at1', 'fpr'], null, 0.05, false],
  ['retrieval.at10.precision', ['overall', 'retrieval', 'at10', 'precision'], 0.05, null, false],
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

  const rows = [];
  const failures = [];
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
