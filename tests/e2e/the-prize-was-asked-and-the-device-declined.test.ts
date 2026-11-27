// @code-analyzer/benchmarks — the prize was asked and the device declined
//
// **What this file guards.** §169 rebuilt the target and §170 spent `$0.014981` asking about it. The reading is a negative
// one, and a negative reading is the kind that gets softened in prose if no test holds it: the pass rewrote twenty
// comments and **one** of them was a plan entry, and that one earned nothing. The assertions here are the record's own
// numbers, so a later run that moves them moves this file too - which is the point of committing an artifact and reading
// it rather than remembering a table.
//
// **Three of the assertions are about what the record can and cannot attribute**, and they are the reason the file exists
// at all:
//
//   1. **the prize** - 26 planned, 1 rewritten, 0 credited, and 3 never called because the comment names one name;
//   2. **the arm** - `0.2909` on both sides with 5 fixed against 3 broken at `p = 0.7266`, which is a difference a coin
//      produces and must not be read as a gain;
//   3. **the anchor the pass actually used** - nine of the plan's comments ask about the plan's name and eight about a name
//      the sentence chose instead. That substitution is **S57**'s defect (§170.5), and the count here is per comment rather
//      than per entry: twenty-six entries address twenty-three comments, so the hand-join that produced `eleven` counted
//      three of them twice (see `the-attribution-is-attached-to-the-comment-it-is-about.test.ts`).

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const RECORD = 'benchmarks/symbol-crosscheck.json';

interface Pair {
  anchor: string;
  other: string;
}

interface Verdict {
  at: number;
  symbol: string;
  pair: Pair | null;
  /** Which of the three ways the pair question found its name; `null` when the sentence related no two names. */
  anchorState: 'handed' | 'own' | 'fallback' | null;
  rewritten: boolean;
}

interface SymbolCrosscheck {
  contract: string;
  anchors: { handed: number; own: number; fallback: number; noPair: number; recorded: number };
  comments: { armA: number; armB: number; unchanged: boolean };
  verifier: {
    considered: number;
    called: number;
    rewritten: number;
    spendUsd: number;
    budgetExhausted: boolean;
    kept: Record<string, number>;
  };
  prize: {
    planned: number;
    rewritten: number;
    credited: number;
    detail: {
      key: string;
      findingAt: number;
      symbol: string;
      rewritten: boolean;
      credited: boolean;
    }[];
  };
  point: {
    armA: { truePositives: number; f1: number };
    armB: { truePositives: number; f1: number };
    delta: number;
  };
  paired: { pairs: number; fixed: number; broken: number; delta: number; p: number };
  verdicts: Verdict[];
  bar: { target: number; cleared: boolean };
}

const record = JSON.parse(readFileSync(RECORD, 'utf8')) as SymbolCrosscheck;

describe('the run §169 authorised', () => {
  it('asked the pair question on the rebuilt plan, and stayed inside its ceiling', () => {
    expect(record.contract).toBe('two-related-names-v1');
    expect(record.verifier).toMatchObject({
      considered: 227,
      called: 183,
      rewritten: 20,
      budgetExhausted: false,
      spendUsd: 0.014981,
    });
    // **The count is unchanged, which is a property of the device's type**: one comment in, one out.
    expect(record.comments).toEqual({ armA: 227, armB: 227, unchanged: true });
  });

  it('rewrote one of the twenty-six plan entries and credited none', () => {
    expect(record.prize).toMatchObject({ planned: 26, rewritten: 1, credited: 0 });
    const inside = record.prize.detail.filter((entry) => entry.rewritten);
    expect(inside).toHaveLength(1);
    expect(inside[0]?.symbol).toBe('retryCount');
    // **Nineteen of twenty rewrites were about something other than the golden's symbol**, which is why a rewrite count is
    // not a prize count and the two are reported apart.
    expect(record.verifier.rewritten - inside.length).toBe(19);
  });

  it('never asked three of them, because a pair needs two names', () => {
    const asked = new Set(record.verdicts.map((verdict) => verdict.at));
    const unasked = record.prize.detail.filter((entry) => !asked.has(entry.findingAt));
    expect(unasked.map((entry) => entry.symbol)).toEqual([
      'TopicUser',
      'credentialKey',
      'getGroupIdsWithViewPermission',
    ]);
    // The refusal is named in the ledger rather than inferred from an absence.
    expect(record.verifier.kept['no-symbol']).toBe(43);
  });

  it('moves nothing, and says so with a paired test rather than a delta', () => {
    expect(record.point.armA).toMatchObject({ truePositives: 56, f1: 0.2909090909090909 });
    expect(record.point.armB).toEqual(record.point.armA);
    expect(record.point.delta).toBe(0);
    expect(record.paired).toEqual({ pairs: 744, broken: 3, fixed: 5, delta: 2, p: 0.7265625 });
    expect(record.bar.cleared).toBe(false);
  });

  it('records the anchor it actually used, and the substitution that §170.5 counted by hand', () => {
    const byAt = new Map(record.verdicts.map((verdict) => [verdict.at, verdict]));
    const states: Record<'handed' | 'own' | 'fallback' | 'none', number> = {
      handed: 0,
      own: 0,
      fallback: 0,
      none: 0,
    };
    for (const entry of record.prize.detail) {
      const state = byAt.get(entry.findingAt)?.anchorState ?? null;
      if (state === null) states.none += 1;
      else states[state] += 1;
    }
    // **The plan's own arithmetic, which is the part that has to be read carefully.** Twenty-six entries address
    // twenty-three comments, and two of those comments carry more than one entry - so a per-entry count and a per-comment
    // count are different numbers and neither is wrong. Per entry: twelve asked about the plan's name, eight about another
    // name the sentence chose, six got no answer at all (three one-name sentences never called, three comments that
    // related no two names). Per comment the pass reports nine and eight, because the two shared comments count once.
    // §170.5's hand-join reported eleven and nine: it counted the shared comments twice **and** counted an entry whose
    // plan symbol the map does not hold as a substitution.
    expect(states).toEqual({ handed: 12, fallback: 8, own: 0, none: 6 });
    expect(record.anchors.handed).toBeLessThan(states.handed);
    expect(record.anchors.fallback).toBe(states.fallback);
    // **The three uncalled entries are the one-name sentences**, and the ledger names the refusal rather than leaving it
    // to be inferred from an absence.
    const asked = new Set(record.verdicts.map((verdict) => verdict.at));
    const unasked = record.prize.detail.filter((entry) => !asked.has(entry.findingAt));
    expect(unasked.map((entry) => entry.symbol)).toEqual([
      'TopicUser',
      'credentialKey',
      'getGroupIdsWithViewPermission',
    ]);
  });
});
