// @code-analyzer — End-to-end: a defect that spans two files is reported once, on the file that has to change
//
// **The user story, in one sentence**: *I renamed a field in one file and missed a reader of it in another, I asked for
// a review of the pull request, and the review named the file I have to change.*
//
// **Why this cannot be a unit test of the pull-request method.** The method's own suite drives it with hand-built
// sections and asserts the path rules in isolation. What can only break here is the join: **the per-file sections the
// caller splits out of one `git diff`, the paths written into the prompt, the path the model answers with, the
// per-file hunk ranges the filter judges that answer against, and the comment that reaches the developer.** A path
// rule that is correct in isolation and given the wrong spelling produces a review that is confident, well-ordered and
// filed against a file nobody changed.
//
// **And it is the story the competitor's own architecture says is the reason to review a pull request at all**: their
// contract asks for *"inconsistencies, missing updates and broken contracts across related files"*, which a review
// that reads one file cannot see. This test is that sentence, executed.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '@code-analyzer/intelligence';

import type { LLMProvider, CompletionResult } from '@code-analyzer/intelligence';

// ---------------------------------------------------------------------------
// The change under review: a field renamed in one file, a reader left stale in another
// ---------------------------------------------------------------------------

/**
 * One pull request, three files, as `git diff` writes it.
 *
 * `src/order.ts` renames `total` to `amount`; `src/invoice.ts` still reads `order.total`; `CHANGELOG.md` records the
 * rename. **The defect is not in any one of the three** - it is that the second file was not updated with the first -
 * so **a review of any single file either misses it or has to guess**.
 */
const PATCH = [
  'diff --git a/src/order.ts b/src/order.ts',
  '--- a/src/order.ts',
  '+++ b/src/order.ts',
  '@@ -12,3 +12,3 @@ export interface Order {',
  '   id: string;',
  '-  total: number;',
  '+  amount: number;',
  ' }',
  'diff --git a/src/invoice.ts b/src/invoice.ts',
  '--- a/src/invoice.ts',
  '+++ b/src/invoice.ts',
  '@@ -4,3 +4,3 @@ export function invoice(order: Order) {',
  '   const tax = rate(order);',
  '-  return order.total + tax;',
  '+  return order.amount + tax;',
  ' }',
  'diff --git a/CHANGELOG.md b/CHANGELOG.md',
  '--- a/CHANGELOG.md',
  '+++ b/CHANGELOG.md',
  '@@ -1,1 +1,2 @@',
  ' # Changelog',
  '+## Unreleased',
].join('\n');

/**
 * The three sections a caller splits one patch into, each keeping its own `diff --git` header so the concatenation the
 * engine is given is still a valid unified diff. **This is the split the benchmark job performs**, and it is the only
 * thing between the developer's pull request and the engine.
 */
function sectionsOf(patch: string): Array<{ path: string; diffText: string }> {
  const sections: Array<{ path: string; diffText: string[] }> = [];
  let current: { path: string; diffText: string[] } | null = null;
  for (const line of patch.split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      if (current) sections.push(current);
      current = { path: String(header[2]), diffText: [line] };
      continue;
    }
    current?.diffText.push(line);
  }
  if (current) sections.push(current);
  return sections.map((section) => ({
    path: section.path,
    diffText: section.diffText.join('\n'),
  }));
}

/**
 * A provider that answers like a model that read the pull request.
 *
 * **Three things a real model does and this reproduces**: it names the file it is talking about, **once with a leading
 * `./` that the diff does not use**, and it also raises one point about a file **the pull request did not show** -
 * which is the mistake the path rule exists to catch.
 */
function providerReadingThePullRequest(): LLMProvider {
  let call = 0;
  return {
    name: 'ScriptedProvider',
    model: 'scripted-model',
    complete: async () => {
      call += 1;
      const content =
        call === 1
          ? JSON.stringify({
              findings: [
                {
                  path: './src/invoice.ts',
                  startLine: 5,
                  endLine: 5,
                  severity: 'high',
                  category: 'bug',
                  title: 'order.total no longer exists',
                  description:
                    'The rename in src/order.ts changes total to amount, and this reader still returns order.amount from a stale local copy.',
                  suggestion:
                    'Return order.amount, and check that no other reader of total remains.',
                },
                {
                  path: 'src/pricing.ts',
                  startLine: 30,
                  endLine: 30,
                  severity: 'medium',
                  category: 'bug',
                  title: 'pricing still reads total',
                  description: 'There is probably a reader in pricing too.',
                  suggestion: null,
                },
              ],
            })
          : JSON.stringify({
              findings: [
                {
                  path: 'src/invoice.ts',
                  startLine: 5,
                  endLine: 5,
                  severity: 'high',
                  category: 'bug',
                  title: 'Stale reader of the renamed field',
                  description:
                    'order.amount is read here but the interface was renamed in the same pull request, so the two files disagree about the field name.',
                  suggestion: 'Return order.amount and delete the stale copy.',
                },
              ],
            });
      return {
        content,
        model: 'scripted-model',
        createdAt: new Date().toISOString(),
        finishReason: 'stop',
      } as CompletionResult;
    },
    completeWithTools: async () => {
      throw new Error('not used');
    },
    healthCheck: async () => true,
  };
}

// ---------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------

describe('a pull request whose defect spans two files', () => {
  it('reports the stale reader on the file that has to change, once', async () => {
    const engine = new LLMReviewEngine(providerReadingThePullRequest(), {
      lanes: ['architecture', 'maintainability'],
      parallel: false,
    });

    const results = await engine.reviewPullRequest(sectionsOf(PATCH), {
      maxFindingsPerPullRequest: 4,
    });
    const findings = results.flatMap((result) => result.findings);

    // **One comment, and it is about `src/invoice.ts`** - the two lanes independently named the same stale reader, and
    // **an agreement is one comment a developer has to act on rather than two they have to reconcile.**
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe('src/invoice.ts');
    expect(findings[0]!.agreement).toBe(2);
  });

  it('answers with a path a repository has, even when the model wrote it differently', async () => {
    const engine = new LLMReviewEngine(providerReadingThePullRequest(), {
      lanes: ['architecture'],
    });

    const results = await engine.reviewPullRequest(sectionsOf(PATCH));

    // The model wrote `./src/invoice.ts`; the diff wrote `b/src/invoice.ts`. **Both name one file**, and a comment has
    // to carry the spelling the repository uses or the line anchor cannot be applied.
    expect(results[0]!.findings[0]!.path).toBe('src/invoice.ts');
  });

  it('refuses the finding about a file the pull request did not show, and says so', async () => {
    const engine = new LLMReviewEngine(providerReadingThePullRequest(), {
      lanes: ['architecture'],
    });

    await engine.reviewPullRequest(sectionsOf(PATCH));

    // `src/pricing.ts` is not in the pull request. **A model that names it is telling the truth about a file it was
    // never shown**, and **the honest answer is to drop the comment rather than to file it against a neighbour.**
    expect(engine.lastCounts?.dropped.unknownPath).toBe(1);
    expect(engine.lastCounts?.dropped.missingPath).toBe(0);
  });

  it('is a different review from the same engine reading the files one at a time', async () => {
    const engine = new LLMReviewEngine(providerReadingThePullRequest(), {
      lanes: ['architecture'],
      parallel: false,
    });
    const sections = sectionsOf(PATCH);

    const perFile = [];
    for (const section of sections) {
      perFile.push(
        ...(await engine.reviewDiff(
          {
            filePath: section.path,
            oldHash: 'a',
            newHash: 'b',
            ranges: [{ oldStart: 1, oldEnd: 9, newStart: 1, newEnd: 9, changeType: 'modified' }],
            changeType: 'modified',
          },
          section.diffText,
        )),
      );
    }

    // **The file arm asks three questions and gets three answers about one file each**, so a finding that names another
    // file has nowhere to go and is filed against the file that was being read - which is the defect the pull-request
    // scope removes. The assertion is on the number of questions, because that is what differs.
    expect(perFile).toHaveLength(3);
    expect(perFile.every((result) => result.findings.every((f) => f.path === undefined))).toBe(
      true,
    );
  });
});
