#!/usr/bin/env node
/**
 * **Where the missing goldens live, by the corpus's own taxonomy.**
 *
 * §173 reads the wide arm of the AACR board: ours `P 0.3280 / R 0.2257 / F1 0.2674` against the competitor's
 * `P 0.3779 / R 0.3761 / F1 0.3770`. A single delta of `-0.11` F1 is a verdict; it is not a plan, because the two arms are
 * not weak in one place. **The corpus publishes a category on every reference comment**, so the same verdicts can be split
 * by it - and the split is what says whether the next iteration should buy emission, ranking, matching or judgement.
 *
 * ```
 * node scripts/aacr-category-gap.mjs --artifact benchmarks/aacr-bench.json \
 *   --corpus /tmp/aacr-bench/dataset/v1/positive_samples.json --json benchmarks/aacr-category-gap.json
 * ```
 *
 * **Three guards, because a decomposition is only worth reading if it adds back up.**
 *
 *   1. **Ours is the shipped cut, reproduced before anything is printed.** A table over `rankedFindings` would price the
 *      run's *candidates* (622) rather than the `311` comments a reader saw, and the difference is the whole cut curve.
 *   2. **One golden, one credit, per arm, by the corpus's matching.** The buckets are computed over the maximum matching,
 *      not over `matchedGoldens`: a sum reports `326` credited pairs where the matching reports `195`, and the buckets would
 *      then be 40 % optimistic in exactly the categories with the most overlapping findings.
 *   3. **Every bucket adds back up to the figure it decomposes** - ours to `truePositives`, theirs to
 *      `secondReviewer.truePositives`, the denominators to `truePositives + falseNegatives`. A table whose rows do not sum
 *      to the published number is a second opinion wearing the first one's clothes, and §124 is this repository's record of
 *      what that costs.
 *
 * **What it cannot do.** It attributes credit, never detection: a golden nobody credited appears in the denominator of its
 * category and in neither arm's numerator, which is the honest place for it. **A category where both arms are near zero is
 * a detection gap and not a ranking one**, and no cut this repository can buy closes it.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { applyCut } from './lib/operating-point.mjs';
import { matchingByPullRequest } from './lib/operating-point.mjs';

function parseArgs(argv) {
  const options = { artifact: null, corpus: null, json: null, label: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--artifact') options.artifact = argv[(i += 1)];
    else if (arg === '--corpus') options.corpus = argv[(i += 1)];
    else if (arg === '--json') options.json = argv[(i += 1)];
    else if (arg === '--label') options.label = argv[(i += 1)];
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.artifact === null || options.corpus === null) {
  process.stderr.write(
    'usage: aacr-category-gap.mjs --artifact <artifact.json> --corpus <positive_samples.json> ' +
      '[--json out]\n' +
      '  both inputs are required: the verdicts are in the artifact and the taxonomy is in the corpus.\n',
  );
  process.exit(2);
}

const artifact = JSON.parse(readFileSync(options.artifact, 'utf8'));
const corpus = JSON.parse(readFileSync(options.corpus, 'utf8'));

/**
 * **The pull requests this run scored, and the taxonomy of their goldens.**
 *
 * The slice comes from the artifact's own coverage statement rather than from the corpus, because the corpus holds `196`
 * pull requests and the run asked about `50` - §173.1's defect, and the reason every denominator below is built from the
 * slice and never from the file.
 */
const scored = Array.isArray(artifact?.coverage?.byPullRequest)
  ? artifact.coverage.byPullRequest.map((row) => row?.pr).filter((pr) => typeof pr === 'string')
  : null;
if (scored === null || scored.length === 0) {
  process.stderr.write(
    `${options.artifact}: the artifact names no scored pull requests, so there is no slice to attribute\n`,
  );
  process.exit(2);
}
const slice = new Set(scored);
const rowOf = new Map(
  corpus
    .filter((row) => typeof row?.githubPrUrl === 'string' && slice.has(row.githubPrUrl))
    .map((row) => [row.githubPrUrl, row]),
);

if (rowOf.size !== slice.size) {
  process.stderr.write(
    `${options.artifact}: ${String(slice.size - rowOf.size)} of the run's pull requests are absent from the corpus, ` +
      'so the categories of their goldens are unknown and the buckets would not add up\n',
  );
  process.exit(2);
}

/** `pr#golden` -> category, for every golden on the slice. */
const categoryOf = new Map();
const goldensOf = new Map();
for (const [pr, row] of rowOf) {
  const comments = Array.isArray(row.comments) ? row.comments : [];
  const perCategory = new Map();
  comments.forEach((comment, at) => {
    const category = String(comment?.category ?? 'uncategorized');
    categoryOf.set(`${pr}#${String(at)}`, category);
    perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
  });
  goldensOf.set(pr, perCategory);
}

const credit = (finding) => finding.matchedGoldens ?? [];

/** The goldens one arm was actually paid for, as `pr#golden` keys. */
function credited(findings) {
  const keys = new Set();
  for (const [pr, holder] of matchingByPullRequest(findings, credit)) {
    for (const golden of holder.keys()) keys.add(`${pr}#${String(golden)}`);
  }
  return keys;
}

/**
 * **Our arm is the cut the run shipped, rebuilt first.**
 *
 * `rankedFindings` holds every candidate the run judged - `622` of them on the wide arm - and the published figure is over
 * the `311` the cut kept. Pricing the candidates would report a different run's table under this run's heading.
 */
const ourFindings = Array.isArray(artifact.rankedFindings) ? artifact.rankedFindings : [];
const shipped = artifact?.emissionRules?.shipped ?? {};
const steps = Array.isArray(shipped.steps) ? shipped.steps : [];
if (ourFindings.length === 0 || steps.length === 0) {
  process.stderr.write(
    `${options.artifact}: no rankedFindings or no shipped cut, so there is no emission to attribute\n`,
  );
  process.exit(2);
}

const ourShipped = applyCut(ourFindings, steps);
const ourPoint = { emitted: ourShipped.length, truePositives: credited(ourShipped).size };
const publishedPoint = shipped.point ?? {};
if (
  ourPoint.emitted !== publishedPoint.k ||
  ourPoint.truePositives !== Number(artifact.truePositives ?? -1)
) {
  process.stderr.write(
    `the shipped cut rebuilds ${String(ourPoint.emitted)} comments / ${String(ourPoint.truePositives)} true positives ` +
      `and the artifact published ${String(publishedPoint.k)} / ${String(artifact.truePositives)} - a table over a ` +
      'different emission is a table about a different run\n',
  );
  process.exit(2);
}

/** **Their arm is their whole emission**, which is their cut: the record holds no candidate set of theirs to move. */
const theirFindings = Array.isArray(artifact?.secondReviewer?.findingsAtItsOwnOperatingPoint)
  ? artifact.secondReviewer.findingsAtItsOwnOperatingPoint
  : [];
if (theirFindings.length === 0) {
  process.stderr.write(
    `${options.artifact}: the artifact holds no competitor emission, so there is nothing to compare a decomposition of ` +
      'ours with - a run that did not buy the arm has no rows here\n',
  );
  process.exit(2);
}

const oursCredited = credited(ourShipped);
const theirsCredited = credited(theirFindings);

/** One row per category the corpus uses, keyed by the corpus's own spelling of it. */
const categories = new Map();
const bucket = (category) => {
  const existing = categories.get(category);
  if (existing !== undefined) return existing;
  const created = { goldens: 0, ours: 0, theirs: 0 };
  categories.set(category, created);
  return created;
};

for (const perCategory of goldensOf.values()) {
  for (const [category, count] of perCategory) bucket(category).goldens += count;
}
for (const key of oursCredited) {
  const category = categoryOf.get(key);
  if (category !== undefined) bucket(category).ours += 1;
}
for (const key of theirsCredited) {
  const category = categoryOf.get(key);
  if (category !== undefined) bucket(category).theirs += 1;
}

/**
 * **The buckets add back up or nothing is printed.**
 *
 * Three identities, each of them a published number: our credits to `truePositives`, theirs to
 * `secondReviewer.truePositives`, and the denominator to `truePositives + falseNegatives`. §124's defect was a category
 * table that read `73` where the run scored `39` while both numbers looked plausible, so the check is the section.
 */
const totals = [...categories.values()].reduce(
  (sum, row) => ({
    goldens: sum.goldens + row.goldens,
    ours: sum.ours + row.ours,
    theirs: sum.theirs + row.theirs,
  }),
  { goldens: 0, ours: 0, theirs: 0 },
);

const publishedTheirs = Number(artifact?.secondReviewer?.truePositives ?? -1);
const publishedGoldens = Number(artifact.truePositives ?? 0) + Number(artifact.falseNegatives ?? 0);
const mismatches = [
  ['ours', totals.ours, ourPoint.truePositives],
  ['theirs', totals.theirs, publishedTheirs],
  ['goldens', totals.goldens, publishedGoldens],
].filter(([, computed, published]) => computed !== published);

if (mismatches.length > 0) {
  const said = mismatches
    .map(
      ([name, computed, published]) => `${name} ${String(computed)} against ${String(published)}`,
    )
    .join(', ');
  process.stderr.write(
    `the buckets do not add back up (${said}), so at least one golden was filed under a category the corpus does not ` +
      'hold, or under none\n',
  );
  process.exit(2);
}

const rows = [...categories.entries()]
  .map(([category, row]) => ({
    category,
    goldens: row.goldens,
    ours: row.ours,
    theirs: row.theirs,
    oursRecall: row.goldens === 0 ? 0 : row.ours / row.goldens,
    theirsRecall: row.goldens === 0 ? 0 : row.theirs / row.goldens,
    gap: row.theirs - row.ours,
  }))
  .sort((left, right) => right.goldens - left.goldens);

const pad = (text, width) => String(text).padEnd(width);
const lines = [
  `AACR · ${String(scored.length)} pull requests · ${String(publishedGoldens)} goldens · ours ${String(ourPoint.emitted)} comments, theirs ${String(theirFindings.length)}`,
  `${pad('category', 32)} ${pad('goldens', 8)} ${pad('ours', 6)} ${pad('R', 7)} ${pad('theirs', 7)} ${pad('R', 7)} gap`,
];
for (const row of rows) {
  lines.push(
    `${pad(row.category, 32)} ${pad(row.goldens, 8)} ${pad(row.ours, 6)} ${pad(row.oursRecall.toFixed(4), 7)} ` +
      `${pad(row.theirs, 7)} ${pad(row.theirsRecall.toFixed(4), 7)} ${row.gap > 0 ? '+' : ''}${String(row.gap)}`,
  );
}
lines.push(
  `${pad('total', 32)} ${pad(totals.goldens, 8)} ${pad(totals.ours, 6)} ${pad((totals.ours / totals.goldens).toFixed(4), 7)} ` +
    `${pad(totals.theirs, 7)} ${pad((totals.theirs / totals.goldens).toFixed(4), 7)} +${String(totals.theirs - totals.ours)}`,
);

if (options.json !== null) {
  writeFileSync(
    options.json,
    `${JSON.stringify(
      {
        version: 'aacr-category-gap-v1',
        // **The label is what a reader can follow to the run**, and a `/tmp` path is not: a committed record whose
        // provenance is a scratch directory is a record nobody can re-derive (see §173.3's dispatch id).
        source: options.label ?? options.artifact,
        corpus: { pullRequests: scored.length, goldens: totals.goldens },
        emission: { ours: ourPoint.emitted, theirs: theirFindings.length },
        credited: { ours: totals.ours, theirs: totals.theirs },
        rows,
      },
      null,
      2,
    )}\n`,
  );
}

process.stdout.write(`${lines.join('\n')}\n`);
