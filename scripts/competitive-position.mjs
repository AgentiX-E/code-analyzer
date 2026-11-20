// **A comparison chart is a claim, so the axis it cannot fill is drawn rather than cropped.**
//
// The question this file answers is the one a leaderboard cannot: **where does this engine sit when accuracy and price
// are both axes**, and where do the leaders sit when only one of the two is published. **Twenty-one of the twenty-two
// rows on the Martian offline board publish no token count for a review**, so a scatter of the whole board would either
// drop them - which is the crop that flatters whoever has a number - or invent a price for them, which is the fabrication
// this repository refuses.
//
// The shape that follows from that is two panels sharing one figure: **the plane on the left holds the rows with a
// measured or published price**, and **the ranked bars on the right hold the rows whose price is not published**, at
// their accuracy, labelled. The right panel is the finding, not the leftover: *the field does not publish what its
// accuracy costs*.
//
// **Generated rather than drawn**, because a figure edited by hand stops matching the JSON that cites it, and this
// repository has already published one table whose columns did not add up (§104.4). The renderer is dependency-free
// SVG so that the artefact in the repository is the artefact a reader sees.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WIDTH = 960;
const HEIGHT = 600;
const LEFT = { x0: 86, x1: 430 };
const RIGHT = { x0: 496, x1: 932 };
const TOP = 108;
const BOTTOM = 462;

/** The three product shapes the legend distinguishes, and the mark each gets. */
const KINDS = {
  'open-source': { colour: '#1a7f37', shape: 'diamond', label: 'open source, self-hosted' },
  'closed-self-host': {
    colour: '#8250df',
    shape: 'square',
    label: 'closed, self-host option published',
  },
  closed: { colour: '#57606a', shape: 'circle', label: 'closed cloud service' },
};

function escape(text) {
  return String(text)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function mark(kind, x, y, radius) {
  const { colour, shape } = KINDS[kind] ?? KINDS.closed;
  if (shape === 'diamond') {
    const r = radius + 1.5;
    return `<polygon points="${String(x)},${String(y - r)} ${String(x + r)},${String(y)} ${String(x)},${String(y + r)} ${String(x - r)},${String(y)}" fill="${colour}" />`;
  }
  if (shape === 'square') {
    const r = radius;
    return `<rect x="${String(x - r)}" y="${String(y - r)}" width="${String(r * 2)}" height="${String(r * 2)}" fill="${colour}" />`;
  }
  return `<circle cx="${String(x)}" cy="${String(y)}" r="${String(radius)}" fill="${colour}" />`;
}

/** A log scale over the token axis, so a run at 20 k and a run at 400 k are both readable. */
function logScale(value, [low, high], [x0, x1]) {
  const position = (Math.log10(value) - Math.log10(low)) / (Math.log10(high) - Math.log10(low));
  return x0 + position * (x1 - x0);
}

function tokenTick(value) {
  return value >= 1000 ? `${String(value / 1000)}k` : String(value);
}

/**
 * The plane: accuracy against price, for the rows that have a price.
 *
 * **A point with no interval still gets a stem**, because a point drawn without one reads as *measured without error*
 * rather than as *no interval published*.
 */
function plane(figure) {
  const height = BOTTOM - TOP;
  const yOf = (score) => BOTTOM - (score / figure.axisMax) * height;
  const parts = [];
  for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
    const score = figure.axisMax * tick;
    const y = yOf(score);
    parts.push(
      `<line x1="${String(LEFT.x0)}" y1="${String(y)}" x2="${String(LEFT.x1)}" y2="${String(y)}" stroke="#d0d7de" stroke-width="1" />`,
      `<text x="${String(LEFT.x0 - 8)}" y="${String(y + 3)}" text-anchor="end" font-size="10" fill="#57606a">${score.toFixed(0)}</text>`,
    );
  }
  const [low, high] = figure.tokensAxis;
  for (let value = low; value <= high; value *= 2) {
    const x = logScale(value, figure.tokensAxis, [LEFT.x0, LEFT.x1]);
    parts.push(
      `<line x1="${String(x)}" y1="${String(TOP)}" x2="${String(x)}" y2="${String(BOTTOM)}" stroke="#eaeef2" stroke-width="1" />`,
      `<text x="${String(x)}" y="${String(BOTTOM + 16)}" text-anchor="middle" font-size="10" fill="#57606a">${tokenTick(value)}</text>`,
    );
  }
  const priced = [];
  const unpriced = [];
  for (const row of figure.rows) {
    if (row.tokensPerReview === null) unpriced.push(row);
    else priced.push(row);
  }
  // **Two rows that share a price would be drawn on top of each other**, so a segment that already holds a point is
  // offset by a few pixels and the offset is not a data value - it is what a reader needs to see both.
  const taken = new Map();
  for (const row of priced) {
    const x = logScale(row.tokensPerReview, figure.tokensAxis, [LEFT.x0, LEFT.x1]);
    const seen = taken.get(Math.round(x)) ?? 0;
    taken.set(Math.round(x), seen + 1);
    const cx = x + seen * 14;
    const cy = yOf(row.score);
    if (row.low !== null && row.high !== null) {
      parts.push(
        `<line x1="${String(cx)}" y1="${String(yOf(row.low))}" x2="${String(cx)}" y2="${String(yOf(row.high))}" stroke="#8c959f" stroke-width="1.5" />`,
        `<line x1="${String(cx - 3)}" y1="${String(yOf(row.low))}" x2="${String(cx + 3)}" y2="${String(yOf(row.low))}" stroke="#8c959f" stroke-width="1.5" />`,
        `<line x1="${String(cx - 3)}" y1="${String(yOf(row.high))}" x2="${String(cx + 3)}" y2="${String(yOf(row.high))}" stroke="#8c959f" stroke-width="1.5" />`,
      );
    }
    parts.push(mark(row.kind, cx, cy, 5));
    const anchor = cx > (LEFT.x0 + LEFT.x1) / 2 ? 'end' : 'start';
    const dx = anchor === 'end' ? -9 : 9;
    parts.push(
      `<text x="${String(cx + dx)}" y="${String(cy + 3)}" text-anchor="${anchor}" font-size="11" font-weight="600" fill="#1f2328">${escape(row.tool)}</text>`,
      `<text x="${String(cx + dx)}" y="${String(cy + 15)}" text-anchor="${anchor}" font-size="9" fill="#57606a">${row.score.toFixed(1)} ${escape(figure.metric)} · ${tokenTick(row.tokensPerReview)} tokens</text>`,
    );
  }
  /**
   * **The gap drawn rather than left to the reader.** A panel with one point in it invites the reading *we are the only
   * tool here*; the dashed line at the best score that has no published price is the sentence the picture is for:
   * **the leader is 38.2 points above us and nobody will say what that costs.**
   */
  if (unpriced.length > 0 && priced.length > 0) {
    const best = unpriced.reduce((a, b) => (a.score > b.score ? a : b));
    const yBest = yOf(best.score);
    const ours = priced.reduce((a, b) => (a.score > b.score ? a : b));
    const yOurs = yOf(ours.score);
    parts.push(
      `<line x1="${String(LEFT.x0)}" y1="${String(yBest)}" x2="${String(LEFT.x1)}" y2="${String(yBest)}" stroke="#cf222e" stroke-width="1.5" stroke-dasharray="6 4" />`,
      `<text x="${String(LEFT.x0 + 4)}" y="${String(yBest - 6)}" font-size="10" fill="#cf222e">${escape(best.tool)}: ${best.score.toFixed(1)}, price not published</text>`,
      `<line x1="${String(LEFT.x1 - 26)}" y1="${String(yBest)}" x2="${String(LEFT.x1 - 26)}" y2="${String(yOurs)}" stroke="#8c959f" stroke-width="1" stroke-dasharray="2 3" />`,
      `<text x="${String(LEFT.x1 - 30)}" y="${String((yBest + yOurs) / 2)}" text-anchor="end" font-size="10" fill="#57606a">${(best.score - ours.score).toFixed(1)} ${escape(figure.metric)} of headroom</text>`,
    );
  }
  parts.push(
    `<text x="${String((LEFT.x0 + LEFT.x1) / 2)}" y="${String(BOTTOM + 34)}" text-anchor="middle" font-size="10" fill="#1f2328">prompt tokens per pull request (log)</text>`,
    `<text x="${String(LEFT.x0 - 44)}" y="${String((TOP + BOTTOM) / 2)}" font-size="10" fill="#1f2328" transform="rotate(-90 ${String(LEFT.x0 - 44)} ${String((TOP + BOTTOM) / 2)})" text-anchor="middle">${escape(figure.metric)}</text>`,
    `<text x="${String(LEFT.x0)}" y="${String(TOP - 12)}" font-size="10" font-weight="600" fill="#1f2328">rows with a price</text>`,
  );
  return { parts, unpriced, priced };
}

/**
 * The ranked bars: accuracy for the rows whose price is not published.
 *
 * **The order is by accuracy and the spacing is even**, because the rows are two tenths of an F1 point apart in places
 * and a shared y axis would have printed them on top of one another. **The panel says which axis it is not sharing** so
 * that a reader cannot read the bar's height as its position on the left.
 */
function rankedBars(figure, rows) {
  const parts = [];
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const rowHeight = Math.min(17, (BOTTOM - TOP) / Math.max(1, sorted.length));
  parts.push(
    `<text x="${String(RIGHT.x0)}" y="${String(TOP - 12)}" font-size="10" font-weight="600" fill="#1f2328">rows whose price is not published</text>`,
  );
  sorted.forEach((row, index) => {
    const y = TOP + index * rowHeight;
    const barLeft = RIGHT.x0 + 168;
    const span = RIGHT.x1 - barLeft - 44;
    const width = Math.max(1, (row.score / figure.axisMax) * span);
    parts.push(
      `<text x="${String(RIGHT.x0)}" y="${String(y + rowHeight * 0.62)}" font-size="9" fill="#1f2328">${escape(row.tool)}</text>`,
      `<rect x="${String(barLeft)}" y="${String(y + 1)}" width="${String(width)}" height="${String(Math.max(4, rowHeight - 4))}" fill="${(KINDS[row.kind] ?? KINDS.closed).colour}" opacity="0.75" />`,
      `<text x="${String(barLeft + width + 4)}" y="${String(y + rowHeight * 0.62)}" font-size="9" fill="#57606a">${row.score.toFixed(1)}</text>`,
    );
  });
  return parts;
}

function legend() {
  const parts = [];
  let x = LEFT.x0;
  for (const [kind, spec] of Object.entries(KINDS)) {
    const width = spec.label.length * 5.3 + 22;
    parts.push(mark(kind, x + 4, HEIGHT - 76, 4));
    parts.push(
      `<text x="${String(x + 13)}" y="${String(HEIGHT - 72)}" font-size="10" fill="#57606a">${escape(spec.label)}</text>`,
    );
    x += width;
  }
  return parts;
}

function renderFigure(figure) {
  const { parts, unpriced } = plane(figure);
  const body = [...parts, ...rankedBars(figure, unpriced), ...legend()];
  const judged = new Set(figure.rows.map((row) => row.judge)).size > 1;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(WIDTH)}" height="${String(HEIGHT)}" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}" role="img" aria-label="${escape(figure.title)}">`,
    `<rect width="${String(WIDTH)}" height="${String(HEIGHT)}" fill="#ffffff" />`,
    `<text x="24" y="34" font-size="16" font-weight="700" fill="#1f2328">${escape(figure.title)}</text>`,
    `<text x="24" y="54" font-size="11" fill="#57606a">${escape(figure.subtitle)}</text>`,
    `<text x="24" y="72" font-size="9" fill="#8c959f">source: ${escape(figure.source)}</text>`,
    ...body,
    judged
      ? `<text x="24" y="${String(HEIGHT - 44)}" font-size="9" fill="#8c959f">a row whose judge differs from the rest is not the same measurement: the survey reports the judge moving the top rows by up to nine F1 points.</text>`
      : '',
    `<text x="24" y="${String(HEIGHT - 28)}" font-size="9" fill="#8c959f">an interval is the survey's 95 % one; a mark without one is a measurement this repository made and whose interval it did not.</text>`,
    `<text x="24" y="${String(HEIGHT - 12)}" font-size="9" fill="#8c959f">generated from benchmarks/competitive-position.json by scripts/competitive-position.mjs; do not edit by hand.</text>`,
    `</svg>`,
  ].join('\n');
}

/**
 * The frontier this engine can move along by itself: accuracy traded against finding text, at the caps it ships.
 *
 * **The labels are staggered and merged**, because the last three caps are a tenth of an F1 point apart: two texts per
 * point at the same offset is a chart whose right-hand third cannot be read, which is where the diminishing return -
 * the only thing this chart is for - happens to be.
 */
function renderFrontier(frontier) {
  const width = 820;
  const height = 460;
  const x0 = 96;
  const x1 = 740;
  const top = 104;
  const bottom = 344;
  const rows = frontier.rows ?? [];
  const maxTokens = Math.max(...rows.map((row) => row.tokens));
  const maxF1 = Math.ceil(Math.max(...rows.map((row) => row.f1)) * 40) / 40;
  const xOf = (tokens) => x0 + (tokens / maxTokens) * (x1 - x0);
  const yOf = (f1) => bottom - (f1 / maxF1) * (bottom - top);
  const path = rows
    .map(
      (row, index) =>
        `${index === 0 ? 'M' : 'L'}${xOf(row.tokens).toFixed(1)} ${yOf(row.f1).toFixed(1)}`,
    )
    .join(' ');
  const parts = [
    `<line x1="${String(x0)}" y1="${String(bottom)}" x2="${String(x1)}" y2="${String(bottom)}" stroke="#8c959f" />`,
    `<line x1="${String(x0)}" y1="${String(top)}" x2="${String(x0)}" y2="${String(bottom)}" stroke="#8c959f" />`,
  ];
  for (let step = 0; step <= 4; step += 1) {
    const value = (maxF1 / 4) * step;
    const y = yOf(value);
    parts.push(
      `<line x1="${String(x0)}" y1="${String(y)}" x2="${String(x1)}" y2="${String(y)}" stroke="#eaeef2" />`,
      `<text x="${String(x0 - 8)}" y="${String(y + 3)}" text-anchor="end" font-size="9" fill="#57606a">${value.toFixed(3)}</text>`,
    );
  }
  for (let step = 0; step <= 4; step += 1) {
    const tokens = Math.round((maxTokens / 4) * step);
    const x = xOf(tokens);
    parts.push(
      `<text x="${String(x)}" y="${String(bottom + 16)}" text-anchor="middle" font-size="9" fill="#57606a">${tokenTick(tokens)}</text>`,
    );
  }
  parts.push(`<path d="${path}" fill="none" stroke="#1a7f37" stroke-width="2" />`);
  rows.forEach((row, index) => {
    const x = xOf(row.tokens);
    const y = yOf(row.f1);
    const above = index % 2 === 0;
    parts.push(
      `<circle cx="${String(x)}" cy="${String(y)}" r="3.5" fill="#1a7f37" />`,
      `<text x="${String(x)}" y="${String(above ? y - 9 : y + 16)}" text-anchor="middle" font-size="9" fill="#1f2328">cap ${String(row.budget)} · ${row.f1.toFixed(3)}</text>`,
    );
  });
  parts.push(
    `<text x="${String((x0 + x1) / 2)}" y="${String(bottom + 42)}" text-anchor="middle" font-size="10" fill="#1f2328">finding text, tokens per run (characters / 4)</text>`,
    `<text x="${String(x0 - 52)}" y="${String((top + bottom) / 2)}" font-size="10" fill="#1f2328" transform="rotate(-90 ${String(x0 - 52)} ${String((top + bottom) / 2)})" text-anchor="middle">F1</text>`,
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}" role="img" aria-label="accuracy against finding text">`,
    `<rect width="${String(width)}" height="${String(height)}" fill="#ffffff" />`,
    `<text x="24" y="34" font-size="15" font-weight="700" fill="#1f2328">What more findings buy, on AACR-Bench: ${String(frontier.corpusGoldens)} goldens, ${String(frontier.runBudget)} USD cap</text>`,
    `<text x="24" y="54" font-size="10" fill="#57606a">each point is the shipped set at that per-file cap; the tokens are the finding text and not the prompt, so the ratio is the reading and the level is not</text>`,
    `<text x="24" y="72" font-size="9" fill="#8c959f">source: ${escape(frontier.source ?? '')} measured ${escape(frontier.measuredAt ?? '')}</text>`,
    ...parts,
    `<text x="24" y="${String(height - 12)}" font-size="9" fill="#8c959f">generated from benchmarks/budget-frontier.json by scripts/competitive-position.mjs.</text>`,
    `</svg>`,
  ].join('\n');
}

/** A caption wide enough for the column and no wider, so that two of them cannot print on top of each other. */
function wrap(text, perLine) {
  const words = String(text).split(/\s+/u);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= perLine) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** One column per board, so that seven different metrics cannot be read as one scale. */
function renderBoards(boards) {
  const width = 960;
  const height = 420;
  const columnWidth = (width - 60) / boards.length;
  const top = 118;
  const bottom = 292;
  const parts = [];
  boards.forEach((board, index) => {
    const cx = 40 + columnWidth * index + columnWidth / 2;
    parts.push(
      `<line x1="${String(cx)}" y1="${String(top)}" x2="${String(cx)}" y2="${String(bottom)}" stroke="#d0d7de" />`,
      `<text x="${String(cx)}" y="${String(bottom + 8)}" text-anchor="middle" font-size="8" fill="#d0d7de">0</text>`,
      `<text x="${String(cx)}" y="${String(top - 8)}" text-anchor="middle" font-size="10" font-weight="600" fill="#1f2328">${escape(board.label)}</text>`,
      `<text x="${String(cx)}" y="${String(top + 6)}" text-anchor="middle" font-size="8" fill="#8c959f">${escape(board.metric)}</text>`,
    );
    const scale = (score, of) => bottom - (score / of) * (bottom - top - 16);
    if (board.leader !== null) {
      const y = scale(board.leader, board.leader);
      parts.push(
        mark('closed', cx - 14, y, 4),
        `<text x="${String(cx - 22)}" y="${String(y + 3)}" text-anchor="end" font-size="9" fill="#1f2328">${board.leader.toFixed(1)}</text>`,
        `<text x="${String(cx + 2)}" y="${String(y + 3)}" font-size="8" fill="#57606a">leader</text>`,
      );
    }
    if (board.ours !== null) {
      const span = board.leader === null ? board.ours * 1.4 : board.leader;
      const y = scale(board.ours, span);
      parts.push(
        mark('open-source', cx + 14, y, 4),
        `<text x="${String(cx + 22)}" y="${String(y + 3)}" font-size="9" fill="#1f2328">${board.ours.toFixed(1)}</text>`,
        `<text x="${String(cx + 2)}" y="${String(y + 14)}" font-size="8" fill="#1a7f37">ours</text>`,
      );
    }
    const caption = [...wrap(board.corpus, 22), ...wrap(board.note, 22)];
    caption.forEach((line, at) => {
      parts.push(
        `<text x="${String(cx)}" y="${String(bottom + 18 + at * 11)}" text-anchor="middle" font-size="8" fill="#8c959f">${escape(line)}</text>`,
      );
    });
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}" role="img" aria-label="one column per leaderboard">`,
    `<rect width="${String(width)}" height="${String(height)}" fill="#ffffff" />`,
    `<text x="24" y="34" font-size="15" font-weight="700" fill="#1f2328">Seven boards, seven metrics, and no shared scale</text>`,
    `<text x="24" y="54" font-size="10" fill="#57606a">each column is scaled to its own leader; a column without a green mark is a board this engine has not been entered on, which is a different fact from a low score</text>`,
    ...parts,
    `<text x="24" y="${String(height - 12)}" font-size="9" fill="#8c959f">generated from benchmarks/competitive-position.json; sources per row are in docs/LEADERBOARDS.md.</text>`,
    `</svg>`,
  ].join('\n');
}

function main() {
  const root = resolve(new URL('..', import.meta.url).pathname);
  const data = JSON.parse(readFileSync(join(root, 'benchmarks/competitive-position.json'), 'utf8'));
  // **An output directory argument, so that a test can render the figures and read them** without writing into the
  // repository it is checking.
  const outArg = process.argv.indexOf('--out');
  const out = outArg === -1 ? join(root, 'docs/figures') : resolve(process.argv[outArg + 1]);
  mkdirSync(out, { recursive: true });
  const written = [];
  for (const figure of data.figures) {
    const file = join(out, `${figure.id}.svg`);
    writeFileSync(file, renderFigure(figure));
    written.push(file);
  }
  const frontier = JSON.parse(readFileSync(join(root, 'benchmarks/budget-frontier.json'), 'utf8'));
  const frontierFile = join(out, 'our-budget-frontier.svg');
  writeFileSync(frontierFile, renderFrontier(frontier));
  written.push(frontierFile);
  const boardsFile = join(out, 'boards-one-per-column.svg');
  writeFileSync(boardsFile, renderBoards(data.boards));
  written.push(boardsFile);
  for (const file of written) process.stdout.write(`${file}\n`);
}

main();
