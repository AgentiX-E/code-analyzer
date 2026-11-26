#!/usr/bin/env node
/**
 * **The verifier as a page: the two arms side by side, and every sentence it declined to change.**
 *
 * §167 built a pass that may only edit, and §166.4 priced it at a fixed comment count. A page is the only place a reader can
 * check both claims at once - the arithmetic that says what the corrections bought, and the counters that say what the pass
 * refused to do - because in a paragraph the refusals read as a caveat and beside the numbers they read as the finding.
 *
 * Usage:
 *     node scripts/symbol-crosscheck-page.mjs [--record benchmarks/symbol-crosscheck.json]
 *                                             [--out docs/symbol-crosscheck.html] [--target 0.3735]
 *
 * The record is written by `scripts/symbol-crosscheck.mjs --mode record`. This file refuses a version it does not know, a
 * pair of arms whose comment counts differ, a verdict list longer than the emission it describes, and a bar that was not
 * passed in - **four ways for a page to draw a figure no arithmetic produced**.
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

const RECORD = argument('--record', join(REPO, 'benchmarks', 'symbol-crosscheck.json'));
const OUT = argument('--out', join(REPO, 'docs', 'symbol-crosscheck.html'));
// **`Number(null)` is zero and zero is a bar**, so the absence is checked before the conversion rather than after it - the
// defect this file's own test found on its first run.
const TARGET_RAW = argument('--target', null);
const TARGET = TARGET_RAW === null ? Number.NaN : Number(TARGET_RAW);
if (!Number.isFinite(TARGET)) {
  process.stderr.write(
    'this page needs --target: the bar is a section decision, not a renderer constant\n',
  );
  process.exit(2);
}

const record = JSON.parse(readFileSync(RECORD, 'utf8'));
if (record.version !== 'symbol-crosscheck-v1') {
  process.stderr.write(
    `symbol-crosscheck.json is version ${String(record.version)}; this page reads symbol-crosscheck-v1\n`,
  );
  process.exit(2);
}
// **The premise of the prize is the count**, so a record whose count moved is refused here rather than drawn with a note.
if (record.comments?.armA !== record.comments?.armB || record.comments?.unchanged !== true) {
  process.stderr.write(
    `refusing: the arms posted ${String(record.comments?.armA)} and ${String(record.comments?.armB)} comments, and §166.4's prize is priced at a fixed count\n`,
  );
  process.exit(1);
}
if ((record.verdicts ?? []).length > record.comments.armA) {
  process.stderr.write(
    `${String(record.verdicts.length)} verdicts for ${String(record.comments.armA)} comments\n`,
  );
  process.exit(1);
}

const { point, paired, prize, verifier } = record;
const keepReasons = Object.entries(verifier?.kept ?? {})
  .filter(([, count]) => Number(count) > 0)
  .sort((left, right) => Number(right[1]) - Number(left[1]));
const rewritten = (record.verdicts ?? []).filter((verdict) => verdict.rewritten === true);
const cleared = Number(point.armB.f1) >= TARGET;
const number = (value, digits = 4) => Number(value).toFixed(digits);
const pct = (value) => `${(Number(value) * 100).toFixed(1)} %`;
const escape = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** A bar whose length is the value and whose marker is the bar it is being held to. */
function bar(value, max, className, marker) {
  const width = max === 0 ? 0 : Math.max(0, Math.min(100, (Number(value) / max) * 100));
  const at = max === 0 ? 0 : Math.max(0, Math.min(100, (Number(marker) / max) * 100));
  return `<td class="bar"><span class="fill ${className}" style="width:${width.toFixed(1)}%"></span><span class="mark" style="left:${at.toFixed(1)}%"></span></td>`;
}

const scale = Math.max(Number(point.armA.f1), Number(point.armB.f1), TARGET) * 1.15 || 1;
const armRows = [
  { label: 'what the arm posts', point: point.armA, className: '' },
  { label: 'the sentences corrected', point: point.armB, className: cleared ? 'pass' : 'lead' },
]
  .map(
    (arm) =>
      `  <tr><th>${arm.label}</th><td class="n">${String(record.comments.armA)}</td><td class="n">${String(
        arm.point.truePositives,
      )}</td><td class="n">${pct(arm.point.precision)}</td><td class="n">${pct(arm.point.recall)}</td><td class="n">${number(
        arm.point.f1,
      )}</td>${bar(arm.point.f1, scale, arm.className, TARGET)}</tr>`,
  )
  .join('\n');

const keepRows = keepReasons
  .map(
    ([reason, count]) =>
      `  <tr><th><code>${escape(reason)}</code></th><td class="n">${String(count)}</td><td>${describe(
        reason,
      )}</td></tr>`,
  )
  .join('\n');

function describe(reason) {
  const sentences = {
    agree: 'both sides were quoted and they agreed, so there was nothing to correct',
    cannot: 'the model could not quote both sides from the change',
    unquoted: 'a quotation did not appear on the line it was attributed to',
    'same-side': 'both quotations were the same text, and one side cannot be its own other side',
    unreadable: 'the answer was not a verdict this pass could read',
    'no-symbol': 'the comment named nothing the change contains',
    'no-evidence': 'the change added no lines around the anchor',
    budget: 'the run reached its call budget',
    'pull-request-cap': 'the pull request reached its per-diff cap',
    failed: 'the call failed',
    'no-rewrite': 'the answer disagreed without writing a replacement',
    identical: 'the replacement was the sentence it already had',
    toolong: 'the replacement was over the bound',
    unnamed: 'the replacement did not name the symbol it was about',
  };
  return sentences[reason] ?? '';
}

const conversionRows = (prize?.detail ?? [])
  .map(
    (entry) =>
      `  <tr><th><code>${escape(entry.symbol ?? '—')}</code></th><td class="n">${String(entry.findingAt)}</td><td>${
        entry.rewritten ? 'rewritten' : '<span class="muted">kept</span>'
      }</td><td>${entry.credited ? 'credited' : '<span class="muted">not credited</span>'}</td></tr>`,
  )
  .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The sentences corrected, and whether the judge agrees</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px 40px 56px; background: #fbfbfa; color: #22262b;
         font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  h1 { font-size: 23px; margin: 0 0 6px; letter-spacing: -0.01em; }
  h2 { font-size: 15px; margin: 34px 0 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6a7280; }
  p { max-width: 74ch; margin: 8px 0; }
  .lede { color: #4a5058; max-width: 78ch; }
  .headline { display: flex; gap: 36px; margin: 24px 0 6px; flex-wrap: wrap; padding: 0; list-style: none; }
  .headline li { border-left: 3px solid #c9ced6; padding: 2px 0 2px 14px; }
  .headline b { display: block; font-size: 26px; font-variant-numeric: tabular-nums; font-weight: 600; }
  .headline span { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: #77808c; }
  .headline .pass b { color: #2f6f4f; }
  .headline .fail b { color: #8a3b3b; }
  table { border-collapse: collapse; margin: 10px 0 4px; min-width: 640px; }
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
  .note { color: #5a6270; font-size: 13.5px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; background: #f1f2f4;
         padding: 1px 4px; border-radius: 3px; }
  footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e6e8eb; color: #6a7280; font-size: 13px; }
</style>
</head>
<body>
<h1>The sentences corrected, and whether the judge agrees</h1>
<p class="lede">
  Every comment below was already posted before this device ran. It takes one of them, takes the symbol that comment already
  names, and asks what the other side of that symbol is - and it may only rewrite the sentence, never add or drop a comment.
  The first row is the arm as it stood; the second is the same comments with the corrections applied.
</p>

<ul class="headline">
  <li><b>${String(record.comments.armA)} / ${String(record.comments.armB)}</b><span>comments, before / after</span></li>
  <li><b>${String(point.armA.truePositives)} → ${String(point.armB.truePositives)}</b><span>credited goldens</span></li>
  <li><b>${number(point.armA.f1)} → ${number(point.armB.f1)}</b><span>F1 at budget ${String(record.budget)}</span></li>
  <li class="${cleared ? 'pass' : 'fail'}"><b>${number(TARGET)}</b><span>the bar · ${cleared ? 'cleared' : 'not cleared'}</span></li>
</ul>

<h2>The two arms</h2>
<table>
<thead><tr><th>arm</th><th class="n">comments</th><th class="n">credited</th><th class="n">precision</th><th class="n">recall</th><th class="n">F1</th><th>against the bar</th></tr></thead>
<tbody>
${armRows}
</tbody>
</table>
<p class="note">
  Both rows were judged <strong>in one run by one judge</strong>: a comment the verifier did not touch is judged once and its
  verdict is used by both arms, so the difference is the sentences and not the judging. Against the published point this
  re-read is the judge's own drift, measured on the arm the bar was computed from - the paired test below says whether the
  movement is the device or the noise.
</p>
<table>
<thead><tr><th>pairs</th><th class="n">fixed</th><th class="n">broken</th><th class="n">delta</th><th class="n">exact McNemar p</th></tr></thead>
<tbody>
<tr><th>the same (comment, golden) pairs, both arms</th><td class="n">${String(paired?.pairs ?? 0)}</td><td class="n">${String(
  paired?.fixed ?? 0,
)}</td><td class="n">${String(paired?.broken ?? 0)}</td><td class="n">${String(paired?.delta ?? 0)}</td><td class="n">${number(
  paired?.p ?? 1,
)}</td></tr>
</tbody>
</table>

<h2>What the pass declined to do</h2>
<p>
  A verifier that only ever rewrote would be indistinguishable from a verifier that rewrote at random, so every refusal is
  counted and named. <strong>${String(verifier?.rewritten ?? 0)} of the ${String(
    verifier?.considered ?? record.comments.armA,
  )} comments were rewritten</strong> from ${String(verifier?.called ?? 0)} calls.
</p>
<table>
<thead><tr><th>reason</th><th class="n">comments</th><th>what it means</th></tr></thead>
<tbody>
${keepRows}
</tbody>
</table>

<h2>The plan §166 priced, entry by entry</h2>
<p>
  The 27 goldens only the competitor credited that sit on a symbol we already name. An entry is <em>rewritten</em> when the
  verifier changed the sentence at the comment the plan chose for it, and <em>credited</em> when the judge then gave that
  comment the golden.
</p>
<table>
<thead><tr><th>symbol</th><th class="n">comment</th><th>sentence</th><th>credit</th></tr></thead>
<tbody>
${conversionRows}
</tbody>
</table>
<p class="note">
  <strong>${String(prize?.rewritten ?? 0)} of ${String(prize?.planned ?? 0)} rewritten, ${String(
    prize?.credited ?? 0,
  )} credited.</strong> The acceptance §167.3 pre-registered is ≥ 18 of the 27 rewritten with the comment count unchanged
  and F1 ≥ the bar; a conversion is not a credit, because the protocol matches one finding to one golden.
</p>

<h2>What was bought</h2>
<p class="note">
  ${String(record.judgements?.calls ?? 0)} judge calls, ${String(verifier?.called ?? 0)} verifier calls,
  <strong>$${number(verifier?.spendUsd ?? 0, 6)}</strong> priced by the verifier's own ledger (the judge's bill is in the
  run's log). Re-derive every figure from this record with <code>--mode replay</code>: no key, no network, no spend.
</p>

<footer>
  Drawn from <code>${escape(record.arm)}</code> on <code>${escape(record.corpus)}</code>, measured
  ${escape(record.measuredAt)}, profile <code>${escape(record.profile)}</code>, mode <code>${escape(record.mode)}</code>.
  Re-derive with <code>npm run bench:symbol-crosscheck</code>; CI fails on a byte of difference.
</footer>
</body>
</html>
`;

writeFileSync(OUT, html);
process.stdout.write(
  `wrote ${OUT}: ${number(point.armA.f1)} → ${number(point.armB.f1)} · ${String(prize?.rewritten ?? 0)} of ${String(
    prize?.planned ?? 0,
  )} rewritten · ${cleared ? 'cleared' : 'not cleared'}\n`,
);
