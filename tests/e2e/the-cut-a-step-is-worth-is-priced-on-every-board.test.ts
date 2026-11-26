// **The device S48 proposed, priced on every board before anything ships.**
//
// §162.6 refused a score floor and left one question behind: if the threshold is not the lever, is the *ordering* one?
// This case runs `scripts/cut-candidates.mjs` over the artifacts the repository holds and locks what it says - because
// the round's finding is a refusal, and a refusal that lives only in a document is the same defect as a figure that does.
//
// **Two sentences are asserted and they are the round.** On Martian's board, refusing to post comments the reviewer
// itself called `low` costs no credited golden at any budget and buys up to `+0.0221` F1; on AACR's board the same tier
// carries goldens and the same step loses eight to thirteen of them. **A step that is free on one answer key and
// expensive on another is not a device, it is a property of the answer key**, and the acceptance rule that can tell the
// difference is containment rather than a delta.
//
// The two devices a previous split-half reading had accepted are here too: `distinct:overlap` is refused on the whole
// board, at `k = 12`, with twelve goldens lost to one gained. A half is for choosing a parameter and not for accepting a
// device, and this is the case that keeps that sentence true.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RECORD = 'benchmarks/cut-candidates.json';
const PAGE = 'docs/cut-candidates.html';

interface Cell {
  budget: number;
  candidate: string;
  verdict: string;
  deltaF1: number;
  mcnemar: number | null;
  coverage: { kept: number; lost: number; gained: number };
  incumbent: { emitted: number; truePositives: number; f1: number };
  candidatePoint: { emitted: number; truePositives: number; f1: number };
}

interface Board {
  id: string;
  artifact: string;
  profile: string;
  resolution: number;
  denominators: { goldens: number; pool: number };
  cells: Cell[];
}

interface Record_ {
  version: string;
  budgets: number[];
  boards: Board[];
  verdicts: { candidate: string; verdict: string; reason: string; cells: Record<string, number> }[];
  guards: { board: string; guard: string; expected?: unknown; rebuilt?: unknown }[];
}

const record = JSON.parse(readFileSync(RECORD, 'utf8')) as Record_;

const boardOf = (id: string): Board => {
  const found = record.boards.find((board) => board.id === id);
  expect(found, `board ${id}`).toBeDefined();
  return found!;
};

const cellOf = (board: string, candidate: string, budget: number): Cell => {
  const found = boardOf(board).cells.find(
    (cell) => cell.candidate === candidate && cell.budget === budget,
  );
  expect(found, `${board} ${candidate} k=${String(budget)}`).toBeDefined();
  return found!;
};

describe('a cut step is priced on every board before it ships', () => {
  it('holds five boards and three budgets, which is the whole family read the same way', () => {
    expect(record.version).toBe('cut-candidates-v1');
    expect(record.boards.map((board) => board.id)).toStrictEqual([
      'martian-wide-core',
      'martian-wide-all',
      'martian-narrow-core',
      'martian-narrow-all',
      'aacr',
    ]);
    expect(record.budgets).toStrictEqual([4, 5, 12]);
    for (const board of record.boards) {
      expect(board.cells).toHaveLength(record.verdicts.length * record.budgets.length);
    }
  });

  it("rebuilds every board's published point before pricing a cell against it", () => {
    expect(record.guards.filter((guard) => guard.guard === 'incumbent-rebuilds')).toHaveLength(5);
    expect(record.guards.filter((guard) => guard.guard === 'denominator')).toHaveLength(5);
    // **The AACR board is the one whose artifact publishes a rule in prose rather than as steps**: the actionability
    // gate, 387 comments and 85 credited goldens, and the guard is what proves the sentence was read correctly.
    expect(cellOf('aacr', 'severity:medium', 12).incumbent.emitted).toBe(273);
    expect(boardOf('aacr').denominators.goldens).toBe(452);
    expect(boardOf('martian-wide-core').denominators.goldens).toBe(158);
    expect(boardOf('martian-wide-all').denominators.goldens).toBe(173);
  });

  it('finds the trivial tier free on Martian and expensive on AACR, and refuses the step', () => {
    for (const budget of record.budgets) {
      for (const board of [
        'martian-wide-core',
        'martian-wide-all',
        'martian-narrow-core',
        'martian-narrow-all',
      ]) {
        const cell = cellOf(board, 'severity:medium', budget);
        expect(cell.verdict).toBe('dominates');
        expect(cell.coverage.lost).toBe(0);
        expect(cell.candidatePoint.emitted).toBeLessThan(cell.incumbent.emitted);
        expect(cell.deltaF1).toBeGreaterThan(0);
      }
      const aacr = cellOf('aacr', 'severity:medium', budget);
      expect(aacr.verdict).toBe('loses');
      expect(aacr.coverage.lost).toBeGreaterThanOrEqual(8);
      expect(aacr.deltaF1).toBeLessThan(0);
    }
    // **The shipped arm gains the most**, which is the arm the product actually runs: +0.0110 at the board's `k = 5`
    // and +0.0158 on all 173, both above the board's `0.0126` resolution - so a rule that compared a delta against a
    // minimum detectable effect would have promoted this step, and the containment rule is what refused it.
    expect(cellOf('martian-narrow-core', 'severity:medium', 5).deltaF1).toBeCloseTo(0.011, 3);
    expect(cellOf('martian-narrow-all', 'severity:medium', 5).deltaF1).toBeCloseTo(0.0158, 4);
    const verdict = record.verdicts.find((entry) => entry.candidate === 'severity:medium');
    expect(verdict!.verdict).toBe('refused');
    expect(verdict!.cells['losing']).toBe(3);
    expect(verdict!.cells['dominating']).toBe(12);
  });

  it('refuses a distinct-site step the whole board disagrees with, twelve goldens against one', () => {
    const cell = cellOf('martian-wide-core', 'distinct:overlap', 12);
    expect(cell.verdict).toBe('loses');
    expect(cell.coverage.lost).toBe(12);
    expect(cell.coverage.gained).toBe(1);
    // **Paired, and the pairing is what the split-half reading could not see**: at `k = 12` the loss is significant at
    // the corpus's own level, and at `k = 5` it is not - which is why a single half accepted it and the whole board does
    // not.
    expect(cell.mcnemar).toBeLessThan(0.01);
    for (const board of record.boards) {
      for (const budget of record.budgets) {
        expect(cellOf(board.id, 'distinct:overlap', budget).verdict).toBe('loses');
      }
    }
  });

  it('refuses every candidate in the family, and says what each one costs', () => {
    expect(record.verdicts).toHaveLength(5);
    for (const verdict of record.verdicts) {
      expect(verdict.verdict).toBe('refused');
      expect(verdict.reason.length).toBeGreaterThan(40);
      expect(verdict.cells['losing']).toBeGreaterThan(0);
    }
    // **The strictest reading of the family**: a step that asks for corroboration from two lanes costs goldens on
    // fifteen of fifteen cells, so the score term that rewards agreement is not a filter.
    const agreement = record.verdicts.find((entry) => entry.candidate === 'agreement:2');
    expect(agreement!.cells['losing']).toBe(15);
  });

  it('reproduces the committed record from the committed artifacts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cut-candidates-e2e-'));
    const fresh = join(directory, 'record.json');
    execFileSync('node', ['scripts/cut-candidates.mjs', '--json', fresh], { encoding: 'utf8' });
    expect(readFileSync(fresh, 'utf8')).toBe(readFileSync(RECORD, 'utf8'));
  });

  it('draws the committed page from the committed record, byte for byte', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cut-candidates-page-e2e-'));
    const drawn = join(directory, 'page.html');
    execFileSync('node', ['scripts/cut-candidates-page.mjs', '--out', drawn], { encoding: 'utf8' });
    expect(readFileSync(drawn, 'utf8')).toBe(readFileSync(PAGE, 'utf8'));
  });

  it('says on the page that nothing in the family may ship', () => {
    const page = readFileSync(PAGE, 'utf8');
    expect(page).not.toContain('<script');
    expect(page).not.toMatch(/https?:\/\//u);
    for (const verdict of record.verdicts) {
      expect(page).toContain(verdict.candidate);
    }
    // **The badge is upper-cased by the stylesheet rather than by the record**, so the assertion counts what the page
    // writes and not what a browser would paint - a page whose markup said `REFUSED` and whose verdict said `trades` is
    // the disagreement this test is for.
    // **Ten and not five**: every refusal is said twice on purpose - once as the badge over its own grid and once in the
    // verdict table - and a page that only did one of the two would leave a reader who scrolled to the table without the
    // grids, or the other way round, with half the finding.
    expect(page.match(/>refused</gu) ?? []).toHaveLength(10);
  });
});
