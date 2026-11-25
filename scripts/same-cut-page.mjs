#!/usr/bin/env node
/**
 * Render the two arms' curves on one axis, as one self-contained page.
 *
 * **Why a page and not the table in §162.** The table states fourteen rows of counts; the question a reader has is
 * *where the two lines are and how far apart*, and that is a picture of two polylines over one ordinal axis, not
 * fourteen pairs of numbers. §162 keeps the arithmetic; this page draws it.
 *
 * **Read, never recomputed.** Every number comes from a `same-cut-*.json` written by `scripts/same-cut.mjs`, so the page
 * cannot disagree with the instrument. It refuses a file whose `version` it does not know, a file with fewer than two
 * points, and - the one that matters - a file whose `comparison` is not aligned with both arms' own curves, because a
 * page that drew one arm's row beside another arm's row would be the defect §162 is named after, drawn.
 *
 * **Self-contained by rule, for the reason `scripts/cut-curve-page.mjs` gives.** No `script src`, no `link href`, no
 * `fetch`: the page survives being emailed or opened from a file system. The tabs are radio inputs and sibling
 * selectors, so the page is clickable without a line of JavaScript.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'docs', 'same-cut.html');

/**
 * The two denominators this page draws. **Both, because the board publishes both and a reader is entitled to see the
 * one it does not score**: the board scores `core` (158 of 173), and the `all` column is what every earlier section of
 * this repository published, so a page that drew only the board's profile would silently retire figures rather than
 * supersede them.
 */
export const SOURCES = ['benchmarks/same-cut-core.json', 'benchmarks/same-cut-all.json'];

/** Raised for input this renderer will not draw, rather than drawing an empty panel over it. */
export class UnreadableComparisonError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnreadableComparisonError';
  }
}

const escape = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fixed = (value) => Number(value).toFixed(4);
const signed = (value) => `${value > 0 ? '+' : ''}${Number(value).toFixed(4)}`;

/**
 * One record, refused unless it is a comparison this page knows how to draw.
 *
 * **The alignment check is the point.** `comparison[i].ours` must be the curve's own row at that budget and
 * `comparison[i].theirs` must be the other arm's row at the same budget: the page's whole claim is that the two numbers
 * in a row are about the same number of comments per pull request, so a row where the budgets differ is not a row.
 */
export function read(source, text) {
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new UnreadableComparisonError(`${source}: ${error.message}`);
  }
  if (record?.version !== 'same-cut-v1') {
    throw new UnreadableComparisonError(
      `${source}: version ${String(record?.version)} is not same-cut-v1`,
    );
  }
  const rows = record.comparison;
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new UnreadableComparisonError(`${source}: fewer than two cuts to draw`);
  }
  const ours = new Map((record.ours?.curve ?? []).map((row) => [row.budget, row]));
  const theirs = new Map((record.theirs?.curve ?? []).map((row) => [row.budget, row]));
  for (const row of rows) {
    const mine = ours.get(row.budget);
    const other = theirs.get(row.budget);
    if (mine === undefined || other === undefined) {
      throw new UnreadableComparisonError(
        `${source}: budget ${String(row.budget)} is in the comparison and not in both curves`,
      );
    }
    if (
      mine.emitted !== row.ours.emitted ||
      other.emitted !== row.theirs.emitted ||
      Math.abs(mine.f1 - row.ours.f1) > 1e-9 ||
      Math.abs(other.f1 - row.theirs.f1) > 1e-9
    ) {
      throw new UnreadableComparisonError(
        `${source}: budget ${String(row.budget)} does not agree with the curves it was built from`,
      );
    }
    if (Math.abs(row.gap - (row.ours.f1 - row.theirs.f1)) > 1e-9) {
      throw new UnreadableComparisonError(
        `${source}: the gap at budget ${String(row.budget)} is not ours minus theirs`,
      );
    }
  }
  checkBestMarker(record, source);
  return record;
}

/**
 * **A curve that is not single-peaked is still a curve**, so nothing here refuses one - but the best point is read from
 * the recorded `best`, and a file whose `best` is not the maximum of its own rows would draw a marker on the wrong dot.
 * That is a refusal, because the marker is the one thing on the chart a reader will believe without checking.
 */
function checkBestMarker(record, source) {
  for (const key of ['ours', 'theirs']) {
    const rows = record.comparison.map((row) => row[key].f1);
    const at = rows.indexOf(Math.max(...rows));
    if (record.best?.[key]?.budget !== record.comparison[at].budget) {
      throw new UnreadableComparisonError(
        `${source}: the recorded best ${key} budget is ${String(record.best?.[key]?.budget)} and the table peaks at ${String(record.comparison[at].budget)}`,
      );
    }
  }
}

/**
 * **Two polylines over one ordinal axis, and a gap strip under them.**
 *
 * The `x` axis is the budget as an ordinal - `1, 2, 3 … 24` - rather than as a distance, because the budgets were chosen
 * to sample the knee and equal spacing is what makes the knee visible. **The `y` axis starts below the lowest point
 * rather than at zero**: fourteen points between `0.18` and `0.39` drawn from zero would be two nearly flat lines, and
 * the reader would take a `0.05` gap for nothing.
 */
export function chart(record) {
  const width = 880;
  const plotLeft = 56;
  const plotRight = width - 150;
  const plotTop = 16;
  const plotHeight = 250;
  const rows = record.comparison;
  const values = rows.flatMap((row) => [row.ours.f1, row.theirs.f1]);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const span = Math.max(high - low, 0.02);
  const top = high + span * 0.12;
  const bottom = low - span * 0.12;
  const xAt = (index) => plotLeft + ((plotRight - plotLeft) * index) / (rows.length - 1);
  const yAt = (value) => plotTop + plotHeight * (1 - (value - bottom) / (top - bottom));

  const grid = [];
  const step = 0.05;
  for (let value = Math.ceil(bottom / step) * step; value <= top; value += step) {
    const y = yAt(value);
    grid.push(
      `<line x1="${String(plotLeft)}" y1="${y.toFixed(1)}" x2="${String(plotRight)}" y2="${y.toFixed(1)}" class="grid" />` +
        `<text x="${String(plotLeft - 8)}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="tick">${value.toFixed(2)}</text>`,
    );
  }

  const dots = (key) =>
    rows
      .map(
        (row, index) =>
          `<circle cx="${xAt(index).toFixed(1)}" cy="${yAt(row[key].f1).toFixed(1)}" r="2.6" class="${key}" />`,
      )
      .join('');

  const marker = (key, label) => {
    const index = rows.findIndex((row) => row.budget === record.best[key].budget);
    const x = xAt(index);
    const y = yAt(record.best[key].f1);
    return (
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" class="best ${key}" />` +
      `<text x="${(x + 8).toFixed(1)}" y="${(y - 8).toFixed(1)}" class="bestLabel">${escape(label)} ${record.best[key].f1.toFixed(4)}</text>`
    );
  };

  const axis = rows
    .map(
      (row, index) =>
        `<text x="${xAt(index).toFixed(1)}" y="${String(plotTop + plotHeight + 18)}" text-anchor="middle" class="tick">${String(row.budget)}</text>`,
    )
    .join('');

  // **The gap strip is a second scale, not a second chart.** Each bar is `|ours - theirs|` against the largest gap in the
  // panel, so the shape says *where the deficit is worst* without inviting a comparison with the F1 axis above it. **Its
  // numbers sit under the bars rather than over them**: the first version printed each value above its bar, which put
  // fourteen labels on the same row as the budget axis it was supposed to be read against.
  const stripTop = plotTop + plotHeight + 46;
  const stripHeight = 54;
  const worst = Math.max(...rows.map((row) => Math.abs(row.gap)), 1e-9);
  const bars = rows
    .map((row, index) => {
      const height = (Math.abs(row.gap) / worst) * stripHeight;
      const x = xAt(index) - 9;
      return (
        `<rect x="${x.toFixed(1)}" y="${(stripTop + stripHeight - height).toFixed(1)}" width="18" height="${height.toFixed(1)}" class="gapBar" />` +
        `<text x="${xAt(index).toFixed(1)}" y="${String(stripTop + stripHeight + 14)}" text-anchor="middle" class="tick">${row.gap.toFixed(3)}</text>`
      );
    })
    .join('');

  return `<svg viewBox="0 0 ${String(width)} ${String(stripTop + stripHeight + 34)}" role="img" aria-label="F1 against comments per pull request, both arms, ${escape(record.ours.profile)}">
  <style>
    .grid { stroke: #eceff4; stroke-width: 1; }
    .tick { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6b7280; }
    .ours { stroke: #2e3440; fill: #2e3440; }
    .theirs { stroke: #bf616a; fill: #bf616a; }
    polyline.ours, polyline.theirs { fill: none; stroke-width: 2; }
    .best { stroke: #fff; stroke-width: 2; }
    .bestLabel { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #2e3440; }
    .gapBar { fill: #d8dee9; }
  </style>
  ${grid.join('\n  ')}
  <polyline class="ours" points="${rows.map((row, index) => `${xAt(index).toFixed(1)},${yAt(row.ours.f1).toFixed(1)}`).join(' ')}" />
  <polyline class="theirs" points="${rows.map((row, index) => `${xAt(index).toFixed(1)},${yAt(row.theirs.f1).toFixed(1)}`).join(' ')}" />
  ${dots('ours')}
  ${dots('theirs')}
  ${marker('ours', 'ours')}
  ${marker('theirs', 'theirs')}
  ${axis}
  <text x="${String(plotLeft)}" y="${String(stripTop - 16)}" class="tick">gap: ours minus theirs at the same k (bars scaled to the largest gap in this panel)</text>
  ${bars}
  <text x="${String(plotRight + 8)}" y="${String(plotTop + 14)}" class="tick">&#9632; ours</text>
  <text x="${String(plotRight + 8)}" y="${String(plotTop + 30)}" class="tick" fill="#bf616a">&#9632; theirs</text>
  <text x="${String(plotRight + 8)}" y="${String(plotTop + 46)}" class="tick">k = comments</text>
  <text x="${String(plotRight + 8)}" y="${String(plotTop + 60)}" class="tick">per pull request</text>
</svg>`;
}

/** The rows, with both arms' counts on the same line so a reader can see what each figure was divided by. */
export function table(record) {
  const row = (entry) =>
    `<tr><td>${String(entry.budget)}</td>` +
    `<td>${String(entry.ours.emitted)}</td><td>${String(entry.ours.truePositives)}</td>` +
    `<td>${fixed(entry.ours.precision)}</td><td>${fixed(entry.ours.recall)}</td><td>${fixed(entry.ours.f1)}</td>` +
    `<td>${String(entry.theirs.emitted)}</td><td>${String(entry.theirs.truePositives)}</td>` +
    `<td>${fixed(entry.theirs.precision)}</td><td>${fixed(entry.theirs.recall)}</td><td>${fixed(entry.theirs.f1)}</td>` +
    `<td class="${entry.gap > 0 ? 'gain' : 'cost'}">${signed(entry.gap)}</td></tr>`;
  return `<table>
  <thead><tr><th>k</th><th>our comments</th><th>our TP</th><th>our P</th><th>our R</th><th>our F1</th><th>their comments</th><th>their TP</th><th>their P</th><th>their R</th><th>their F1</th><th>gap</th></tr></thead>
  <tbody>${record.comparison.map(row).join('')}</tbody>
</table>`;
}

/** The whole document. Deterministic: no clock, no run id, and the order is the order of the arguments. */
export function page(records) {
  if (records.length === 0) throw new UnreadableComparisonError('no comparisons to draw');
  const name = (record) => (record.ours.profile === 'core' ? "the board's 158" : 'all 173');
  const panels = records
    .map(
      (record, index) => `<section class="panel" data-view="${String(index)}">
  <h2>${escape(name(record))} &middot; ${String(record.ours.goldens)} goldens &middot; ${String(record.theirs.pullRequests)} of the board's 50 pull requests have competitor rows</h2>
  <p class="meta">our curve <code>${escape(record.ours.source)}</code> cut by <code>${escape(record.ours.cut)}</code> &middot; their rows <code>${escape(record.theirs.source)}</code>, ${String(record.theirs.emitted)} comments uncut, as published F1 ${fixed(record.theirs.asPublished.f1)}, through the gate ${fixed(record.theirs.gated.f1)}</p>
  ${chart(record)}
  ${table(record)}
</section>`,
    )
    .join('\n');
  const inputs = records
    .map(
      (_, index) =>
        `<input type="radio" name="view" id="view-${String(index)}"${index === 0 ? ' checked' : ''} />`,
    )
    .join('\n');
  const tabs = records
    .map((record, index) => `<label for="view-${String(index)}">${escape(name(record))}</label>`)
    .join('\n');
  const active = records
    .map((_, index) => `#view-${String(index)}:checked ~ nav label[for="view-${String(index)}"]`)
    .join(',\n  ');
  const summary = records
    .map(
      (record) =>
        `<tr><td>${escape(name(record))}</td><td>${String(record.ours.goldens)}</td>` +
        `<td>k=${String(record.best.ours.budget)} &middot; ${fixed(record.best.ours.f1)}</td>` +
        `<td>k=${String(record.best.theirs.budget)} &middot; ${fixed(record.best.theirs.f1)}</td>` +
        `<td class="${record.lead > 0 ? 'gain' : 'cost'}">${String(record.lead)} of ${String(record.comparison.length)}</td>` +
        `<td class="cost">${signed(record.best.ours.f1 - record.best.theirs.f1)}</td></tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Two emissions on one budget axis: where we lead, and where we do not</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 1040px; padding: 32px 20px 64px; font: 15px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; color: #2e3440; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 24px 0 6px; }
  .lede { color: #4c566a; margin: 0 0 20px; }
  .meta { color: #4c566a; font-size: 13px; margin: 0 0 10px; }
  input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 8px; }
  nav label { border: 1px solid #d8dee9; border-radius: 999px; padding: 5px 13px; cursor: pointer; font-size: 13px; background: #fff; }
  ${active} { background: #2e3440; color: #fff; border-color: #2e3440; }
  input:focus-visible ~ nav label { outline: 2px solid #5e81ac; outline-offset: 2px; }
  .panel { display: none; }
  ${records.map((_, index) => `#view-${String(index)}:checked ~ .panel[data-view="${String(index)}"]`).join(',\n  ')} { display: block; }
  table { border-collapse: collapse; width: 100%; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 12px; }
  th, td { text-align: right; padding: 4px 6px; border-bottom: 1px solid #eceff4; }
  th:first-child, td:first-child { text-align: left; }
  thead th { border-bottom: 1px solid #d8dee9; color: #4c566a; font-weight: 600; }
  .gain { color: #2f6f4f; }
  .cost { color: #8a3b3b; }
  footer { margin-top: 40px; color: #4c566a; font-size: 12px; }
  code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<h1>Two emissions on one budget axis</h1>
<p class="lede">The board's own comparison is at <strong>equal comments per pull request</strong>: every row below is the
same number of comments on both sides, so the difference between the two F1 columns is about what the two reviewers say
and not about how much either of them says. The dark line is our six-lane arm, the red line is the competitor driven
through its own CLI with the same model and judged by the same judge. <strong>A point on one line is comparable only with
the point above or below it at the same k</strong>, which is the error this page exists to stop being made.</p>
${inputs}
<nav>
${tabs}
</nav>
<h2>What the two curves say</h2>
<table>
  <thead><tr><th>profile</th><th>goldens</th><th>our best</th><th>their best</th><th>cuts where we lead</th><th>gap at each optimum</th></tr></thead>
  <tbody>${summary}</tbody>
</table>
${panels}
<footer>Rendered from <code>benchmarks/same-cut-*.json</code> by <code>scripts/same-cut-page.mjs</code>, which writes
nothing it did not read. The instrument is <code>scripts/same-cut.mjs</code>; the argument is
<code>docs/EVAL-CONTRACT.md</code> §162. No external request is made by this page.</footer>
</body>
</html>
`;
}

/**
 * **`--out` exists because a test that rendered this page in place would overwrite the committed one**, for the reason
 * `scripts/pool-density-page.mjs` records at the same place: a renderer whose only path is the shipped page is a renderer
 * whose tests rewrite the tree they are testing.
 */
export function main(argv) {
  let out = TARGET;
  const sources = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') out = argv[(i += 1)];
    else sources.push(argv[i]);
  }
  const paths = sources.length === 0 ? SOURCES.map((source) => join(ROOT, source)) : sources;
  const records = paths.map((source) => read(source, readFileSync(source, 'utf8')));
  writeFileSync(out, page(records));
  process.stdout.write(`wrote ${out} from ${String(records.length)} comparisons\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
