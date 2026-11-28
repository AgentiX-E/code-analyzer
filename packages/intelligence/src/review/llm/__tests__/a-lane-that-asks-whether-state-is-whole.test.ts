// @code-analyzer/intelligence — a lane that asks whether the state a change touches is whole
//
// **Why an eighth question, in the corpus's own sentences.** `EVAL-CONTRACT.md` §180 joins every missed golden to the
// corpus's `category` and keeps only `Code Defect`. Of the 209 such goldens, `state` is the largest miss-rate shape:
// 14 hit / 21 miss, `0.600`. Reading the 19 actionable-but-rejected state notes shows they are not one defect but one
// *question* — is the piece of state this line touches whole on every path that reaches it:
//
// - a member with no in-class initialiser that a constructor can leave indeterminate (`20825#12`, `19411#17`);
// - a resource acquired on one path and not released on another, especially a throw (`19426#0`, `8689#4`, `8689#14`);
// - a flag set on failure and never reset, blocking every future attempt (`12718#6`, `1617#1`);
// - cleanup that mutates shared state outside the lock that guards it (`12718#4`), or a struct only partly filled
//   (`31402#6`, `6542#0`).
//
// **None of the seven lanes asks it.** `behaviour` asks what the value at the line does when it is empty; `crosscheck`
// asks whether two places still agree; `architecture` asks whether a boundary was crossed. A question about whether a
// single piece of state is complete across the paths that reach it is distinct from all three, and §180.2 measured the
// six devices that are not this one.
//
// **What this file guards.** The lane exists as a prompt a run can dispatch, its set swaps exactly one lane so the
// six-call bill is unchanged, and the prompt asks for the state and the path that leaves it incomplete — the "name
// what is wrong" framing §69.4 priced at 0.343 against 0.183 for narration. No F1 is claimed here: claim R-179 pays
// for it in a paired arm on the Runner.

import { describe, expect, it } from 'vitest';

import {
  LANE_LABELS,
  LANE_PRIORITIES,
  LANE_PROMPTS,
  LANE_SETS,
  STATE_REVIEW_PROMPT,
  type PromptContext,
} from '../prompts.js';

const CONTEXT: PromptContext = {
  diffContent: '+  this.flag = true;',
  filePath: 'src/engine/Engine.cpp',
  changeType: 'modified',
};

describe('the state lane asks whether a piece of state is whole on every path', () => {
  const prompt = STATE_REVIEW_PROMPT(CONTEXT);

  it('is registered as a lane, so a run can name which one produced a finding', () => {
    expect(LANE_PROMPTS.state).toBe(STATE_REVIEW_PROMPT);
    expect(LANE_LABELS.state).toBe('State Review');
    expect(LANE_PRIORITIES).toContain('state');
  });

  it('names the four families the 19 state goldens fall into, each as a state-plus-path to inspect', () => {
    expect(prompt).toMatch(/name the state and the path/i);
    expect(prompt).toMatch(/a member with no initialiser/i);
    expect(prompt).toMatch(/acquired on one path and not released/i);
    expect(prompt).toMatch(/set on failure and never reset/i);
    expect(prompt).toMatch(/shared state mutated outside the lock/i);
    expect(prompt).toMatch(/only partly filled/i);
    // **The shape the six other lanes have and this one must not**: a *"pay attention to"* list narrates the change,
    // which is the 0.183 framing §69.4 measured, not the 0.343 framing that names what is wrong.
    expect(prompt).not.toMatch(/pay attention to/i);
    expect(prompt).toMatch(/do not report an improvement here/i);
  });

  it('refuses a finding that cannot name the state and the path that leaves it incomplete', () => {
    expect(prompt).toMatch(/quote both the state and the path/i);
    expect(prompt).toMatch(/has not\s+answered the question/i);
    // **The permission to say nothing**, which the clean-control study priced: a lane that accuses every change
    // drowns the changes that actually break state.
    expect(prompt).toMatch(/most changes leave the state they touch whole/i);
  });

  it('carries two worked examples, one per family the corpus misses most', () => {
    expect(prompt.match(/Few-shot example/g) ?? []).toHaveLength(2);
    expect(prompt).toMatch(/no in-class initialiser/i);
    expect(prompt).toMatch(/defragInProgress/i);
  });

  it('is asked in a six-call set that swaps exactly one lane', () => {
    // **`stateful` is a substitution, not a seventh call.** A set that also costs 17 % more per file cannot be priced
    // against one that does not; six calls either way, so the difference between `reviewer` and `stateful` is one lane.
    expect(LANE_SETS.stateful).toHaveLength(LANE_SETS.reviewer.length);
    expect(LANE_SETS.reviewer).toContain('crosscheck');
    expect(LANE_SETS.stateful).not.toContain('crosscheck');
    expect(LANE_SETS.stateful).toContain('state');
    expect([...LANE_SETS.stateful].sort()).toEqual(
      [...LANE_SETS.reviewer.filter((lane) => lane !== 'crosscheck'), 'state'].sort(),
    );
  });
});
