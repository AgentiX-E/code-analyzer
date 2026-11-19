// @code-analyzer — End-to-end: the review is told what the change reaches, and says something it could not say before
//
// **The user story in one sentence**: *I added a parameter to an exported function, and the review named the caller in
// another file that still passes one argument.* The engine reviewing one file cannot see that caller - it is not in the
// diff - so the sentence only exists if the repository index reaches the prompt.
//
// **Why this cannot be a unit test of `reachNoteOf`.** The note and its rendering have their own suite and it passes
// whether or not any engine reads them: **§95's four nulls are exactly what an unwired index looks like from the
// artifact's side**, and the failure mode is a review identical to the one before the feature existed. What is under
// test here is the join: an index, a provider, a prompt, and the answer a lane gives only because it was shown one.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine, buildRepoIndex, reachNoteOf } from '@code-analyzer/intelligence';

import type { LLMProvider, CompletionResult, RepoFile } from '@code-analyzer/intelligence';

// ---------------------------------------------------------------------------
// The pull request: an exported guard gains a parameter
// ---------------------------------------------------------------------------

/** The file at the head of the pull request, after the change. */
const LIMIT_FILE = [
  'export function withinLimit(total: number, strict: boolean): boolean {', // 1
  '  if (strict) return total < 5;', // 2
  '  return total < 10;', // 3
  '}', // 4
].join('\n');

/** **The caller, which the diff does not contain** - it is in another file, unchanged, and now wrong. */
const CALLER_FILE = [
  'import { withinLimit } from "./limit.js";', // 1
  '', // 2
  'export function check(total: number): boolean {', // 3
  '  return withinLimit(total);', // 4 - passes one argument to a two-argument function
  '}', // 5
].join('\n');

const DIFF_TEXT = [
  'diff --git a/src/limit.ts b/src/limit.ts',
  '--- a/src/limit.ts',
  '+++ b/src/limit.ts',
  '@@ -1,3 +1,4 @@',
  ' export function withinLimit(total: number, strict: boolean): boolean {',
  '+  if (strict) return total < 5;',
  '   return total < 10;',
].join('\n');

const REPO: RepoFile[] = [
  { path: 'src/limit.ts', text: LIMIT_FILE },
  { path: 'src/caller.ts', text: CALLER_FILE },
];

const SECTIONS = [{ path: 'src/limit.ts', diffText: DIFF_TEXT }];

// ---------------------------------------------------------------------------
// A provider that answers from what it was shown
// ---------------------------------------------------------------------------

/**
 * **The answer depends on one line of the prompt**, and that line is the fact the index contributes.
 *
 * A provider that could not see the reach block could not produce the caller sentence, so the two arms differ by the
 * device and not by the script - the trap every end-to-end file in this suite names.
 */
function providerThatReads(): LLMProvider {
  const answer = (prompt: string): Promise<CompletionResult> =>
    Promise.resolve({
      content: prompt.includes('withinLimit ← src/caller.ts:4')
        ? JSON.stringify({
            findings: [
              {
                path: 'src/limit.ts',
                startLine: 1,
                endLine: 1,
                severity: 'high',
                category: 'bug',
                title:
                  'The new `strict` parameter broke the only caller, which still passes one argument',
                description:
                  '`src/caller.ts:4` calls `withinLimit(total)`. The signature now takes `strict`, so that call passes `undefined` and takes the non-strict branch whatever the caller meant.',
                suggestion: 'Update the call in `src/caller.ts:4` to pass `strict`.',
              },
            ],
          })
        : JSON.stringify({
            findings: [
              {
                path: 'src/limit.ts',
                startLine: 2,
                endLine: 2,
                severity: 'low',
                category: 'maintainability',
                title: 'The strict branch duplicates the threshold',
                description: 'Two thresholds for one rule are two places to change.',
                suggestion: null,
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

// ---------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------

describe('E2E — a review told what the change reaches', () => {
  it('names the caller in the other file, because the index told it who reads the function', async () => {
    const index = buildRepoIndex(REPO);
    const engine = new LLMReviewEngine(providerThatReads(), {
      lanes: ['maintainability'],
      reach: (path) => reachNoteOf(index, path),
    });

    const lanes = await engine.reviewPullRequest(SECTIONS, { maxFindingsPerPullRequest: 4 });
    const findings = lanes.filter((lane) => lane.success).flatMap((lane) => lane.findings);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toContain('still passes one argument');
    expect(findings[0]?.description).toContain('src/caller.ts:4');
  });

  it('gives the weaker remark when the same engine has no repository, so the difference is the index', async () => {
    const engine = new LLMReviewEngine(providerThatReads(), { lanes: ['maintainability'] });

    const lanes = await engine.reviewPullRequest(SECTIONS, { maxFindingsPerPullRequest: 4 });
    const findings = lanes.filter((lane) => lane.success).flatMap((lane) => lane.findings);

    expect(findings[0]?.title).toContain('duplicates the threshold');
    // **The default is `() => null`**, so an engine nobody configured produces exactly the prompt it produced before
    // this device existed. A switch that a caller can forget and still get the new behaviour is not a switch.
    expect(engine.costSummary().calls).toBe(1);
  });

  it('buys no call: the fact is free and the bill is the same', async () => {
    const index = buildRepoIndex(REPO);
    const withIndex = new LLMReviewEngine(providerThatReads(), {
      lanes: ['maintainability'],
      reach: (path) => reachNoteOf(index, path),
    });
    const withoutIndex = new LLMReviewEngine(providerThatReads(), { lanes: ['maintainability'] });

    await withIndex.reviewPullRequest(SECTIONS, { maxFindingsPerPullRequest: 4 });
    await withoutIndex.reviewPullRequest(SECTIONS, { maxFindingsPerPullRequest: 4 });

    // **The device is context, not a second opinion**, so it must not add a call - and a figure that reported a
    // quality change without this line would be a figure whose price nobody stated.
    expect(withIndex.costSummary().calls).toBe(withoutIndex.costSummary().calls);
  });

  it('adds no section when the provider has nothing for any file in the pull request', async () => {
    const prompts: string[] = [];
    const provider = providerThatReads();
    const engine = new LLMReviewEngine(
      {
        ...provider,
        complete: (prompt) => {
          prompts.push(prompt);
          return provider.complete(prompt);
        },
        completeWithTools: (prompt, tools, options) => {
          prompts.push(prompt);
          return provider.completeWithTools(prompt, tools, options);
        },
      },
      {
        lanes: ['maintainability'],
        // **Both silent answers, in one call**: `null` is *the index has no note* and an empty line list is *the note
        // had nothing to render*. A section rendered for either would be a heading over nothing, which a model reads
        // as "nothing outside reads this" - a claim neither answer made.
        reach: (path) =>
          path === 'src/limit.ts' ? null : { path, lines: [], unread: 0, importers: 0 },
      },
    );

    await engine.reviewPullRequest(SECTIONS, { maxFindingsPerPullRequest: 4 });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('Cross-file reach');
  });

  it('reaches a file review as well, where the block sits beside the change type', async () => {
    const index = buildRepoIndex(REPO);
    const prompts: string[] = [];
    const provider = providerThatReads();
    const engine = new LLMReviewEngine(
      {
        ...provider,
        complete: (prompt) => {
          prompts.push(prompt);
          return provider.complete(prompt);
        },
        completeWithTools: (prompt, tools, options) => {
          prompts.push(prompt);
          return provider.completeWithTools(prompt, tools, options);
        },
      },
      { lanes: ['maintainability'], reach: (path) => reachNoteOf(index, path) },
    );

    await engine.reviewDiff({
      filePath: 'src/limit.ts',
      oldHash: 'a',
      newHash: 'b',
      changeType: 'modified',
      ranges: [{ oldStart: 1, oldEnd: 3, newStart: 1, newEnd: 4, changeType: 'modified' }],
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Cross-file reach');
    expect(prompts[0]).toContain('withinLimit ← src/caller.ts:4');
  });
});
