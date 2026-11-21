// @code-analyzer/code-analyzer — what a batched judge call would cost, before one is bought
//
// **The claim this file guards is arithmetic and it is registered as a bar.** R-56 says four pairs per judge call costs
// at most 60 % of the per-pair prompt tokens, and §118 measures that ratio at 49.2 % by building every request the judge
// would receive with the same pure function the harness uses. A ratio computed by a second implementation of the prompt
// would be a second opinion about what a request contains, so the module imports `buildJudgeMessages` rather than
// reproducing it - and these tests hold the three properties that make the number worth quoting.
//
// **The requests, exactly.** A batch of `k` costs one request per `ceil(findings / k)` for each golden, and nothing
// else: no request is dropped, and the last chunk is short rather than padded.
//
// **The prefix, once per golden.** The system message is what a batch makes shared and a per-pair call pays in full, so
// the total characters must fall as the batch grows - and the mean prefix must not move at all, because a golden's
// prefix does not depend on how many comments sit behind it.
//
// **The control is a measurement.** `size: 1` must reproduce the per-pair harness: one request per pair, and a total
// that is exactly the sum of the requests this module would send.

import { describe, expect, it } from 'vitest';

import { buildJudgeMessages } from '../../../.github/scripts/lib/judge-batch.mjs';
import {
  CACHE_BLOCK_TOKENS,
  batchArithmetic,
} from '../../../scripts/lib/judge-prompt-arithmetic.mjs';

/** Five findings on one pull request and two goldens, so a batch of four leaves a chunk of one. */
function fixture(findings = 5, goldens = 2) {
  const comments = [];
  for (let at = 0; at < goldens; at += 1) {
    comments.push({
      note: `golden ${String(at)} about the same defect`,
      path: `src/f${String(at)}.ts`,
    });
  }
  const rows = [];
  for (let at = 0; at < findings; at += 1) {
    rows.push({ pr: 'p1', path: `src/f${String(at % 2)}.ts`, text: `finding ${String(at)}` });
  }
  return { bench: { rankedFindings: rows }, corpus: [{ githubPrUrl: 'p1', comments }] };
}

const rowAt = (arithmetic: ReturnType<typeof batchArithmetic>, size: number) => {
  const row = arithmetic.rows.find((entry) => entry.size === size);
  if (row === undefined) throw new Error(`no row at size ${String(size)}`);
  return row;
};

describe('a batch is a request count, and it is exact', () => {
  it('sends one request per ceil(findings / size) for each golden', () => {
    const { bench, corpus } = fixture();
    const arithmetic = batchArithmetic(bench, corpus, [1, 2, 4, 5]);

    expect(arithmetic.pairs).toBe(10);
    expect(rowAt(arithmetic, 1).calls).toBe(10);
    // Five findings in twos is three chunks, not two and a half.
    expect(rowAt(arithmetic, 2).calls).toBe(6);
    // Four and one, so two chunks - and the second is short rather than padded.
    expect(rowAt(arithmetic, 4).calls).toBe(4);
    expect(rowAt(arithmetic, 5).calls).toBe(2);
  });

  it('costs the same for a size larger than the pool, because a batch cannot be emptier than the pool', () => {
    const { bench, corpus } = fixture();
    const arithmetic = batchArithmetic(bench, corpus, [5, 8, 64]);

    const calls = [5, 8, 64].map((size) => rowAt(arithmetic, size).calls);
    expect(calls).toEqual([2, 2, 2]);
  });
});

describe('the characters are the sum of the requests the harness would send', () => {
  it('reproduces the per-pair arm at size one, request for request', () => {
    const { bench, corpus } = fixture();
    const arithmetic = batchArithmetic(bench, corpus, [1]);

    let expected = 0;
    for (const golden of corpus[0]?.comments ?? []) {
      for (const finding of bench.rankedFindings) {
        const { system, user } = buildJudgeMessages(golden.note, [finding.text]);
        expected += system.length + user.length;
      }
    }

    expect(rowAt(arithmetic, 1).characters).toBe(expected);
    expect(rowAt(arithmetic, 1).charactersRatio).toBe(1);
    expect(rowAt(arithmetic, 1).callsRatio).toBe(1);
  });

  it('falls as the batch grows, because the prefix is paid once per request rather than once per pair', () => {
    const { bench, corpus } = fixture();
    const arithmetic = batchArithmetic(bench, corpus, [1, 2, 4]);

    const characters = [1, 2, 4].map((size) => rowAt(arithmetic, size).characters);
    expect(characters[1]).toBeLessThan(characters[0] as number);
    expect(characters[2]).toBeLessThan(characters[1] as number);
    // And a batch never costs more than the per-pair arm for the same pairs.
    for (const size of [2, 4]) {
      expect(rowAt(arithmetic, size).charactersRatio).toBeLessThan(1);
    }
  });

  it('keeps the ratio and the total consistent, so a published percentage is the one that was computed', () => {
    const { bench, corpus } = fixture();
    const arithmetic = batchArithmetic(bench, corpus, [1, 4]);
    const perPair = rowAt(arithmetic, 1);
    const batched = rowAt(arithmetic, 4);

    expect(batched.charactersRatio).toBeCloseTo(batched.characters / perPair.characters, 12);
    expect(batched.callsRatio).toBeCloseTo(batched.calls / perPair.calls, 12);
    expect(batched.charactersPerCall).toBeCloseTo(batched.characters / batched.calls, 12);
  });
});

describe('the shared prefix is a property of the golden and not of the batch', () => {
  it('reports one mean prefix whether the arm is batched or not', () => {
    const { bench, corpus } = fixture();
    const arithmetic = batchArithmetic(bench, corpus, [1, 4, 8]);

    // The prefix is what a batch divides; a mean that moved with the batch would be a mean over requests rather than
    // over goldens, and the comparison against the cache block would be against the wrong quantity.
    const expected =
      (buildJudgeMessages(corpus[0]?.comments?.[0]?.note ?? '', ['']).system.length +
        buildJudgeMessages(corpus[0]?.comments?.[1]?.note ?? '', ['']).system.length) /
      2;
    expect(arithmetic.meanSystemCharacters).toBeCloseTo(expected, 9);
  });

  it('carries the cache block it is compared against, so the comparison is not a number in a paragraph', () => {
    // §110's reading: a prefix cache works in blocks of 64 tokens. The constant travels with the module because a
    // reader who wants to check §118.4 needs the number and not a citation.
    expect(CACHE_BLOCK_TOKENS).toBe(64);
  });
});

describe('an artifact with nothing to judge', () => {
  it('reports no pairs and no ratios rather than dividing by zero', () => {
    const arithmetic = batchArithmetic({ rankedFindings: [] }, [], [1, 4]);

    expect(arithmetic.pairs).toBe(0);
    expect(arithmetic.meanSystemCharacters).toBe(0);
    expect(rowAt(arithmetic, 1).calls).toBe(0);
    expect(rowAt(arithmetic, 4).callsRatio).toBeNull();
    expect(rowAt(arithmetic, 4).charactersRatio).toBeNull();
  });
});
