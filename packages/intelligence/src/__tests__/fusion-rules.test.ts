// **The candidates have to be the engine's own arithmetic before any figure they produce means anything.**
//
// A rule measured by a second implementation is a rule measured against a different engine: the fused order depends on
// the tie-break, and §29 already paid once for a tie broken by insertion order. So the first test here does not check
// that `rrf` is *reasonable* - it checks that `rrf` at weight one returns **exactly** the order `HybridSearchEngine`
// returns, node for node. **Every other number in `EVAL-CONTRACT.md` §40 is a comparison between that engine and a
// candidate, and a candidate that fuses differently for a reason of its own would be a candidate that won by accident.**

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RRF_K,
  FUSION_RULE_NAMES,
  HEAD_DEPTH_WIDE,
  fuseByRule,
  headSeparation,
  percentiles,
  qppVectorWeight,
  zScores,
} from '../search/fusion-rules.js';
import { FUSION_WEIGHT_BOUNDS } from '../search/fusion-weight.js';
import { HybridSearchEngine } from '../search/hybrid-search.js';

import type { RankedResult } from '../search/hybrid-search.js';
import type { GraphNode } from '@code-analyzer/shared';

function makeNode(id: number, name: string): GraphNode {
  return {
    id,
    projectId: 'corpus/repo',
    label: 'Function',
    name,
    qualifiedName: `corpus/repo::${name}`,
    filePath: `src/${name}.ts`,
    startLine: 1,
    endLine: 10,
    language: 'typescript',
    properties: {},
  } as unknown as GraphNode;
}

const ranked = (node: GraphNode, score: number): RankedResult => ({ node, score });

/** Two channels over the same six documents, with the vector list disagreeing at the head. */
const A = makeNode(1, 'alpha');
const B = makeNode(2, 'beta');
const C = makeNode(3, 'gamma');
const D = makeNode(4, 'delta');
const E = makeNode(5, 'epsilon');
const F = makeNode(6, 'zeta');
const G = makeNode(7, 'eta');
const H = makeNode(8, 'theta');
const I = makeNode(9, 'iota');
const J = makeNode(10, 'kappa');

const lexical: RankedResult[] = [ranked(A, 30), ranked(B, 21), ranked(C, 14), ranked(D, 9)];
const vector: RankedResult[] = [ranked(E, 0.91), ranked(B, 0.88), ranked(A, 0.72), ranked(F, 0.4)];

describe('rrf reproduces the engine it is compared against', () => {
  it('returns the engine’s order node for node at weight one', () => {
    const engine = new HybridSearchEngine(undefined as never);
    const fused = engine.fuseResults(lexical, vector, DEFAULT_RRF_K, undefined, 1);
    const candidate = fuseByRule('rrf', lexical, vector, { vectorWeight: 1 });

    // **Identity, not length**: a rule that fused the same documents into a different order would score differently on
    // every recall column while looking correct in a summary.
    expect(candidate.map((hit) => hit.node.id)).toEqual(fused.map((hit) => hit.node.id));
    for (const [at, hit] of candidate.entries()) {
      expect(hit.combinedScore).toBeCloseTo(fused[at]!.combinedScore, 12);
    }
  });

  it('reproduces the engine’s order at the weights the sweeps scored', () => {
    const engine = new HybridSearchEngine(undefined as never);
    for (const weight of [0.1, 0.35, 2, 4]) {
      const fused = engine.fuseResults(lexical, vector, DEFAULT_RRF_K, undefined, weight);
      const candidate = fuseByRule('rrf', lexical, vector, { vectorWeight: weight });
      expect(
        candidate.map((hit) => hit.node.id),
        `weight ${weight}`,
      ).toEqual(fused.map((hit) => hit.node.id));
    }
  });
});

describe('every rule is a deterministic function of the two lists', () => {
  it('returns the same order twice, for every rule in the published set', () => {
    // **A rule whose order depended on run order would make two measurements of the same corpus incomparable**, which is
    // the defect a bootstrap interval cannot detect because it would widen the interval rather than shift it.
    for (const rule of FUSION_RULE_NAMES) {
      const first = fuseByRule(rule, lexical, vector).map((hit) => hit.node.id);
      const second = fuseByRule(rule, lexical, vector).map((hit) => hit.node.id);
      expect(second, rule).toEqual(first);
    }
  });
});

describe('combmnz rewards agreement and needs no weight', () => {
  it('puts a document both channels returned above one only a channel returned', () => {
    // `beta` is second in both lists; `epsilon` is first in the vector list and absent from the lexical one. Agreement
    // wins, and **that is the whole claim**: a compromise between two lists should favour the documents they agree on,
    // rather than the documents one of them shouts about.
    const order = fuseByRule('combmnz', lexical, vector).map((hit) => hit.node.name);
    expect(order.indexOf('beta')).toBeLessThan(order.indexOf('epsilon'));
  });

  it('is indifferent to a weight, because it has none', () => {
    const plain = fuseByRule('combmnz', lexical, vector).map((hit) => hit.node.id);
    const weighted = fuseByRule('combmnz', lexical, vector, { vectorWeight: 4 }).map(
      (hit) => hit.node.id,
    );
    // **A parameter a rule does not read must not change it**, or the sweep that varies it would produce four identical
    // columns and a reader would read that as "the weight does not matter".
    expect(weighted).toEqual(plain);
  });
});

describe('agreement about an answer nobody wanted is not a vote for it', () => {
  // `zeta` is last in both lists - a document both channels returned and neither recommended - and the two CombMNZ
  // variants disagree about what that means. **§40.5 measured the plain one at 378 of 454 rewritten questions and 0.0199
  // *less* MRR than the shipped rule on CoSQA**, and this is the mechanism's own explanation of that loss.
  const bothLast = fuseByRule('combmnz', lexical, vector);
  const positive = fuseByRule('combmnz-positive', lexical, vector);

  it('scores a document both lists rank last below zero under the plain count', () => {
    const hit = bothLast.find((entry) => entry.node.id === F.id)!;
    // Two below-average z-scores, multiplied by two: **a large negative number, which sorts it to the bottom of a list
    // it is already at the bottom of** - harmless here, and not harmless when the document is one the other channel had
    // ranked well.
    expect(hit.combinedScore).toBeLessThan(0);
  });

  it('scores it at exactly zero when only positive evidence counts', () => {
    const hit = positive.find((entry) => entry.node.id === F.id)!;
    // **Zero, not a negative number**: a channel that says "not this one" contributes nothing rather than contributing
    // against, so agreement between two channels about a bad answer buys nothing.
    expect(hit.combinedScore).toBe(0);
  });

  it('leaves the documents at least one channel recommends where they were', () => {
    // The repair must not disturb what the plain count got right: `alpha` is the lexical list's first answer and
    // `epsilon` the vector list's, and both stay above the document nothing recommends.
    const ids = positive.map((entry) => entry.node.id);
    expect(ids.indexOf(F.id)).toBeGreaterThan(ids.indexOf(A.id));
    expect(ids.indexOf(F.id)).toBeGreaterThan(ids.indexOf(E.id));
  });
});

describe('a percentile cannot be compressed by a heavy tail, which is the third candidate’s whole claim', () => {
  it('gives the first answer of every channel the same number, whatever its scale', () => {
    // **The defect a z-score has and a percentile cannot**: `headSeparation` on a cosine list with a wide tail reads
    // 1.1 deviations for an answer a BM25 list reads 1.4 for, so two channels' heads are on different scales - and the
    // rank does not care what the scores were.
    const scaled = percentiles(vector);
    expect(scaled.get(E.id)).toBe(1);
    expect(scaled.get(F.id)).toBe(0);
    // Last of four is 0 and first is 1, so the middle two are a third and two thirds of the way **in rank order, not in
    // score order** - which is what makes the statistic independent of the channel's units.
    expect(scaled.get(B.id)).toBeCloseTo(2 / 3, 12);
    expect(scaled.get(A.id)).toBeCloseTo(1 / 3, 12);
  });

  it('rewards agreement over a single channel’s recommendation', () => {
    const fused = fuseByRule('combmnz-percentile', lexical, vector);
    const beta = fused.find((entry) => entry.node.id === B.id)!;
    const epsilon = fused.find((entry) => entry.node.id === E.id)!;
    // `beta` is second in both lists - `(2/3 + 2/3) × 2` - and `epsilon` is first in one list only, which is `1 × 1`.
    expect(beta.combinedScore).toBeCloseTo((2 / 3 + 2 / 3) * 2, 12);
    expect(epsilon.combinedScore).toBeCloseTo(1, 12);
    // **And `alpha` ties with it exactly**, because being first of four in one list is worth what being second of four in
    // both is: `(1 + 1/3) × 2`. Borda ties are not a fixture artefact - they are a property of ranks in small sets - and
    // the order between the two is the engine's own tie-break, which is the lexical score. **A rule that broke that tie
    // by identity would be measured under a different convention from the engine it would replace.**
    const alpha = fused.find((entry) => entry.node.id === A.id)!;
    expect(alpha.combinedScore).toBeCloseTo(beta.combinedScore, 12);
    expect(fused[0]!.node.id).toBe(A.id);
    expect(alpha.bm25Score).toBeGreaterThan(beta.bm25Score);
  });

  it('gives a list of one a percentile of one rather than dividing by zero', () => {
    const single = [ranked(A, 5)];
    expect(percentiles(single).get(A.id)).toBe(1);
  });
});

describe('reciprocal ranks times the channel count, which changes one thing at a time', () => {
  it('doubles a document both channels named and leaves a single-channel document alone', () => {
    // **The measurement that separates CombMNZ's two halves**: same rank arithmetic as the shipped rule, plus the count.
    // A candidate that changed both the arithmetic and the count would have a figure and no explanation.
    const fused = fuseByRule('rrf-mnz', lexical, vector, { k: 60 });
    const beta = fused.find((entry) => entry.node.id === B.id)!;
    const alone = fused.find((entry) => entry.node.id === E.id)!;
    expect(beta.combinedScore).toBeCloseTo((1 / 62 + 1 / 62) * 2, 12);
    expect(alone.combinedScore).toBeCloseTo(1 / 61, 12);
    // **And the top is decided by two ten-thousandths**: `alpha` at lexical rank 1 and vector rank 3 scores
    // `(1/61 + 1/63) × 2`, `beta` at rank 2 in both scores `(1/62 + 1/62) × 2`, and the difference is 0.000017 - **which is
    // what a count multiplier does to a reciprocal rank: it flattens the head**, so the order inside the agreed set is
    // nearly a coin toss. That flattening is a property to report rather than to assert away: it is the mechanism's own
    // cost, and the corpus is where it gets weighed.
    const alpha = fused.find((entry) => entry.node.id === A.id)!;
    expect(alpha.combinedScore).toBeGreaterThan(beta.combinedScore);
    expect(alpha.combinedScore - beta.combinedScore).toBeLessThan(0.0001);
  });
});

describe('the supported rule lets the semantic channel add without letting it reorder', () => {
  it('ignores a vector-only document below its own list’s mean', () => {
    // `zeta` is last in the vector list, at 0.4 against a mean of 0.7275 - the list is not standing behind it. Under
    // `rrf` at weight four it would take `1/64`, more than the lexical list's third-ranked document; under `supported`
    // it takes nothing and **stays behind every document the lexical list answered**.
    const supported = fuseByRule('supported', lexical, vector, { vectorWeight: 4 });
    const plain = fuseByRule('rrf', lexical, vector, { vectorWeight: 4 });
    const positionSupported = supported.findIndex((hit) => hit.node.id === F.id);
    const positionPlain = plain.findIndex((hit) => hit.node.id === F.id);
    expect(positionSupported).toBeGreaterThan(positionPlain);
    expect(positionSupported).toBeGreaterThan(supported.findIndex((hit) => hit.node.id === D.id));
  });

  it('keeps a vector-only document the list does stand behind', () => {
    // `epsilon` is the vector list's first answer and 1.18 deviations above its mean: withholding it would be the
    // opposite defect - a channel that found what the other missed would be ignored for being confident.
    const supported = fuseByRule('supported', lexical, vector, { vectorWeight: 4 });
    expect(supported.slice(0, 3).map((hit) => hit.node.id)).toContain(E.id);
  });
});

describe('the head separation is scale-free, which is why the two channels can be compared', () => {
  it('is unchanged when a channel’s scores are rescaled by a positive constant', () => {
    // BM25 scores are unbounded and cosines are not. A statistic that changed under rescaling could not be read across
    // the two channels at all, and the weight it produces would be a statement about units.
    const rescaled = vector.map((hit) => ranked(hit.node, hit.score * 37));
    expect(headSeparation(rescaled)).toBeCloseTo(headSeparation(vector), 12);
  });

  it('is non-negative, because a head cannot sit below the bulk it is a head of', () => {
    for (const list of [lexical, vector, [ranked(A, 1)]])
      expect(headSeparation(list)).toBeGreaterThanOrEqual(0);
  });

  it('gives a list of one a z-score of one rather than dividing by zero', () => {
    // The degenerate list is not an edge case here: a scoped search over a repository with one symbol produces one.
    expect(zScores([ranked(A, 3)]).get(A.id)).toBe(1);
  });

  it('reads a flat list as a flat head', () => {
    // Every score equal: there is no head, and returning a number here would be inventing a separation the list does
    // not have.
    const flat = [ranked(A, 5), ranked(B, 5), ranked(C, 5), ranked(D, 5)];
    expect(headSeparation(flat)).toBe(0);
    expect(zScores(flat).get(A.id)).toBe(1);
  });
});

describe('the query-performance weight is the ratio of the two heads, clamped to measured bounds', () => {
  it('trusts the channel whose head stands further above its own bulk', () => {
    // A lexical list whose scores decay smoothly (`30, 21, 14, 9` - a head at 1.4 deviations) against a vector list
    // whose first three answers sit within a hair of each other and far above a flat tail: **the second list is the
    // confident one**, and the weight has to say so without an answer key.
    // **Ten documents, because the statistic is a ratio of a margin to a spread and a six-document list cannot produce a
    // margin of the size a fifty-deep corpus list produces**: with three answers far above a flat tail the separation is
    // 1.58 deviations against the lexical list's 1.44, and with six documents the same shape reads 1.09 - the fixture
    // would have been testing its own length.
    const confident = [
      ranked(E, 0.9),
      ranked(B, 0.88),
      ranked(A, 0.86),
      ranked(F, 0.05),
      ranked(C, 0.05),
      ranked(D, 0.05),
      ranked(G, 0.05),
      ranked(H, 0.05),
      ranked(I, 0.05),
      ranked(J, 0.05),
    ];
    expect(headSeparation(lexical)).toBeCloseTo(1.44, 1);
    expect(headSeparation(confident)).toBeCloseTo(1.58, 1);
    expect(qppVectorWeight(lexical, confident)).toBeGreaterThan(1);
    // **And the wide head agrees**, because one confident answer and a confident top three are the same list here.
    expect(qppVectorWeight(lexical, confident, HEAD_DEPTH_WIDE)).toBeGreaterThan(1);
  });

  it('reports a lone spike as less confident at the wide depth, which is why both columns are published', () => {
    // **One very high score and a flat tail**: the spike *inflates the standard deviation*, so the top three's mean sits
    // close to the list mean in units of that deviation and the wide head reads the list as flat. The narrow head reads
    // the same list as the most confident one there is. **Two statistics, one list, opposite verdicts** - and this
    // fixture is where the disagreement is visible, which is the reason `qpp` and `qpp3` are separate candidates rather
    // than one candidate with a depth argument nobody measured.
    const spike = [ranked(E, 0.9), ranked(B, 0.2), ranked(A, 0.19), ranked(F, 0.18)];
    expect(headSeparation(spike)).toBeGreaterThan(headSeparation(lexical));
    expect(headSeparation(spike, HEAD_DEPTH_WIDE)).toBeLessThan(headSeparation(lexical));
  });

  it('says nothing when the two heads stand out equally', () => {
    // The same distribution twice is the fixed point of the ratio: **two channels with nothing to choose between**, and
    // a weight of one is the answer rather than the fallback.
    expect(
      qppVectorWeight(
        lexical,
        lexical.map((hit) => ranked(hit.node, hit.score)),
      ),
    ).toBeCloseTo(1, 12);
  });

  it('stays inside the bounds the sweeps scored', () => {
    const flat = [ranked(A, 1), ranked(B, 1), ranked(C, 1), ranked(D, 1)];
    const sharp = [ranked(E, 1), ranked(B, 0), ranked(A, 0), ranked(F, 0)];
    expect(qppVectorWeight(flat, sharp)).toBeLessThanOrEqual(FUSION_WEIGHT_BOUNDS.max);
    expect(qppVectorWeight(sharp, flat)).toBeGreaterThanOrEqual(FUSION_WEIGHT_BOUNDS.min);
    expect(qppVectorWeight(flat, sharp, HEAD_DEPTH_WIDE)).toBeLessThanOrEqual(
      FUSION_WEIGHT_BOUNDS.max,
    );
  });

  it('returns the neutral weight when one channel is empty, because there is no comparison to make', () => {
    expect(qppVectorWeight(lexical, [])).toBe(1);
    expect(qppVectorWeight([], vector)).toBe(1);
  });
});

describe('the tie-break reads the evidence the tie was computed from', () => {
  // **A reciprocal rank is a small integer over a small denominator**, so ties are common in fusion - and §29 already
  // paid once for a tie broken by insertion order. These three cases are the three rungs of the ladder: the same fused
  // score and the same lexical score leaves the vector score to decide, and two documents identical in every scored
  // field are ordered by identity so that the result is a function of the corpus and not of the walk.
  const tied = [ranked(A, 10), ranked(B, 10)];
  const crossed = [ranked(B, 0.9), ranked(A, 0.5)];

  it('falls to the lexical score when the fused scores tie', () => {
    const fused = fuseByRule('rrf', [ranked(A, 20), ranked(B, 10)], crossed);
    // Both documents appear once at rank 1 and once at rank 2, so the fused scores are equal and `alpha`'s better
    // lexical score decides.
    expect(fused[0]!.combinedScore).toBeCloseTo(fused[1]!.combinedScore, 12);
    expect(fused[0]!.node.id).toBe(A.id);
  });

  it('falls to the vector score when the fused and lexical scores both tie', () => {
    const fused = fuseByRule('rrf', tied, crossed);
    // Equal lexical scores, equal fused scores, and `beta` is the vector list's first answer: **the tie is decided by
    // the cosine**, which is the number one of the two contributions was computed from.
    expect(fused[0]!.node.id).toBe(B.id);
    expect(fused[0]!.vectorScore).toBeGreaterThan(fused[1]!.vectorScore);
  });

  it('falls to identity when every scored field ties', () => {
    const fused = fuseByRule('rrf', tied, []);
    // Nothing distinguishes them, so the order has to be stable across runs - the property `compareNodeIdentity` exists
    // for, and the reason a determinism test alone cannot see this branch.
    expect(fused.map((entry) => entry.node.id)).toEqual([A.id, B.id]);
  });
});

describe('every rule returns the union of the two lists, once each', () => {
  it('never duplicates a document and never drops one', () => {
    for (const rule of FUSION_RULE_NAMES) {
      const fused = fuseByRule(rule, lexical, vector);
      const ids = fused.map((hit) => hit.node.id);
      expect(new Set(ids).size, rule).toBe(ids.length);
      // **Both lists contribute six distinct documents**, and a rule that dropped the one it disagreed with most would
      // score better on recall by never being wrong about it - which is the competition's failure mode, not a fix.
      expect(new Set(ids)).toEqual(new Set([...lexical, ...vector].map((hit) => hit.node.id)));
    }
  });

  it('keeps the first rank of a document a channel named twice', () => {
    // `fuseResults` documents that a duplicate is only possible through a direct call, and a direct call is what this
    // module is for: **the second occurrence must not overwrite the first's rank**, or a list that repeats its best
    // answer would push that answer down.
    const repeated = [ranked(A, 30), ranked(A, 12), ranked(B, 9)];
    const fused = fuseByRule('rrf', repeated, []);
    const alpha = fused.find((entry) => entry.node.id === A.id)!;
    expect(alpha.combinedScore).toBeCloseTo(1 / 61, 12);
  });

  it('honours a limit by prefix, not by subset', () => {
    for (const rule of FUSION_RULE_NAMES) {
      const full = fuseByRule(rule, lexical, vector).map((hit) => hit.node.id);
      const limited = fuseByRule(rule, lexical, vector, { limit: 3 }).map((hit) => hit.node.id);
      expect(limited, rule).toEqual(full.slice(0, 3));
    }
  });
});
