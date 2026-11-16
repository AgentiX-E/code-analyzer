// @code-analyzer/intelligence — a second concern at a site, and why a range is not a defect
//
// **The run of 2026-11-16 removed 2 273 of its 2 295 merged findings under the range rule alone** - overlapping ranges
// with no textual agreement behind the merge - and of its 455 goldens that were rejected *after* we had commented on
// their own line, 276 sat on a line we commented on. The corpus names the case: `electron#47361` carries a
// use-after-free and an O(n²) erase on one line, and **a reviewer that says one true thing per site loses the second
// every time**, because the range rule says two findings in one range are one finding.
//
// **"The same defect has one location" is a claim about defects, and it was being applied to categories.** A null check
// missing on a handle and an epsilon comparison that ignores a component are not the same defect because they were
// marked on the same three lines - and the rule that merged them never read a word of either.
//
// So the switch keeps a finding whose **category differs from the survivor's**, and only that: two findings of one
// category in one range are still one finding, because a lane that marks a twelve-line block for one problem has made
// every other finding of its own kind inside that block a duplicate of it, and **keeping those would file the same
// remark twice.** The limit is one extra per site, which is what the corpus has.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';

import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../review/llm/provider.js';
import type { GitDiff } from '@code-analyzer/shared';

/** A provider that answers one fixed list per lane, keyed by the lane's own role sentence. */
class LaneScript implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';

  constructor(private readonly byLane: Record<string, ReadonlyArray<Record<string, unknown>>>) {}

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    for (const [role, findings] of Object.entries(this.byLane)) {
      if (prompt.includes(role)) {
        return this.result(JSON.stringify({ findings }));
      }
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
    filePath: 'shell/browser/api/electron_api_web_contents.cc',
    oldPath: null,
    status: 'modified',
    language: 'cpp',
    hunks: [],
    ranges: [{ startLine: 3020, endLine: 3036, startColumn: 0, endColumn: 0 }],
    addedLines: [3022, 3023, 3024],
    removedLines: [],
    oldHash: '0000000',
    newHash: '1111111',
  } as unknown as GitDiff;
}

/** One finding, with the fields these tests vary and the four the parser requires. */
function finding(overrides: Record<string, unknown>): Record<string, unknown> {
  return { severity: 'medium', category: 'bug', suggestion: null, ...overrides };
}

/**
 * **Two lanes, one site, two categories, and no shared vocabulary** - which is the shape the run reported 2 273 times.
 * The security lane's finding is the survivor because it is filed at `high`.
 */
async function twoConcerns(secondConcern: boolean) {
  const engine = new LLMReviewEngine(
    new LaneScript({
      'expert security reviewer': [
        finding({
          startLine: 3022,
          endLine: 3030,
          severity: 'high',
          category: 'bug',
          title: 'dangling pointer after the upload completes',
          description: 'the callback retains the raw pointer and the owner frees it on completion',
        }),
      ],
      'expert performance engineer': [
        finding({
          startLine: 3024,
          endLine: 3026,
          severity: 'medium',
          category: 'performance',
          title: 'erase in a loop is quadratic',
          description: 'each erasure shifts the remainder, so the block costs n squared moves',
        }),
      ],
    }),
    { lanes: ['security', 'performance'] as const, secondConcern },
  );
  const results = await engine.reviewDiff(diff());
  return {
    findings: results.flatMap((result) => result.findings),
    report: engine.lastDeduplication,
  };
}

describe('a second concern at a site is not a duplicate of the first', () => {
  it('merges the two when the switch is off, which is what every published figure was measured under', async () => {
    const { findings, report } = await twoConcerns(false);
    expect(findings).toHaveLength(1);
    expect(report?.mergedBy).toEqual({ rangeAndWords: 0, rangeOnly: 1, wordsNearby: 0 });
    expect(report?.keptAsSecondConcern).toBe(0);
  });

  it('keeps both when the categories differ and the switch is on', async () => {
    const { findings, report } = await twoConcerns(true);
    expect(findings).toHaveLength(2);
    expect(findings.map((entry) => entry.category).sort()).toEqual(['bug', 'performance']);
    // **And the merge that did not happen is not counted as a merge**, because a report whose totals do not add up to
    // what happened cannot be read against the run that produced it.
    expect(report?.mergedBy).toEqual({ rangeAndWords: 0, rangeOnly: 0, wordsNearby: 0 });
    expect(report?.dropped).toBe(0);
    expect(report?.keptAsSecondConcern).toBe(1);
  });

  it('keeps one extra at a site and no more, because a category prefix is not an unbounded licence', async () => {
    const engine = new LLMReviewEngine(
      new LaneScript({
        'expert security reviewer': [
          finding({
            startLine: 3022,
            endLine: 3030,
            severity: 'high',
            category: 'bug',
            title: 'a',
          }),
        ],
        'expert performance engineer': [
          finding({
            startLine: 3024,
            endLine: 3026,
            severity: 'medium',
            category: 'performance',
            title: 'erase in a loop is quadratic',
            description: 'each erasure shifts the remainder of the block',
          }),
        ],
        'expert code quality reviewer': [
          finding({
            startLine: 3025,
            endLine: 3027,
            severity: 'low',
            category: 'maintainability',
            title: 'the named constant hides the stride',
            description: 'the constant is named for an offset and used as a length',
          }),
        ],
      }),
      { lanes: ['security', 'performance', 'maintainability'] as const, secondConcern: true },
    );
    const results = await engine.reviewDiff(diff());
    const kept = results.flatMap((result) => result.findings);
    expect(kept).toHaveLength(2);
    expect(engine.lastDeduplication?.keptAsSecondConcern).toBe(1);
    expect(engine.lastDeduplication?.dropped).toBe(1);
  });

  it('still merges two findings of one category in one range, because those are one remark', async () => {
    const engine = new LLMReviewEngine(
      new LaneScript({
        'expert security reviewer': [
          finding({ startLine: 3022, endLine: 3030, severity: 'high', title: 'a' }),
        ],
        'expert software architect reviewer': [
          finding({
            startLine: 3024,
            endLine: 3026,
            category: 'bug',
            title: 'the callback frees the pointer it does not own',
            description: 'ownership stays with the caller, so the delete is a double free',
          }),
        ],
      }),
      { lanes: ['security', 'architecture'] as const, secondConcern: true },
    );
    const results = await engine.reviewDiff(diff());
    expect(results.flatMap((result) => result.findings)).toHaveLength(1);
    expect(engine.lastDeduplication?.keptAsSecondConcern).toBe(0);
  });
});
