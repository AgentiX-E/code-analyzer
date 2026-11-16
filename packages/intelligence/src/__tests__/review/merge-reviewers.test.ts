// @code-analyzer/intelligence — two reviewers, one comment list, and the arithmetic that says the merge is where the score is
//
// **The measurement this module exists for is in `docs/EVAL-CONTRACT.md` §56.** `43676036390` ran the five lanes and the
// reading agent on the same hundred pull requests, and the two arms found **198 and 171 distinct goldens with only 93 in
// common** - a union of **276 of 724 (38 %)** against 198 (27 %) for the lanes alone. So the second reviewer is not
// redundant: it sees 78 goldens no lane reaches.
//
// **What it also does is spend the reader's comment count.** The union of both arms is 1 920 comments; cut to twelve per
// pull request it is 890 at F1 0.2243 against the lanes' 653 at 0.2121. **+0.0122 for 36 % more comments**, most of them
// restatements of a lane's finding at a different line - the two producers describe the same defect from different
// heights. **A merge that removed those restatements and kept the 78 unique goldens would be 770 comments at 0.2422**,
// which is the number this module is built to reach.
//
// **Selection, not rewriting.** The model is asked which candidates to *keep*, never how to rephrase them, and it is
// never shown a golden. That is what makes the device measurable without a second paid run: a kept finding carries the
// verdict it was already judged with, so the merge can be priced on artifacts that exist.
//
// **And it can only be trusted if it cannot be worse than the rule it replaces.** Three guards: a candidate list that
// already fits the budget buys no call at all; an answer that does not parse falls back to the deterministic cut; and an
// answer that names refs that do not exist, or names none, falls back the same way with the reason recorded.

import { describe, expect, it } from 'vitest';

import {
  MERGE_BUDGET_PER_PULL_REQUEST,
  mergeCandidates,
  mergePrompt,
  mergeReviewers,
  parseMergeAnswer,
  type MergeCandidate,
} from '../../review/merge-reviewers.js';

import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../review/llm/provider.js';

/** A provider that answers with one fixed string and records what it was asked. */
class ScriptedProvider implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';
  readonly prompts: string[] = [];

  constructor(private readonly answer: string) {}

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    this.prompts.push(prompt);
    return {
      content: this.answer,
      model: this.model,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      createdAt: '2026-11-16T00:00:00.000Z',
      finishReason: 'stop',
    };
  }

  async completeWithTools(): Promise<CompletionResult> {
    throw new Error('the merge is one completion, not a tool loop');
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

const candidate = (
  ref: string,
  source: 'lanes' | 'reader',
  overrides: Partial<MergeCandidate> = {},
): MergeCandidate => ({
  ref,
  source,
  path: 'src/index.ts',
  line: 10,
  category: 'bug',
  score: 0.5,
  text: `${source} says something about ${ref}`,
  ...overrides,
});

const lanes = [
  candidate('l1', 'lanes', {
    score: 0.9,
    line: 10,
    text: 'The new branch ignores the parsed error value',
  }),
  candidate('l2', 'lanes', {
    score: 0.4,
    line: 80,
    path: 'src/other.ts',
    category: 'architecture',
  }),
];
const reader = [
  candidate('r1', 'reader', {
    score: 0.7,
    line: 12,
    text: 'The new branch drops the parsed error value',
  }),
  candidate('r2', 'reader', {
    score: 0.6,
    line: 140,
    path: 'src/third.ts',
    category: 'documentation',
  }),
];

describe('the merge of two reviewers', () => {
  it('keeps everything, and buys no call, when the candidates already fit the budget', async () => {
    const provider = new ScriptedProvider('{"keep":["l1"]}');
    const outcome = await mergeReviewers({ lanes, reader, provider, budget: 12 });
    expect(outcome.kept.map((entry) => entry.ref)).toEqual(['l1', 'r1', 'r2', 'l2']);
    expect(outcome.decidedBy).toBe('budget');
    expect(provider.prompts).toHaveLength(0);
  });

  it('asks the model once, shows it both reviewers, and never shows it an answer key', async () => {
    const provider = new ScriptedProvider(
      '{"keep":["l1","r2"],"duplicates":[{"drop":"r1","of":"l1"}]}',
    );
    const outcome = await mergeReviewers({ lanes, reader, provider, budget: 2 });
    expect(provider.prompts).toHaveLength(1);
    expect(outcome.kept.map((entry) => entry.ref)).toEqual(['l1', 'r2']);
    expect(outcome.decidedBy).toBe('model');
    const prompt = provider.prompts[0] ?? '';
    // **Both sentences are in the prompt**, because a merge that is shown one reviewer and asked about two is a merge
    // that will happily keep the one it was shown.
    expect(prompt).toContain('ignores the parsed error value');
    expect(prompt).toContain('drops the parsed error value');
    // **And nothing that looks like the corpus.** The word `golden` in a merge prompt would be a device measured on an
    // answer key it could read.
    expect(prompt.toLowerCase()).not.toContain('golden');
    // **The duplicate is recorded with the candidate it duplicates, and the rest are recorded as simply not kept** -
    // the two are different statements about a merge and a total that added them would hide which one happened.
    expect(outcome.dropped).toEqual([
      { ref: 'r1', reason: 'duplicate', of: 'l1' },
      { ref: 'l2', reason: 'not-kept' },
    ]);
  });

  it('refuses a ref it was not offered, and refuses a second copy of one it was', async () => {
    const provider = new ScriptedProvider('{"keep":["l1","l1","r9"]}');
    const outcome = await mergeReviewers({ lanes, reader, provider, budget: 2 });
    expect(outcome.kept.map((entry) => entry.ref)).toEqual(['l1']);
    expect(
      outcome.dropped.filter((entry) => entry.reason === 'unknown-ref').map((entry) => entry.ref),
    ).toEqual(['r9']);
  });

  it('cuts an over-generous answer down to the budget rather than posting what the model asked for', async () => {
    const provider = new ScriptedProvider('{"keep":["l2","r1","l1","r2"]}');
    const outcome = await mergeReviewers({ lanes, reader, provider, budget: 2 });
    expect(outcome.kept).toHaveLength(2);
    // **By score, and lane wins a tie**, which is the order `mergeCandidates` already measures.
    expect(outcome.kept.map((entry) => entry.ref)).toEqual(['l1', 'r1']);
    expect(outcome.dropped.filter((entry) => entry.reason === 'over-budget')).toHaveLength(2);
  });

  it('falls back to the measured cut, and says which path it took, when the answer does not parse', async () => {
    const provider = new ScriptedProvider('I think the first one is better, and the third too.');
    const outcome = await mergeReviewers({ lanes, reader, provider, budget: 2 });
    expect(outcome.decidedBy).toBe('fallback');
    expect(outcome.detail).toContain('unparseable');
    expect(outcome.kept.map((entry) => entry.ref)).toEqual(['l1', 'r1']);
  });

  it('falls back when the model keeps nothing, because a silent merge is not a merge', async () => {
    const provider = new ScriptedProvider('{"keep":[]}');
    const outcome = await mergeReviewers({ lanes, reader, provider, budget: 2 });
    expect(outcome.decidedBy).toBe('fallback');
    expect(outcome.detail).toContain('empty');
    expect(outcome.kept.map((entry) => entry.ref)).toEqual(['l1', 'r1']);
  });

  it('reads an answer wrapped in prose or a code fence, because a model that explains itself is not a failure', () => {
    const fenced = 'Here is the merge:\n```json\n{"keep":["l1"]}\n```\nThat is all.';
    expect(parseMergeAnswer(fenced)?.keep).toEqual(['l1']);
    expect(parseMergeAnswer('nothing to say')).toBeNull();
  });

  it('makes no call and returns the lanes untouched when the second reviewer filed nothing', async () => {
    const provider = new ScriptedProvider('{"keep":["l1"]}');
    const outcome = await mergeReviewers({ lanes, reader: [], provider, budget: 12 });
    expect(outcome.kept.map((entry) => entry.ref)).toEqual(['l1', 'l2']);
    expect(provider.prompts).toHaveLength(0);
    expect(outcome.detail).toContain('one reviewer');
  });

  it('orders by score across both reviewers, and lane before reader on a tie', () => {
    const outcome = mergeCandidates(
      [
        candidate('r1', 'reader', { score: 0.5 }),
        candidate('l1', 'lanes', { score: 0.5 }),
        candidate('l9', 'lanes', { score: 0.95 }),
      ],
      2,
    );
    expect(outcome.kept.map((entry) => entry.ref)).toEqual(['l9', 'l1']);
    expect(outcome.dropped).toEqual([{ ref: 'r1', reason: 'over-budget' }]);
  });

  it('sorts a lane above a reader whichever way round the comparator is asked', () => {
    // **Both directions of the tie-break, because a sort calls the comparator both ways** and a comparator that answers
    // only one of them is a comparator whose order depends on the input order. The two candidates are otherwise
    // identical: same score, same pull request, same line.
    const lanesFirst = mergeCandidates(
      [candidate('l1', 'lanes', { score: 0.5 }), candidate('r1', 'reader', { score: 0.5 })],
      2,
    );
    const readerFirst = mergeCandidates(
      [candidate('r1', 'reader', { score: 0.5 }), candidate('l1', 'lanes', { score: 0.5 })],
      2,
    );
    expect(lanesFirst.kept.map((entry) => entry.ref)).toEqual(['l1', 'r1']);
    expect(readerFirst.kept.map((entry) => entry.ref)).toEqual(['l1', 'r1']);
  });

  it('states the budget and numbers the candidates, so the answer is about refs rather than about order', () => {
    const prompt = mergePrompt([...lanes, ...reader], 3);
    expect(prompt).toContain('at most 3');
    expect(prompt).toContain('[l1]');
    expect(prompt).toContain('[r2]');
    // **The source is named beside each candidate**, because "prefer the reviewer that read the code" is a decision the
    // model cannot make from a sentence alone.
    expect(prompt).toContain('lanes');
    expect(prompt).toContain('reader');
  });

  it('refuses an answer with no object in it, or one whose keep is not a list', () => {
    // **Three shapes of refusal**, because each is a different defect in the prompt's contract: no JSON at all, a brace
    // that opens and never closes, and JSON whose `keep` is a string. A parser that accepted the third would iterate its
    // characters and keep nothing, and the caller would record an empty merge rather than an unparseable answer.
    expect(parseMergeAnswer('the merge is fine')).toBeNull();
    expect(parseMergeAnswer('{')).toBeNull();
    // **A brace at each end and no JSON between them**, which is the only input that reaches the parser and fails there:
    // `{` alone is refused by the slice, so a test that stopped there would leave the `catch` unexercised.
    expect(parseMergeAnswer('{ keep: l1 }')).toBeNull();
    expect(parseMergeAnswer('{"keep":"l1"}')).toBeNull();
    // And one that parses: the difference has to be visible in the same test.
    expect(parseMergeAnswer('{"keep":[]}')).toEqual({ keep: [], duplicates: [] });
  });

  it('keeps only the strings of a keep list, and only the well-formed duplicates', () => {
    // **The model is asked for strings and returns what it returns.** A `1` in the list is not a ref, and a duplicate
    // entry missing its `of` cannot be used to explain a drop - both are filtered rather than trusted.
    expect(
      parseMergeAnswer(
        '{"keep":[1,"l1",null],"duplicates":[{"drop":"r1"},"nonsense",{"drop":"r2","of":"l1"}]}',
      ),
    ).toEqual({ keep: ['l1'], duplicates: [{ drop: 'r2', of: 'l1' }] });
    expect(parseMergeAnswer('{"keep":["l1"],"duplicates":"none"}')).toEqual({
      keep: ['l1'],
      duplicates: [],
    });
  });

  it('cuts to a budget of zero rather than treating it as no budget', () => {
    // **`Math.max(0, budget)` is a guard with a meaning**: a caller that asks for no comments gets none, and a negative
    // budget is not a licence to post everything.
    const outcome = mergeCandidates([candidate('l1', 'lanes')], 0);
    expect(outcome.kept).toEqual([]);
    expect(outcome.dropped).toEqual([{ ref: 'l1', reason: 'over-budget' }]);
  });

  it('defaults to the shipped budget and the shipped tag when the caller names neither', async () => {
    const provider = new ScriptedProvider('{"keep":["l1"]}');
    // Thirteen candidates, so the default budget of twelve binds and a call is bought - which is the only way to see
    // that the default was read rather than a caller's value.
    const many = Array.from({ length: 13 }, (_, at) =>
      candidate(`r${String(at)}`, 'reader', { score: 0.1 + at / 100 }),
    );
    const outcome = await mergeReviewers({ lanes, reader: many, provider });
    expect(outcome.decidedBy).toBe('model');
    expect(outcome.kept.length).toBeLessThanOrEqual(MERGE_BUDGET_PER_PULL_REQUEST);
    expect(provider.prompts[0]).toContain(`at most ${String(MERGE_BUDGET_PER_PULL_REQUEST)}`);
  });

  it('ships a budget of twelve per pull request, which is the point §54 priced', () => {
    expect(MERGE_BUDGET_PER_PULL_REQUEST).toBe(12);
  });
});
