// @code-analyzer — the three ways `--ensemble` can end, and the one it must never end in
//
// **`mergeTwoReviewers` is the join between the command and the rule**, and it has three exits that a corpus will reach on
// different days: the candidates already fit the twelve-comment budget and no call is bought; the model answers and its
// answer is used; the provider fails and **the lanes are kept alone rather than the review being lost**. The third is the
// one worth writing down, because the obvious implementation - `return mergeReviewers(...)` - throws away a reviewer that
// already finished when the second one is rate-limited, and a user who paid for one review would get none.
//
// **And it must never end in a report that says two reviewers were merged when one ran.** That is why `decidedBy` is in
// the report: `refused` is a different word from `budget`, and a reader who expected a comment can see which path decided
// whether to explain its absence or to fix the key.

import { describe, expect, it } from 'vitest';

import { mergeTwoReviewers } from '../commands/pr-review.js';

import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../../intelligence/src/review/llm/provider.js';
import type { PrReviewFinding } from '../commands/pr-review.js';

class ScriptedProvider implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';
  readonly prompts: string[] = [];

  constructor(private readonly behaviour: string | Error) {}

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    this.prompts.push(prompt);
    if (this.behaviour instanceof Error) throw this.behaviour;
    return {
      content: this.behaviour,
      model: this.model,
      createdAt: new Date(0).toISOString(),
      finishReason: 'stop',
    };
  }

  async completeWithTools(): Promise<CompletionResult> {
    throw new Error('the merge is one completion');
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

const finding = (id: string, overrides: Partial<PrReviewFinding> = {}): PrReviewFinding => ({
  id,
  file: 'src/index.ts',
  line: 10,
  endLine: 10,
  severity: 'high',
  category: 'bug',
  lens: 'logic',
  source: 'lens',
  title: `title ${id}`,
  description: `description ${id}`,
  snippet: 'const x = 1;',
  confidence: 'high',
  autoFixable: false,
  inDiff: true,
  ...overrides,
});

describe('the join between --ensemble and the merge', () => {
  it('keeps both reviewers and buys no call when the candidates fit the budget', async () => {
    const provider = new ScriptedProvider('{"keep":[]}');
    const outcome = await mergeTwoReviewers({
      lanes: [finding('l0'), finding('l1')],
      reader: [finding('r0', { source: 'agent', lens: 'agent' })],
      provider,
      budget: 12,
    });
    expect(outcome.decidedBy).toBe('budget');
    expect(outcome.kept.map((entry) => entry.id)).toEqual(['l0', 'l1', 'r0']);
    expect(outcome.candidates).toBe(3);
    expect(provider.prompts).toHaveLength(0);
    expect(outcome.error).toBeUndefined();
  });

  it('maps the model\u2019s answer back to the findings it named, and counts what it removed', async () => {
    const provider = new ScriptedProvider(
      '{"keep":["l0","r0"],"duplicates":[{"drop":"l1","of":"l0"}]}',
    );
    const outcome = await mergeTwoReviewers({
      lanes: [finding('l0'), finding('l1'), finding('l2')],
      reader: [finding('r0', { source: 'agent', lens: 'agent' })],
      provider,
      budget: 2,
    });
    expect(outcome.decidedBy).toBe('model');
    expect(outcome.kept.map((entry) => entry.id).sort()).toEqual(['l0', 'r0']);
    // **Every candidate is accounted for**: two kept, one duplicate, one simply not kept. A report that only counted the
    // kept ones would make a merge look like a review that found less.
    expect(outcome.dropped).toEqual({ duplicate: 1, 'not-kept': 1 });
    expect(outcome.error).toBeUndefined();
  });

  it('keeps the lanes when the provider fails, and says the merge was refused', async () => {
    const provider = new ScriptedProvider(new Error('429 rate limited'));
    const outcome = await mergeTwoReviewers({
      lanes: [finding('l0'), finding('l1')],
      reader: [finding('r0', { source: 'agent' })],
      provider,
      budget: 2,
    });
    // **The lanes are the review.** A second opinion that cannot be bought is a reason to post one reviewer's comments
    // and to say so, not a reason for a command that exits with nothing.
    expect(outcome.kept.map((entry) => entry.id)).toEqual(['l0', 'l1']);
    expect(outcome.decidedBy).toBe('refused');
    expect(outcome.dropped).toEqual({ 'merge-failed': 1 });
    expect(outcome.error).toContain('429');
  });
});
