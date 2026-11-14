// @code-analyzer/intelligence — the idiom lane is wired, off by default, and free
//
// **Three claims, and each one is a way the lane could be wrong without the rules being wrong.**
//
// 1. **Off is off.** Every published figure in this repository was measured without this lane, so a default of `true`
//    would make `benchmarks/aacr-bench.json` a description of a product that no longer exists. The first test asserts
//    the absence on a patch the lane would definitely have spoken about.
// 2. **On is additive rather than a replacement.** The lane is worth having only if the five model lanes still answer:
//    a switch that quietly replaced them would raise the score by reviewing less.
// 3. **The lane costs nothing.** No provider call, no tokens, no latency - which is the whole reason a construct that
//    can be decided from syntax is decided from syntax.
//
// **And the coordinate constraint.** The lane reads the *patch's* added lines, so text that is not a patch produces
// nothing rather than a finding on a guessed line. The benchmark hands a patch and the product hands a patch; a caller
// that hands a code window gets silence, which is the correct answer to a question about coordinates it did not ask.

import { describe, expect, it, vi } from 'vitest';

import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';

import type { LLMProvider, CompletionResult } from '../../review/llm/provider.js';
import type { GitDiff } from '@code-analyzer/shared';

/** A provider that answers every lane with the same, empty report and counts the calls it served. */
function quietProvider(): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn((): Promise<CompletionResult> =>
    Promise.resolve({
      content: JSON.stringify({ findings: [] }),
      model: 'mock-model',
      createdAt: new Date().toISOString(),
      finishReason: 'stop',
    }),
  );
  return {
    name: 'QuietProvider',
    model: 'mock-model',
    complete,
    completeWithTools: vi.fn(),
    healthCheck: vi.fn(),
  };
}

/** A patch whose two added lines are a commented-out call and a loose comparison. */
const PATCH = [
  '@@ -10,2 +10,4 @@ export function read(value: unknown) {',
  '  const before = value;',
  '+//   this.cache.clear();',
  '+if (value == 0) {',
].join('\n');

const diff = (): GitDiff => ({
  filePath: 'src/subject.ts',
  oldHash: 'aaa',
  newHash: 'bbb',
  ranges: [{ oldStart: 10, oldEnd: 11, newStart: 10, newEnd: 12, changeType: 'modified' }],
  changeType: 'modified',
});

const lanes = ['maintainability'] as const;

describe('the idiom lane is a lane a caller turns on', () => {
  it('says nothing when the option is absent', async () => {
    const engine = new LLMReviewEngine(quietProvider(), { lanes: [...lanes] });
    const results = await engine.reviewDiff(diff(), PATCH);
    expect(results.flatMap((result) => result.findings).filter((f) => f.lane === 'idioms')).toEqual(
      [],
    );
    expect(results.some((result) => result.source === 'idioms')).toBe(false);
  });

  it('adds its remarks beside the model lanes rather than instead of them', async () => {
    const engine = new LLMReviewEngine(quietProvider(), { lanes: [...lanes], idioms: true });
    const results = await engine.reviewDiff(diff(), PATCH);
    const idiom = results.filter((result) => result.source === 'idioms');
    expect(idiom).toHaveLength(1);
    expect(idiom[0]?.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(['commented-out-code', 'loose-equality']),
    );
    // **The model lane is still there.** `quietProvider` returns no findings, so the assertion is about the result
    // existing at all: a lane whose result was replaced by the deterministic one would have made this list shorter.
    expect(
      results.some((result) => result.source === undefined && result.lane === 'maintainability'),
    ).toBe(true);
  });

  it('costs no provider call', async () => {
    const without = quietProvider();
    const withLane = quietProvider();
    await new LLMReviewEngine(without, { lanes: [...lanes] }).reviewDiff(diff(), PATCH);
    await new LLMReviewEngine(withLane, { lanes: [...lanes], idioms: true }).reviewDiff(
      diff(),
      PATCH,
    );
    // **Equal, not "at most".** A lane that bought one call to decide a `==` would be a lane whose cost has to be
    // weighed against its four goldens, and it would not be worth weighing.
    expect(withLane.complete.mock.calls.length).toBe(without.complete.mock.calls.length);
  });

  it('stays silent on text that is not a patch', async () => {
    // A code window rather than a diff: the lines are real, the coordinates are not derivable.
    const engine = new LLMReviewEngine(quietProvider(), { lanes: [...lanes], idioms: true });
    const results = await engine.reviewDiff(diff(), 'if (value == 0) {\n  return null;\n}');
    expect(results.some((result) => result.source === 'idioms')).toBe(false);
  });
});

describe('the lane places its comment where the line is', () => {
  it("reports the patch's new-side line number, not the patch line", async () => {
    const engine = new LLMReviewEngine(quietProvider(), { lanes: [...lanes], idioms: true });
    const results = await engine.reviewDiff(diff(), PATCH);
    const idiom = results.find((result) => result.source === 'idioms');
    const loose = idiom?.findings.find((finding) => finding.id === 'loose-equality');
    // The hunk starts at new-side line 10; the context line is 10, the commented call is 11, the comparison is 12.
    expect(loose?.startLine).toBe(12);
  });
});
