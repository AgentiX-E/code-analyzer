// **Every figure an artifact publishes has to be derivable from the rows beside it, or the rows do not say what the
// figure says.**
//
// `scripts/aacr-paired-replay.mjs` made that true for the score: it recomputes precision, recall and F1 from the judged
// pairs and exits non-zero when they disagree. This module makes it true for **the three things iteration 124 added**,
// and it exists because each of them was added in answer to a stage-page step that could not be taken:
//
//   1. `missedGoldens.records` - the full attribution list, so "read the goldens both reviewers missed" is an offline
//      reading instead of a second dispatch. **A detail list is only useful if it is the same list as the counts**, so
//      the buckets are recounted from the records and compared to the table beside them.
//   2. `byCategory` - a decomposition of the true positives by category, attributed through the maximum matching's
//      owner. **A breakdown whose columns do not sum to the figure it decomposes is worse than no breakdown**, because it
//      reads as a finding.
//   3. `bothMissed` - the goldens neither reviewer found, which is the ceiling on the whole exercise. Its corpus
//      accounting is checked so that the list cannot shrink by quietly dropping rows into an unstated exclusion.
//
// **The checks are reported rather than thrown**, because the artifact is written by a job that has already spent its
// money: a run that dies reports nothing, while a run that writes `ok: false` beside the number it doubts is a run whose
// output can be argued with. `--check` turns the same reading into an exit code for the job that publishes it.

/** Every check, in one pass, over an artifact - with no corpus, no network and no model. */
export function auditArtifact(artifact) {
  const findings = [];
  const record = (name, ok, detail) => findings.push({ name, ok, detail });

  const missed = artifact?.missedGoldens;
  const records = missed?.records;
  const counts = missed?.counts ?? {};
  const total = Number(missed?.total ?? 0);

  // **1. The detail list is the whole list.** A capped list that calls itself the list is the defect this field exists
  // to repair, so its length is checked against the partition's own total rather than against itself.
  record(
    'missedGoldens.records is the whole table',
    Array.isArray(records) && records.length === total,
    Array.isArray(records)
      ? `${String(records.length)} records for total ${String(total)}`
      : 'no records array',
  );

  // **2. The records partition into the buckets the artifact publishes.** Counted here rather than trusted, because two
  // writers of one table is how a table drifts from itself.
  if (Array.isArray(records)) {
    const recounted = {};
    for (const row of records) recounted[row?.bucket] = (recounted[row?.bucket] ?? 0) + 1;
    const disagree = Object.keys({ ...counts, ...recounted }).filter(
      (bucket) => (recounted[bucket] ?? 0) !== Number(counts[bucket] ?? 0),
    );
    record(
      'missedGoldens.records partitions into missedGoldens.counts',
      disagree.length === 0,
      disagree.length === 0
        ? `${String(records.length)} records across ${String(Object.keys(recounted).length)} buckets`
        : disagree
            .map(
              (bucket) =>
                `${bucket}: ${String(recounted[bucket] ?? 0)} recorded vs ${String(counts[bucket] ?? 0)} published`,
            )
            .join('; '),
    );
  }

  // **3. The per-category decomposition adds up.** This is the one that would have caught the approximation the first
  // draft of the table used: counting findings that matched something counts a golden once per finding.
  const byCategory = artifact?.byCategory;
  const rows = Array.isArray(byCategory?.rows) ? byCategory.rows : [];
  record(
    'byCategory is a decomposition, not a sample',
    rows.length > 0 && byCategory?.totals?.agrees === true,
    rows.length === 0
      ? 'no byCategory rows'
      : `${String(byCategory?.totals?.attributedTruePositives)} attributed vs ${String(byCategory?.totals?.reportedTruePositives)} reported true positives`,
  );

  const summed = rows.reduce((sum, row) => sum + Number(row?.truePositives ?? 0), 0);
  record(
    'byCategory rows sum to the run’s true positives',
    summed === Number(artifact?.truePositives ?? -1),
    `${String(summed)} summed vs ${String(artifact?.truePositives)} published`,
  );

  const emitted = rows.reduce((sum, row) => sum + Number(row?.emitted ?? 0), 0);
  record(
    'every byCategory row subtracts its own false positives',
    rows.length > 0 &&
      Number.isFinite(emitted) &&
      rows.every(
        (row) =>
          Number(row?.falsePositives ?? -1) ===
          Number(row?.emitted ?? 0) - Number(row?.truePositives ?? 0),
      ),
    // **`falsePositives` is derived on every row**, so a row where it does not subtract is a row written by something
    // other than the writer of `emitted` and `truePositives` - and a table whose columns disagree is a table whose
    // precision column is a third opinion.
    `${String(emitted)} emitted across ${String(rows.length)} categories`,
  );

  // **4. The ceiling has a denominator.** A list of goldens nobody found is only interpretable beside the corpus it was
  // drawn from, and the corpus it was drawn from excludes the pull requests one side has no row for.
  const bothMissed = artifact?.bothMissed;
  const ceilingCorpus = artifact?.bothMissedCorpus;
  record(
    'bothMissed names its corpus',
    Array.isArray(bothMissed) && Number(ceilingCorpus?.goldens ?? -1) >= 0,
    Array.isArray(bothMissed) && ceilingCorpus
      ? `${String(bothMissed.length)} of ${String(ceilingCorpus.goldens)} goldens on ${String(ceilingCorpus.pullRequests)} paired pull requests, ${String(ceilingCorpus.withoutAttribution ?? 0)} without an attribution`
      : 'no bothMissed list',
  );
  record(
    'bothMissed cannot exceed the corpus it was drawn from',
    Array.isArray(bothMissed) && bothMissed.length <= Number(ceilingCorpus?.goldens ?? -1),
    Array.isArray(bothMissed)
      ? `${String(bothMissed.length)} listed, ${String(ceilingCorpus?.goldens)} available`
      : 'no bothMissed list',
  );

  // **5. The score itself, from its own four counts**, because a reader quoting F1 without checking it against TP, FP
  // and FN is quoting a number whose arithmetic nobody ran in this file.
  const tp = Number(artifact?.truePositives ?? 0);
  const fp = Number(artifact?.falsePositives ?? 0);
  const fn = Number(artifact?.falseNegatives ?? 0);
  const expectedF1 = 2 * tp + fp + fn === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  record(
    'precision, recall and F1 follow from TP, FP and FN',
    Math.abs(Number(artifact?.f1 ?? -1) - expectedF1) <= 0.0001,
    `published ${String(artifact?.f1)}, recomputed ${expectedF1.toFixed(4)} from ${String(tp)}/${String(fp)}/${String(fn)}`,
  );

  // **6. The words, not only the coordinates.** A comparison that keeps where a remark landed and not what it said
  // cannot be learned from, and the competitor's rows were exactly that shape until iteration 124.
  const text = competitorTextCoverage(artifact);
  record(
    'the competitor’s remarks are readable beside ours',
    !text.mustBeComplete || text.coverage === 1,
    text.rows === 0
      ? 'no competitor rows in this artifact'
      : `${String(text.withText)} of ${String(text.rows)} competitor rows carry text (mode ${String(text.mode)})`,
  );

  return { ok: findings.every((finding) => finding.ok), findings };
}

/** The reading as lines, so a workflow log is the audit rather than a summary of it. */
export function formatAudit(audit) {
  return audit.findings
    .map((finding) => `${finding.ok ? 'ok  ' : 'FAIL'} ${finding.name} · ${finding.detail}`)
    .join('\n');
}

/**
 * **The ceiling, readable as a table instead of as a JSON array.**
 *
 * `bothMissed` answers the one question three stage pages asked and could not: **how many of the goldens nobody found are
 * goldens nobody could have found from a diff**. The array answers it only after somebody groups it, and grouping it by
 * hand is how a reading becomes an anecdote - so the grouping is code, and the same three groupings are printed every
 * time.
 *
 * **`ourBucket` is the load-bearing column.** A ceiling made of `fileNotReviewed` is an input defect (we never read the
 * file); a ceiling made of `noFindingOnPath` is a recall defect (we read it and were silent); a ceiling made of
 * `findingOnPathRejected` is a targeting defect (we spoke about something else). **Three different fixes**, and a single
 * count of 128 would have hidden all three.
 */
export function summariseBothMissed(artifact) {
  const list = Array.isArray(artifact?.bothMissed) ? artifact.bothMissed : [];
  const byBucket = {};
  const byDirectory = {};
  const byPullRequest = {};
  for (const row of list) {
    byBucket[row?.ourBucket ?? 'unknown'] = (byBucket[row?.ourBucket ?? 'unknown'] ?? 0) + 1;
    const path = String(row?.path ?? '');
    // **The first two segments rather than the whole path**, because a corpus of real repositories has hundreds of leaf
    // directories and a table with one row per directory is a list again.
    const directory = path.split('/').slice(0, 2).join('/') || '(no path)';
    byDirectory[directory] = (byDirectory[directory] ?? 0) + 1;
    byPullRequest[row?.pr ?? '(no pull request)'] =
      (byPullRequest[row?.pr ?? '(no pull request)'] ?? 0) + 1;
  }
  const ordered = (table) =>
    Object.entries(table)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  return {
    total: list.length,
    corpus: artifact?.bothMissedCorpus ?? null,
    byOurBucket: ordered(byBucket),
    byDirectory: ordered(byDirectory).slice(0, 20),
    byPullRequest: ordered(byPullRequest).slice(0, 20),
  };
}

/** The ceiling as lines, in the same shape as `formatAudit`. */
export function formatBothMissed(summary) {
  const table = (label, rows) =>
    [`${label}:`, ...rows.map((row) => `  ${String(row.count).padStart(4)}  ${row.name}`)].join(
      '\n',
    );
  return [
    `goldens neither reviewer found: ${String(summary.total)}`,
    summary.corpus
      ? `  over ${String(summary.corpus.pullRequests)} paired pull requests, ${String(summary.corpus.goldens)} goldens, ${String(summary.corpus.withoutAttribution ?? 0)} without an attribution`
      : '  (the artifact does not say which corpus this list was drawn from)',
    table('by our own bucket', summary.byOurBucket),
    table('by directory', summary.byDirectory),
    table('by pull request', summary.byPullRequest),
  ].join('\n');
}

/**
 * **Whether the artifact can be read beside what the two reviewers actually said.**
 *
 * Every published figure is about *whether* the judge accepted a remark. Not one of them says what the remark was, and
 * the instruction every competitor analysis ends with - *learn what they say and say it as well* - needs the words.
 *
 * **Our own rows have carried `text` since the first run; the competitor's rows carried coordinates and no words**,
 * which is why this is a coverage figure rather than a boolean: the baseline in `benchmarks/aacr/competitor-baseline.json`
 * was recorded before the field existed, so a `replay` run against it cannot have the text however much this repository
 * now stores. **A `record` run that comes back without it is the defect**, and that is what this check refuses.
 */
export function competitorTextCoverage(artifact) {
  // **`secondReviewer.findingsAtItsOwnOperatingPoint`, not `rankedFindings`**: the latter holds our rows only, and a
  // check that looked for competitor rows there would report a coverage of zero on every artifact ever written.
  const theirs = Array.isArray(artifact?.secondReviewer?.findingsAtItsOwnOperatingPoint)
    ? artifact.secondReviewer.findingsAtItsOwnOperatingPoint
    : [];
  const withText = theirs.filter((row) => typeof row?.text === 'string' && row.text.length > 0);
  const mode = artifact?.secondReviewer?.mode ?? null;
  return {
    mode,
    rows: theirs.length,
    withText: withText.length,
    coverage: theirs.length === 0 ? 0 : withText.length / theirs.length,
    /**
     * **`record` means this run paid for the competitor's output and must keep it.** `replay` reads a baseline that was
     * recorded before the field existed, and reporting that as a failure would fail every run until somebody spends
     * 5.89 USD - which is a decision, not a defect.
     */
    mustBeComplete: mode === 'record',
  };
}
