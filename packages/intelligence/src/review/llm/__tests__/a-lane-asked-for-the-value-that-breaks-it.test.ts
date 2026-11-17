// @code-analyzer/intelligence — a lane asked for the value that breaks the line, not for improvements to it
//
// **R-35 is registered as a finder device**, and the registration says what that means: *a lane asked a different
// question about the same diff raises the file arm F1 by at least 0.026 on the 146 pull requests R-32 and R-33 read,
// without lowering precision by more than a golden is worth* (§69.5).
//
// **Why a finder and not another filter.** Four devices have now been closed by their own artifacts — the code window
// (negative at 22 of 23 cuts), the claim check (§45), the reader (unstable across slices, §63) and the second concern
// (+0.0089 on 146 rows against a bar that could not be reached, §69.1). **Every one of them changed the cut, the matcher
// or the second pass. Not one of them changed what a lane is asked to say.**
//
// **And the corpus says where the losses are.** Of the 1 054 goldens on the merged corpus, 449 sit on a file we
// commented on and were judged not to address them (§69.4); only seven of those are recoverable by a better matcher.
// **426 of the 1 054 name a boundary condition** — a null return, an empty collection, a zero denominator, an unchecked
// error, an index at the end — and **the findings that name one are the ones that get accepted** (precision 0.257
// against 0.196 over the 2 438 ranked rows of the three artifacts). The lane that was asked to find test problems found
// them for 8.6 % of the corpus at precision 0.111, and **its own removal gains 0.0069** — so the question it asks is
// the one this corpus barely asks back.
//
// **The field's own reading of what to ask instead**, and it is the one sentence two independent sources agree on:
// *"requiring a triggering input filters out speculative comments, because a model that cannot name the input usually
// does not have a real finding"*, and the clean-control study's complement — **a reviewer told that some items are
// correct accuses 93.8 % of clean items without that sentence and 0 % with it, at unchanged detection**. So the lane
// below asks for a value, asks what that value produces, and says outright that most files have nothing to say.
//
// **What this file does not do.** It does not ask for tests, structure or documentation — four other lanes do, and a
// lane that repeats them is four calls wearing five hats. It does not name a category to hunt in, because the corpus's
// goldens are not labelled by category and a hunt in the wrong category is a miss with extra steps. And **it does not
// say "find bugs"**: the directive framing is measured to roughly triple the false-positive rate against the trace
// framing, which is the failure mode a reviewer with a 12-comment budget cannot afford.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '../llm-review-engine.js';
import {
  BEHAVIOUR_REVIEW_PROMPT,
  LANE_LABELS,
  LANE_PROMPTS,
  LANE_SETS,
  type PromptContext,
  type ReviewLane,
} from '../prompts.js';

import type { CompletionOptions, CompletionResult, LLMProvider } from '../provider.js';
import type { GitDiff } from '@code-analyzer/shared';

const CONTEXT: PromptContext = {
  diffContent: 'const ratio = delta / Math.min(previous, current);',
  filePath: 'src/scoring/rhythm.ts',
  changeType: 'modified',
};

describe('the behaviour lane asks for the value that breaks the line', () => {
  const prompt = BEHAVIOUR_REVIEW_PROMPT(CONTEXT);

  it('is registered as a lane, so a run can name which one produced a finding', () => {
    expect(LANE_PROMPTS.behaviour).toBe(BEHAVIOUR_REVIEW_PROMPT);
    expect(LANE_LABELS.behaviour).toBe('Behaviour Review');
  });

  it('asks for a value rather than handing over a category checklist', () => {
    expect(prompt).toMatch(/which value, state or sequence/i);
    // **The shape the other four lanes have and this one must not**: a *"pay attention to"* list is what makes a lane
    // report what it notices about the diff, which is the narration §69.4 measured at precision 0.183 against 0.343 for
    // findings that name what breaks. **The words themselves are allowed to appear** - the lane names the four
    // questions it declines in order to decline them - so the assertion is on the list, not on the vocabulary.
    expect(prompt).not.toMatch(/pay attention to/i);
    expect(prompt).toMatch(/do not report an improvement here/i);
  });

  it('asks what the value produces, and refuses the sentence that names neither', () => {
    expect(prompt).toMatch(/what the line produces/i);
    expect(prompt).toMatch(/could be fragile/i);
    // **The permission the clean-control study measured**: a reviewer told that most items are correct accuses none.
    expect(prompt).toMatch(/most changed lines are correct/i);
    expect(prompt).toMatch(/empty findings array is the expected answer/i);
  });

  it('carries the same output contract as every other lane, so its rows are comparable', () => {
    // A lane with a different schema would produce findings the parser drops, and the run would report a zero that
    // looks like a bad question rather than a broken one.
    expect(prompt).toContain('"findings"');
    expect(prompt).toContain('"startLine"');
    expect(prompt).toMatch(/at most 3 findings per file/i);
  });

  it('is a different question about the same diff, not a different diff', () => {
    // The last line of the prompt is the diff and the file, and both are where every other lane's are.
    expect(prompt).toContain('src/scoring/rhythm.ts');
    expect(prompt).toContain(CONTEXT.diffContent);
  });
});

describe('the lane sets name which question each arm asked', () => {
  it('ships the five that every published figure was measured under', () => {
    expect(LANE_SETS.shipped).toEqual([
      'security',
      'architecture',
      'performance',
      'maintainability',
      'testing',
    ]);
  });

  it('swaps the weakest question for the new one and leaves the other four alone', () => {
    expect(LANE_SETS.behaviour).toEqual([
      'security',
      'architecture',
      'performance',
      'maintainability',
      'behaviour',
    ]);
    // **One substitution rather than a sixth call**, because a device that also costs 20 % more per file cannot be
    // priced against a device that does not, and the lane it replaces is the one whose removal gains.
    expect(LANE_SETS.behaviour).toHaveLength(LANE_SETS.shipped.length);
    // **Read as `ReviewLane[]` rather than as the literal tuples they are declared as**, because `shipped` is a tuple of
    // five specific names and asking it whether it contains `'behaviour'` is a question its own type says cannot have a
    // true answer - which is exactly the property under test, and a `.includes` on the narrow type refuses to compile
    // instead of answering.
    const shipped: readonly ReviewLane[] = LANE_SETS.shipped;
    const behaviour: readonly ReviewLane[] = LANE_SETS.behaviour;
    expect(behaviour.filter((lane) => !shipped.includes(lane))).toEqual(['behaviour']);
  });
});

/** A provider that answers one fixed list per lane, keyed by the lane's own role sentence. */
class LaneScript implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';
  readonly seen: string[] = [];

  constructor(private readonly answers: Record<string, ReadonlyArray<Record<string, unknown>>>) {}

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    for (const [role, findings] of Object.entries(this.answers)) {
      if (prompt.includes(role)) {
        this.seen.push(role);
        return this.result(JSON.stringify({ findings }));
      }
    }
    this.seen.push('(none)');
    return this.result('{"findings":[]}');
  }

  async completeWithTools(): Promise<CompletionResult> {
    throw new Error('no tools here');
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private result(content: string): CompletionResult {
    return {
      content,
      model: this.model,
      createdAt: new Date().toISOString(),
      finishReason: 'stop',
    };
  }
}

function diff(): GitDiff {
  return {
    filePath: 'src/scoring/rhythm.ts',
    oldPath: null,
    status: 'modified',
    language: 'typescript',
    hunks: [],
    ranges: [{ startLine: 41, endLine: 41, startColumn: 0, endColumn: 0 }],
    addedLines: [41],
    removedLines: [],
    oldHash: '0000000',
    newHash: '1111111',
  } as unknown as GitDiff;
}

describe('the engine runs the lane set it is given and attributes what comes back', () => {
  it('attributes a finding to the behaviour lane, so the artifact can price the question', async () => {
    const engine = new LLMReviewEngine(
      new LaneScript({
        'tracing what a change does to the values that reach it': [
          {
            startLine: 41,
            endLine: 41,
            severity: 'high',
            category: 'bug',
            title: 'Two equal onsets make the divisor zero and the ratio infinite',
            description:
              'Math.min(previous, current) is the gap between consecutive onsets, and two notes on one tick give 0.',
            suggestion: 'Guard the zero before dividing.',
          },
        ],
      }),
      { lanes: [...LANE_SETS.behaviour] },
    );

    const results = await engine.reviewDiff(diff());
    const rows = results.flatMap((result) =>
      result.findings.map((entry) => ({ ...entry, lane: result.lane })),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.lane).toBe('behaviour');
  });

  it('runs exactly the lanes named, with no testing call left over', async () => {
    const script = new LaneScript({});
    const engine = new LLMReviewEngine(script, { lanes: [...LANE_SETS.behaviour] });

    await engine.reviewDiff(diff());

    // **One call per lane and no more**: five calls per file is what makes the swap priceable against the five that
    // ship, and a sixth call would show up here as a budget change rather than as a question change.
    expect(script.seen).toHaveLength(LANE_SETS.behaviour.length);
  });
});
