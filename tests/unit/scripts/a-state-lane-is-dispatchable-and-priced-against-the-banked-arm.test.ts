// @code-analyzer/code-analyzer — the state device is a dispatchable arm priced against the banked reviewer arm
//
// **A registered claim that cannot be dispatched is a paragraph in a document.** §181 / R-179 registers the
// state-lifecycle lane against the corrected partition; this file is the wiring that makes it a run. It mirrors the
// reviewer guard: the workflow offers the set, the planner builds the arm and its pair, the bench accepts the name at
// the size the arm actually buys, and the default that prices every earlier figure has not moved.
//
// **Why the comparison is `reviewer` vs `stateful`.** Both are six calls and differ in exactly one lane
// (`crosscheck` -> `state`). Pairing the device against the five-lane baseline would confound one question with a
// change of bill; pairing two six-call sets makes the delta one question, which is the R-178 precedent.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { planMatrix } from '../../../.github/scripts/aacr-plan-matrix.mjs';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'aacr-bench.yml'), 'utf8');
const BENCH = readFileSync(join(ROOT, '.github', 'scripts', 'aacr-bench.mjs'), 'utf8');
const PROMPTS = readFileSync(
  join(ROOT, 'packages', 'intelligence', 'src', 'review', 'llm', 'prompts.ts'),
  'utf8',
);

describe('the state device arm', () => {
  it('is a value a dispatch can choose, without moving the published default', () => {
    const options = /lane_set:[\s\S]*?options:\s*\[([^\]]*)\]/u.exec(WORKFLOW);
    expect(options, 'the workflow no longer declares lane_set options in one list').not.toBeNull();
    expect(options![1]).toContain("'stateful'");
    // **Its pair stays in the planner and off this dispatch**, exactly as R-178's `pair-reviewer` does: an option
    // whose pair step never fires uploads an arm nobody downloads.
    expect(options![1]).not.toContain("'pair-stateful'");
    expect(WORKFLOW).toMatch(/lane_set:\n(?:.*\n)*?\s+default: 'off'/u);
  });

  it('has a single arm and an equipollent pair in the planner', () => {
    const arm = planMatrix({ lane_set: 'stateful' });
    expect(arm).toHaveLength(1);
    expect(arm[0]!['lane_set']).toBe('stateful');
    const pair = planMatrix({ lane_set: 'pair-stateful' });
    expect(pair).toHaveLength(2);
    expect(pair[0]!['lane_set']).toBe('reviewer');
    expect(pair[1]!['lane_set']).toBe('stateful');
    // **The two rows differ in exactly one key**, or the subtraction answers neither question.
    const differing = Object.keys(pair[0]!).filter((key) => pair[0]![key] !== pair[1]![key]);
    expect(differing).toEqual(['lane_set']);
  });

  it('is accepted by the bench at six calls and refused under fused', () => {
    expect(BENCH).toContain("'stateful'");
    expect(BENCH).toMatch(/stateful: 6/u);
    // **The fused prompt does not carry the state question**, so a fused `stateful` run would buy a call it never
    // puts. The guard refuses it rather than defaulting, and the union is read from the module that declares it.
    const union = /export const FUSED_QUESTIONS[\s\S]*?\n\];/u.exec(PROMPTS);
    expect(union).not.toBeNull();
    expect(union![0]).not.toMatch(/lane: 'state'/u);
    expect(BENCH).toMatch(/FUSED_QUESTIONS does not ask it/u);
  });
});
