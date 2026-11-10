// **The contract said where a finding points and never what it says, and the corpus priced the difference.**
//
// On AACR, **98 of 170 goldens were missed by a finding on their own file.** Re-reading the corpus's `from_line` against
// the findings' ranges put **40 of those 98 on the golden's own line and 73 within ten lines** - so the lanes were not
// searching the wrong place. They were standing in the right one and describing something a judge would not accept as
// the same defect (`docs/EVAL-CONTRACT.md` §15.4, registration R-15).
//
// **Nothing in the prompt asked them to do better.** The file contract spends a hundred and seventy words on lines and
// severity and not one on the sentence; the pull-request contract has eight rules and none of them is about what a
// description has to contain. **A suggestion that names no failure cannot be matched, cannot be checked and cannot be
// wrong** - which is a worse property than being wrong, because it cannot fail.
//
// **These tests hold the requirement in both scopes and in every lane**, because a rule that reached four lanes out of
// five would be a rule whose effect the next measurement would attribute to the lanes.

import { describe, expect, it } from 'vitest';

import {
  ARCHITECTURE_REVIEW_PROMPT,
  LANE_PROMPTS,
  MAINTAINABILITY_REVIEW_PROMPT,
  PERFORMANCE_REVIEW_PROMPT,
  SECURITY_REVIEW_PROMPT,
  TESTING_REVIEW_PROMPT,
} from '../../packages/intelligence/src/review/llm/prompts.js';

import type { PromptContext } from '../../packages/intelligence/src/review/llm/prompts.js';

function context(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    diffContent: '@@ -1 +1 @@\n+final int x = 1;',
    filePath: 'src/main/java/com/example/Ledger.java',
    changeType: 'modified',
    ...overrides,
  };
}

/** The sentence that states the requirement, in the form the two scopes agree on. */
const REQUIREMENT = 'The description names the failure, not the fix';

const lanes: Array<[string, (ctx: PromptContext) => string]> = [
  ['security', SECURITY_REVIEW_PROMPT],
  ['performance', PERFORMANCE_REVIEW_PROMPT],
  ['maintainability', MAINTAINABILITY_REVIEW_PROMPT],
  ['architecture', ARCHITECTURE_REVIEW_PROMPT],
  ['testing', TESTING_REVIEW_PROMPT],
];

describe('a finding has to say what fails, and for which input', () => {
  it('asks for it in every lane, in a file call', () => {
    for (const [name, build] of lanes) {
      expect(build(context()), name).toContain(REQUIREMENT);
    }
  });

  it('asks for it in every lane, in a pull-request call', () => {
    // **The scope has its own contract with its own eight rules**, so a requirement added only to the file contract
    // would be absent from exactly the calls the benchmark's file arm and pull-request arm disagree about.
    for (const [name, build] of lanes) {
      expect(build(context({ scope: 'pull-request', paths: ['src/a.java'] })), name).toContain(
        REQUIREMENT,
      );
    }
  });

  it('reaches the lanes through the exported map, not only through the named functions', () => {
    for (const [name, build] of Object.entries(LANE_PROMPTS)) {
      expect(build(context()), name).toContain(REQUIREMENT);
    }
  });

  it('states the failure as the thing to name, and a suggestion as the thing not to', () => {
    const prompt = SECURITY_REVIEW_PROMPT(context());
    // **The contrast is the requirement.** "Names the failure, not the fix" is a distinction a model can act on only if
    // both sides of it appear: what to write, and what not to write.
    expect(prompt).toContain('what goes wrong and under which');
    expect(prompt).toContain('rather than "consider closing the stream"');
  });

  it('carries its own evidence, because a rule without one is a preference', () => {
    // **The numbers are in the prompt rather than in a document beside it**, for the same reason rule 1 of the
    // pull-request contract carries its own: a rule a model cannot see the reason for is a rule that competes with the
    // other thirty sentences in the same prompt and loses.
    const prompt = SECURITY_REVIEW_PROMPT(context());
    expect(prompt).toContain('98 goldens');
    expect(prompt).toContain('within ten');
  });

  it('is one rule and not two, so the file and pull-request scopes cannot drift apart', () => {
    // The same sentence appears once per prompt because the shared constant is spliced into both contracts. **A copy in
    // each contract would be two rules that agree today** - which is not the same thing as one rule.
    const fileCall = SECURITY_REVIEW_PROMPT(context());
    const pullRequestCall = SECURITY_REVIEW_PROMPT(
      context({ scope: 'pull-request', paths: ['src/a.java'] }),
    );
    const tail =
      'A suggestion that names no failure cannot be right or wrong, which is why it is not reported';
    expect(fileCall).toContain(tail);
    expect(pullRequestCall).toContain(tail);
    expect(fileCall.match(/The description names the failure/g)).toHaveLength(1);
    expect(pullRequestCall.match(/The description names the failure/g)).toHaveLength(1);
  });
});
