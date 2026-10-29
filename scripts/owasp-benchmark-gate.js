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
 *
 * **Both directions are stated for the categories the propagator answers.** A taint engine can buy recall by reporting
 * more, so a floor on TPR alone lets precision fall silently: `taintSubset.fpr` is the figure that says whether the
 * recall is real, and the constants below assume it. **The 0.1306 measured here is the constant-condition model** -
 * folding `(7 * 18) + num > 200 ? "constant" : param` to its reachable arm, which closed 230 of the corpus's 403
 * false positives without losing a single true one.
 */
const RULES = [
  ['overall.tpr', (r) => r.overall?.tpr, 0.8169],
  ['overall.fpr', (r) => r.overall?.fpr, null, 0.131],
  ['overall.score', (r) => r.overall?.score, 0.686],
  ['taintSubset.tpr', (r) => r.taintSubset?.tpr, 0.7128],
  // **The category-weighted figure, and the one this engine is actually scored on.** Its TPR is lower than `overall`
  // because the four rule categories are not in it.
  ['taintSubset.fpr', (r) => r.taintSubset?.fpr, null, 0.218],
  ['taintSubset.score', (r) => r.taintSubset?.score, 0.495],
  // The four categories a flow cannot answer, which now have a rule family of their own. **One is set to 1.0**: a
  // rule names a construct, so a case in these categories that has the construct is found and one that does not is not,
  // and a floor below 1 would let the family lose a case without failing.
  ['crypto.tpr', (r) => category(r, 'crypto')?.tpr, 1],
  // **`crypto` is the category the destination filter moved.** Its 85 false positives were all `fw.write(...)`, so its
  // FPR is now a figure that only a genuine response-body flow can raise; the ceiling is stated at 0.05 rather than 0
  // because a flow finding on a real response write would be a true positive of a different category and this file
  // should report it instead of failing the build.
  ['crypto.fpr', (r) => category(r, 'crypto')?.fpr, null, 0.05],
  ['hash.tpr', (r) => category(r, 'hash')?.tpr, 1],
  ['securecookie.tpr', (r) => category(r, 'securecookie')?.tpr, 1],
  ['weakrand.tpr', (r) => category(r, 'weakrand')?.tpr, 1],
  // The rules are also held to producing no noise at all on their own, which is the figure that says whether they are
  // worth their recall: `byEngine.rules` is the corpus scored by the rule family alone.
  ['rules.fpr', (r) => r.byEngine?.rules?.fpr, null, 0.001],
  // **The flow half is measured on its own too**, because the overall figure is carried by the rule families and a
  // propagator that stopped working would hide behind them. Every false positive in the corpus is a flow finding and
  // the rule families contribute none, so `flows.fpr` and `overall.fpr` are the same number reached by two routes;
  // stating both keeps a rule family that starts reporting from hiding behind a flow engine that stopped.
  ['flows.tpr', (r) => r.byEngine?.flows?.tpr, 0.4551],
  ['flows.fpr', (r) => r.byEngine?.flows?.fpr, null, 0.131],
  ['cmdi.tpr', (r) => category(r, 'cmdi')?.tpr, 0.6746],
  ['cmdi.fpr', (r) => category(r, 'cmdi')?.fpr, null, 0.136],
  // **`ldapi` had no floor at all**, which is how a category can reach 0.85 TPR in one commit and quietly halve in the
  // next: the only figure that would have moved is `overall`, and it moves by 1/2740 per case.
  ['ldapi.tpr', (r) => category(r, 'ldapi')?.tpr, 0.8518],
  ['ldapi.fpr', (r) => category(r, 'ldapi')?.fpr, null, 0.282],
  ['pathtraver.tpr', (r) => category(r, 'pathtraver')?.tpr, 0.8345],
  ['pathtraver.fpr', (r) => category(r, 'pathtraver')?.fpr, null, 0.319],
  ['sqli.tpr', (r) => category(r, 'sqli')?.tpr, 0.6801],
  ['sqli.fpr', (r) => category(r, 'sqli')?.fpr, null, 0.203],
  ['trustbound.tpr', (r) => category(r, 'trustbound')?.tpr, 0.8313],
  ['trustbound.fpr', (r) => category(r, 'trustbound')?.fpr, null, 0.233],
  ['xpathi.tpr', (r) => category(r, 'xpathi')?.tpr, 0.9333],
  ['xpathi.fpr', (r) => category(r, 'xpathi')?.fpr, null, 0.15],
  ['xss.tpr', (r) => category(r, 'xss')?.tpr, 0.6341],
  ['xss.fpr', (r) => category(r, 'xss')?.fpr, null, 0.211],
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
