/**
 * **A defect shape is a property of a golden the corpus has already categorised, not a keyword over every note.**
 *
 * `§178.3` published a four-shape table as a partition of the 209 `Code Defect` goldens of the pinned 50-pull-request
 * board. The table was computed by keyword over all 452 `missedGoldens.records` **without joining the corpus's own
 * `category`**, so `Maintainability and Readability` notes - "typo in variable name", "use `std::ranges::find_if` for
 * clarity", "add parentheses for readability" - were counted as `Code Defect` misses. A diagnostic that mixes two of
 * the corpus's categories cannot tell the reviewer which bucket to work on.
 *
 * This module makes the join the table skipped. It categorises a record by `pr#goldenIndex` from the corpus, keeps
 * only `Code Defect` goldens, classifies those by keyword over the note, and reports the contamination the unfiltered
 * reading would have added. Every classification is a keyword partition over the note - a pointer at where to look,
 * not the corpus's own taxonomy - and a record that matches no keyword is left unclassified rather than invented.
 */

/** The four shapes `S63` targets, in the order §178.3 published them. */
export const DEFECT_SHAPES = Object.freeze({
  error_path: [
    'error path',
    'error-path',
    'unhandled',
    'no test',
    'error handling',
    'exception',
    'catch',
    'throw',
  ],
  boundary: [
    'boundary',
    'null',
    'undefined',
    'dereference',
    'out of bounds',
    'off-by-one',
    'guard',
    'edge case',
    'empty',
    'bounds',
  ],
  counterpart: [
    'counterpart',
    'disagree',
    'inconsist',
    'both',
    'two side',
    'mismatch',
    'duplicate',
    'out of sync',
  ],
  state: [
    'initiali',
    'releas',
    'lock',
    'unlock',
    'dispose',
    'state never',
    'leak',
    'uninitialized',
  ],
});

const CODE_DEFECT = 'Code Defect';

/** `pr#goldenIndex` -> category, built from the corpus the run scored. */
function categoryIndex(corpus) {
  const index = new Map();
  for (const row of Array.isArray(corpus) ? corpus : []) {
    const pr = row?.githubPrUrl;
    if (typeof pr !== 'string') continue;
    (Array.isArray(row?.comments) ? row.comments : []).forEach((comment, at) => {
      index.set(`${pr}#${String(at)}`, String(comment?.category ?? 'uncategorized'));
    });
  }
  return index;
}

/** The shapes a note names. A note with none is left unclassified; a note with several is counted in each. */
function shapesOf(note) {
  const text = String(note ?? '').toLowerCase();
  return Object.keys(DEFECT_SHAPES).filter((shape) =>
    DEFECT_SHAPES[shape].some((keyword) => text.includes(keyword)),
  );
}

/**
 * The category-aware partition of one artifact's missed goldens.
 *
 * `reconciled` is the guard that matters: every `Code Defect` record lands in `hit`, exactly one or more shape cells,
 * or `none` - and a table where those do not add back to `total` has lost a row and may not be published.
 */
export function classifyDefectShapes({ artifact, corpus } = {}) {
  const records = Array.isArray(artifact?.missedGoldens?.records)
    ? artifact.missedGoldens.records
    : [];
  const categories = categoryIndex(corpus);

  const shapes = Object.fromEntries(
    Object.keys(DEFECT_SHAPES).map((name) => [name, { hit: 0, miss: 0, rate: 0 }]),
  );
  const buckets = {};
  let total = 0;
  let multi = 0;
  let none = 0;
  let rejected = 0;
  let contamination = 0;

  for (const record of records) {
    const category = categories.get(`${String(record?.pr)}#${String(record?.goldenIndex)}`);
    if (category === undefined) continue;
    if (category !== CODE_DEFECT) {
      contamination += 1;
      continue;
    }
    total += 1;
    const bucket = String(record?.bucket ?? 'unknown');
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    const hit = bucket === 'hit';
    if (bucket === 'findingOnPathRejected') rejected += 1;
    const matched = shapesOf(record?.note);
    if (matched.length === 0) none += 1;
    if (matched.length > 1) multi += 1;
    for (const shape of matched) {
      shapes[shape][hit ? 'hit' : 'miss'] += 1;
    }
  }

  for (const shape of Object.keys(shapes)) {
    const cell = shapes[shape];
    const denom = cell.hit + cell.miss;
    cell.rate = denom === 0 ? 0 : Math.round((cell.miss / denom) * 1000) / 1000;
  }

  // Every golden is a hit, a shape (possibly several) or unclassified; hits and none are disjoint from shapes only by
  // the notes that matched nothing, so reconcile by counting classified + unclassified goldens, not shape-cell sums.
  const classified = records.reduce((count, record) => {
    const category = categories.get(`${String(record?.pr)}#${String(record?.goldenIndex)}`);
    return category === CODE_DEFECT && shapesOf(record?.note).length > 0 ? count + 1 : count;
  }, 0);
  const reconciled = classified + none === total;

  return {
    allRecords: records.length,
    /** Records the unfiltered §178.3 reading would have counted but whose own category is not Code Defect. */
    contamination,
    codeDefect: {
      total,
      buckets,
      rejected,
      shapes,
      multi,
      none,
      reconciled,
    },
  };
}

/** A one-line, quotable description of the partition for the artifact and the docs. */
export function describeDefectShapes(result) {
  const cd = result.codeDefect;
  const parts = Object.entries(cd.shapes).map(
    ([name, cell]) => `${name} ${cell.hit}/${cell.miss} (${(cell.rate * 100).toFixed(1)} %)`,
  );
  return `Code Defect ${String(cd.total)} goldens · ${String(cd.rejected)} rejected · ${parts.join(' · ')} · contamination ${String(result.contamination)}`;
}
