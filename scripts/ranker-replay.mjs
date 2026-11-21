#!/usr/bin/env node
// @code-analyzer/code-analyzer — replay a paid run's own rows under a fitted ordering and a budget sweep
//
// **What it prints, and why each column exists.** The artifact of a fifty-pull-request run carries every finding's eight
// features, its row of the verdict matrix and the cut the run applied. That is enough to ask two questions that used to
// cost a dispatch each: *would a fitted ordering beat the weights in the tree*, and *what does every budget score*.
//
// **Usage.** `node scripts/ranker-replay.mjs path/to/aacr-bench.json`. The fitted column is a leave-one-pull-request-out
// prediction, so it is the one number in the table that no finding contributed to.

import { loadArtifact, rankCurves, replay } from './lib/ranker-replay.mjs';

const path = process.argv[2];
if (path === undefined) {
  console.error('usage: node scripts/ranker-replay.mjs <aacr-bench.json> [comment budgets]');
  process.exit(1);
}

const budgets = process.argv
  .slice(3)
  .map(Number)
  .filter((value) => Number.isFinite(value) && value > 0);

const artifact = loadArtifact(path);
const result = replay(artifact);
if (result === null) {
  console.error(`${path} carries no cut to replay`);
  process.exit(1);
}

const rows = (label, point) =>
  `${label.padEnd(28)}${String(point.emitted).padStart(6)}${String(point.truePositives).padStart(5)}` +
  `${point.precision.toFixed(4).padStart(9)}${point.recall.toFixed(4).padStart(9)}${point.f1.toFixed(4).padStart(9)}`;

console.log(
  `pool ${artifact.rankedFindings.length} findings · ${result.goldens} goldens in the corpus`,
);
console.log('');
console.log(`ordering`.padEnd(28) + 'emit  TP  precision   recall       F1');
console.log(rows('shipped weights', result.shipped));
console.log(rows('fitted (leave-one-pr-out)', result.fitted));
console.log('');
console.log('budget'.padEnd(28) + 'emit  TP  precision   recall       F1');
for (const point of result.curve) {
  console.log(rows(point.budget === null ? 'no budget' : `budget ${point.budget}`, point));
}
console.log('');
console.log(
  'A fitted column above the shipped one would be a device; one below it is the same statement as the note in ' +
    'docs/EVAL-CONTRACT.md §113.1, which is that the weights already in the tree are not a naive guess.',
);

/**
 * **The rank curve, which answers a different question from the budget sweep above.**
 *
 * The sweep asks what a *rule* costs; this asks what an *ordering* is worth when the comment count is fixed by somebody
 * else's budget. **A curve that rises with `k` says the ranker has nothing to say** - every comment removed takes its
 * matched goldens with it - and the oracle row is the ceiling the ranker is measured against rather than a device.
 */
const ks = budgets.length > 0 ? budgets : [80, 110, 150, 200, 260, 300];
const curves = rankCurves(artifact, ks);
console.log('');
console.log(`rank curves · pool ${String(curves.pool)} · ${String(curves.goldens)} goldens`);
console.log('ordering'.padEnd(28) + 'keep  TP  precision   recall       F1');
for (const [name, points] of Object.entries(curves.curves)) {
  for (const point of points) {
    console.log(rows(`${name} @ ${String(point.k)}`, point));
  }
}
