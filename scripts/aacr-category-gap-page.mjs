#!/usr/bin/env node
/**
 * **The gap as a picture: one bar per arm, per category the corpus publishes.**
 *
 * §173 reads a `-0.11` F1 against the competitor on the wide AACR arm. A delta is a verdict and a plan needs a shape, so
 * the same verdicts are drawn per corpus category: **two bars and a signed gap**, which is the whole difference between
 * "we are behind" and "we are behind in `maintainability` and level in `security`".
 *
 * Usage:
 *     node scripts/aacr-category-gap-page.mjs [--record benchmarks/aacr-category-gap.json]
 *                                             [--out docs/aacr-category-gap.html]
 *
 * The record is written by `scripts/aacr-category-gap.mjs`, and everything drawn here is read from it: the page computes no
 * credit of its own, because **a renderer with its own arithmetic is a second opinion the reader cannot see**.
 *
 * **Two refusals, both of them about the same failure.** A record whose version this page does not know is refused, because
 * the fields below are the ones v1 has; and a record whose rows do not add back up to the credits it publishes is refused,
 * because a bar drawn from rows that disagree with their own total is a picture of nothing. The instrument already guards
 * this at the point of production; the page guards it again because **that is where a figure is quoted without its
 * sentence**.
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

const RECORD = argument('--record', join(REPO, 'benchmarks', 'aacr-category-gap.json'));
const OUT = argument('--out', join(REPO, 'docs', 'aacr-category-gap.html'));

const record = JSON.parse(readFileSync(RECORD, 'utf8'));
if (record.version !== 'aacr-category-gap-v1') {
  process.stderr.write(`${RECORD} is version ${String(record.version)}; this page reads v1\n`);
  process.exit(2);
}

const rows = Array.isArray(record.rows) ? record.rows : [];
if (rows.length === 0) {
  process.stderr.write(`${RECORD} holds no categories, so there is nothing to draw\n`);
  process.exit(2);
}

const summed = rows.reduce(
  (sum, row) => ({
    goldens: sum.goldens + row.goldens,
    ours: sum.ours + row.ours,
    theirs: sum.theirs + row.theirs,
  }),
  { goldens: 0, ours: 0, theirs: 0 },
);

const disagrees = [
  ['goldens', summed.goldens, record.corpus?.goldens],
  ['ours', summed.ours, record.credited?.ours],
  ['theirs', summed.theirs, record.credited?.theirs],
].filter(([, computed, published]) => computed !== published);

if (disagrees.length > 0) {
  process.stderr.write(
    `the rows do not add back up to the record's own totals: ${disagrees
      .map(([name, computed, published]) => `${name} ${String(computed)} != ${String(published)}`)
      .join(', ')}\n`,
  );
  process.exit(1);
}

const percent = (value) => `${(value * 100).toFixed(1)}%`;
const scale = Math.max(...rows.map((row) => Math.max(row.oursRecall, row.theirsRecall)), 0.01);

const table = rows
  .map((row) => {
    const ours = (row.oursRecall / scale) * 100;
    const theirs = (row.theirsRecall / scale) * 100;
    const gap = row.theirs - row.ours;
    const tone = gap > 0 ? 'behind' : gap < 0 ? 'ahead' : 'level';
    return `      <tr>
        <th scope="row">${row.category}</th>
        <td class="number">${row.goldens}</td>
        <td class="bars">
          <div class="bar ours" style="width:${ours.toFixed(2)}%"><span>${row.ours} · ${percent(row.oursRecall)}</span></div>
          <div class="bar theirs" style="width:${theirs.toFixed(2)}%"><span>${row.theirs} · ${percent(row.theirsRecall)}</span></div>
        </td>
        <td class="number ${tone}">${gap > 0 ? '+' : ''}${gap}</td>
      </tr>`;
  })
  .join('\n');

const caught = rows.filter((row) => row.theirs > row.ours);
const level = rows.filter((row) => row.theirs === row.ours);
const lead = rows.filter((row) => row.theirs < row.ours);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Where the missing goldens are — AACR, wide arm</title>
<style>
  :root { color-scheme: light dark; --ink:#111; --muted:#666; --rule:#dcdcdc; --ours:#3b6ea5; --theirs:#a5523b; }
  @media (prefers-color-scheme: dark) { :root { --ink:#eee; --muted:#9a9a9a; --rule:#333; --ours:#7fa9d4; --theirs:#d49a7f; } }
  body { margin:0; padding:40px; font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:transparent; }
  h1 { font-size:22px; margin:0 0 4px; font-weight:650; letter-spacing:-0.01em; }
  p.lede { margin:0 0 26px; color:var(--muted); max-width:70ch; }
  table { border-collapse:collapse; width:100%; max-width:1000px; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--rule); vertical-align:middle; }
  thead th { font-size:12px; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted); font-weight:600; }
  tbody th { font-weight:600; width:19rem; }
  td.number { font-variant-numeric:tabular-nums; width:5.5rem; }
  td.bars { width:auto; }
  .bar { height:16px; border-radius:3px; margin:3px 0; position:relative; min-width:2px; }
  .bar span { position:absolute; left:8px; top:0; font-size:11px; line-height:16px; color:#fff; white-space:nowrap; }
  .bar.ours { background:var(--ours); }
  .bar.theirs { background:var(--theirs); }
  .behind { color:#b3341f; } .ahead { color:#1f7a44; } .level { color:var(--muted); }
  footer { margin-top:28px; max-width:1000px; color:var(--muted); font-size:13px; }
  .swatch { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:6px; }
</style>
</head>
<body>
  <h1>Where the missing goldens are</h1>
  <p class="lede">AACR, wide lane set, ${record.corpus.pullRequests} pull requests, ${record.corpus.goldens} reference comments.
  Both arms are scored by the corpus's own protocol — one finding credited with one golden, per pull request — and every
  bucket below adds back up to the published figure it decomposes.</p>
  <table>
    <thead>
      <tr><th scope="col">Category</th><th scope="col">Goldens</th><th scope="col">Credited (ours / theirs)</th><th scope="col">Gap</th></tr>
    </thead>
    <tbody>
${table}
    </tbody>
  </table>
  <footer>
    <span class="swatch" style="background:var(--ours)"></span>ours · ${record.emission.ours} comments &nbsp;&nbsp;
    <span class="swatch" style="background:var(--theirs)"></span>the competitor · ${record.emission.theirs} comments<br>
    ${caught.length} categories behind, ${level.length} level, ${lead.length} ahead. A category where both arms are near zero
    is a detection gap, and no cut closes it.
  </footer>
</body>
</html>
`;

writeFileSync(OUT, html);
process.stdout.write(`${OUT}\n`);
