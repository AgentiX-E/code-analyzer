#!/usr/bin/env node
/**
 * **What the competitor's own cut is worth, on verdicts it already sold.**
 *
 * ```
 * node scripts/competitor-cut.mjs \
 *   --baseline benchmarks/aacr/competitor-baseline.json \
 *   --corpus benchmarks/martian/positive_samples.json \
 *   --selection benchmarks/martian-bench.json --profile core \
 *   --guard P=0.1916,R=0.6821,F1=0.2991
 * ```
 *
 * §159.4 claimed the first reading above the bar and named exactly what the claim does not establish: *their `0.2991` is
 * their best of three readings, at whatever emission their pipeline produces, and their curve has not been priced*. The
 * reason it had not been is not that the arithmetic is expensive - every (finding, golden) pair in the record was already
 * judged and paid for - it is that **the record holds the competitor's emission and two different questions can be asked
 * of it**, and the difference between them is larger than any device this repository has shipped this month.
 *
 *   1. **What it ships.** Its whole output, `616` findings on the Martian board, scored the way the board scores a tool:
 *      `P 0.1916 / R 0.6821 / F1 0.2991`.
 *   2. **What our gate would keep of it.** The same rows through the `actionable` gate this project applies to its own
 *      comments, which is the only like-for-like comparison available: **`210` findings, `F1 0.3551`**.
 *
 * **The second number was already in every artifact** - it is `secondReviewer.withTheSameRanker`, published since §147 -
 * and no section read it against our own gated point. That is the defect this instrument removes: the field existed, the
 * comparison did not, and the claim rested on the first number alone.
 *
 * **Three guards, because a pricing is easy to misdraw.**
 *
 *   1. **The corpus's denominator, not the rows'.** A pull request the competitor produced nothing usable on is a hole in
 *      the pairing and not a zero: its goldens stay in the denominator while contributing nothing to the numerator. The
 *      alternative divides by the rows that happen to exist, which flatters whichever arm stopped earlier - and the arm
 *      that stopped earlier is the one the comparison is about.
 *   2. **One golden, one credit.** The corpus's protocol is a maximum bipartite matching per pull request, not a sum over
 *      `matchedGoldens`: on the recorded Martian file the sum reads **326** credited pairs where the matching reads
 *      **195**, so a pricing built by summing would be 40 % optimistic and would look like a result.
 *   3. **`--guard` rebuilds the figure the run published before a new one is printed.** A pricing over a different
 *      emission is a pricing of a different run, and the published figures are the only check that the rows in the file
 *      are the rows those figures came from.
 *
 * **What it cannot do is price a curve.** The competitor's output *is* its cut - there is no upstream candidate set in the
 * record to move a budget over - so it gets a point, and the gate gives a second point on the same rows. A curve needs
 * emissions the record does not hold, and buying them would be buying the competitor again.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { PROFILES, profileMaps, restrictFindings } from './lib/corpus-profile.mjs';
import { score } from './lib/operating-point.mjs';

function parseArgs(argv) {
  const options = {
    baseline: null,
    corpus: null,
    selection: null,
    profile: 'all',
    json: null,
    guard: null,
    guardFrom: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--baseline') options.baseline = argv[(i += 1)];
    else if (arg === '--corpus') options.corpus = argv[(i += 1)];
    else if (arg === '--selection') options.selection = argv[(i += 1)];
    else if (arg === '--profile') options.profile = argv[(i += 1)];
    else if (arg === '--json') options.json = argv[(i += 1)];
    else if (arg === '--guard') options.guard = argv[(i += 1)];
    else if (arg === '--guard-from') options.guardFrom = argv[(i += 1)];
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.baseline === null || options.corpus === null) {
  process.stderr.write(
    'usage: competitor-cut.mjs --baseline <competitor-baseline.json> --corpus <positive_samples.json> ' +
      '[--selection <artifact.json>] [--profile all|core] [--guard P=..,R=..,F1=.. | --guard-from <artifact.json>] ' +
      '[--json out]\n' +
      '  --corpus is required: a denominator lives in the corpus, and the rows do not hold one.\n',
  );
  process.exit(2);
}

if (!(options.profile in PROFILES)) {
  process.stderr.write(
    `profile ${JSON.stringify(options.profile)} is not registered; known profiles are ${Object.keys(PROFILES).join(', ')}\n`,
  );
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(options.baseline, 'utf8'));
const corpus = JSON.parse(readFileSync(options.corpus, 'utf8'));
const rows = baseline?.pulls ?? {};

/**
 * **The pull requests this pricing is about.**
 *
 * The corpus is the question and the selection is the run that answered part of it. Without `--selection` the pricing is
 * about every corpus row, which is what a reader wants beside a published figure; with it, the pricing is about the rows
 * the run actually covered, which is what a run wants beside its own artifact. **A selection narrows the corpus as well
 * as the rows** (§173.1): the goldens of a pull request outside the selection are a question this run never put to either
 * arm, so they belong to neither denominator.
 */
const corpusKeys = (Array.isArray(corpus) ? corpus : [])
  .map((row) => (typeof row?.githubPrUrl === 'string' ? row.githubPrUrl : null))
  .filter((key) => key !== null);

const selection =
  options.selection === null ? null : JSON.parse(readFileSync(options.selection, 'utf8'));

/**
 * **The run's own scored slice, not the arm's own coverage - and this was the `§177` defect.**
 *
 * The filter used to be `secondReviewer.coveredKeys`, which is the pull requests the arm *had a row for*. So a pricing
 * with `--selection` silently shrank its denominator to whatever the arm had covered, **and a pricing and the run it
 * exists to rebuild could not agree whenever a row was missing**: the run charged the missing pull request's goldens as
 * false negatives (`0.3673`) while the pricing left them out (`0.3764`), and the guard refused the pricing with
 * *"these are not the rows that figure came from"* - about two row sets that were the same rows.
 *
 * **`coverage.byPullRequest` is the run's slice**, which is the denominator §173.1 registered: a pull request outside it
 * is a question nobody asked, and a pull request inside it without a row is a hole that keeps its goldens.
 */
const scoredSelection = Array.isArray(selection?.coverage?.byPullRequest)
  ? selection.coverage.byPullRequest
      .map((row) => (typeof row?.pr === 'string' ? row.pr : null))
      .filter((key) => key !== null)
  : null;
const selected = scoredSelection;

/**
 * **Every pull request this pricing is about - not every pull request with a row.**
 *
 * The hole rule has to survive this filter, so the filter cannot be the rows: `keys` is the corpus's pull requests narrowed
 * by the run's selection, and a key whose row emitted nothing is still in it, contributing `0` to the numerator and its
 * goldens to the denominator (§147.3). What the selection removes is the pull requests outside the run's slice, which
 * nobody asked either arm about.
 */
/**
 * **The pull requests the arm could not read at all, named by the run that tried** (`§177`).
 *
 * A hole nobody could fill and a hole this run did not fill are the same arithmetic and two different facts: the first is
 * about the corpus - `ComfyUI#7952` and `#9560` name commits the remote no longer holds, so their `git` range fails
 * before either arm runs - and the second is about the run. **Only the first may leave a denominator**, because charging
 * a reviewer for a pull request it was never able to open is the defect `§173.1` found one level up.
 */
const unreadKeys = new Set(
  (Array.isArray(selection?.secondReviewer?.unread) ? selection.secondReviewer.unread : [])
    .map((row) => (typeof row?.key === 'string' ? row.key : null))
    .filter((key) => key !== null),
);

/**
 * **A run cannot call a pull request unread while the baseline holds a row for it.**
 *
 * The two fields are written by different instruments - `unread` by the harness that failed to open the range, the row by
 * the record that succeeded - and a pricing that met both and picked one would be choosing which of two of its own
 * sources to believe. **One of them is wrong and the run is the only place that can be said.**
 */
const contradictory = [...unreadKeys].filter((key) => Object.hasOwn(rows, key));
if (contradictory.length > 0) {
  process.stderr.write(
    `${options.selection}: ${String(contradictory.length)} pull request(s) are named unread and have a baseline row ` +
      `(${contradictory.slice(0, 3).join(', ')}), so one of the two records is wrong and neither can be priced\n`,
  );
  process.exit(2);
}

const keys = corpusKeys.filter(
  (key) => (selected === null || selected.includes(key)) && !unreadKeys.has(key),
);

if (keys.length === 0) {
  process.stderr.write(
    `${options.baseline}: none of the corpus's pull requests has a row, so there is nothing to price\n`,
  );
  process.exit(2);
}

/**
 * **The denominator, from the corpus - and only from the part of it this pricing is about.**
 *
 * Under `all` it is every comment the corpus holds; under `core` it is the eight categories the board scores. **Both
 * count the pull requests a row is missing for**, because a hole is an absence of an observation and not an absence of a
 * reference comment - §147.3's rule, applied to the other arm.
 *
 * **`keys` and not `corpus`.** §173.1: the AACR answer key holds `196` pull requests and `1506` goldens, and a run scores
 * a slice of `50`. Dividing by `1506` reported the competitor at `R 0.1089` where its own artifact says `0.3761` - a
 * `3.4x` understatement produced by a denominator nobody was ever asked about. The guard caught it, which is what the
 * guard is for, but the arithmetic should not have needed catching: **the corpus of a pricing is the corpus the run
 * asked about**, and a pull request outside it is not a hole in the pairing - it is a question this run never put.
 *
 * The hole rule survives unchanged one level down: a pull request *inside* `keys` whose row emitted nothing keeps its
 * goldens in the denominator, because that silence is an observation.
 */
const { maps } = profileMaps(corpus, options.profile);

/** The goldens the profile keeps on one pull request, `0` for a pull request the corpus does not hold. */
const goldensOf = (key) => maps.get(key)?.size ?? 0;

const denominator = keys.reduce((count, key) => count + goldensOf(key), 0);

/** The pull requests the run scored, so the figure can say how much of its own slice it is over. Worth `0` when absent. */
const scoredKeys = Array.isArray(selection?.coverage?.byPullRequest)
  ? selection.coverage.byPullRequest
      .map((row) => (typeof row?.pr === 'string' ? row.pr : null))
      .filter((key) => key !== null)
  : null;

/** Every finding the competitor emitted on this selection, in the shape the scorer reads. */
const findingsOf = (key) =>
  (rows[key]?.matches ?? []).map((matchedGoldens, at) => ({
    pr: key,
    matchedGoldens: [...matchedGoldens],
    keep: rows[key]?.keep?.[at] !== false,
  }));

const all = keys.flatMap(findingsOf);

/**
 * **The same findings with each verdict re-indexed into the profile**, which drops the pairs outside it and never
 * re-judges one: a `style` golden our judge accepted stays accepted, it stops being one the board scores.
 */
const restrict = (findings) =>
  options.profile === 'all'
    ? findings
    : restrictFindings(findings, { maps, profileField: 'matchedGoldens' });

const credit = (finding) => finding.matchedGoldens ?? [];

const shipped = score(restrict(all), credit, denominator);
const kept = all.filter((finding) => finding.keep);
const gated = score(restrict(kept), credit, denominator);

/** The rows the gate touched, so a pricing that removed nothing says so instead of printing the same number twice. */
const removed = all.length - kept.length;

const figure = (point) =>
  `emitted ${String(point.emitted)}  tp ${String(point.truePositives)}  P ${point.precision.toFixed(4)}  ` +
  `R ${point.recall.toFixed(4)}  F1 ${point.f1.toFixed(4)}`;

const covered = keys.filter((key) => Object.hasOwn(rows, key)).length;
const line1 =
  `competitor ${String(baseline?.competitor?.tool ?? 'unknown')} · ${String(covered)} of ` +
  `${String(scoredKeys === null ? keys.length : scoredKeys.length)} ` +
  `${scoredKeys === null ? '' : 'scored '}pull requests have a row · profile ${options.profile}`;
const line2 = `  goldens ${String(denominator)} (every golden on the pull requests priced here, so a row that emitted nothing is still counted)`;

/**
 * **What the arm did not measure, said rather than left to be discovered by division.**
 *
 * The three pull requests this competitor arm produced nothing for are outside the figure above, and a reader who divides
 * `tp` by the slice's `452` will read `0.3628` where the artifact says `0.3761` and conclude one of the two is wrong. Both
 * are right: they answer different questions, and the question this line names is the one the figure is not.
 */
const unmeasured = (scoredKeys ?? []).filter((key) => !keys.includes(key));
const unmeasuredGoldens = unmeasured.reduce((count, key) => count + goldensOf(key), 0);
/** The same list split by *why* it is outside, because the two have different repairs and only one is about the corpus. */
const outsideUnread = unmeasured.filter((key) => unreadKeys.has(key));
const outsideSilent = unmeasured.filter((key) => !unreadKeys.has(key));
const goldensOfKeys = (list) => list.reduce((count, key) => count + goldensOf(key), 0);
const plural = (count, noun) => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

const lines = [line1, line2];
if (outsideUnread.length > 0)
  lines.push(
    `  and ${plural(goldensOfKeys(outsideUnread), 'golden')} on ${plural(outsideUnread.length, 'scored pull request')} ` +
      'the arm could not read - a range the remote no longer holds - are outside it, because charging them to its recall ' +
      'is charging it for a pull request it was never able to open',
  );
if (outsideSilent.length > 0)
  lines.push(
    `  and ${plural(goldensOfKeys(outsideSilent), 'golden')} on ${plural(outsideSilent.length, 'scored pull request')} ` +
      'the arm produced nothing for are outside it',
  );
lines.push(`  as shipped     ${figure(shipped)}`);
if (removed > 0) lines.push(`  at our gate    ${figure(gated)}`);
else lines.push('  the gate removed nothing, so there is one point and not two');

/**
 * **The guard, read before anything is printed.**
 *
 * `--guard` names the figures the run that bought these rows published, and `--guard-from` reads them out of that run's
 * own artifact. **A pricing whose no-cut point does not rebuild them is a pricing of a different emission** - a row lost
 * on the way into the file, a denominator from another profile, a selection that is not the run's - and every one of
 * those produces a plausible number beside a wrong one.
 *
 * **The artifact is the better source**, because a hand-typed `P=..,R=..,F1=..` is a second copy of three numbers that
 * live in a file beside it, and the copy is the one that goes stale. `--guard-from` reads `secondReviewer`, which is the
 * block those figures are published in; **an artifact with no such block is refused rather than guarded against
 * nothing**, because a run that never bought the competitor arm has no figure for this instrument to rebuild.
 */
let guarded = null;
const expected = (() => {
  if (options.guard !== null) {
    return Object.fromEntries(
      options.guard.split(',').map((pair) => {
        const [name, value] = pair.split('=');
        return [String(name).trim().toUpperCase(), Number(value)];
      }),
    );
  }
  if (options.guardFrom === null) return null;
  const artifact = JSON.parse(readFileSync(options.guardFrom, 'utf8'));
  const published = artifact?.secondReviewer ?? {};
  if (typeof published.precision !== 'number' || typeof published.f1 !== 'number') {
    process.stderr.write(
      `${options.guardFrom}: the artifact publishes no competitor figure in secondReviewer, so there is nothing to ` +
        'rebuild - a run that did not buy the arm has no guard to offer\n',
    );
    process.exit(2);
  }
  return { P: published.precision, R: published.recall, F1: published.f1 };
})();

if (expected !== null) {
  const published = { P: shipped.precision, R: shipped.recall, F1: shipped.f1 };
  const mismatched = Object.entries(expected).filter(
    ([name, value]) => Math.abs((published[name] ?? Number.NaN) - value) > 5e-5,
  );
  guarded = mismatched.length === 0;
  if (!guarded) {
    const said = mismatched
      .map(
        ([name, value]) =>
          `${name}=${value.toFixed(4)} against ${(published[name] ?? Number.NaN).toFixed(4)}`,
      )
      .join(', ');
    process.stderr.write(
      `the guard refuses this pricing: the rows do not rebuild the published figure (${said}), so these are not the ` +
        'rows that figure came from\n',
    );
    process.exit(2);
  }
  lines.push(`  the guard rebuilds ${Object.keys(expected).join('/')} exactly`);
}

if (options.json !== null) {
  writeFileSync(
    options.json,
    `${JSON.stringify(
      {
        competitor: baseline?.competitor?.tool ?? null,
        profile: options.profile,
        goldens: denominator,
        pullRequests: {
          withARow: covered,
          priced: keys.length,
          inCorpus: corpusKeys.length,
          scored: scoredKeys === null ? null : scoredKeys.length,
        },
        /**
         * **The pull requests outside the figure, named rather than counted.**
         *
         * A count is enough to explain a denominator and not enough to check one: `§177`'s guard refused a pricing
         * because the run had charged eleven goldens on two unread pull requests to the competitor's recall, and the
         * pricing could say how many without saying which. **A reader - and the guard above - can only join two
         * instruments on a name.**
         */
        unmeasured: {
          pullRequests: unmeasured.length,
          goldens: unmeasuredGoldens,
          keys: unmeasured.map((key) => ({
            key,
            goldens: goldensOf(key),
            // **Why it is outside**, so a reader can tell a corpus the remote no longer holds from a run that stopped.
            reason: unreadKeys.has(key) ? 'unread' : 'no-row',
          })),
        },
        asShipped: shipped,
        atOurGate: removed > 0 ? gated : null,
        guard: guarded,
      },
      null,
      2,
    )}\n`,
  );
}

process.stdout.write(`${lines.join('\n')}\n`);
