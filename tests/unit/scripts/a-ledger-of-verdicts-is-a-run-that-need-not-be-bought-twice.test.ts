// **A run that buys 14 892 verdicts and keeps only the matches has bought the arithmetic once and thrown away the
// inputs.**
//
// The artifact of the 2026-11-10 AACR run carries `scoring.pairsJudged: 14892` and `missedGoldens.pullRequests: 50` - a
// count of pairs and a count of pull requests, and not one verdict between them. Every later question about that run
// ("would a semantic join have recognised these?", "what would the corpus's own file-level arithmetic have said?", "how
// many of the rejections were marginal?") is therefore a question that costs another ¥14 to ask, **because the answers
// were computed, priced and then dropped on the floor.**
//
// This file is about the shape that keeps them. Three properties are asserted, and each is a way the saving can fail:
//
// - **the order is in the file**, because a flat string of 14 892 characters with no order is a string that can only be
//   read by the code that wrote it, in the version that wrote it;
// - **"the judge said no" and "the judge did not answer" stay apart**, because folding the second into the first is the
//   defect that turned a rate-limited run into a recall figure;
// - **the cells rebuild the matches**, because a ledger that decodes to something *like* the matches is a ledger that
//   makes every recomputation disagree with the figure it is recomputing.

import { describe, expect, it } from 'vitest';

import {
  VERDICT_LEDGER_VERSION,
  decodeVerdictLedger,
  encodeVerdictLedger,
  matchesFromVerdictLedger,
} from '../../../.github/scripts/aacr-verdict-ledger.mjs';

/**
 * **A value read out of JSON has no type**, and that is the only way a wrong one reaches the encoder. The cast is how the
 * test says "this came off disk": a well-typed call cannot express the defect this guard exists for, so a test that
 * insisted on well-typed arguments could only assert the happy path.
 */
const fromJson = (value: unknown): never => value as never;

/** Three findings against two goldens, written the way `judgeMatrix` produces them: golden-major. */
const fixture = {
  findings: 3,
  goldens: 2,
  // golden 0: finding 0 matches, finding 1 does not, finding 2 did not answer.
  // golden 1: finding 0 does not, finding 1 matches, finding 2 matches.
  verdicts: [true, false, null, false, true, true],
};

describe('a ledger of verdicts is a run that need not be bought twice', () => {
  it('writes one character per pair and names the order it wrote them in', () => {
    const ledger = encodeVerdictLedger(fixture);

    expect(ledger.version).toBe(VERDICT_LEDGER_VERSION);
    expect(ledger.findings).toBe(3);
    expect(ledger.goldens).toBe(2);
    expect(ledger.order).toBe('golden-major');
    expect(ledger.cells).toBe('10?011');
    expect(ledger.cells).toHaveLength(fixture.findings * fixture.goldens);
  });

  it('keeps "the judge said no" and "the judge never answered" as two different answers', () => {
    const decoded = decodeVerdictLedger(encodeVerdictLedger(fixture));

    expect(decoded.verdicts[1]).toBe(false);
    expect(decoded.verdicts[2]).toBeNull();
    // **The pair the artifact lost.** A `false` here is a sentence about the reviewer; a `null` is a sentence about the
    // job, and the run of 2026-11-10 recorded both as the same thing.
    expect(decoded.verdicts[1]).not.toBe(decoded.verdicts[2]);
  });

  it('rebuilds the matches a run reported, from the cells alone', () => {
    const decoded = decodeVerdictLedger(encodeVerdictLedger(fixture));

    expect(matchesFromVerdictLedger(decoded)).toEqual([[0], [1], [1]]);
  });

  it('treats a pair the run never reached as unanswered rather than as a non-match', () => {
    // **A hole is not a no.** `judgeMatrix` counts `undefined` as unanswered for the same reason, and a ledger that
    // encoded the hole as `0` would make every recomputation quietly more lenient than the run.
    const decoded = decodeVerdictLedger(
      encodeVerdictLedger({ findings: 2, goldens: 1, verdicts: [undefined, undefined] }),
    );

    expect(decoded.verdicts).toEqual([null, null]);
    expect(matchesFromVerdictLedger(decoded)).toEqual([[], []]);
  });

  it('refuses a ledger whose cells do not cover the matrix it claims', () => {
    // The one defect that makes a ledger dangerous rather than missing: a short string decodes to a matrix with a
    // silently absent corner, and every figure recomputed from it is a figure about fewer pairs than it says.
    expect(() =>
      decodeVerdictLedger({
        version: VERDICT_LEDGER_VERSION,
        order: 'golden-major',
        findings: 3,
        goldens: 2,
        cells: '10?0',
      }),
    ).toThrow(/4 cells .* 3 findings .* 2 goldens/);
  });

  it('refuses a cell that is not one of the three answers', () => {
    expect(() =>
      decodeVerdictLedger({
        version: VERDICT_LEDGER_VERSION,
        order: 'golden-major',
        findings: 1,
        goldens: 2,
        cells: '1x',
      }),
    ).toThrow(/not a verdict/);
  });

  it('refuses to encode a value that only looks like an answer', () => {
    // **`1` is not `true`.** A truthy value encoded as a match would be a `Boolean()` that nobody wrote, and the same
    // coercion in a decoder turns a count of pairs into a count of matches.
    expect(() => encodeVerdictLedger({ findings: 1, goldens: 1, verdicts: [fromJson(1)] })).toThrow(
      /is not a verdict/,
    );
    expect(() =>
      encodeVerdictLedger({ findings: 1, goldens: 1, verdicts: [fromJson('yes')] }),
    ).toThrow(/is not a verdict/);
  });

  it('refuses to encode a list that is not the matrix it is labelled', () => {
    expect(() => encodeVerdictLedger({ findings: 2, goldens: 2, verdicts: [true, false] })).toThrow(
      /2 verdicts .*4 pairs/,
    );
    expect(() =>
      encodeVerdictLedger({ findings: 1, goldens: 1, verdicts: fromJson('true') }),
    ).toThrow(/must be an array/);
  });

  it('refuses to read a ledger that is not an object, or cells that are not a string', () => {
    expect(() => decodeVerdictLedger(null)).toThrow(/is an object/);
    expect(() =>
      decodeVerdictLedger({
        version: VERDICT_LEDGER_VERSION,
        order: 'golden-major',
        findings: 1,
        goldens: 1,
        cells: 1,
      }),
    ).toThrow(/must be a string/);
  });

  it('refuses a coordinate that is not a count', () => {
    expect(() =>
      decodeVerdictLedger({
        version: VERDICT_LEDGER_VERSION,
        order: 'golden-major',
        findings: -1,
        goldens: 1,
        cells: '',
      }),
    ).toThrow(/findings must be a non-negative integer/);
  });

  it('refuses a ledger written by another version of this file', () => {
    // **A version that is not read is worse than a version that is absent**, because the absent one asks to be run and
    // the unreadable one looks like an answer.
    expect(() =>
      decodeVerdictLedger({
        version: VERDICT_LEDGER_VERSION + 1,
        order: 'golden-major',
        findings: 1,
        goldens: 1,
        cells: '1',
      }),
    ).toThrow(/version/);
  });
});
