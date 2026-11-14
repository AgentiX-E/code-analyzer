// **The corpus's arithmetic, applied to the verdicts this repository already paid for.**
//
// `Alibaba-Aone/aacr-bench/docs/metrics.md` defines the file-level semantic metric that replaced per-comment matching.
// Three rules of it are not the ones the harness in `../aacr-bench.mjs` was computing:
//
//   1. **Grouping is by normalised path, one judge call per generated comment, with every reference comment of that file
//      in a numbered list.** Diff side and line number are context the judge is shown, not filters.
//   2. **One generated comment may cover several reference comments.** One-to-many, deduplicated for recall.
//   3. **Precision is a greedy walk in generation order**: a comment counts only when it covers at least one reference
//      comment that nothing before it covered (`hit_new_gt`). A duplicate hit is in the denominator and not the
//      numerator, so restating a covered defect costs exactly what a wrong comment costs.
//
// **Rule 2 is where the old figure went wrong, and it is not a rounding difference.** A maximum matching over pairs
// credits one comment with one issue; a hand-annotated corpus restates issues constantly - three reviewers, three
// sentences, one defect - and the file-level metric counts that as three. This repository's published F1 was therefore
// an understatement of the corpus's own metric in one direction and, because a rejected pair was scored as a false
// positive while the protocol would have hidden it inside a wider list, not always in the same direction.
//
// **What this module does not do is replace the judge.** The verdicts below still come from a pairwise call, because
// that call is already paid for and swapping the judge is a separate decision with its own price. So the figure this
// produces is the corpus's *arithmetic over our verdicts*: one of the two differences removed, the other named in
// `judge` so an artifact cannot be mistaken for an official score.

/** **The procedure this arithmetic implements**, written into every artifact that reports a figure from it. */
export const FILE_SEMANTIC_PROTOCOL = 'file-level-semantic-v1';

/** How the matches were decided, which is the half of the protocol this module does not own. */
export const FILE_SEMANTIC_JUDGE = 'pairwise-over-numbered-list';

/**
 * **The path both sides mean, so a diff prefix is not a different file.**
 *
 * The same normalisation `golden-attribution` applies and for the same reason: the engine's paths come out of a diff and
 * the corpus's come out of an annotation, and a grouping that treats `a/src/x.ts` and `src/x.ts` as two files reports
 * every reference comment on every file as missed while every figure still adds up.
 */
export function normaliseFilePath(path) {
  return String(path ?? '')
    .trim()
    .replace(/^\.\//, '')
    .replace(/^[ab]\//, '')
    .replace(/^\/+/, '');
}

/**
 * **One file's comments and one file's reference comments, in arrival order.**
 *
 * Order is preserved rather than sorted: the precision walk below is defined over the order the reviewer emitted, and a
 * grouping that reordered would change the score of a run that had not changed.
 */
export function groupByPath({ findings, goldens }) {
  const groups = new Map();
  const groupFor = (path) => {
    const key = normaliseFilePath(path);
    let group = groups.get(key);
    if (group === undefined) {
      group = { findings: [], goldens: [] };
      groups.set(key, group);
    }
    return group;
  };
  for (const entry of goldens) groupFor(entry.path).goldens.push(entry);
  for (const entry of findings) groupFor(entry.path).findings.push(entry);
  return groups;
}

/**
 * **The score, in the corpus's own terms.**
 *
 * `matches[i]` is the list of reference-comment indices finding `i` matched, exactly as `judgeMatrix` returns them. The
 * arithmetic is the only thing that changes: the verdicts are not re-read, re-judged or re-ordered.
 *
 * **A cross-file verdict is refused rather than banked.** A pairwise judge is shown one reference comment and one
 * comment and no path, so it can call two files' statements the same defect; the file-level protocol shows the judge
 * one file's list and cannot reach that answer. Counting it would report a recall the official evaluator will not
 * reproduce, so it is dropped, and the comment still costs precision because the corpus counts every comment emitted.
 * **That errs against us, which is the only direction a self-report may err in.**
 */
export function scoreFileSemantic({ findings, goldens, matches }) {
  const groups = groupByPath({ findings, goldens });

  // **The golden's group, by its global index**, computed once: the same reference comment judged from two files' lists
  // is still one reference comment, and an index-keyed map is the only way to make the walk agree with itself.
  //
  // **A golden whose path is unknown is `null` rather than a group**, and it is the one case where a cross-file verdict
  // is not refused: the corpus's own `noPath` rows exist, and a recorded competitor row carries golden *indices* but not
  // their paths - so refusing those verdicts would charge the recorded arm for a coordinate this repository failed to
  // store three runs ago. **An unknown path is not an accusation**, and the count travels in the result so a figure
  // computed with the refusal disabled cannot be read as one computed with it.
  const groupOfGolden = new Array(goldens.length);
  let at = 0;
  for (const [, group] of groups) {
    for (let index = 0; index < group.goldens.length; index += 1) {
      groupOfGolden[at + index] =
        normaliseFilePath(group.goldens[index].path) === '' ? null : group;
    }
    at += group.goldens.length;
  }

  // **The comment's own index, so a verdict is looked up by position rather than by searching for the object.** A list
  // of five hundred comments searched once per comment is arithmetic nobody notices and a report that takes longer than
  // the run that produced it; and an index-keyed map makes the "same comment twice" case impossible to mis-attribute.
  const indexOfFinding = new Map(findings.map((entry, index) => [entry, index]));

  const covered = new Set();
  let hitNewGt = 0;
  let duplicateHits = 0;
  let crossFileVerdicts = 0;

  // **File-major, then generation order inside the file**, because that is the order the protocol walks: the lists are
  // per file, and within a file the reviewer's own order decides which comment is the duplicate.
  for (const [, group] of groups) {
    for (const entry of group.findings) {
      const index = indexOfFinding.get(entry);
      const verdict = Array.isArray(matches[index]) ? matches[index] : [];
      let boughtSomethingNew = false;
      for (const goldenIndex of verdict) {
        if (!Number.isInteger(goldenIndex) || goldenIndex < 0 || goldenIndex >= goldens.length)
          continue;
        // **The verdict is about a reference comment this comment's file cannot see**, which the file-level protocol
        // cannot produce - see the note above.
        const owner = groupOfGolden[goldenIndex];
        if (owner !== null && owner !== group) {
          crossFileVerdicts += 1;
          continue;
        }
        if (covered.has(goldenIndex)) continue;
        covered.add(goldenIndex);
        boughtSomethingNew = true;
      }
      if (boughtSomethingNew) hitNewGt += 1;
      else if (verdict.length > 0) duplicateHits += 1;
    }
  }

  return finish({
    findings: findings.length,
    goldens: goldens.length,
    hitNewGt,
    duplicateHits,
    coveredGoldens: covered.size,
    crossFileVerdicts,
    unlocatedGoldens: goldens.filter((entry) => normaliseFilePath(entry.path) === '').length,
  });
}

/** The four counts the corpus's rates are computed from, turned into the rates. */
function finish(counts) {
  const precision = counts.findings === 0 ? 0 : counts.hitNewGt / counts.findings;
  const recall = counts.goldens === 0 ? 0 : counts.coveredGoldens / counts.goldens;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    protocol: FILE_SEMANTIC_PROTOCOL,
    judge: FILE_SEMANTIC_JUDGE,
    ...counts,
    precision,
    recall,
    f1,
  };
}

/**
 * **The corpus's figure, which is the counts added and then divided - never the per-pull figures averaged.**
 *
 * **This is the arithmetic error that makes a benchmark report flatter a small pull request**, and it is the one this
 * repository has had to remove from three other tables: a pull request with two reference comments and one with forty
 * contribute equally to a mean of rates and contribute what they are worth to a ratio of counts. The corpus defines the
 * rates over totals (`matched_generated_notes / generated_notes`), so the totals are what is added.
 */
export function scoreCorpusFileSemantic({ pulls }) {
  const total = {
    findings: 0,
    goldens: 0,
    hitNewGt: 0,
    duplicateHits: 0,
    coveredGoldens: 0,
    crossFileVerdicts: 0,
    unlocatedGoldens: 0,
  };
  for (const pull of pulls) {
    const score = scoreFileSemantic(pull);
    for (const key of Object.keys(total)) total[key] += score[key];
  }
  return finish(total);
}
