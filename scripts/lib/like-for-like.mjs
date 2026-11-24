// @code-analyzer — Two reviewers, one row set, one scorer
//
// **A headline on one corpus and a published number on another are not a comparison, and neither is a subtraction
// across row sets.** §121.2 wrote that rule and §121.3 turned it into a gate for the figures in `benchmarks/`; §140.5
// then printed a margin of "+10.19 against the competitor's tool on our own rows" which was `31.44` on fifty pull
// requests minus `21.25` on forty-seven - two row sets and one instrument apart. This module is what replaces that
// sentence: **the same rows, the same code, both sides.**
//
// Three arithmetic decisions are made here and none of them is a modelling choice:
//
// 1. **The row set is the intersection**, and the pull requests that fall outside it are returned by name rather than
//    dropped, because a comparison whose exclusions are invisible is a comparison that can be tuned by accident.
// 2. **The golden count belongs to the row set**, so both sides are scored against the same reference comments. A
//    recall computed per side from its own misses would rise every time a side missed fewer - which is the defect
//    `scripts/lib/operating-point.mjs` already refuses for cuts.
// 3. **Each side is cut the way that side shipped**, taken from the data and not from an option: ours by the
//    `actionable` flag, theirs by its own `keep` list. Comparing our full emission with their shipped cut, or the
//    reverse, is the other way this comparison can be made to say anything.

import { scoreFileSemantic } from '../../.github/scripts/lib/file-semantic.mjs';
import { applyCut, maximumMatchingByPullRequest, parseCut } from './operating-point.mjs';

/**
 * **The cut this repository ships, spelled once.**
 *
 * `actionable` is the gate, not the policy: the shipped point also drops `test`, drops the test path class and keeps the
 * twelve highest-scored comments per pull request, and the artifact's own headline is that point. **Comparing the gate
 * against a competitor's shipped cut is comparing a larger emission against a smaller one** - two things at once, which
 * is the failure this module exists to prevent.
 */
export const OUR_SHIPPED_CUT = 'drop:test+drop-path:test+budget:12';

const pullOf = (row) => String(row?.['pr'] ?? '');

/**
 * **The rows both artifacts hold, and the ones each of them holds alone.**
 *
 * Order is the competitor's, because its baseline is the frozen one: the figures this module produces must not move
 * when a row is appended to one side's artifact.
 */
export function sharedRows(ourFindings, competitorBaseline) {
  const pulls = competitorBaseline?.pulls ?? {};
  const byPull = new Map();
  for (const row of ourFindings) {
    const key = pullOf(row);
    const bucket = byPull.get(key);
    if (bucket === undefined) byPull.set(key, [row]);
    else bucket.push(row);
  }

  const rows = [];
  for (const [key, theirs] of Object.entries(pulls)) {
    const ours = byPull.get(key);
    if (ours !== undefined)
      rows.push({ pr: key, goldens: Number(theirs?.['goldens'] ?? 0), ours, theirs });
  }
  const shared = new Set(rows.map((row) => row.pr));

  return {
    rows,
    goldens: rows.reduce((total, row) => total + row.goldens, 0),
    onlyThisRepository: [...byPull.keys()].filter((key) => !shared.has(key)),
    onlyTheCompetitor: Object.keys(pulls).filter((key) => !shared.has(key)),
  };
}

/**
 * **Our side's shipped cut, and the competitor's, read from the artifacts rather than chosen here.**
 *
 * `actionable` is the flag the emission policy writes on every finding it keeps; `keep` is the competitor harness's own
 * per-comment decision, positionally aligned with its `matches` and `detail` lists. A baseline without `keep` is
 * treated as "everything it emitted shipped", which is the honest reading of an artifact that does not say.
 */
export function shippedCut(row) {
  const keep = row.theirs?.['keep'];
  const matches = row.theirs?.['matches'] ?? [];
  const detail = row.theirs?.['detail'] ?? [];
  const findings = [];
  for (const [at, goldens] of matches.entries()) {
    if (Array.isArray(keep) && keep[at] !== true) continue;
    findings.push({
      pr: row.pr,
      path: detail[at]?.['path'] ?? '',
      matchedGoldens: goldens ?? [],
    });
  }
  return {
    theirFindings: findings,
    ourFindings: applyCut(row.ours, parseCut(OUR_SHIPPED_CUT)),
  };
}

/**
 * **One side under both arithmetics.**
 *
 * The pairwise instrument is the corpus's own protocol: one finding to one golden, resolved by a maximum bipartite
 * matching per pull request, with `F1 = 2·TP/(C+G)`. The file-shaped one is `file-level-semantic-v1`, reached by
 * calling `scoreFileSemantic` - **a second implementation of a score is a second score**.
 *
 * **`goldens` is the row set's, never the side's.** The reference comments exist whether or not a reviewer found them,
 * and the denominator is the whole of the recall claim.
 */
export function scoreSide({ findings, goldens }) {
  const emitted = findings.length;
  const protocolTp = maximumMatchingByPullRequest(
    findings,
    (finding) => finding.matchedGoldens ?? [],
  );

  const denominator = Math.max(Number(goldens) || 0, 1);
  const protocol = {
    tp: protocolTp,
    precision: emitted === 0 ? 0 : protocolTp / emitted,
    recall: protocolTp / denominator,
    f1: (2 * protocolTp) / Math.max(emitted + denominator, 1),
  };

  /**
   * **Two corpus readings, and the second one exists on one side only.**
   *
   * `corpus` is the file-shaped walk over the pairwise verdicts - the reading both artifacts can produce, and the one a
   * gap may be drawn from. `filed` is the same walk over the second instrument's per-finding verdicts, which only a run
   * that bought `file_semantic_judge` has. **The competitor's artifact carries no comment text**, so its verdicts cannot
   * be re-asked per file at any price; `filed` is therefore reported beside the comparison and never subtracted from it.
   */
  const corpus = corpusWalk(findings, goldens, (finding) => finding.matchedGoldens ?? []);
  const filed =
    findings.some((finding) => Array.isArray(finding.fileLevelGoldens)) === true
      ? corpusWalk(
          findings,
          goldens,
          (finding) => finding.fileLevelGoldens ?? finding.matchedGoldens ?? [],
        )
      : null;
  return { emitted, goldens, protocol, corpus, filed };
}

/** The corpus's walk, called and not reimplemented - a second implementation of a score is a second score. */
function corpusWalk(findings, goldens, matchesOf) {
  const byPull = new Map();
  for (const finding of findings) {
    const key = pullOf(finding);
    const bucket = byPull.get(key);
    if (bucket === undefined) byPull.set(key, [finding]);
    else bucket.push(finding);
  }
  const placeholders = Array.from({ length: Math.max(Number(goldens) || 0, 0) }, () => ({
    path: '',
  }));
  let hitNewGt = 0;
  let coveredGoldens = 0;
  for (const bucket of byPull.values()) {
    const score = scoreFileSemantic({
      findings: bucket,
      goldens: placeholders,
      matches: bucket.map(matchesOf),
    });
    hitNewGt += score.hitNewGt;
    coveredGoldens += score.coveredGoldens;
  }
  const emitted = findings.length;
  const denominator = Math.max(Number(goldens) || 0, 1);
  const precision = emitted === 0 ? 0 : hitNewGt / emitted;
  const recall = coveredGoldens / denominator;
  return {
    hitNewGt,
    coveredGoldens,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

/**
 * **The comparison, or the refusal.**
 *
 * An empty intersection is not a comparison of zero against zero: it is the absence of a comparison, and a table
 * printed from it would put two `0.0000`s beside each other and invite a reader to draw a gap between them.
 */
export function likeForLike({ ourFindings, competitorBaseline }) {
  const shared = sharedRows(ourFindings, competitorBaseline);
  if (shared.rows.length === 0)
    throw new Error(
      'the two artifacts share no pull request, so there is no row set to compare them on; a figure drawn from ' +
        'this would be two zeros in the same table',
    );

  const ourShipped = [];
  const theirShipped = [];
  for (const row of shared.rows) {
    const cut = shippedCut(row);
    ourShipped.push(...cut.ourFindings);
    theirShipped.push(...cut.theirFindings);
  }

  return {
    pullRequests: shared.rows.length,
    goldens: shared.goldens,
    onlyThisRepository: shared.onlyThisRepository,
    onlyTheCompetitor: shared.onlyTheCompetitor,
    sides: {
      ours: scoreSide({ findings: ourShipped, goldens: shared.goldens }),
      theirs: scoreSide({ findings: theirShipped, goldens: shared.goldens }),
    },
  };
}

/**
 * **Precision at matched volume, which is the test §86.3 registered and the one a cap has to pass.**
 *
 * The competitor posts about two and a half comments per pull request; this repository posts about eight. §86.3 named
 * the statistic that would say whether the gap is volume: *cut our list to the number they post and re-score; if
 * precision at that volume is at least twice precision at ours, the gap is volume.* **A cap therefore has to be scored,
 * not argued**, and the cut is by the reviewer's own score because that is the ordering the product ships.
 *
 * **The volume is a total and not a per-pull-request fraction**, because a fraction cannot hit an arbitrary number:
 * `floor` of it leaves the run short and `ceil` overshoots, and both make the comparison one of volume *and* of
 * rounding. The allocation below reaches the requested total exactly - an even share to every pull request, then one
 * more to the pull requests whose next comment scores highest - so the two sides post the same number of comments.
 */
export function atVolume({ findings, goldens, total }) {
  const wanted = Math.max(0, Math.floor(Number(total) || 0));
  const byPull = new Map();
  for (const finding of findings) {
    const key = pullOf(finding);
    const bucket = byPull.get(key);
    if (bucket === undefined) byPull.set(key, [finding]);
    else bucket.push(finding);
  }
  const ordered = [...byPull.values()].map((bucket) =>
    [...bucket].sort((left, right) => Number(right?.score ?? 0) - Number(left?.score ?? 0)),
  );
  const base = ordered.length === 0 ? 0 : Math.floor(wanted / ordered.length);
  const remainder = ordered.length === 0 ? 0 : wanted - base * ordered.length;

  const capped = [];
  for (const bucket of ordered) capped.push(...bucket.slice(0, base));
  const extras = ordered
    .filter((bucket) => bucket.length > base)
    .map((bucket) => ({ bucket, next: Number(bucket[base]?.['score'] ?? 0) }))
    .sort((left, right) => right.next - left.next)
    .slice(0, remainder);
  for (const extra of extras) capped.push(extra.bucket[base]);
  return scoreSide({ findings: capped, goldens });
}
