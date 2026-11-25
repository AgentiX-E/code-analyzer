#!/usr/bin/env node
/**
 * Render the cut curves as one self-contained page.
 *
 * **Why a page and not the table in §158.** The table states three readings; the question a reader actually has is *what
 * shape is the curve* - whether the shipped twelve sits on a plateau or a cliff, whether the best budget is a peak or a
 * shoulder - and that is a picture, not a cell. `docs/EVAL-CONTRACT.md` §158 keeps the figures; this page draws them.
 *
 * **Read, never recomputed.** Every number on the page comes from a `cut-curve.json` written by
 * `scripts/cut-curve.mjs`, so the page cannot disagree with the instrument: it refuses a file whose `version` it does not
 * know, a file with no curve in it, and - the one that matters - a file whose `best.budget` is not a row of the curve it
 * claims to be the best of.
 *
 * **Self-contained by rule, for the reason `scripts/capability-register.mjs` gives.** No `script src`, no `link href`, no
 * `fetch`: the page survives being emailed or opened from a file system. The tabs are radio inputs and sibling selectors,
 * so the page is clickable without a line of JavaScript.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'docs', 'cut-curve.html');

/** The three readings S35 produced, in the order the page should show them. */
export const SOURCES = [
  'benchmarks/cut-curve-aacr.json',
  'benchmarks/cut-curve-martian.json',
  'benchmarks/cut-curve-martian-core.json',
];

/** Raised for input this renderer will not draw, rather than drawing an empty panel over it. */
export class UnreadableCurveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnreadableCurveError';
  }
}

const escape = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fixed = (value) => Number(value).toFixed(4);

/** A board name from the artifact it was measured on, because the file name is the only identity a curve carries. */
export function boardOf(record) {
  const name =
    String(record?.artifact ?? '')
      .split('/')
      .pop() ?? '';
  if (name.startsWith('aacr')) return 'AACR-Bench';
  if (name.startsWith('martian')) return 'Martian Code Review Bench';
  return name;
}

/** A basis name, because `all` and `core` are denominators and not labels. */
export const basisOf = (record) =>
  record?.profile === 'all' ? 'all goldens' : `profile ${record?.profile}`;

/**
 * Read one file into one record, or refuse it.
 *
 * **The third check is the one a table can pass and a page cannot:** `best` is a claim about the curve, so a file whose
 * best budget is not a row of its own curve is a figure that was written rather than read.
 */
export function read(source, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UnreadableCurveError(`${source}: not JSON (${error.message})`);
  }
  if (parsed?.version !== 'cut-curve-v1')
    throw new UnreadableCurveError(
      `${source}: version ${JSON.stringify(parsed?.version)} is not cut-curve-v1`,
    );
  const record = parsed.results?.[0];
  if (record === undefined) throw new UnreadableCurveError(`${source}: holds no curve`);
  if (!Array.isArray(record.curve) || record.curve.length === 0)
    throw new UnreadableCurveError(`${source}: holds no curve`);
  for (const row of record.curve) {
    if (typeof row?.budget !== 'number' || typeof row?.f1 !== 'number')
      throw new UnreadableCurveError(`${source}: a curve row is not {budget, f1}`);
  }
  if (!record.curve.some((row) => row.budget === record.best?.budget))
    throw new UnreadableCurveError(
      `${source}: the best budget ${String(record.best?.budget)} is not a row of the curve`,
    );
  return record;
}

/** One panel: the curve as a polyline, the shipped point and the best point marked, and the rows beneath it. */
export function chart(record) {
  const width = 720;
  const height = 240;
  const padding = { left: 56, right: 96, top: 30, bottom: 54 };
  const rows = record.curve;
  const values = rows.map((row) => row.f1);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low === 0 ? 0.01 : high - low;
  const x = (index) =>
    padding.left + (index * (width - padding.left - padding.right)) / Math.max(1, rows.length - 1);
  const y = (value) =>
    padding.top + (1 - (value - low) / span) * (height - padding.top - padding.bottom);
  const line = rows.map((row, index) => `${x(index).toFixed(1)},${y(row.f1).toFixed(1)}`).join(' ');
  const shipped = rows.findIndex((row) => row.budget === record.shippedBudget);
  const best = rows.findIndex((row) => row.budget === record.best?.budget);
  const dot = (index, colour, radius) =>
    index === -1
      ? ''
      : `<circle cx="${x(index).toFixed(1)}" cy="${y(rows[index].f1).toFixed(1)}" r="${String(radius)}" fill="${colour}" />`;
  const ticks = [low, low + span / 2, high]
    .map(
      (value) =>
        `<text x="${String(padding.left - 10)}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end" class="tick">${fixed(value)}</text>` +
        `<line x1="${String(padding.left)}" y1="${y(value).toFixed(1)}" x2="${String(width - padding.right)}" y2="${y(value).toFixed(1)}" class="grid" />`,
    )
    .join('');
  const labels = rows
    .map(
      (row, index) =>
        `<text x="${x(index).toFixed(1)}" y="${String(height - 32)}" text-anchor="middle" class="tick">${String(row.budget)}</text>`,
    )
    .join('');
  const bestLabel =
    best === -1
      ? ''
      : `<text x="${x(best).toFixed(1)}" y="${(y(rows[best].f1) - 10).toFixed(1)}" text-anchor="middle" class="best">${fixed(rows[best].f1)}</text>`;
  const shippedLabel =
    shipped === -1
      ? ''
      : `<text x="${x(shipped).toFixed(1)}" y="${(y(rows[shipped].f1) + 20).toFixed(1)}" text-anchor="middle" class="shipped">shipped ${String(rows[shipped].budget)}</text>`;
  return `<svg viewBox="0 0 ${String(width)} ${String(height)}" role="img" aria-label="F1 against the per-pull-request budget">
  <style>
    .grid { stroke: #d8dee9; stroke-width: 1; }
    .tick { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #4c566a; }
    .best { font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #2f6f4f; }
    .shipped { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8a3b3b; }
    .curve { fill: none; stroke: #2e3440; stroke-width: 2; }
  </style>
  ${ticks}
  ${labels}
  <polyline class="curve" points="${line}" />
  ${dot(shipped, '#8a3b3b', 4)}
  ${dot(best, '#2f6f4f', 5)}
  ${bestLabel}
  ${shippedLabel}
  <text x="${String(padding.left)}" y="${String(padding.top - 10)}" class="tick">F1</text>
  <text x="${((padding.left + width - padding.right) / 2).toFixed(1)}" y="${String(height - 8)}" text-anchor="middle" class="tick">comments per pull request</text>
</svg>`;
}

/** The rows of one curve, with the shipped and best budgets named in the row rather than left to colour. */
export function table(record) {
  return `<table>
  <thead><tr><th>budget</th><th>emitted</th><th>TP</th><th>P</th><th>R</th><th>F1</th><th></th></tr></thead>
  <tbody>${record.curve
    .map(
      (row) =>
        `<tr${row.budget === record.best?.budget ? ' class="best"' : ''}><td>${String(row.budget)}</td>` +
        `<td>${String(row.emitted)}</td><td>${String(row.truePositives)}</td>` +
        `<td>${fixed(row.precision)}</td><td>${fixed(row.recall)}</td><td>${fixed(row.f1)}</td>` +
        `<td>${row.budget === record.shippedBudget ? 'shipped' : ''}${row.budget === record.best?.budget ? ' best' : ''}</td></tr>`,
    )
    .join('')}</tbody>
</table>`;
}

/** The summary, which is the claim: what the shipped cut reads, what the best reads, and what the held-out half said. */
export function summary(record, index) {
  const shipped = record.shipped === null ? null : record.shipped;
  const half = record.splitHalf;
  const gain = record.costAtBest;
  return `<tr>
  <td><label class="jump" for="view-${String(index)}">${escape(boardOf(record))}</label></td>
  <td>${escape(basisOf(record))}</td>
  <td>${record.goldens}</td>
  <td>${shipped === null ? '<em>no cut</em>' : fixed(shipped.f1)}</td>
  <td>${String(record.best.budget)}</td>
  <td>${fixed(record.best.f1)}</td>
  <td>${gain === null ? '&mdash;' : `${gain > 0 ? '+' : ''}${fixed(gain)}`}</td>
  <td>${
    half === undefined
      ? '&mdash;'
      : `${fixed(half.heldOut.f1)} against ${half.heldOutAtShipped === null ? 'no cut' : fixed(half.heldOutAtShipped.f1)}` +
        `${half.gain === null ? '' : ` (${half.gain > 0 ? '+' : ''}${fixed(half.gain)})`}`
  }</td>
</tr>`;
}

/** The whole document. Deterministic: no clock, no run id, and the order is the order of the arguments. */
export function page(records) {
  if (records.length === 0) throw new UnreadableCurveError('no curves to draw');
  const panels = records
    .map(
      (record, index) => `<section class="panel" data-view="${String(index)}">
  <h2>${escape(boardOf(record))} &middot; ${escape(basisOf(record))}</h2>
  <p class="meta">artifact <code>${escape(record.artifact)}</code> &middot; cut <code>${escape(record.cut)}</code> &middot; goldens ${String(record.goldens)}</p>
  ${chart(record)}
  ${table(record)}
</section>`,
    )
    .join('\n');
  // **The inputs are siblings of the panels, not children of the nav.** `input:checked ~ .panel` is a sibling
  // selector, so a tab strip that wrapped its inputs in a `<nav>` would render every panel hidden - which is what the
  // first version of this page did, and the screenshot was blank.
  const inputs = records
    .map(
      (_, index) =>
        `<input type="radio" name="view" id="view-${String(index)}"${index === 0 ? ' checked' : ''} />`,
    )
    .join('\n');
  const tabs = records
    .map(
      (record, index) =>
        `<label for="view-${String(index)}">${escape(boardOf(record))} &middot; ${escape(basisOf(record))}</label>`,
    )
    .join('\n');
  const active = records
    .map((_, index) => `#view-${String(index)}:checked ~ nav label[for="view-${String(index)}"]`)
    .join(',\n  ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>The cut is a device, priced on both boards</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 980px; padding: 32px 20px 64px; font: 15px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; color: #2e3440; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 24px 0 6px; }
  .lede { color: #4c566a; margin: 0 0 20px; }
  .meta { color: #4c566a; font-size: 13px; margin: 0 0 10px; }
  input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 8px; }
  nav label { border: 1px solid #d8dee9; border-radius: 999px; padding: 5px 13px; cursor: pointer; font-size: 13px; background: #fff; }
  ${active} { background: #2e3440; color: #fff; border-color: #2e3440; }
  input:focus-visible ~ nav label { outline: 2px solid #5e81ac; outline-offset: 2px; }
  .panel { display: none; }
  ${records.map((_, index) => `#view-${String(index)}:checked ~ .panel[data-view="${String(index)}"]`).join(',\n  ')} { display: block; }
  table { border-collapse: collapse; width: 100%; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
  th, td { text-align: right; padding: 4px 8px; border-bottom: 1px solid #eceff4; }
  th:first-child, td:first-child { text-align: left; }
  thead th { border-bottom: 1px solid #d8dee9; color: #4c566a; font-weight: 600; }
  tr.best td { background: #eef6f0; }
  td:nth-child(7) { text-align: left; color: #4c566a; }
  .grid { stroke: #d8dee9; }
  footer { margin-top: 40px; color: #4c566a; font-size: 12px; }
  code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .summary { margin-bottom: 22px; }
  .summary td:first-child, .summary th:first-child,
  .summary td:nth-child(2), .summary th:nth-child(2),
  .summary td:last-child, .summary th:last-child { text-align: left; }
  .jump { cursor: pointer; border-bottom: 1px dotted #4c566a; }
  .summary { margin-bottom: 20px; }
  .summary td, .summary th { text-align: right; }
  .summary td:first-child, .summary th:first-child, .summary td:nth-child(2), .summary th:nth-child(2), .summary td:last-child, .summary th:last-child { text-align: left; }
  .jump { cursor: pointer; border-bottom: 1px dotted #4c566a; }
</style>
</head>
<body>
<h1>The cut is a device, priced on both boards</h1>
<p class="lede">Three curves over verdicts the runs already paid for. <strong>F1 = 2&middot;TP/(emitted + goldens)</strong>, so the
per-pull-request budget is a term in the figure and not a setting outside it. The shipped <code>budget: 12</code> was chosen on
AACR; these pages show what it is worth on the board it was fitted to and on the board it was not.</p>
${inputs}
<nav>
${tabs}
</nav>
<h2>What the three curves say</h2>
<table class="summary">
  <thead><tr><th>board</th><th>basis</th><th>goldens</th><th>shipped 12</th><th>best k</th><th>best F1</th><th>gain</th><th>held out, chosen vs shipped</th></tr></thead>
  <tbody>${records.map(summary).join('\n')}</tbody>
</table>
${panels}
<footer>Rendered from <code>benchmarks/cut-curve-*.json</code> by <code>scripts/cut-curve-page.mjs</code>, which writes
nothing it did not read. The instrument that produced those files is <code>scripts/cut-curve.mjs</code>; the argument is
<code>docs/EVAL-CONTRACT.md</code> §158. No external request is made by this page.</footer>
</body>
</html>
`;
}

export function main(argv) {
  const sources = argv.length === 0 ? SOURCES.map((source) => join(ROOT, source)) : argv;
  const records = sources.map((source) => read(source, readFileSync(source, 'utf8')));
  writeFileSync(TARGET, page(records));
  process.stdout.write(`wrote ${TARGET} from ${String(records.length)} curves\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
