#!/usr/bin/env node
// The gate over `benchmarks/cross-repo-matrix.json`.
//
// **A benchmark without a threshold is a press release.** The matrix writes four numbers and every one of them can
// fall: a resolver that stops matching a package name, an extractor that stops reading an import, a walk that stops
// following a re-export. This script states the floor each number has to hold, and fails the build when one does not
// — printing the figure that fell beside the figure it was measured against.
//
// Usage: node scripts/cross-repo-gate.js [--file benchmarks/cross-repo-matrix.json]

const { readFileSync } = require('node:fs');

const FILE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : 'benchmarks/cross-repo-matrix.json';

/** Each entry names the number, where it lives, and the floor. */
const RULES = [
  ['resolution.recall', (r) => r.resolution.recall, 1],
  ['resolution.precision', (r) => r.resolution.precision, 1],
  ['resolution.nameRecall', (r) => r.resolution.nameRecall, 0.99],
  ['trace.recall', (r) => r.trace.recall, 1],
  ['impact.recall', (r) => r.impact.recall, 1],
  // **The structural half, which the workspace did not have until the pipeline ran per repository.** Measured on
  // flask 3.0.3 + werkzeug 3.0.3: `CALLS = 0` before, 21 549 after - and then **1 760** once the call graph was
  // corrected, because 92 % of those 21 549 were a cartesian product rather than calls. The floor follows the
  // corrected figure, and the accuracy that justifies it is gated separately by `scripts/callgraph-gate.js`, where
  // these same two checkouts score 94.7 % and 95.8 % precise. **A floor on a count cannot distinguish those two
  // states**, which is the whole reason that second gate exists.
  ['index.calls', (r) => r.index.calls, 1500],
];

/**
 * Values that must be **exactly** this, not at least this.
 *
 * **A count of edges nothing supports has one acceptable value.** Two repositories share relative paths and every
 * community detector numbers from one, so a merge that does not scope its names makes one repository's folder edges
 * point at another's nodes: measured, **375 `CROSS_REPO_DEPENDS` edges** that no import, call or contract
 * corroborates. A floor of zero would be satisfied by them.
 */
const EXACT = [['index.unsupportedCrossRepoEdges', (r) => r.index.unsupportedCrossRepoEdges, 0]];

function main() {
  let record;
  try {
    record = JSON.parse(readFileSync(FILE, 'utf-8'));
  } catch (error) {
    console.error(`cross-repo gate: cannot read ${FILE}: ${error.message}`);
    process.exit(1);
  }

  const rows = [];
  const failures = [];
  for (const [name, read, floor] of RULES) {
    const value = read(record);
    // **A missing number is a failure, not a skip.** The matrix always writes these keys; a record without one is a
    // record produced by something else.
    if (typeof value !== 'number' || Number.isNaN(value)) {
      failures.push(`${name}: absent`);
      rows.push(`| ${name} | absent | ≥ ${floor} | ✗ |`);
      continue;
    }
    const ok = value >= floor;
    rows.push(`| ${name} | ${value} | ≥ ${floor} | ${ok ? '✓' : '✗'} |`);
    if (!ok) failures.push(`${name}: ${value} < ${floor}`);
  }

  for (const [name, read, expected] of EXACT) {
    const value = read(record);
    if (typeof value !== 'number' || Number.isNaN(value)) {
      failures.push(`${name}: absent`);
      rows.push(`| ${name} | absent | = ${expected} | ✗ |`);
      continue;
    }
    const ok = value === expected;
    rows.push(`| ${name} | ${value} | = ${expected} | ${ok ? '✓' : '✗'} |`);
    if (!ok) failures.push(`${name}: ${value} ≠ ${expected}`);
  }

  const summary = [
    '| figure | measured | floor | |',
    '|---|---|---|---|',
    ...rows,
    '',
    `corpora: ${(record.corpora ?? []).map((corpus) => corpus.repo).join(' + ')}`,
    `cross-repository import edges: ${record.index?.crossRepoEdges ?? 'absent'}`,
    `call edges in the workspace: ${record.index?.calls ?? 'absent'}`,
    `impact strict precision (re-exports and namespace imports count as extra): ${record.impact?.strictPrecision ?? 'absent'}`,
  ].join('\n');

  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (failures.length > 0) {
    console.error(
      `cross-repo gate: ${failures.length} figure(s) below the floor\n  ${failures.join('\n  ')}`,
    );
    process.exit(1);
  }
}

main();
