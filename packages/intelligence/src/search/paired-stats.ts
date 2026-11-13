// **Whether two rank lists differ by more than the questions they were measured on.**
//
// Every comparison this repository published before this file was an aggregate difference read against a variance band:
// "0.0054 MRR, inside the 0.0085 an identical arm moves on a re-run". **That is a description of the instrument, not a
// test of the effect.** Two runs of the same arm say how much a *number* moves; they say nothing about whether the
// questions behind it moved in a consistent direction, which is the only thing a paired measurement can see.
//
// The CoSQA harness reranks two arms **on the same five hundred questions in the same run**. That design is worth
// nothing if the analysis subtracts two averages: the pairing is thrown away at the last step. This module keeps it -
// **every statistic below is computed per question and then aggregated**, so a question that both arms miss contributes
// nothing rather than being averaged into a denominator.
//
// Two tests, because the two published numbers are different kinds of quantity:
//
// - **`found@10` is a count of correct/incorrect per question**, so the paired test is exact and distribution-free:
//   McNemar on the discordant pairs, which is a binomial test on questions where the arms disagree. **No normal
//   approximation and no resampling** - with tens of discordant pairs an approximation is a guess about a tail.
// - **MRR is a mean of per-question reciprocals**, so the paired test is a bootstrap over questions. It is seeded:
//   **an interval that moves between two analyses of one artifact is not evidence**, and a reader recomputing this
//   document's figures has to get this document's numbers.

/** The cut every published retrieval figure in this repository uses. */
export const MRR_CUT = 10;

/** Resamples for the interval. Two thousand is a 2.5 %-and-97.5 % percentile pair that is stable in its second digit. */
export const BOOTSTRAP_RESAMPLES = 2_000;

/** **A fixed seed**, so that one artifact yields one interval on every machine and in every later analysis. */
export const BOOTSTRAP_SEED = 0x5eed;

/** A rank list: **1-based rank when the answer was returned inside the depth that was scored, `null` when it was not**. */
export type RankList = ReadonlyArray<number | null>;

/** What one arm did on one question, as the two published numbers see it. */
export function reciprocalRank(rank: number | null | undefined, cut: number = MRR_CUT): number {
  // **Zero and a negative are not ranks**: a 1-based counter that never fired and a parser that returned `-1` are both
  // absences, and a reciprocal rank computed from them would be a hit at the front of the list.
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank < 1) return 0;
  return rank <= cut ? 1 / rank : 0;
}

/** Whether the answer was found inside the cut at all. */
export function foundWithin(rank: number | null | undefined, cut: number = MRR_CUT): boolean {
  return typeof rank === 'number' && Number.isFinite(rank) && rank >= 1 && rank <= cut;
}

/**
 * **The exact two-sided McNemar p-value for `onlyA` and `onlyB` discordant pairs.**
 *
 * Under the null the discordant pairs are a coin flip, so the count on one side is `Binomial(onlyA + onlyB, 1/2)` and
 * the two-sided p is twice the smaller tail. **Computed in log space**, because `0.5 ** 900` is zero in floating point
 * and a p-value that underflowed to zero would be reported as exhaustive evidence rather than as a rare tail.
 */
export function mcnemarExact(onlyA: number, onlyB: number): number {
  if (!Number.isInteger(onlyA) || !Number.isInteger(onlyB) || onlyA < 0 || onlyB < 0) {
    throw new Error(`discordant counts must be non-negative integers, got ${onlyA} and ${onlyB}`);
  }
  const pairs = onlyA + onlyB;
  // **No disagreement is no evidence**, and the answer is 1 rather than 0: a test that called an identical pair of arms
  // significant would be the worst possible failure of this file.
  if (pairs === 0) return 1;

  const smaller = Math.min(onlyA, onlyB);
  const logs: number[] = [-pairs * Math.LN2];
  for (let i = 0; i < smaller; i++) {
    logs.push(logs[i]! + Math.log((pairs - i) / (i + 1)));
  }
  const highest = Math.max(...logs);
  const tail = Math.exp(highest) * logs.reduce((sum, value) => sum + Math.exp(value - highest), 0);
  // **Capped at one**: two binomial tails can sum past 1 when the split is even, and a probability above one is a
  // number that gets quoted.
  return Math.min(1, 2 * tail);
}

/**
 * **A rank list as one line of text, so that a published artifact can be analysed by a reader who was not there.**
 *
 * `JSON.stringify` expands five hundred numbers onto five hundred lines and Prettier expands them again, which is how a
 * generated artifact stops being readable as a table. The comma string is the shape this repository already publishes
 * `cuts` in, and it has one property a JSON array does not: **an absence and a rank cannot be confused**, because an
 * absence is `-` rather than `0` or `null` inside a list of numbers.
 */
export function encodeRanks(ranks: RankList): string {
  return ranks.map((rank) => (rank === null ? '-' : String(rank))).join(',');
}

/** The inverse, and **the only place a published column becomes numbers again**. */
export function decodeRanks(text: string, expected?: number): Array<number | null> {
  const ranks =
    text.length === 0
      ? []
      : text.split(',').map((token) => {
          const trimmed = token.trim();
          // **`-` is an absence and `0` is not a rank either**, but only one of them may be published: a decoder that read
          // both as zero would let a writer publish the ambiguity this encoding exists to remove.
          if (trimmed === '-') return null;
          const rank = Number(trimmed);
          if (!Number.isInteger(rank) || rank < 1) {
            throw new Error(`"${trimmed}" is not a rank: expected a 1-based integer or "-"`);
          }
          return rank;
        });
  if (expected !== undefined && ranks.length !== expected) {
    throw new Error(`expected ${expected} ranks, decoded ${ranks.length}`);
  }
  return ranks;
}

/** A deterministic uniform generator, so that one artifact yields one interval. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Nearest-rank percentile of a sorted-agnostic sample, which is the definition the corpora in this repo already use. */
function percentile(sample: ReadonlyArray<number>, share: number): number {
  const ordered = [...sample].sort((left, right) => left - right);
  const at = Math.min(ordered.length - 1, Math.max(0, Math.ceil(share * ordered.length) - 1));
  return ordered[at]!;
}

/** What two arms did, question by question, and whether the difference survives the questions. */
export interface PairedComparison {
  /** Questions in both arms. **A paired test over lists of unequal length is not a paired test.** */
  queries: number;
  /** Mean reciprocal rank of A minus that of B, over the same questions. */
  deltaMrr: number;
  /** 95 % interval for `deltaMrr` from a paired bootstrap. **Contains zero when the arms are not distinguishable.** */
  mrrInterval: [number, number];
  /** Answers found inside the cut, per arm. */
  foundA: number;
  foundB: number;
  /** Questions only A found, and only B found - the two counts the exact test is built from. */
  onlyA: number;
  onlyB: number;
  /** Exact two-sided McNemar p-value for `found@cut`. */
  pValue: number;
  /** `pValue < 0.05`. **A verdict about the questions, not about the product's future.** */
  distinguishable: boolean;
  /** The cut both counts use, carried so a figure cannot be quoted without it. */
  cut: number;
}

/**
 * **Two rank lists, compared on the questions they share.**
 *
 * The bootstrap resamples **questions**, taking each arm's rank from the same draw: that is the whole difference between
 * this and subtracting two means. A question both arms miss is drawn with both misses and moves nothing, which is why
 * the interval here is narrower than a difference of two independent intervals would be - and why the narrower interval
 * is the honest one, since the arms were measured on one set of questions.
 */
export function compareArms(
  a: RankList,
  b: RankList,
  options: { cut?: number; resamples?: number; seed?: number } = {},
): PairedComparison {
  if (a.length !== b.length) {
    throw new Error(`arms must be scored on the same questions, got ${a.length} and ${b.length}`);
  }
  if (a.length === 0) {
    throw new Error('no questions to compare');
  }
  const cut = options.cut ?? MRR_CUT;
  const resamples = options.resamples ?? BOOTSTRAP_RESAMPLES;
  const random = mulberry32(options.seed ?? BOOTSTRAP_SEED);

  const deltas = new Array<number>(a.length);
  let foundA = 0;
  let foundB = 0;
  let onlyA = 0;
  let onlyB = 0;
  let total = 0;
  for (let index = 0; index < a.length; index++) {
    const rankA = a[index]!;
    const rankB = b[index]!;
    const hitA = foundWithin(rankA, cut);
    const hitB = foundWithin(rankB, cut);
    if (hitA) foundA += 1;
    if (hitB) foundB += 1;
    // **Discordance is about the cut, not about the exact rank**: the exact test answers "how often does one arm find
    // an answer the other does not", and a question both arms return at ranks 2 and 3 is not a disagreement.
    if (hitA && !hitB) onlyA += 1;
    if (hitB && !hitA) onlyB += 1;
    const delta = reciprocalRank(rankA, cut) - reciprocalRank(rankB, cut);
    deltas[index] = delta;
    total += delta;
  }

  const means = new Array<number>(resamples);
  for (let resample = 0; resample < resamples; resample++) {
    let sum = 0;
    for (let draw = 0; draw < a.length; draw++) {
      // **The same drawn question for both arms**, which is the pairing: an independent draw per arm would answer a
      // question about two populations rather than about these two lists.
      sum += deltas[Math.floor(random() * a.length)]!;
    }
    means[resample] = sum / a.length;
  }

  const pValue = mcnemarExact(onlyA, onlyB);
  return {
    queries: a.length,
    deltaMrr: total / a.length,
    mrrInterval: [percentile(means, 0.025), percentile(means, 0.975)],
    foundA,
    foundB,
    onlyA,
    onlyB,
    pValue,
    distinguishable: pValue < 0.05,
    cut,
  };
}
