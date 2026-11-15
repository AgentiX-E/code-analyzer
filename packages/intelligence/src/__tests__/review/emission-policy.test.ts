// @code-analyzer/intelligence — the operating point the product ships, as a policy over findings a run already has
//
// **Why this file exists.** `docs/EVAL-CONTRACT.md` §54 prices twenty-three cuts of one run's verdicts and finds that
// the point this repository *published* (the actionability gate and the category floor) scores F1 0.1823 while a
// different cut of the same findings scores 0.2121 - **the same run, the same goldens, the same judge, and 148 fewer
// comments for a higher score.** An artifact that reports a cut the product does not apply is an artifact that prices a
// reviewer nobody can run, so the cut moved here: one function, applied by the command that posts comments and by the
// harness that measures them, and priced by the table that chose it.
//
// **What a policy is allowed to be.** Three steps — drop a category, keep a category, keep at most k per pull request —
// because that is the whole space the campaign has ever registered (§50's table prints every combination of them). **A
// rule language with more expressive power than the campaign has hypotheses is a rule language that can fit the
// corpus**, which is why there is no predicate seam here.
//
// **What it is not.** It never adds a finding, never rewrites one, and never looks at a golden: it chooses which of the
// comments a reviewer already wrote reach a reader. That is the difference between a cut, which is arithmetic a run's
// own artifact can replay, and a device, which needs a dispatch.

import { describe, expect, it } from 'vitest';

import {
  SHIPPED_EMISSION_STEPS,
  applyEmissionPolicy,
  describeEmissionSteps,
} from '../../review/emission-policy.js';

interface Subject {
  readonly id: string;
  readonly category?: string;
  readonly score?: number;
  readonly pr?: string;
}

/** `n` findings on one pull request, all `bug`, scored in descending order. */
function bullets(n: number, pr = 'p1'): Subject[] {
  return Array.from({ length: n }, (_, at) => ({
    id: `${pr}-${String(at)}`,
    category: 'bug',
    score: n - at,
    pr,
  }));
}

describe('the shipped emission policy', () => {
  it('is the cut the table prices, and says so in the same words', () => {
    // **The label is the join between the policy and the artifact.** §54's table has a row called
    // `drop test, budget 12`; if this string and that row ever disagree, the shipped point is a point the table does
    // not price, and every figure filed under it is the price of something else.
    expect(describeEmissionSteps(SHIPPED_EMISSION_STEPS)).toBe('drop test, budget 12');
    expect(SHIPPED_EMISSION_STEPS).toEqual([
      { kind: 'drop', categories: ['test'] },
      { kind: 'budget', k: 12 },
    ]);
  });

  it('is frozen, because a policy that can be edited at runtime is a figure that moves without a run', () => {
    expect(Object.isFrozen(SHIPPED_EMISSION_STEPS)).toBe(true);
    expect(Object.isFrozen(SHIPPED_EMISSION_STEPS[0])).toBe(true);
  });

  it('drops the test category and nothing else', () => {
    const items: Subject[] = [
      { id: 'a', category: 'bug' },
      { id: 'b', category: 'test' },
      { id: 'c', category: 'architecture' },
      { id: 'd', category: 'test' },
    ];
    const outcome = applyEmissionPolicy(items, [{ kind: 'drop', categories: ['test'] }]);
    expect(outcome.kept.map((item) => item.id)).toEqual(['a', 'c']);
    expect(outcome.droppedByCategory).toEqual([{ category: 'test', count: 2 }]);
  });

  it('keeps the highest scores and, on a tie, the order the caller already had', () => {
    // **A tie-break read from a sort's internal order is a tie-break that moves between runs**, and the two arms of a
    // pair would then differ in which comment survived rather than in the device.
    const items: Subject[] = [
      { id: 'first', category: 'bug', score: 5, pr: 'p1' },
      { id: 'second', category: 'bug', score: 9, pr: 'p1' },
      { id: 'third', category: 'bug', score: 5, pr: 'p1' },
      { id: 'fourth', category: 'bug', score: 7, pr: 'p1' },
    ];
    const kept = applyEmissionPolicy(items, [{ kind: 'budget', k: 3 }]).kept;
    expect(kept.map((item) => item.id)).toEqual(['second', 'fourth', 'first']);
  });

  it('budgets per pull request rather than across the run', () => {
    // **The corpus keys a golden by pull request plus its index**, so a budget applied across the run would spend one
    // pull request's slots on another's findings - a different rule, and a better score for it.
    const items = [...bullets(20, 'p1'), ...bullets(20, 'p2')];
    const kept = applyEmissionPolicy(items, [{ kind: 'budget', k: 12 }]).kept;
    expect(kept.filter((item) => item.pr === 'p1')).toHaveLength(12);
    expect(kept.filter((item) => item.pr === 'p2')).toHaveLength(12);
  });

  it('treats a caller with no pull-request key as one pull request', () => {
    // The command reviews one pull request at a time and its findings carry no key; the same twelve must reach a
    // reader whether or not the caller had to invent one.
    const items = Array.from({ length: 20 }, (_, at) => ({
      id: String(at),
      category: 'bug',
      score: at,
    }));
    expect(applyEmissionPolicy(items, [{ kind: 'budget', k: 12 }]).kept).toHaveLength(12);
  });

  it('reads a score that is an object as well as one that is a number', () => {
    // The harness ranks findings into `{ score: { score, actionable } }` and the artifact writes the number; a policy
    // that read only one shape would order the other as all-zero and keep whatever arrived first.
    const items = [
      { id: 'low', category: 'bug', score: { score: 1 } },
      { id: 'high', category: 'bug', score: { score: 3 } },
    ];
    expect(
      applyEmissionPolicy(items, [{ kind: 'budget', k: 1 }]).kept.map((item) => item.id),
    ).toEqual(['high']);
  });

  it('orders a caller with no scores by the order it was given', () => {
    // The command sorts by severity before it gets here, and a policy that re-sorted zeroes would silently replace the
    // command's order with the engine's.
    const items = ['critical', 'medium', 'low'].map((id) => ({ id, category: 'bug' }));
    expect(
      applyEmissionPolicy(items, [{ kind: 'budget', k: 2 }]).kept.map((item) => item.id),
    ).toEqual(['critical', 'medium']);
  });

  it('applies the steps in order, so a drop frees the slots the budget would have spent', () => {
    const items: Subject[] = [
      { id: 't1', category: 'test', score: 9, pr: 'p1' },
      { id: 't2', category: 'test', score: 8, pr: 'p1' },
      { id: 'b1', category: 'bug', score: 7, pr: 'p1' },
      { id: 'b2', category: 'bug', score: 6, pr: 'p1' },
    ];
    const both = applyEmissionPolicy(items, [
      { kind: 'drop', categories: ['test'] },
      { kind: 'budget', k: 2 },
    ]);
    expect(both.kept.map((item) => item.id)).toEqual(['b1', 'b2']);
    // The same steps reversed keep the two test findings and drop both bugs - which is the measurement §54 already
    // priced as the worse point, and the reason the order is a field rather than a convention.
    const reversed = applyEmissionPolicy(items, [
      { kind: 'budget', k: 2 },
      { kind: 'drop', categories: ['test'] },
    ]);
    expect(reversed.kept).toEqual([]);
  });

  it('counts what the budget removed, so a report can say why a comment is missing', () => {
    const outcome = applyEmissionPolicy(bullets(20), [{ kind: 'budget', k: 12 }]);
    expect(outcome.truncated).toBe(8);
    expect(outcome.droppedByCategory).toEqual([]);
  });

  it('passes the findings through untouched rather than rebuilding them', () => {
    // The command's findings carry twenty fields, and a policy that rebuilt them would be a second definition of the
    // report's shape - the kind of copy that goes stale one field at a time.
    const items = bullets(3);
    const outcome = applyEmissionPolicy(items, []);
    expect(outcome.kept).toEqual(items);
    expect(outcome.kept[0]).toBe(items[0]);
  });

  it('keeps a category when the policy says to, for a run that narrows rather than drops', () => {
    const items: Subject[] = [
      { id: 'a', category: 'security' },
      { id: 'b', category: 'bug' },
    ];
    const outcome = applyEmissionPolicy(items, [
      { kind: 'keep-category', categories: ['security'] },
    ]);
    expect(outcome.kept.map((item) => item.id)).toEqual(['a']);
  });

  it('names every step it implements, including the ones no shipped policy uses', () => {
    // **A label function that can only describe the shipped steps is a label function that fails the day a run varies
    // something else** - and the failure would be `budget undefined` in a table row, which reads as a cut.
    expect(
      describeEmissionSteps([
        { kind: 'keep-category', categories: ['security', 'bug'] },
        { kind: 'drop', categories: ['test', 'style'] },
        { kind: 'budget', k: 4 },
      ]),
    ).toBe('keep security+bug, drop test+style, budget 4');
  });

  it('counts nothing as dropped when the step keeps rather than drops', () => {
    // `keep-category` removes findings too, and **they are not findings the policy refused on a category's account** -
    // they are findings the run never asked for. Reporting them under `droppedByCategory` would tell a reader that the
    // test lane was suppressed on a run that only ever asked for security findings.
    const items: Subject[] = [
      { id: 'a', category: 'security' },
      { id: 'b', category: 'bug' },
    ];
    const outcome = applyEmissionPolicy(items, [{ kind: 'keep-category', categories: ['security'] }]);
    expect(outcome.droppedByCategory).toEqual([]);
    expect(outcome.truncated).toBe(1);
  });

  it('keeps a finding whose category or score is absent, instead of treating absence as a match', () => {
    // **Two absences the pipeline really produces**: a lens finding the swarm never categorised, and a caller that
    // passes `{ score: {} }` because the ranker had no diff facts to score against. Reading either as a value would drop
    // an uncategorised finding under `drop test` (nothing equals the empty string) or sort it above every real score.
    const items = [
      { id: 'uncategorised', score: { score: 1 }, pullRequest: 'p9' },
      { id: 'also-uncategorised', score: {}, pullRequest: 'p9' },
      { id: 'scored', category: 'bug', score: 2, pullRequest: 'p9' },
    ];
    const outcome = applyEmissionPolicy(items, [
      { kind: 'drop', categories: ['test'] },
      { kind: 'budget', k: 2 },
    ]);
    // The uncategorised pair survives the drop, and the budget keeps the one real score plus the first of the ties -
    // **which is the order the caller gave**, not the order the scores happened to sort into.
    expect(outcome.kept.map((item) => item.id)).toEqual(['scored', 'uncategorised']);
  });

  it('refuses a step it does not implement instead of ignoring it', () => {
    // A typo in a policy is a shipped point that is not the priced one; silence would publish the difference.
    expect(() => applyEmissionPolicy(bullets(3), [{ kind: 'rank' } as never])).toThrow(
      /unknown emission step/u,
    );
  });

  it('prices an empty run as empty rather than throwing', () => {
    const outcome = applyEmissionPolicy([], SHIPPED_EMISSION_STEPS);
    expect(outcome.kept).toEqual([]);
    expect(outcome.truncated).toBe(0);
  });
});
