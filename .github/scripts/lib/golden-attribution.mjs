// **Why a golden was missed, as five disjoint buckets, because "recall 0.2059" is a number and not a diagnosis.**
//
// The run of 2026-11-09 emitted 199 findings, matched 41 of the corpus's 196 expert-confirmed issues, and reported
// `recall 0.2412` at full emission. **That number is compatible with at least three different defects**, and every
// optimisation aimed at the wrong one wastes an iteration:
//
//   1. **The golden's file was never sent to the engine** - a path filter, a diff section that did not survive the
//      split, a corpus row whose file the pull request does not touch. **The fix is a filter or an input, not a prompt.**
//   2. **The file was read and the lane said nothing on it** - a recall defect in the reading. **The fix is the lane.**
//   3. **The lane spoke on that file about something else** - a targeting defect. **The fix is what the lane is asked
//      to look for, or the judge's notion of "the same defect".**
//
// **The three imply disjoint work, and the artifact could not separate them**, because `issueTexts` was built by mapping
// the note text out of each comment and discarding the `path` and `from_line` that travelled beside it. **A measurement
// that keeps the answer but drops its coordinates cannot say where the answer was.**

/** The five buckets, in the order they are decided. Each names a fix; none of them names a number. */
export const GOLDEN_BUCKETS = [
  /** A finding was emitted that the judge accepted as describing this issue. */
  'hit',
  /** The corpus row carries no path, so no attribution is possible. A corpus defect, not a review defect. */
  'noPath',
  /** The path exists but was never handed to the engine - the diff split, the path filter, or the pull request's files. */
  'fileNotReviewed',
  /** The file was read and the lanes emitted nothing on it. A recall defect in the reading. */
  'noFindingOnPath',
  /** The lanes emitted on that file, and none of it was accepted as this issue. A targeting defect. */
  'findingOnPathRejected',
];

/**
 * **A path in the normal form the diff and the corpus can both be compared in.**
 *
 * The diff headers carry `a/` and `b/` prefixes and the corpus carries repository-relative paths, so a comparison that
 * does not normalise reports every golden as `fileNotReviewed` - **the same class of false reading as a filter that
 * compares line numbers against the wrong file**, and the reason this function exists rather than an inline `===`.
 */
export function normalisePath(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^\.\//, '')
    .replace(/^[ab]\//, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

/**
 * Attribute every golden in one pull request to exactly one bucket.
 *
 * `goldens` carry `{ path, note }` as the corpus states them; `reviewedPaths` is the set of paths the engine was actually
 * given; `findings` is the ranked list with a `path` each; `matches` is `matches[finding] = [golden indices]` as the
 * judge returned it. **A golden is `hit` when any finding matched it**, which is deliberately not the maximum matching:
 * the question here is "did we say something accepted about this issue", and the matching is what the score uses.
 *
 * **The return value is a partition or an error.** `total` is `goldens.length` or the function throws, because a
 * bookkeeping table whose rows do not add up is a table that will silently lose a bucket one refactor from now.
 */
export function attributeGoldens({ goldens, reviewedPaths, findings, matches }) {
  const reviewed = new Set(Array.from(reviewedPaths ?? [], normalisePath).filter(Boolean));
  const findingPaths = (findings ?? []).map((entry) => normalisePath(entry?.path));

  const hitBy = new Map();
  (matches ?? []).forEach((goldenIndices, finding) => {
    for (const golden of goldenIndices ?? []) {
      if (!hitBy.has(golden)) hitBy.set(golden, []);
      hitBy.get(golden).push(finding);
    }
  });

  const counts = Object.fromEntries(GOLDEN_BUCKETS.map((bucket) => [bucket, 0]));
  const perGolden = [];
  for (const [index, golden] of (goldens ?? []).entries()) {
    const path = normalisePath(golden?.path);
    let bucket;
    if (hitBy.has(index)) bucket = 'hit';
    else if (path === '') bucket = 'noPath';
    else if (!reviewed.has(path)) bucket = 'fileNotReviewed';
    else if (!findingPaths.includes(path)) bucket = 'noFindingOnPath';
    else bucket = 'findingOnPathRejected';
    counts[bucket] += 1;
    perGolden.push({
      index,
      bucket,
      path,
      // **The note is kept short.** The artifact is read by a person deciding what to fix next, and a bucket whose
      // examples are four hundred characters of prose is a bucket nobody reads.
      note: String(golden?.note ?? '').slice(0, 160),
      matchedFindings: hitBy.get(index) ?? [],
    });
  }

  const total = GOLDEN_BUCKETS.reduce((sum, bucket) => sum + counts[bucket], 0);
  if (total !== (goldens ?? []).length) {
    throw new Error(
      `attribution is not a partition: ${total} buckets for ${goldens?.length} goldens`,
    );
  }
  return { counts, perGolden, total };
}

/**
 * Merge per-pull-request attributions into the run's table.
 *
 * **Examples are capped per bucket rather than per pull request**, because the artifact's job is to let a reader see the
 * shape of a bucket at a glance; **a hundred examples of `fileNotReviewed` are not a hundred times the information**, and
 * they are the difference between an artifact someone opens and one someone downloads.
 */
export function mergeAttributions(entries, { examplesPerBucket = 5 } = {}) {
  const counts = Object.fromEntries(GOLDEN_BUCKETS.map((bucket) => [bucket, 0]));
  const examples = Object.fromEntries(GOLDEN_BUCKETS.map((bucket) => [bucket, []]));
  let total = 0;
  for (const entry of entries ?? []) {
    for (const bucket of GOLDEN_BUCKETS) {
      counts[bucket] += Number(entry?.counts?.[bucket] ?? 0);
      total += Number(entry?.counts?.[bucket] ?? 0);
    }
    for (const golden of entry?.perGolden ?? []) {
      const bucket = golden.bucket;
      if (!examples[bucket] || examples[bucket].length >= examplesPerBucket) continue;
      examples[bucket].push({
        pr: entry.pr ?? null,
        path: golden.path,
        note: golden.note,
      });
    }
  }
  return { counts, examples, total };
}

/** The bucket with the most goldens in it, or `null` for an empty table - the one line a reader needs first. */
export function largestBucket(counts) {
  let best = null;
  for (const bucket of GOLDEN_BUCKETS) {
    const value = Number(counts?.[bucket] ?? 0);
    if (value === 0) continue;
    if (best === null || value > best.count) best = { bucket, count: value };
  }
  return best;
}
