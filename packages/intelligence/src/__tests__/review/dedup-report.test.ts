// @code-analyzer/intelligence — which rule merged a finding, and why a total cannot say
//
// **The run of 2026-11-14 reported `dedup: {before: 1784, after: 598, dropped: 1186}`** - two thirds of everything the
// lanes said, removed before anything was scored. That number is compatible with two opposite readings and the artifact
// could not choose between them: **a merge that removed restatements** (which is the function's purpose and costs
// nothing) and **a merge that removed a second defect because its range happened to overlap the first's** (which is a
// recall defect, is free to fix, and is invisible in the total).
//
// The engine merges for one of three reasons and only one of them carries textual evidence. **Overlapping ranges merge
// unconditionally** - "the same defect has one location" - and a lane that marks a twelve-line block for one problem has
// just made every other finding inside that block a duplicate of it. The other two rules at least look at the words.
//
// So the report is split by rule, and these tests hold the split: each of the three rules must be reachable, must be
// counted once per absorbed finding, and a review with nothing to merge must report zeros rather than an empty object.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';

import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../review/llm/provider.js';
import type { GitDiff } from '@code-analyzer/shared';

/** A provider whose security lane returns a fixed list and whose every other lane returns nothing. */
class OneLaneProvider implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';

  constructor(private readonly findings: ReadonlyArray<Record<string, unknown>>) {}

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    if (prompt.includes('expert security reviewer')) {
      return this.result(JSON.stringify({ findings: this.findings }));
    }
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
    filePath: 'src/DimensionValidators.cpp',
    oldPath: null,
    status: 'modified',
    language: 'cpp',
    hunks: [],
    ranges: [{ startLine: 8, endLine: 14, startColumn: 0, endColumn: 0 }],
    addedLines: [11, 12, 13],
    removedLines: [],
    oldHash: '0000000',
    newHash: '1111111',
  } as unknown as GitDiff;
}

/** One finding, with the two fields this file varies and the four the parser requires. */
function finding(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    severity: 'medium',
    category: 'bug',
    suggestion: null,
    ...overrides,
  };
}

async function mergeOf(findings: ReadonlyArray<Record<string, unknown>>) {
  const engine = new LLMReviewEngine(new OneLaneProvider(findings), { lanes: ['security'] });
  const results = await engine.reviewDiff(diff());
  return { results, report: engine.lastDeduplication };
}

describe('the deduplication report', () => {
  it('counts a merge made on the range alone, which is the one with no evidence behind it', async () => {
    // **Two unrelated defects inside one range.** The lane marks lines 11 to 13 for a missing null check and files a
    // separate finding at line 12 about a boundary condition. The ranges overlap, so the second is absorbed - and this
    // is the merge the report has to be able to name, because it is the only one that never looked at a word.
    const { results, report } = await mergeOf([
      finding({
        startLine: 11,
        endLine: 13,
        severity: 'high',
        title: 'null check missing on the shape handle',
        description: 'the handle is dereferenced before it is tested',
      }),
      finding({
        startLine: 12,
        endLine: 12,
        title: 'epsilon comparison ignores the y component',
        description: 'a vertical edge is reported as horizontal',
      }),
    ]);

    expect(report?.mergedBy).toEqual({ rangeAndWords: 0, rangeOnly: 1, wordsNearby: 0 });
    expect(report?.dropped).toBe(1);
    expect(results.flatMap((result) => result.findings)).toHaveLength(1);
  });

  it('separates an overlap whose sentences also agree, because that merge is earned', async () => {
    // Two lanes wording the same defect over the same block: the range overlaps **and** the vocabulary agrees. The
    // count is the same as above and the evidence is not, which is exactly why one total was useless.
    const { report } = await mergeOf([
      finding({
        startLine: 11,
        endLine: 13,
        severity: 'high',
        title: 'null check missing on the shape handle',
        description: 'the shape handle is dereferenced before it is tested for null',
      }),
      finding({
        startLine: 12,
        endLine: 12,
        title: 'shape handle dereferenced before the null test',
        description: 'the shape handle is used before anything checks it for null',
      }),
    ]);

    expect(report?.mergedBy).toEqual({ rangeAndWords: 1, rangeOnly: 0, wordsNearby: 0 });
    expect(report?.dropped).toBe(1);
  });

  it('counts the merge that looks at words within a few lines', async () => {
    // Disjoint ranges, four lines apart, and almost the same sentence: this is the rule the previous iteration added
    // after a vocabulary-only merge left a whole pull request with 6.6 comments.
    const { report } = await mergeOf([
      finding({
        startLine: 11,
        endLine: 11,
        severity: 'high',
        title: 'null check missing on the shape handle',
        description: 'the shape handle is dereferenced before it is tested for null',
      }),
      finding({
        startLine: 15,
        endLine: 15,
        title: 'shape handle used before the null check',
        description: 'the shape handle is dereferenced before anything tests it for null',
      }),
    ]);

    expect(report?.mergedBy).toEqual({ rangeAndWords: 0, rangeOnly: 0, wordsNearby: 1 });
    expect(report?.dropped).toBe(1);
  });

  it('reports zeros rather than an absent object when there was nothing to merge', async () => {
    // **A run with no merges and a run whose report was never written are different facts**, and only one of them means
    // the deduplication is working. This is the same rule the artifact applies to every counter in it.
    const { results, report } = await mergeOf([
      finding({
        startLine: 11,
        endLine: 11,
        severity: 'high',
        title: 'null check missing on the shape handle',
        description: 'the handle is dereferenced before it is tested',
      }),
      finding({
        startLine: 13,
        endLine: 13,
        severity: 'medium',
        category: 'performance',
        title: 'the geometry is recomputed for every view',
        description: 'the cost is quadratic in the number of views',
      }),
    ]);

    expect(results.flatMap((result) => result.findings)).toHaveLength(2);
    expect(report).toMatchObject({
      before: 2,
      after: 2,
      dropped: 0,
      mergedBy: { rangeAndWords: 0, rangeOnly: 0, wordsNearby: 0 },
    });
  });

  it('adds up: every absorbed finding is counted under exactly one rule', async () => {
    // **The property that makes the split worth having.** Three merges of three different kinds and one survivor: the
    // three counts must sum to `dropped`, or the report is a table that reads plausibly and adds up wrong.
    const { report } = await mergeOf([
      finding({
        startLine: 11,
        endLine: 13,
        severity: 'high',
        title: 'null check missing on the shape handle',
        description: 'the shape handle is dereferenced before it is tested for null',
      }),
      finding({
        startLine: 12,
        endLine: 12,
        title: 'epsilon comparison ignores the y component',
        description: 'a vertical edge is reported as horizontal',
      }),
      finding({
        startLine: 11,
        endLine: 13,
        title: 'shape handle is dereferenced before the null test',
        description: 'the shape handle is used before it is tested for null',
      }),
      finding({
        startLine: 16,
        endLine: 16,
        title: 'null check missing on the shape handle',
        description: 'the shape handle is dereferenced before the null test',
      }),
    ]);

    const counts = report?.mergedBy;
    expect(counts).toBeDefined();
    const total =
      (counts?.rangeAndWords ?? 0) + (counts?.rangeOnly ?? 0) + (counts?.wordsNearby ?? 0);
    expect(total).toBe(report?.dropped);
    // **And every one of the three is reachable in a single review**, which is the assertion that would fail if a rule
    // stopped firing and the totals still added up.
    expect(counts?.rangeOnly).toBeGreaterThan(0);
    expect(counts?.rangeAndWords).toBeGreaterThan(0);
    expect(counts?.wordsNearby).toBeGreaterThan(0);
  });
});
