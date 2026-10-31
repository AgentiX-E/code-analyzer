#!/usr/bin/env node
// The gate over `benchmarks/callgraph-quality.json` and `benchmarks/callgraph-ts-quality.json`.
//
// **Every other gate in this repository holds a count.** This one holds an accuracy, because the call graph had
// counts and no accuracy: the pass that produced most of its edges was a cartesian product, and nothing in the
// repository could tell. The figures are produced by two independent implementations that read nothing this one
// writes - `scripts/callgraph-oracle.py`, which parses the checkout with CPython's `ast`, and
// `scripts/callgraph-oracle-ts.mjs`, which asks the TypeScript checker.
//
// **Precision and recall are both floors, and the floor on precision is the higher of the two.** A graph can raise
// its recall by guessing and its precision by staying silent, so a gate that watched one would be satisfied by the
// other. Recall has the lower floor because the resolution is deliberately conservative: it refuses a name declared
// twice rather than picking one.
//
// **The arm floors are the reason this gate has a second dimension.** An aggregate hides a bad arm inside a good one:
// `redis/ioredis` once read 92 % precision while an arm that resolved a name unique to the whole graph contributed
// nothing correct at all, and only a per-arm floor could say so. That arm is gone - it claimed 16 edges across the two
// TypeScript checkouts of which **0** were right - and the floors below are what hold its replacement, the class chain,
// to the same scrutiny.
//
// **An arm that stops firing is also a failure**, because a missing arm has no precision to compare and the gate
// reports it as absent rather than skipping it. That is what holds the newest arm - `receiverType`, the one that reads
// a field's declared type - to the thing it was built for: resolving calls, not merely being present in the code.
//
// Usage: node scripts/callgraph-gate.js [--file benchmarks/callgraph-quality.json]

const { readFileSync, appendFileSync } = require('node:fs');

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
const PYTHON_FLOORS = {
  // **The recall floors fell when the oracle learned to read annotations, and that is the figure moving, not the
  // graph.** `call_target` used to require a bare name as the receiver, so `self.field.m()` was never classified and
  // the product's resolution of it could only be scored wrong; the oracle now derives an expected pair for those
  // sites - 4 more on flask and 28 more on werkzeug - and the product does not answer all of them. Precision did not
  // fall: it rose, on 7 new edges of which all 7 are correct.
  //
  // **The class chain is what raised these again.** `inherited` and `super` answer the calls a base class declares -
  // `self._find_error_handler(...)` in `flask/app.py` reaching `App` in `sansio/app.py`, `super().__init__(...)` in
  // werkzeug's middleware - and both read a statement the source makes rather than a name that happens to be unique:
  // 9 of 9 right on flask and 3 of 3. The floors follow the measurement, not the other way round.
  //
  // **Recall rose ten points on flask when the project's own import roots were read from its files.** The arm had
  // been there since the iteration before and resolved nothing, because it recorded a package's own directory as that
  // package's root; `examples/tutorial/flaskr/__init__.py` therefore made the resolver look for
  // `examples/tutorial/flaskr/flaskr/db.py`. A test asking where the root of `flaskr` is found the defect, and 51
  // import edges - the whole example and test suite of the checkout - followed.
  'pallets/flask': {
    precision: 0.955,
    recall: 0.95,
    claimed: 275,
    arms: { import: 0.9, inherited: 0.99, receiverType: 0.99, sameFile: 0.96, super: 0.99 },
  },
  'pallets/werkzeug': {
    precision: 0.97,
    recall: 0.94,
    claimed: 1140,
    arms: { import: 0.97, receiverType: 0.99, sameFile: 0.95 },
  },
};

/**
 * Floors for the TypeScript corpora, measured on `colinhacks/zod@v3.23.8` and `redis/ioredis@v5.4.2`.
 *
 * **`claimed` is the crash floor as well as a volume floor.** A corpus that produced no call graph at all - which is
 * what `redis/ioredis` did before the doc-comment pass stopped overflowing the stack - reports zero claimed edges,
 * and a floor on the count is the only figure that notices.
 *
 * **Recall on both is the honest gap, not a floor that was chosen.** `zod` writes most of its calls as generic
 * `Type.ast` dispatch on union members, and ioredis routes through a command table it builds at runtime; neither is a
 * name a resolver can walk to. The product answers 63.8 % and 67.5 % of what the checker expects and refuses the rest
 * rather than guessing, which is why precision on the same corpora is 97.7 % and 97.8 %.
 */
const TYPESCRIPT_FLOORS = {
  'colinhacks/zod': {
    precision: 0.96,
    recall: 0.6,
    claimed: 78,
    arms: { import: 0.94, sameFile: 0.99, receiverType: 0.99 },
  },
  'redis/ioredis': {
    precision: 0.96,
    recall: 0.64,
    claimed: 175,
    arms: { import: 0.93, inherited: 0.99, sameFile: 0.97, receiverType: 0.99 },
  },
};

function floorsFor(record) {
  // **`includes('ts')` matched `scripts`.** Every record names its oracle as `scripts/callgraph-oracle…`, so the
  // substring test selected the TypeScript floors for the Python record and the gate reported both Python corpora
  // absent from a record that contained them. The file name decides, not a substring of the path.
  return typeof record.oracle === 'string' && record.oracle.includes('oracle-ts')
    ? TYPESCRIPT_FLOORS
    : PYTHON_FLOORS;
}

function main() {
  let record;
  try {
    record = JSON.parse(readFileSync(FILE, 'utf-8'));
  } catch (error) {
    console.error(`callgraph gate: cannot read ${FILE}: ${error.message}`);
    process.exit(1);
  }

  const corpora = Array.isArray(record.corpora) ? record.corpora : [];
  const floors = floorsFor(record);
  const rows = [];
  const failures = [];

  for (const [name, floor] of Object.entries(floors)) {
    const corpus = corpora.find((entry) => entry.corpus === name);
    if (!corpus) {
      failures.push(`${name}: absent from the record`);
      rows.push(`| ${name} | absent | — | — | ✗ |`);
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
        `| ${name} | ${figure} | ${shown} | ≥ ${figure === 'claimed' ? minimum : `${(minimum * 100).toFixed(1)}%`} | ${ok ? '✓' : '✗'}`,
      );
      if (!ok) failures.push(`${name} ${figure}: ${value} < ${minimum}`);
    }
    for (const [arm, minimum] of Object.entries(floor.arms ?? {})) {
      const value = corpus.byArm?.[arm]?.precision;
      if (typeof value !== 'number' || Number.isNaN(value)) {
        failures.push(`${name} arm ${arm}: absent`);
        rows.push(`| ${name} | ${arm} precision | absent | ≥ ${minimum} | ✗ |`);
        continue;
      }
      const ok = value >= minimum;
      rows.push(
        `| ${name} | ${arm} precision | ${(value * 100).toFixed(1)}% | ≥ ${(minimum * 100).toFixed(1)}% | ${ok ? '✓' : '✗'}`,
      );
      if (!ok) failures.push(`${name} arm ${arm}: ${value} < ${minimum}`);
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
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (failures.length > 0) {
    console.error(
      `callgraph gate: ${failures.length} figure(s) below the floor\n  ${failures.join('\n  ')}`,
    );
    process.exit(1);
  }
}

main();
