#!/usr/bin/env node
// The gate over `benchmarks/owasp-benchmark.json`.
//
// **A benchmark score with no floor drifts.** Every number below can fall while the build stays green: a vocabulary
// entry that stops matching, a capture that stops recording an assignment, a sanitizer that starts swallowing real
// flows. This script states the floor each figure has to hold and fails when one does not, printing the measured
// value beside the floor it missed.
//
// The floors are the measured baseline, not an aspiration. They exist to catch regression, and they are raised in the
// same commit that raises the measurement.
//
// Usage: node scripts/owasp-benchmark-gate.js [--file benchmarks/owasp-benchmark.json]

const { readFileSync } = require('node:fs');

const FILE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : 'benchmarks/owasp-benchmark.json';

/**
 * Each entry names the figure, where it lives, and its floor.
 *
 * `overall` is scored over all 2 740 cases including the four categories a flow analysis cannot answer, so its TPR is
 * necessarily low; the per-category floors are what actually detect a regression, because they are the categories
 * this engine claims.
 */
const RULES = [
  ['overall.tpr', (r) => r.overall?.tpr, 0.63],
  ['overall.fpr', (r) => r.overall?.fpr, null, 0.47],
  ['overall.score', (r) => r.overall?.score, 0.16],
  ['taintSubset.tpr', (r) => r.taintSubset?.tpr, 0.76],
  ['taintSubset.score', (r) => r.taintSubset?.score, 0.22],
  ['cmdi.tpr', (r) => category(r, 'cmdi')?.tpr, 0.67],
  ['pathtraver.tpr', (r) => category(r, 'pathtraver')?.tpr, 0.83],
  ['sqli.tpr', (r) => category(r, 'sqli')?.tpr, 0.86],
  ['trustbound.tpr', (r) => category(r, 'trustbound')?.tpr, 0.78],
  ['xpathi.tpr', (r) => category(r, 'xpathi')?.tpr, 0.93],
  ['xss.tpr', (r) => category(r, 'xss')?.tpr, 0.63],
];

function category(record, name) {
  return (record.categories ?? []).find((entry) => entry.category === name);
}

/** `ceiling` marks a figure that must stay *below* its bound, which is how FPR is stated. */
function row(name, value, floor, ceiling) {
  if (typeof value !== 'number' || Number.isNaN(value))
    return { row: `| ${name} | absent | — | ✗ |`, failure: `${name}: absent` };
  const bound = ceiling ?? floor;
  const ok = ceiling === null || ceiling === undefined ? value >= bound : value <= bound;
  const label = ceiling === null || ceiling === undefined ? `≥ ${floor}` : `≤ ${ceiling}`;
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
    console.error(`owasp gate: cannot read ${FILE}: ${error.message}`);
    process.exit(1);
  }

  // **A record that has lost its corpus is not a passing record.** The score means nothing without the case count it
  // was computed over, so both are required before any figure is read.
  const cases = record.corpus?.cases;
  const vulnerable = record.corpus?.vulnerable;
  if (cases !== 2740 || vulnerable !== 1415) {
    console.error(
      `owasp gate: corpus is ${cases} cases / ${vulnerable} vulnerable, expected 2740 / 1415 — the labels and the ` +
        'testcode directory disagree, or the corpus is not OWASP Benchmark v1.2',
    );
    process.exit(1);
  }

  const rows = [];
  const failures = [];
  for (const [name, read, floor, ceiling] of RULES) {
    const { row: line, failure } = row(name, read(record), floor, ceiling);
    rows.push(line);
    if (failure) failures.push(failure);
  }

  const summary = [
    '| figure | measured | bound | |',
    '|---|---|---|---|',
    ...rows,
    '',
    `corpus: ${record.corpus.repository} · ${cases} cases · ${vulnerable} vulnerable · ` +
      `expected results sha256 ${record.corpus.expectedResultsSha256.slice(0, 16)}…`,
    `engine: ${record.engine.sources} sources, ${record.engine.sinks} sinks extracted`,
    `measured: ${record.measuredAt}`,
  ].join('\n');

  if (process.env.GITHUB_STEP_SUMMARY) {
    require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  console.log(summary);

  if (failures.length > 0) {
    console.error(
      `\nowasp gate: ${failures.length} figure(s) below the floor\n  ${failures.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log('\nowasp gate: all figures hold');
}

main();
