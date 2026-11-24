#!/usr/bin/env node
/**
 * **Price every term of the actionability score on one published artifact.**
 *
 * ```
 * node scripts/aacr-score-ablation.mjs benchmarks/aacr-bench.json
 * node scripts/aacr-score-ablation.mjs artifacts/aacr-bench.json --cut 'budget:12' --json out.json
 * ```
 *
 * The artifact supplies the rows, their features, their published scores and their verdicts; the engine source supplies
 * the weights; nothing is re-run and nothing is spent. The instrument refuses to print a single delta when the weights do
 * not rebuild every published score, because a delta measured against a number that is not the artifact's number is a
 * delta about the instrument.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ablateScoreTerms,
  pairedTermComparison,
  ScoreReproductionError,
} from './lib/score-ablation.mjs';
import { readScoreWeights } from './lib/score-weights.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = join(ROOT, 'packages', 'intelligence', 'src', 'review', 'actionability.ts');

function parseArgs(argv) {
  const options = { artifact: null, cut: undefined, json: null, rounds: 2000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cut') options.cut = argv[(i += 1)];
    else if (arg === '--json') options.json = argv[(i += 1)];
    else if (arg === '--rounds') options.rounds = Number(argv[(i += 1)]);
    else if (!arg.startsWith('--')) options.artifact = arg;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options.artifact) {
  process.stderr.write(
    'usage: aacr-score-ablation.mjs <artifact.json> [--cut <cut>] [--json <out.json>]\n',
  );
  process.exit(2);
}

const artifact = JSON.parse(readFileSync(options.artifact, 'utf8'));
const findings = artifact.rankedFindings ?? [];
if (findings.length === 0) {
  process.stderr.write('the artifact has no rankedFindings, so there are no terms to price\n');
  process.exit(2);
}

/**
 * **The denominator is the row set's, read from the coverage table rather than counted from the rows.**
 *
 * A pull request whose comments the cut removed still owns its reference comments, and a denominator that forgets them
 * raises recall every time a rule abstains.
 */
const goldens =
  (artifact.coverage?.byPullRequest ?? []).reduce(
    (total, entry) => total + Number(entry.goldens ?? 0),
    0,
  ) || Number(artifact.truePositives ?? 0) + Number(artifact.falseNegatives ?? 0);

const weights = readScoreWeights(readFileSync(ENGINE, 'utf8'));

const coverage = artifact.coverage?.byPullRequest ?? [];
const goldensOf = coverage.map((entry) => ({
  pr: String(entry.pr),
  goldens: Number(entry.goldens ?? 0),
}));
const denominator = goldensOf.reduce((total, entry) => total + entry.goldens, 0);

let result;
let paired = true;
try {
  result =
    goldensOf.length > 0
      ? pairedTermComparison({
          findings,
          goldensByPullRequest: goldensOf,
          weights,
          cut: options.cut,
          rounds: options.rounds,
        })
      : ablateScoreTerms({ findings, goldens: denominator, weights, cut: options.cut });
  if (goldensOf.length === 0) paired = false;
} catch (error) {
  if (error instanceof ScoreReproductionError) {
    process.stderr.write(`${error.message}\n`);
    for (const row of error.mismatches.slice(0, 10)) {
      process.stderr.write(`  ${row.pr || '(no pull request)'} #${row.index}\n`);
    }
    process.exit(1);
  }
  throw error;
}

const header = paired
  ? 'term              weight  fired     tp   emitted      F1     delta            95% CI      lost  won        p'
  : 'term              weight  fired     tp   emitted      F1     delta';
const line = (cells) => {
  const base =
    `${cells.term.padEnd(16)}${String(cells.weight).padStart(7)}${String(cells.firedOn).padStart(7)}` +
    `${String(cells.truePositives).padStart(7)}${String(cells.emitted).padStart(10)}` +
    `${cells.f1.toFixed(4).padStart(9)}${cells.delta.toFixed(4).padStart(10)}`;
  if (!paired) return base;
  const interval = `[${cells.interval.lo.toFixed(4)}, ${cells.interval.hi.toFixed(4)}]`;
  return (
    `${base}${interval.padStart(19)}${String(cells.onlyBase).padStart(9)}${String(cells.onlyAlt).padStart(5)}` +
    `${cells.p.toFixed(4).padStart(9)}`
  );
};

const rows = [
  header,
  line({
    term: '(all terms)',
    weight: '',
    firedOn: '',
    truePositives: result.baseline.truePositives,
    emitted: result.baseline.emitted,
    f1: result.baseline.f1,
    delta: 0,
    interval: { lo: 0, hi: 0 },
    onlyBase: 0,
    onlyAlt: 0,
    p: 1,
  }),
  ...result.terms.map((term) =>
    line({
      term: term.term,
      weight: term.weight,
      firedOn: term.firedOn,
      truePositives: term.without.truePositives,
      emitted: term.without.emitted,
      f1: term.without.f1,
      delta: term.delta,
      interval: term.interval ?? { lo: 0, hi: 0 },
      onlyBase: term.onlyBase ?? 0,
      onlyAlt: term.onlyAlt ?? 0,
      p: term.p ?? 1,
    }),
  ),
];

process.stdout.write(
  `artifact ${options.artifact}\n` +
    `cut      ${result.cut}\n` +
    `rows     ${result.rows}   reference comments ${result.goldens}   pull requests ${result.pullRequests ?? 0}\n\n` +
    `${rows.join('\n')}\n\n` +
    'delta = F1 without the term minus F1 with it: positive means the term was costing true positives.\n' +
    'lost/won = reference comments exactly one arm bought, and p is the exact McNemar test on them.\n',
);

if (paired) {
  process.stdout.write(
    `resolution: a move smaller than ${result.resolution.mde.toFixed(4)} F1 cannot be shown at ` +
      `${result.pullRequests} pull requests (paired sd ${result.resolution.sd.toFixed(4)}).\n`,
  );
}

if (options.json) {
  writeFileSync(
    options.json,
    `${JSON.stringify({ artifact: options.artifact, ...result }, null, 2)}\n`,
  );
  process.stdout.write(`wrote ${options.json}\n`);
}
