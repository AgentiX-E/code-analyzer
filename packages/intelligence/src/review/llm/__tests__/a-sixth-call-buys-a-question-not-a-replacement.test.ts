// @code-analyzer/intelligence — a sixth call buys a question, it does not replace one
//
// **§72.1 left one result unread and this file is about it.** R-35 asked whether the lane that wants the value which
// breaks the line should *replace* `testing`, and the answer was no: F1 0.1973 against 0.2076, Δ −0.0103, p = 0.354.
// But the same run published the two lanes' own tables, and they say something the substitution could not:
//
// | lane | findings filed | goldens hit | precision |
// | --- | --- | --- | --- |
// | `testing`, in the shipped set | 289 | 59 | 0.158 |
// | `behaviour`, in the other arm | 75 | 24 | **0.258** |
//
// **The lane the substitution removed was four times as wide and half as precise; the lane it added was narrow and
// better.** A substitution forces a choice between them, and R-35 measured that choice as a loss. **A union does not
// force it** - it asks both, pays one more call per file, and leaves the arithmetic to the judge.
//
// **Why this is a lane set rather than a seventh device.** The corpus's ceiling is not the ranker: §72.4 measured a
// perfect ordering of the merged pool at **p@16 = 0.267**, and the shipped set reaches recall 0.1973 against it. **The
// pool is the constraint**, and a wider pool is the only device in this repository that widens it without touching the
// judge, the deduplicator or the gate.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '../llm-review-engine.js';
import { LANE_SETS, LANE_PRIORITIES } from '../prompts.js';

import type { ReviewLane } from '../prompts.js';
import type { CompletionOptions, CompletionResult, LLMProvider } from '../provider.js';
import type { GitDiff } from '@code-analyzer/shared';

/**
 * **One sentence from each lane's own head, because no two lanes open the same way.**
 *
 * The first version of this fixture looked for `${lane} reviewer` in the prompt and matched exactly one lane - `security`
 * - while the other five were being asked and answered. **A fixture that can only see one of six calls reports a set of
 * one**, and it would have passed a `wide` set that silently asked nothing.
 */
const OPENINGS: Record<ReviewLane, string> = {
  security: 'expert security reviewer',
  performance: 'expert performance engineer',
  maintainability: 'expert code quality reviewer',
  testing: 'expert test engineer',
  architecture: 'expert software architect',
  behaviour: 'what a change does to the values that reach it',
  crosscheck: 'the way a reviewer reads a pull request',
};

/** A provider that answers every lane with an empty list and counts the calls it was given. */
class CountingLanes implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';
  readonly seen: string[] = [];

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    const lane = LANE_PRIORITIES.find((name) => prompt.includes(OPENINGS[name]));
    if (lane) this.seen.push(lane);
    return {
      content: '{"findings":[]}',
      model: this.model,
      createdAt: new Date().toISOString(),
      finishReason: 'stop',
    };
  }

  async completeWithTools(): Promise<CompletionResult> {
    throw new Error('no tools here');
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

function oneDiff(): GitDiff {
  return {
    filePath: 'src/a.ts',
    oldHash: 'old',
    newHash: 'new',
    ranges: [{ oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 3, changeType: 'modified' }],
    changeType: 'modified',
  };
}

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '+const b = 2;',
  ' const c = 3;',
].join('\n');

describe('the wide set', () => {
  it('is the five that shipped plus the one that asks for the value, and nothing else', () => {
    expect([...LANE_SETS.wide]).toEqual([...LANE_SETS.shipped, 'behaviour']);
    expect(LANE_SETS.wide).toHaveLength(LANE_SETS.shipped.length + 1);
  });

  it('contains every lane of both sets it was built from', () => {
    // **The union's whole claim is that it forces no choice**, so the property is containment in both directions rather
    // than a list - a set that dropped `testing` to make room would be R-35's arm with a different name, and R-35's arm
    // is the one that lost.
    const wide: readonly ReviewLane[] = LANE_SETS.wide;
    const shipped: readonly ReviewLane[] = LANE_SETS.shipped;
    const behaviour: readonly ReviewLane[] = LANE_SETS.behaviour;
    expect(shipped.filter((lane) => !wide.includes(lane))).toEqual([]);
    expect(behaviour.filter((lane) => !wide.includes(lane))).toEqual([]);
  });

  it('asks them in the order the repository already ranks them', () => {
    // **Order is not cosmetic here**: the prompt bundle and the per-lane tables are written in the order the engine is
    // handed, so a set whose order drifted would produce an artifact whose lane table cannot be compared with the one
    // §69.3 published.
    // **The set is widened to `readonly ReviewLane[]` for the lookup**, because `LANE_PRIORITIES` now carries a lane the
    // union does not (§164's `crosscheck`): `includes` on the tuple is typed to the tuple's own members, which is the
    // assertion this line wants and the wrong type for the filter's argument.
    const expected = LANE_PRIORITIES.filter((lane) =>
      (LANE_SETS.wide as readonly ReviewLane[]).includes(lane),
    );
    expect([...LANE_SETS.wide]).toEqual(expected);
  });
});

describe('what the extra call costs', () => {
  it('sends one call per lane, so the price of the set is its size', async () => {
    const provider = new CountingLanes();
    await new LLMReviewEngine(provider, { lanes: [...LANE_SETS.wide] }).reviewDiff(
      oneDiff(),
      PATCH,
    );

    expect(provider.seen.sort()).toEqual([...LANE_SETS.wide].sort());
    expect(provider.seen).toHaveLength(6);
  });
});
