// **A mode whose entire purpose is to remove an arm must not run it, and this file is what says so in the source.**
//
// The `on` arm of the run of 2026-11-12 published `secondReviewer.mode: "off"` beside `prsAttempted: 36` and 258
// competitor rows. The decision chain in `.github/scripts/aacr-bench.mjs` handled `replay`, `missing` and `record`
// without a credential, and **every other decision arrived at `else if (ocrKey)`** - so `off`, the one answer that means
// *this run has no competitor*, ran the competitor on all thirty-six pull requests and spent the money.
//
// **The artifact audit found it**, because it divided the rows by the corpus and got `5 accounted for of 36`. That is the
// right place to find a contradictory artifact and the wrong place to find out that a switch does not switch anything:
// the run had already paid. **So the source is held here**, with the two properties that make the branch unreachable:
// the `off` decision is handled first, and no path from it reaches the live call.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '.github', 'scripts', 'aacr-bench.mjs'),
  'utf8',
);

/** The decision chain over one pull request: from the resolver's answer to the last branch that acts on it. */
function decisionChain(): string {
  const start = SOURCE.indexOf('const competitorDecision = resolveCompetitor({');
  expect(start).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('competitor.prsFailed += 1;', start);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe('the competitor arm that is switched off', () => {
  it('is decided before the branches that act on a decision', () => {
    const chain = decisionChain();
    const offAt = chain.indexOf("competitorDecision.kind === 'off'");
    const replayAt = chain.indexOf("competitorDecision.kind === 'replay'");
    const liveAt = chain.indexOf('reviewWithOcr(');
    expect(offAt).toBeGreaterThan(-1);
    // **First, because a branch placed after the live one is a branch that never runs**: the chain is an `if`/`else if`
    // ladder, so the position is the semantics.
    expect(offAt).toBeLessThan(replayAt);
    expect(offAt).toBeLessThan(liveAt);
  });

  it('reaches no call to the competitor', () => {
    // **The property that makes the branch empty rather than merely present.** A branch that is reached first and then
    // calls the tool is the bug with a comment in front of it.
    const chain = decisionChain();
    const offAt = chain.indexOf("competitorDecision.kind === 'off'");
    const nextBranch = chain.indexOf("competitorDecision.kind === 'replay'", offAt);
    const body = chain.slice(offAt, nextBranch);
    expect(body).not.toContain('reviewWithOcr');
    expect(body).not.toContain('competitorPerPr.push');
    // **And it is not a `continue`**, which would skip this pull request's own review as well - the arm that is off is
    // one reviewer's absence, not the other's.
    expect(body).not.toContain('continue;');
  });

  it('still runs the arm when the decision is to record and a credential is configured', () => {
    const chain = decisionChain();
    // **The code form, brace included.** The first version of this expectation searched for `else if (ocrKey)` and found
    // it inside the comment that explains the defect, two hundred characters before the branch itself - so it compared
    // the record branch against prose. **A grep that matches the discussion of a branch is not a check on the branch.**
    const liveAt = chain.indexOf('} else if (ocrKey)');
    expect(liveAt).toBeGreaterThan(-1);
    // **The other half of the fix**: the ladder must still reach the live branch for `record`, or the repair would have
    // removed the arm it was meant to leave alone.
    expect(chain.indexOf("competitorDecision.kind === 'record' && !ocrKey")).toBeLessThan(liveAt);
  });
});
