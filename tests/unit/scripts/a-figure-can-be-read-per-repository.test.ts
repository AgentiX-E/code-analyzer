// **A single aggregate over six repositories is a figure nobody can audit per repository**, and that is the second half
// of the quota defect: the artifact published `conditions` and per-question columns, so a reader could see the whole and
// the parts but not the sum in between. "Four repositories" was asserted in the corpus file and in prose, and no number
// in the artifact could contradict it.
//
// **The arithmetic below is the arithmetic `score()` already does**, applied to a subset - which is the point: a
// per-repository figure computed by a second formula would be a second definition of MRR, and the two would drift.
// Every group's `n` has to sum to the whole's `n`, and no group may be silently absent because its repository happened
// to contribute no scored question.

import { describe, expect, it } from 'vitest';

import { score, scoreBy } from '../../../scripts/lib/multirepo-harness.js';
import type { Question } from '../../../scripts/lib/multirepo-harness.js';

function question(repo: string, symbol: string): Question {
  return {
    key: `${repo}#${symbol}`,
    repo,
    symbol,
    filePath: `src/${symbol}.ts`,
    label: 'Function',
    text: `Where is ${symbol} defined, in a sentence long enough to be a question?`,
    namesItsAnswer: false,
    sameNameElsewhere: 1,
  };
}

const questions = [
  question('a/one', 'alpha'),
  question('a/one', 'beta'),
  question('b/two', 'gamma'),
  question('b/two', 'delta'),
];

describe('a figure can be read per repository and per language', () => {
  it('reproduces the whole aggregate as the sum of its groups', () => {
    const ranks = [1, null, 2, 9];
    const grouped = scoreBy(questions, ranks, (q) => q.repo);

    expect(Object.keys(grouped).sort()).toEqual(['a/one', 'b/two']);
    expect(grouped['a/one']!.n + grouped['b/two']!.n).toBe(score(ranks).n);
    expect(grouped['a/one']!.found + grouped['b/two']!.found).toBe(score(ranks).found);
    // **MRR is a mean, so the parts do not add up to the whole** - they weight by their own denominators, and the whole
    // is the row-count-weighted mean of them. That is the identity checked here rather than a sum.
    const weighted =
      (grouped['a/one']!.mrr * grouped['a/one']!.n + grouped['b/two']!.mrr * grouped['b/two']!.n) /
      score(ranks).n;
    expect(weighted).toBeCloseTo(score(ranks).mrr, 4);
  });

  it('counts a miss in the group it was asked in and not in the groups it was not', () => {
    const ranks = [1, null, null, null];
    const grouped = scoreBy(questions, ranks, (q) => q.repo);
    expect(grouped['a/one']).toEqual({ n: 2, found: 1, r1: 0.5, mrr: 0.5 });
    expect(grouped['b/two']).toEqual({ n: 2, found: 0, r1: 0, mrr: 0 });
  });

  it('names a group the key function cannot name rather than dropping its rows', () => {
    // **A dropped row is a smaller denominator pretending to be the same measurement.** A corpus repository that no
    // language map knows is exactly the case that happens when a pin is added to one file and not the other.
    const grouped = scoreBy(questions, [1, 2, 3, 4], (q) => (q.repo === 'a/one' ? 'python' : ''));
    expect(grouped['unknown']).toBeDefined();
    expect(grouped['unknown']!.n).toBe(2);
    expect(Object.values(grouped).reduce((sum, group) => sum + group.n, 0)).toBe(4);
  });

  it('refuses a column whose length is not the number of questions', () => {
    // The failure this prevents is the one every rank column in this repository is one off-by-one away from: a column
    // that lost a row aligns every later question with the previous answer, and the resulting figure is wrong in a way
    // that looks like a result.
    expect(() => scoreBy(questions, [1, 2, 3], (q) => q.repo)).toThrow(/length/);
  });
});
