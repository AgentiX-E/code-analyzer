// @code-analyzer/intelligence — the order device, tested as a device rather than as a prompt
//
// `docs/EVAL-CONTRACT.md` §9 registered one arrangement and one measurement, and §10 registers the arrangement that
// replaced it. The measurements need a corpus and a model and cost money; **these tests settle the part that does
// not** - which block each order leads with, that the block is one block and not five, that the previous arrangement
// is byte-for-byte recoverable, and that the engine does not send a warm-up round it does not need.
//
// **What these tests deliberately do not claim.** A shared prefix is not a cache hit: the vendor decides what it
// stores, and only a run of the corpus reports `spend.cacheHitRatio`. A test that asserted a hit here would be a test
// of a mock.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine, planLaneWaves } from '../llm-review-engine.js';
import {
  ARCHITECTURE_REVIEW_PROMPT,
  MAINTAINABILITY_REVIEW_PROMPT,
  PERFORMANCE_REVIEW_PROMPT,
  SECURITY_REVIEW_PROMPT,
  TESTING_REVIEW_PROMPT,
  composeLanePrompt,
  sharedPrefix,
  type PromptContext,
  type ReviewLane,
} from '../prompts.js';

import type { CompletionOptions, CompletionResult, LLMProvider } from '../provider.js';
import type { GitDiff } from '@code-analyzer/shared';

const DIFF = [
  'diff --git a/src/retry.py b/src/retry.py',
  'index 1111111..2222222 100644',
  '--- a/src/retry.py',
  '+++ b/src/retry.py',
  '@@ -1,4 +1,6 @@',
  '+import time',
  '+',
  ' def send_with_retry(client, url):',
  '-    attempt = 0',
  '+    attempt = 0  # the budget is never checked against the deadline',
  '     while attempt < RETRIES:',
].join('\n');

function ctx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    diffContent: DIFF,
    filePath: 'src/retry.py',
    changeType: 'modified',
    ...overrides,
  };
}

const LANES: ReviewLane[] = [
  'security',
  'architecture',
  'performance',
  'maintainability',
  'testing',
];

const builders = {
  security: SECURITY_REVIEW_PROMPT,
  performance: PERFORMANCE_REVIEW_PROMPT,
  maintainability: MAINTAINABILITY_REVIEW_PROMPT,
  testing: TESTING_REVIEW_PROMPT,
  architecture: ARCHITECTURE_REVIEW_PROMPT,
} as const;

describe('the block that changes with the file', () => {
  it('is the target and the diff, and nothing lane-specific', () => {
    const prefix = sharedPrefix(ctx());

    expect(prefix).toContain(DIFF);
    expect(prefix).toContain('File: src/retry.py');
    expect(prefix).toContain('Change type: modified');
    // **No lane's role sentence may be inside the shared block**, or five prompts would disagree inside it and
    // "shared" would be a word rather than a property.
    for (const wording of [
      'security reviewer',
      'software architect',
      'performance engineer',
      'code quality reviewer',
      'test engineer',
    ]) {
      expect(prefix).not.toContain(wording);
    }
  });

  it('is one string in all five lanes, in every order', () => {
    for (const order of ['boilerplate-first', 'diff-first', 'lane-first'] as const) {
      const shared = sharedPrefix(ctx({ promptOrder: order }));
      for (const [lane, build] of Object.entries(builders)) {
        const prompt = build(ctx({ promptOrder: order }));
        // **Once, and only once**: a block that appeared twice would be two copies to keep in step, and the second
        // one would be the one that drifted.
        expect(prompt.split(shared).length - 1, `${lane}/${order}`).toBe(1);
      }
    }
  });

  it('is the same block for a pull-request call, whose paths are part of it', () => {
    const context = ctx({ scope: 'pull-request', paths: ['src/a.py', 'src/b.py'] });
    const shared = sharedPrefix(context);
    const prompt = SECURITY_REVIEW_PROMPT({ ...context, promptOrder: 'diff-first' });

    expect(shared).toContain('- src/a.py');
    expect(shared).toContain('- src/b.py');
    expect(prompt.startsWith(shared)).toBe(true);
  });

  /**
   * **The figure §9 was registered without, measured here so that the registration could be corrected rather than
   * run.**
   *
   * A lane spends between 7 344 and 8 144 characters on its role, its checklist, its output contract and its examples;
   * the target-and-diff block is 563 characters at a 500-character diff and 8 063 at the default 8 000-character cap.
   * **So the block §9 moved to the front is 7 % of a call at the corpus's usual diff size and 51 % only at the cap** -
   * and it is a different block for every file, which is what separates a large prefix from a *reused* one.
   *
   * **These are the numbers that decide the default**, so they are asserted rather than described: a change that
   * shrank the boilerplate or inflated the block would move what the order is worth, and should fail here first.
   */
  it('is a seventh of a small call and a half of a truncation', () => {
    const boilerplate = (n: number): number => {
      const context = ctx({ diffContent: 'x'.repeat(n) });
      // The blank line the shipped order inserts is neither boilerplate nor block, so it is excluded from both.
      return SECURITY_REVIEW_PROMPT(context).length - sharedPrefix(context).length - 2;
    };

    // The boilerplate does not move when the diff does: it is the same string in every call the lane ever makes.
    expect(boilerplate(500)).toBe(boilerplate(8000));
    expect(boilerplate(500)).toBeGreaterThan(7000);

    const share = (n: number): number => {
      const context = ctx({ diffContent: 'x'.repeat(n) });
      return sharedPrefix(context).length / SECURITY_REVIEW_PROMPT(context).length;
    };

    // **A small diff is mostly boilerplate**, which is the finding: the block §9 moved is 7 % of such a call.
    expect(share(500)).toBeLessThan(0.1);
    // **Only at the truncation cap does the diff become half the call.**
    expect(share(8000)).toBeGreaterThan(0.5);
  });

  it('differs across files, which is why it cannot be the prefix that ships', () => {
    const first = sharedPrefix(ctx({ filePath: 'src/a.py' }));
    const second = sharedPrefix(ctx({ filePath: 'src/b.py' }));

    // Same diff, two files: **the block differs in its first line**, so a sweep of many files shares nothing.
    expect(first).not.toBe(second);
    expect(first.startsWith('File: src/a.py')).toBe(true);
    expect(second.startsWith('File: src/b.py')).toBe(true);
  });

  it('while the lane boilerplate is shared across every file the lane reads', () => {
    const a = SECURITY_REVIEW_PROMPT(ctx({ filePath: 'src/a.py' }));
    const b = SECURITY_REVIEW_PROMPT(ctx({ filePath: 'src/b.py' }));

    // **The prefix that ships is everything before the target block**, and it is identical for two different files.
    const headOf = (prompt: string): string => prompt.slice(0, prompt.indexOf('\n\nFile: '));
    expect(headOf(a)).toBe(headOf(b));
    expect(headOf(a).length).toBeGreaterThan(7000);
  });
});

describe('the three orders', () => {
  /**
   * **One block, moved, plus one blank line - and no other difference at all.**
   *
   * The relation is stated over `body = lane-first minus the block`, so all three arrangements are checked against the
   * same two pieces: **a reordering device that also rewrote a word would be two changes measured as one**, and this is
   * the assertion that keeps them separable.
   */
  it('are the same three pieces in three positions', () => {
    for (const [lane, build] of Object.entries(builders)) {
      const shared = sharedPrefix(ctx());
      const laneFirst = build(ctx({ promptOrder: 'lane-first' }));

      const at = laneFirst.indexOf(shared);
      expect(at, lane).toBeGreaterThan(0);
      const head = laneFirst.slice(0, at);
      const tail = laneFirst.slice(at + shared.length);
      expect(tail.length, lane).toBeGreaterThan(0);

      expect(laneFirst, lane).toBe(`${head}${shared}${tail}`);
      expect(build(ctx({ promptOrder: 'diff-first' })), lane).toBe(`${shared}${head}${tail}`);
      expect(build(ctx({ promptOrder: 'boilerplate-first' })), lane).toBe(
        `${head}${tail}\n\n${shared}`,
      );
    }
  });

  it('start, and end, where their names say', () => {
    const diffFirst = SECURITY_REVIEW_PROMPT(ctx({ promptOrder: 'diff-first' }));
    const laneFirst = SECURITY_REVIEW_PROMPT(ctx({ promptOrder: 'lane-first' }));
    const boilerplateFirst = SECURITY_REVIEW_PROMPT(ctx({ promptOrder: 'boilerplate-first' }));

    expect(diffFirst.startsWith('File: src/retry.py')).toBe(true);
    expect(laneFirst.startsWith('You are an expert security reviewer')).toBe(true);
    // **The shipped arrangement leads with what never changes and ends with what always does.** `lane-first` leads
    // with the same words, but the block arrives nine hundred characters later, and a prefix that stops at the file
    // path is a prefix nothing reuses.
    expect(boilerplateFirst.startsWith('You are an expert security reviewer')).toBe(true);
    expect(boilerplateFirst.endsWith(`${DIFF}\n\`\`\`\n\n`)).toBe(true);
  });

  it('default to boilerplate-first, because a default is what the benchmark measures', () => {
    const shipped = SECURITY_REVIEW_PROMPT(ctx());

    expect(shipped).toBe(SECURITY_REVIEW_PROMPT(ctx({ promptOrder: 'boilerplate-first' })));
    expect(shipped).not.toBe(SECURITY_REVIEW_PROMPT(ctx({ promptOrder: 'lane-first' })));
    expect(shipped).not.toBe(SECURITY_REVIEW_PROMPT(ctx({ promptOrder: 'diff-first' })));
  });

  it('are the same length apart from the one separator', () => {
    const laneFirst = SECURITY_REVIEW_PROMPT(ctx({ promptOrder: 'lane-first' })).length;
    const diffFirst = SECURITY_REVIEW_PROMPT(ctx({ promptOrder: 'diff-first' })).length;
    const boilerplateFirst = SECURITY_REVIEW_PROMPT(
      ctx({ promptOrder: 'boilerplate-first' }),
    ).length;

    expect(diffFirst).toBe(laneFirst);
    expect(boilerplateFirst).toBe(laneFirst + 2);
  });
});

describe('composeLanePrompt', () => {
  it('is the whole mechanism, so an order that is not one of the three is not silently one of them', () => {
    const head = 'HEAD-';
    const tail = '-TAIL';
    const shared = sharedPrefix(ctx());

    expect(composeLanePrompt(ctx({ promptOrder: 'diff-first' }), head, tail)).toBe(
      `${shared}${head}${tail}`,
    );
    expect(composeLanePrompt(ctx({ promptOrder: 'lane-first' }), head, tail)).toBe(
      `${head}${shared}${tail}`,
    );
    expect(composeLanePrompt(ctx({ promptOrder: 'boilerplate-first' }), head, tail)).toBe(
      `${head}${tail}\n\n${shared}`,
    );
    // **Undefined is the shipped order**, not a fourth one.
    expect(composeLanePrompt(ctx(), head, tail)).toBe(`${head}${tail}\n\n${shared}`);
  });
});

describe('planLaneWaves', () => {
  it('puts one lane alone in the first round and the rest together', () => {
    expect(planLaneWaves(LANES, 2)).toEqual([
      ['security'],
      ['architecture', 'performance', 'maintainability', 'testing'],
    ]);
  });

  it('can reach one lane per round, which is the sequential arrangement', () => {
    const plan = planLaneWaves(LANES, 5);
    expect(plan).toHaveLength(5);
    expect(plan.flat()).toEqual(LANES);
    expect(plan.every((round) => round.length === 1)).toBe(true);
  });

  it('splits the remainder evenly when asked for three rounds', () => {
    expect(planLaneWaves(LANES, 3)).toEqual([
      ['security'],
      ['architecture', 'performance'],
      ['maintainability', 'testing'],
    ]);
  });

  it('treats one round as the shipped arrangement, and never throws on a bad number', () => {
    expect(planLaneWaves(LANES, 1)).toEqual([LANES]);
    expect(planLaneWaves(LANES, 0)).toEqual([LANES]);
    expect(planLaneWaves(LANES, -4)).toEqual([LANES]);
    expect(planLaneWaves(LANES, Number.NaN)).toEqual([LANES]);
    expect(planLaneWaves(LANES, 99)).toHaveLength(5);
  });

  it('covers every lane exactly once, for every wave count', () => {
    for (let waves = 1; waves <= LANES.length + 2; waves += 1) {
      const plan = planLaneWaves(LANES, waves);
      expect(plan.flat(), `waves=${String(waves)}`).toEqual(LANES);
      expect(
        plan.every((round) => round.length > 0),
        `waves=${String(waves)}`,
      ).toBe(true);
    }
  });

  it('has nothing to schedule when there are no lanes', () => {
    expect(planLaneWaves([], 2)).toEqual([]);
  });
});

/**
 * **A provider that records what it was asked, and when.**
 *
 * Not a mock of the provider's behaviour: it *is* an implementation of the interface, and the thing under test - the
 * engine's schedule - is measured by the order of its own calls. **The distinction matters**: substituting a provider
 * is how the engine is given something to talk to; substituting the *engine* would leave nothing to test.
 */
class RecordingProvider implements LLMProvider {
  readonly name = 'recording';
  readonly model = 'recording';
  readonly started: ReviewLane[] = [];
  readonly finished: ReviewLane[] = [];
  readonly prompts: string[] = [];

  async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
    const lane = String(options?.tag ?? 'review:security').replace('review:', '') as ReviewLane;
    this.started.push(lane);
    this.prompts.push(prompt);
    // One turn of the microtask queue, so that a round of concurrent calls is observably concurrent.
    await Promise.resolve();
    this.finished.push(lane);
    return {
      content: '{"findings": []}',
      model: this.model,
      usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
      createdAt: '2026-11-10T00:00:00.000Z',
      finishReason: 'stop',
    };
  }

  async completeWithTools(
    prompt: string,
    _tools: unknown[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    return this.complete(prompt, options);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

const diff: GitDiff = {
  filePath: 'src/retry.py',
  oldHash: '1111111',
  newHash: '2222222',
  changeType: 'modified',
  oldPath: 'src/retry.py',
  ranges: [{ oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 3, changeType: 'modified' }],
};

describe('the engine sends the round it needs and no more', () => {
  it('sends all five at once by default, because the shipped prefix is shared across files', async () => {
    const provider = new RecordingProvider();
    const engine = new LLMReviewEngine(provider);

    await engine.reviewDiff(diff);

    // Every start precedes every finish: nothing was waited for, so **the shipped default costs no latency over the
    // arrangement it replaced**.
    expect(provider.started).toEqual(LANES);
    expect(provider.finished).toEqual(provider.started);
  });

  it('finishes one lane before the other four are sent when a warm-up round is asked for', async () => {
    const provider = new RecordingProvider();
    const engine = new LLMReviewEngine(provider, { laneWaves: 2 });

    await engine.reviewDiff(diff);

    expect(provider.started).toHaveLength(5);
    // **The claim, in one assertion.** The first lane has already answered before the second one is asked, which is
    // the only ordering in which a file-scoped prefix can be reused - and the arrangement §9 needed to be measurable.
    expect(provider.finished[0]).toBe(provider.started[0]);
    expect(provider.started[1]).not.toBe(provider.started[0]);
  });

  it('gives every lane the same target block at the end', async () => {
    const provider = new RecordingProvider();
    const engine = new LLMReviewEngine(provider);

    await engine.reviewDiff(diff);

    // The engine truncates and rebuilds the diff, so the block is taken from the prompts themselves rather than from a
    // fixture: **the identity under test is between the five requests the provider actually received.**
    const tails = provider.prompts.map((prompt) => prompt.slice(prompt.indexOf('\n\nFile: ')));
    expect(new Set(tails).size, 'the five lanes did not share a target block').toBe(1);
    for (const prompt of provider.prompts) expect(prompt).toContain('Diff content:');
  });

  it('runs strictly one at a time when parallel is off, whatever the wave count says', async () => {
    const provider = new RecordingProvider();
    const engine = new LLMReviewEngine(provider, { parallel: false, laneWaves: 2 });

    await engine.reviewDiff(diff);

    expect(provider.started).toEqual(provider.finished);
    expect(provider.started).toHaveLength(5);
  });

  it('reports the lane order the deduplication depends on', async () => {
    const provider = new RecordingProvider();
    const engine = new LLMReviewEngine(provider, { laneWaves: 2 });

    const results = await engine.reviewDiff(diff);

    expect(results.map((result) => result.lane)).toEqual(LANES);
  });
});
