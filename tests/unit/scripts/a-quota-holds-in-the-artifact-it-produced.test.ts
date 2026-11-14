// **The quota is only real if something fails when it stops holding.** §41.1 found that the published sample was 67 per
// cent one repository while every paragraph said "four", and the reason it could stay that way is that nothing in the
// repository read the sample: the corpus file named four repositories, the artifact published one aggregate, and the
// only per-repository field counted hits rather than scoring ranks.
//
// The assertions here are the structural half of §41.3 - R1, R2 and R6 - held against the artifacts as committed rather
// than against a run. **The directional half (R3, R4, R5) is not here on purpose**: a test that asserted "the vector
// channel beats the lexical one in every language" would fail on a true measurement and be edited until it passed,
// which is how a criterion becomes decoration. The direction is reported in `iteration-139-report.md` with the numbers
// that produced it; what this file guarantees is that the numbers can be read per repository and per language at all.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface Score {
  n: number;
  found: number;
  r1: number;
  mrr: number;
}

interface ParaphraseArtifact {
  measuredAt: string;
  corpus: Array<{ id: string; language: string; sha: string }>;
  space: { index: string; query: string } | null;
  questions: { sampled: number; accepted: number; scored: number };
  byRepository: Record<string, Record<string, Score>>;
  byLanguage: Record<string, Record<string, Score>>;
}

const read = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')) as T;

const artifact = read<ParaphraseArtifact>('benchmarks/multirepo-qa-paraphrase-semantic.json');
const corpus = read<{ repositories: Array<{ id: string; language: string }> }>(
  'benchmarks/multirepo-qa-paraphrase-corpus.json',
);

/** What a 400-question quota over these repositories promises, per repository. */
const TARGET = 400;

describe('the sample is a sample of every repository and not of the one that documents itself', () => {
  it('names in the artifact the repositories the corpus pins, and no others', () => {
    expect(artifact.corpus.map((repo) => repo.id).sort()).toEqual(
      corpus.repositories.map((repo) => repo.id).sort(),
    );
    expect(Object.keys(artifact.byRepository['paraphraseFederated']!).sort()).toEqual(
      corpus.repositories.map((repo) => repo.id).sort(),
    );
  });

  it('gives every repository a quota of scored rows, and the six of them the whole sample', () => {
    const counts = Object.values(artifact.byRepository['paraphraseFederated']!).map(
      (score) => score.n,
    );
    // **The cap, not the floor.** A quota guarantees that no repository carries more than its share; it cannot
    // guarantee that each reaches one, because a rejected rewrite only ever subtracts - and the first six-repository run
    // proved it by putting `flask` at 59 of 67, which is what §42 was written about.
    for (const count of counts) expect(count).toBeLessThanOrEqual(Math.ceil(TARGET / 6));
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(artifact.questions.scored);
    // **What the defect was**: 67 per cent of the measurement from one repository. The widest repository is now under a
    // fifth of it.
    expect(Math.max(...counts) / artifact.questions.scored).toBeLessThanOrEqual(0.18);
  });

  it('reports every language the corpus contains, and names go and rust as measured rather than intended', () => {
    const languages = Object.keys(artifact.byLanguage['paraphraseFederated']!).sort();
    expect(languages).toEqual(
      [...new Set(corpus.repositories.map((repo) => repo.language))].sort(),
    );
    for (const language of ['go', 'rust']) {
      expect(artifact.byLanguage['paraphraseFederated']![language]!.n).toBeGreaterThanOrEqual(50);
    }
  });

  it('publishes the semantic column per language, which is what makes R3 checkable at all', () => {
    // **A per-language lexical figure with no per-language vector figure is the defect this iteration found, one level
    // down**: the whole-corpus comparison existed and the language-level one did not.
    for (const column of ['semanticParaphrase', 'verbatimFederated', 'semanticVerbatim']) {
      expect(artifact.byLanguage[column]).toBeDefined();
      expect(Object.keys(artifact.byLanguage[column]!).sort()).toEqual(
        Object.keys(artifact.byLanguage['paraphraseFederated']!).sort(),
      );
    }
  });

  it('says when it was measured and in which space, because a figure without a date is a rumour', () => {
    expect(Number.isNaN(Date.parse(artifact.measuredAt))).toBe(false);
    expect(artifact.space).not.toBeNull();
    expect(artifact.space!.index).toBe(artifact.space!.query);
    expect(artifact.space!.index).not.toBe('deterministic');
  });
});
