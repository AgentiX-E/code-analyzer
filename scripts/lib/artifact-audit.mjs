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
  //
  // **An empty table is right exactly when nothing was emitted at the gated operating point**, and the run of
  // `43162733527` is why that case has to be spelled out: the reading agent's three findings were all below the
  // actionability gate, so the gated set was empty, the decomposition of it was empty, and this check failed a run whose
  // artifact was correct. **A gate that fails on a legitimate zero is a gate that gets switched off**, so the zero is
  // admitted rather than the check removed - a run that scored true positives and published no rows still fails.
  const byCategory = artifact?.byCategory;
  const rows = Array.isArray(byCategory?.rows) ? byCategory.rows : [];
  const nothingGated =
    Number(artifact?.truePositives ?? -1) === 0 && Number(artifact?.falsePositives ?? -1) === 0;
  record(
    'byCategory is a decomposition, not a sample',
    nothingGated || (rows.length > 0 && byCategory?.totals?.agrees === true),
    rows.length === 0
      ? nothingGated
        ? 'nothing reached the gated operating point, so there is nothing to decompose'
        : 'no byCategory rows'
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
    nothingGated ||
      (rows.length > 0 &&
        Number.isFinite(emitted) &&
        rows.every(
          (row) =>
            Number(row?.falsePositives ?? -1) ===
            Number(row?.emitted ?? 0) - Number(row?.truePositives ?? 0),
        )),
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
  // **A ceiling that contains a golden we found is not a ceiling.** Our own attribution files a golden under `hit` when
  // any of our findings was accepted against it, so a `hit` inside `bothMissed` means the two lists were read by
  // different rules - which is the defect the first version of this field had, at 20 goldens on a 258-golden slice.
  const foundIt = Array.isArray(bothMissed)
    ? bothMissed.filter((row) => row?.ourBucket === 'hit')
    : [];
  record(
    'the ceiling holds no golden either side found',
    foundIt.length === 0,
    foundIt.length === 0
      ? 'no golden in bothMissed is filed under `hit`'
      : `${String(foundIt.length)} goldens in bothMissed are filed under \`hit\` by our own attribution`,
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

  // **7. Every rejection names the finding it rejected, because a bucket without its evidence is a bucket whose
  // diagnosis has to be bought again.** `findingOnPathRejected` is the largest bucket in the ceiling and, until this
  // iteration, the only thing an artifact said about it was how far away the nearest finding was: 100 of the 164 sit on
  // the golden's own line, and *which* finding that was, and whether the actionability gate kept it, could not be read.
  const rejections = Array.isArray(records)
    ? records.filter((row) => row?.bucket === 'findingOnPathRejected')
    : [];
  const named = rejections.filter(
    (row) => row?.nearestFinding !== null && typeof row?.nearestFinding === 'object',
  );
  record(
    'every rejected golden names the finding it rejected',
    rejections.length === 0 || named.length === rejections.length,
    `${String(named.length)} of ${String(rejections.length)} rejections carry the finding they were measured against`,
  );
  record(
    'the rejections with a finding on their line are counted',
    rejections.length === 0 ||
      named.every((row) => Number.isInteger(Number(row?.nearestFinding?.at ?? Number.NaN))),
    `${String(named.filter((row) => Number(row?.proximity) === 0).length)} of ${String(rejections.length)} rejections sit on a finding's own line`,
  );

  // **8. Every scored pull request is either replayed, recorded, failed or missing.** The run of 2026-11-11 reported
  // `prsFailed: 4`, `recorded: 32` and **named one failure**: three attempts existed as a number, contributed no goldens
  // to the competitor's denominator, and could not be looked up, so thirty-six pull requests were scored against a
  // competitor whose rows accounted for thirty-three of them. **A count that does not partition into the rows beside it
  // is the same defect as a figure that does not follow from its rows**, one level up - and it cost this repository
  // 0.0130 of F1 the first time it happened.
  //
  // **The denominator is the corpus the run scored, not `prsAttempted`** - that field counts the pull requests this run
  // went and bought, and the first version of this check compared the two and read `36 accounted for of 4 attempted`
  // on a run that was entirely correct. **A check whose premise is wrong reports a defect in the artifact rather than in
  // itself**, which is why the run that found it was the run that made the number legible.
  const theirs = artifact?.secondReviewer ?? {};
  const corpusSize = Number(
    artifact?.coverage?.byPullRequest?.length ?? artifact?.prsInDataset ?? 0,
  );
  const failed = Array.isArray(theirs.failedPullRequests) ? theirs.failedPullRequests.length : 0;
  const missing = Array.isArray(theirs.missing) ? theirs.missing.length : 0;
  const accounted = Number(theirs.recorded ?? 0) + Number(theirs.replayed ?? 0) + failed + missing;
  // **And a run whose competitor arm was switched off is not asked to account for rows it never had.** `off` is the one
  // mode that produces no rows on purpose, so a partition over the corpus would report the corpus as unaccounted rather
  // than the arm as removed.
  const switchedOff = String(theirs.mode ?? '') === 'off';
  // **And a run that says `off` has to be a run that did nothing.** The exemption above would otherwise hide the defect
  // it was written beside: the `on` arm of 2026-11-12 published `mode: "off"` with `prsAttempted: 36` and 258 competitor
  // rows, because the decision chain fell through to the live branch for a mode whose entire purpose is to remove the
  // arm. **A switched-off arm that spent money is worse than one that is missing**, and only a check that reads the two
  // fields together can say so.
  record(
    'the arm that is switched off runs nothing',
    !switchedOff ||
      (Number(theirs.prsAttempted ?? 0) === 0 &&
        failed === 0 &&
        Number(theirs.recorded ?? 0) + Number(theirs.replayed ?? 0) === 0),
    switchedOff
      ? `mode off, ${String(theirs.prsAttempted ?? 0)} attempted, ${String(failed)} failed, ${String(accounted)} accounted rows`
      : 'the arm was not switched off',
  );
  record(
    'every scored pull request is either replayed, recorded, failed or missing',
    switchedOff || corpusSize === 0 || accounted === corpusSize,
    switchedOff
      ? 'the competitor arm was switched off for this run'
      : corpusSize === 0
        ? 'no corpus in this artifact'
        : `${String(accounted)} accounted for of ${String(corpusSize)} scored (${String(theirs.recorded ?? 0)} recorded, ${String(theirs.replayed ?? 0)} replayed, ${String(failed)} failed, ${String(missing)} missing)`,
  );

  // **9. And every failure that was counted is a failure that can be read.** `prsFailed` and the length of the failure
  // list are two writers of one fact, which is exactly the drift this module exists to catch.
  record(
    'the failures that were counted are the failures that were named',
    corpusSize === 0 || Number(theirs.prsFailed ?? 0) === failed,
    `${String(theirs.prsFailed ?? 0)} counted, ${String(failed)} named`,
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
  const recorded = Number(artifact?.secondReviewer?.recorded ?? 0);
  return {
    mode,
    rows: theirs.length,
    withText: withText.length,
    coverage: theirs.length === 0 ? 0 : withText.length / theirs.length,
    /**
     * **`record` means this run paid for the competitor's output and must keep it** - but only for the rows it paid for.
     *
     * **The first version of this flag asked every row of a recording run to carry text, and the run of 2026-11-12
     * failed on it while being entirely correct**: the record it started from predates the field, so it replayed
     * thirty-two rows and bought one, and `1 of 282 competitor rows carry text` was the arithmetic of the mechanism
     * working rather than of a defect. **A check that fails the thing it was written to protect is a check with a wrong
     * premise**, and the premise is that a `record` run's rows were all recorded - which stopped being true the moment
     * the replay mechanism started working.
     */
    mustBeComplete: mode === 'record' && recorded > 0 && withText.length === 0,
  };
}
