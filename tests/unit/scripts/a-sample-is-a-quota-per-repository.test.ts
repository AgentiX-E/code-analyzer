// **A sample that is the first of every *k* is proportional to how much a repository has to say**, and that is the
// defect this file registers. `sampleQuestions` strided over a list sorted by `projectId:qualifiedName`, so the number
// of questions a repository contributed was decided by how thoroughly it documents itself: `google/gson` gave 332 of
// the 494 published questions, and "four repositories" was one repository and three guests. A per-language or
// per-repository figure over such a sample describes the sample, not the repository.
//
// **The rule the sample now follows is a quota, not a stride**: every repository contributes the same number of
// questions, and a repository with more documentation gets a wider stride rather than more rows. The tests below hold
// the four properties that makes checkable - equal quota, determinism, containment in the pool, and no question asked
// twice - plus the two degenerate cases a quota has to survive: a pool smaller than the target and a repository too
// small to fill its share.

import { describe, expect, it } from 'vitest';

import { sampleQuestions } from '../../../scripts/lib/multirepo-harness.js';
import type { Question } from '../../../scripts/lib/multirepo-harness.js';

/** A pool of `counts` questions per repository, in the order `deriveQuestions` produces: repository, then name. */
function pool(counts: Record<string, number>): Question[] {
  const questions: Question[] = [];
  for (const repo of Object.keys(counts).sort()) {
    for (let index = 0; index < counts[repo]!; index++) {
      questions.push({
        key: `${repo}#symbol${String(index).padStart(4, '0')}`,
        repo,
        symbol: `symbol${String(index).padStart(4, '0')}`,
        filePath: `src/${index}.ts`,
        label: 'Function',
        text: `What does symbol${index} do in ${repo}? Because a question has to be a sentence.`,
        namesItsAnswer: false,
        sameNameElsewhere: 1,
      });
    }
  }
  return questions;
}

function countsOf(sample: readonly Question[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const question of sample) counts[question.repo] = (counts[question.repo] ?? 0) + 1;
  return counts;
}

describe('a sample is a quota per repository, not a stride over the pool', () => {
  it('gives the repository with ten times the documentation no more questions than the smallest one', () => {
    // **The shape the published corpus had.** One repository holds 332 of 494 candidates; the others hold 54, 54 and
    // 54. A stride over the pool makes the large repository 67 per cent of every figure computed from it.
    const questions = pool({ 'a/large': 1000, 'b/small': 100, 'c/small': 100, 'd/small': 100 });
    const sample = sampleQuestions(questions, 400);
    const counts = countsOf(sample);

    expect(Object.keys(counts).sort()).toEqual(['a/large', 'b/small', 'c/small', 'd/small']);
    // Equal to within one, because 400 is not divisible by three and something has to take the remainder.
    const values = Object.values(counts);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    // And the large repository is a quarter of the sample rather than two thirds of it.
    expect(counts['a/large']! / sample.length).toBeLessThanOrEqual(0.26);
  });

  it('is the same sample on a second call, because a corpus is a file a reader diffs', () => {
    const questions = pool({ 'a/one': 300, 'b/two': 80, 'c/three': 40 });
    const first = sampleQuestions(questions, 90).map((question) => question.key);
    const second = sampleQuestions(questions, 90).map((question) => question.key);
    expect(second).toEqual(first);
  });

  it('asks no question twice and asks nothing that is not in the pool', () => {
    const questions = pool({ 'a/one': 300, 'b/two': 80, 'c/three': 40 });
    const sample = sampleQuestions(questions, 90);
    const keys = new Set(sample.map((question) => question.key));
    expect(keys.size).toBe(sample.length);
    const poolKeys = new Set(questions.map((question) => question.key));
    for (const question of sample) expect(poolKeys.has(question.key)).toBe(true);
  });

  it('spreads a repository across its own pool instead of taking its first k', () => {
    // **A quota read from the front of a sorted list is the alphabet, not the repository.** Taking the first 100 of a
    // repository whose symbols are sorted by name would ask about every symbol beginning with `A` and none beginning
    // with `Z`, and the doc-comment length of a symbol correlates with its name only by accident - so the figure would
    // be unbiased on average and wrong on any one run that mattered.
    const questions = pool({ 'a/one': 400 });
    const sample = sampleQuestions(questions, 100);
    const indices = sample.map((question) => Number(question.symbol.slice(6)));
    expect(indices[0]).toBeLessThan(10);
    expect(indices[indices.length - 1]).toBeGreaterThan(380);
    // Evenly spaced to within one stride: the gaps are all the same.
    const gaps = indices.slice(1).map((value, at) => value - indices[at]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });

  it('redistributes a short repositorys share rather than returning a smaller sample', () => {
    // **The degenerate case that makes a quota a trap**: one repository has twelve questions and its share is a
    // hundred. Six questions of a hundred would be six questions never asked, and the total would silently fall.
    const questions = pool({ 'a/big': 500, 'b/tiny': 12, 'c/big': 500 });
    const sample = sampleQuestions(questions, 300);
    const counts = countsOf(sample);
    expect(counts['b/tiny']).toBe(12);
    expect(sample.length).toBe(300);
    // What the short repository could not take went to the others, which stay equal to within one.
    expect(Math.abs(counts['a/big']! - counts['c/big']!)).toBeLessThanOrEqual(1);
  });

  it('returns the whole pool when the pool is smaller than the target', () => {
    const questions = pool({ 'a/one': 30, 'b/two': 20 });
    const sample = sampleQuestions(questions, 400);
    expect(sample.length).toBe(50);
    expect(countsOf(sample)).toEqual({ 'a/one': 30, 'b/two': 20 });
  });
});
