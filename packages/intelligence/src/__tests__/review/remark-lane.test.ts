// @code-analyzer/intelligence — the remark pass is one call, three rails, and off unless a run says otherwise
//
// **Four claims, and each is a way the pass could be wrong while the prompt is right.**
//
// 1. **Off is off.** Every published figure in this repository was measured against the five lanes, so a default of
//    `true` would make `benchmarks/aacr-bench.json` a description of a product that no longer exists - and would re-price
//    every past run by one call per file without saying so.
// 2. **The rail is the added lines, not the hunk.** A remark on an untouched line is a comment the pull request cannot
//    carry; the coordinate is read out of the patch, so text that is not a patch produces silence rather than a finding
//    on a guessed line.
// 3. **The ceiling is three**, because a file with twelve commented-out statements is one refactor and twelve comments a
//    reader would have to dismiss.
// 4. **It is additive.** A switch that quietly replaced the lanes would raise the score by reviewing less.

import { describe, expect, it, vi } from 'vitest';

import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';
import {
  REMARK_FAMILIES,
  REMARKS_PER_FILE_CEILING,
  remarkPrompt,
  selectRemarks,
} from '../../review/remark-lane.js';

import type { LLMFinding, PromptContext } from '../../review/llm/prompts.js';
import type { LLMProvider, CompletionResult } from '../../review/llm/provider.js';
import type { GitDiff } from '@code-analyzer/shared';

/** A patch that adds two lines, at 11 and 12, and keeps line 13 as context. */
const PATCH = [
  '@@ -10,3 +10,5 @@ export function gain(factor) {',
  '  const before = factor;',
  '+  const gain = 2.0 * factor;',
  '+  //   this.cache.clear();',
  '  return gain;',
].join('\n');

const diff = (): GitDiff => ({
  filePath: 'src/subject.ts',
  oldHash: 'aaa',
  newHash: 'bbb',
  ranges: [{ oldStart: 10, oldEnd: 12, newStart: 10, newEnd: 14, changeType: 'modified' }],
  changeType: 'modified',
});

const remark = (startLine: number, title = 'remark'): LLMFinding => ({
  startLine,
  endLine: startLine,
  severity: 'low',
  category: 'maintainability',
  title,
  description: 'a remark',
  suggestion: 'write it the other way',
});

/** A provider that answers the lanes with nothing and the remark pass with whatever the test hands it. */
function providerReturning(remarks: string, laneJson = JSON.stringify({ findings: [] })) {
  const seen: Array<{ prompt: string; tag?: string }> = [];
  const complete = vi.fn(
    (prompt: string, options?: { tag?: string }): Promise<CompletionResult> => {
      seen.push({ prompt, ...(options?.tag !== undefined ? { tag: options.tag } : {}) });
      const isRemark = options?.tag === 'review:remarks';
      return Promise.resolve({
        content: isRemark ? remarks : laneJson,
        model: 'mock-model',
        createdAt: new Date().toISOString(),
        finishReason: 'stop',
      });
    },
  );
  const provider: LLMProvider = {
    name: 'ScriptedProvider',
    model: 'mock-model',
    complete,
    completeWithTools: vi.fn(),
    healthCheck: vi.fn(),
  };
  return { provider, complete, seen };
}

const lanes = ['maintainability'] as const;

describe('the rails decide what a remark pass may file', () => {
  it('keeps a remark on an added line and drops one on a context line', () => {
    const selection = selectRemarks([remark(11), remark(13, 'on a context line')], PATCH);
    expect(selection.kept.map((finding) => finding.startLine)).toEqual([11]);
    expect(selection.notAddedLine).toBe(1);
    expect(selection.notAPatch).toBe(false);
  });

  it('stops at the ceiling and counts what the ceiling removed', () => {
    const many = [11, 12, 11, 12, 11].map((line, at) => remark(line, `remark ${at}`));
    const selection = selectRemarks(many, PATCH);
    expect(selection.kept).toHaveLength(REMARKS_PER_FILE_CEILING);
    expect(selection.capped).toBe(many.length - REMARKS_PER_FILE_CEILING);
  });

  it('says nothing at all when the text is not a patch', () => {
    const selection = selectRemarks([remark(11)], 'const gain = 2.0 * factor;');
    expect(selection.kept).toEqual([]);
    expect(selection.notAPatch).toBe(true);
  });

  it('treats a hunk that only removes lines as a patch with nothing to say', () => {
    const selection = selectRemarks(
      [remark(11)],
      '@@ -10,3 +10,1 @@\n context\n-removed one\n-removed two\n',
    );
    expect(selection.notAPatch).toBe(false);
    expect(selection.kept).toEqual([]);
    expect(selection.notAddedLine).toBe(1);
  });

  it('is silent rather than empty-handed when the patch adds nothing', () => {
    const selection = selectRemarks(
      [remark(11)],
      '@@ -10,2 +10,2 @@\n context\n-removed\n+added\n',
    );
    expect(selection.notAPatch).toBe(false);
    expect(selection.kept.map((finding) => finding.startLine)).toEqual([11]);
  });
});

describe('the pass is a switch, and the switch is off', () => {
  it('makes no call at all when the option is absent', async () => {
    const { provider, complete } = providerReturning(JSON.stringify({ findings: [remark(11)] }));
    const engine = new LLMReviewEngine(provider, { lanes: [...lanes] });
    const results = await engine.reviewDiff(diff(), PATCH);
    expect(results.some((result) => result.source === 'remarks')).toBe(false);
    expect(complete).toHaveBeenCalledTimes(lanes.length);
  });

  it('makes exactly one extra call when it is on, and files what the model said', async () => {
    const { provider, complete, seen } = providerReturning(
      JSON.stringify({ findings: [remark(11, 'Float product widened by the literal')] }),
    );
    const engine = new LLMReviewEngine(provider, { lanes: [...lanes], remarks: true });
    const results = await engine.reviewDiff(diff(), PATCH);
    const remarkResults = results.filter((result) => result.source === 'remarks');
    expect(remarkResults).toHaveLength(1);
    expect(remarkResults[0]?.findings.map((finding) => finding.title)).toEqual([
      'Float product widened by the literal',
    ]);
    expect(complete).toHaveBeenCalledTimes(lanes.length + 1);
    expect(seen.some((call) => call.tag === 'review:remarks')).toBe(true);
  });

  it('files nothing from the pass when the model answers on a context line', async () => {
    const { provider } = providerReturning(JSON.stringify({ findings: [remark(13)] }));
    const engine = new LLMReviewEngine(provider, { lanes: [...lanes], remarks: true });
    const results = await engine.reviewDiff(diff(), PATCH);
    const remarkResults = results.filter((result) => result.source === 'remarks');
    expect(remarkResults[0]?.findings).toEqual([]);
    expect(engine.lastRemarks.notAddedLine).toBe(1);
  });

  it('survives a pass that answers with prose, and keeps the lanes', async () => {
    const { provider } = providerReturning('I could not find anything to say.');
    const engine = new LLMReviewEngine(provider, { lanes: [...lanes], remarks: true });
    const results = await engine.reviewDiff(diff(), PATCH);
    const remarkResults = results.filter((result) => result.source === 'remarks');
    expect(remarkResults[0]?.findings).toEqual([]);
    expect(remarkResults[0]?.success).toBe(true);
    expect(results.filter((result) => result.source === undefined)).toHaveLength(lanes.length);
  });
});

it('fails one pass and not the review when the provider refuses the remark call', async () => {
  const provider: LLMProvider = {
    name: 'RefusingProvider',
    model: 'mock-model',
    complete: vi.fn((_prompt: string, options?: { tag?: string }) =>
      options?.tag === 'review:remarks'
        ? Promise.reject(new Error('402 Payment Required'))
        : Promise.resolve({
            content: JSON.stringify({ findings: [] }),
            model: 'mock-model',
            createdAt: new Date().toISOString(),
            finishReason: 'stop' as const,
          }),
    ),
    completeWithTools: vi.fn(),
    healthCheck: vi.fn(),
  };
  const engine = new LLMReviewEngine(provider, { lanes: [...lanes], remarks: true });
  const results = await engine.reviewDiff(diff(), PATCH);
  const remarkResults = results.filter((result) => result.source === 'remarks');
  expect(remarkResults[0]?.success).toBe(false);
  expect(remarkResults[0]?.error).toContain('402');
  expect(results.filter((result) => result.source === undefined)).toHaveLength(lanes.length);
});

describe('the prompt asks for the families the corpus measured', () => {
  const ctx = (): PromptContext => ({
    diffContent: PATCH,
    filePath: 'src/subject.ts',
    changeType: 'modified',
    promptOrder: 'boilerplate-first',
  });

  it('names every family, so a run can be read against the list it was asked for', () => {
    const prompt = remarkPrompt(ctx());
    for (const family of REMARK_FAMILIES) expect(prompt).toContain(family.asks);
  });

  it('asks for the code it is about before it asks for anything else', () => {
    const prompt = remarkPrompt(ctx());
    expect(prompt.indexOf('senior engineer')).toBeLessThan(prompt.indexOf('src/subject.ts'));
  });

  it('keeps the families out of a prompt that names none of them', () => {
    const prompt = remarkPrompt({ ...ctx(), promptOrder: 'diff-first' });
    expect(prompt.indexOf('const auto&')).toBeGreaterThan(prompt.indexOf('src/subject.ts'));
  });
});
