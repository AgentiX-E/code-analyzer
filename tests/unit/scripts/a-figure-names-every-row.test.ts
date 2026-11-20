// **A chart that omits a row is a chart that lies by omission, and it lies in the flattering direction.**
//
// The figures in `docs/figures/` are generated from `benchmarks/competitive-position.json` precisely so that a reader can
// check one against the other. That property is only worth anything if something checks it: **a renderer that silently
// dropped the twenty rows it could not place would produce a picture of this engine alone at the top**, and the picture
// would be internally consistent.
//
// These tests hold the three properties that make the pair checkable:
//
// 1. **Every row is in the picture**, by name - so nothing can be filtered out for being inconvenient.
// 2. **The rows are drawn in the panel their data belongs to** - a row with a price is a point on the plane, a row
//    without one is a bar in the gutter. A renderer that promoted an unpriced row to a point would be inventing a price.
// 3. **The rendering is a function of the data** - the same JSON twice must produce the same bytes, or the artefact in
//    the repository stops being the artefact the script produces.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const DATA = JSON.parse(readFileSync(join(ROOT, 'benchmarks/competitive-position.json'), 'utf8'));

let first: string;
let second: string;

function render(out: string): void {
  execFileSync('node', [join(ROOT, 'scripts/competitive-position.mjs'), '--out', out], {
    cwd: ROOT,
    stdio: 'pipe',
  });
}

function read(dir: string, name: string): string {
  return readFileSync(join(dir, `${name}.svg`), 'utf8');
}

beforeAll(() => {
  first = mkdtempSync(join(tmpdir(), 'figures-a-'));
  second = mkdtempSync(join(tmpdir(), 'figures-b-'));
  render(first);
  render(second);
});

afterAll(() => {
  rmSync(first, { recursive: true, force: true });
  rmSync(second, { recursive: true, force: true });
});

describe('a figure names every row it was given', () => {
  it('writes one file per figure and one per derived chart', () => {
    for (const name of [
      'martian-offline',
      'aacr-same-corpus',
      'our-budget-frontier',
      'boards-one-per-column',
    ]) {
      expect(read(first, name)).toContain('<svg');
    }
  });

  it('prints every competitor name, including the ones below us', () => {
    for (const figure of DATA.figures) {
      const svg = read(first, figure.id);
      for (const row of figure.rows) {
        // **The name and its score**, because a name alone would survive a renderer that printed the wrong row's number.
        expect(svg).toContain(row.tool.replace(/&/gu, '&amp;'));
        expect(svg).toContain(row.score.toFixed(1));
      }
    }
  });

  it('prints every board, with its own metric named', () => {
    const svg = read(first, 'boards-one-per-column');
    for (const board of DATA.boards) {
      expect(svg).toContain(board.label.replace(/&/gu, '&amp;'));
      expect(svg).toContain(board.metric);
    }
  });
});

describe('a row with no price is drawn as a row with no price', () => {
  it('puts a point on the plane only for the rows that have one', () => {
    for (const figure of DATA.figures) {
      const svg = read(first, figure.id);
      const priced = figure.rows.filter((row) => row.tokensPerReview !== null).length;
      // **A diamond per priced row and nothing else**: the open-source mark is the diamond, and the competitor marks in
      // the gutter are bars rather than shapes.
      const diamonds = svg.match(/<polygon /gu) ?? [];
      // **One extra, and it is the legend's own mark**: the legend is drawn with the same function that draws a point, so
      // the count is `priced + 1` and a renderer that dropped a row would fail here by one.
      expect(diamonds.length).toBe(priced + 1);
    }
  });

  it('prints a token count for the rows that have one and for no others', () => {
    // **The count is the whole claim.** Twenty-one rows on the Martian board publish no price; if the renderer printed a
    // number for them it would have had to invent it, and the text is where that would show.
    for (const figure of DATA.figures) {
      const svg = read(first, figure.id);
      const priced = figure.rows.filter((row) => row.tokensPerReview !== null).length;
      expect((svg.match(/ tokens<\/text>/gu) ?? []).length).toBe(priced);
    }
  });

  it('names the leader whose price is missing rather than leaving the gap unexplained', () => {
    // **The dashed line and its label are the sentence the left panel exists for**, and a figure that drew the gap
    // without naming who is above it would be a picture a reader has to reverse-engineer.
    const svg = read(first, 'martian-offline');
    expect(svg).toContain('price not published');
    expect(svg).toContain('of headroom');
    expect(svg).toContain('Qodo Extended: 65.8');
  });
});

describe('the figure is a function of the data', () => {
  it('renders the same bytes twice', () => {
    for (const name of [
      'martian-offline',
      'aacr-same-corpus',
      'our-budget-frontier',
      'boards-one-per-column',
    ]) {
      expect(read(second, name)).toBe(read(first, name));
    }
  });

  it('carries no timestamp that would make every run a diff', () => {
    // **A generated artefact that changes on every run is one nobody reviews**, which is how a figure and its data drift
    // apart without anybody deciding to let them.
    expect(read(first, 'martian-offline')).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u);
  });

  it('says which file it was generated from, so a reader can check it', () => {
    for (const figure of DATA.figures) {
      expect(read(first, figure.id)).toContain('benchmarks/competitive-position.json');
    }
  });
});
