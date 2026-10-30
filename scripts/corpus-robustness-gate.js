#!/usr/bin/env node
// The gate over `benchmarks/corpus-robustness.json`.
//
// **The figure this holds is not accuracy and not volume: it is whether the index read the repository at all.** One
// generated HTML page in `redis/ioredis@5.4.2` used to end the `parse` phase, and the repository's 20 457 nodes came
// with **zero** `CALLS` edges - a product that answered "no callers" for every function in a working codebase. Every
// accuracy figure in this repository was blind to it, because each of them measured a hand-picked source tree.
//
// Two floors per corpus, and they fail differently:
//
//   - `filesFailed` must be 0. A file the readers could not survive is a defect in this product, and the count is the
//     only place it is written down.
//   - `calls` must be at least the recorded floor. A graph with no edges passes a failure check trivially, so the
//     figure that a dead index zeroes is held separately.
//
// Usage: node scripts/corpus-robustness-gate.js [--file benchmarks/corpus-robustness.json]

const { readFileSync, appendFileSync } = require('node:fs');

const FILE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : 'benchmarks/corpus-robustness.json';

/**
 * Floors per corpus, measured on the released checkout of that corpus.
 *
 * **`calls` is the crash floor.** It is set just under the measured count, because a parser that gives up on one file
 * moves this figure by hundreds and a parser that drifts by one edge should not fail the build.
 */
const FLOORS = {
  'redis/ioredis': { calls: 220, filesFailed: 0 },
  'colinhacks/zod': { calls: 480, filesFailed: 0 },
};

function main() {
  let record;
  try {
    record = JSON.parse(readFileSync(FILE, 'utf-8'));
  } catch (error) {
    console.error(`corpus robustness gate: cannot read ${FILE}: ${error.message}`);
    process.exit(1);
  }

  const corpora = Array.isArray(record.corpora) ? record.corpora : [];
  const rows = [];
  const failures = [];

  for (const [name, floor] of Object.entries(FLOORS)) {
    const corpus = corpora.find((entry) => entry.corpus === name);
    if (!corpus) {
      failures.push(`${name}: absent from the record`);
      rows.push(`| ${name} | absent | — | — | ✗ |`);
      continue;
    }
    const figures = [
      ['filesFailed', corpus.filesFailed, floor.filesFailed, 'at most'],
      ['calls', corpus.calls, floor.calls, 'at least'],
    ];
    for (const [figure, value, floorValue, direction] of figures) {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        failures.push(`${name} ${figure}: absent`);
        rows.push(`| ${name} | ${figure} | absent | — | ✗ |`);
        continue;
      }
      const ok = direction === 'at most' ? value <= floorValue : value >= floorValue;
      rows.push(
        `| ${name} | ${figure} | ${value} | ${direction} ${floorValue} | ${ok ? '✓' : '✗'}`,
      );
      if (!ok) failures.push(`${name} ${figure}: ${value} (${direction} ${floorValue})`);
    }
  }

  const summary = [
    '| corpus | figure | measured | floor | |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    ...corpora.map(
      (corpus) =>
        `${corpus.corpus}: ${corpus.filesParsed}/${corpus.filesDiscovered} files read, ` +
        `${corpus.regexFallbackFiles} on the reader fallback, ${corpus.nodes} nodes, ${corpus.calls} CALLS edges`,
    ),
    ...corpora.flatMap((corpus) =>
      (corpus.failureSamples ?? []).map(
        (entry) => `  ${corpus.corpus} could not read ${entry.filePath}: ${entry.message}`,
      ),
    ),
  ].join('\n');

  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (failures.length > 0) {
    console.error(
      `corpus robustness gate: ${failures.length} figure(s) below the floor\n  ${failures.join('\n  ')}`,
    );
    process.exit(1);
  }
}

main();
