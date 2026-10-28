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
];

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

  const summary = [
    '| figure | measured | floor | |',
    '|---|---|---|---|',
    ...rows,
    '',
    `corpora: ${(record.corpora ?? []).map((corpus) => corpus.repo).join(' + ')}`,
    `cross-repository import edges: ${record.index?.crossRepoEdges ?? 'absent'}`,
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
