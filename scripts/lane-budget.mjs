#!/usr/bin/env node
/**
 * **Where the cut takes its credits, and whether a fairer allocation would keep them.**
 *
 * ```
 * node scripts/lane-budget.mjs benchmarks/aacr-bench.json --json benchmarks/lane-budget.json
 * ```
 *
 * `§173.2` excluded three explanations of the AACR deficit in one paragraph: the cut is not the constraint (the best
 * point on the whole curve is `+0.0011`), no score term is the constraint (the ablation moves nothing beyond the run's
 * own resolution), and detection is. **This instrument tests the fourth, which the first three could not see: the cut is
 * globally ranked and lane-blind**, so a lane that emits three times as many findings takes three times as many of the
 * twelve slots - whatever its precision per slot.
 *
 * **The hypothesis, stated before it is tested.** On the wide arm `architecture` emits 321 findings for 88 credits and
 * holds 172 of the 311 shipped slots, while `security` emits 75 for 37 and is almost untouched. If the budget were
 * allocated per lane instead of by global score, the credits the losing lanes never got would come back **at no extra
 * comment**. **The two tables below are the test, and a negative answer is the useful one**: if a lane-fair budget
 * scores worse, then the ranking is doing its job and the deficit is upstream of the cut, which is the third independent
 * confirmation that only detection is left.
 *
 * **Four allocations, all at the same emission the artifact published:**
 *
 *   1. **shipped** - the artifact's own steps, which is the point every published figure on this board is read at.
 *   2. **per-lane budget `k`** - each lane keeps its best `k` findings per pull request, and nothing else.
 *   3. **floor `k` then budget `b`** - each lane is guaranteed its best `k`, then the remaining slots go to the global
 *      order. **This is the only allocation that adds no comment**: the shipped budget `b = 12` with `k = 1` and `k = 2`.
 *   4. **unbudgeted** - every candidate, which is the ceiling and the honest denominator of "what a cut is worth here".
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { applyCut, pullRequestOf, score, scoreOf } from './lib/operating-point.mjs';

function parseArgs(argv) {
  const options = {
    artifact: null,
    json: null,
    label: null,
    floors: [1, 2],
    budgets: [12, 14, 16],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = argv[(i += 1)];
    else if (arg === '--label') options.label = argv[(i += 1)];
    else if (arg === '--floors')
      options.floors = argv[(i += 1)]
        .split(',')
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0);
    else if (arg === '--budgets')
      options.budgets = argv[(i += 1)]
        .split(',')
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0);
    else options.artifact = arg;
  }
  if (options.artifact === null) throw new Error('an artifact path is required');
  return options;
}

/** The rows a cut can act on, which are the ones the run ranked; **a row with no `matchedGoldens` was never judged.** */
function rankableOf(artifact) {
  const rows = artifact.rankedFindings ?? [];
  return rows.filter((row) => Array.isArray(row.matchedGoldens));
}

/** The goldens this artifact is scored against, which the run publishes and this instrument never recomputes. */
function goldens(artifact) {
  const value = Number(artifact.falseNegatives ?? 0) + Number(artifact.truePositives ?? 0);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      'the artifact does not publish a golden total, so there is no denominator to score against',
    );
  }
  return value;
}

/** The per-lane table: what each lane emits, what it credits, and what the shipped cut leaves it. */
function laneTable(rows, kept, creditOf) {
  const byPr = new Map();
  for (const row of rows) {
    const pr = pullRequestOf(row);
    if (!byPr.has(pr)) byPr.set(pr, []);
    byPr.get(pr).push(row);
  }
  /**
   * **A row is `kept` by identity, not by position.** `applyCut` returns the rows themselves, so the test is membership
   * of the same object - and a comparison by `(pr, path, line)` would conflate two findings a lane filed twice, which is
   * a shape the wide arm produces (`§173.3`: 183 findings in the `bug` lane alone).
   */
  const keptSet = new Set(kept);
  const lanes = new Map();
  for (const row of rows) {
    const lane = String(row.lane ?? 'none');
    const entry = lanes.get(lane) ?? { lane, emitted: 0, credited: 0, kept: 0, keptCredited: 0 };
    entry.emitted += 1;
    const credited = creditOf(row).length > 0;
    if (credited) entry.credited += 1;
    if (keptSet.has(row)) {
      entry.kept += 1;
      if (credited) entry.keptCredited += 1;
    }
    lanes.set(lane, entry);
  }
  return [...lanes.values()].sort((left, right) => right.emitted - left.emitted);
}

/** Each lane keeps its best `k` findings per pull request, in the order the ranker put them. */
function perLaneBudget(rows, k) {
  const byPr = new Map();
  for (const row of rows) {
    const pr = pullRequestOf(row);
    if (!byPr.has(pr)) byPr.set(pr, []);
    byPr.get(pr).push(row);
  }
  const kept = [];
  for (const list of byPr.values()) {
    const used = new Map();
    for (const row of [...list].sort((left, right) => scoreOf(right) - scoreOf(left))) {
      const lane = String(row.lane ?? 'none');
      const count = used.get(lane) ?? 0;
      if (count >= k) continue;
      used.set(lane, count + 1);
      kept.push(row);
    }
  }
  return kept;
}

/** Each lane is guaranteed its best `k`, then the rest of the slots follow the global order up to `budget`. */
function floorThenBudget(rows, k, budget) {
  const byPr = new Map();
  for (const row of rows) {
    const pr = pullRequestOf(row);
    if (!byPr.has(pr)) byPr.set(pr, []);
    byPr.get(pr).push(row);
  }
  const kept = [];
  for (const list of byPr.values()) {
    const sorted = [...list].sort((left, right) => scoreOf(right) - scoreOf(left));
    const chosen = new Set();
    const used = new Map();
    for (const row of sorted) {
      const lane = String(row.lane ?? 'none');
      const count = used.get(lane) ?? 0;
      if (count >= k) continue;
      used.set(lane, count + 1);
      chosen.add(row);
    }
    for (const row of sorted) {
      if (chosen.size >= budget) break;
      chosen.add(row);
    }
    kept.push(...chosen);
  }
  return kept;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifact = JSON.parse(readFileSync(options.artifact, 'utf8'));
  const rows = rankableOf(artifact);
  const denominator = goldens(artifact);
  const creditOf = (row) => row.matchedGoldens ?? [];
  if (rows.length === 0)
    throw new Error('the artifact ranks no rows, so there is nothing to allocate');

  const shippedSteps = artifact.emissionRules?.shipped?.steps ?? null;
  if (shippedSteps === null)
    throw new Error('the artifact does not publish its shipped cut, so there is no point to read');

  /**
   * **The drop steps apply to every allocation, not only to the shipped one.**
   *
   * A comparison between an allocation with `drop test` in front of it and one without is a comparison of two emissions,
   * and the lane table above shows why that matters: `testing` emits 94 rows and the shipped cut keeps 7 of them, so an
   * arm without the drop would be buying a different pool and crediting itself for the difference. **The cut's budget
   * is the thing under test, and it is the only step the arms vary.**
   */
  const drops = shippedSteps.filter((step) => step.kind !== 'budget');
  const pool = drops.length === 0 ? rows : applyCut(rows, drops);
  const shipped = applyCut(rows, shippedSteps);
  const shippedScore = score(shipped, creditOf, denominator);
  const lanes = laneTable(rows, shipped, creditOf);

  /**
   * **The lane table has to add back up to the figure it decomposes**, and it is checked here rather than asserted in
   * prose: a table whose `keptCredited` column sums to something other than the shipped true positives is a table about
   * a different set of rows (`§124`).
   */
  const creditedKept = lanes.reduce((count, lane) => count + lane.keptCredited, 0);
  if (creditedKept < shippedScore.truePositives) {
    throw new Error(
      `the lanes report ${String(creditedKept)} credited rows kept against ${String(shippedScore.truePositives)} ` +
        'true positives - a matching credits fewer pairs than rows, never more, so these are not the same rows',
    );
  }

  const rowsOut = [
    `lane budget · ${options.label ?? options.artifact} · ${String(rows.length)} ranked rows · ` +
      `${String(denominator)} goldens`,
    `  shipped      emitted ${String(shippedScore.emitted)}  tp ${String(shippedScore.truePositives)}  ` +
      `P ${shippedScore.precision.toFixed(4)}  R ${shippedScore.recall.toFixed(4)}  F1 ${shippedScore.f1.toFixed(4)}`,
    '',
    'lane                emitted  credited   kept  keptCredited  lost',
  ];
  for (const lane of lanes) {
    rowsOut.push(
      `  ${lane.lane.padEnd(16)}${String(lane.emitted).padStart(8)}${String(lane.credited).padStart(10)}` +
        `${String(lane.kept).padStart(7)}${String(lane.keptCredited).padStart(14)}${String(lane.credited - lane.keptCredited).padStart(6)}`,
    );
  }
  rowsOut.push('');
  rowsOut.push('allocation                          emitted    tp      F1     delta');

  const allocations = [];
  const record = (label, kept) => {
    const result = score(kept, creditOf, denominator);
    allocations.push({
      label,
      emitted: result.emitted,
      truePositives: result.truePositives,
      f1: result.f1,
      delta: result.f1 - shippedScore.f1,
    });
    const delta = `${result.f1 - shippedScore.f1 >= 0 ? '+' : ''}${(result.f1 - shippedScore.f1).toFixed(4)}`;
    rowsOut.push(
      `  ${label.padEnd(34)}${String(result.emitted).padStart(7)}${String(result.truePositives).padStart(6)}` +
        `${result.f1.toFixed(4).padStart(8)}${delta.padStart(10)}`,
    );
  };
  record(`shipped (${shippedSteps.map((step) => step.kind).join('>')})`, shipped);
  record('unbudgeted', pool);
  for (const k of options.floors) {
    record(`per-lane budget ${String(k)}`, perLaneBudget(pool, k));
  }
  for (const k of options.floors) {
    // **The shipped budget, so the floor is the only difference**: an allocation that adds comments cannot be compared
    // with one that does not, and the whole claim is that fairness is free.
    // **The budget is the step's `k`**, not `point.k`: `point` is the artifact's own operating point record, and reading
    // a budget out of it produced a "floor" arm that kept every row, which is the arithmetic silently answering a
    // different question than the label said.
    const budget = Number(shippedSteps.find((step) => step.kind === 'budget')?.k ?? 12);
    record(`floor ${String(k)} + budget ${String(budget)}`, floorThenBudget(pool, k, budget));
  }

  const best = allocations.reduce((top, row) => (row.f1 > top.f1 ? row : top), allocations[0]);
  rowsOut.push('');
  rowsOut.push(
    `  the best allocation is \`${best.label}\` at ${best.f1.toFixed(4)}, ${best.delta >= 0 ? '+' : ''}${best.delta.toFixed(4)} ` +
      `against the shipped point${best.delta <= 0 ? ' - **the cut is not the constraint, for the fourth time**' : ''}`,
  );
  process.stdout.write(`${rowsOut.join('\n')}\n`);

  if (options.json !== null) {
    writeFileSync(
      options.json,
      `${JSON.stringify(
        {
          version: 'lane-budget-v1',
          // **The label is what a reader can follow to the run**, and a `/tmp` artifact path is not one.
          source: options.label ?? options.artifact,
          rankedRows: rows.length,
          goldens: denominator,
          shipped: {
            steps: shippedSteps,
            emitted: shippedScore.emitted,
            truePositives: shippedScore.truePositives,
            precision: shippedScore.precision,
            recall: shippedScore.recall,
            f1: shippedScore.f1,
          },
          lanes,
          allocations,
          best: { label: best.label, f1: best.f1, delta: best.delta },
        },
        null,
        2,
      )}\n`,
    );
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 2;
}
