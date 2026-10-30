#!/usr/bin/env node
// The gate over `benchmarks/callgraph-quality.json`.
//
// **Every other gate in this repository holds a count.** This one holds an accuracy, because the call graph had
// counts and no accuracy: the pass that produced most of its edges was a cartesian product, and nothing in the
// repository could tell. The figures here are produced by `scripts/callgraph-oracle.py`, which parses the same
// checkout with CPython's `ast` and resolves each call site by Python's own scoping and module rules - a second
// implementation that reads nothing this one writes.
//
// **Precision and recall are both floors, and the floor on precision is the higher of the two.** A graph can raise
// its recall by guessing and its precision by staying silent, so a gate that watched one would be satisfied by the
// other. Recall has the lower floor because the resolution is deliberately conservative: it refuses a name declared
// twice rather than picking one.
//
// Usage: node scripts/callgraph-gate.js [--file benchmarks/callgraph-quality.json]

const { readFileSync } = require('node:fs');

const FILE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : 'benchmarks/callgraph-quality.json';

/**
 * Floors per corpus, measured on the released checkout of that corpus.
 *
 * **A single global floor would be set by the weakest corpus and would then never move.** These are the measured
 * values with the smallest headroom that still tolerates parser drift: the figure a regression has to move by more
 * than one edge to trip.
 */
const FLOORS = {
  'pallets/flask': { precision: 0.93, recall: 0.9, claimed: 200 },
  'pallets/werkzeug': { precision: 0.94, recall: 0.94, claimed: 900 },
};

function main() {
  let record;
  try {
    record = JSON.parse(readFileSync(FILE, 'utf-8'));
  } catch (error) {
    console.error(`callgraph gate: cannot read ${FILE}: ${error.message}`);
    process.exit(1);
  }

  const corpora = Array.isArray(record.corpora) ? record.corpora : [];
  const rows = [];
  const failures = [];

  for (const [name, floor] of Object.entries(FLOORS)) {
    const corpus = corpora.find((entry) => entry.corpus === name);
    if (!corpus) {
      failures.push(`${name}: absent from the record`);
      rows.push(`| ${name} | absent | — | ✗ |`);
      continue;
    }
    const figures = [
      ['precision', corpus.precision?.value, floor.precision],
      ['recall', corpus.recall?.value, floor.recall],
      ['claimed', corpus.claimedPairs, floor.claimed],
    ];
    for (const [figure, value, minimum] of figures) {
      // **A missing figure is a failure, not a skip.** The oracle always writes these keys; a record without one was
      // produced by something else.
      if (typeof value !== 'number' || Number.isNaN(value)) {
        failures.push(`${name} ${figure}: absent`);
        rows.push(`| ${name} | ${figure} | absent | ≥ ${minimum} | ✗ |`);
        continue;
      }
      const ok = value >= minimum;
      const shown = figure === 'claimed' ? String(value) : `${(value * 100).toFixed(1)}%`;
      rows.push(
        `| ${name} | ${figure} | ${shown} | ≥ ${figure === 'claimed' ? minimum : `${(minimum * 100).toFixed(0)}%`} | ${ok ? '✓' : '✗'}`,
      );
      if (!ok) failures.push(`${name} ${figure}: ${value} < ${minimum}`);
    }
  }

  const summary = [
    '| corpus | figure | measured | floor | |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    `oracle: ${record.oracle ?? 'absent'} (independent of the code under test)`,
    ...corpora.map(
      (corpus) =>
        `${corpus.corpus}: ${corpus.claimedPairs} claimed against ${corpus.expectedPairs} the parser expects, ` +
        `${corpus.sites?.silent ?? 0} sites the oracle declines to judge, ` +
        `${corpus.definitions?.simpleNameCollisionsPerFile ?? 0} names one file declares twice`,
    ),
  ].join('\n');

  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (failures.length > 0) {
    console.error(
      `callgraph gate: ${failures.length} figure(s) below the floor\n  ${failures.join('\n  ')}`,
    );
    process.exit(1);
  }
}

main();
