// @code-analyzer — End-to-end: a developer opens a pull request and reads the review in an order they can act on
//
// **The user story, in one sentence**: *I changed four lines in two files, I asked for a review, and the first thing I
// read is something I can do something about.* Everything below is that story, driven through the public API of the
// review engine with a provider that answers deterministically, so **the test asserts the order a reader meets the
// comments in rather than the order the model happened to answer in.**
//
// **Why this is not a unit test of the ranker.** The ranker has its own unit suite over hand-built diffs. What can only
// break here is the join: **the patch the engine was given, the file paths the lanes report, the conversion to
// `ReviewComment`, and the ordering that has to survive all three.** A ranking that is correct in isolation and applied
// to the wrong path grounds every finding against the wrong file and produces a confident, well-ordered, useless review.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '@code-analyzer/intelligence';

import type { LLMProvider, CompletionResult } from '@code-analyzer/intelligence';
import type { GitDiff } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// The change under review: two files, four added lines
// ---------------------------------------------------------------------------

/**
 * A patch a developer would actually open a pull request with.
 *
 * `src/limit.ts` gains a comparison against a limit read from configuration, and `src/report.ts` gains a call that
 * passes the value on. **Line numbers are absolute in the new file**, which is what the findings below name and what
 * the ranker has to agree with.
 */
const PATCH = [
  'diff --git a/src/limit.ts b/src/limit.ts',
  'index 1111111..2222222 100644',
  '--- a/src/limit.ts',
  '+++ b/src/limit.ts',
  '@@ -10,3 +10,5 @@ export function withinLimit(total: number) {',
  '   const limit = readConfig();',
  '+  if (total > limit) {',
  '+    return false;',
  '+  }',
  '   return true;',
  ' }',
  'diff --git a/src/report.ts b/src/report.ts',
  'index 3333333..4444444 100644',
  '--- a/src/report.ts',
  '+++ b/src/report.ts',
  '@@ -1,2 +1,3 @@',
  ' import { withinLimit } from "./limit";',
  '+export const enabled = true;',
  ' export function report(total: number) {',
].join('\n');

/** The diff object the engine is handed: paths and ranges, no lines - the patch is passed separately, as a caller does. */
const DIFF: GitDiff = {
  filePath: 'src/limit.ts',
  oldHash: '1111111',
  newHash: '2222222',
  ranges: [{ oldStart: 10, oldEnd: 12, newStart: 10, newEnd: 14, changeType: 'modified' }],
  changeType: 'modified',
};

// ---------------------------------------------------------------------------
// A provider that answers as five lanes would, deterministically
// ---------------------------------------------------------------------------

/**
 * **Three findings, one per kind of thing a review says**, and the one a developer can act on is neither the first the
 * provider returns nor the most severe.
 *
 *   - a **style remark** about a line the change did not touch, with no suggestion: nothing to do;
 *   - a **security musing** about a line the change did not touch, hedged, with no suggestion: also nothing to do;
 *   - the **defect**: it points at an added line, names the identifier the change introduced, and says what to change.
 */
const ANSWER = JSON.stringify({
  findings: [
    {
      startLine: 10,
      endLine: 10,
      severity: 'low',
      category: 'style',
      title: 'The naming here could be more consistent with the rest of the module',
      description: 'This might read better if the local were named for what it holds.',
      suggestion: null,
    },
    {
      startLine: 14,
      endLine: 14,
      severity: 'medium',
      category: 'architecture',
      title: 'The guard could be extracted for reuse',
      description: 'This could perhaps live beside the other predicates in the module.',
      suggestion: null,
    },
    {
      startLine: 11,
      endLine: 12,
      severity: 'medium',
      category: 'bug',
      title: 'The comparison does not check that limit is a number',
      description:
        'readConfig can return undefined, and `if (total > limit)` is then always false.',
      suggestion: 'Guard the comparison: `if (typeof limit === "number" && total > limit)`.',
    },
  ],
});

function scriptedProvider(): LLMProvider {
  const answer = (): Promise<CompletionResult> =>
    Promise.resolve({
      content: ANSWER,
      model: 'scripted',
      createdAt: new Date(0).toISOString(),
      finishReason: 'stop',
    });
  return {
    name: 'Scripted',
    model: 'scripted',
    complete: answer,
    completeWithTools: answer,
    healthCheck: () => Promise.resolve(true),
  };
}

// ---------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------

describe('E2E — the review a developer reads after opening a pull request', () => {
  it('leads with the finding they can act on, and still shows the other two', async () => {
    const engine = new LLMReviewEngine(scriptedProvider(), { lanes: ['maintainability'] });

    const comments = await engine.reviewDiffRanked(DIFF, PATCH);

    // **Every comment survives the ordering.** A reviewer that reordered by dropping what it did not like would score
    // better on every precision metric in this repository and be worse at the only job it has.
    expect(comments).toHaveLength(3);

    expect(comments[0]?.content).toBe('The comparison does not check that limit is a number');
    expect(comments[0]?.suggestionCode).toContain('typeof limit');

    // The two the reader can skip are still there, and the hedged one is not promoted over the concrete one.
    expect(comments[1]?.content).toBe('The guard could be extracted for reuse');
    expect(comments[2]?.content).toBe(
      'The naming here could be more consistent with the rest of the module',
    );
  });

  it('points every comment at the file the review was asked about', async () => {
    const engine = new LLMReviewEngine(scriptedProvider(), { lanes: ['maintainability'] });

    const comments = await engine.reviewDiffRanked(DIFF, PATCH);

    // **The join that this test exists for**: a `ReviewComment` with the right words and the wrong path is a comment a
    // developer cannot apply, and the path comes from the diff rather than from the finding.
    expect(comments.every((comment) => comment.path === 'src/limit.ts')).toBe(true);
    expect(comments.every((comment) => comment.filtered === false)).toBe(true);
  });

  it('produces the same review twice, so two runs can be compared', async () => {
    const first = await new LLMReviewEngine(scriptedProvider(), {
      lanes: ['maintainability'],
    }).reviewDiffRanked(DIFF, PATCH);
    const second = await new LLMReviewEngine(scriptedProvider(), {
      lanes: ['maintainability'],
    }).reviewDiffRanked(DIFF, PATCH);

    expect(second.map((comment) => comment.content)).toEqual(
      first.map((comment) => comment.content),
    );
  });

  it('keeps the provider order when the caller has no patch to ground against', async () => {
    // **The other half of the contract, and the reason the patch is a parameter rather than an inference.** A caller
    // that cannot supply the lines gets the review it always got, rather than one ordered by a rule applied to a diff
    // nobody passed.
    const comments = await new LLMReviewEngine(scriptedProvider(), {
      lanes: ['maintainability'],
    }).reviewDiffAsComments(DIFF);

    expect(comments.map((comment) => comment.content)).toEqual([
      'The naming here could be more consistent with the rest of the module',
      'The guard could be extracted for reuse',
      'The comparison does not check that limit is a number',
    ]);
  });
});
