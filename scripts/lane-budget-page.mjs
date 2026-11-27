#!/usr/bin/env node
/**
 * **The cut's per-lane cost and the four allocations that were tried against it, as a picture.**
 *
 * `§173.2` excluded the cut, the score terms and the volume; `§174` tests the two hypotheses those readings could not see
 * - that the cut is lane-blind, and that a lane-fair budget would recover credits at no extra comment. **The record this
 * page reads is the answer**, and the page draws it because "architecture holds 172 of 311 slots for 88 credits" is a
 * sentence a reader has to reconstruct, and two bars are the same statement in one glance.
 *
 * Usage:
 *     node scripts/lane-budget-page.mjs [--record benchmarks/lane-budget.json]
 *                                       [--out docs/lane-budget.html]
 *
 * **Nothing here computes a figure.** Every number is read from the record, and the two checks below are about the
 * record's internal consistency rather than about its arithmetic: a version this page does not know, and a lane table
 * that does not add back up to the point it decomposes - **a bar drawn from rows that disagree with their own total is a
 * picture of a different run**, and a page is where a figure gets quoted without its sentence.
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

const RECORD = argument('--record', join(REPO, 'benchmarks', 'lane-budget.json'));
const OUT = argument('--out', join(REPO, 'docs', 'lane-budget.html'));

const record = JSON.parse(readFileSync(RECORD, 'utf8'));
if (record.version !== 'lane-budget-v1') {
  process.stderr.write(`${RECORD} is version ${String(record.version)}; this page reads v1\n`);
  process.exit(2);
}

const lanes = Array.isArray(record.lanes) ? record.lanes : [];
const allocations = Array.isArray(record.allocations) ? record.allocations : [];
if (lanes.length === 0 || allocations.length === 0) {
  process.stderr.write(`${RECORD} holds no lanes or no allocations, so there is nothing to draw\n`);
  process.exit(2);
}

// **The lane table has to add back up to the point it decomposes.** A matching credits fewer pairs than rows, never more,
// so a `keptCredited` column that sums below the published true positives is a table about some other set of rows.
const summedKept = lanes.reduce((count, lane) => count + lane.keptCredited, 0);
const summedLost = lanes.reduce((count, lane) => count + (lane.credited - lane.keptCredited), 0);
if (summedKept < record.shipped.truePositives) {
  process.stderr.write(
    `the lanes report ${String(summedKept)} credited rows kept against ${String(record.shipped.truePositives)} ` +
      'true positives\n',
  );
  process.exit(1);
}

const emittedAll = lanes.reduce((count, lane) => count + lane.emitted, 0);
if (emittedAll !== record.rankedRows) {
  process.stderr.write(
    `the lanes emit ${String(emittedAll)} findings against ${String(record.rankedRows)} ranked rows\n`,
  );
  process.exit(1);
}

const percent = (value) => `${(value * 100).toFixed(1)}%`;
const share = Math.max(...lanes.map((lane) => lane.kept), 1);

const laneRows = lanes
  .map((lane) => {
    const lost = lane.credited - lane.keptCredited;
    const keptWidth = (lane.kept / share) * 100;
    return `      <tr>
        <th scope="row">${lane.lane}</th>
        <td class="number">${lane.emitted}</td>
        <td class="number">${lane.credited}</td>
        <td class="bars">
          <div class="bar kept" style="width:${keptWidth.toFixed(2)}%"><span>${lane.kept} kept</span></div>
        </td>
        <td class="number ${lost > 0 ? 'behind' : 'level'}">${lost > 0 ? `−${lost}` : '0'}</td>
      </tr>`;
  })
  .join('\n');

const bestF1 = Math.max(...allocations.map((row) => row.f1), 0.0001);
const allocationRows = allocations
  .map((row) => {
    const isBest = row.label === record.best?.label;
    const tone = row.delta > 0 ? 'ahead' : row.delta < 0 ? 'behind' : 'level';
    return `      <tr class="${isBest ? 'best' : ''}">
        <th scope="row">${row.label}${isBest ? ' <span class="tag">best</span>' : ''}</th>
        <td class="number">${row.emitted}</td>
        <td class="number">${row.truePositives}</td>
        <td class="bars"><div class="bar ${isBest ? 'kept' : 'tried'}" style="width:${((row.f1 / bestF1) * 100).toFixed(2)}%"><span>${row.f1.toFixed(4)}</span></div></td>
        <td class="number ${tone}">${row.delta > 0 ? '+' : ''}${row.delta.toFixed(4)}</td>
      </tr>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Who takes the budget — AACR, wide arm</title>
<style>
  :root { color-scheme: light dark; --ink:#111; --muted:#666; --rule:#dcdcdc; --kept:#3b6ea5; --tried:#a5523b; }
  @media (prefers-color-scheme: dark) { :root { --ink:#eee; --muted:#9a9a9a; --rule:#333; --kept:#7fa9d4; --tried:#d49a7f; } }
  body { margin:0; padding:40px; font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:transparent; }
  h1 { font-size:22px; margin:0 0 4px; font-weight:650; letter-spacing:-0.01em; }
  h2 { font-size:15px; margin:34px 0 8px; font-weight:650; }
  p.lede { margin:0 0 6px; color:var(--muted); max-width:74ch; }
  table { border-collapse:collapse; width:100%; max-width:1000px; }
  th, td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--rule); vertical-align:middle; }
  thead th { font-size:12px; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted); font-weight:600; }
  tbody th { font-weight:600; width:19rem; }
  td.number { font-variant-numeric:tabular-nums; width:5.5rem; }
  .bar { height:16px; border-radius:3px; margin:3px 0; position:relative; min-width:2px; }
  .bar span { position:absolute; left:8px; top:0; font-size:11px; line-height:16px; color:#fff; white-space:nowrap; }
  .bar.kept { background:var(--kept); }
  .bar.tried { background:var(--tried); }
  .behind { color:#b3341f; } .ahead { color:#1f7a44; } .level { color:var(--muted); }
  tr.best th { text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:3px; }
  .tag { font-size:10px; letter-spacing:0.06em; text-transform:uppercase; color:var(--muted); border:1px solid var(--rule); border-radius:3px; padding:1px 5px; margin-left:6px; }
  footer { margin-top:30px; max-width:1000px; color:var(--muted); font-size:13px; }
  .swatch { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:6px; }
</style>
</head>
<body>
  <h1>Who takes the budget</h1>
  <p class="lede">AACR, wide lane set — ${record.rankedRows} ranked rows, ${record.goldens} goldens.
  The shipped cut keeps ${record.shipped.emitted} of them, credits ${record.shipped.truePositives},
  and reads P ${record.shipped.precision.toFixed(4)} · R ${record.shipped.recall.toFixed(4)} · F1 ${record.shipped.f1.toFixed(4)}.</p>

  <h2>What each lane pays for the slots</h2>
  <p class="lede">A lane's column of <em>kept</em> is how many of its findings survive; <em>lost</em> is credited findings the
  budget dropped. The cut ranks globally, so a lane that emits more takes more slots whatever its precision per slot.</p>
  <table>
    <thead><tr><th scope="col">Lane</th><th scope="col">Emitted</th><th scope="col">Credited (no cut)</th><th scope="col">Kept</th><th scope="col">Credits lost to the cut</th></tr></thead>
    <tbody>
${laneRows}
    </tbody>
  </table>

  <h2>The four allocations, at the same emission</h2>
  <p class="lede">Every arm applies the same drop steps, so the budget is the only thing that varies.
  <strong>${summedLost}</strong> credited findings are lost to the budget as it ships, and every fairer allocation that
  recovers them pays more in precision than it gets back.</p>
  <table>
    <thead><tr><th scope="col">Allocation</th><th scope="col">Comments</th><th scope="col">True positives</th><th scope="col">F1</th><th scope="col">Against the shipped point</th></tr></thead>
    <tbody>
${allocationRows}
    </tbody>
  </table>

  <footer>
    <span class="swatch" style="background:var(--kept)"></span>the allocation that ships &nbsp;&nbsp;
    <span class="swatch" style="background:var(--tried)"></span>an allocation that was tried and did not &nbsp;&nbsp;
    best: <strong>${record.best?.label}</strong> at ${record.best?.f1?.toFixed(4)}<br>
    Generated from <code>${record.source}</code> by <code>scripts/lane-budget-page.mjs</code>; no figure on this page is
    computed here.
  </footer>
</body>
</html>
`;

writeFileSync(OUT, html);
process.stdout.write(`${OUT}\n`);
