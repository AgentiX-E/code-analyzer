// @code-analyzer — End-to-end: a review that checks the other side of what the patch says
//
// **The user story, in one sentence**: *I changed the key a handler reads and forgot the route publishes it under a
// different name; the review told me the two disagree and quoted both, and it was the only reviewer that did.* The
// defect is invisible to a category question - the added line is a perfectly ordinary `req.params` read - and it is what
// twenty of the thirty-two goldens only the competitor's arm names have in common (`EVAL-CONTRACT.md` §164).
//
// **Why this is an end-to-end test rather than a unit test of the prompt.** The prompt has its own suite and passes
// whether or not a run can reach it. What this file drives is the chain a user's request goes through: the engine is
// handed a lane set, the set becomes six calls, the answer is parsed, and the finding is filed under the lane that
// wrote it - **and the default reviewer still asks the five questions every published figure was measured under**,
// which is the half a dispatch can break without anybody noticing.
//
// **What it does not do.** It does not judge anything: the corpus, the judge and the F1 live in the bench, and this file
// asserts the wiring rather than the accuracy.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '../../packages/intelligence/src/review/llm/llm-review-engine.js';
import { LANE_SETS } from '../../packages/intelligence/src/review/llm/prompts.js';

import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../packages/intelligence/src/review/llm/provider.js';
import type { GitDiff } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// The change: a handler that reads a key its route does not publish
// ---------------------------------------------------------------------------

const PATCH = [
  'diff --git a/src/groups/members.ts b/src/groups/members.ts',
  '--- a/src/groups/members.ts',
  '+++ b/src/groups/members.ts',
  '@@ -6,4 +6,6 @@',
  ' // route: router.get("/groups/:id/members", listMembers)',
  ' export async function listMembers(req, res) {',
  '+  const groupId = req.params.group_id;',
  '+  const members = await store.membersOf(groupId);',
  '   return res.json({ members: members.length });',
  ' }',
].join('\n');

function oneDiff(): GitDiff {
  return {
    filePath: 'src/groups/members.ts',
    oldHash: 'old',
    newHash: 'new',
    ranges: [{ oldStart: 6, oldEnd: 8, newStart: 6, newEnd: 10, changeType: 'modified' }],
    changeType: 'modified',
  };
}

/**
 * **A reviewer that answers the question it was asked, and nothing to the ones it was not.**
 *
 * Each lane's prompt opens differently, so the answer is chosen by the lane whose sentence the prompt carries. Only the
 * cross-check lane reports the key mismatch; every other lane says it has nothing to add, which is what a real reviewer
 * would say about a two-line change with one defect in it.
 */
class ScriptedReviewer implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';
  readonly prompts: string[] = [];

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    this.prompts.push(prompt);
    const crosscheck = prompt.includes('the way a reviewer reads a pull request');
    const findings = crosscheck
      ? [
          {
            startLine: 7,
            endLine: 7,
            severity: 'high',
            category: 'bug',
            title: 'Handler reads params.group_id but the route publishes params.id',
            description:
              'The route is declared as /groups/:id/members, so the router publishes the value as req.params.id. This line reads req.params.group_id, which is undefined, and store.membersOf is then called with undefined; every request answers 200 with an empty list instead of the group.',
            suggestion: 'const groupId = req.params.id;',
          },
        ]
      : [];
    return {
      content: JSON.stringify({ findings }),
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

describe('a review that checks what the other side says', () => {
  it('is asked when the run buys the set, and files its finding under its own lane', async () => {
    const provider = new ScriptedReviewer();
    const results = await new LLMReviewEngine(provider, {
      lanes: [...LANE_SETS.reviewer],
    }).reviewDiff(oneDiff(), PATCH);

    // **Six calls, one per lane the set names**, which is the price the swap was designed to keep flat.
    expect(provider.prompts).toHaveLength(LANE_SETS.reviewer.length);
    expect(results.map((result) => result.lane)).toEqual([...LANE_SETS.reviewer]);

    const crosscheck = results.find((result) => result.lane === 'crosscheck');
    expect(crosscheck?.success).toBe(true);
    expect(crosscheck?.findings.map((finding) => finding.title)).toEqual([
      'Handler reads params.group_id but the route publishes params.id',
    ]);
    // **The lane survives the trip**, because the artifact's per-lane table, the agreement feature and the density
    // instrument all key on it: a finding filed under another lane would be priced as that lane and the swap would read
    // as a loss of a lane rather than as a question. **`result.lane` is where the engine carries it** - the finding
    // itself is what the model wrote, and this engine does not silently relabel it.
    expect(results.filter((result) => result.findings.length > 0)).toHaveLength(1);
    // **And the lane the cut deletes was not asked**, which is the other half of the swap: `testing`'s findings are
    // `category: test`, `drop test` is the first step of the cut, and none of them ever reached a judge.
    expect(provider.prompts.some((prompt) => prompt.includes('expert test engineer'))).toBe(false);
    expect(results.some((result) => result.findings.some((f) => f.category === 'test'))).toBe(
      false,
    );
  });

  it('is not asked by the reviewer every published figure was measured under', async () => {
    // **The default is the control arm**, and the two ways a dispatch breaks it are invisible in a report: a set that
    // became the default re-prices every table in `EVAL-CONTRACT.md`, and a lane added to `shipped` by accident is a
    // sixth call nobody registered. Both are asserted on the prompts the engine actually sent.
    const provider = new ScriptedReviewer();
    await new LLMReviewEngine(provider).reviewDiff(oneDiff(), PATCH);
    expect(provider.prompts).toHaveLength(LANE_SETS.shipped.length);
    expect(
      provider.prompts.some((prompt) => prompt.includes('the way a reviewer reads a pull request')),
    ).toBe(false);
  });
});
