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
 * the run actually covered, which is what a run wants beside its own artifact. **The corpus is still the denominator in
 * both cases** - a selection changes which rows contribute, never what the corpus holds.
 */
const corpusKeys = (Array.isArray(corpus) ? corpus : [])
  .map((row) => (typeof row?.githubPrUrl === 'string' ? row.githubPrUrl : null))
  .filter((key) => key !== null);

const selection =
  options.selection === null ? null : JSON.parse(readFileSync(options.selection, 'utf8'));
const selected = Array.isArray(selection?.secondReviewer?.coveredKeys)
  ? selection.secondReviewer.coveredKeys
  : null;

const keys = corpusKeys.filter((key) => (selected === null ? key in rows : selected.includes(key)));

if (keys.length === 0) {
  process.stderr.write(
    `${options.baseline}: none of the corpus's pull requests has a row, so there is nothing to price\n`,
  );
  process.exit(2);
}

/**
 * **The denominator, from the corpus.**
 *
 * Under `all` it is every comment the corpus holds; under `core` it is the eight categories the board scores. **Both
 * count the pull requests a row is missing for**, because a hole is an absence of an observation and not an absence of a
 * reference comment - §147.3's rule, applied to the other arm.
 */
const { maps, goldens: denominator } = profileMaps(corpus, options.profile);

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
const line1 = `competitor ${String(baseline?.competitor?.tool ?? 'unknown')} · ${String(covered)} of ${String(corpusKeys.length)} pull requests have a row · profile ${options.profile}`;
const line2 = `  goldens ${String(denominator)} (the corpus's denominator, so a pull request with no row is a hole and not a zero)`;
const line3 = `  as shipped     ${figure(shipped)}`;

const lines = [line1, line2, line3];
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
        pullRequests: { withARow: covered, inCorpus: corpusKeys.length },
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
