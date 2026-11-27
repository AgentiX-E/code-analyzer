// **A pull request whose commits no longer exist is not a pull request the competitor read and found nothing in.**
//
// `§177` priced the collapse on the fifty-pull-request slice. `ComfyUI#7952` and `ComfyUI#9560` name commits the remote
// does not hold, so the competitor's harness fails at `git` before it reviews anything:
//
//     fatal: remote error: upload-pack: not our ref 4936d01872b8719ede33f9a11dc8e898c33d39e4
//
// The harness filed a **scored row with zero findings** for each of them, and eleven goldens entered the competitor's
// denominator as false negatives: the run published recall `0.3673` while `scripts/competitor-cut.mjs` rebuilt `0.3764`
// from the rows it actually held, and the guard refused the pricing rather than print the wrong one.
//
// The three outcomes have three repairs, and the cases below are about telling them apart. **The asymmetry is the point**:
// a `git` message must never be read as a reviewer's result, and a reviewer's crash must never be read as a hole.

import { describe, expect, it } from 'vitest';

import {
  CREDIT_REASON,
  classifyCompetitorFailure,
  failureReason,
} from '../../../scripts/lib/competitor-failure.mjs';

describe('which of the three happened', () => {
  it('reads a range the remote no longer holds as the corpus, not as the reviewer', () => {
    // **The exact text this iteration paid for**, from the run of `45972380798`.
    const observed =
      'fatal: remote error: upload-pack: not our ref 4936d01872b8719ede33f9a11dc8e898c33d39e4';
    expect(classifyCompetitorFailure(observed)).toBe('unreachable');
    // A deleted branch, a shallow mirror that never received the commit, and an argument git cannot resolve.
    expect(classifyCompetitorFailure("fatal: couldn't find remote ref refs/heads/main")).toBe(
      'unreachable',
    );
    expect(classifyCompetitorFailure('fatal: bad object 4936d01')).toBe('unreachable');
    expect(classifyCompetitorFailure("fatal: ambiguous argument 'a...b': unknown revision")).toBe(
      'unreachable',
    );
  });

  it('keeps the provider refusal in its own class, because the repair is the account', () => {
    expect(
      classifyCompetitorFailure(
        'LLM grouping failed (POST "https://api.deepseek.com/anthropic/v1/messages": 402 Payment Required {"error":{"message":"Insufficient Balance"}})',
      ),
    ).toBe('credit');
    // **A refusal that also mentions a range reads as credit**: the range resolved before the call was made.
    expect(
      classifyCompetitorFailure(
        '402 Payment Required while reviewing 3 files: fatal: bad object abc1234',
      ),
    ).toBe('credit');
  });

  it('leaves a crash where it is, because a crash on a readable pull request is a result about the tool', () => {
    expect(classifyCompetitorFailure('TypeError: cannot read properties of undefined')).toBe('ran');
    expect(
      classifyCompetitorFailure("Error: ENOENT: no such file or directory, open 'out.json'"),
    ).toBe('ran');
    expect(classifyCompetitorFailure('')).toBe('ran');
    expect(classifyCompetitorFailure(undefined)).toBe('ran');
  });
});

describe('the sentence the artifact files', () => {
  it('names the corpus for an unreachable range and keeps the raw text', () => {
    const said = failureReason(
      'unreachable',
      'fatal: remote error: upload-pack: not our ref 4936d01',
    );
    expect(said).toContain('the corpus names a range this remote no longer holds');
    expect(said).toContain('not our ref');
  });

  it('keeps the credit sentence byte-identical to the one artifacts already carry', () => {
    // **An artifact written before this file must keep its meaning**, so the prefix is the string the harness published.
    expect(failureReason('credit', '402 Payment Required')).toBe(
      `${CREDIT_REASON}: 402 Payment Required`,
    );
    expect(CREDIT_REASON).toBe('the provider refused the call for want of credit');
  });

  it('says so when a run failed and said nothing, rather than filing an empty reason', () => {
    expect(failureReason('ran', '   ')).toBe('(the tool reported a failure with no message)');
    expect(failureReason('ran', 'boom')).toBe('boom');
  });
});
