/**
 * **The grounding gate's price is arithmetic over a paid artifact, so it has to be asserted and not read off a table.**
 *
 * §147.5 registered the question - *does dropping ungroundable findings buy precision or cost recall* - and §148 removed
 * the obstacle that made it unanswerable. What is left is an instrument, and an instrument whose only exercise is a
 * printed delta is an instrument whose sign is a claim. The cases here are the ones a delta can be wrong about:
 *
 * - **the removal pool**, which is the criterion §75.3 writes and the only reading that separates "deleted the wrong
 *   comments" from "deleted a true positive and bought the same F1";
 * - **the upstream position**, because a filter placed in front of the budget frees a slot the budget refused, and a
 *   replay that filtered the posted set would be pricing a device the product does not have;
 * - **the withholding rule**, which is `decideGrounding`'s and not the replay's: a gate offered a list it could only
 *   partly read must keep all of it, and a replay that dropped the unread rows would be measuring a fetcher;
 * - **the empty pool and the empty list**, where a `0` would read as perfect and a `NaN` would propagate into a table;
 * - **the quotation**, which is the check the artifact could never have exercised (zero of 591 rows carry `existingCode`)
 *   and therefore the one a replay is most likely to invent a meaning for.
 */
import { describe, expect, it } from 'vitest';

import { decideGrounding } from '../../../packages/intelligence/src/review/grounding-gate.js';
import {
  groundableRow,
  replayGroundingGate,
  requiredSources,
} from '../../../scripts/lib/gate-replay.mjs';
import { pullRequestOfUrl, splitUnifiedDiff } from '../../../scripts/gate-replay.mjs';

const PR_A = 'https://github.com/owner/alpha/pull/1';
const PR_B = 'https://github.com/owner/beta/pull/2';

/** A row as the artifact writes one: the gate's four fields plus the ones the cut reads. */
const row = (input: {
  pr: string;
  path: string;
  startLine: number;
  endLine?: number;
  text: string;
  score?: number;
  matchedGoldens?: number[];
  category?: string;
  existingCode?: string;
}) => ({
  pr: input.pr,
  path: input.path,
  startLine: input.startLine,
  endLine: input.endLine ?? input.startLine,
  text: input.text,
  score: input.score ?? 0.5,
  matchedGoldens: input.matchedGoldens ?? [],
  category: input.category ?? 'bug',
  // **The artifact's own flag**, because the shipped cut's first step reads it: a fixture without it would be a corpus
  // on which the policy posts nothing, and every assertion below would be about the empty set.
  actionable: true,
  ...(input.existingCode === undefined ? {} : { existingCode: input.existingCode }),
});

const ALPHA = 'const alpha = 1;\nconst beta = 2;\nconst gamma = 3;\nconst delta = 4;\n';

/** The shipped shape: one category drop, one path-class drop, one budget. */
const STEPS = [{ kind: 'gate' }, { kind: 'budget', k: 12 }];

describe('the gate is priced on the removals it made from what was posted', () => {
  it('counts a dropped false positive as a precision gain with no golden lost', () => {
    const findings = [
      row({ pr: PR_A, path: 'a.ts', startLine: 1, text: 'names `alpha`', score: 0.9, matchedGoldens: [0] }),
      // **The identifier is not in the file**, which is the one check the gate can decide without a model and the one
      // §147.5 exists to price: a finding about a name that occurs nowhere is a finding about nothing.
      row({ pr: PR_A, path: 'a.ts', startLine: 4, text: 'names `zeta`', score: 0.8 }),
    ];
    const replay = replayGroundingGate({
      findings,
      goldens: 3,
      steps: [{ kind: 'budget', k: 12 }],
      sourcesFor: () => ({ contents: new Map([['a.ts', ALPHA]]) }),
      decide: decideGrounding,
    });

    expect(replay.baseline.emitted).toBe(2);
    expect(replay.baseline.truePositives).toBe(1);
    expect(replay.gated.emitted).toBe(1);
    expect(replay.gated.precision).toBe(1);
    expect(replay.removals).toEqual({ posted: 1, truePositives: 0, share: 0 });
    expect(replay.goldens.lost).toEqual([]);
    expect(replay.delta.f1).toBeGreaterThan(0);
  });

  it('counts a dropped true positive as a lost golden rather than as a pooled metric', () => {
    const findings = [
      row({
        pr: PR_A,
        path: 'a.ts',
        startLine: 1,
        text: 'names `alpha`',
        score: 0.9,
        matchedGoldens: [0],
        // **A quotation the file does not contain** - the check that only fires when a finding offers one, which is why
        // the empty case is a separate assertion below.
        existingCode: 'const omega = 5;',
      }),
      row({ pr: PR_A, path: 'a.ts', startLine: 4, text: 'names `delta`', score: 0.8 }),
    ];
    const replay = replayGroundingGate({
      findings,
      goldens: 3,
      steps: [{ kind: 'budget', k: 12 }],
      sourcesFor: () => ({ contents: new Map([['a.ts', ALPHA]]) }),
      decide: decideGrounding,
    });

    expect(replay.removals).toEqual({ posted: 1, truePositives: 1, share: 1 });
    expect(replay.goldens.lost).toEqual([`${PR_A}\u00000`]);
    expect(replay.gated.truePositives).toBe(0);
    expect(replay.delta.f1).toBeLessThan(0);
  });

  it('admits a finding the budget refused when the gate removes one ranked above it', () => {
    const findings = [
      // **Out of range for a four-line file**, so the gate drops it and the budget's single slot moves down the ranking.
      row({ pr: PR_A, path: 'a.ts', startLine: 9, text: 'names `alpha`', score: 0.9, matchedGoldens: [0] }),
      row({ pr: PR_A, path: 'a.ts', startLine: 4, text: 'names `delta`', score: 0.8, matchedGoldens: [1] }),
    ];
    const replay = replayGroundingGate({
      findings,
      goldens: 3,
      steps: [{ kind: 'budget', k: 1 }],
      sourcesFor: () => ({ contents: new Map([['a.ts', ALPHA]]) }),
      decide: decideGrounding,
    });

    expect(replay.baseline.emitted).toBe(1);
    expect(replay.baseline.truePositives).toBe(1);
    // **The device is not a pure loss here**, and the reason is the position rather than the rule: the budget it freed is
    // spent on the next finding, which is also true. A replay that filtered the posted set would report `1 → 0`.
    expect(replay.admitted).toEqual({ posted: 1, truePositives: 1 });
    expect(replay.gated.truePositives).toBe(1);
    expect(replay.delta.emitted).toBe(0);
    expect(replay.removals.posted).toBe(1);
    expect(replay.removals.truePositives).toBe(1);
  });
});

describe('a gate that could only read part of the list deletes nothing from it', () => {
  it('keeps every row of a pull request it could not read, and says how many it withheld', () => {
    const findings = [
      row({ pr: PR_A, path: 'a.ts', startLine: 4, text: 'names `zeta`', score: 0.9 }),
      row({ pr: PR_B, path: 'b.ts', startLine: 4, text: 'names `zeta`', score: 0.9 }),
    ];
    const replay = replayGroundingGate({
      findings,
      goldens: 2,
      steps: [],
      sourcesFor: (pullRequest) =>
        pullRequest === PR_A ? { contents: new Map([['a.ts', ALPHA]]) } : undefined,
      decide: decideGrounding,
    });

    expect(replay.gate.dropped).toBe(1);
    expect(replay.gate.withheldPullRequests).toBe(1);
    expect(replay.gate.coverage).toEqual({ offered: 2, readable: 1 });
    // **The withheld pull request keeps its finding**, so the gate's effect is the readable one's alone.
    expect(replay.gated.emitted).toBe(1);
    expect(replay.gate.decisions.map((entry) => [entry.pr, entry.applied])).toEqual([
      [PR_A, true],
      [PR_B, false],
    ]);
    expect(replay.gate.decisions[1]?.withheld).toBe('no-readable-arm');
  });
});

describe('the empty cases report a state rather than a number', () => {
  it('reports a null pool share when the gate removed nothing', () => {
    const findings = [
      row({ pr: PR_A, path: 'a.ts', startLine: 1, text: 'names `alpha`', matchedGoldens: [0] }),
    ];
    const replay = replayGroundingGate({
      findings,
      goldens: 1,
      steps: [],
      sourcesFor: () => ({ contents: new Map([['a.ts', ALPHA]]) }),
      decide: decideGrounding,
    });

    expect(replay.removals).toEqual({ posted: 0, truePositives: 0, share: null });
    expect(replay.delta.f1).toBe(0);
    expect(Number.isNaN(replay.gated.f1)).toBe(false);
  });

  it('scores an empty list as zero rather than as NaN', () => {
    const replay = replayGroundingGate({
      findings: [],
      goldens: 0,
      steps: [],
      sourcesFor: () => ({ contents: new Map() }),
      decide: decideGrounding,
    });

    expect(replay.baseline).toMatchObject({ emitted: 0, truePositives: 0, f1: 0 });
    expect(replay.gate.coverage).toEqual({ offered: 0, readable: 0 });
    expect(replay.reproduced).toBeNull();
  });
});

describe('the figure the replay starts from is the figure the artifact published', () => {
  it('says so when the two agree and says so when they do not', () => {
    const findings = [
      row({ pr: PR_A, path: 'a.ts', startLine: 1, text: 'names `alpha`', matchedGoldens: [0] }),
      row({ pr: PR_A, path: 'a.ts', startLine: 2, text: 'names `beta`' }),
    ];
    const shared = {
      findings,
      goldens: 4,
      steps: STEPS,
      sourcesFor: () => ({ contents: new Map([['a.ts', ALPHA]]) }),
      decide: decideGrounding,
    };

    const agreed = replayGroundingGate({
      ...shared,
      published: { k: 2, truePositives: 1, f1: 2 / 6 },
    });
    expect(agreed.reproduced).toBe(true);

    // **A count that does not match is the failure this field exists for**, and it is reported beside both points rather
    // than as a delta: an instrument replaying a different run produces a difference about runs, not about devices.
    const disagreed = replayGroundingGate({
      ...shared,
      published: { k: 3, truePositives: 1, f1: 0.5 },
    });
    expect(disagreed.reproduced).toBe(false);
    expect(disagreed.baseline.emitted).toBe(2);
  });
});

describe('the quotation is read when it is offered and its absence is not evidence', () => {
  it('keeps a finding that offers no quotation and drops one whose quotation is absent', () => {
    const withQuote = groundableRow(
      row({ pr: PR_A, path: 'a.ts', startLine: 1, text: 'about nothing', existingCode: 'const alpha = 1;' }),
    );
    const withFabricatedQuote = groundableRow(
      row({ pr: PR_A, path: 'a.ts', startLine: 1, text: 'about nothing', existingCode: 'const omega = 5;' }),
    );
    const withoutQuote = groundableRow(
      row({ pr: PR_A, path: 'a.ts', startLine: 1, text: 'about nothing' }),
    );

    expect(withQuote['existingCode']).toBe('const alpha = 1;');
    // **Absent rather than `''`**, because the judge asks "is the quotation there" of a field that exists and keeps a
    // finding that offers none: an empty string would be a quotation that is present nowhere.
    expect('existingCode' in withoutQuote).toBe(false);

    const sources = { contents: new Map([['a.ts', ALPHA]]) };
    expect(decideGrounding([withQuote], sources.contents).applied).toBe(true);
    expect(decideGrounding([withQuote], sources.contents).report.ungrounded).toEqual([]);
    expect(decideGrounding([withFabricatedQuote], sources.contents).report.ungrounded).toHaveLength(1);
    expect(decideGrounding([withoutQuote], sources.contents).report.ungrounded).toEqual([]);
  });

  it('reads a paraphrase as a paraphrase and counts it instead of dropping it', () => {
    const paraphrased = groundableRow(
      row({
        pr: PR_A,
        path: 'a.ts',
        startLine: 1,
        text: 'names `alpha`',
        existingCode: 'const alpha = 1; ... const delta = 4;',
      }),
    );
    const decision = decideGrounding([paraphrased], new Map([['a.ts', ALPHA]]));

    expect(decision.report.ungrounded).toEqual([]);
    expect(decision.report.unverifiableQuotes).toBe(1);
  });
});

describe('the fetch list is one set per pull request', () => {
  it('never merges a path two pull requests read at different revisions', () => {
    const required = requiredSources([
      row({ pr: PR_A, path: 'src/a.ts', startLine: 1, text: '' }),
      row({ pr: PR_A, path: 'src/a.ts', startLine: 2, text: '' }),
      row({ pr: PR_B, path: 'src/a.ts', startLine: 1, text: '' }),
      row({ pr: PR_B, path: 'other.ts', startLine: 1, text: '' }),
    ]);

    expect([...required.get(PR_A) ?? []]).toEqual(['src/a.ts']);
    expect([...required.get(PR_B) ?? []].sort()).toEqual(['other.ts', 'src/a.ts']);
  });
});

describe('a unified diff is cut by the paths it names', () => {
  it('keys both sides of a rename and keeps the whole section', () => {
    const diff = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 90%',
      'rename from old.ts',
      'rename to new.ts',
      '--- a/old.ts',
      '+++ b/new.ts',
      '@@ -1,1 +1,1 @@',
      '-const a = 1;',
      '+const a = 2;',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-const gone = 1;',
    ].join('\n');

    const sections = splitUnifiedDiff(diff);

    expect([...sections.keys()]).toEqual(['old.ts', 'new.ts', 'gone.ts']);
    // **The removed line is in the section**, because a quotation can come from a removed line and a split that kept the
    // added ones only would answer "no" to a true statement.
    expect(sections.get('new.ts')).toContain('+const a = 2;');
    expect(sections.get('new.ts')).toContain('-const a = 1;');
    expect(sections.get('gone.ts')).toContain('-const gone = 1;');
  });

  it('returns nothing for a diff that is not one', () => {
    expect(splitUnifiedDiff('').size).toBe(0);
    expect(splitUnifiedDiff(undefined).size).toBe(0);
  });
});

describe('a pull request URL is the only identity the corpus guarantees', () => {
  it('reads owner, repository and number, and refuses what is not a pull request', () => {
    expect(pullRequestOfUrl('https://github.com/FreeCAD/FreeCAD/pull/19411')).toEqual({
      owner: 'FreeCAD',
      repo: 'FreeCAD',
      number: 19411,
    });
    expect(pullRequestOfUrl('https://github.com/FreeCAD/FreeCAD/issues/1')).toBeNull();
    expect(pullRequestOfUrl(undefined)).toBeNull();
  });
});
