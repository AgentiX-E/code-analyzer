#!/usr/bin/env node
// @code-analyzer/code-analyzer — one pair of arms, two bills, and the inversion between them
//
// **The figure this file draws is the finding of §117 in one picture.** Two arms of one dispatch, differing by one lane
// out of five. On the left of each group, what the account was charged; on the right, what the same tokens would have
// cost with nothing warm. The arm with fewer lanes is **dearer as billed and cheaper on a cold cache**, because it ran
// first and wrote the prefix the other arm read.
//
// **Why a generator and not a drawing.** A hand-drawn chart of a run is a chart that outlives its run: this repository
// has one in `docs/figures/` whose two points are measured in different units. A script that reads the artifacts cannot
// drift from them, and `--check` compares the file it would write with the file in the tree so that a stale figure is a
// failing gate rather than a paragraph someone has to notice.
//
// **Usage.** `node scripts/cost-unit-figure.mjs <a.json> <b.json> [out.svg]`, where `b` is the arm the claim is about.
//
// **Why the figure is not in `docs/figures/`.** That directory is regenerated from data committed to the tree, and the
// link-check job diffs it against a fresh render so a stale picture is a failing build. This figure's data is two
// artifacts of a paid run - 6 MB of JSON that is a run's output and not the repository's - so it cannot be guarded that
// way, and putting it in a guarded directory would either fail every build or force 6 MB into the tree to satisfy a
// diff. `--check` is the guard instead, and it runs when a person regenerates.

import { readFileSync, writeFileSync } from 'node:fs';

import { readArm } from './lib/spend-pair.mjs';

// **Flags are stripped before the paths are read**, because `--check` in the third position used to be taken as the
// output path and the tool then compared the figure against a file called `--check`.
const positional = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const [aPath, bPath, out = 'docs/aacr-cost-two-units.svg'] = positional;
if (aPath === undefined || bPath === undefined) {
  console.error('usage: node scripts/cost-unit-figure.mjs <a.json> <b.json> [out.svg]');
  process.exit(1);
}

const { LLM_PRICE_TABLE, priceFor } =
  await import('../packages/intelligence/dist/review/llm/cost.js');

const load = (path) => JSON.parse(readFileSync(path, 'utf8'));
const a = load(aPath);
const b = load(bPath);
const model = a?.configuration?.judgeModel ?? 'deepseek-chat';
const row = priceFor(model) ?? LLM_PRICE_TABLE[0];
const prices = row.usdPerMillion;

const armA = readArm(a, prices);
const armB = readArm(b, prices);

const W = 960;
const H = 560;
const LEFT = 72;
const RIGHT = 28;
const TOP = 118;
const BOTTOM = 430;
const PLOT_W = W - LEFT - RIGHT;
const PLOT_H = BOTTOM - TOP;

const GROUPS = [
  { name: 'reviewer', key: 'engine' },
  { name: 'judge', key: 'judge' },
  { name: 'total', key: 'total' },
];

const series = [
  { label: `${armA.label}, as billed`, read: (group) => group.a.usd, fill: '#0969da' },
  { label: `${armA.label}, cold cache`, read: (group) => group.a.coldUsd, fill: '#54aeff' },
  { label: `${armB.label}, as billed`, read: (group) => group.b.usd, fill: '#bc4c00' },
  { label: `${armB.label}, cold cache`, read: (group) => group.b.coldUsd, fill: '#fb8f44' },
];

const rows = GROUPS.map((group) => ({
  name: group.name,
  values: series.map((s) => {
    const row = group.key === 'engine' ? 'engine' : group.key === 'judge' ? 'judge' : 'total';
    return s.read({ a: armA[row], b: armB[row] });
  }),
})).filter((row) => row.values.every((value) => typeof value === 'number'));

const max = Math.max(...rows.flatMap((row) => row.values));
const ceiling = Math.ceil(max * 1.15 * 2) / 2;
const y = (usd) => BOTTOM - (usd / ceiling) * PLOT_H;

const esc = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const percent = (value) => `${(value * 100).toFixed(1)} %`;
const ratio = (one, other) =>
  typeof one === 'number' && typeof other === 'number' ? one / other : null;

/** **The corpus denominator the artifact was scored against**, which is the two cells the point publishes. */
function goldensOf(artifact) {
  const full = artifact?.fullEmission ?? {};
  const total = Number(full.truePositives ?? 0) + Number(full.falseNegatives ?? 0);
  return total > 0 ? total : '?';
}

const out_lines = [];
out_lines.push(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" ` +
    `aria-label="Two arms of one dispatch billed twice: the arm with one lane fewer costs more as billed and less on a cold cache">`,
);
out_lines.push(`<rect width="${W}" height="${H}" fill="#ffffff" />`);
out_lines.push(
  `<text x="24" y="34" font-size="16" font-weight="700" fill="#1f2328">The same pair, in two units: the arm with one lane fewer is dearer as billed and cheaper on a cold cache</text>`,
);
out_lines.push(
  `<text x="24" y="54" font-size="11" fill="#57606a">USD per arm. The vendor's prefix cache is state that outlives the process, so the arm that runs second is billed less for the same tokens.</text>`,
);
// **The provenance is read off the artifacts, not typed into this file.** The first version of this line named a run, a
// row count and a golden count by hand - and it went on saying `44867457528, 100 pull requests, 724 goldens` after being
// pointed at the 46-row pair of `44891741390`, which is a figure whose caption describes a different run from the bars
// under it. The numbers a caption needs are in the artifact; a caption that cannot find them says so.
out_lines.push(
  `<text x="24" y="72" font-size="9" fill="#8c959f">source: run ${esc(
    String(a?.provenance?.runId ?? 'unknown'),
  )}, ${String(a?.prsReviewed ?? '?')} pull requests (skip ${String(a?.corpusSlice?.skip ?? '?')}), ${String(goldensOf(a))} goldens, ${esc(model)} at the repository's own price table · multiplier recovered per arm: ` +
    `${armA.engine.factor === null ? '-' : armA.engine.factor.toFixed(2)} and ${armB.engine.factor === null ? '-' : armB.engine.factor.toFixed(2)}</text>`,
);

// Gridlines and the axis.
for (let step = 0; step <= ceiling; step += 0.5) {
  const at = y(step);
  out_lines.push(
    `<line x1="${LEFT}" y1="${at.toFixed(2)}" x2="${W - RIGHT}" y2="${at.toFixed(2)}" stroke="#eaeef2" stroke-width="1" />`,
  );
  out_lines.push(
    `<text x="${LEFT - 8}" y="${(at + 3.5).toFixed(2)}" text-anchor="end" font-size="10" fill="#57606a">${step.toFixed(1)}</text>`,
  );
}
out_lines.push(
  `<line x1="${LEFT}" y1="${BOTTOM}" x2="${W - RIGHT}" y2="${BOTTOM}" stroke="#d0d7de" stroke-width="1" />`,
);

// The bars.
const groupW = PLOT_W / rows.length;
const BAR = 44;
const GAP = 9;
rows.forEach((row, index) => {
  const centre = LEFT + groupW * (index + 0.5);
  const span = row.values.length * BAR + (row.values.length - 1) * GAP;
  let x = centre - span / 2;
  row.values.forEach((usd, at) => {
    const height = (usd / ceiling) * PLOT_H;
    out_lines.push(
      `<rect x="${x.toFixed(1)}" y="${(BOTTOM - height).toFixed(1)}" width="${BAR}" height="${height.toFixed(1)}" fill="${series[at].fill}" opacity="0.9" />`,
    );
    out_lines.push(
      `<text x="${(x + BAR / 2).toFixed(1)}" y="${(BOTTOM - height - 6).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="#1f2328">${usd.toFixed(2)}</text>`,
    );
    x += BAR + GAP;
  });
  out_lines.push(
    `<text x="${centre.toFixed(1)}" y="${(BOTTOM + 20).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#1f2328">${row.name}</text>`,
  );
  // **The two ratios, under the group they belong to**, because the figure's whole claim is that they disagree.
  const billed = ratio(row.values[2], row.values[0]);
  const cold = ratio(row.values[3], row.values[1]);
  out_lines.push(
    `<text x="${centre.toFixed(1)}" y="${(BOTTOM + 36).toFixed(1)}" text-anchor="middle" font-size="9" fill="#57606a">` +
      `${esc(armB.label)}/${esc(armA.label)} · billed ${billed === null ? '-' : percent(billed)} · cold ${cold === null ? '-' : percent(cold)}</text>`,
  );
});

// Legend.
let legendX = LEFT;
series.forEach((s) => {
  out_lines.push(`<rect x="${legendX}" y="92" width="10" height="10" fill="${s.fill}" />`);
  out_lines.push(
    `<text x="${legendX + 14}" y="101" font-size="10" fill="#1f2328">${esc(s.label)}</text>`,
  );
  legendX += 16 + s.label.length * 5.4;
});

// The two cache ratios, which are the mechanism, printed where a reader will look for a reason.
out_lines.push(
  `<text x="${LEFT}" y="${BOTTOM + 66}" font-size="10" fill="#1f2328">cache hit share of prompt tokens · ${esc(armA.label)} ` +
    `${armA.engine.hitRatio === null ? '-' : percent(armA.engine.hitRatio)} · ${esc(armB.label)} ` +
    `${armB.engine.hitRatio === null ? '-' : percent(armB.engine.hitRatio)} · prompt tokens ` +
    `${armA.total.promptTokens.toLocaleString('en-US')} against ${armB.total.promptTokens.toLocaleString('en-US')}</text>`,
);
out_lines.push(
  `<text x="${LEFT}" y="${BOTTOM + 84}" font-size="10" fill="#cf222e">the billed figure and the cold-cache figure point opposite ways, so the difference is the cache state the arms ran in and not the work they did</text>`,
);
out_lines.push('</svg>');

const svg = out_lines.join('\n') + '\n';

if (process.argv.includes('--check')) {
  const current = readFileSync(out, 'utf8');
  if (current !== svg) {
    console.error(`${out} is stale: the artifacts it names now produce a different figure`);
    process.exit(1);
  }
  console.log(`${out} is current`);
} else {
  writeFileSync(out, svg);
  console.log(`wrote ${out} · ceiling ${ceiling} USD · ${rows.length} groups`);
}
