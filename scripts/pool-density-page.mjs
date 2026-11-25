#!/usr/bin/env node
/**
 * Render the pool's two readings as one self-contained page.
 *
 * **Why a page and not the table in §161.** The table states densities and marginals; the question a reader actually has
 * is *where the pool's comments are and which of them the budget can pay for* - and that is two columns against each
 * other, not a cell. §161 keeps the figures; this page draws them.
 *
 * **Read, never recomputed.** Every number comes from a `pool-density*.json` written by `scripts/pool-density.mjs`, so the
 * page cannot disagree with the instrument: it refuses a file whose `version` it does not know, a file with no group in
 * it, and - the one that matters - a file whose reported share does not add up to its own pool.
 *
 * **Self-contained by rule, for the reason `scripts/cut-curve-page.mjs` gives.** No `script src`, no `link href`, no
 * `fetch`: the page survives being emailed or opened from a file system. The tabs are radio inputs and sibling selectors,
 * so the page is clickable without a line of JavaScript.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'docs', 'pool-density.html');

/**
 * The two readings this page draws: the same pool grouped two ways.
 *
 * **Both, because the two groupings answer different questions and neither is a rescaling of the other.** A lane is a
 * reviewer with a prompt; a category is a label one lane can wear for one comment. `architecture` writes 55.7 % of the
 * pool as `bug` findings, so a page that showed only lanes would leave a reader unable to tell whether the volume is a
 * lane's appetite or a category the corpus does not reward.
 */
export const SOURCES = ['benchmarks/pool-density.json', 'benchmarks/pool-density-category.json'];

/** Raised for input this renderer will not draw, rather than drawing an empty panel over it. */
export class UnreadableDensityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnreadableDensityError';
  }
}

const escape = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fixed = (value) => Number(value).toFixed(4);
const signed = (value) => `${value > 0 ? '+' : ''}${fixed(value)}`;

/** One record, refused unless it is a reading this page knows how to draw. */
export function read(source, text) {
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new UnreadableDensityError(`${source}: ${error.message}`);
  }
  if (record?.version !== 'pool-density-v1') {
    throw new UnreadableDensityError(
      `${source}: version ${String(record?.version)} is not pool-density-v1`,
    );
  }
  if (!Array.isArray(record.groups) || record.groups.length === 0) {
    throw new UnreadableDensityError(`${source}: no groups to draw`);
  }
  /**
   * **The shares have to add up to the pool they are shares of.** A group list that does not cover the pool is a reading
   * of part of it - a filter applied somewhere the header does not mention - and a page that drew it would present a
   * subset as the whole.
   */
  const covered = record.groups.reduce((total, group) => total + Number(group.comments), 0);
  if (covered !== record.pool) {
    throw new UnreadableDensityError(
      `${source}: the groups hold ${String(covered)} comments and the pool holds ${String(record.pool)}`,
    );
  }
  return record;
}

/**
 * A bar per group: the length is its density, and the two numbers beside it are its share of the pool and its marginal.
 *
 * **The share is a column rather than a mark on the bar.** The first version drew the group's share of the pool's credit as
 * an ellipse on the bar, and at these magnitudes every ellipse sat at the left end of a bar it was supposed to annotate -
 * a decoration that read as noise. **A number in a column is legible at every scale; a mark is legible only at some.**
 */
export function chart(record) {
  const height = 26;
  const width = 780;
  const label = 150;
  const scale = 280;
  const densityAt = label + scale + 12;
  const shareAt = width - 96;
  const deltaAt = width - 8;
  const high = Math.max(...record.groups.map((group) => Number(group.density)), 0.0001);
  const rows = record.groups.map((group, index) => {
    const value = Number(group.density);
    const bar = (value / high) * scale;
    return (
      `<g transform="translate(0,${String(index * height)})">` +
      `<text x="0" y="16" class="name">${escape(group.group)}</text>` +
      `<rect x="${String(label)}" y="4" width="${String(scale)}" height="14" class="track" />` +
      `<rect x="${String(label)}" y="4" width="${bar.toFixed(1)}" height="14" class="bar" />` +
      `<text x="${String(densityAt)}" y="16" class="value">${fixed(value)}</text>` +
      `<text x="${String(shareAt)}" y="16" text-anchor="end" class="value">${(Number(group.share) * 100).toFixed(1)}%</text>` +
      `<text x="${String(deltaAt)}" y="16" text-anchor="end" class="${Number(group.delta) > 0 ? 'gain' : 'cost'}">${signed(Number(group.delta))}</text>` +
      `</g>`
    );
  });
  // **The height is not optional**: an SVG with a `viewBox` and no second dimension clips its own contents at the
  // browser's default height, which is how the first version of this chart drew five bars and neither of its two numeric
  // columns.
  return `<svg viewBox="0 0 ${String(width)} ${String(record.groups.length * height + 28)}" role="img" aria-label="density by ${escape(record.group)}">
  <style>
    .name { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #2e3440; }
    .value { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #4c566a; }
    .gain { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #2f6f4f; }
    .cost { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8a3b3b; }
    .track { fill: #eceff4; }
    .bar { fill: #5e81ac; }
  </style>
  <text x="0" y="${String(record.groups.length * height + 20)}" class="value">${escape(record.group)}</text>
  <text x="${String(densityAt)}" y="${String(record.groups.length * height + 20)}" class="value">density</text>
  <text x="${String(shareAt)}" y="${String(record.groups.length * height + 20)}" text-anchor="end" class="value">share</text>
  <text x="${String(deltaAt)}" y="${String(record.groups.length * height + 20)}" text-anchor="end" class="value">dF1</text>
  ${rows.join('\n  ')}
</svg>`;
}

/** The rows, with the split-half verdict on the row it is about rather than in a second table. */
export function table(record) {
  const halves = new Map((record.splitHalf?.groups ?? []).map((group) => [group.group, group]));
  return `<table>
  <thead><tr><th>${escape(record.group)}</th><th>comments</th><th>share</th><th>TP</th><th>density</th><th>dF1</th><th>chosen half</th><th>held-out half</th><th>verdict</th></tr></thead>
  <tbody>${record.groups
    .map((group) => {
      const half = halves.get(group.group);
      const verdict =
        half === undefined
          ? '&mdash;'
          : `<span class="chip ${half.verdict}">${escape(half.verdict)}</span>`;
      return (
        `<tr><td>${escape(group.group)}</td><td>${String(group.comments)}</td>` +
        `<td>${(Number(group.share) * 100).toFixed(1)}%</td><td>${String(group.truePositives)}</td>` +
        `<td>${fixed(Number(group.density))}</td><td>${signed(Number(group.delta))}</td>` +
        `<td>${half === undefined ? '&mdash;' : signed(Number(half.chosenDelta))}</td>` +
        `<td>${half === undefined ? '&mdash;' : signed(Number(half.heldOutDelta))}</td>` +
        `<td>${verdict}</td></tr>`
      );
    })
    .join('')}</tbody>
</table>`;
}

/** The whole document. Deterministic: no clock, no run id, and the order is the order of the arguments. */
export function page(records) {
  if (records.length === 0) throw new UnreadableDensityError('no readings to draw');
  const name = (record) => `grouped by ${record.group}`;
  const panels = records
    .map(
      (record, index) => `<section class="panel" data-view="${String(index)}">
  <h2>The pool, ${escape(name(record))} &middot; budget ${String(record.budget)} (shipped ${String(record.shippedBudget)})</h2>
  <p class="meta">artifact <code>${escape(record.artifact)}</code> &middot; profile <code>${escape(record.profile)}</code> &middot; goldens ${String(record.goldens)} &middot; full emission ${String(record.fullEmission)} &rarr; pool ${String(record.pool)} with ${String(record.poolPoint.truePositives)} credited</p>
  ${chart(record)}
  ${table(record)}
</section>`,
    )
    .join('\n');
  // **The inputs are siblings of the panels, not children of the nav.** `input:checked ~ .panel` is a sibling selector,
  // so a tab strip that wrapped its inputs in a `<nav>` would render every panel hidden - the defect the cut page fixed
  // and this one inherits the fix from.
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
    .map((record) => {
      const retired = record.groups.filter((group) => group.delta >= 0.0126).length;
      const resolved = (record.splitHalf?.groups ?? []).filter(
        (group) => group.verdict !== 'unresolved',
      ).length;
      const densest = [...record.groups].sort(
        (left, right) => Number(right.density) - Number(left.density),
      )[0];
      const largest = [...record.groups].sort(
        (left, right) => Number(right.comments) - Number(left.comments),
      )[0];
      return (
        `<tr><td>${escape(name(record))}</td><td>${String(record.pool)}</td>` +
        `<td>${fixed(record.poolPoint.truePositives / record.pool)}</td>` +
        `<td>${escape(largest.group)} (${(Number(largest.share) * 100).toFixed(1)}%)</td>` +
        `<td>${escape(densest.group)} (${fixed(Number(densest.density))})</td>` +
        `<td>${String(retired)}</td><td>${String(resolved)} of ${String(record.groups.length)}</td></tr>`
      );
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Where the pool's comments come from, and which of them the budget can pay for</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 1000px; padding: 32px 20px 64px; font: 15px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; color: #2e3440; }
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
  table { border-collapse: collapse; width: 100%; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 12px; }
  th, td { text-align: right; padding: 4px 8px; border-bottom: 1px solid #eceff4; }
  th:first-child, td:first-child { text-align: left; }
  thead th { border-bottom: 1px solid #d8dee9; color: #4c566a; font-weight: 600; }
  .chip { border-radius: 999px; padding: 1px 9px; font-size: 11px; }
  .chip.load-bearing { background: #eef6f0; color: #2f6f4f; }
  .chip.removal-gains { background: #fbf0f0; color: #8a3b3b; }
  .chip.unresolved { background: #f4f4f6; color: #6b7280; }
  footer { margin-top: 40px; color: #4c566a; font-size: 12px; }
  code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<h1>Where the pool's comments come from, and which of them the budget can pay for</h1>
<p class="lede">Read over verdicts the run already paid for. <strong>Density</strong> is a group's credited goldens over its own
comments, matched inside the group; <strong>dF1</strong> is the cut at the budget with the whole group removed, minus the cut
without. The bars are densities against the group list's own maximum, the columns beside them are the group's share of the pool
and its marginal, and the last two columns are the same removal measured on the half that chose it and on the half that
did not see it.</p>
${inputs}
<nav>
${tabs}
</nav>
<h2>What the readings say</h2>
<table>
  <thead><tr><th>reading</th><th>pool</th><th>density</th><th>largest group</th><th>densest group</th><th>dF1 over resolution</th><th>resolved by both halves</th></tr></thead>
  <tbody>${summary}</tbody>
</table>
${panels}
<footer>Rendered from <code>benchmarks/pool-density*.json</code> by <code>scripts/pool-density-page.mjs</code>, which writes
nothing it did not read. The instrument is <code>scripts/pool-density.mjs</code>; the argument is
<code>docs/EVAL-CONTRACT.md</code> §161. No external request is made by this page.</footer>
</body>
</html>
`;
}

/**
 * **`--out` exists because a test that rendered this page in place would overwrite the committed one.**
 *
 * The first version of the case beside this file ran the renderer over a fixture and then read `docs/pool-density.html`
 * back - so a green test replaced the page with two lanes named `loud` and `quiet`, and the next `git diff` in CI would
 * have reported the repository's own page as stale. **A renderer that can only write to one path is a renderer whose tests
 * mutate the tree they are testing.**
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
  process.stdout.write(`wrote ${out} from ${String(records.length)} readings\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
