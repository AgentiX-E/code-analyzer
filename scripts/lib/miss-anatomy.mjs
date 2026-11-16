/**
 * **Where the next twenty points of F1 are, read out of an artifact rather than guessed from one.**
 *
 * Every iteration of this campaign has ended with the same question - *what do the misses say the next device should be* -
 * and the answer has been read by hand: fifty missed goldens, one at a time, and a paragraph about what they had in
 * common (§47.1, §57.4). That method found the idiom lane and the snapshot defect, and it costs an afternoon per read.
 *
 * **This module makes the first pass arithmetic.** A missed golden is already attributed to a bucket
 * (`golden-attribution.mjs`); this splits the largest bucket - *we said something on this path and the judge did not
 * accept it* - by **who was standing next to it**:
 *
 * - `neighbour: 'true-positive'` means our nearest comment **on the same path** matched a *different* golden. The site
 *   was right, the concern was a different one, and the device that closes it is one that says more than one true thing
 *   where more than one thing is wrong.
 * - `neighbour: 'false-positive'` means our nearest comment was not accepted by anything. The site was right and the
 *   sentence was wrong, so the device that closes it is a better sentence, not a second one.
 *
 * **The two answers send the next iteration to different code**, and no figure in the artifact distinguishes them: both
 * are `findingOnPathRejected`, both cost one false negative and one false positive, and both are consistent with the same
 * precision and the same recall. **A diagnostic that cannot tell two repairs apart is not a diagnostic**, which is why
 * this exists as arithmetic rather than as the paragraph it replaces.
 */

/** The distance bands the attribution already records, as bands rather than as raw numbers. */
const SAME_LINE = 0;
const NEAR = 10;

/**
 * **The nearest finding to a golden, found by the text the artifact carries rather than by the index it carries.**
 *
 * `missedGoldens.records[].nearestFinding.at` looks like an index into `rankedFindings` and **is not one**: checked
 * against the artifact of `43795692468`, the `at` field names a different line in every one of fifty sampled records, so
 * a reader who trusted it would attribute every miss to an unrelated comment. The text and the line do line up, and
 * `meta.unlinked` reports the cases where they do not, because **a linkage that silently returns nothing would report
 * "every neighbour is a false positive" for an artifact whose fields had been renamed.**
 */
function linkNeighbours(ranked) {
  const byText = new Map();
  for (const finding of ranked) {
    // **The line and the first sixty characters, because the record does not carry a finding id.** The path is checked
    // after the lookup rather than in the key: a golden's nearest finding is on the golden's own path by construction,
    // so a mismatch means the text matched a comment on some other file and the link is wrong.
    const key = `${String(finding?.startLine ?? '')}\u0000${String(finding?.text ?? '').slice(0, 60)}`;
    if (!byText.has(key)) byText.set(key, finding);
  }
  return (record) => {
    const nearest = record?.nearestFinding;
    if (!nearest) return null;
    const key = `${String(nearest.startLine ?? '')}\u0000${String(nearest.text ?? '').slice(0, 60)}`;
    const found = byText.get(key) ?? null;
    if (found === null) return null;
    return String(found.path ?? '') === String(record?.path ?? '') ? found : null;
  };
}

const band = (proximity) => {
  if (proximity === SAME_LINE) return 'sameLine';
  if (typeof proximity === 'number' && proximity <= NEAR) return 'near';
  return 'beyond';
};

/**
 * **The decomposition, as counts that add up.**
 *
 * `rejected` is the number of rejects the caller can check against the artifact's own bucket count, and every reject
 * lands in exactly one cell of `matrix` - so a table whose rows do not sum to `rejected` is a table that has lost a row,
 * and `unlinked` is reported rather than folded into a cell.
 */
export function decomposeMisses(bench) {
  const records = Array.isArray(bench?.missedGoldens?.records) ? bench.missedGoldens.records : [];
  const ranked = Array.isArray(bench?.rankedFindings) ? bench.rankedFindings : [];
  const neighbourOf = linkNeighbours(ranked);

  const matrix = {
    sameLine: { 'true-positive': 0, 'false-positive': 0 },
    near: { 'true-positive': 0, 'false-positive': 0 },
    beyond: { 'true-positive': 0, 'false-positive': 0 },
  };
  const buckets = {};
  let rejected = 0;
  let unlinked = 0;

  for (const record of records) {
    const bucket = String(record?.bucket ?? 'unknown');
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    if (bucket !== 'findingOnPathRejected') continue;
    rejected += 1;
    const neighbour = neighbourOf(record);
    if (neighbour === null) {
      unlinked += 1;
      continue;
    }
    const matched = Array.isArray(neighbour.matchedGoldens) ? neighbour.matchedGoldens.length : 0;
    matrix[band(record?.proximity)][matched > 0 ? 'true-positive' : 'false-positive'] += 1;
  }

  const sum = Object.values(matrix).reduce(
    (total, row) => total + row['true-positive'] + row['false-positive'],
    0,
  );
  const truePositiveNeighbour = Object.values(matrix).reduce(
    (total, row) => total + row['true-positive'],
    0,
  );

  return {
    goldens: records.length,
    buckets,
    rejected,
    unlinked,
    /** Every reject lands in one cell, or this table has lost one - see `reconciles`. */
    reconciled: sum + unlinked === rejected,
    matrix,
    /**
     * **The share of rejected goldens whose own site already had an accepted comment of ours.** High means the reviewer
     * is finding one issue per site and the site had several; low means the sentence is the problem, not the count.
     */
    neighbourIsAccepted:
      rejected === 0 ? 0 : Math.round((truePositiveNeighbour / rejected) * 1000) / 1000,
    /** What the reviewer said nothing about, which no rewriting of a comment can reach. */
    silence: {
      pathNotInPull: buckets['pathNotInPull'] ?? 0,
      notReviewed: buckets['fileNotReviewed'] ?? 0,
      noFindingOnPath: buckets['noFindingOnPath'] ?? 0,
    },
  };
}

/**
 * **The one line a person reads**, derived from the object above rather than assembled beside it - the same rule the
 * bench follows for its console output, for the same reason: two descriptions of one number drift.
 */
export function describeMisses(anatomy) {
  const { rejected, matrix, silence, neighbourIsAccepted } = anatomy;
  if (rejected === 0) return 'no golden was rejected on a path we commented on';
  const same = matrix.sameLine['true-positive'] + matrix.sameLine['false-positive'];
  const sameAccepted = matrix.sameLine['true-positive'];
  return (
    `${String(rejected)} rejected on a path we commented on · ${String(same)} on our own line ` +
    `(${String(sameAccepted)} beside an accepted comment, ${String(same - sameAccepted)} beside one nothing accepted) · ` +
    `${(neighbourIsAccepted * 100).toFixed(1)} % of rejects sit beside a true positive · ` +
    `silence ${String(silence.noFindingOnPath)} on a path we read, ${String(silence.notReviewed)} on a file we never read, ` +
    `${String(silence.pathNotInPull)} on a file the pull request no longer has`
  );
}
