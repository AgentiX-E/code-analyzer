#!/usr/bin/env node
/**
 * **Where the pool's comments come from, and which of them are worth their slot.**
 *
 * ```
 * node scripts/pool-density.mjs benchmarks/martian-bench.json --corpus benchmarks/martian/positive_samples.json \
 *   --profile core --budget 5
 * ```
 *
 * §160.3 left the campaign one sentence: *our ranker is not the deficit; our generator is.* It reached that by
 * comparing densities - matched goldens per emitted comment - and the comparison it published, `0.0986` against
 * `0.1769`, divided our **full emission** by our denominator and their **shipped emission** by theirs. Those are two
 * different stages of two different pipelines. **The comparable quantity is what reaches the budget**, after the steps
 * the product applies and before the one step that chooses, and this instrument is what computes it.
 *
 * **Two quantities, because the question has two halves.**
 *
 *   - **Density** is `matched goldens / comments` inside one group: what a lane's own comments buy when nothing else
 *     competes for credit. It answers *which lane writes comments that the corpus credits*.
 *   - **Marginal value** is the F1 of the cut with the whole group removed, minus the F1 without. It answers *which lane's
 *     slots another lane would spend better* - and it is not the same question, because a low-density lane still earns
 *     its place when the slots it frees go unused. **The budget is what makes the two differ**, which is why the
 *     instrument takes one.
 *
 * **The guard is the rule the rest of the repository applies**: the pool is rebuilt through the artifact's own steps and
 * the point at the artifact's own budget has to reproduce the numbers that artifact published. **A pool rebuilt through
 * a rule the run did not apply is a pool about a different reviewer**, and every density under it is a claim about
 * nothing.
 *
 * **What it does not do.** It prices removal of a group that a run already produced; it cannot price a lane that would
 * write different comments, and it cannot see the goldens a lane's comment failed to name. A deficit it reports is a
 * deficit of what was written, never of what a lane could write.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { PROFILES, profileMaps, restrictFindings } from './lib/corpus-profile.mjs';
import { applyCut, describeCut, pullRequestOf, score } from './lib/operating-point.mjs';

function parseArgs(argv) {
  const options = {
    artifact: null,
    corpus: null,
    profile: 'all',
    group: 'lane',
    budget: null,
    resolution: 0.0126,
    splitHalf: false,
    json: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--corpus') options.corpus = argv[(i += 1)];
    else if (arg === '--profile') options.profile = argv[(i += 1)];
    else if (arg === '--group') options.group = argv[(i += 1)];
    else if (arg === '--budget') options.budget = Number(argv[(i += 1)]);
    else if (arg === '--resolution') options.resolution = Number(argv[(i += 1)]);
    else if (arg === '--split-half') options.splitHalf = true;
    else if (arg === '--json') options.json = argv[(i += 1)];
    else if (arg.startsWith('--')) {
      process.stderr.write(`unknown option ${arg}\n`);
      process.exit(2);
    } else options.artifact = arg;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.artifact === null) {
  process.stderr.write(
    'usage: pool-density.mjs <artifact.json> [--corpus <positive_samples.json>] [--profile core|all] ' +
      '[--group lane|category] [--budget k] [--resolution 0.0126] [--split-half] [--json out]\n',
  );
  process.exit(2);
}

const artifact = JSON.parse(readFileSync(options.artifact, 'utf8'));
const findings = artifact.rankedFindings ?? [];
const credit = (finding) => finding.matchedGoldens ?? [];
const shipped = artifact.emissionRules?.shipped ?? {};
const steps = shipped.steps ?? [];
const nonBudget = steps.filter((step) => step?.kind !== 'budget');
const shippedBudget = steps.find((step) => step?.kind === 'budget')?.k ?? null;
const budget = Number.isInteger(options.budget) ? options.budget : shippedBudget;

if (findings.length === 0 || budget === null) {
  process.stderr.write(
    `${options.artifact}: no rankedFindings or no budget, so there is no pool to divide\n`,
  );
  process.exit(2);
}

/**
 * **Guard 1: the pool has to be this run's pool.**
 *
 * The rebuild keeps every step except the budget and re-imposes it, so the only thing that moves between this point and
 * the published one is arithmetic that should agree. **`k` and `truePositives` rather than F1**, because a matching bug
 * and a denominator bug both move a rate and only one of them moves a count.
 */
const goldens = Number(artifact.truePositives ?? 0) + Number(artifact.falseNegatives ?? 0);
const rebuilt = score(applyCut(findings, steps), credit, goldens);
if (
  shippedBudget !== null &&
  (rebuilt.emitted !== shipped.point?.k || rebuilt.truePositives !== shipped.point?.truePositives)
) {
  process.stderr.write(
    `${options.artifact}: the rebuild emits ${String(rebuilt.emitted)} comments / ${String(rebuilt.truePositives)} true positives and the artifact published ${String(shipped.point?.k)} / ${String(shipped.point?.truePositives)}\n`,
  );
  process.exit(1);
}

/**
 * **The profile is applied after the guard, because the guard is about the run and the profile is about the corpus.**
 *
 * The denominator is the profile's own count over the pull requests this artifact emitted on, so a run that covered 50
 * of the corpus's rows is scored against its own 50 - the same rule `cut-curve.mjs` applies, for the same reason.
 */
let scored = findings;
let creditOf = credit;
let denominator = goldens;
let maps = null;
let profileNote = '';
if (options.profile !== 'all') {
  if (options.corpus === null) {
    process.stderr.write(
      '--profile needs --corpus <positive_samples.json>, because a profile is a denominator kept in the corpus\n',
    );
    process.exit(2);
  }
  if (!(options.profile in PROFILES)) {
    process.stderr.write(
      `profile ${JSON.stringify(options.profile)} is not registered; known profiles are ${Object.keys(PROFILES).join(', ')}\n`,
    );
    process.exit(2);
  }
  const corpus = JSON.parse(readFileSync(options.corpus, 'utf8'));
  maps = profileMaps(corpus, options.profile).maps;
  scored = restrictFindings(findings, { maps });
  creditOf = (finding) => finding.profileGoldens ?? [];
  denominator = 0;
  for (const pullRequest of new Set(scored.map(pullRequestOf))) {
    denominator += maps.get(pullRequest)?.size ?? 0;
  }
  profileNote = ` (profile ${options.profile})`;
}

const groupOf = (finding) => {
  const value =
    options.group === 'lane' ? (finding.lane ?? 'unnamed') : (finding.category ?? 'unnamed');
  return String(value);
};
const pool = applyCut(scored, nonBudget);
/** The cut at the budget under test: the point every marginal is measured against. */
const pointAt = (rows, k) => score(applyCut(rows, [{ kind: 'budget', k }]), creditOf, denominator);
const base = pointAt(pool, budget);
/**
 * **What the pool itself credits, which is the number the pool's density is a rate of.**
 *
 * The budget's own `truePositives` is what *survives* the choosing, and quoting it as the pool's is the two-stages
 * confusion `§160.3` made. A pool's density is its credit over its own comments, before any slot is contested.
 */
const poolPoint = score(pool, creditOf, denominator);

/**
 * **A group's own density, from a matching over its comments alone.**
 *
 * The credit is the corpus's protocol applied to the subset, not a share of the whole pool's matching: **a comment that
 * would have been credited in the pool and is not credited inside its own lane is a comment competing with its own
 * colleagues**, and that competition is part of what the density is a rate of.
 */
const density = (rows) => {
  const own = score(rows, creditOf, denominator);
  return {
    truePositives: own.truePositives,
    density: rows.length === 0 ? 0 : own.truePositives / rows.length,
  };
};

const groups = [...new Set(pool.map(groupOf))].sort();
const rows = groups.map((group) => {
  const members = pool.filter((finding) => groupOf(finding) === group);
  const without = pool.filter((finding) => groupOf(finding) !== group);
  const removed = pointAt(without, budget);
  return {
    group,
    comments: members.length,
    share: pool.length === 0 ? 0 : members.length / pool.length,
    ...density(members),
    withoutF1: removed.f1,
    delta: removed.f1 - base.f1,
    emittedWithout: removed.emitted,
    truePositivesWithout: removed.truePositives,
  };
});

/**
 * **The split-half form of the same question, because a marginal read off the pool it was chosen from is a fitted one.**
 *
 * Each half is scored against its own goldens, so the two figures are on the denominators they are held out from. **A
 * group is only a candidate for removal when the half that chose it and the half that did not see it agree in sign and
 * the held-out magnitude clears the instrument's resolution** - the rule `cut-curve.mjs` applies to a budget, applied to
 * a group.
 */
let splitHalf = null;
if (options.splitHalf) {
  if (maps === null) {
    process.stderr.write(
      '--split-half needs --profile, because a half has its own denominator and the denominator lives in the corpus\n',
    );
    process.exit(2);
  }
  const pullRequests = [...new Set(scored.map(pullRequestOf))].sort();
  const even = new Set(pullRequests.filter((_, at) => at % 2 === 0));
  const goldensOf = (which) => {
    let count = 0;
    for (const [pullRequest, index] of maps.entries())
      if (which.has(pullRequest)) count += index.size;
    return count;
  };
  const halves = {
    chosen: {
      rows: pool.filter((finding) => even.has(pullRequestOf(finding))),
      goldens: goldensOf(even),
    },
    'held-out': {
      rows: pool.filter((finding) => !even.has(pullRequestOf(finding))),
      goldens: goldensOf(new Set(pullRequests.filter((_, at) => at % 2 === 1))),
    },
  };
  const baseOf = {};
  for (const [name, half] of Object.entries(halves)) {
    baseOf[name] = score(
      applyCut(half.rows, [{ kind: 'budget', k: budget }]),
      creditOf,
      half.goldens,
    );
  }
  splitHalf = {
    budget,
    chosenGoldens: halves.chosen.goldens,
    heldOutGoldens: halves['held-out'].goldens,
    groups: groups.map((group) => {
      const measured = {};
      for (const [name, half] of Object.entries(halves)) {
        const without = half.rows.filter((finding) => groupOf(finding) !== group);
        const removed = score(
          applyCut(without, [{ kind: 'budget', k: budget }]),
          creditOf,
          half.goldens,
        );
        measured[name] = { f1: removed.f1, delta: removed.f1 - baseOf[name].f1 };
      }
      const agrees =
        Math.sign(measured.chosen.delta) === Math.sign(measured['held-out'].delta) &&
        Math.abs(measured['held-out'].delta) >= options.resolution;
      return {
        group,
        chosenDelta: measured.chosen.delta,
        heldOutDelta: measured['held-out'].delta,
        // **`removal-gains` is the claim; `free` is the same sign without the magnitude to support it.** A group whose two
        // halves disagree is `unresolved` however large either half reads, because that is what disagreement means.
        verdict: agrees
          ? measured['held-out'].delta > 0
            ? 'removal-gains'
            : 'load-bearing'
          : 'unresolved',
      };
    }),
  };
}

const head =
  `${options.artifact}\n` +
  `rule ${describeCut(nonBudget)}   group by ${options.group}   budget ${String(budget)} (shipped ${String(shippedBudget)})   ` +
  `goldens ${String(denominator)}${profileNote}\n` +
  `full emission ${String(scored.length)}  ->  pool after the rule ${String(pool.length)} with ` +
  `${String(poolPoint.truePositives)} credited (density ${(pool.length === 0 ? 0 : poolPoint.truePositives / pool.length).toFixed(4)})\n` +
  `at the budget: emitted ${String(base.emitted)}  tp ${String(base.truePositives)}  ` +
  `P ${base.precision.toFixed(4)}  R ${base.recall.toFixed(4)}  F1 ${base.f1.toFixed(4)}\n\n`;
const pad = (value, width) => String(value).padStart(width);
const table =
  `${options.group.padEnd(16)}${pad('comments', 9)}${pad('share', 7)}${pad('tp', 5)}${pad('density', 9)}${pad('dF1', 9)}  verdict\n` +
  rows
    .map((row) => {
      const sign = row.delta >= 0 ? '+' : '';
      const verdict =
        Math.abs(row.delta) < options.resolution
          ? 'inside resolution'
          : row.delta > 0
            ? 'removal gains'
            : 'load-bearing';
      return (
        `${row.group.padEnd(16)}${pad(row.comments, 9)}${pad(`${(row.share * 100).toFixed(1)}%`, 7)}` +
        `${pad(row.truePositives, 5)}${pad(row.density.toFixed(4), 9)}${pad(`${sign}${row.delta.toFixed(4)}`, 9)}  ${verdict}\n`
      );
    })
    .join('');

process.stdout.write(head + table);
if (splitHalf !== null) {
  process.stdout.write(
    `\nsplit-half  budget ${String(splitHalf.budget)}  chosen ${String(splitHalf.chosenGoldens)} goldens  ` +
      `held out ${String(splitHalf.heldOutGoldens)} goldens  resolution ${options.resolution.toFixed(4)}\n` +
      splitHalf.groups
        .map(
          (group) =>
            `  ${group.group.padEnd(16)}chosen ${`${group.chosenDelta >= 0 ? '+' : ''}${group.chosenDelta.toFixed(4)}`.padStart(9)}` +
            `   held out ${`${group.heldOutDelta >= 0 ? '+' : ''}${group.heldOutDelta.toFixed(4)}`.padStart(9)}   ${group.verdict}\n`,
        )
        .join(''),
  );
}
process.stdout.write('\n');

if (options.json) {
  writeFileSync(
    options.json,
    `${JSON.stringify(
      {
        version: 'pool-density-v1',
        artifact: options.artifact,
        corpus: options.corpus,
        profile: options.profile,
        group: options.group,
        laneSet: artifact?.configuration?.laneSet?.name ?? null,
        // **The rule the pool was measured through, recorded because two artifacts of the same arm can carry different
        // rules**: the Martian artifact of 2026-11-18 predates §106's path-class step, so its pool is a larger one and a
        // reader comparing two densities has to be able to see that rather than infer it.
        emissionSteps: nonBudget,
        budget,
        shippedBudget,
        goldens: denominator,
        fullEmission: scored.length,
        pool: pool.length,
        poolPoint,
        point: base,
        groups: rows,
        splitHalf,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`wrote ${options.json}\n`);
}
