#!/usr/bin/env node
/**
 * **Two emissions on one budget axis, which is the only comparison that is about the reviewer.**
 *
 * ```
 * node scripts/same-cut.mjs \
 *   --ours benchmarks/cut-curve-wide-martian-core.json \
 *   --theirs benchmarks/aacr/competitor-baseline.json \
 *   --corpus benchmarks/martian/positive_samples.json \
 *   --profile core --json benchmarks/same-cut-core.json
 * ```
 *
 * **The defect this file exists for.** §159 read our `k = 5` against the competitor's published figure and concluded that
 * the bar had been crossed. The competitor's published figure is its **whole output** - twelve comments per pull request
 * and then some - while our `k = 5` is a cut. **A cut compared against an uncut emission is a comparison of two policies,
 * one of which was chosen and one of which was not**, and it flatters whichever arm was allowed to choose. That is the
 * same class of error as §140.5's denominator and §159.4's cut, one axis further out: the axis is the emission size, and
 * it was never held fixed.
 *
 * **Both sides are already in the record, so holding it fixed costs nothing.** The competitor's rows carry, per comment,
 * `score`, `category` and the goldens our judge credited it with (`matchedGoldens`), in descending score order - so a
 * per-pull-request budget can be applied to *their* emission exactly as it is applied to ours, and both curves can be read
 * off verdicts that were paid for before this file existed. **The competitor's curve is only defined downward**: its
 * output *is* its cut, so there is no candidate set above `~12.3` comments per pull request to move a budget over, and
 * every row above that is refused rather than extrapolated.
 *
 * **Three refusals, because a two-arm table is easy to misdraw.**
 *
 *   1. **The same questions, not two runs' worth.** Our curve's `profile` must be the one asked for, and its goldens must
 *      equal the denominator recomputed from the corpus - a table whose two columns divide by different numbers is the
 *      defect this file is named after.
 *   2. **The same cut, apart from the budget.** Our curve's `cut` is `drop … + budget k`; the steps before the budget are
 *      applied to the competitor's rows as well, so the only thing that varies down the table is how many comments a pull
 *      request is allowed. A curve whose steps this file cannot restate is refused by name.
 *   3. **The published points rebuild before a new one is printed.** Our curve's own shipped row must reproduce the point
 *      the curve file records for it, and the competitor's uncut emission must reproduce `616 / 109 / 0.2817` on the
 *      board's 158 - the figure §160 published. A pricing over a different emission is a pricing of a different run.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { profileMaps } from './lib/corpus-profile.mjs';
import {
  applyCut,
  describeCut,
  maximumMatchingByPullRequest,
  parseCut,
  score,
} from './lib/operating-point.mjs';

const VERSION = 'same-cut-v1';

/** The competitor's emission as §160 published it, per profile. A new table has to rebuild these before it prints. */
const PUBLISHED = Object.freeze({
  core: Object.freeze({ emitted: 616, truePositives: 109 }),
  all: Object.freeze({ emitted: 616, truePositives: 118 }),
});

function parseArgs(argv) {
  const options = {
    ours: null,
    theirs: null,
    corpus: null,
    profile: 'core',
    steps: 'drop:test+drop-path:test',
    expectTheirs: null,
    json: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    if (arg === '--ours') options.ours = next();
    else if (arg === '--theirs') options.theirs = next();
    else if (arg === '--corpus') options.corpus = next();
    else if (arg === '--profile') options.profile = next();
    else if (arg === '--steps') options.steps = next();
    else if (arg === '--expect-theirs') options.expectTheirs = next();
    else if (arg === '--json') options.json = next();
  }
  return options;
}

const round = (value) => Number(value.toFixed(4));

/**
 * **The competitor's rows, in the order its own pipeline ranked them, re-indexed onto the board's profile.**
 *
 * `detail` is stored in descending `score` order in every one of the ninety-five recorded pull requests, which is what
 * makes a budget over it well defined. **That is asserted rather than assumed**: a row out of order would make "the top
 * four" a different four, and the table would be a comparison against a cut nobody applied.
 *
 * A golden the profile drops is not a golden - `matchedGoldens` carries the corpus's own indices, and after `style` is
 * removed from a pull request's answer key the remaining indices are renumbered. The re-index is `profileMaps`', the same
 * function every other instrument in this repository reads, so the denominator here cannot drift from the denominator
 * there.
 */
export function readTheirs(baseline, maps) {
  const outOfOrder = [];
  const rows = new Map();
  let emitted = 0;
  let offBoard = 0;
  for (const [pr, row] of Object.entries(baseline.pulls ?? {})) {
    /**
     * **One file holds two boards.** `competitor-baseline.json` carries the AACR slice and the Martian board side by
     * side, because a recorded result is an input and the two were recorded by the same instrument. A table about the
     * Martian board may only see the Martian rows: the other ones' goldens are indexed in their own corpus, and reading
     * them here would inflate the emission while contributing no credit - a precision of a denominator that is not the
     * one in the header. The first version did exactly that and the guard below reported `1050 comments / 109` against
     * a published `616 / 109`.
     */
    if (!maps.has(pr)) {
      offBoard += 1;
      continue;
    }
    const detail = Array.isArray(row?.detail) ? row.detail : [];
    const scores = detail.map((entry) => Number(entry?.score ?? 0));
    const ordered = scores.every((value, at) => at === 0 || scores[at - 1] >= value);
    if (!ordered) outOfOrder.push(pr);
    const index = maps.get(pr);
    // **A pull request the profile does not hold is a hole in the pairing, not a zero**: the competitor reviewed it and
    // its goldens are in the denominator; the board's profile map is what says which of them count.
    const findings = detail.map((entry) => {
      const matched = (entry?.matchedGoldens ?? [])
        .map((golden) => (index === undefined ? undefined : index.get(golden)))
        .filter((golden) => golden !== undefined);
      return {
        pr,
        // **`path` travels because one of the two steps before the budget is a path class.** Dropping `test`
        // comments from our emission and not from theirs would be a policy applied to one arm, and the two arms' rows
        // are the same shape: both record where the comment pointed.
        path: String(entry?.path ?? ''),
        category: String(entry?.category ?? ''),
        score: Number(entry?.score ?? 0),
        actionable: entry?.actionable === true,
        matchedGoldens: matched,
      };
    });
    rows.set(pr, findings);
    emitted += findings.length;
  }
  return { rows, emitted, outOfOrder, offBoard };
}

/**
 * **The competitor's curve, and the two points it is entitled to.**
 *
 * `asPublished` is the whole emission with no cut at all - the figure in every published comparison - and `gated` is the
 * same rows through the actionability gate, which §160 priced at `0.3424` on the board's 158. Both are printed so that
 * the table below is visibly a third reading and not a replacement for the two that already exist.
 */
export function theirsCurve(rows, steps, budgets, goldens) {
  const curve = budgets.map((budget) => {
    const cut = applyCut(flatten(rows), [...steps, { kind: 'budget', k: budget }]);
    return { budget, ...score(cut, (finding) => finding.matchedGoldens ?? [], goldens) };
  });
  const asPublished = score(flatten(rows), (finding) => finding.matchedGoldens ?? [], goldens);
  const gated = score(
    flatten(rows).filter((finding) => finding.actionable),
    (finding) => finding.matchedGoldens ?? [],
    goldens,
  );
  return { curve, asPublished, gated };
}

const flatten = (rows) => [...rows.values()].flat();

/** Our curve as the instrument that produced it left it, with the steps it applied separated from the budget. */
export function readOurs(curveFile, profile, steps) {
  const result = Array.isArray(curveFile?.results) ? curveFile.results[0] : undefined;
  if (result === undefined) throw new Error('the curve file holds no result to read');
  if (result.profile !== profile) {
    throw new Error(
      `the curve was cut on profile ${String(result.profile)} and this table is on ${profile}`,
    );
  }
  const parsed = parseCut(result.cut);
  const budgetStep = parsed.filter((step) => step.kind === 'budget');
  const beforeBudget = parsed.filter((step) => step.kind !== 'budget');
  const asked = [...steps];
  const same =
    beforeBudget.length === asked.length &&
    beforeBudget.every((step, at) => JSON.stringify(step) === JSON.stringify(asked[at]));
  if (!same) {
    throw new Error(
      `the curve was cut by ${describeCut(beforeBudget)} and this table applies ${describeCut(asked)} to both arms`,
    );
  }
  if (budgetStep.length !== 1) {
    throw new Error(`the curve's cut carries ${String(budgetStep.length)} budget steps, not one`);
  }
  return {
    shippedAt: budgetStep[0].k,
    shipped: result.shipped,
    curve: result.curve,
    goldens: result.goldens,
  };
}

const options = parseArgs(process.argv.slice(2));
if (options.ours === null || options.theirs === null || options.corpus === null) {
  process.stderr.write(
    'usage: same-cut.mjs --ours <cut-curve.json> --theirs <competitor-baseline.json> ' +
      '--corpus <positive_samples.json> [--profile core|all] [--steps drop:test+drop-path:test] [--json out]\n',
  );
  process.exit(2);
}

const curveFile = JSON.parse(readFileSync(options.ours, 'utf8'));
const baseline = JSON.parse(readFileSync(options.theirs, 'utf8'));
const corpus = JSON.parse(readFileSync(options.corpus, 'utf8'));

const steps = parseCut(options.steps);
const { maps, goldens } = profileMaps(corpus, options.profile);
const ours = readOurs(curveFile, options.profile, steps);

/**
 * **The denominator is one number or the table does not print.** Ours comes from the curve file, theirs is recomputed
 * from the corpus; they are the same 158 because both are the board's Core profile, and a table where they differed
 * would be two percentages of two different wholes placed beside each other.
 */
if (ours.goldens !== goldens) {
  process.stderr.write(
    `our curve divides by ${String(ours.goldens)} goldens and the corpus holds ${String(goldens)} on ${options.profile}\n`,
  );
  process.exit(1);
}

const theirRows = readTheirs(baseline, maps);
if (theirRows.outOfOrder.length > 0) {
  process.stderr.write(
    `the competitor's rows are not in score order on ${String(theirRows.outOfOrder.length)} pull requests ` +
      `(${theirRows.outOfOrder.slice(0, 3).join(', ')}), so a budget over them would be a cut nobody applied\n`,
  );
  process.exit(1);
}

const budgets = ours.curve.map((row) => row.budget);
const theirs = theirsCurve(theirRows.rows, steps, budgets, goldens);

/**
 * **The competitor's published point is rebuilt on the whole emission, before any cut.** A figure this table cannot
 * reproduce is a figure about a different emission, and every row below it would inherit the difference.
 *
 * `--expect-theirs emitted,tp` exists for the two callers the constants cannot serve: the case beside this file, whose
 * fixture is four comments rather than six hundred, and a board whose published point this file has never been told. **A
 * table says which guard it used**, in `guards.theirsPublished.source`, because an override that left no trace would let a
 * published artifact look as though it had been checked against the figure every earlier section quotes.
 */
const declared = (() => {
  if (options.expectTheirs === null) {
    const known = PUBLISHED[options.profile];
    return known === undefined
      ? null
      : { emitted: known.emitted, truePositives: known.truePositives, source: 'published' };
  }
  const [emitted, truePositives] = String(options.expectTheirs).split(',').map(Number);
  if (!Number.isInteger(emitted) || !Number.isInteger(truePositives)) {
    process.stderr.write(
      `--expect-theirs takes "emitted,truePositives" and got "${String(options.expectTheirs)}"\n`,
    );
    process.exit(2);
  }
  return { emitted, truePositives, source: 'argument' };
})();
if (declared === null) {
  process.stderr.write(
    `no published point is recorded for profile ${options.profile}; pass --expect-theirs emitted,truePositives\n`,
  );
  process.exit(2);
}
const published = declared;
if (
  theirs.asPublished.emitted !== published.emitted ||
  theirs.asPublished.truePositives !== published.truePositives
) {
  process.stderr.write(
    `the competitor's rows rebuild ${String(theirs.asPublished.emitted)} comments / ` +
      `${String(theirs.asPublished.truePositives)} true positives and §160 published ` +
      `${String(published.emitted)} / ${String(published.truePositives)} on ${options.profile}\n`,
  );
  process.exit(1);
}

/**
 * **And our side's own point, from the curve file against itself.** The curve records the shipped row twice - once as the
 * run's `shipped` point and once as the row at its budget - and the two are the same emission. A file where they disagreed
 * was written by two instruments.
 */
const shippedRow = ours.curve.find((row) => row.budget === ours.shippedAt);
if (
  shippedRow === undefined ||
  shippedRow.emitted !== ours.shipped?.emitted ||
  shippedRow.truePositives !== ours.shipped?.truePositives
) {
  process.stderr.write(
    `our curve's shipped row and its row at budget ${String(ours.shippedAt)} disagree ` +
      `(${JSON.stringify(ours.shipped)} against ${JSON.stringify(shippedRow)})\n`,
  );
  process.exit(1);
}

const comparison = ours.curve.map((row) => {
  const other = theirs.curve.find((entry) => entry.budget === row.budget);
  return {
    budget: row.budget,
    ours: {
      emitted: row.emitted,
      truePositives: row.truePositives,
      precision: row.precision,
      recall: row.recall,
      f1: row.f1,
    },
    theirs: {
      emitted: other.emitted,
      truePositives: other.truePositives,
      precision: other.precision,
      recall: other.recall,
      f1: other.f1,
    },
    gap: row.f1 - other.f1,
  };
});

// **The best point of each curve, and which budget bought it.** Both arms are allowed their own optimum here - that is
// what "at the same cut rule, each arm picks its own cut" means - and the comparison that matters is the two maxima.
const bestOf = (rows, key) =>
  rows.reduce((best, row) => (row[key].f1 > best[key].f1 ? row : best), rows[0]);
const best = {
  ours: { budget: bestOf(comparison, 'ours').budget, ...bestOf(comparison, 'ours').ours },
  theirs: { budget: bestOf(comparison, 'theirs').budget, ...bestOf(comparison, 'theirs').theirs },
};
const lead = comparison.filter((row) => row.gap > 0).length;

const line = (label, point, gap) =>
  `${label.padEnd(9)}${String(point.emitted).padStart(6)}${String(point.truePositives).padStart(5)}` +
  `${point.precision.toFixed(4).padStart(10)}${point.recall.toFixed(4).padStart(9)}` +
  `${point.f1.toFixed(4).padStart(9)}${gap === null ? ''.padStart(11) : gap.toFixed(4).padStart(11)}`;

const table = comparison
  .map(
    (row) =>
      `${String(row.budget).padStart(3)}  ${line('ours', row.ours, null)}\n` +
      `     ${line('theirs', row.theirs, row.gap)}`,
  )
  .join('\n');

process.stdout.write(
  `same cut · ${options.profile} · ${String(goldens)} goldens · steps ${describeCut(steps)} · our curve ${options.ours}\n` +
    `competitor: ${String(theirRows.rows.size)} of the board's pull requests, ${String(theirRows.emitted)} comments uncut, ` +
    `as published ${theirs.asPublished.f1.toFixed(4)}, through the gate ${theirs.gated.f1.toFixed(4)}\n\n` +
    `  k        emitted   tp        P        R       F1        gap\n` +
    `${table}\n\n` +
    `our best      k=${String(best.ours.budget).padEnd(3)}F1 ${best.ours.f1.toFixed(4)}\n` +
    `their best    k=${String(best.theirs.budget).padEnd(3)}F1 ${best.theirs.f1.toFixed(4)}\n` +
    `we lead on ${String(lead)} of ${String(comparison.length)} cuts; the gap at each arm's own optimum is ` +
    `${(best.ours.f1 - best.theirs.f1).toFixed(4)}\n`,
);

if (options.json) {
  writeFileSync(
    options.json,
    `${JSON.stringify(
      {
        version: VERSION,
        ours: {
          source: options.ours,
          profile: options.profile,
          cut: describeCut([...steps, { kind: 'budget', k: ours.shippedAt }]),
          goldens,
          curve: ours.curve,
        },
        theirs: {
          source: options.theirs,
          pullRequests: theirRows.rows.size,
          emitted: theirRows.emitted,
          asPublished: theirs.asPublished,
          gated: theirs.gated,
          curve: theirs.curve,
        },
        guards: { theirsPublished: published, oursShipped: ours.shipped },
        comparison,
        best,
        lead,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`wrote ${options.json}\n`);
}
