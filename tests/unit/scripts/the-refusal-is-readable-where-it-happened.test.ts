// @code-analyzer/benchmarks — the refusal is readable where it happened
//
// **What this file guards.** §172.4 retired the sentence-editing pass with a table: five dispatches, ninety rewritten
// sentences, five of them on a prize entry, zero credits. A retirement that lives only in a document is a paragraph, and a
// paragraph can be softened by the next round that would like to buy the device once more. So the table is a committed
// artifact, the page draws it, and this file holds three things about it:
//
//   1. **the last row is the committed record** - so the history cannot drift from `benchmarks/symbol-crosscheck.json`,
//      which is the run every other assertion in this repository reads;
//   2. **the totals are the argument** - ninety rewritten, five prize entries, zero credits - and they are computed here
//      rather than quoted, so a sixth dispatch has to change this file to be claimable;
//   3. **every row names where it is recorded** - a section number or a dispatch id - because a figure whose provenance is
//      a memory is a figure that cannot be re-read.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const HISTORY = 'benchmarks/symbol-crosscheck-history.json';
const RECORD = 'benchmarks/symbol-crosscheck.json';
const PAGE = 'docs/symbol-crosscheck.html';

interface Run {
  run: number;
  dispatch: string | null;
  reference: string;
  contract: string;
  question: string;
  rewritten: number;
  prizeEntries: number;
  planned: number;
  credited: number;
  armA: number;
  armB: number;
}

interface History {
  version: string;
  runs: Run[];
  conclusion: {
    retired: boolean;
    reason: string;
    recorded: string;
    spendUsd: number;
    runs: number;
  };
}

interface Record {
  prize: { planned: number; rewritten: number; credited: number };
  verifier: { rewritten: number };
  point: { armA: { f1: number }; armB: { f1: number } };
}

const history = JSON.parse(readFileSync(HISTORY, 'utf8')) as History;
const record = JSON.parse(readFileSync(RECORD, 'utf8')) as Record;
const page = readFileSync(PAGE, 'utf8');

describe('the refusal is readable where it happened', () => {
  it('ends on the run this repository commits, so the history cannot drift from it', () => {
    const last = history.runs.at(-1);
    expect(last).toBeDefined();
    // **Two counts, and the difference is the whole point of§170**: `verifier.rewritten` is every sentence the pass
    // changed, `prize.rewritten` is how many of those were a plan entry. The history records the first, because that is
    // the work; the acceptance is about the second.
    expect(last?.rewritten).toBe(record.verifier.rewritten);
    expect(last?.planned).toBe(record.prize.planned);
    expect(last?.credited).toBe(record.prize.credited);
    // Four decimal places, which is the precision every figure in `EVAL-CONTRACT.md` is quoted at.
    expect(last?.armA).toBeCloseTo(record.point.armA.f1, 4);
    expect(last?.armB).toBeCloseTo(record.point.armB.f1, 4);
  });

  it('totals ninety rewritten sentences, five prize entries and no credit at all', () => {
    const rewritten = history.runs.reduce((total, run) => total + run.rewritten, 0);
    const prize = history.runs.reduce((total, run) => total + run.prizeEntries, 0);
    const credited = history.runs.reduce((total, run) => total + run.credited, 0);
    expect({ rewritten, prize, credited }).toEqual({ rewritten: 90, prize: 5, credited: 0 });
  });

  it('names where each row is recorded, so a figure has a provenance', () => {
    for (const run of history.runs) {
      // **A section number or a dispatch id, never both empty**: the two are how this campaign addresses a run, and a row
      // that addressed neither would be a memory wearing a table's clothes.
      expect(run.reference.length > 0 || run.dispatch !== null).toBe(true);
      expect(run.contract.length > 0).toBe(true);
      expect(run.question.length > 0).toBe(true);
    }
  });

  it('says it is retired, and says why in a sentence that is the arithmetic', () => {
    expect(history.conclusion.retired).toBe(true);
    expect(history.conclusion.reason).toContain('zero credits');
    expect(history.conclusion.reason).toContain('227');
    expect(history.conclusion.spendUsd).toBeCloseTo(0.0875, 4);
    // The section it is recorded in, so a reader can go and disagree with it.
    expect(history.conclusion.recorded).toMatch(/^§\d/);
  });

  it('draws every row on the page, and the conclusion with them', () => {
    for (const run of history.runs) {
      expect(page).toContain(run.contract);
    }
    expect(page).toContain('Every dispatch of this device');
    expect(page).toContain('0.0875');
  });
});
