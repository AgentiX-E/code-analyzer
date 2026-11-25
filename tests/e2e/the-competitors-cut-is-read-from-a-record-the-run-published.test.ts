// The competitor's cut, read end to end from the record this repository committed.
//
// **This is the user story S40 was registered for.** §159.4 claimed the first reading above the bar and stated in the same
// paragraph that it does not establish the comparison a reader will make anyway: *their `0.2991` is their best of three
// readings, at whatever emission their pipeline produces, and their curve has not been priced.* Pricing it is a `$0`
// question - the verdicts were bought on 2026-11-12 and 2026-11-25 - so what was missing was an entry point a
// non-author can run, and the four properties that make its output a reading.
//
// **What makes this an end-to-end test rather than a unit test of the arithmetic.** It drives the real command against the
// committed baseline and the committed corpus - not a fixture - and asserts the four figures §160 publishes, on both
// denominators, plus the guard that rebuilds the figure the recording run printed. **A unit test proves the function;
// this proves the file in the repository is the file those figures came from**, which is the claim a reader is being
// asked to accept without re-deriving it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..');
const BASELINE = 'benchmarks/aacr/competitor-baseline.json';
const CORPUS = 'benchmarks/martian/positive_samples.json';

interface Board {
  profile: string;
  goldens: number;
  pullRequests: { withARow: number; inCorpus: number };
  asShipped: { emitted: number; truePositives: number; precision: number; recall: number; f1: number };
  atOurGate: { emitted: number; truePositives: number; f1: number } | null;
  guard: boolean | null;
}

function price(args: string[]): { out: string; board: Board } {
  const json = join(mkdtempSync(join(tmpdir(), 'competitor-cut-e2e-')), 'board.json');
  const out = execFileSync(
    'node',
    ['scripts/competitor-cut.mjs', '--baseline', BASELINE, '--corpus', CORPUS, '--json', json, ...args],
    { cwd: REPO, encoding: 'utf8' },
  );
  return { out, board: JSON.parse(readFileSync(json, 'utf8')) as Board };
}

describe('the competitor’s cut is read end to end from the committed record', () => {
  it('divides by the corpus’s 173 goldens and rebuilds the figure the recording run printed', () => {
    const { out, board } = price(['--guard', 'P=0.1916,R=0.6821,F1=0.2991']);
    // **Two pull requests of the Martian board have no row**, and their four goldens are still in the denominator: a hole
    // in the pairing is not a zero, and dividing by the 169 the rows hold would read 0.3006 instead of 0.2991.
    expect(board.pullRequests).toEqual({ withARow: 48, inCorpus: 50 });
    expect(board.goldens).toBe(173);
    expect(board.asShipped).toMatchObject({ emitted: 616, truePositives: 118 });
    expect(board.asShipped.f1).toBeCloseTo(0.29911, 4);
    expect(out).toContain('the guard rebuilds P/R/F1 exactly');
  });

  it('prices the second point our own gate makes of their output', () => {
    const { board } = price([]);
    // **`keep` in the record is our actionability gate's verdict on their findings**, not a cut their pipeline chose, so
    // this is the only like-for-like comparison the file supports - and it is the number §159.4 was missing.
    expect(board.atOurGate).toMatchObject({ emitted: 210, truePositives: 68 });
    expect(board.atOurGate?.f1).toBeCloseTo(0.35509, 5);
  });

  it('reads the same rows on the denominator the board scores', () => {
    const { board } = price(['--profile', 'core']);
    expect(board.goldens).toBe(158);
    // **The correction §160.2 publishes**: the competitor's shipped point on the board's own denominator is 0.2817, not
    // the 0.2991 that is divided by 173 - and the difference is larger than the margin §159.4 claimed.
    expect(board.asShipped.f1).toBeCloseTo(0.28165, 5);
    expect(board.atOurGate?.f1).toBeCloseTo(0.34239, 5);
    expect(board.atOurGate?.truePositives).toBe(63);
  });
});
