// @code-analyzer — End-to-end: the review of a pull request knows what the change is inside
//
// **The user story, in one sentence**: *I added a guard to a function that already had one, and the review told me the
// guard was a duplicate - it did not tell me to add a guard I had just added.* Everything below is that story, driven
// through `reviewPullRequest` with a provider that answers from what it was shown rather than at random, because **the
// thing under test is the join**: the diff, the file the caller could read, the window built from it, the prompt, and
// the finding that comes back.
//
// **Why this cannot be a unit test of the window.** The window has its own suite over hand-built files, and it passes
// whether or not anyone wires it to a review. What breaks here is the wiring: a section whose `fileText` is never read,
// a window built and then not rendered for the pull-request scope, a switch that is on in the harness and off in the
// engine. **Each of those produces a review that looks exactly like the one before the feature existed**, which is the
// failure mode a green unit suite cannot see.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '@code-analyzer/intelligence';

import type { LLMProvider, CompletionResult } from '@code-analyzer/intelligence';

// ---------------------------------------------------------------------------
// The pull request: a guard added to a function that already guards
// ---------------------------------------------------------------------------

/** The file at the head of the pull request. The hunk below is four lines of it. */
const FILE = [
  'export function withinLimit(total) {', // 1
  '  const limit = readConfig();', // 2
  '  if (limit === undefined) return false;', // 3
  '  if (total > limit) {', // 4
  '    return false;', // 5
  '  }', // 6
  '  return true;', // 7
  '}', // 8
].join('\n');

/** The change: a second undefined check, three lines under the first one. */
const DIFF_TEXT = [
  'diff --git a/src/limit.js b/src/limit.js',
  '--- a/src/limit.js',
  '+++ b/src/limit.js',
  '@@ -3,3 +3,6 @@',
  '   if (limit === undefined) return false;',
  '+  if (limit === null) {',
  '+    return false;',
  '+  }',
  '   if (total > limit) {',
].join('\n');

// ---------------------------------------------------------------------------
// A provider that answers from what it was shown
// ---------------------------------------------------------------------------

/**
 * **Two answers, and the prompt decides which one is given.**
 *
 * With the window, the lane can see line 3 and says the new guard duplicates it. Without it, all the lane can see is an
 * addition and it offers the only remark five added lines support. **A provider that answered the same thing in both
 * cases would make this test a test of the script rather than of the wiring**, which is the trap the earlier
 * end-to-end files in this suite call out by name.
 */
function providerThatReads(): LLMProvider {
  const answer = (prompt: string): Promise<CompletionResult> =>
    Promise.resolve({
      content: prompt.includes('### src/limit.js — lines 1-8 of 8')
        ? JSON.stringify({
            findings: [
              {
                path: 'src/limit.js',
                startLine: 4,
                endLine: 6,
                severity: 'low',
                category: 'maintainability',
                title: 'The new null check duplicates the undefined check three lines above',
                description:
                  'Line 3 already returns false for a missing limit, and `limit === null` reaches the same branch three lines later. Fold the two into one guard.',
                suggestion: 'if (limit === undefined || limit === null) return false;',
              },
            ],
          })
        : JSON.stringify({
            findings: [
              {
                path: 'src/limit.js',
                startLine: 4,
                endLine: 6,
                severity: 'medium',
                category: 'bug',
                title: 'The null check does not cover an empty string',
                description:
                  'A configuration file could return an empty string, which passes this guard.',
                suggestion: 'Check for an empty string as well.',
              },
            ],
          }),
      model: 'scripted',
      createdAt: new Date(0).toISOString(),
      finishReason: 'stop',
    });
  return {
    name: 'Scripted',
    model: 'scripted',
    complete: answer,
    completeWithTools: (_prompt, _tools, _options) => answer(_prompt),
    healthCheck: () => Promise.resolve(true),
  };
}

const SECTIONS = [{ path: 'src/limit.js', diffText: DIFF_TEXT }];

// ---------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------

describe('E2E — a review of a pull request that knows the code around the change', () => {
  it('tells the developer the guard is a duplicate, because it read the guard above it', async () => {
    const engine = new LLMReviewEngine(providerThatReads(), { lanes: ['maintainability'] });

    const lanes = await engine.reviewPullRequest([{ ...SECTIONS[0]!, fileText: FILE }], {
      maxFindingsPerPullRequest: 4,
      codeContext: true,
    });

    const findings = lanes.filter((lane) => lane.success).flatMap((lane) => lane.findings);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toContain('duplicates the undefined check');
    // **And it lands on added lines**, which is what makes it postable: a finding about code the pull request did not
    // touch is a finding a reviewer cannot leave on the diff.
    expect(findings[0]?.startLine).toBe(4);
  });

  it('gives the weaker remark when the same engine is not shown the file, so the difference is the window', async () => {
    const engine = new LLMReviewEngine(providerThatReads(), { lanes: ['maintainability'] });

    const lanes = await engine.reviewPullRequest(SECTIONS, {
      maxFindingsPerPullRequest: 4,
      codeContext: true,
    });

    const findings = lanes.filter((lane) => lane.success).flatMap((lane) => lane.findings);
    expect(findings[0]?.title).toContain('does not cover an empty string');
  });

  it('is the old review when the switch is off, even though the file was handed over', async () => {
    const engine = new LLMReviewEngine(providerThatReads(), { lanes: ['maintainability'] });

    const lanes = await engine.reviewPullRequest([{ ...SECTIONS[0]!, fileText: FILE }], {
      maxFindingsPerPullRequest: 4,
      codeContext: false,
    });

    const findings = lanes.filter((lane) => lane.success).flatMap((lane) => lane.findings);
    // **The file being available is not the same as the file being shown.** A switch that a caller can forget to set
    // and still get the new behaviour is not a switch, and an ablation over it would measure nothing.
    expect(findings[0]?.title).toContain('does not cover an empty string');
  });

  it('counts the call it made, so the window is a figure and not a gesture', async () => {
    const engine = new LLMReviewEngine(providerThatReads(), { lanes: ['maintainability'] });

    await engine.reviewPullRequest([{ ...SECTIONS[0]!, fileText: FILE }], {
      maxFindingsPerPullRequest: 4,
      codeContext: true,
    });

    // **The window is a cost, and the engine says how many calls paid it.** §20's claim is a quality claim at a stated
    // price: a review that reported the quality and not the calls would be a device measured with half its invoice.
    expect(engine.costSummary().calls).toBe(1);
  });
});
