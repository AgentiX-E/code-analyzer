// @code-analyzer — End-to-end: the comment a reviewer reads quotes the code it is about
//
// **The user story, in one sentence**: *I opened a pull request, the review told me a line is wrong, and the review showed
// me that line instead of telling me where to go and look.*
//
// **This is a regression test for something no unit test could have caught, because the defect was in a string nobody
// asserted.** `convertToReviewComments` filled a comment's `existingCode` with `[Lines 10-12 -> 10-14] modified` - a
// sentence about the diff's ranges. Three readers took it for code: the grounding judge asked whether it appears at the
// lines it names (**it appears in no file**), the positioner's exact match could never fire, and the human was shown a
// sentence where the quotation should be. Every test in the repository passed, because each of them built its own
// `existingCode` and none of them ever looked at what the engine produced.
//
// So this file drives the public entry point with a provider that answers deterministically, and asserts the artefact a
// reviewer actually receives: **the added lines, the range they occupy, and the revision they were read at.** The second
// case is the control, and it is the one that keeps the fix honest - a finding about a line the change did not add must
// carry **no** quotation rather than a fabricated one, because an empty quotation is not checked and a fabricated one is
// convicted.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '@code-analyzer/intelligence';

import type { CompletionResult, LLMProvider } from '@code-analyzer/intelligence';

// ---------------------------------------------------------------------------
// The change under review
// ---------------------------------------------------------------------------

const CHARGE_SECTION = [
  'diff --git a/src/charge.ts b/src/charge.ts',
  'index 1111111..2222222 100644',
  '--- a/src/charge.ts',
  '+++ b/src/charge.ts',
  '@@ -10,3 +10,5 @@ export async function charge(order: Order) {',
  '   const limit = readConfig();',
  '+  const total = order.items.reduce((sum, i) => sum + i.price, 0);',
  '+  await gateway.capture(order.id, total);',
  '   return order;',
  ' }',
].join('\n');

/**
 * The lines the change added, read out of the patch itself rather than retyped.
 *
 * **Derived, because a second copy of the expectation is a second thing that can drift.** The `+` is git's marker and
 * the indentation after it is the source's, and a hand-written constant would have hidden exactly the whitespace the
 * resolver has to preserve.
 */
const ADDED = CHARGE_SECTION.split('\n')
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  .map((line) => line.slice(1));

const COMMIT = 'abc1234def5678';

// ---------------------------------------------------------------------------
// A provider that answers as one lane would
// ---------------------------------------------------------------------------

/**
 * **Two findings, and the difference between them is the experiment.**
 *
 *   - one about lines 11-12, which the change added - it has code to quote;
 *   - one about line 10, which the change only showed as context - it has none, and must not be given any.
 */
const ANSWER = JSON.stringify({
  findings: [
    {
      path: 'src/charge.ts',
      startLine: 11,
      endLine: 12,
      severity: 'high',
      category: 'bug',
      title: 'The captured amount ignores the order currency',
      description:
        'Items may not share a currency, so the summed total can be captured at the wrong scale.',
      suggestion: 'Convert each price before summing.',
    },
    {
      path: 'src/charge.ts',
      startLine: 10,
      endLine: 10,
      severity: 'low',
      category: 'style',
      title: 'The limit reading is not named for what it holds',
      description: 'The local is named for its type rather than its meaning.',
      suggestion: null,
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

describe('E2E — the review a pull request receives quotes the code it is about', () => {
  it('shows the added lines rather than a description of where they are', async () => {
    const engine = new LLMReviewEngine(scriptedProvider(), { lanes: ['maintainability'] });
    const findings = await engine.reviewPullRequest(
      [{ path: 'src/charge.ts', diffText: CHARGE_SECTION }],
      { commit: COMMIT, maxFindingsPerPullRequest: 5 },
    );

    const anchored = findings
      .flatMap((result) => result.findings)
      .find((finding) => finding.startLine === 11);

    expect(anchored).toBeDefined();
    // **The quotation is the change**, so a reader sees the defect without opening the file.
    expect(anchored?.snippet).toBe(ADDED.join('\n'));
    expect(anchored?.snippetSource).toBe('diff');
    // **The anchor is what makes the claim re-openable**: a file, a range and the revision they were read at.
    expect(anchored?.evidence).toEqual({
      file: 'src/charge.ts',
      startLine: 11,
      endLine: 12,
      text: ADDED.join('\n'),
      commit: COMMIT,
      extractor: 'review/evidence.addedTextAt',
    });
  });

  it('carries that quotation into the comment a poster would file', async () => {
    const engine = new LLMReviewEngine(scriptedProvider(), { lanes: ['maintainability'] });
    const findings = await engine.reviewPullRequest(
      [{ path: 'src/charge.ts', diffText: CHARGE_SECTION }],
      {
        commit: COMMIT,
        maxFindingsPerPullRequest: 5,
      },
    );
    const comments = engine.convertToReviewComments(
      {
        filePath: 'src/charge.ts',
        oldHash: '1111111',
        newHash: '2222222',
        ranges: [{ oldStart: 10, oldEnd: 12, newStart: 10, newEnd: 14, changeType: 'modified' }],
        changeType: 'modified',
      },
      findings,
    );

    const filed = comments.find((comment) => comment.startLine === 11);
    expect(filed?.existingCode).toBe(ADDED.join('\n'));
    // The placeholder this field used to hold, asserted absent by name - **the defect was a string, so the guard is a
    // string**.
    expect(filed?.existingCode ?? '').not.toContain('[Lines');
  });

  it('leaves a finding about a context line unquoted rather than inventing a quotation', async () => {
    const engine = new LLMReviewEngine(scriptedProvider(), { lanes: ['maintainability'] });
    const findings = await engine.reviewPullRequest(
      [{ path: 'src/charge.ts', diffText: CHARGE_SECTION }],
      {
        commit: COMMIT,
        maxFindingsPerPullRequest: 5,
      },
    );
    const contextOnly = findings
      .flatMap((result) => result.findings)
      .find((finding) => finding.startLine === 10);

    expect(contextOnly).toBeDefined();
    // **The change did not add line 10**, so quoting it would let the comment claim to be about the change while pointing
    // at code that was already there.
    expect(contextOnly?.snippet).toBeUndefined();
    expect(contextOnly?.evidence).toBeUndefined();
  });

  it('records an unnamed revision as unspecified rather than guessing one from the diff', async () => {
    // **A guessed revision is worse than an absent one**: it would make an audit look complete.
    const engine = new LLMReviewEngine(scriptedProvider(), { lanes: ['maintainability'] });
    const findings = await engine.reviewPullRequest(
      [{ path: 'src/charge.ts', diffText: CHARGE_SECTION }],
      {
        maxFindingsPerPullRequest: 5,
      },
    );
    const anchored = findings
      .flatMap((result) => result.findings)
      .find((finding) => finding.startLine === 11);
    expect(anchored?.evidence?.commit).toBe('unspecified');
  });
});
