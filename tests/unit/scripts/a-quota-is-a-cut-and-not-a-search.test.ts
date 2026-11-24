/**
 * **A category's cost is not a constant: it depends on what the category displaces.**
 *
 * §140.2 priced `architecture` at the no-budget point and found it worth keeping — 16 of its comments buy reference
 * comments, and without a budget those comments displace nothing. **At the shipped budget of twelve they do displace
 * something**, and the same removal gains instead of losing. That is an interaction the registered cut set could not
 * express, because it had `drop` and it had `budget` and never the two crossed.
 *
 * `quota` is the smallest step that expresses it: *at most `k` comments of these categories per pull request*, ranked by
 * the same score the budget ranks by. It is not a search language — it is one more hypothesis, and the cases here are
 * the ways a quota can be wrong:
 *
 * - **`k = 0` must equal `drop`**, or the two spellings of one cut are two cuts;
 * - **the quota is per pull request**, not per run, for the reason the budget is: a run-wide quota is a first-come
 *   allocation between repositories;
 * - **it keeps the highest-scored**, with ties in artifact order, so a cut is reproducible from the artifact alone;
 * - **it touches nothing else**, which is what makes it a quota rather than a gate.
 */
import { describe, expect, it } from 'vitest';

import { applyCut, describeCut, parseCut } from '../../../scripts/lib/operating-point.mjs';

import type { EmittedFinding } from '../../../scripts/lib/operating-point.d.mts';

const finding = (
  pr: string,
  category: string,
  score: number,
  path = 'src/a.ts',
): EmittedFinding => ({
  pr,
  path,
  category,
  score,
  actionable: true,
  matchedGoldens: [],
});

describe('a category quota is one more cut and not a search', () => {
  it('agrees with drop when the quota is zero', () => {
    const rows = [
      finding('p1', 'architecture', 0.9),
      finding('p1', 'bug', 0.8),
      finding('p2', 'architecture', 0.7),
    ];
    const quota = applyCut(rows, parseCut('quota:architecture=0'));
    const drop = applyCut(rows, parseCut('drop:architecture'));
    expect(quota.map((row) => row.category)).toEqual(drop.map((row) => row.category));
    expect(quota).toHaveLength(1);
  });

  it('counts per pull request, so a busy pull request cannot eat another one’s share', () => {
    const rows = [
      finding('p1', 'architecture', 0.9),
      finding('p1', 'architecture', 0.8),
      finding('p1', 'architecture', 0.7),
      finding('p2', 'architecture', 0.6),
    ];
    const kept = applyCut(rows, parseCut('quota:architecture=1'));
    expect(kept.map((row) => row.pr)).toEqual(['p1', 'p2']);
    expect(kept.map((row) => row.score)).toEqual([0.9, 0.6]);
  });

  it('keeps the highest-scored and breaks ties in artifact order', () => {
    const rows = [
      finding('p1', 'architecture', 0.5),
      finding('p1', 'architecture', 0.9),
      finding('p1', 'architecture', 0.9),
    ];
    const kept = applyCut(rows, parseCut('quota:architecture=2'));
    expect(kept.map((row) => row.score)).toEqual([0.9, 0.9]);
    // The first of the two equal scores is the one at index 1, because the row at index 0 scored lower.
    expect(kept[0]).toBe(rows[1]);
    expect(kept[1]).toBe(rows[2]);
  });

  it('leaves every other category alone, including ones the quota names nowhere', () => {
    const rows = [
      finding('p1', 'architecture', 0.9),
      finding('p1', 'architecture', 0.8),
      finding('p1', 'bug', 0.1),
      finding('p1', 'test', 0.05),
    ];
    const kept = applyCut(rows, parseCut('quota:architecture=1'));
    expect(kept.map((row) => row.category)).toEqual(['architecture', 'bug', 'test']);
  });

  it('prints the label a report names, and parses that same cut back', () => {
    const steps = parseCut('quota:architecture,style=2');
    expect(describeCut(steps)).toBe('quota architecture+style 2');
    expect(parseCut('quota:architecture,style=2')).toEqual(steps);
  });

  it('refuses a quota that names nothing or a count that is not a count', () => {
    expect(() => parseCut('quota:=2')).toThrow(/names no category/u);
    expect(() => parseCut('quota:architecture=')).toThrow(/not a quota/u);
    expect(() => parseCut('quota:architecture=-1')).toThrow(/not a quota/u);
  });
});
