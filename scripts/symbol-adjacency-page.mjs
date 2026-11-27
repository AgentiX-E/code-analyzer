#!/usr/bin/env node
/**
 * **The prize as a page: what a corrected sentence would buy, and the rate that says it cannot be aimed.**
 *
 * §165 refused a sixth call and left one question open. The instrument answers it with two numbers that must be read
 * together - **27 of the 33 goldens only the competitor credits sit on a symbol a comment we already post names, and so
 * do 99 of the 125 goldens that are in neither set** - and a page is the only place a reader can be made to see the
 * second one: in a paragraph it reads as a caveat, and beside the first bar it reads as the finding it is.
 *
 * Usage:
 *     node scripts/symbol-adjacency-page.mjs [--record benchmarks/symbol-adjacency.json]
 *                                            [--out docs/symbol-adjacency.html] [--bar 0.3735]
 *
 * The record is written by `scripts/symbol-adjacency.mjs`. This file refuses a version it does not know, a guard that
 * does not reproduce the arm's own point, an adjacency larger than the set it is drawn from, a plan that points outside
 * the pool, and a conversion curve that loses credit as it converts more - **five ways for a page to draw a bar that no
 * arithmetic produced**.
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

const RECORD = argument('--record', join(REPO, 'benchmarks', 'symbol-adjacency.json'));
const OUT = argument('--out', join(REPO, 'docs', 'symbol-adjacency.html'));
const BAR = argument('--bar', null);

const record = JSON.parse(readFileSync(RECORD, 'utf8'));
if (record.version !== 'symbol-adjacency-v1') {
  process.stderr.write(
    `symbol-adjacency.json is version ${String(record.version)}; this page reads symbol-adjacency-v1\n`,
  );
  process.exit(2);
}

// **The guard travels in the record and is re-read here**, because a page is where a figure is most likely to be quoted
// without the sentence that says what it is.
const disagrees = (record.guard ?? []).filter((entry) => entry.published !== entry.rebuilt);
if (disagrees.length > 0) {
  process.stderr.write(
    `the record's guard does not reproduce its own point: ${disagrees
      .map((entry) => `${entry.field} ${String(entry.published)} != ${String(entry.rebuilt)}`)
      .join(', ')}\n`,
  );
  process.exit(1);
}

const { sets, adjacency, rewrite, curve } = record;
if (adjacency.adjacent > sets.onlyTheirs) {
  process.stderr.write(
    `${String(adjacency.adjacent)} adjacent goldens out of a set of ${String(sets.onlyTheirs)}\n`,
  );
  process.exit(1);
}
if (adjacency.baseRate.adjacent > adjacency.baseRate.goldens) {
  process.stderr.write(
    `the rate outside the set reports ${String(adjacency.baseRate.adjacent)} of ${String(adjacency.baseRate.goldens)}\n`,
  );
  process.exit(1);
}
if (adjacency.comparison != null && adjacency.comparison.sentence.adjacent > sets.onlyTheirs) {
  // **The old reading is still a count of goldens**, so it cannot exceed the set it was taken over - the same bound the
  // two guards above apply to the new one, applied to the row that exists to be compared with it.
  process.stderr.write(
    `the sentence-only reading reports ${String(adjacency.comparison.sentence.adjacent)} of a set of ${String(sets.onlyTheirs)}\n`,
  );
  process.exit(1);
}
for (const entry of record.plan) {
  if (entry.findingAt !== null && (!Number.isInteger(entry.findingAt) || entry.findingAt < 0)) {
    process.stderr.write(
      `the plan points at finding ${String(entry.findingAt)}, which is not a row\n`,
    );
    process.exit(1);
  }
}
for (let at = 1; at < curve.length; at += 1) {
  // **A curve that loses a credit when it converts one more comment** is not a curve this page can draw: the rewrite is a
  // maximum matching, so adding an edge cannot lower it, and a record that says otherwise came from another arithmetic.
  if (curve[at].credited < curve[at - 1].credited) {
    process.stderr.write(
      `the curve falls from ${String(curve[at - 1].credited)} to ${String(curve[at].credited)} credits at ${String(curve[at].converted)} conversions\n`,
    );
    process.exit(1);
  }
}

const number = (value, digits = 4) => (typeof value === 'number' ? value.toFixed(digits) : '—');
const percent = (part, whole) => `${whole === 0 ? '0' : ((100 * part) / whole).toFixed(0)} %`;
const width = (part, whole) => `${whole === 0 ? 0 : Math.round((100 * part) / whole)}%`;

const target = BAR === null ? record.bar.target : Number(BAR);
const clearing = curve.find((point) => point.f1 >= target)?.converted ?? null;
const insideRate = percent(adjacency.adjacent, sets.onlyTheirs);
const outsideRate = percent(adjacency.baseRate.adjacent, adjacency.baseRate.goldens);

// **The reading this one replaced, when the record carries it** (§169). A symbol set that shrank is only interpretable
// beside the set it shrank from, and a page that dropped the old number would make a repair look like a discovery.
const comparison = adjacency.comparison ?? null;

/** **The two rates as two bars of one scale**, because the second is the first's denominator and not a footnote. */
const rateRows = [
  {
    label: `the ${String(sets.onlyTheirs)} goldens only they credit`,
    part: adjacency.adjacent,
    whole: sets.onlyTheirs,
  },
  ...(comparison === null
    ? []
    : [
        {
          label: 'the same goldens, read off the sentence alone',
          part: comparison.sentence.adjacent,
          whole: sets.onlyTheirs,
        },
      ]),
  {
    label: `the ${String(adjacency.baseRate.goldens)} goldens in neither set`,
    part: adjacency.baseRate.adjacent,
    whole: adjacency.baseRate.goldens,
  },
]
  .map(
    (row, at) => `<tr>
  <th scope="row">${row.label}</th>
  <td class="bar"><span class="fill${at === 0 ? ' lead' : ''}" style="width:${width(row.part, row.whole)}"></span></td>
  <td class="n">${String(row.part)} / ${String(row.whole)}</td>
  <td class="n">${percent(row.part, row.whole)}</td>
</tr>`,
  )
  .join('\n');

const sweepRows = record.rule.sweep
  .map(
    (row) => `<tr>
  <th scope="row">${String(row.cap) === '1000' ? 'any token' : `≤ ${String(row.cap)}`}</th>
  <td class="n">${String(row.withSymbols)}</td>
  <td class="n">${String(row.adjacent)}</td>
  <td class="bar"><span class="fill" style="width:${width(row.adjacent, sets.onlyTheirs)}"></span><span class="mark" style="left:${width(row.null.p95, sets.onlyTheirs)}"></span></td>
  <td class="n muted">${String(row.null.mean)} · ${String(row.null.p95)}</td>
</tr>`,
  )
  .join('\n');

const ladder = [
  { label: 'what the arm posts', point: record.base.atBudget, ceiling: record.base.ceiling },
  {
    label: 'the sentences corrected',
    point: rewrite.replacement.atBudget,
    ceiling: rewrite.replacement.ceiling,
  },
]
  .map(
    (row) => `<tr>
  <th scope="row">${row.label}</th>
  <td class="n">${String(row.ceiling)}</td>
  <td class="n">${String(row.point.k)}</td>
  <td class="n">${String(row.point.truePositives)}</td>
  <td class="n ${row.point.f1 >= target ? 'pass' : ''}">${number(row.point.f1)}</td>
</tr>`,
  )
  .join('\n');

const curveRows = curve
  .map(
    (point) => `<tr>
  <th scope="row">${String(point.converted)} of ${String(record.plan.length)}</th>
  <td class="n">${String(point.credited)}</td>
  <td class="bar"><span class="fill${point.f1 >= target ? ' pass' : ''}" style="width:${width(point.credited, rewrite.replacement.atBudget.truePositives)}"></span></td>
  <td class="n ${point.f1 >= target ? 'pass' : ''}">${number(point.f1)}</td>
</tr>`,
  )
  .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Where the goldens we never credit were standing</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px 40px 56px; background: #fbfbfa; color: #22262b;
         font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  h1 { font-size: 23px; margin: 0 0 6px; letter-spacing: -0.01em; }
  h2 { font-size: 15px; margin: 34px 0 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6a7280; }
  p { max-width: 74ch; margin: 8px 0; }
  .lede { color: #4a5058; max-width: 78ch; }
  .headline { display: flex; gap: 36px; margin: 24px 0 6px; flex-wrap: wrap; }
  .headline div { border-left: 3px solid #c9ced6; padding: 2px 0 2px 14px; }
  .headline dt { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: #77808c; }
  .headline dd { margin: 2px 0 0; font-size: 26px; font-variant-numeric: tabular-nums; font-weight: 600; }
  .headline .sub { font-size: 13px; color: #6a7280; font-weight: 400; }
  table { border-collapse: collapse; margin: 10px 0 4px; min-width: 620px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #e6e8eb; }
  thead th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #77808c; font-weight: 600; }
  tbody th { font-weight: 600; color: #2e3440; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.bar { width: 240px; position: relative; }
  .fill { display: block; height: 12px; background: #9aa5b4; border-radius: 2px; }
  .fill.lead { background: #3f6f9f; }
  .fill.pass { background: #2f6f4f; }
  .mark { position: absolute; top: 4px; width: 2px; height: 16px; background: #8a3b3b; }
  .muted { color: #6a7280; }
  .pass { color: #2f6f4f; font-weight: 600; }
  .note { color: #4a5058; background: #f4f5f3; border-left: 3px solid #c9ced6; padding: 10px 14px; max-width: 82ch; }
  .warn { background: #fdf5f3; border-left-color: #c98b7a; }
  code { font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f2f0; padding: 1px 4px; border-radius: 3px; }
  footer { margin-top: 34px; color: #77808c; font-size: 13px; }
</style>
</head>
<body>
<h1>Where the goldens we never credit were standing</h1>
<p class="lede">
  ${String(sets.onlyTheirs)} goldens on <code>${record.profile}</code> are credited by the competitor's arm and by nothing we
  emit at any budget. <strong>${String(adjacency.adjacent)} of them sit on an identifier that a comment we already post
  names</strong>, and ${String(record.ranks.within)} of those ${String(adjacency.adjacent)} comments are inside their pull
  request's first ${String(record.budget)}. The deficit is not that we did not look; it is that the comment says something
  else.
</p>
${
  comparison === null
    ? ''
    : `<p class="note">
  <strong>A name is what the change writes, not what the sentence spells.</strong> The symbols counted here are the
  identifiers on the pull request's own added lines, minus keywords and minus anything inside a comment; reading the
  humans' sentences alone would count <strong>${String(comparison.sentence.adjacent)}</strong> of the same
  ${String(sets.onlyTheirs)} instead of ${String(adjacency.adjacent)}, because prose is mostly not code -
  <code>Potential</code>, <code>Calling</code>, <code>particularly</code>, <code>capping</code>. Both rows are drawn below,
  since a set that shrank is only interpretable beside the set it shrank from.
</p>`
}

<dl class="headline">
  <div><dt>goldens only they credit</dt><dd>${String(sets.onlyTheirs)}<span class="sub"> of ${String(record.goldens)}</span></dd></div>
  <div><dt>on a symbol we name</dt><dd>${String(adjacency.adjacent)}<span class="sub"> ${insideRate}</span></dd></div>
  <div><dt>already inside the budget</dt><dd>${String(record.ranks.within)}<span class="sub"> median rank ${String(record.ranks.median)}</span></dd></div>
  <div><dt>the sentences corrected</dt><dd>${number(rewrite.replacement.atBudget.f1)}<span class="sub"> F1 at k=${String(record.budget)}</span></dd></div>
</dl>

<h2>The rate that forbids aiming at it</h2>
<p class="note warn">
  <strong>Co-location is the board's base rate.</strong> ${String(adjacency.baseRate.adjacent)} of the
  ${String(adjacency.baseRate.goldens)} goldens that are in neither set sit on a symbol our pool names, by the same rule and
  on the same pool - <strong>${outsideRate} against ${insideRate}</strong>. A device cannot select which comment to rewrite
  by asking whether it is near a golden we missed; it can only be pointed at every comment it posts.
</p>
<table>
<thead><tr><th>goldens</th><th>adjacent to a comment we post</th><th class="n">count</th><th class="n">rate</th></tr></thead>
<tbody>
${rateRows}
</tbody>
</table>

<h2>What the count is worth, read against its own null</h2>
<p>
  Each row sweeps the one parameter the rule has: how many pull requests' pools may name a token before it stops being a
  name - and the symbol set it counts is <strong>${String(record.rule.symbolSet)}</strong>. The bar is the count, the tick
  is the ${String(adjacency.null.permutations)}-permutation null's 95th percentile -
  the count the same geometry produces when the symbol sets are swapped between goldens. At the specificity this record
  uses (≤ ${String(record.rule.cap)}) the observed count is ${String(adjacency.adjacent)} against a null of
  ${String(adjacency.null.mean)}. <strong>The loose end of the sweep is why the count was never the finding:</strong> at any
  token every golden is adjacent, which is exactly what the rate above says.
</p>
<table>
<thead><tr><th>a token named by</th><th class="n">goldens carrying one</th><th class="n">adjacent</th><th>of ${String(sets.onlyTheirs)}, tick = null p95</th><th class="n">null mean · p95</th></tr></thead>
<tbody>
${sweepRows}
</tbody>
</table>
<p class="note">
  A wrong-pull-request control runs the same symbols against another pool in the same repository and finds
  ${String(adjacency.wrongPullRequest.adjacent)} of ${String(sets.onlyTheirs)}: the symbols are about the place, which is the
  one thing the null does establish.
</p>

<h2>The prize, and the arithmetic floor that is not it</h2>
<p>
  Crediting each golden to the highest-scoring comment on its own pull request that names its symbol is <strong>the sentence
  being corrected and nothing else moving</strong>: no comment added, no rank changed, the budget unchanged at
  ${String(rewrite.replacement.atBudget.k)}. Both readings of a rewrite - the credit added beside the one the comment
  already holds, or moved in place of it - land on the same point, which is why the record publishes both.
</p>
<table>
<thead><tr><th>arm</th><th class="n">ceiling</th><th class="n">comments</th><th class="n">credited</th><th class="n">F1</th></tr></thead>
<tbody>
${ladder}
</tbody>
</table>
<p>
  <strong>This is an upper bound and never a score.</strong> The judge never saw the corrected sentence. Its use is to
  refuse: if it were below ${number(target)}, no conditioning of the comments we already post could reach the bar.
</p>

<h2>How many corrections the bar actually costs</h2>
<p>
  A conversion is not a credit - the protocol matches one finding to one golden - so the ${String(record.plan.length)}
  conversions buy ${String(rewrite.replacement.atBudget.truePositives - record.base.atBudget.truePositives)} credits, not
  ${String(record.plan.length)}. The curve is the plan in the order a verifier would apply it, most confident comment first;
  <strong>${clearing === null ? 'no prefix clears the bar' : `${String(clearing)} of ${String(record.plan.length)} corrections clear it`}</strong>,
  against an arithmetic floor of ${String(record.bar.needed.replacement)} that assumes a conversion is a credit.
</p>
<table>
<thead><tr><th>corrections applied</th><th class="n">credited</th><th>of the prize</th><th class="n">F1</th></tr></thead>
<tbody>
${curveRows}
</tbody>
</table>
<p class="note">
  The bar drawn here is <code>${number(target)}</code>, passed to this renderer rather than written into it. The target a
  section registers is the only thing that moves a green row.
</p>

<footer>
  Drawn from <code>${record.arm}</code> against <code>${record.reference}</code> on <code>${record.corpus}</code>${
    record.rule.changedLines == null
      ? ''
      : `, with the names taken from <code>${String(record.rule.changedLines.path)}</code> (${String(record.rule.changedLines.harvested)} pull requests harvested, digest <code>${String(record.rule.changedLines.corpusDigest).slice(0, 19)}…</code>)`
  }, measured ${record.measuredAt}. Re-derive with <code>npm run bench:symbol-adjacency</code>; CI fails on a byte of
  difference.
</footer>
</body>
</html>
`;

writeFileSync(OUT, html);
process.stdout.write(
  `wrote ${OUT}: ${String(adjacency.adjacent)} of ${String(sets.onlyTheirs)} adjacent, ${number(rewrite.replacement.atBudget.f1)} if all corrected\n`,
);
