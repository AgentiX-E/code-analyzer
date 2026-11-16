/**
 * **What a second corpus the same size would move the figure by**, computed from one artifact instead of argued about.
 *
 * Every artifact the benchmark writes carries its figure per pull request: how many goldens that row had, which of them
 * we covered, and how many comments we posted on it. Those three numbers are a whole row of the contingency table, so
 * the rows can be resampled - with replacement, keeping each pull request's three numbers together - and F1 recomputed
 * from the resampled totals on every draw. The spread of that distribution is the answer to "how much of this figure is
 * the corpus".
 *
 * **Why a cluster bootstrap and not a per-golden one.** Goldens inside one pull request are not independent: a reviewer
 * that understood the file covers several of them, and a reviewer that missed the file misses several. Resampling
 * goldens would treat 715 draws as 715 independent observations and return a standard error about three times too
 * small - an error bar that flatters every device. The pull request is the unit that was sampled, so it is the unit that
 * gets resampled.
 *
 * **Why the paired difference is the number a registration needs.** Two arms read the same 98 pull requests, so the
 * difference between them on a given draw is computed from two figures over the same rows; the corpus that makes one
 * arm look good makes both look good. The spread of that difference is smaller than the sum of the two spreads by
 * however much the arms are correlated, and it is the spread the registration's bar has to clear.
 */

/**
 * **`shippedEmitted`, not `emitted`.**
 *
 * `emitted` is the full emission before the actionability gate and the per-pull-request budget; `shippedEmitted` is
 * what was posted. On R-31's lanes arm those are 1110 and 638, and reading the first one counts 472 comments that the
 * budget discarded as false positives - which drops that arm's F1 from 0.2055 to 0.1523 and makes the arm that lost
 * appear to win. **A field named `emitted` that means "considered" is the kind of name that flips a sign.**
 *
 * A row that carries only `emitted` is still read, with `estimated: true`, rather than refused: an old artifact is
 * evidence of something, and the caller can decide whether it wants it. What is not allowed is silence about which one
 * was used.
 */
export function perPullRequestOutcome(row) {
  if (row === null || typeof row !== 'object') {
    throw new TypeError(`a coverage row must be an object, received ${JSON.stringify(row)}`);
  }
  const covered = Array.isArray(row.covered) ? row.covered : [];
  const tp = covered.length;
  const declared = Number(row.goldens);
  const goldens = Number.isFinite(declared) ? declared : tp;
  const shipped = Number(row.shippedEmitted);
  const full = Number(row.emitted);
  const posted = Number.isFinite(shipped) ? shipped : Number.isFinite(full) ? full : tp;
  const outcome = {
    tp,
    fp: Math.max(0, posted - tp),
    fn: Math.max(0, goldens - tp),
  };
  if (!Number.isFinite(shipped)) outcome.estimated = true;
  return outcome;
}

/** F1 from the three counts, because `2PR / (P + R)` and `2TP / (2TP + FP + FN)` are the same number. */
export function f1From(tp, fp, fn) {
  const truePositives = Number(tp);
  const falsePositives = Number(fp);
  const falseNegatives = Number(fn);
  if (![truePositives, falsePositives, falseNegatives].every(Number.isFinite)) {
    throw new TypeError('f1From needs three finite counts');
  }
  const denominator = 2 * truePositives + falsePositives + falseNegatives;
  return denominator === 0 ? 0 : (2 * truePositives) / denominator;
}

/** A 32-bit generator with a seed, because an instrument whose answer depends on `Math.random` cannot be re-run. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value) => Math.round(value * 10_000) / 10_000;

/**
 * **Resample the pull requests, not the goldens.**
 *
 * The two arrays are aligned: `withRows[i]` and `withoutRows[i]` are the same pull request read by two arms. Unequal
 * lengths are refused rather than truncated, because a paired test over the shorter of two corpora is a test that has
 * already decided which rows it can lose.
 */
export function clusterBootstrapDelta(withRows, withoutRows, { resamples = 2000, seed = 20_260_816 } = {}) {
  if (!Array.isArray(withRows) || !Array.isArray(withoutRows)) {
    throw new TypeError('a paired bootstrap needs two arrays of coverage rows');
  }
  if (withRows.length !== withoutRows.length) {
    throw new Error(
      `a paired bootstrap needs one row per pull request on both sides, received ${String(withRows.length)} and ${String(withoutRows.length)}`,
    );
  }
  if (withRows.length === 0) throw new Error('a paired bootstrap over zero pull requests is not a measurement');
  if (!Number.isInteger(resamples) || resamples < 1) {
    throw new Error(`resamples must be a positive integer, received ${JSON.stringify(resamples)}`);
  }

  const withOutcomes = withRows.map(perPullRequestOutcome);
  const withoutOutcomes = withoutRows.map(perPullRequestOutcome);
  const estimated = withOutcomes.some((row) => row.estimated) || withoutOutcomes.some((row) => row.estimated);
  const count = withOutcomes.length;
  const next = mulberry32(seed);
  const deltas = new Array(resamples);

  for (let draw = 0; draw < resamples; draw += 1) {
    let withTp = 0;
    let withFp = 0;
    let withFn = 0;
    let withoutTp = 0;
    let withoutFp = 0;
    let withoutFn = 0;
    for (let pick = 0; pick < count; pick += 1) {
      const index = Math.floor(next() * count);
      const a = withOutcomes[index];
      const b = withoutOutcomes[index];
      withTp += a.tp;
      withFp += a.fp;
      withFn += a.fn;
      withoutTp += b.tp;
      withoutFp += b.fp;
      withoutFn += b.fn;
    }
    deltas[draw] = f1From(withTp, withFp, withFn) - f1From(withoutTp, withoutFp, withoutFn);
  }

  const mean = deltas.reduce((sum, value) => sum + value, 0) / resamples;
  const variance = deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / resamples;
  const sorted = [...deltas].sort((left, right) => left - right);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)))];

  const result = {
    sd: round(Math.sqrt(variance)),
    mean: round(mean),
    lower: round(at(0.025)),
    upper: round(at(0.975)),
    positiveRate: round(deltas.filter((value) => value > 0).length / resamples),
    resamples,
    pullRequests: count,
    goldens: withOutcomes.reduce((sum, row) => sum + row.tp + row.fn, 0),
  };
  if (estimated) result.estimated = true;
  return result;
}

/**
 * **The resolution of one comparison on this corpus**: the spread of the paired difference, which is what a bar has to
 * clear. Returned as a number so a registration can be checked against it without knowing how it was computed.
 */
export function corpusResolution(withRows, withoutRows, options) {
  return clusterBootstrapDelta(withRows, withoutRows, options).sd;
}

/** How many pull requests a given resolution costs, for the question "could a smaller bar be bought instead". */
export function pullRequestsForResolution(resolution, { anchor = null } = {}) {
  const target = Number(resolution);
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error(`resolution must be a positive number, received ${JSON.stringify(resolution)}`);
  }
  const source = anchor ?? { pullRequests: 98, deltaSd: 0.0191 };
  return Math.ceil(source.pullRequests * (source.deltaSd / target) ** 2);
}
