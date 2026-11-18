// A run that fetches a file for the gate still needs somewhere to count the fetch
//
// **The failure this file exists for, and what it cost.** Two dispatches - `pair: falsifier-v3` on 2026-11-18 and
// `pair: falsifier-v4` the same morning - spent 34 and 35 minutes and died at
//
//   `Cannot read properties of undefined (reading 'length')`
//
// The second one printed its frame (`aacr-bench.mjs:3091`) because the first one's cost was the lesson: the line is
// `engineCounters.codeContext.reasons.length < 3`, inside the block that records *why a file could not be fetched*.
//
// **The counters were initialised from `CODE_CONTEXT` and the fetch was gated on `CODE_CONTEXT || NEEDS_FILE_TEXT`.**
// `v3` and `v4` read the file for the gate, so `AACR_CODE_CONTEXT=off` - the arm every published figure was measured
// under, and therefore the arm any contract is compared against - fetched files into counters that were `{ enabled:
// false }` and had no `reasons`, no `read`, no `chars`. **The first page that failed to fetch killed the run**, after
// every pull request before it had already been paid for.
//
// **Why this is a test rather than a comment.** The two conditions are one line apart in the source and eight hundred
// lines apart in the file, and the pair that disagreed produced green dry runs, a green pair of 1-PR probes (a small
// corpus fetched nothing that failed) and two dead dispatches. **A guard whose only witness is a 35-minute run is a guard
// that gets rewritten by the next person who tidies the initialiser.**

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const BENCH = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '.github', 'scripts', 'aacr-bench.mjs'),
  'utf8',
);

describe('the fetch counters and the fetch', () => {
  it('are owned by the same condition, because a fetch with no counter is a throw', () => {
    // The initialiser must not be reachable from `CODE_CONTEXT` alone while the fetch is reachable from either.
    expect(BENCH).toMatch(/codeContext:\s*\n?\s*CODE_CONTEXT \|\| NEEDS_FILE_TEXT/);
    expect(BENCH).toMatch(/if \(CODE_CONTEXT \|\| NEEDS_FILE_TEXT\) \{/);
  });

  it('still says whether the window was on, because that is the arm a figure is compared by', () => {
    expect(BENCH).toMatch(/enabled: CODE_CONTEXT,/);
  });

  it('gives each gate contract the fetch it needs, so the two conditions cannot drift', () => {
    // **Both halves named separately**, because the assignment is long enough that the formatter breaks it and a regex
    // written against one line would pass on a file where the second contract had been dropped from the line.
    expect(BENCH).toMatch(/NEEDS_FILE_TEXT =/);
    expect(BENCH).toContain("FALSIFY === 'independent-evidence-v3'");
    expect(BENCH).toContain("FALSIFY === 'independent-evidence-v4'");
  });
});
