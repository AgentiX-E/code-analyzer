#!/usr/bin/env node
/**
 * **Whether a lane found something nobody else in the run found.**
 *
 * ```
 * node scripts/lane-discovery.mjs --arm benchmarks/martian-reviewer-bench.json \
 *   --reference benchmarks/martian-wide-bench.json \
 *   --corpus benchmarks/martian/positive_samples.json --profile core --budget 5
 * ```
 *
 * §162.3 left the campaign one number: **our emission names 84 credited goldens at any budget on the board's 158, and the
 * competitor's arm reaches 109.** Every device since then - a threshold, a recalibration, a severity floor, a dedup rule,
 * a re-weighting - was priced on *which* of the pool's comments reach a reader, and all of them were refused. **None of
 * them can invent a comment, so the ceiling is the number that decides the claim**, and §164 registers a lane against it.
 *
 * **Two quantities, because "the lane added goldens" has two readings.**
 *
 * - **The ceiling** is the credited goldens the whole emission names with no budget at all: `|matching(pool)|` on the
 *   board's own denominator. It is the sum an added lane moves, and it is measured by the corpus's protocol - one verdict
 *   per pair, then a maximum matching per pull request - not by counting `matchedGoldens`, which double-counts.
 * - **The lane's own** is what it credits that **no other lane in the same run** credits. A lane that re-states a golden
 *   another lane already named adds a comment and no recall, and a table that reported its `matchedGoldens` would show
 *   the re-statement as a gain.
 *
 * **And the set difference against a reference arm**, because §164's question is not "did the lane find anything" but
 * "did it find what the wide arm never did": `onlyArm` / `onlyReference` / `shared` over credited goldens, keyed by
 * pull request and golden index.
 *
 * **The guard is the one every instrument in this directory applies**: the arm's own published point has to rebuild
 * through the arm's own cut, on the arm's own denominator, or this exits `1`. A ceiling computed over a pool the run did
 * not emit is a claim about nothing.
 *
 * **`--without` is the counterfactual, and it has to come from the same run.** Comparing two arms recorded by two runs
 * bundles the swap with everything else two samples of a sampler disagree on - the reviewer run and the wide run differ by
 * 8 `architecture` findings and 5 `security` findings before a single lane is swapped. Dropping a lane's rows out of one
 * artifact and replaying the same cut holds the run fixed and leaves the lane as the only thing that moved, so it is the
 * number a refusal is written on. The re-derived point is reported as `derived` and never as the arm's published one.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { PROFILES, profileMaps, restrictFindings } from './lib/corpus-profile.mjs';
import {
  applyCut,
  describeCut,
  f1FromCounts,
  matchingByPullRequest,
  pullRequestOf,
  score,
} from './lib/operating-point.mjs';

function parseArgs(argv) {
  const options = {
    arm: null,
    reference: null,
    corpus: null,
    profile: 'core',
    budget: null,
    without: null,
    json: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--arm') options.arm = argv[(i += 1)];
    else if (arg === '--reference') options.reference = argv[(i += 1)];
    else if (arg === '--corpus') options.corpus = argv[(i += 1)];
    else if (arg === '--profile') options.profile = argv[(i += 1)];
    else if (arg === '--budget') options.budget = Number(argv[(i += 1)]);
    else if (arg === '--without') options.without = argv[(i += 1)];
    else if (arg === '--json') options.json = argv[(i += 1)];
    else if (arg.startsWith('--')) {
      process.stderr.write(`unknown option ${arg}\n`);
      process.exit(2);
    } else options.arm = arg;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.arm === null) {
  process.stderr.write(
    'usage: lane-discovery.mjs --arm <artifact.json> [--reference <artifact.json>] [--corpus <positive_samples.json>] ' +
      '[--profile core|all] [--budget k] [--without lane[,lane]] [--json out]\n',
  );
  process.exit(2);
}
if (!(options.profile in PROFILES)) {
  process.stderr.write(
    `profile ${options.profile} is not registered; known: ${Object.keys(PROFILES)}\n`,
  );
  process.exit(2);
}

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const arm = read(options.arm);
const reference = options.reference === null ? null : read(options.reference);
const corpus = options.corpus === null ? null : read(options.corpus);

const round4 = (value) => Number(value.toFixed(4));

/** The pool with no budget at all, and the raw denominator it is measured against. */
const steps = arm.emissionRules?.shipped?.steps ?? null;
const publishedPoint = arm.emissionRules?.shipped?.point ?? null;
if (steps === null || publishedPoint === null) {
  process.stderr.write(
    `${options.arm} publishes no emissionRules.shipped (steps and point), so its pool cannot be rebuilt\n`,
  );
  process.exit(2);
}

const rawFindings = arm.rankedFindings ?? [];
const rawCredit = (finding) => finding.matchedGoldens ?? [];
const rawGoldens = Number(arm.truePositives ?? 0) + Number(arm.falseNegatives ?? 0);

/**
 * **Guard 1: the pool has to be this run's pool, on the run's own denominator.**
 *
 * The rebuild keeps every step and re-imposes the budget, so the only thing that moves between this point and the
 * published one is arithmetic that should agree. **A profile is applied after this**, because the guard is about the
 * run and the profile is about the corpus - applying the two in the other order compares a core re-index against a point
 * published on all 173 and refuses a good artifact, which is what the first version of this file did.
 */
const rebuiltRaw = score(applyCut(rawFindings, steps), rawCredit, rawGoldens);
if (
  rebuiltRaw.emitted !== publishedPoint.k ||
  rebuiltRaw.truePositives !== publishedPoint.truePositives
) {
  process.stderr.write(
    `refusing: the rebuild emits ${String(rebuiltRaw.emitted)} comments / ${String(rebuiltRaw.truePositives)} true positives and the artifact published ${String(publishedPoint.k)} / ${String(publishedPoint.truePositives)}\n`,
  );
  process.exit(1);
}
const guard = [
  { field: 'k', published: publishedPoint.k, rebuilt: rebuiltRaw.emitted },
  {
    field: 'truePositives',
    published: publishedPoint.truePositives,
    rebuilt: rebuiltRaw.truePositives,
  },
];

/**
 * **A name the artifact never used is a typo, not an empty counterfactual.**
 *
 * Dropping nothing and then reporting the arm's own numbers as the answer to "what happens without this lane" is the most
 * convincing possible lie, because it looks like a measurement of a swap that was never made. So an unknown name exits
 * `2`, before anything is counted.
 */
const laneOf = (finding) => String(finding.lane ?? 'unnamed');
const without =
  options.without === null
    ? []
    : options.without
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '');
const knownLanes = new Set(rawFindings.map(laneOf));
for (const lane of without) {
  if (!knownLanes.has(lane)) {
    process.stderr.write(
      `--without ${lane}: this artifact has no such lane; known: ${[...knownLanes].sort().join(', ')}\n`,
    );
    process.exit(2);
  }
}
const keptRaw =
  without.length === 0 ? rawFindings : rawFindings.filter((f) => !without.includes(laneOf(f)));

/**
 * **The profile is a denominator over the pull requests this artifact emitted on**, which is the rule `cut-curve.mjs`
 * and `pool-density.mjs` both apply: a run that covered 50 of the corpus's rows is scored against its own 50.
 *
 * **A counterfactual holds that set.** Dropping a lane can also drop the last finding on a pull request, and if the
 * denominator shrank with it the drop would be charged twice: once for the goldens it no longer names and once for the
 * goldens the corpus stops asking about. So `--without` keeps the full arm's covered pull requests and reports the
 * removal as the only thing that moved - `denominatorHeld` in the record says which of the two happened.
 */
function restricted(artifact, rows, denominatorOver = null) {
  if (options.profile === 'all' || corpus === null) {
    return {
      rows: rows.map((finding) => ({ ...finding, profileGoldens: finding.matchedGoldens ?? [] })),
      goldens: Number(artifact.truePositives ?? 0) + Number(artifact.falseNegatives ?? 0),
      covered: new Set(rows.map(pullRequestOf)),
    };
  }
  const { maps } = profileMaps(corpus, options.profile);
  const kept = restrictFindings(rows, { maps });
  let denominator = 0;
  for (const pullRequest of denominatorOver ?? new Set(kept.map(pullRequestOf))) {
    denominator += maps.get(pullRequest)?.size ?? 0;
  }
  return { rows: kept, goldens: denominator, covered: new Set(kept.map(pullRequestOf)) };
}

const fullView = restricted(arm, rawFindings);
/**
 * **The record is the arm.** `--without` adds a counterfactual block beside it and never replaces what the arm published,
 * because a file whose headline number quietly belongs to a different set of lanes is the same error as a chart whose axis
 * is a different run.
 */
const armView = fullView;
const armFindings = armView.rows;
const goldens = armView.goldens;
const credit = (finding) => finding.profileGoldens ?? finding.matchedGoldens ?? [];

/** The credited goldens of a pool, as identities rather than a count. */
function creditedBy(findings) {
  const matched = matchingByPullRequest(findings, credit);
  const set = new Set();
  for (const [pullRequest, held] of matched) {
    for (const golden of held.keys()) set.add(`${pullRequest}\u0000${golden}`);
  }
  return set;
}

/** The pool with no budget at all: the ceiling the claim is about. */
const uncapped = applyCut(
  armFindings,
  steps.filter((step) => step.kind !== 'budget'),
);
const ceiling = creditedBy(uncapped);
/** **The budget is the one step a caller may re-impose**, and the rest of the cut is the run's own. */
const atBudget =
  options.budget === null
    ? null
    : score(
        applyCut(armFindings, [
          ...steps.filter((step) => step.kind !== 'budget'),
          { kind: 'budget', k: options.budget },
        ]),
        credit,
        goldens,
      );
const atBudgetWithK = atBudget === null ? null : { ...atBudget, budget: options.budget };

/**
 * **The counterfactual, priced by the same code as the arm it is a counterfactual of, and kept in the same file.**
 *
 * Two artifacts recorded by two runs answer the wrong question: the reviewer run and the wide run disagree by 8
 * `architecture` findings and 5 `security` findings before a single lane is swapped, so a difference between their ceilings
 * is not the swap. Here both sides are the *same* rows under the *same* cut and the *same* denominator, and the only thing
 * between `from` and `to` is the lane named in `without`.
 */
const counterfactual =
  without.length === 0
    ? null
    : (() => {
        const keptView = restricted(arm, keptRaw, fullView.covered);
        const keptFindings = keptView.rows;
        const keptUncapped = applyCut(
          keptFindings,
          steps.filter((step) => step.kind !== 'budget'),
        );
        const keptAtBudget =
          options.budget === null
            ? null
            : score(
                applyCut(keptFindings, [
                  ...steps.filter((step) => step.kind !== 'budget'),
                  { kind: 'budget', k: options.budget },
                ]),
                credit,
                keptView.goldens,
              );
        return {
          without,
          droppedFindings: rawFindings.length - keptRaw.length,
          /** **A held denominator is the claim that the drop is the only difference**, so it travels with the numbers. */
          denominatorHeld: keptView.goldens === goldens,
          ceiling: { from: ceiling.size, to: creditedBy(keptUncapped).size },
          atBudget: {
            k: options.budget,
            f1: {
              from: atBudget === null ? null : round4(atBudget.f1),
              to: keptAtBudget === null ? null : round4(keptAtBudget.f1),
            },
            truePositives: {
              from: atBudget === null ? null : atBudget.truePositives,
              to: keptAtBudget === null ? null : keptAtBudget.truePositives,
            },
            comments: {
              from: atBudget === null ? null : atBudget.emitted,
              to: keptAtBudget === null ? null : keptAtBudget.emitted,
            },
          },
        };
      })();

/** Per lane: what it emits, what it credits, and what it credits alone. */
const lanes = [...new Set(armFindings.map((finding) => String(finding.lane ?? 'unnamed')))].sort();
const laneRows = lanes.map((lane) => {
  const own = armFindings.filter((finding) => String(finding.lane ?? 'unnamed') === lane);
  const mine = creditedBy(own);
  const others = new Set();
  for (const finding of armFindings) {
    if (String(finding.lane ?? 'unnamed') === lane) continue;
    for (const key of creditedBy([finding])) others.add(key);
  }
  let unique = 0;
  for (const key of mine) if (!others.has(key)) unique += 1;
  return {
    lane,
    findings: own.length,
    credited: mine.size,
    unique,
    density: own.length === 0 ? 0 : Number((mine.size / own.length).toFixed(4)),
  };
});

/**
 * The set difference against the reference arm, over the pool rather than a cut.
 *
 * **This is the number §164 is written about**: a lane is worth its call when the goldens it names were never in the
 * reference's pool at all, because everything else is a comment competing with a comment for a slot the reference
 * already filled.
 */
let difference = null;
if (reference !== null) {
  const referenceRows = restricted(reference, reference.rankedFindings ?? []);
  const referenceFindings = referenceRows.rows;
  const theirSteps = reference.emissionRules?.shipped?.steps ?? [];
  const theirs = creditedBy(
    applyCut(
      referenceFindings,
      theirSteps.filter((step) => step.kind !== 'budget'),
    ),
  );
  const onlyArm = [...ceiling].filter((key) => !theirs.has(key));
  const onlyReference = [...theirs].filter((key) => !ceiling.has(key));
  difference = {
    reference: options.reference,
    referenceLaneSet: reference.configuration?.laneSet?.name ?? null,
    referenceCeiling: theirs.size,
    shared: [...ceiling].filter((key) => theirs.has(key)).length,
    onlyArm: onlyArm.length,
    onlyReference: onlyReference.length,
  };
}

const report = {
  version: 'lane-discovery-v1',
  arm: options.arm,
  laneSet: arm.configuration?.laneSet?.name ?? null,
  profile: options.profile,
  corpus: options.corpus,
  cut: describeCut(steps),
  guard,
  counterfactual,
  goldens,
  emitted: armFindings.length,
  ceiling: {
    credited: ceiling.size,
    /** **The figure §162.3 published**, rebuilt here so a later round cannot quote a ceiling it did not measure. */
    f1IfEverythingPosted: round4(f1FromCounts(ceiling.size, uncapped.length, goldens)),
    comments: uncapped.length,
  },
  atBudget: atBudgetWithK,
  lanes: laneRows,
  difference,
};

const lines = [
  `arm ${options.arm} · lanes ${String(report.laneSet)} · profile ${options.profile} · goldens ${String(goldens)}`,
  `cut ${report.cut}`,
  `guard ${guard.map((entry) => `${entry.field} ${String(entry.rebuilt)}`).join(' · ')} (the artifact's own point)`,
  ...(counterfactual === null
    ? []
    : [
        `without ${counterfactual.without.join(', ')}: ${String(counterfactual.droppedFindings)} findings dropped · denominator ${counterfactual.denominatorHeld ? 'held' : 'SHRANK'} at ${String(goldens)}`,
        `  ceiling ${String(counterfactual.ceiling.from)} -> ${String(counterfactual.ceiling.to)} · k=${String(counterfactual.atBudget.k)} F1 ${String(counterfactual.atBudget.f1.from)} -> ${String(counterfactual.atBudget.f1.to)} · credited ${String(counterfactual.atBudget.truePositives.from)} -> ${String(counterfactual.atBudget.truePositives.to)} · comments ${String(counterfactual.atBudget.comments.from)} -> ${String(counterfactual.atBudget.comments.to)}`,
      ]),
  `pool ${String(uncapped.length)} comments · ceiling ${String(ceiling.size)} credited goldens`,
  ...(atBudget === null
    ? []
    : [
        `budget ${String(options.budget)} · ${String(atBudget.emitted)} comments · ${String(atBudget.truePositives)} credited · P ${atBudget.precision.toFixed(4)} · R ${atBudget.recall.toFixed(4)} · F1 ${atBudget.f1.toFixed(4)}`,
      ]),
  '',
  'lane                findings  credited  unique  density',
  ...laneRows.map(
    (row) =>
      `${row.lane.padEnd(18)}${String(row.findings).padStart(8)}${String(row.credited).padStart(10)}${String(
        row.unique,
      ).padStart(8)}${row.density.toFixed(4).padStart(9)}`,
  ),
  ...(difference === null
    ? []
    : [
        '',
        `against ${difference.reference} (${String(difference.referenceLaneSet)})`,
        `  their ceiling ${String(difference.referenceCeiling)} · shared ${String(difference.shared)} · only this arm ${String(difference.onlyArm)} · only theirs ${String(difference.onlyReference)}`,
      ]),
];
process.stdout.write(`${lines.join('\n')}\n`);
if (options.json !== null) {
  writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`wrote ${options.json}\n`);
}
void pullRequestOf;
