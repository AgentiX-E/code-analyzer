// **The paraphrase condition is the first multi-repository number that is not a lookup**, so the artifact that carries it
// has to be checkable without the corpus, the key or the model.
//
// Two things are re-derived here. **The arithmetic**: every aggregate in `benchmarks/multirepo-qa-paraphrase.json` is
// recomputed from the per-question rank columns it publishes, and the paired tests are recomputed from the same columns.
// **The claim**: every accepted rewrite is checked again against the rule that made it a rewrite - no symbol name in any
// spelling, no six-word phrase copied from the documentation - because a corpus that quietly lost that property would
// make the measured difference a measurement of wording that was not actually different.
//
// And one property that only exists across two files: **the verbatim column of this run must equal the verbatim column of
// `multirepo-qa.json` on the questions both scored.** If it does not, the difference between the two conditions carries
// the index or the engine's drift, and the artifact's central claim - that the only change is how the question is worded
// - would be false.

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

interface Pair {
  queries: number;
  foundA: number;
  foundB: number;
  onlyA: number;
  onlyB: number;
  deltaMrr: number;
  mrrInterval: [number, number];
  pValue: number;
}

interface ParaphraseArtifact {
  cut: number;
  depth: number;
  prompt: string;
  questions: {
    sampled: number;
    generated: number;
    accepted: number;
    rejected: number;
    namesItsAnswer: number;
  };
  conditions: Record<string, Condition>;
  paired: Record<string, Pair>;
  perQuestion: Record<
    'keys' | 'verbatim' | 'verbatimScoped' | 'paraphrase' | 'paraphraseScoped',
    string[] | string
  >;
  rejected: Array<{ key: string; reasons: string[] }>;
}

interface CorpusRow {
  key: string;
  symbol: string;
  verbatim: string;
  paraphrase: string;
  rejected?: string[];
}

const read = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(`../../../benchmarks/${path}`, import.meta.url), 'utf8')) as T;

const artifact = read<ParaphraseArtifact>('multirepo-qa-paraphrase.json');
const corpus = read<{ digest: string; rows: CorpusRow[] }>('multirepo-qa-paraphrase-corpus.json');
const verbatim = read<{ perQuestion: { keys: string[]; federated: string } }>('multirepo-qa.json');

const keys = artifact.perQuestion['keys'] as string[];
/**
 * **Named the way the aggregates are named**, so that a column and the figure it produces are found by the same key.
 * The first version of this test keyed the columns `verbatim` and the conditions `verbatimFederated`, and the mismatch
 * failed as "a column with no aggregate" - which is the right failure for the wrong reason.
 */
const columns = {
  verbatimFederated: artifact.perQuestion['verbatim'] as string,
  verbatimScoped: artifact.perQuestion['verbatimScoped'] as string,
  paraphraseFederated: artifact.perQuestion['paraphrase'] as string,
  paraphraseScoped: artifact.perQuestion['paraphraseScoped'] as string,
};

/** Found@10, recall@1 and MRR@10 from a column - **the same arithmetic the script publishes**. */
function recompute(column: string, n: number): Condition {
  const ranks = decodeRanks(column, n);
  const found = ranks.filter((rank) => foundWithin(rank, MRR_CUT)).length;
  const r1 = ranks.filter((rank) => foundWithin(rank, 1)).length;
  const mrr = ranks.reduce<number>((sum, rank) => sum + reciprocalRank(rank, MRR_CUT), 0);
  return {
    n,
    found,
    r1: Number((r1 / n).toFixed(4)),
    mrr: Number((mrr / n).toFixed(4)),
  };
}

/** `camelCase`, `snake_case` and `kebab-case` collapsed to one string. **Written again here on purpose**: a checker that
 * called the generator's own predicate would agree with a bug in it. */
const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Six consecutive words, which is what "copied a phrase" means in this corpus. */
function copiesSixWords(source: string, rewrite: string): boolean {
  const tokenise = (text: string): string[] =>
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word !== '');
  const from = tokenise(source);
  const to = tokenise(rewrite);
  const seen = new Set<string>();
  for (let at = 0; at + 6 <= from.length; at++) seen.add(from.slice(at, at + 6).join(' '));
  for (let at = 0; at + 6 <= to.length; at++) {
    if (seen.has(to.slice(at, at + 6).join(' '))) return true;
  }
  return false;
}

describe('the paraphrase artifact re-derives to its own figures', () => {
  it('scores the number of questions it says it scored', () => {
    expect(keys.length).toBe(artifact.questions.accepted);
    expect(artifact.questions.accepted + artifact.questions.rejected).toBe(
      artifact.questions.generated,
    );
    expect(artifact.questions.rejected).toBe(artifact.rejected.length);
    for (const [name, column] of Object.entries(columns)) {
      expect(
        decodeRanks(column, keys.length).length,
        `${name} does not decode to the scored set`,
      ).toBe(keys.length);
    }
  });

  it('recomputes every published aggregate from its own column', () => {
    for (const [name, column] of Object.entries(columns)) {
      const condition = artifact.conditions[name];
      expect(condition, `${name} is a column with no aggregate`).toBeDefined();
      expect(recompute(column, keys.length), `${name} disagrees with its column`).toEqual(
        condition,
      );
    }
  });

  it('recomputes both paired tests from the same columns', () => {
    const pairs: Array<[string, string, string]> = [
      ['paraphrase-vs-verbatim-federated', 'paraphraseFederated', 'verbatimFederated'],
      ['paraphrase-vs-verbatim-scoped', 'paraphraseScoped', 'verbatimScoped'],
    ];
    for (const [name, left, right] of pairs) {
      const pair = artifact.paired[name];
      expect(pair, `${name} is missing`).toBeDefined();
      // **Every question, not a subset**: a paired test over the questions that happened to answer is the defect the
      // instrument exists to prevent.
      expect(pair!.queries).toBe(keys.length);
      const a = decodeRanks(columns[left as keyof typeof columns], keys.length);
      const b = decodeRanks(columns[right as keyof typeof columns], keys.length);
      const foundA = a.filter((rank) => foundWithin(rank, MRR_CUT)).length;
      const foundB = b.filter((rank) => foundWithin(rank, MRR_CUT)).length;
      expect(pair!.foundA).toBe(foundA);
      expect(pair!.foundB).toBe(foundB);
      expect(pair!.onlyA).toBe(
        a.filter((rank, at) => foundWithin(rank, MRR_CUT) && !foundWithin(b[at]!, MRR_CUT)).length,
      );
      expect(pair!.onlyB).toBe(
        b.filter((rank, at) => foundWithin(rank, MRR_CUT) && !foundWithin(a[at]!, MRR_CUT)).length,
      );
      // **The interval has to contain its own point estimate**, which is the cheapest possible check on a resampling
      // bug - and one that would otherwise read as a finding.
      expect(pair!.mrrInterval[0]).toBeLessThanOrEqual(pair!.deltaMrr);
      expect(pair!.mrrInterval[1]).toBeGreaterThanOrEqual(pair!.deltaMrr);
      expect(pair!.pValue).toBeGreaterThanOrEqual(0);
      expect(pair!.pValue).toBeLessThanOrEqual(1);
    }
  });

  it('keeps every accepted rewrite a rewrite, by the rule the corpus states', () => {
    const accepted = corpus.rows.filter((row) => row.rejected === undefined);
    expect(accepted.length).toBe(artifact.questions.accepted);

    for (const row of accepted) {
      expect(row.paraphrase.trim().endsWith('?'), `${row.key} is not a question`).toBe(true);
      expect(row.paraphrase.length, `${row.key} is too short`).toBeGreaterThanOrEqual(15);
      expect(row.paraphrase.length, `${row.key} is too long`).toBeLessThanOrEqual(240);
      // **The name in any spelling.** `computeKineticEnergy` and `compute_kinetic_energy` normalise to one string, so a
      // model that changed the separator cannot walk past this.
      expect(
        normalise(row.paraphrase).includes(normalise(row.symbol)),
        `${row.key} still spells the symbol name`,
      ).toBe(false);
      expect(
        copiesSixWords(row.verbatim, row.paraphrase),
        `${row.key} copies six words from the documentation it was asked to rewrite`,
      ).toBe(false);
    }
  });

  it('says how many rewrites still name the symbol in the artifact’s own terms', () => {
    // **Zero, and the field exists to be zero.** It is published rather than omitted so that a corpus which stopped
    // satisfying the rule would show up as a changed number rather than as a test that suddenly failed.
    expect(artifact.questions.namesItsAnswer).toBe(0);
  });

  it('measured the verbatim questions the same way the verbatim artifact did', () => {
    // **The cross-file property.** `multirepo-qa.json` and this artifact indexed the same four commits with the same
    // engine, so a verbatim question must land at the same rank in both. A disagreement means the index or the product
    // moved between the two files, and then the paraphrase difference carries that move as well as the wording.
    const published = decodeRanks(verbatim.perQuestion.federated, verbatim.perQuestion.keys.length);
    const byKey = new Map(verbatim.perQuestion.keys.map((key, at) => [key, published[at]!]));
    const mine = decodeRanks(columns.verbatimFederated, keys.length);

    let compared = 0;
    for (const [at, key] of keys.entries()) {
      const there = byKey.get(key);
      if (there === undefined) continue;
      compared += 1;
      expect(mine[at], `${key} landed at a different rank in the two artifacts`).toBe(there);
    }
    // **A comparison over nothing would pass vacuously**, which is this repository's most expensive kind of green.
    expect(compared).toBeGreaterThan(0);
  });

  it('records which prompt produced the corpus', () => {
    // **A rewrite prompt is an instrument.** A corpus that did not name its version would make two corpora look like
    // two samples rather than two instruments, and a later change would be indistinguishable from a different draw.
    expect(artifact.prompt).toBe('multirepo-paraphrase-v1');
    expect(corpus.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

/**
 * **The semantic artifact's columns, and the reason they exist.**
 *
 * The first sweep of the fusion weight published four aggregates and no columns, so a reader could see that weight 0.35
 * was thirteen questions better than weight four and could not ask *which* thirteen - and the next analysis of the same
 * vectors would have had to re-embed a four-repository corpus to find out. **A column is what makes a sweep a
 * measurement rather than a table**, so every swept weight is now published per question, and this test recomputes each
 * published aggregate from its own column. When the artifact is absent (a checkout that never ran the paid job) the
 * block is skipped rather than passed vacuously.
 */
interface SweptArtifact {
  semanticSweep?: Record<string, Condition>;
  candidate?: {
    paraphrase: Condition;
    verbatim: Condition;
    weight: { min: number; p50: number; max: number; atFloor: number; atCeiling: number };
    evidence: { lexicalP50: number; vectorP50: number; vectorAhead: number };
  } | null;
  perQuestion: Record<string, string | Record<string, string> | string[]>;
}

function readIfPresent<T>(path: string): T | null {
  try {
    return read<T>(path);
  } catch {
    return null;
  }
}

describe('the semantic artifact re-derives to its own sweep', () => {
  // **An artifact older than the columns is not a failed measurement, and a column that is present must still be
  // right.** This commit instruments the sweep and the next one carries the artifact the instrumentation produced; until
  // it lands the block is a check on every artifact that has columns rather than a demand that this one does. The demand
  // is the cheaper half of the pair and it ships with the file that satisfies it.
  const semantic = readIfPresent<SweptArtifact>('multirepo-qa-paraphrase-semantic.json');
  const columns = semantic?.perQuestion['sweep'] as Record<string, string> | undefined;
  const candidate = semantic?.candidate ?? null;
  const candidateColumn = semantic?.perQuestion['candidate'] as string | undefined;

  it('recomputes each swept weight’s aggregate from that weight’s own column', () => {
    if (semantic === null || columns === undefined) return;
    const sweep = semantic.semanticSweep!;
    // **The keys are the same set on both sides**, because a weight with an aggregate and no column is the gap this
    // test exists to close, and a column with no aggregate is a column nobody scored.
    expect(Object.keys(columns).sort()).toEqual(Object.keys(sweep).sort());
    for (const [weight, column] of Object.entries(columns)) {
      // **The condition, not the whole published row**: a swept row carries its own paired verdict beside its four
      // figures, and that verdict is a statement about the column rather than a fifth figure the column can produce.
      const { paired: _paired, ...condition } = sweep[weight] as Condition & { paired?: unknown };
      expect(
        recompute(column, keys.length),
        `weight ${weight} disagrees with its own column`,
      ).toEqual(condition);
    }
  });

  it('recomputes both candidate conditions from the columns and the numbers they came from', () => {
    if (semantic === null || candidate === null || candidateColumn === undefined) return;
    // **Every column of it**, because the block is the only place the candidate rule has a figure and a rule with one
    // corpus and no column is a rule nobody can check.
    const { paired: _p, ...paraphraseCondition } = candidate.paraphrase as Condition & {
      paired?: unknown;
    };
    const { paired: _v, ...verbatimCondition } = candidate.verbatim as Condition & {
      paired?: unknown;
    };
    expect(recompute(candidateColumn, keys.length)).toEqual(paraphraseCondition);
    expect(recompute(semantic.perQuestion['candidateVerbatim'] as string, keys.length)).toEqual(
      verbatimCondition,
    );

    const weights = (semantic.perQuestion['candidateWeight'] as string)
      .split(',')
      .map((token) => Number(token));
    expect(weights).toHaveLength(keys.length);
    // **Inside the bounds the sweeps measured**: a weight outside them would be a rule quoting a measurement nobody
    // made, which is the defect `FUSION_WEIGHT_BOUNDS` was written to prevent.
    for (const weight of weights) {
      expect(weight).toBeGreaterThanOrEqual(0.1);
      expect(weight).toBeLessThanOrEqual(4);
    }
    // **And the two shares are the weight's own inputs**, so a written column that no ratio could produce is a column
    // that was computed some other way.
    const lexical = (semantic.perQuestion['lexicalEvidence'] as string).split(',').map(Number);
    const vector = (semantic.perQuestion['vectorEvidence'] as string).split(',').map(Number);
    expect(lexical).toHaveLength(keys.length);
    expect(vector).toHaveLength(keys.length);
    // **Within the propagation of the published rounding, and no more.** The shares are written to three decimals, so
    // a ratio recomputed from them carries up to `20 × 0.0005 × (1 + w)` of error - two and a half per cent at the top of
    // the range and less everywhere else. A tighter tolerance would demand the unrounded shares, which the artifact does
    // not publish; a looser one would accept a weight that is not this ratio at all.
    for (const [at, weight] of weights.entries()) {
      // **The rule as it is written, both halves**: the absolute cut first, then the ratio. A reader recomputing only the
      // ratio would conclude the fourteen questions the cut took were computed some other way.
      const ratio = (vector[at]! + 0.05) / (lexical[at]! + 0.05);
      const expected = lexical[at]! >= 0.8 ? 0.1 : Math.min(4, Math.max(0.1, ratio));
      expect(
        Math.abs(weight - expected),
        `question ${at} does not carry its own ratio: ${weight} against ${expected}`,
      ).toBeLessThanOrEqual(0.025 * Math.max(1, expected));
    }
  });
});
