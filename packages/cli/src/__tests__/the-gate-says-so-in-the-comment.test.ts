/**
 * **A comment that says three findings and not that the gate could not read the change is a comment about a review
 * nobody ran.**
 *
 * §133 wired the grounding gate into `review pr`; these are the sentences the two renderings may produce. Three states
 * matter and each is a case below:
 *
 * - **applied, nothing dropped, nothing paraphrased** - silence, because *"grounding applied: 0 of 3 dropped"* on every
 *   comment is the noise that teaches a reader to skip the line that matters;
 * - **applied and dropped something** - the sentence, above the findings, naming the rule and the count;
 * - **withheld** - the same sentence with the refusal in it, because the findings below it are unchecked and a reader
 *   is entitled to know which of the two silences they are looking at.
 *
 * The report is built by the real command on a real repository rather than assembled by hand, so the test fails if the
 * command stops recording the decision at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRepo, type GitFixture } from './git-fixture.js';
import { formatPrReviewMarkdown, formatPrReviewText, runPrReview } from '../commands/pr-review.js';

const SECRET = [
  'export function lookup(id: string): string {',
  '  const password = "hunter2-hardcoded";',
  '  return id;',
  '}',
  '',
].join('\n');

function fixture(): GitFixture {
  const repo = createRepo();
  repo.branch('feature');
  repo.write('src/lookup.ts', SECRET);
  repo.commit('add lookup');
  repo.checkout('main');
  repo.write('src/untouched.ts', 'export const untouched = 1;\n');
  repo.commit('base work');
  repo.checkout('feature');
  return repo;
}

describe('the grounding decision as a reader meets it', () => {
  let repo: GitFixture;

  beforeAll(() => {
    repo = fixture();
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('prints the refusal when the gate could not read every file the findings name', async () => {
    const run = await runPrReview({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
    });
    if (!run.ok) throw new Error(run.error);
    // The real run has every file, so the withheld state is injected into its summary: what is under test here is the
    // rendering of the decision, and the decision itself is covered where it is made.
    const withheld = {
      ...run.report,
      summary: {
        ...run.report.summary,
        grounding: {
          ...run.report.summary.grounding!,
          applied: false,
          withheld: 'no-readable-arm' as const,
          readable: 0,
          sentence:
            'grounding withheld (no-readable-arm): 0 of 3 findings were on a file this run read',
        },
      },
    };
    expect(formatPrReviewMarkdown(withheld)).toContain('**Grounding:** grounding withheld');
    expect(formatPrReviewText(withheld)).toContain('Grounding: grounding withheld');
  });

  it('prints the sentence when the gate dropped something, and stays quiet when it dropped nothing', async () => {
    const run = await runPrReview({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
    });
    if (!run.ok) throw new Error(run.error);
    const dropped = {
      ...run.report,
      summary: {
        ...run.report.summary,
        grounding: {
          ...run.report.summary.grounding!,
          droppedByReason: {
            'the quoted code does not appear in the file or in the change at lines 2-2': 1,
          },
        },
      },
    };
    expect(formatPrReviewMarkdown(dropped)).toContain('**Grounding:** grounding applied');

    const clean = {
      ...run.report,
      summary: {
        ...run.report.summary,
        grounding: {
          ...run.report.summary.grounding!,
          droppedByReason: {},
          unverifiableQuotes: 0,
        },
      },
    };
    expect(formatPrReviewMarkdown(clean)).not.toContain('**Grounding:**');
    expect(formatPrReviewText(clean)).not.toContain('Grounding:');
  });
});
