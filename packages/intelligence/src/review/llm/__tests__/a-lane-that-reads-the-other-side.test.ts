// @code-analyzer/intelligence — a lane that reads the other side of what the patch says
//
// **Why a seventh question, in the corpus's own sentences.** `EVAL-CONTRACT.md` §164 reads the thirty-two credited
// goldens that the competitor's arm names and ours never does, and **twenty of them sit on a symbol our pool already
// mentions**: we wrote about `credentialId`, about `has_global_access`, about `group_id` - and asserted something else
// about the same line. What the golden asserts is a *correspondence*: the route publishes `params[:id]` and the handler
// reads `params[:group_id]`; the refresh helper takes a user id and is handed a credential id; the paginator is built
// for a numeric key and the caller orders by a timestamp; the `zh_CN` bundle carries traditional characters.
//
// **That is not a value at a line, and it is not a category of improvement.** It is two statements of one intent - a
// call and its callee, a name and its producer, a counter written twice, a rule and the place it is written - and
// **whether they still agree**. None of the six lanes asks it: `behaviour` asks what the value at the line does when it
// is empty, `maintainability` asks whether the file contradicts its own conventions, and `architecture` asks whether a
// boundary was crossed. A question that cannot name the other side cannot find a disagreement with it.
//
// **What this file guards.** The lane exists as a prompt a run can dispatch, its set swaps exactly one lane, and the
// prompt asks for both sides rather than for a category - the failure mode `§69.4` measured at precision 0.183 for
// findings that narrate the change against 0.343 for findings that name what is wrong.

import { describe, expect, it } from 'vitest';

import {
  CROSSCHECK_REVIEW_PROMPT,
  LANE_LABELS,
  LANE_PROMPTS,
  LANE_SETS,
  type PromptContext,
} from '../prompts.js';

const CONTEXT: PromptContext = {
  diffContent: 'const user = await refresh(id);',
  filePath: 'src/auth/refresh.ts',
  changeType: 'modified',
};

describe('the crosscheck lane asks what the other side says', () => {
  const prompt = CROSSCHECK_REVIEW_PROMPT(CONTEXT);

  it('is registered as a lane, so a run can name which one produced a finding', () => {
    expect(LANE_PROMPTS.crosscheck).toBe(CROSSCHECK_REVIEW_PROMPT);
    expect(LANE_LABELS.crosscheck).toBe('Cross-check Review');
  });

  it('asks for the two sides rather than handing over a category checklist', () => {
    // **The four families are the four the corpus's misses fall into**, and each is stated as a pair to name rather
    // than as a defect to hunt: a call and its callee, a name and its producer, one value written twice, a rule and the
    // place it is written.
    expect(prompt).toMatch(/name the two sides/i);
    expect(prompt).toMatch(/a call and the thing it calls/i);
    expect(prompt).toMatch(/a name and the place that produces it/i);
    expect(prompt).toMatch(/one value written twice/i);
    expect(prompt).toMatch(/a rule the patch claims to follow/i);
    // **The shape the five old lanes have and this one must not**: a *"pay attention to"* list is what makes a lane
    // report what it notices about the diff, which is the narration §69.4 priced at 0.183 against 0.343.
    expect(prompt).not.toMatch(/pay attention to/i);
    expect(prompt).toMatch(/do not report an improvement here/i);
  });

  it('refuses a finding that cannot quote both sides', () => {
    // **The same falsifier the falsification pass applies** (`§45`), stated in the prompt so the model can decline
    // before it writes: a sentence about the change is not a sentence about a disagreement.
    expect(prompt).toMatch(/quote both sides/i);
    // **`\s+` because the prompt is a wrapped paragraph**, and the sentence the model reads is the sentence asserted.
    expect(prompt).toMatch(/has not\s+answered the question/i);
    // **And the permission to say nothing**, which the clean-control study priced: 93.8 % of clean items accused
    // without it, 0 % with it, at unchanged detection.
    expect(prompt).toMatch(/most changes keep both sides in step/i);
  });

  it('carries two worked examples, one per family the corpus misses most', () => {
    // **A wrong argument and a wrong name**, because they are the two shapes twenty of the thirty-two comments assert:
    // the call that hands the callee something it does not read, and the reader that spells a key differently from the
    // producer. `toEqual` on the count rather than `at least`, so an example added to the head is a change of prompt
    // length this file reports instead of one it absorbs.
    expect(prompt.match(/Few-shot example/g) ?? []).toHaveLength(2);
    expect(prompt).toMatch(/passed a credential id where the callee reads a user id/i);
    expect(prompt).toMatch(/reads params\.group_id but the route publishes params\.id/i);
  });

  it('is asked in the reviewer set, which swaps the one lane the cut deletes', () => {
    // **Derived from the two sets rather than spelled out**, so a lane added to `wide` and forgotten here is a
    // difference this assertion reports. `testing`'s entire product is `category: test` findings, and `drop test` is
    // the first step of the cut on both boards - 192 such findings in the wide artifact, none of which reached a judge.
    expect(LANE_SETS.reviewer).toHaveLength(LANE_SETS.wide.length);
    expect(LANE_SETS.wide).toContain('testing');
    expect(LANE_SETS.reviewer).not.toContain('testing');
    expect(LANE_SETS.reviewer).toContain('crosscheck');
    expect([...LANE_SETS.reviewer].sort()).toEqual(
      [...LANE_SETS.wide.filter((lane) => lane !== 'testing'), 'crosscheck'].sort(),
    );
  });
});
