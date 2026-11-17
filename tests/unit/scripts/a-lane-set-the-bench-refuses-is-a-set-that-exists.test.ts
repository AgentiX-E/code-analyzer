// @code-analyzer/code-analyzer — the lane sets the bench accepts are the sets that exist
//
// **This file exists because the list was written twice and the second copy went stale.** `parseLaneSet` refused
// anything but `shipped` and `behaviour`, and `LANE_SETS` in `packages/intelligence/src/review/llm/prompts.ts` defines
// those two *plus* `wide`. Adding the third set therefore produced a dispatch that threw at module scope - **before a
// single call, which is the good failure mode, and on a workflow input that had just been declared valid, which is the
// bad one**: the matrix said `wide` was a legal arm and the script said it was a typo.
//
// **So the pairs are checked rather than trusted.** A lane set is a reviewer, and the list of reviewers is exactly the
// kind of thing that gets extended in one file and not the other.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const BENCH = readFileSync(join(ROOT, '.github', 'scripts', 'aacr-bench.mjs'), 'utf8');
const PROMPTS = readFileSync(
  join(ROOT, 'packages', 'intelligence', 'src', 'review', 'llm', 'prompts.ts'),
  'utf8',
);

/** The keys of `LANE_SETS` as the module declares them. */
function declaredSets(): string[] {
  const block = /export const LANE_SETS = \{([\s\S]*?)\n\} as const satisfies/.exec(PROMPTS);
  expect(block, 'LANE_SETS is no longer declared in the shape this test reads').not.toBeNull();
  return [...block![1]!.matchAll(/^\s{2}([a-z][a-z-]*):/gm)].map((match) => match[1]!);
}

/** The names `parseLaneSet` accepts, read out of the line that lists them. */
function acceptedSets(): string[] {
  const list = /const LANE_SET_NAMES = \[([^\]]*)\]/.exec(BENCH);
  expect(list, 'the bench no longer names its accepted lane sets in one list').not.toBeNull();
  return [...list![1]!.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]!);
}

describe('the two lists of lane sets', () => {
  it('names every set the module defines', () => {
    // **Both directions**, because either half alone passes on a list that has lost an entry: a bench that accepts a set
    // the module never defined crashes at the import, and a module that defines a set the bench refuses cannot be
    // dispatched at all - which is the failure this file was written after.
    expect(acceptedSets().sort()).toEqual(declaredSets().sort());
  });

  it('refuses an unknown set by naming the ones that exist', () => {
    // **The error has to be readable by whoever typed the dispatch**, and the message is generated from the list rather
    // than written beside it, so a fourth set cannot appear in the acceptance list and be missing from the refusal.
    expect(BENCH).toMatch(/AACR_LANE_SET must be one of/);
    expect(BENCH).toContain('LANE_SET_NAMES.join');
  });

  it('ships the default it has always shipped', () => {
    // **The default is a published figure, not a preference**: every number in `EVAL-CONTRACT.md` before §69 was measured
    // under `shipped`, so a default that moved would silently re-price the whole table.
    expect(BENCH).toMatch(/String\(raw \?\? 'shipped'\)/);
  });
});
