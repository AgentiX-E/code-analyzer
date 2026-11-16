/**
 * **Two runs over two slices of one corpus, read as one experiment.**
 *
 * A registration may name more than one slice - `skip 50 max 100` and `skip 150 max 100` are the two disjoint halves of
 * one two-hundred-pull-request corpus - and the effect measured on either half is an estimate of the same effect. Adding
 * the rows makes the corpus twice as large, which halves the standard deviation a bar has to clear, which is the only
 * way this project's existing budget produces a signable result: **R-32's +0.0296 is 1.97 sigma on 100 rows and about
 * 2.8 on 200.**
 *
 * **Merging is not concatenation.** Three things have to hold or the sum is a number about nothing: the slices must not
 * overlap, the configuration must be identical, and every slice must say where it started. Each refusal names what
 * failed, because the three want three different repairs - a dispatch that overlapped, a dispatch of a different device,
 * and an artifact from before slices were recorded.
 */

const deepEqual = (left, right) => {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null)
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => deepEqual(left[key], right[key]));
};

const rowsOf = (artifact) =>
  Array.isArray(artifact?.coverage?.byPullRequest) ? artifact.coverage.byPullRequest : [];

/**
 * **The merged artifact**, with its totals derived from the rows rather than from the totals of its parts.
 *
 * Deriving them matters: two artifacts can publish totals that do not match their rows - an artifact written before
 * `shippedEmitted` existed, or one whose totals were written beside its rows - and a merge that added the totals would
 * carry both errors into the corpus the bar is computed on.
 */
export function mergeSlices(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length < 2) {
    throw new TypeError(
      'merging slices needs at least two artifacts; one slice is a run, not a merge',
    );
  }

  const seen = new Map();
  const slices = [];
  const rows = [];

  for (const [at, artifact] of artifacts.entries()) {
    const slice = artifact?.corpusSlice;
    if (slice === null || typeof slice !== 'object' || !Number.isFinite(Number(slice.skip))) {
      throw new Error(
        `artifact ${String(at)} does not carry corpusSlice.skip, so there is no record of which rows it read and nothing to merge it on`,
      );
    }
    slices.push({ skip: Number(slice.skip), max: Number(slice.requested) });

    if (at > 0 && !deepEqual(artifacts[0].configuration, artifact.configuration)) {
      throw new Error(
        `artifact ${String(at)} was produced by a different configuration than artifact 0, so merging them would describe a device that never ran`,
      );
    }

    for (const row of rowsOf(artifact)) {
      const key = String(row?.pr);
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        throw new Error(
          `pull request ${key} appears in both artifact ${String(earlier)} and artifact ${String(at)}, so the merged corpus would weigh it twice`,
        );
      }
      seen.set(key, at);
      rows.push(row);
    }
  }

  const totals = rows.reduce(
    (sum, row) => {
      const covered = Array.isArray(row?.covered) ? row.covered.length : 0;
      const shipped = Number(row?.shippedEmitted);
      const goldens = Number(row?.goldens);
      return {
        tp: sum.tp + covered,
        fp: sum.fp + Math.max(0, (Number.isFinite(shipped) ? shipped : covered) - covered),
        fn: sum.fn + Math.max(0, (Number.isFinite(goldens) ? goldens : covered) - covered),
      };
    },
    { tp: 0, fp: 0, fn: 0 },
  );

  const goldens = totals.tp + totals.fn;
  const precision = totals.tp + totals.fp === 0 ? 0 : totals.tp / (totals.tp + totals.fp);
  const recall = goldens === 0 ? 0 : totals.tp / goldens;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const first = artifacts[0];
  return {
    ...first,
    corpus: first.corpus,
    prsInDataset: rows.length,
    datasetRows: rows.length,
    prsReviewed: rows.length,
    corpusRead: { requested: rows.length, unread: 0, whole: true },
    // **Both slices named**, which is what a registration naming both is matched against.
    corpusSlice: { slices, skip: slices[0].skip, requested: rows.length },
    truePositives: totals.tp,
    falsePositives: totals.fp,
    falseNegatives: totals.fn,
    precision,
    recall,
    f1,
    fullEmission: { k: totals.tp + totals.fp },
    coverage: { byPullRequest: rows },
    /**
     * **The merge itself, recorded**, because a corpus assembled from two dispatches has to be able to say which ones -
     * and because a reader comparing this artifact's `prsReviewed` with either of its inputs needs the arithmetic.
     */
    mergedFrom: artifacts.map((artifact, at) => ({
      slice: slices[at],
      pullRequests: rowsOf(artifact).length,
      truePositives: Number(artifact?.truePositives ?? 0),
      falsePositives: Number(artifact?.falsePositives ?? 0),
      falseNegatives: Number(artifact?.falseNegatives ?? 0),
    })),
  };
}
