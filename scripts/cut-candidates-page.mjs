#!/usr/bin/env node
/**
 * **The candidates as a page, drawn from the record and refusing a record that disagrees with itself.**
 *
 * A table of fifteen numbers per candidate is a table a reader skims; the thing the reading says is *which cells cost a
 * golden*, and that is a shape. Each candidate gets one grid - five boards down, three budgets across - and a cell is
 * coloured by its **verdict** rather than by the sign of its delta, because the two disagree exactly where the reading is
 * interesting: `severity:medium` on the shipped arm improves F1 at every budget and on AACR it improves it at none, and a
 * page coloured by sign would paint both the same shade of "good".
 *
 * Usage:
 *     node scripts/cut-candidates-page.mjs
 *
 * The record is `benchmarks/cut-candidates.json`, written by `scripts/cut-candidates.mjs`; this file refuses a version it
 * does not know, a cell whose board is not in the registry, and a verdict that disagrees with the cells it summarises.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
/**
 * **The record and the destination, overridable for the same reason the instrument's root is**: the refusals below are
 * the page's whole behaviour worth testing, and a test that cannot hand this file a bad record tests the good one.
 */
function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

const RECORD = argument('--record', join(REPO, 'benchmarks', 'cut-candidates.json'));
const OUT = argument('--out', join(REPO, 'docs', 'cut-candidates.html'));

const record = JSON.parse(readFileSync(RECORD, 'utf8'));
if (record.version !== 'cut-candidates-v1') {
  process.stderr.write(
    `cut-candidates.json is version ${String(record.version)}; this page reads v1\n`,
  );
  process.exit(2);
}

const boards = record.boards;
const budgets = record.budgets;
const known = new Set(boards.map((board) => board.id));

// **A cell whose board the registry does not hold would be drawn in a row that has no label**, which is the kind of
// page that looks complete and is not.
for (const board of boards) {
  // **The check is about the board, not about each cell**, so it is one condition rather than a loop over cells whose
  // body names something else: the loop read as "every cell is fine" and said "this board is unknown" N times.
  if (board.cells.length > 0 && !known.has(board.id)) {
    process.stderr.write(`cell under unknown board ${board.id}\n`);
    process.exit(2);
  }
}

// **A verdict is a summary of its cells, so it is checked against them rather than trusted.** The first version of the
// roll-up carried a resolution field that never reached the cells and every candidate came back `trades`; this is the
// assertion that would have caught it.
for (const verdict of record.verdicts) {
  const cells = boards.flatMap((board) =>
    board.cells.filter((cell) => cell.candidate === verdict.candidate),
  );
  const losing = cells.filter((cell) => cell.coverage.lost > 0).length;
  if (verdict.verdict === 'promotable' && losing > 0) {
    process.stderr.write(
      `${verdict.candidate} is called promotable with ${String(losing)} losing cells\n`,
    );
    process.exit(1);
  }
  if (verdict.cells.total !== cells.length) {
    process.stderr.write(
      `${verdict.candidate} counts ${String(verdict.cells.total)} cells and the boards hold ${String(cells.length)}\n`,
    );
    process.exit(1);
  }
}

const magnitude = Math.max(
  ...boards.flatMap((board) => board.cells.map((cell) => Math.abs(cell.deltaF1))),
  0.0001,
);

const className = (cell) =>
  cell.verdict === 'dominates' ? 'good' : cell.verdict === 'loses' ? 'bad' : 'flat';

const signed = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(4)}`;

function gridOf(candidateId) {
  const rows = boards
    .map((board) => {
      const cells = board.cells.filter((cell) => cell.candidate === candidateId);
      const tds = cells
        .map((cell) => {
          const weight = Math.min(1, Math.abs(cell.deltaF1) / magnitude);
          return (
            `<td class="${className(cell)}" style="--w:${weight.toFixed(3)}">` +
            `<b>${signed(cell.deltaF1)}</b>` +
            `<span>${cell.coverage.lost === 0 ? 'no golden lost' : `${String(cell.coverage.lost)} lost`}</span>` +
            `<em>${String(cell.candidatePoint.emitted)} vs ${String(cell.incumbent.emitted)} comments</em>` +
            `</td>`
          );
        })
        .join('');
      return `<tr><th scope="row">${board.label}<small>${String(board.denominators.goldens)} goldens</small></th>${tds}</tr>`;
    })
    .join('');
  const head = budgets.map((budget) => `<th scope="col">k = ${String(budget)}</th>`).join('');
  return `<table class="grid"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

const panels = record.verdicts
  .map((verdict) => {
    const cells = boards.flatMap((board) =>
      board.cells.filter((cell) => cell.candidate === verdict.candidate),
    );
    const worst = cells.reduce(
      (low, cell) => (low === null || cell.deltaF1 < low.deltaF1 ? cell : low),
      null,
    );
    return `<section class="candidate ${verdict.verdict}">
  <h2><code>${verdict.candidate}</code> <span class="badge">${verdict.verdict}</span></h2>
  <p class="meta">${verdict.label} &middot; ${verdict.note} &middot; ${String(verdict.cells.dominating)} of ${String(verdict.cells.total)} cells strictly shrink the emission, ${String(verdict.cells.losing)} lose a credited golden${
    worst === null ? '' : `, worst ${signed(worst.deltaF1)}`
  }</p>
  ${gridOf(verdict.candidate)}
  <p class="why">${verdict.reason}</p>
</section>`;
  })
  .join('\n');

const verdictRows = record.verdicts
  .map(
    (verdict) =>
      `<tr><td><code>${verdict.candidate}</code></td><td class="${verdict.verdict === 'refused' ? 'bad' : 'good'}">${verdict.verdict}</td>` +
      `<td>${String(verdict.cells.losing)}</td><td>${String(verdict.cells.dominating)}</td><td>${verdict.reason}</td></tr>`,
  )
  .join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Five cut steps, five boards, and what each one costs</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 1040px; padding: 32px 20px 64px; font: 15px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; color: #2e3440; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 2px; }
  .lede { color: #4c566a; margin: 0 0 18px; }
  .meta { color: #4c566a; font-size: 12.5px; margin: 0 0 10px; }
  .why { color: #3b4252; font-size: 12.5px; margin: 8px 0 0; }
  .badge { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 999px; margin-left: 6px; }
  .candidate.refused .badge { background: #f3dcdc; color: #8a3b3b; }
  .candidate.promotable .badge { background: #dceee2; color: #2f6f4f; }
  .candidate { border-top: 1px solid #e5e9f0; padding: 18px 0 6px; }
  .candidate:first-of-type { border-top: none; }
  table { border-collapse: collapse; width: 100%; }
  table.grid { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  table.grid th { text-align: left; font-weight: 600; color: #4c566a; padding: 4px 8px 4px 0; vertical-align: top; width: 30%; }
  table.grid th small { display: block; font-weight: 400; color: #7b8794; }
  table.grid th[scope="col"] { width: auto; text-align: right; padding: 0 6px 6px; }
  table.grid td { text-align: right; padding: 7px 8px; border-left: 3px solid transparent; vertical-align: top; }
  table.grid td b { display: block; font-weight: 600; }
  table.grid td span, table.grid td em { display: block; font-style: normal; font-size: 11px; color: #4c566a; }
  td.good { background: rgba(163, 190, 140, calc(0.18 + 0.55 * var(--w))); border-left-color: #2f6f4f; }
  td.bad { background: rgba(191, 97, 106, calc(0.16 + 0.55 * var(--w))); border-left-color: #8a3b3b; }
  td.flat { background: #f1f4f8; }
  table.verdicts { font: 12.5px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; margin-top: 10px; }
  table.verdicts th, table.verdicts td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eceff4; vertical-align: top; }
  table.verdicts thead th { color: #4c566a; }
  .good { color: #2f6f4f; }
  .bad { color: #8a3b3b; }
  footer { margin-top: 34px; color: #4c566a; font-size: 12px; }
  code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<h1>Five cut steps, five boards, and what each one costs</h1>
<p class="lede">Each cell is one candidate cut applied to one board at one budget, read against the cut that board
already publishes. <strong>Green means the step kept every credited golden the incumbent kept and posted strictly fewer
comments</strong> - it cannot have lost anything, so no significance test applies. <strong>Red means it posted fewer
comments and lost a golden to do it</strong>, and the cell says how many: that is the trade the acceptance rule exists to
refuse. A step ships only when no cell anywhere is red.</p>

${panels}

<h2 style="margin-top:28px">The verdicts</h2>
<table class="verdicts">
  <thead><tr><th>candidate</th><th>verdict</th><th>losing cells</th><th>dominating cells</th><th>why</th></tr></thead>
  <tbody>${verdictRows}</tbody>
</table>

<footer>
Read from <code>benchmarks/cut-candidates.json</code> by <code>scripts/cut-candidates.mjs</code>, drawn by
<code>scripts/cut-candidates-page.mjs</code>. Every figure is arithmetic over verdicts a run already paid for: no model was
called and nothing was re-judged, so the round this page belongs to cost nothing. The boards are
<code>benchmarks/martian-wide-bench.json</code> (six lanes, 984 findings), <code>benchmarks/martian-bench.json</code>
(five lanes, 943) and <code>benchmarks/aacr-bench.json</code> (452 goldens, its published point rebuilt through the
actionability gate: 387 comments, 85 credited). The denominator of each board is recomputed from its corpus rather than
trusted, and the incumbent of each board has to rebuild the point its artifact published before a cell prints.
</footer>
</body>
</html>
`;

writeFileSync(OUT, html);
process.stdout.write(`wrote ${OUT}\n`);
