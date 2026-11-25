#!/usr/bin/env node
/**
 * **What the cut is worth, on verdicts a run has already paid for.**
 *
 * ```
 * node scripts/cut-curve.mjs benchmarks/aacr-bench.json --split-half
 * ```
 *
 * `F1 = 2·TP/(emitted + goldens)`, so the budget is a term in the figure and not a setting outside it. **The shipped
 * `budget: 12` is a constant somebody chose on one board**, and §157.4 found it costs 0.015-0.032 on Martian while being
 * exactly right on AACR - which is a property of a constant rather than of either corpus.
 *
 * **Two guards, because a curve is easy to draw and easy to misdraw.**
 *
 *   1. **The artifact's own shipped point has to be reproduced before anything is printed.** A curve over a different
 *      emission is a curve about a different run - the same rule `martian-profile.mjs` applies, for the same reason.
 *   2. **`--split-half` chooses the budget on one half of the pull requests and reports it on the other**, because a
 *      maximum read off the whole curve is a fitted parameter. The halves are drawn by position in the sorted list of
 *      pull-request urls, so the split is a property of the corpus rather than of the scores.
 *
 * **What it does not do is decide.** A budget that wins on one board and loses on another is the finding; the product
 * ships one number, and which number is a decision with a cost on each board that this script prints rather than picks.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { profileMaps } from './lib/corpus-profile.mjs';
import { applyCut, cutFromSteps, pullRequestOf, score } from './lib/operating-point.mjs';

function parseArgs(argv) {
  const options = { artifacts: [], budgets: [], splitHalf: false, json: null, corpus: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--split-half') options.splitHalf = true;
    else if (arg === '--json') options.json = argv[(i += 1)];
    else if (arg === '--corpus') options.corpus = argv[(i += 1)];
    else if (arg === '--budgets')
      options.budgets = argv[(i += 1)]
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
    else options.artifacts.push(arg);
  }
  if (options.budgets.length === 0)
    options.budgets = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24];
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.artifacts.length === 0) {
  process.stderr.write(
    'usage: cut-curve.mjs <artifact.json>... [--budgets 4,6,8] [--split-half --corpus <positive_samples.json>] [--json out]\n',
  );
  process.exit(2);
}

const credit = (finding) => finding.matchedGoldens ?? [];
const results = [];

for (const artifactPath of options.artifacts) {
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const findings = artifact.rankedFindings ?? [];
  const shipped = artifact.emissionRules?.shipped ?? {};
  const steps = shipped.steps ?? [];
  const goldens = Number(artifact.truePositives ?? 0) + Number(artifact.falseNegatives ?? 0);
  if (findings.length === 0 || goldens === 0) {
    process.stderr.write(
      `${artifactPath}: no rankedFindings or no goldens, so there is nothing to curve\n`,
    );
    process.exit(2);
  }

  // **Guard 1.** The budget steps are replaced; every other step is the artifact's own, so the curve is about this run.
  const cut = cutFromSteps(steps);
  if (cut === null) {
    process.stderr.write(
      `${artifactPath}: the shipped cut carries a step this instrument cannot spell\n`,
    );
    process.exit(2);
  }
  const fixed = steps.filter((step) => step?.kind !== 'budget');
  const shippedBudget = steps.find((step) => step?.kind === 'budget')?.k ?? null;
  const at = (budget) => applyCut(findings, [...fixed, { kind: 'budget', k: budget }]);
  if (shippedBudget !== null) {
    const point = score(at(shippedBudget), credit, goldens);
    const published = shipped.point ?? {};
    if (point.emitted !== published.k || point.truePositives !== published.truePositives) {
      process.stderr.write(
        `${artifactPath}: the shipped cut rebuilds ${String(point.emitted)} comments / ${String(point.truePositives)} true positives and the artifact published ${String(published.k)} / ${String(published.truePositives)}\n`,
      );
      process.exit(1);
    }
  }

  const curve = options.budgets.map((budget) => ({
    budget,
    ...score(at(budget), credit, goldens),
  }));
  const best = curve.reduce((left, right) => (right.f1 > left.f1 ? right : left));
  const shippedPoint = shippedBudget === null ? null : score(at(shippedBudget), credit, goldens);

  const record = {
    artifact: artifactPath,
    cut,
    shippedBudget,
    shipped: shippedPoint,
    goldens,
    curve,
    best: { budget: best.budget, f1: best.f1 },
    costAtBest: shippedPoint === null ? null : best.f1 - shippedPoint.f1,
  };

  // **Guard 2.** Choose on one half, report on the other. The split is by position in the sorted pull-request list.
  if (options.splitHalf) {
    if (options.corpus === null) {
      // **A half-corpus needs its own denominator**, and the denominator lives in the corpus rather than in the artifact.
      // Guessing it from the findings would divide recall by the goldens something happened to claim.
      process.stderr.write(
        '--split-half needs --corpus <positive_samples.json>, because a half has its own denominator\n',
      );
      process.exit(2);
    }
    const corpus = JSON.parse(readFileSync(options.corpus, 'utf8'));
    const { maps } = profileMaps(corpus, 'all');
    const pullRequests = [...new Set(findings.map(pullRequestOf))].sort();
    const even = new Set(pullRequests.filter((_, index) => index % 2 === 0));
    const odd = new Set(pullRequests.filter((_, index) => index % 2 === 1));
    const goldensOf = (which) => {
      let count = 0;
      for (const [pullRequest, goldensOfPullRequest] of maps.entries()) {
        if (which.has(pullRequest)) count += goldensOfPullRequest.size;
      }
      return count;
    };
    const chosenHalf = {
      name: 'chosen',
      rows: findings.filter((f) => even.has(pullRequestOf(f))),
      goldens: goldensOf(even),
    };
    const heldOut = {
      name: 'held-out',
      rows: findings.filter((f) => !even.has(pullRequestOf(f))),
      goldens: goldensOf(odd),
    };
    const on = (half, budget) =>
      score(applyCut(half.rows, [...fixed, { kind: 'budget', k: budget }]), credit, half.goldens);
    let pick = null;
    for (const budget of options.budgets) {
      const point = on(chosenHalf, budget);
      if (pick === null || point.f1 > pick.f1) pick = { budget, f1: point.f1 };
    }
    record.splitHalf = {
      chosenOn: chosenHalf.name,
      chosenGoldens: chosenHalf.goldens,
      heldOutGoldens: heldOut.goldens,
      budget: pick.budget,
      chosenF1: pick.f1,
      heldOut: on(heldOut, pick.budget),
      heldOutAtShipped: shippedBudget === null ? null : on(heldOut, shippedBudget),
    };
    record.splitHalf.gain = record.splitHalf.heldOut.f1 - record.splitHalf.heldOutAtShipped.f1;
  }

  results.push(record);

  const pad = (value, width) => String(value).padStart(width);
  process.stdout.write(
    `${artifactPath}\ncut ${cut}   shipped budget ${String(shippedBudget)}   goldens ${String(goldens)}\n` +
      `budget  emitted    tp       P       R      F1\n` +
      curve
        .map(
          (row) =>
            `${pad(row.budget, 6)}${pad(row.emitted, 8)}${pad(row.truePositives, 6)}` +
            `${row.precision.toFixed(4).padStart(8)}${row.recall.toFixed(4).padStart(8)}${row.f1.toFixed(4).padStart(8)}` +
            `${row.budget === shippedBudget ? '  <- shipped' : ''}${row.budget === best.budget ? '  <- best on this curve' : ''}\n`,
        )
        .join(''),
  );
  if (record.splitHalf !== undefined) {
    process.stdout.write(
      `split-half  chosen k=${String(record.splitHalf.budget)} on ${record.splitHalf.chosenOn} (F1 ${record.splitHalf.chosenF1.toFixed(4)}), ` +
        `held out F1 ${record.splitHalf.heldOut.f1.toFixed(4)} against ${record.splitHalf.heldOutAtShipped.f1.toFixed(4)} at the shipped budget ` +
        `(${record.splitHalf.gain >= 0 ? '+' : ''}${record.splitHalf.gain.toFixed(4)})\n`,
    );
  }
  process.stdout.write('\n');
}

if (options.json) {
  writeFileSync(options.json, `${JSON.stringify({ version: 'cut-curve-v1', results }, null, 2)}\n`);
  process.stdout.write(`wrote ${options.json}\n`);
}
