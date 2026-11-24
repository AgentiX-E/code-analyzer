/**
 * **§150 turned two rules into two numbers, and a number that is not asserted is a number nobody checks.**
 *
 * The gate now deletes on three decidable facts - the path is gone, the range is not in the file, the quotation is not in
 * the file or the change - and **counts** two others: a name the comment mentions that occurs nowhere in the evidence, and a
 * quotation it could not read verbatim. The reason is in `docs/EVAL-CONTRACT.md` §150: the name check selected wrong
 * comments at the rate the list already contains them, so it could not be a filter.
 *
 * The cases here are the ones a count can be wrong about:
 *
 * - **a counted finding is still posted**, because a count that quietly deleted would be the old device with a new name;
 * - **the bucket the count reads** - nothing, in the lines cited, elsewhere in the file, only in the change, nowhere -
 *   because that distribution is the argument for having demoted it;
 * - **an unpostable path**, which is dropped but must not withhold the pull request: §149.5's rule, priced on the row it
 *   was applied to.
 */
import { describe, expect, it } from 'vitest';

import { decideGrounding } from '../../../packages/intelligence/src/review/grounding-gate.js';
import { anchorsOf, replayGroundingGate } from '../../../scripts/lib/gate-replay.mjs';

const PR = 'https://github.com/owner/alpha/pull/1';
const FILE = [
  'const alpha = 1;',
  'const beta = 2;',
  'const gamma = 3;',
  'const delta = 4;',
  '',
].join('\n');

const row = (text: string, over: { startLine?: number; [key: string]: unknown } = {}) => ({
  pr: PR,
  path: 'a.ts',
  startLine: over.startLine ?? 1,
  // **`endLine` follows `startLine` unless the case says otherwise**, because a fixture whose range is inverted is
  // dropped by the range check and every assertion below would then be about a finding the gate convicted for the wrong
  // reason - which is how the first version of this file passed the wrong things.
  endLine: over.startLine ?? 1,
  text,
  score: 0.5,
  matchedGoldens: [],
  category: 'bug',
  actionable: true,
  ...over,
});

describe('a comment that names something absent is counted and still posted', () => {
  it('counts it, keeps the row, and reports both in the replay', () => {
    const findings = [
      row('`alpha` is read before it is assigned', { matchedGoldens: [0], score: 0.9 }),
      row('`zeta` is never initialised', { startLine: 3, score: 0.8 }),
    ];
    const replay = replayGroundingGate({
      findings,
      goldens: 2,
      steps: [],
      sourcesFor: () => ({ contents: new Map([['a.ts', FILE]]) }),
      decide: decideGrounding,
    });

    expect(replay.gate.namesNowhere).toBe(1);
    // **Both rows are posted**, which is the difference between a filter and a note: the F1 of the gated arm is the F1 of
    // the published one, to the digit.
    expect(replay.gated.emitted).toBe(2);
    expect(replay.gated.truePositives).toBe(1);
    expect(replay.delta.f1).toBe(0);
  });
});

describe('where the names live', () => {
  it('separates the four places a name can be, and the one where it cannot', () => {
    const findings = [
      row('this names nothing'),
      // **On the line it cites**, which is the only bucket a reviewer would call well-anchored.
      row('`alpha` is read before it is assigned', { startLine: 1 }),
      // **Cited at line 2, declared at line 4**: found by the file, not by the region.
      row('`delta` is wrong', { startLine: 2 }),
      // **Declared only by the change**, which is the bucket §149.3 added.
      row('`zeta` is wrong', { startLine: 2 }),
      // **Nowhere at all**, which is the bucket the retired filter would have convicted.
      row('`omega` is wrong', { startLine: 2 }),
    ];
    const anchors = anchorsOf(findings, () => ({
      contents: new Map([['a.ts', FILE]]),
      change: '+  return zeta;',
    }));

    expect(anchors).toMatchObject({
      findings: 5,
      readable: 5,
      noName: 1,
      inRange: 1,
      inFile: 1,
      inChange: 1,
      nowhere: 1,
    });
    expect(anchors.examples).toEqual([{ pr: PR, path: 'a.ts', line: 2, names: ['omega'] }]);
  });

  it('counts nothing against a file the replay could not read', () => {
    // **A distribution over the files that were read**, so an unread one is a gap rather than a row of zeroes: a comment
    // whose file is missing was not measured, and reporting it as "names nothing" would be a claim about the comment.
    const anchors = anchorsOf([row('`alpha` is wrong', { path: 'gone.ts' })], () => undefined);

    expect(anchors).toMatchObject({ findings: 1, readable: 0, noName: 0, nowhere: 0 });
  });
});

describe('a path the revision does not have', () => {
  it('is dropped as unpostable without withholding the pull request', () => {
    const findings = [
      row('`alpha` is wrong', { score: 0.9 }),
      row('`beta` is gone', { path: 'gone.ts', startLine: 1, score: 0.8 }),
    ];
    const replay = replayGroundingGate({
      findings,
      goldens: 1,
      steps: [],
      sourcesFor: () => ({ contents: new Map([['a.ts', FILE]]), absent: new Set(['gone.ts']) }),
      decide: decideGrounding,
    });

    expect(replay.gate.coverage).toEqual({ offered: 2, readable: 1, unpostable: 1 });
    expect(replay.gate.withheldPullRequests).toBe(0);
    expect(replay.gate.dropped).toBe(1);
    expect(replay.gated.emitted).toBe(1);
  });
});
