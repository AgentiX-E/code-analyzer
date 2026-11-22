// @code-analyzer — where this reviewer sits, on the two axes a buyer actually weighs
//
// **Why a figure and not a table.** A table of eight vendors across three leaderboards is read as eight independent
// claims. The claim that matters is a *position*: precision against detection, detection against how many comments a
// pull request has to absorb, and precision on its own as a ranking. **Two vendors on the same curve are not better and
// worse; they are two choices about where to sit**, and that only becomes visible when the axes are on one page.
//
// **Why the numbers are quoted rather than recomputed.** Every field point is somebody else's published figure, taken
// from a named board on a named date. **This repository has been burned by comparing its own run against a remembered
// one** (§130.3), so the rule here is the same: a point carries its source, and the points that are *ours* are drawn in a
// different shape and labelled with their sample size, because a six-pull-request pilot is not an entry on a board of
// three hundred thousand.
//
// **Why three panels and not one.** No single board publishes both precision and detection for every vendor: the Martian
// board publishes precision, Macroscope's 118-bug table publishes detection and comment volume, and CodeAnt, Cubic and
// Copilot appear only in the first. **A single scatter would have dropped three vendors without saying so**, which is
// the failure mode a comparison figure is supposed to prevent. So each panel plots every vendor it can, and the ranking
// panel plots every vendor that has a precision at all.
//
// **Why generated rather than drawn.** `--check` compares the file it would write with the file in the tree, so a
// committed figure gone stale is a command that exits non-zero rather than a picture nobody notices - the same contract
// `scripts/recall-ceiling-figure.mjs` has, for the same reason.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs', 'figures', 'position-2026-11-22.svg');

/**
 * **The field, as published.** `precision` is the share of a tool's comments that matched a change the developer made;
 * `detection` is the share of known bugs it found; `commentsPerPull` is the volume the precision is bought at.
 *
 * **Greptile's 82 % and Greptile's 45 % are the same tool on the same five repositories with two answer keys**, which is
 * why the source line at the foot of the figure names the board rather than the vendor's own page.
 */
const FIELD = [
  { name: 'Macroscope', precision: 82.8, detection: 48.31, commentsPerPull: 2.55, kind: 'closed' },
  // **The label is offset to the left because two vendors one percentage point apart on one axis is a collision** no
  // automatic placement resolves without moving both.
  {
    name: 'Greptile',
    precision: 82.5,
    detection: 23.6,
    commentsPerPull: null,
    kind: 'closed',
    dx: -104,
    dy: -7,
  },
  { name: 'CodeRabbit', precision: 71.7, detection: 45.76, commentsPerPull: 10.84, kind: 'closed' },
  { name: 'CodeAnt AI', precision: 70.1, detection: null, commentsPerPull: null, kind: 'closed' },
  { name: 'Cubic', precision: 69.5, detection: null, commentsPerPull: null, kind: 'closed' },
  {
    name: 'GitHub Copilot',
    precision: 65.8,
    detection: null,
    commentsPerPull: null,
    kind: 'closed',
  },
  {
    name: 'Cursor Bugbot',
    precision: null,
    detection: 42.37,
    commentsPerPull: 0.91,
    kind: 'closed',
  },
  {
    name: 'Graphite Diamond',
    precision: null,
    detection: 18.26,
    commentsPerPull: 0.62,
    kind: 'closed',
  },
];

/** **Ours, and the two rows are not comparable with each other or with the field.** */
const OURS = [
  {
    name: 'code-analyzer (pilot)',
    precision: 11.76,
    detection: 10,
    commentsPerPull: null,
    kind: 'open',
    note: '6 PRs, own judge',
  },
  {
    name: 'code-analyzer (AACR)',
    precision: 21.96,
    detection: 18.81,
    commentsPerPull: 6.76,
    kind: 'open',
    note: '50 PRs, own corpus',
  },
];

const ALL = [...FIELD, ...OURS];
const esc = (value) =>
  String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const W = 960;
const H = 420;
const PANEL_H = 330;
// **The legend sits below the frames rather than in the last four pixels of the canvas**, because a key drawn at the
// edge is a key that is half-clipped in every renderer that fits the document to its viewport.
const LEGEND_Y = PANEL_H + 26;

/** One plot frame: title, grid, ticks and axis labels, in coordinates the caller then places markers on. */
function frame({ x, width, title, xLabel, yLabel, xMax, yMax, pad = 52, hideYTicks = false }) {
  const left = x + pad;
  const right = x + width - 16;
  const top = 52;
  const bottom = PANEL_H - 52;
  const px = (value) => left + (value / xMax) * (right - left);
  const py = (value) => bottom - (value / yMax) * (bottom - top);

  const ticksOf = (max, step) =>
    Array.from({ length: Math.floor(max / step) + 1 }, (_, at) => at * step);
  const xs = ticksOf(xMax, xMax <= 12 ? 2 : 20);
  const ys = ticksOf(yMax, yMax <= 60 ? 10 : 20);

  const body = [
    `<text x="${String(left)}" y="32" class="title">${esc(title)}</text>`,
    ...xs.map(
      (value) =>
        `<line x1="${px(value).toFixed(1)}" y1="${String(bottom)}" x2="${px(value).toFixed(1)}" y2="${String(top)}" class="grid"/>` +
        `<text x="${px(value).toFixed(1)}" y="${String(bottom + 14)}" class="tick" text-anchor="middle">${String(value)}</text>`,
    ),
    ...ys.map(
      (value) =>
        `<line x1="${String(left)}" y1="${py(value).toFixed(1)}" x2="${String(right)}" y2="${py(value).toFixed(1)}" class="grid"/>` +
        (hideYTicks
          ? ''
          : `<text x="${String(left - 6)}" y="${(py(value) + 3.5).toFixed(1)}" class="tick" text-anchor="end">${String(value)}</text>`),
    ),
    `<text x="${((left + right) / 2).toFixed(1)}" y="${String(bottom + 30)}" class="axis" text-anchor="middle">${esc(xLabel)}</text>`,
    yLabel.length === 0
      ? ''
      : `<text x="${String(x + 16)}" y="${((top + bottom) / 2).toFixed(1)}" class="axis" transform="rotate(-90 ${String(x + 16)} ${((top + bottom) / 2).toFixed(1)})" text-anchor="middle">${esc(yLabel)}</text>`,
  ].join('');

  return { px, py, body, left, right };
}

/** A marker, drawn the way the product type says: filled circle closed cloud, open square self-hosted. */
function marker({ px, py, right }, x, y, entry, labelAt = {}) {
  const bounds = { right: labelAt.right ?? right };
  const cx = px(x);
  const cy = py(y);
  const shape =
    entry.kind === 'open'
      ? `<rect x="${(cx - 5).toFixed(1)}" y="${(cy - 5).toFixed(1)}" width="10" height="10" class="open"/>`
      : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" class="closed"/>`;
  // **A marker in the last fifth of an axis gets its label on the other side**, because a label that runs past the
  // frame is a label that is not read - and a reader cannot tell a clipped name from a name that was never there.
  // **In pixels, not in data units**, because the two axes have different ranges and a comparison against a data value
  // would flip a marker at 78 % of the axis in one panel and at 6.5 comments in another.
  const flip = labelAt.flip ?? cx > bounds.right - 78;
  const lx = flip ? cx - 9 + (labelAt.dx ?? entry.dx ?? 0) : cx + 9 + (labelAt.dx ?? entry.dx ?? 0);
  const ly = cy + 4 + (labelAt.dy ?? entry.dy ?? 0);
  const anchor = labelAt.anchor ?? (flip ? 'end' : 'start');
  const text =
    `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="label" text-anchor="${anchor}">${esc(entry.name)}</text>` +
    (entry.note
      ? `<text x="${lx.toFixed(1)}" y="${(ly + 11).toFixed(1)}" class="note" text-anchor="${anchor}">${esc(entry.note)}</text>`
      : '');
  return shape + text;
}

function render() {
  const third = Math.floor(W / 3);

  // **Panel A: the two axes that matter together, for the vendors that publish both.**
  const a = frame({
    x: 0,
    width: third,
    title: 'Precision against detection',
    xLabel: 'detection, % of known bugs',
    yLabel: 'precision, %',
    xMax: 100,
    yMax: 100,
  });
  const both = ALL.filter((entry) => entry.precision !== null && entry.detection !== null);

  // **Panel B: detection against the volume it is bought at** - the signal-to-noise frontier.
  const b = frame({
    x: third,
    width: third,
    title: 'Detection against volume',
    xLabel: 'comments per pull request',
    yLabel: 'detection, %',
    xMax: 12,
    yMax: 60,
  });
  const frontier = ALL.filter(
    (entry) => entry.detection !== null && entry.commentsPerPull !== null,
  );

  // **Panel C: the precision ranking on its own**, because three of these vendors publish a precision and nothing else
  // and a two-axis panel would have dropped them without saying so.
  const c = frame({
    x: third * 2,
    width: W - third * 2,
    title: 'Precision ranking',
    xLabel: 'precision, %',
    yLabel: '',
    xMax: 100,
    yMax: 100,
    // **The row labels live in the left margin**, so this frame's own plot starts further in than the other two - the
    // alternative was names drawn over the neighbouring panel's data, which is a label that reads as a data point.
    pad: 132,
    // **And its vertical axis is a row index rather than a value**, so a scale beside it would be a scale about nothing.
    hideYTicks: true,
  });
  const ranked = ALL.filter((entry) => entry.precision !== null).sort(
    (left, right) => right.precision - left.precision,
  );

  // **A ranking drawn in the frame's own coordinates**, one row per vendor, so the marker sits on the axis value rather
  // than beside a bar whose length is a second scale nobody checks against the first.
  const rows = ranked
    .map((entry, at) => {
      const y = c.py(94 - at * 10);
      const shape =
        entry.kind === 'open'
          ? `<rect x="${(c.px(entry.precision) - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="8" height="8" class="open"/>`
          : `<circle cx="${c.px(entry.precision).toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" class="closed"/>`;
      return (
        `<text x="${String(third * 2 + 126)}" y="${(y + 3.5).toFixed(1)}" class="label" text-anchor="end">${esc(entry.name)}</text>` +
        `<line x1="${String(third * 2 + 132)}" y1="${y.toFixed(1)}" x2="${c.px(entry.precision).toFixed(1)}" y2="${y.toFixed(1)}" class="rule"/>` +
        shape +
        `<text x="${(c.px(entry.precision) + 8).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" class="note">${entry.precision.toFixed(1)}</text>`
      );
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(W)} ${String(H)}" width="${String(W)}" height="${String(H)}" role="img" aria-label="code-analyzer and the field on precision, detection and comment volume">
<style>
  .title { font: 600 12px ui-sans-serif, system-ui, sans-serif; fill: #111; }
  .axis { font: 10px ui-sans-serif, system-ui, sans-serif; fill: #444; }
  .tick { font: 9px ui-sans-serif, system-ui, sans-serif; fill: #888; }
  .label { font: 10px ui-sans-serif, system-ui, sans-serif; fill: #222; }
  .note { font: 9px ui-sans-serif, system-ui, sans-serif; fill: #777; }
  .grid { stroke: #ececec; stroke-width: 1; }
  .rule { stroke: #d8d8d8; stroke-width: 1; }
  .closed { fill: #1f6feb; }
  .open { fill: none; stroke: #d1242f; stroke-width: 1.6; }
  .legend { font: 10px ui-sans-serif, system-ui, sans-serif; fill: #444; }
</style>
<rect width="${String(W)}" height="${String(H)}" fill="#fff"/>
${a.body}${b.body}${c.body}
${both.map((entry) => marker(a, entry.detection, entry.precision, entry)).join('')}
${frontier.map((entry) => marker(b, entry.commentsPerPull, entry.detection, entry)).join('')}
${rows}
<circle cx="20" cy="${String(LEGEND_Y - 4)}" r="5" class="closed"/><text x="32" y="${String(LEGEND_Y)}" class="legend">closed cloud service</text>
<rect x="176" y="${String(LEGEND_Y - 9)}" width="10" height="10" class="open"/><text x="192" y="${String(LEGEND_Y)}" class="legend">open source, self-hosted</text>
<text x="372" y="${String(LEGEND_Y - 5)}" class="legend">precision: Martian board, 2026-11-05 · detection and volume: Macroscope's 118-bug table</text>
<text x="372" y="${String(LEGEND_Y + 9)}" class="note">ours: aacr-bench (50 PRs) and the Martian pilot (6 PRs). Greptile's 82.5 % and its 45 % are the same tool on two answer keys.</text>
</svg>
`;
}

const rendered = render();
const check = process.argv.includes('--check');
let current = null;
try {
  current = readFileSync(OUT, 'utf8');
} catch {
  current = null;
}
if (current === rendered) {
  process.stdout.write('position figure: unchanged\n');
} else if (check) {
  process.stderr.write(
    'docs/figures/position-2026-11-22.svg is stale: run node scripts/position-figure.mjs\n',
  );
  process.exitCode = 1;
} else {
  writeFileSync(OUT, rendered);
  process.stdout.write('position figure: written\n');
}
