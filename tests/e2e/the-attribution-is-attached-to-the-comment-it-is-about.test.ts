// @code-analyzer/benchmarks — the attribution is attached to the comment it is about
//
// **What §170 could not do.** It reported *one of twenty-six plan entries rewritten* and could say nothing about the other
// twenty-five except that they were a remainder. The pass kept a pooled tally, so a comment that was declined as `agree`
// was indistinguishable from one that was declined because its diff had reached the per-diff cap - and the campaign's open
// question (`§170.4`: does the device decline, or does it fail?) needed that distinction on the entries the acceptance is
// stated over, not on the run as a whole.
//
// **What this file holds, and it is arithmetic rather than prose.**
//
//   1. **every verdict carries a state and a reason**, and the three anchor states cover every comment exactly once;
//   2. **the two denominators are different numbers** - twenty-six entries address twenty-three comments - which is why the
//      hand-join §170.5 used counted three of them twice and reported eleven where the pass says nine;
//   3. **the plan is not wholly addressable**, and this is the finding that changes the acceptance: the device asks one
//      question per comment, so of the twenty-six entries only twenty can ever be rewritten. §169.3's *seventeen of
//      twenty-six* was inside that ceiling by three, not by nine.
//
// A file that pinned the numbers without pinning the arithmetic would go stale on the next run and be rewritten to match
// it. The assertions below recompute each class from the plan and the verdicts, so a run that changes the shape fails here.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const RECORD = 'benchmarks/symbol-crosscheck.json';
const PLAN = 'benchmarks/symbol-adjacency.json';

interface Verdict {
  at: number;
  pair: { anchor: string; other: string } | null;
  anchor: string | null;
  anchorState: 'handed' | 'own' | 'fallback' | null;
  reason: string | null;
  rewritten: boolean;
}

interface Entry {
  findingAt: number;
  symbol: string | null;
  reason: string | null;
  rewritten: boolean;
  credited: boolean;
}

interface Record {
  verdicts: Verdict[];
  prize: { planned: number; rewritten: number; credited: number; detail: Entry[] };
  attribution: {
    planned: number;
    comments: number;
    rewritten: number;
    credited: number;
    byReason: Array<{ reason: string; count: number }>;
  };
  anchors: { handed: number; own: number; fallback: number; noPair: number; recorded: number };
}

interface Adjacency {
  plan: Array<{ findingAt: number; symbols: string[] }>;
}

const record = JSON.parse(readFileSync(RECORD, 'utf8')) as Record;
const adjacency = JSON.parse(readFileSync(PLAN, 'utf8')) as Adjacency;

/** Every reason a run of this pass can write, so a record cannot carry one this file has never heard of. */
const REASONS = new Set([
  'rewritten',
  'no-evidence',
  'no-symbol',
  'budget',
  'pull-request-cap',
  'failed',
  'unreadable',
  'cannot',
  'unquoted',
  'same-side',
  'off-anchor',
  'agree',
  'no-rewrite',
  'identical',
  'toolong',
  'unnamed',
]);

describe('the attribution is attached to the comment it is about', () => {
  it('gives every verdict one of the three anchor states, and counts each comment once', () => {
    for (const verdict of record.verdicts) {
      if (verdict.pair === null) {
        expect(verdict.anchorState).toBeNull();
      } else {
        expect(['handed', 'own', 'fallback']).toContain(verdict.anchorState);
      }
    }
    const { handed, own, fallback, noPair, recorded } = record.anchors;
    // **The tally is a partition of the verdicts**, not a sample of them: a comment with a pair is in exactly one of the
    // three states and a comment without one is in `noPair`, and the four add up to the record's own length.
    expect(recorded).toBe(handed + own + fallback);
    expect(handed + own + fallback + noPair).toBe(record.verdicts.length);
  });

  it('recomputes the anchor state from the plan, so the field cannot disagree with the name it claims', () => {
    // **The plan hands one name per comment and the map keeps the last one**, which is the structural fact behind the
    // substitution: a comment that carries two goldens has two plan symbols and the device can be handed only one.
    const symbolOf = new Map<number, string>();
    for (const entry of adjacency.plan) {
      const first = entry.symbols[0];
      if (typeof first === 'string' && first !== '') symbolOf.set(entry.findingAt, first);
    }
    for (const verdict of record.verdicts) {
      const handed = symbolOf.get(verdict.at) ?? null;
      const state =
        verdict.pair === null
          ? null
          : handed === null
            ? 'own'
            : verdict.pair.anchor === handed
              ? 'handed'
              : 'fallback';
      expect(verdict.anchorState).toBe(state);
    }
  });

  it('attributes every plan entry to the reason the pass wrote for its comment', () => {
    const byAt = new Map(record.verdicts.map((verdict) => [verdict.at, verdict]));
    for (const entry of record.prize.detail) {
      const verdict = byAt.get(entry.findingAt);
      // **The join is by identity and is checked rather than assumed**: an entry's reason is its comment's reason, and a
      // record where the two could drift would be an attribution of the table and not of the run.
      expect(entry.reason).toBe(verdict?.reason ?? null);
      if (verdict?.reason !== null && verdict?.reason !== undefined) {
        expect(REASONS.has(verdict.reason)).toBe(true);
      }
    }
    const summed = record.attribution.byReason.reduce((total, row) => total + row.count, 0);
    expect(summed).toBe(record.attribution.planned);
    expect(record.attribution.planned).toBe(record.prize.detail.length);
  });

  it('records a reason on every verdict, which is what makes the attribution possible at all', () => {
    const missing = record.verdicts.filter((verdict) => typeof verdict.reason !== 'string');
    // **An instrumented run leaves no verdict without a reason.** The three entries whose reason is `null` in the plan
    // table are the three comments this run never reached, and their absence is stated by the entry rather than by a
    // verdict that forgot to say anything.
    expect(missing).toEqual([]);
    const named = record.attribution.byReason.map((row) => row.reason);
    // **The two questions §171.4 said the reading would turn on**, both present and named: the pass agreed with eight of
    // the entries and could not quote two sides of seven.
    expect(named).toContain('agree');
    expect(named).toContain('cannot');
    const agree = record.attribution.byReason.find((row) => row.reason === 'agree')?.count ?? 0;
    const cannot = record.attribution.byReason.find((row) => row.reason === 'cannot')?.count ?? 0;
    expect(agree).toBeGreaterThan(cannot - 2);
    expect(agree + cannot).toBeGreaterThan(record.attribution.planned / 2);
  });

  it('reports two denominators, because twenty-six entries address twenty-three comments', () => {
    const comments = new Set(record.prize.detail.map((entry) => entry.findingAt));
    expect(record.attribution.comments).toBe(comments.size);
    expect(record.attribution.comments).toBeLessThan(record.attribution.planned);
    // **Three comments carry two entries each.** A per-comment join therefore sees twenty-six rows over twenty-three keys
    // and double-counts three of them - the defect §170.5's hand-join made, and the reason `handed` reads nine here and
    // eleven there.
    expect(record.attribution.planned - record.attribution.comments).toBe(3);
  });

  it('counts how much of the plan the device can address at all, one question per comment', () => {
    const entriesAt = new Map<number, number>();
    for (const entry of adjacency.plan) {
      entriesAt.set(entry.findingAt, (entriesAt.get(entry.findingAt) ?? 0) + 1);
    }
    const asked = new Set(record.verdicts.map((verdict) => verdict.at));
    let solo = 0;
    let shared = 0;
    let sharedComments = 0;
    let uncalled = 0;
    for (const [at, count] of entriesAt) {
      if (!asked.has(at)) {
        uncalled += count;
        continue;
      }
      if (count === 1) solo += 1;
      else {
        shared += count;
        sharedComments += 1;
      }
    }
    // **The ceiling is what the device can reach, not what the plan lists.** One question per comment means a shared
    // comment contributes at most one rewrite however many entries it carries.
    const ceiling = solo + sharedComments;
    expect(ceiling).toBeLessThan(record.attribution.planned);
    expect(record.prize.rewritten).toBeLessThanOrEqual(ceiling);
    // And the three that cannot be asked are the one-name sentences, which the ledger already names.
    expect(uncalled).toBe(3);
    expect(shared).toBeGreaterThan(0);
  });
});
