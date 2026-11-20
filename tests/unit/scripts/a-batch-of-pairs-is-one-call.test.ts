/**
 * **The judge's prompt, which was 46 % of the bill and 8.5 % cached.**
 *
 * §110 read the judge's ledger out of three artifacts and found the constant block was never cached: 1 270 331 prompt
 * tokens over 5 080 calls is **250 tokens a call**, of which the three instruction lines are **57** - and a prefix cache
 * works in blocks of **64**. **The shared block did not exist, so there was nothing for the cache to hit**, which is why
 * reordering the prompt (§110's R-49) could not have worked and did not.
 *
 * **A batch creates the block.** Eight comments behind one instruction block make the shared prefix 57 + one golden,
 * read eight times, and divide the per-pair instruction cost by eight. These cases hold the two properties that make it
 * a price device rather than a rewrite: **the prefix is literally the same string for every batch of one golden**, and
 * **an answer that is not one verdict per comment is `null`** - which the caller answers by paying for the pairs one at
 * a time.
 */
import { describe, expect, it } from 'vitest';

import {
  buildJudgeMessages,
  chunkIndices,
  parseJudgeBatch,
} from '../../../.github/scripts/lib/judge-batch.mjs';

const GOLDEN =
  'The retry counter is never reset after a successful reconnect, so a transient failure exhausts it.';

describe('a batch is one prompt, and its prefix is what the cache reads', () => {
  it('puts the instructions and the golden in the system message, where the prefix starts', () => {
    const { system, user } = buildJudgeMessages(GOLDEN, ['a', 'b']);
    expect(system.startsWith('You compare code review comments')).toBe(true);
    expect(system).toContain(GOLDEN);
    // **The comments are the variable part and they are the only thing after the prefix.**
    expect(user).toContain('1. a');
    expect(user).toContain('2. b');
    expect(user).not.toContain(GOLDEN);
  });

  it('gives every batch against one golden the same system message, byte for byte', () => {
    const first = buildJudgeMessages(GOLDEN, ['a', 'b', 'c']);
    const second = buildJudgeMessages(GOLDEN, ['d', 'e', 'f']);
    expect(first.system).toBe(second.system);
  });

  it('asks for exactly as many verdicts as there are comments, in order', () => {
    const { user } = buildJudgeMessages(GOLDEN, ['a', 'b', 'c']);
    expect(user).toContain('Answer with exactly 3 booleans');
    expect(user).toContain('{"matches":[true|false,true|false,true|false]}');
  });
});

describe('an unreadable batch is not a batch of non-matches', () => {
  it('reads one verdict per comment', () => {
    expect(parseJudgeBatch('{"matches":[true,false,true]}', 3)).toEqual([true, false, true]);
  });

  it('strips a fence, because a model that fences is still answering', () => {
    expect(parseJudgeBatch('```json\n{"matches":[false]}\n```', 1)).toEqual([false]);
  });

  it('refuses a short list rather than padding it with false', () => {
    // **The failure this repository has paid for twice**: three comments asked, two answered, and the third recorded as
    // a non-match. A length that does not match is a refusal.
    expect(parseJudgeBatch('{"matches":[true,false]}', 3)).toBeNull();
  });

  it('refuses a long list, a non-boolean entry, prose, and an empty answer', () => {
    expect(parseJudgeBatch('{"matches":[true,true,true,true]}', 3)).toBeNull();
    expect(parseJudgeBatch('{"matches":[true,"false",true]}', 3)).toBeNull();
    expect(parseJudgeBatch('The first matches and the second does not.', 2)).toBeNull();
    expect(parseJudgeBatch('', 1)).toBeNull();
  });

  it('refuses a count that is not a positive integer, because a caller with no comments has nothing to ask', () => {
    expect(parseJudgeBatch('{"matches":[]}', 0)).toBeNull();
  });
});

describe('chunking, which is the arithmetic and all of it', () => {
  it('covers every index exactly once, in order', () => {
    expect(chunkIndices(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(chunkIndices(4, 4)).toEqual([[0, 1, 2, 3]]);
    expect(chunkIndices(0, 8)).toEqual([]);
  });

  it('refuses a size that is not a positive integer', () => {
    expect(() => chunkIndices(3, 0)).toThrow(/positive integer/);
    expect(() => chunkIndices(3, 1.5)).toThrow(/positive integer/);
  });
});
