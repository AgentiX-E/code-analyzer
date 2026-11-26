#!/usr/bin/env node
/**
 * **The lanes as a page: what each one is paid, and what each one adds.**
 *
 * A per-lane table is a table a reader skims, and the reading §164 turns on is a *shape*: four lanes that credit goldens
 * and one that mostly re-states them look identical in a `credited` column and opposite in a chart of `credited` against
 * `unique`. So each lane is one row of two bars - everything it bought, and the part of it no other lane in the same run
 * bought - drawn from the record and not recomputed here.
 *
 * Usage:
 *     node scripts/lane-discovery-page.mjs [--record benchmarks/lane-discovery.json] [--out docs/lane-discovery.html]
 *                                          [--bar 0.3735]
 *
 * The record is written by `scripts/lane-discovery.mjs`; this file refuses a version it does not know, a record whose
 * guard does not reproduce the arm's own point, and a lane table whose uniques exceed the credits they are drawn from -
 * **a page that draws a bar longer than the number under it is a page nobody checks twice**.
 *
 * `--bar` is the F1 the campaign registers as its target, passed at the call site rather than written here: the page is
 * re-rendered every time the instrument runs, and **a target baked into a renderer is a target that moves silently the
 * next time a section registers a different one**.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

const RECORD = argument('--record', join(REPO, 'benchmarks', 'lane-discovery.json'));
const OUT = argument('--out', join(REPO, 'docs', 'lane-discovery.html'));
const BAR = argument('--bar', null);

const record = JSON.parse(readFileSync(RECORD, 'utf8'));
if (record.version !== 'lane-discovery-v1') {
  process.stderr.write(
    `lane-discovery.json is version ${String(record.version)}; this page reads v1\n`,
  );
  process.exit(2);
}

// **The guard travels in the record and is re-read here**, because a page is where a figure is most likely to be quoted
// without the sentence that says what it is: `published` and `rebuilt` disagreeing means the pool under these bars is not
// the arm's pool.
const disagrees = (record.guard ?? []).filter((entry) => entry.published !== entry.rebuilt);
if (disagrees.length > 0) {
  process.stderr.write(
    `the record's guard does not reproduce its own point: ${disagrees
      .map((entry) => `${entry.field} ${String(entry.published)} != ${String(entry.rebuilt)}`)
      .join(', ')}\n`,
  );
  process.exit(1);
}
if (!Array.isArray(record.lanes) || record.lanes.length === 0) {
  process.stderr.write('the record holds no lanes, so there is nothing to draw\n');
  process.exit(2);
}

// **A unique cannot exceed the total it is part of**, and a record that says otherwise was written by a different
// arithmetic than the one this page draws.
for (const lane of record.lanes) {
  if (lane.unique > lane.credited) {
    process.stderr.write(
      `${lane.lane} reports ${String(lane.unique)} uniques out of ${String(lane.credited)} credits\n`,
    );
    process.exit(1);
  }
}

// **The counterfactual's `from` side has to be the pool this page already drew**, or the two halves of the comparison come
// from different cuts and the delta between them is arithmetic nobody can check. And a counterfactual whose denominator
// moved is a comparison of two corpora, so it is refused rather than drawn with a footnote.
const counterfactual = record.counterfactual ?? null;
if (counterfactual !== null) {
  if (
    record.atBudget !== null &&
    counterfactual.atBudget.f1.from !== Number(record.atBudget.f1.toFixed(4))
  ) {
    process.stderr.write(
      `the counterfactual's "with" side reads F1 ${String(counterfactual.atBudget.f1.from)} and this record's point is ${record.atBudget.f1.toFixed(4)}\n`,
    );
    process.exit(1);
  }
  if (counterfactual.denominatorHeld !== true) {
    process.stderr.write(
      `dropping ${counterfactual.without.join(', ')} moved the denominator, so the delta is not the lanes\n`,
    );
    process.exit(1);
  }
}

const lanes = [...record.lanes].sort(
  (left, right) => right.unique - left.unique || right.credited - left.credited,
);
const scale = Math.max(...lanes.map((lane) => lane.credited), 1);
const number = (value) => Number(value).toFixed(4);
const percent = (value) => `${(value * 100).toFixed(1)}%`;

const laneRows = lanes
  .map((lane) => {
    const credited = (lane.credited / scale) * 100;
    const unique = (lane.unique / scale) * 100;
    return `<tr>
  <th scope="row"><code>${lane.lane}</code></th>
  <td class="bars"><span class="bar all" style="width:${credited.toFixed(1)}%"></span><span class="bar uniq" style="width:${unique.toFixed(1)}%"></span></td>
  <td class="n">${String(lane.findings)}</td>
  <td class="n">${String(lane.credited)}</td>
  <td class="n strong">${String(lane.unique)}</td>
  <td class="n">${number(lane.density)}</td>
</tr>`;
  })
  .join('\n');

const difference = record.difference;
const differenceBlock =
  difference === null
    ? `<p class="note">No reference arm was priced beside this one, so the page cannot say which goldens this arm names
that a previous arm did not. That is a dispatch asked for with <code>--reference</code>, not a defect of the run.</p>`
    : `<h2>Against <code>${difference.reference}</code>${difference.referenceLaneSet === null ? '' : ` (${difference.referenceLaneSet})`}</h2>
<table class="plain">
  <thead><tr><th>their ceiling</th><th>shared</th><th>only this arm</th><th>only theirs</th></tr></thead>
  <tbody><tr><td class="n">${String(difference.referenceCeiling)}</td><td class="n">${String(difference.shared)}</td><td class="n bold">${String(difference.onlyArm)}</td><td class="n">${String(difference.onlyReference)}</td></tr></tbody>
</table>
<p class="note">The union is not a superset in either direction: two lane sets name different goldens, and a set that
only added lanes would show <code>only theirs</code> at zero.</p>`;

const atBudget =
  record.atBudget === null
    ? `<p class="note">No budget was priced, so this page carries the ceiling and not a point.</p>`
    : `<dl class="point">
  <div><dt>comments</dt><dd>${String(record.atBudget.emitted)}</dd></div>
  <div><dt>credited</dt><dd>${String(record.atBudget.truePositives)}</dd></div>
  <div><dt>precision</dt><dd>${number(record.atBudget.precision)}</dd></div>
  <div><dt>recall</dt><dd>${number(record.atBudget.recall)}</dd></div>
  <div class="${BAR !== null && record.atBudget.f1 >= Number(BAR) ? 'pass' : ''}"><dt>F1</dt><dd>${number(record.atBudget.f1)}</dd></div>
  ${BAR === null ? '' : `<div class="target"><dt>the bar</dt><dd>${number(Number(BAR))}</dd></div>`}
</dl>`;

/** A delta with its sign, coloured by direction: a swap that costs recall is not a green row. */
const delta = (from, to, digits = 0) => {
  if (from === null || to === null) return '<td class="n">—</td>';
  const moved = Number((to - from).toFixed(4));
  const text =
    digits === 0
      ? `${moved > 0 ? '+' : ''}${String(moved)}`
      : `${moved > 0 ? '+' : ''}${moved.toFixed(4)}`;
  const tone = moved > 0 ? 'strong' : moved < 0 ? 'cost' : '';
  return `<td class="n ${tone}">${text}</td>`;
};

const counterfactualBlock =
  counterfactual === null
    ? ''
    : `<h2>What <code>${counterfactual.without.join(', ')}</code> buys, inside one run</h2>
<table class="plain swap">
  <thead><tr><th>reading</th><th class="n">with</th><th class="n">without</th><th class="n">Δ</th></tr></thead>
  <tbody>
    <tr><th scope="row">ceiling (credited goldens, no budget)</th><td class="n">${String(counterfactual.ceiling.from)}</td><td class="n">${String(counterfactual.ceiling.to)}</td>${delta(counterfactual.ceiling.from, counterfactual.ceiling.to)}</tr>
    <tr><th scope="row">credited at <code>k = ${String(counterfactual.atBudget.k)}</code></th><td class="n">${String(counterfactual.atBudget.truePositives.from)}</td><td class="n">${String(counterfactual.atBudget.truePositives.to)}</td>${delta(counterfactual.atBudget.truePositives.from, counterfactual.atBudget.truePositives.to)}</tr>
    <tr><th scope="row">comments at that budget</th><td class="n">${String(counterfactual.atBudget.comments.from)}</td><td class="n">${String(counterfactual.atBudget.comments.to)}</td>${delta(counterfactual.atBudget.comments.from, counterfactual.atBudget.comments.to)}</tr>
    <tr><th scope="row">F1 at that budget</th><td class="n">${number(counterfactual.atBudget.f1.from)}</td><td class="n">${number(counterfactual.atBudget.f1.to)}</td>${delta(counterfactual.atBudget.f1.from, counterfactual.atBudget.f1.to, 4)}</tr>
  </tbody>
</table>
<p class="note">Both columns are the <em>same artifact</em> under the same cut and the same ${String(record.goldens)} goldens:
${String(counterfactual.droppedFindings)} findings are the only thing between them. A comparison across two runs would
bundle the swap with everything two samples of a sampler disagree on, which on this board is 8 <code>architecture</code>
findings before a lane is touched.</p>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>What each lane adds, counted against the others</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 980px; padding: 32px 20px 64px; font: 15px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; color: #2e3440; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; }
  h2 { font-size: 17px; margin: 32px 0 8px; }
  p.lede { margin: 0 0 20px; color: #4c566a; max-width: 74ch; }
  p.note { color: #4c566a; font-size: 13.5px; max-width: 74ch; }
  code { font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #eceff4; padding: 1px 5px; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 4px; }
  th, td { padding: 7px 10px; border-bottom: 1px solid #e5e9f0; text-align: left; vertical-align: middle; }
  thead th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #7b8794; font-weight: 600; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 700; color: #2f6f4f; }
  .cost { color: #8a3b3b; }
  .bold { font-weight: 700; }
  table.swap th[scope="row"] { font-weight: 600; color: #2e3440; }
  table.swap td, table.swap th { padding: 6px 10px; }
  td.bars { width: 46%; position: relative; }
  .bar { display: block; height: 9px; border-radius: 3px; margin: 2px 0; }
  .bar.all { background: #cfd7e3; }
  .bar.uniq { background: #2f6f4f; }
  dl.point { display: flex; gap: 26px; flex-wrap: wrap; margin: 6px 0 0; }
  dl.point div { min-width: 74px; }
  dt { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #7b8794; }
  dd { margin: 2px 0 0; font-size: 20px; font-variant-numeric: tabular-nums; }
  dl.point .pass dd { color: #2f6f4f; }
  dl.point .target dd { color: #8a6d24; }
  .legend { display: flex; gap: 18px; font-size: 13px; color: #4c566a; margin: 4px 0 10px; }
  .legend i { display: inline-block; width: 22px; height: 9px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
  footer { margin-top: 40px; border-top: 1px solid #e5e9f0; padding-top: 14px; color: #7b8794; font-size: 12.5px; }
</style>
</head>
<body>
<h1>What each lane adds, counted against the others</h1>
<p class="lede">A lane that re-states a golden another lane already named adds a comment and no recall, and both rows carry
the same golden index — so the column that answers <em>was this call worth its price</em> is the one that counts what a
lane credits <strong>that no other lane in the same run does</strong>.</p>

<dl class="point">
  <div><dt>lanes</dt><dd>${String(record.laneSet ?? 'unknown')}</dd></div>
  <div><dt>comments</dt><dd>${String(record.emitted)}</dd></div>
  <div><dt>ceiling</dt><dd>${String(record.ceiling.credited)}</dd></div>
  <div><dt>goldens</dt><dd>${String(record.goldens)}</dd></div>
  <div><dt>profile</dt><dd>${record.profile}</dd></div>
</dl>
<p class="note">Cut: <code>${record.cut}</code>. Guard: ${(record.guard ?? []).map((entry) => `${entry.field} ${String(entry.rebuilt)}`).join(' · ')} — rebuilt from the arm's own rows before either number below was counted.</p>

<h2>${atBudget === null ? '' : 'The point'}${atBudget === null ? '' : ` at <code>k = ${String(record.atBudget.budget ?? '')}</code>`}</h2>
${atBudget}

<h2>Per lane</h2>
<div class="legend"><span><i style="background:#cfd7e3"></i>credited</span><span><i style="background:#2f6f4f"></i>unique to this lane</span></div>
<table class="lanes">
  <thead><tr><th>lane</th><th>credited / unique</th><th class="n">findings</th><th class="n">credited</th><th class="n">unique</th><th class="n">density</th></tr></thead>
  <tbody>
${laneRows}
  </tbody>
</table>
<p class="note">Density is credited goldens per finding inside the lane. ${percent(lanes.reduce((total, lane) => total + lane.unique, 0) / Math.max(1, record.ceiling.credited))} of the ceiling is owned by exactly one lane; the rest is named twice, which is what a run of six lanes is for.</p>

${counterfactualBlock}

${differenceBlock}

<footer>Drawn from <code>${record.arm}</code> by <code>scripts/lane-discovery-page.mjs</code>. ${record.profile} profile,
${String(record.goldens)} goldens, ${String(record.emitted)} comments. This page draws the record; it recomputes
nothing.</footer>
</body>
</html>
`;

writeFileSync(OUT, html);
process.stdout.write(
  `wrote ${OUT} (${String(lanes.length)} lanes, ceiling ${String(record.ceiling.credited)})\n`,
);
