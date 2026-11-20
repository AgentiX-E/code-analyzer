// @code-analyzer/intelligence — one prompt can ask five questions, and the price of asking them separately
//
// **The measurement this file prices.** A run of fifty pull requests bought 2 945 lane calls for 6.86 M prompt tokens,
// and the artifact's own ledger splits them almost evenly: `security` 1 456 332, `performance` 1 364 316,
// `maintainability` 1 338 756, `testing` 1 362 399, `architecture` 1 337 478. **Five calls carry five copies of one
// diff**, because a lane's prompt is the shared target-and-diff block plus one instruction - and the shared block is
// the whole of the price.
//
// **What that costs in quality is not this file's question.** A fused call may well find fewer defects than five
// specialists do; that is a paid run's question and it is registered before it is dispatched. **What this file settles
// is the arithmetic nobody has to pay for**: how many calls a fused run makes, and how many characters of prompt it
// sends, both read off the prompt builders themselves.
//
// **The attribution rule is the design decision.** A fused answer is a list of findings, and the only thing that says
// which of the five questions produced one is the finding's own `lane`. That label is what the per-lane tables, the
// agreement feature and the merge all read, so **a finding that mislabels itself would move money between lanes in the
// ledger** - which is why the fallback is a table from the category the reviewer actually asserted rather than a guess.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '../llm-review-engine.js';
import {
  FUSED_REVIEW_PROMPT,
  LANE_OF_CATEGORY,
  LANE_PROMPTS,
  LANE_SETS,
  parseLLMResponse,
} from '../prompts.js';

import type { PromptContext, ReviewLane } from '../prompts.js';
import type { CompletionOptions, CompletionResult, LLMProvider } from '../provider.js';
import type { GitDiff } from '@code-analyzer/shared';

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

function context(): PromptContext {
  return {
    diffContent: PATCH,
    filePath: 'src/a.ts',
    changeType: 'modified',
  };
}

/** A provider that answers with whatever it was told to answer with, counting the calls it was given. */
class Scripted implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';
  readonly prompts: string[] = [];

  constructor(private readonly answer: string) {}

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    this.prompts.push(prompt);
    return {
      content: this.answer,
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

/** One finding, in the shape the model returns it. */
function finding(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startLine: 2,
    endLine: 2,
    severity: 'medium',
    category: 'bug',
    title: 'a title',
    description: 'a description',
    suggestion: 'a suggestion',
    ...over,
  };
}

function answer(...findings: Array<Record<string, unknown>>): string {
  return JSON.stringify({ findings });
}

describe('the fused prompt', () => {
  it('names all five questions, because a fused call that dropped one is a lane nobody asked for', () => {
    const prompt = FUSED_REVIEW_PROMPT(context());
    // **One phrase per question, taken from the question rather than from the lane's own prose**: the fused prompt is a
    // sixth prompt, not a concatenation, and a test that looked for the five lane openings would have demanded the
    // duplication this device exists to remove.
    for (const marker of [
      'injection',
      'allocation',
      'duplicat',
      'test',
      'dependenc',
      'what the value',
    ]) {
      expect(prompt.toLowerCase()).toContain(marker);
    }
  });

  it('demands a lane on every finding, because the label is what the ledger reads', () => {
    const prompt = FUSED_REVIEW_PROMPT(context());
    expect(prompt).toContain('"lane"');
    expect(prompt).toContain('"findings"');
  });

  it('costs a fraction of the five calls it replaces, which is the whole claim', () => {
    const ctx = context();
    const separate = LANE_SETS.shipped.reduce(
      (sum, lane) => sum + LANE_PROMPTS[lane](ctx).length,
      0,
    );
    const fused = FUSED_REVIEW_PROMPT(ctx).length;
    // **A bar of 40 %, not of 20 %**: the fused prompt still carries five question bodies, and a claim that it costs a
    // fifth would be a claim that the questions are free. What has to disappear is the *diff*, which is copied once.
    expect(fused).toBeLessThan(separate * 0.4);
  });

  it('is stable across two calls, so a cached prefix is a prefix', () => {
    expect(FUSED_REVIEW_PROMPT(context())).toBe(FUSED_REVIEW_PROMPT(context()));
  });
});

describe('what a fused run sends', () => {
  it('sends one call for five lanes, and the default still sends five', async () => {
    const separate = new Scripted(answer());
    await new LLMReviewEngine(separate, { lanes: [...LANE_SETS.shipped] }).reviewDiff(
      oneDiff(),
      PATCH,
    );
    expect(separate.prompts).toHaveLength(LANE_SETS.shipped.length);

    const fused = new Scripted(answer());
    await new LLMReviewEngine(fused, {
      lanes: [...LANE_SETS.shipped],
      laneMode: 'fused',
    }).reviewDiff(oneDiff(), PATCH);
    expect(fused.prompts).toHaveLength(1);
    // **The changed line, once**, in the one call a fused run makes - against five times in the five it replaces.
    const occurrences = fused.prompts[0]!.split('+const b = 2;').length - 1;
    expect(occurrences).toBe(1);
    expect(separate.prompts.filter((prompt) => prompt.includes('+const b = 2;'))).toHaveLength(
      LANE_SETS.shipped.length,
    );
  });

  it('returns one result per lane it was asked for, so every downstream table keeps its shape', async () => {
    const provider = new Scripted(answer());
    const results = await new LLMReviewEngine(provider, {
      lanes: [...LANE_SETS.shipped],
      laneMode: 'fused',
    }).reviewDiff(oneDiff(), PATCH);
    expect(results.map((result) => result.lane)).toEqual([...LANE_SETS.shipped]);
    expect(results.every((result) => result.success)).toBe(true);
  });
});

describe('which lane a fused finding belongs to', () => {
  it('files a finding under the lane the reviewer named', async () => {
    const provider = new Scripted(
      answer(finding({ lane: 'security', category: 'security', title: 'a leak' })),
    );
    const results = await new LLMReviewEngine(provider, {
      lanes: [...LANE_SETS.shipped],
      laneMode: 'fused',
    }).reviewDiff(oneDiff(), PATCH);

    const security = results.find((result) => result.lane === 'security');
    expect(security?.findings.map((own) => own.title)).toEqual(['a leak']);
    expect(
      results.filter((result) => result.lane !== 'security' && result.findings.length > 0),
    ).toEqual([]);
  });

  it('files a finding that named no lane under the lane its category names', async () => {
    const provider = new Scripted(
      answer(finding({ category: 'performance', title: 'a quadratic scan' })),
    );
    const results = await new LLMReviewEngine(provider, {
      lanes: [...LANE_SETS.shipped],
      laneMode: 'fused',
    }).reviewDiff(oneDiff(), PATCH);

    const performance = results.find((result) => result.lane === 'performance');
    expect(performance?.findings.map((own) => own.title)).toEqual(['a quadratic scan']);
  });

  it('files a finding that named a lane this run did not buy under the lane its category names', async () => {
    // **`behaviour` is in the tree and not in the shipped set**, which is the case this rule exists for: a reviewer
    // told to answer five questions that answers a sixth has still said something about the code, and the only truthful
    // label left is the one its own category carries.
    const provider = new Scripted(
      answer(finding({ lane: 'behaviour', category: 'maintainability', title: 'a long function' })),
    );
    const results = await new LLMReviewEngine(provider, {
      lanes: [...LANE_SETS.shipped],
      laneMode: 'fused',
    }).reviewDiff(oneDiff(), PATCH);

    const maintainability = results.find((result) => result.lane === 'maintainability');
    expect(maintainability?.findings.map((own) => own.title)).toEqual(['a long function']);
  });
});

describe('the category table', () => {
  it('names a lane for every category the reviewer may assert', () => {
    const categories = [
      'bug',
      'security',
      'performance',
      'maintainability',
      'test',
      'style',
      'documentation',
      'architecture',
      'api',
      'other',
    ] as const;
    for (const category of categories) {
      const lane: ReviewLane = LANE_OF_CATEGORY[category];
      expect(LANE_SETS.wide).toContain(lane);
    }
  });
});

describe('parsing a fused answer', () => {
  it('carries the lane through when it is a string, and drops one that is not', () => {
    const parsed = parseLLMResponse(answer(finding({ lane: 'security' }), finding({ lane: 7 })));
    expect(parsed[0]?.lane).toBe('security');
    expect(parsed[1]?.lane).toBeUndefined();
  });
});

describe('a fenced answer', () => {
  it('is read, because a fused answer is one more answer a model may wrap in backticks', () => {
    // **The closing fence is the branch this covers**: `parseLLMResponse` strips an opening fence, then strips a
    // closing one only when the text ends with it, and the two are separate conditions because a truncated answer can
    // carry the opening and not the closing.
    const fenced = `\`\`\`json\n${answer(finding({ lane: 'security' }))}\n\`\`\``;
    expect(parseLLMResponse(fenced).map((own) => own.lane)).toEqual(['security']);
    // And the answer that opens a fence and never closes it, which must still parse rather than be thrown away.
    const open = `\`\`\`json\n${answer(finding({ lane: 'testing' }))}`;
    expect(parseLLMResponse(open).map((own) => own.lane)).toEqual(['testing']);
  });
});

describe('what a fused run does when it cannot answer', () => {
  it('reports one failure per lane, because the call was the only one it made', async () => {
    class Refusing implements LLMProvider {
      readonly name = 'Refusing';
      readonly model = 'refusing-1';
      async complete(): Promise<CompletionResult> {
        throw new Error('the provider said no');
      }
      async completeWithTools(): Promise<CompletionResult> {
        throw new Error('no tools here');
      }
      async healthCheck(): Promise<boolean> {
        return false;
      }
    }

    const results = await new LLMReviewEngine(new Refusing(), {
      lanes: [...LANE_SETS.shipped],
      laneMode: 'fused',
    }).reviewDiff(oneDiff(), PATCH);

    // **A reader of the ledger must not see four lanes that succeeded and one that did not** when the model was never
    // asked separately: the call is the file's only call.
    expect(results).toHaveLength(LANE_SETS.shipped.length);
    expect(results.every((result) => !result.success)).toBe(true);
    expect(results[0]?.error).toContain('the provider said no');
  });

  it('sends nothing at all when the run bought no lanes', async () => {
    const provider = new Scripted(answer());
    const results = await new LLMReviewEngine(provider, {
      lanes: [],
      laneMode: 'fused',
    }).reviewDiff(oneDiff(), PATCH);
    expect(results).toEqual([]);
    expect(provider.prompts).toEqual([]);
  });

  it('files a finding whose category the table does not know under the first lane the run bought', async () => {
    // **The third step of `laneOf`, and it is reachable**: `category` is validated as a string by the parser rather than
    // against the union, so a model that invents one reaches this branch. A finding is never dropped for its label.
    const provider = new Scripted(
      answer(finding({ category: 'lore', title: 'an invented category' })),
    );
    const results = await new LLMReviewEngine(provider, {
      lanes: [...LANE_SETS.shipped],
      laneMode: 'fused',
    }).reviewDiff(oneDiff(), PATCH);
    const first = results[0];
    expect(first?.lane).toBe(LANE_SETS.shipped[0]);
    expect(first?.findings.map((own) => own.title)).toEqual(['an invented category']);
  });
});
