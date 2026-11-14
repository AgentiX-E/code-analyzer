// **An artifact that prints a number nobody can re-derive is a claim, not a measurement.**
//
// `benchmarks/multirepo-qa.json` is produced by `scripts/multirepo-qa.ts` from the repositories the corpus file pins.
// This test
// does what the artifact's own comment promises a reader can do: it decodes the per-question rank columns and
// recomputes every aggregate printed beside them. If the two disagree, one of them is wrong and this test does not get
// to guess which.
//
// It also checks the parts of the corpus that make the number comparable at all - the commits are pinned, the
// languages are the ones the product claims, and the question count the artifact reports is the count the columns
// hold.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  decodeRanks,
  foundWithin,
  reciprocalRank,
  MRR_CUT,
} from '../../../packages/intelligence/src/search/paired-stats.js';

interface Condition {
  n: number;
  found: number;
  r1: number;
  mrr: number;
}

interface Artifact {
  measuredAt: string;
  cut: number;
  depth: number;
  corpus: Array<{ id: string; sha: string; language: string; role: string }>;
  index: { reposIndexed: number; totalNodes: number; errors: string[] };
  questions: { derived: number; scored: number; ambiguous: number; namesItsAnswer: number };
  conditions: Record<string, Condition>;
  paired: Record<
    string,
    {
      queries: number;
      foundA: number;
      foundB: number;
      onlyA: number;
      onlyB: number;
      deltaMrr: number;
    }
  >;
  perQuestion: { keys: string[]; federated: string; scoped: string; ambiguous: string[] };
}

const artifact = JSON.parse(
  readFileSync(new URL('../../../benchmarks/multirepo-qa.json', import.meta.url), 'utf8'),
) as Artifact;

function recompute(column: string, n: number): Condition {
  const ranks = decodeRanks(column, n);
  const found = ranks.filter((rank) => foundWithin(rank, MRR_CUT)).length;
  const r1 = ranks.filter((rank) => foundWithin(rank, 1)).length;
  const mrr = ranks.reduce<number>((sum, rank) => sum + reciprocalRank(rank, MRR_CUT), 0);
  return { n, found, r1: Number((r1 / n).toFixed(4)), mrr: Number((mrr / n).toFixed(4)) };
}

describe('the multi-repository artifact can be re-derived from its own columns', () => {
  it('measured every repository the corpus pins, in six languages, each pinned to a commit', () => {
    // **The corpus file is the single place the list is written down.** A test that hardcoded four would have passed
    // while the corpus grew to six - and it did pass, exactly once, on the commit that added `go` and `rust`, until the
    // workflow ran it against the new artifact.
    const corpus = JSON.parse(
      readFileSync(new URL('../../../benchmarks/multirepo-qa-corpus.json', import.meta.url), 'utf8'),
    ) as { repositories: Array<{ id: string; sha: string }> };
    expect(artifact.corpus.map((repo) => repo.id)).toEqual(corpus.repositories.map((repo) => repo.id));
    expect(new Set(artifact.corpus.map((repo) => repo.language))).toEqual(
      new Set(['python', 'javascript', 'typescript', 'java', 'go', 'rust']),
    );
    for (const repo of artifact.corpus) {
      // **A branch name is not a pin.** Two runs of one artifact have to read one corpus.
      expect(repo.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(repo.id).toMatch(/^[^/]+\/[^/]+$/);
    }
    expect(artifact.index.reposIndexed).toBe(corpus.repositories.length);
    expect(artifact.index.errors).toEqual([]);
    expect(artifact.index.totalNodes).toBeGreaterThan(1_000);
  });

  it('holds one rank per scored question, in every condition', () => {
    const n = artifact.questions.scored;
    expect(artifact.perQuestion.keys).toHaveLength(n);
    expect(new Set(artifact.perQuestion.keys).size).toBe(n);
    expect(decodeRanks(artifact.perQuestion.federated, n)).toHaveLength(n);
    expect(decodeRanks(artifact.perQuestion.scoped, n)).toHaveLength(n);
    expect(artifact.conditions['federated']!!.n).toBe(n);
    expect(artifact.conditions['scoped']!!.n).toBe(n);
  });

  it('prints no aggregate the columns do not produce', () => {
    const n = artifact.questions.scored;
    expect(recompute(artifact.perQuestion.federated, n)).toEqual(artifact.conditions['federated']!);
    expect(recompute(artifact.perQuestion.scoped, n)).toEqual(artifact.conditions['scoped']!);
  });

  it('counts the paired discordance the columns show, rather than stating one', () => {
    const n = artifact.questions.scored;
    const federated = decodeRanks(artifact.perQuestion.federated, n);
    const scoped = decodeRanks(artifact.perQuestion.scoped, n);

    let onlyScoped = 0;
    let onlyFederated = 0;
    for (let index = 0; index < n; index++) {
      const inFederated = foundWithin(federated[index]!, MRR_CUT);
      const inScoped = foundWithin(scoped[index]!, MRR_CUT);
      if (inScoped && !inFederated) onlyScoped += 1;
      if (inFederated && !inScoped) onlyFederated += 1;
    }

    const paired = artifact.paired['scoped-vs-federated']!;
    expect(paired.queries).toBe(n);
    expect(paired.onlyA).toBe(onlyScoped);
    expect(paired.onlyB).toBe(onlyFederated);
    expect(paired.foundA).toBe(recompute(artifact.perQuestion.scoped, n).found);
    expect(paired.foundB).toBe(recompute(artifact.perQuestion.federated, n).found);
  });

  it('draws the ambiguous subset from the questions it scored', () => {
    expect(artifact.perQuestion.ambiguous).toHaveLength(artifact.questions.ambiguous);
    for (const key of artifact.perQuestion.ambiguous) {
      expect(artifact.perQuestion.keys).toContain(key);
    }
    expect(artifact.questions.scored).toBeLessThanOrEqual(artifact.perQuestion.keys.length);
    expect(artifact.questions.derived).toBeGreaterThanOrEqual(artifact.questions.scored);
  });

  it('names the cut it scored at, so a figure cannot be quoted without it', () => {
    expect(artifact.cut).toBe(10);
    expect(artifact.depth).toBeGreaterThanOrEqual(artifact.cut);
    expect(artifact.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // **The result this corpus was built to report**: three other repositories being open costs a handful of questions
  // and not a distinguishable fraction of them. If a change ever makes that cost real, this assertion fails first.
  it('reports a cross-repository cost that is stated as a test rather than a band', () => {
    const paired = artifact.paired['scoped-vs-federated']!;
    expect(Number.isFinite(paired.deltaMrr)).toBe(true);
    expect(paired.onlyA + paired.onlyB).toBeLessThan(0.05 * artifact.questions.scored);
  });
});
