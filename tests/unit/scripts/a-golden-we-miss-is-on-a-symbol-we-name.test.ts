// **The arithmetic behind "we named the symbol and said something else", held to a fixture small enough to check by eye.**
//
// The reading this module produces is the one that decides the next device, so the ways it could be wrong are the ways a
// reader could be persuaded of a device that does not exist:
//
//   1. **A symbol that is contained rather than named** - `id` "appearing" inside `groupId` would make every golden
//      adjacent to everything, and the count would be a count of substrings.
//   2. **A frequency counted over findings rather than over pull requests** - a lane that repeats `data` nine times on
//      one pull request would make the word look common and the name look rare.
//   3. **A credit counted twice.** Two findings that both claim one golden are one credit in the protocol; a union of
//      `matchedGoldens` says two.
//   4. **A null that moves between two runs** - a record that cannot be reproduced cannot be gated, which is why the
//      permutation is seeded rather than random.
//   5. **A rewrite that quietly adds a comment.** Additive and replacement are different sentences about one device, and a
//      fixture where the finding already holds a credit is the only one that tells them apart.

import { describe, expect, it } from 'vitest';

import {
  adjacency,
  baseRate,
  conversionCurve,
  conversionsNeeded,
  creditSets,
  documentFrequency,
  firstClearing,
  identifiersOf,
  namesSymbol,
  permutationNull,
  ranksOf,
  rewriteOracle,
  specificSymbols,
  splitKey,
  wrongPullRequest,
} from '../../../scripts/lib/symbol-anatomy.mjs';
import type { Pool, PoolRow } from '../../../scripts/lib/symbol-anatomy.mjs';

/** A pool in the shape the instrument passes around: pull request to rows, each with the index it came from. */
function pool(entries: Record<string, PoolRow[]>): Pool {
  const out: Pool = new Map();
  let at = 0;
  for (const [pullRequest, rows] of Object.entries(entries)) {
    out.set(
      pullRequest,
      rows.map((row) => ({ at: at++, row })),
    );
  }
  return out;
}

const PR_A = 'https://github.com/o/r/pull/1';
const PR_B = 'https://github.com/o/r/pull/2';

describe('the tokenizer', () => {
  it('keeps identifiers and drops everything shorter than four characters', () => {
    expect(identifiersOf('the `id` of `groupId` and id')).toEqual(['groupId']);
    expect(identifiersOf('refreshOAuthTokens is passed credentialId')).toEqual([
      'refreshOAuthTokens',
      'passed',
      'credentialId',
    ]);
  });

  it('treats a name as named and not as contained', () => {
    // **The failure this prevents is the whole reading.** `id` inside `groupId` would make every sentence about a
    // changing id adjacent to every comment that mentions a group, and the count would measure substrings of English.
    expect(namesSymbol('the groupId is read', 'id')).toBe(false);
    expect(namesSymbol('the id is read', 'id')).toBe(true);
    expect(namesSymbol('never (id) here', 'id')).toBe(true);
  });

  it('counts document frequency over pull requests rather than over findings', () => {
    const frequency = documentFrequency(
      pool({
        [PR_A]: [{ text: 'data data data refreshOAuthTokens' }, { text: 'data again' }],
        [PR_B]: [{ text: 'data' }],
      }),
    );
    // Three findings name `data` but only two pull requests do, which is what makes it a word rather than a name.
    expect(frequency.get('data')).toBe(2);
    expect(frequency.get('refreshOAuthTokens')).toBe(1);
  });

  it('keeps only the tokens the board names in at most `cap` pull requests', () => {
    const frequency = documentFrequency(
      pool({ [PR_A]: [{ text: 'data refreshOAuthTokens' }], [PR_B]: [{ text: 'data' }] }),
    );
    expect(specificSymbols('data refreshOAuthTokens', frequency, 1)).toEqual([
      'refreshOAuthTokens',
    ]);
    expect(specificSymbols('data refreshOAuthTokens', frequency, 2)).toEqual([
      'data',
      'refreshOAuthTokens',
    ]);
  });
});

describe('the set difference', () => {
  const maps = new Map([
    [
      PR_A,
      new Map([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ],
    [PR_B, new Map([[0, 0]])],
  ]);
  const creditOf = (finding: { profileGoldens?: number[] }) => finding.profileGoldens ?? [];

  it('counts one credit where two findings claim the same golden', () => {
    const ours = [
      { pr: PR_A, profileGoldens: [0] },
      { pr: PR_A, profileGoldens: [0] },
    ];
    const sets = creditSets({ ours, theirs: {}, maps, creditOf });
    expect(sets.ours.size).toBe(1);
  });

  it('takes the reference under the same profile, and drops what the profile dropped', () => {
    const ours = [{ pr: PR_A, profileGoldens: [0] }];
    const theirs = {
      [PR_A]: { detail: [{ matchedGoldens: [1, 2] }, { matchedGoldens: [7] }] },
      [PR_B]: { detail: [{ matchedGoldens: [0] }] },
    };
    const sets = creditSets({ ours, theirs, maps, creditOf });
    // Golden 7 is outside the profile map for PR_A, and the pull request it belongs to is not one this arm covered.
    expect(sets.theirs.size).toBe(3);
    expect(sets.shared).toBe(0);
    // All three are outside this arm's credit: two goldens of the pull request it covered and one of the pull request it
    // did not - because `theirs` is read from the reference's own rows and not from ours.
    expect(sets.onlyTheirs).toEqual([`${PR_A}\u00001`, `${PR_A}\u00002`, `${PR_B}\u00000`].sort());
  });

  it('refuses a reference that shares nothing, because that difference is the arm itself', () => {
    expect(() => creditSets({ ours: [], theirs: null, maps, creditOf })).toThrow(
      /no pull requests/u,
    );
    expect(() => creditSets({ ours: null, theirs: {}, maps, creditOf })).toThrow(/no findings/u);
  });
});

describe('the adjacency and its controls', () => {
  const goldens = [
    {
      key: `${PR_A}\u00000`,
      note: 'refreshOAuthTokens is passed credentialId',
      symbols: ['refreshOAuthTokens'],
    },
    { key: `${PR_B}\u00000`, note: 'nothing here', symbols: [] },
  ];
  const withoutSymbols = goldens.map((golden) => ({ ...golden, symbols: [] }));

  it('points at the rows that name a symbol, by their index rather than their content', () => {
    const found = adjacency({
      goldens: withoutSymbols.map((golden, at) => ({
        ...golden,
        symbols: goldens[at]?.symbols ?? [],
      })),
      poolByPullRequest: pool({
        [PR_A]: [
          { text: 'the dependency is shared' },
          { text: 'refreshOAuthTokens takes a userId' },
        ],
        [PR_B]: [{ text: 'nothing' }],
      }),
    });
    expect(found[0]!.matches).toEqual([1]);
    expect(found[1]!.matches).toEqual([]);
  });

  it('produces the same null twice from one seed and a different one from another', () => {
    const found = adjacency({
      goldens: withoutSymbols.map((golden, at) => ({
        ...golden,
        symbols: goldens[at]?.symbols ?? [],
      })),
      poolByPullRequest: pool({
        [PR_A]: [{ text: 'refreshOAuthTokens' }],
        [PR_B]: [{ text: 'nothing' }],
      }),
    });
    const once = permutationNull({
      goldens: found,
      poolByPullRequest: pool({
        [PR_A]: [{ text: 'refreshOAuthTokens' }],
        [PR_B]: [{ text: 'nothing' }],
      }),
      permutations: 30,
      seed: 7,
    });
    const twice = permutationNull({
      goldens: found,
      poolByPullRequest: pool({
        [PR_A]: [{ text: 'refreshOAuthTokens' }],
        [PR_B]: [{ text: 'nothing' }],
      }),
      permutations: 30,
      seed: 7,
    });
    expect(twice).toEqual(once);
    expect(once.permutations).toBe(30);
    expect(once.p95).toBeLessThanOrEqual(once.max);
  });

  it('measures the rate outside the set by the same rule', () => {
    const rate = baseRate({
      goldens: [
        { key: `${PR_A}\u00001`, symbols: ['credentialId'] },
        { key: `${PR_A}\u00002`, symbols: ['nothingAtAll'] },
        { key: `${PR_A}\u00003`, symbols: [] },
      ],
      poolByPullRequest: pool({ [PR_A]: [{ text: 'credentialId is read' }] }),
    });
    // **The golden with no symbol is counted in the denominator and not in the numerator**, so the rate is not inflated
    // by the goldens this rule cannot speak about.
    expect(rate).toEqual({ goldens: 3, withSymbols: 2, adjacent: 1 });
  });

  it('runs the same symbols against a pool that never saw the diff', () => {
    const control = wrongPullRequest({
      goldens: [{ key: `${PR_A}\u00000`, symbols: ['credentialId'] }],
      poolByPullRequest: pool({
        [PR_A]: [{ text: 'credentialId is read' }],
        [PR_B]: [{ text: 'nothing' }],
      }),
      repositoryOf: () => 'o/r',
    });
    expect(control).toEqual({ adjacent: 0, uncontrolled: 0 });
  });

  it('splits a golden key into the two halves of its identity', () => {
    expect(splitKey(`${PR_A}\u00003`)).toEqual([PR_A, 3]);
  });
});

describe('the prize', () => {
  const rows = [
    { pr: PR_A, score: 0.9, profileGoldens: [0] },
    { pr: PR_A, score: 0.5, profileGoldens: [] },
  ];
  const creditOf = (finding: { profileGoldens?: number[] }) => finding.profileGoldens ?? [];
  const plan = [{ golden: 1, findingAt: 0 }];

  it('adds the credit beside the one the comment already holds', () => {
    const oracle = rewriteOracle({ rows, creditOf, goldens: 3, steps: [], budget: 5, plan });
    expect(oracle.converted).toBe(1);
    expect(oracle.findings).toBe(1);
    // **A one-to-one matching can only buy one golden per finding**, so the additive reading reaches 1 and not 2 - which
    // is the reason a conversion is not a credit and the reason the record carries a curve.
    expect(oracle.additive.ceiling).toBe(1);
  });

  it('moves the credit with the sentence when the sentence is replaced', () => {
    const replacement = rewriteOracle({
      rows: [{ pr: PR_A, score: 0.9, profileGoldens: [] }, rows[1]!],
      creditOf,
      goldens: 3,
      steps: [],
      budget: 5,
      plan,
    });
    expect(replacement.replacement.ceiling).toBe(1);
  });

  it('translates an F1 bar into the two conversion counts, which are not the same number', () => {
    // The published arm: 227 comments, 62 credited, 158 goldens, and a bar of 0.3735.
    expect(
      conversionsNeeded({ truePositives: 62, emitted: 227, goldens: 158, target: 0.3735 }),
    ).toEqual({
      replacement: 10,
      additive: 13,
    });
  });

  it('prices the curve in the order a verifier would apply it, and names the prefix that clears', () => {
    const curve = conversionCurve({
      rows: [
        { pr: PR_A, score: 0.9, profileGoldens: [] },
        { pr: PR_A, score: 0.8, profileGoldens: [] },
      ],
      creditOf,
      goldens: 2,
      steps: [],
      budget: 5,
      plan: [
        { golden: 0, findingAt: 0 },
        { golden: 1, findingAt: 1 },
      ],
      points: 2,
    });
    expect(curve.map((point: { converted: number }) => point.converted)).toEqual([1, 2]);
    expect(curve[1]!.credited).toBeGreaterThanOrEqual(curve[0]!.credited);
    // Two comments, two goldens, two credits is F1 1.0, so only a target above 1.0 has no clearing prefix.
    expect(firstClearing(curve, 1.0001)).toBeNull();
    expect(firstClearing(curve, 0.5)).toBe(1);
  });

  it('ranks a planned comment inside its own pull request after the cut', () => {
    const ranks = ranksOf({
      plan,
      rows,
      steps: [{ kind: 'drop', categories: ['test'] }],
      poolByPullRequest: pool({ [PR_A]: [rows[0]!, rows[1]!] }),
    });
    expect(ranks[0]!.rank).toBe(1);
  });
});
