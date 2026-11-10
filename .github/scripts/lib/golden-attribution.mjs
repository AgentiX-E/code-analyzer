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

// **`findingOnPathRejected` is two defects wearing one name, and the run of 2026-11-10 showed which one it is.**
//
// "The lanes spoke on that file and the judge did not accept it" is compatible with two unrelated failures:
//
//   1. **Targeting** - the lane discussed a different line, so the review read the right file and looked elsewhere.
//      The fix is what the lane is asked to look for.
//   2. **Wording** - the lane stood on the golden's own lines and described the same place in words the judge would not
//      call the same defect. **The fix is the sentence, not the search.**
//
// **The golden's `from_line` and the finding's range were both already in hand and were never compared**, which is the
// same class of omission as the discarded `path` this module was written to repair: *a measurement that keeps the text
// and drops the coordinate cannot say whether the text was in the right place.* The distance below is that coordinate,
// and it costs no model call because both sides were already paid for.

/**
 * **The four shapes a rejection can take, decided by how far the golden is from the nearest finding on its own file.**
 *
 * The thresholds are not decoration: `0` is *"the finding's range covers the golden's line"*, `10` is the span a reviewer
 * reading a screen would still call the same location, and `50` is far enough that nobody would. **`beyond50` is what a
 * targeting defect looks like**, and the first two are what a wording defect looks like.
 */
export const REJECTION_SHAPES = ['sameLine', 'within10', 'beyond50', 'noLine'];

/** Which shape one rejection has, given the distance from its golden to the nearest finding on the same path. */
export function rejectionShapeOf(distance) {
  if (distance === null || distance === undefined) return 'noLine';
  if (distance <= 0) return 'sameLine';
  if (distance <= 10) return 'within10';
  return 'beyond50';
}

/**
 * **How far the nearest finding on this path is from the golden, in lines, or `null` when neither side has a number.**
 *
 * A finding that spans the golden's line is at distance `0` rather than at the distance between its start and the golden,
 * because **a range that covers a line is on that line** and reporting the offset from its first line would file every
 * multi-line finding under `within10` or worse. **The distance is to the nearer edge**, so a finding that begins forty
 * lines below a golden and runs to sixty is forty away and not twenty.
 */
export function nearestFindingDistance(goldenLine, findings) {
  const line = toLine(goldenLine);
  if (line === null) return null;
  let best = null;
  for (const finding of findings ?? []) {
    // **The range, wherever the caller keeps it.** The bench script ranks `{ path, finding: { startLine }, score }`
    // while a test writes `{ path, startLine }`, and **a reading that only understands one of them reports `noLine` for
    // every rejection in the corpus** - empty, plausible, and wrong. This is the shape of defect the dry run caught
    // before the run that would have published it.
    const span = finding?.finding ?? finding;
    const start = toLine(span?.startLine);
    const end = toLine(span?.endLine);
    const low = start ?? end;
    if (low === null) continue;
    const high = end ?? low;
    const distance = line >= low && line <= high ? 0 : Math.min(Math.abs(line - low), Math.abs(line - high));
    if (best === null || distance < best) best = distance;
  }
  return best;
}

/**
 * **A line number, or `null` - never zero.**
 *
 * `Number(null)` is `0`, and `0` is finite, so a range written as `{ startLine: null }` would arrive here as a finding
 * that starts at line zero and **every golden would be measured against it at its own line number** - a rejection
 * filed under `beyond50` because the finding had no coordinates at all. **The test that caught this was written before
 * the implementation ran**, which is the only reason the reading is right.
 */
function toLine(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

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
    const onPath = (findings ?? []).filter((entry) => normalisePath(entry?.path) === path);
    let bucket;
    if (hitBy.has(index)) bucket = 'hit';
    else if (path === '') bucket = 'noPath';
    else if (!reviewed.has(path)) bucket = 'fileNotReviewed';
    else if (onPath.length === 0) bucket = 'noFindingOnPath';
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
      // **Only meaningful for a rejection**, and left `null` everywhere else so that a reader cannot mistake a `hit`'s
      // zero for a coincidence that did not happen.
      proximity: bucket === 'findingOnPathRejected' ? nearestFindingDistance(golden?.startLine, onPath) : null,
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
  const rejectionShape = Object.fromEntries(REJECTION_SHAPES.map((shape) => [shape, 0]));
  let total = 0;
  for (const entry of entries ?? []) {
    for (const bucket of GOLDEN_BUCKETS) {
      counts[bucket] += Number(entry?.counts?.[bucket] ?? 0);
      total += Number(entry?.counts?.[bucket] ?? 0);
    }
    for (const golden of entry?.perGolden ?? []) {
      const bucket = golden.bucket;
      // **The shape table is a second reading of the same row, not a sixth bucket**: every rejected golden contributes
      // one to exactly one shape and every other bucket contributes to none, so the shape counts sum to
      // `counts.findingOnPathRejected` - **the property `rejectionShapeTotal` is asserted against below.**
      if (bucket === 'findingOnPathRejected') rejectionShape[rejectionShapeOf(golden.proximity)] += 1;
      if (!examples[bucket] || examples[bucket].length >= examplesPerBucket) continue;
      examples[bucket].push({
        pr: entry.pr ?? null,
        path: golden.path,
        note: golden.note,
      });
    }
  }
  // **A second table over the same rows is a second chance to lose one**, so it is checked the same way the partition
  // is: the shapes must add up to the bucket they re-read, or the reading is wrong and the artifact says so.
  const shapeTotal = REJECTION_SHAPES.reduce((sum, shape) => sum + rejectionShape[shape], 0);
  if (shapeTotal !== counts.findingOnPathRejected) {
    throw new Error(
      `rejection shapes do not add up: ${shapeTotal} for ${counts.findingOnPathRejected} rejected goldens`,
    );
  }
  return { counts, examples, total, rejectionShape };
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

/**
 * **The shape most rejections have, in one line, because "98 rejected" and "73 of them within ten lines" are different
 * sentences about different work.** Ties are broken by the declared order, as `largestBucket` does, so that a table read
 * twice does not name two fixes.
 */
export function dominantRejectionShape(rejectionShape) {
  let best = null;
  for (const shape of REJECTION_SHAPES) {
    const value = Number(rejectionShape?.[shape] ?? 0);
    if (value === 0) continue;
    if (best === null || value > best.count) best = { shape, count: value };
  }
  return best;
}
