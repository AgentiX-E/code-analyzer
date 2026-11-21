// @code-analyzer/scripts — the one thing that is allowed to change the reviewer the product ships
//
// **The failure this file exists to end.** Three iterations of experiments produced figures, and every one of them
// ended in a markdown table and a hand edit - or in nothing at all, because nobody made the edit. **A device that was
// measured to help and never reached the engine is a device the product does not have**, and a device that reached the
// engine without being measured is a product change with no evidence behind it. Both are the same defect: **the
// experiment and the product were two places, and nothing joined them.**
//
// **So the join is a program with a rule and a record.** `packages/intelligence/config/promotion-rule.json` states what
// counts as evidence *before* the numbers arrive. This file applies it to a set of arm artifacts and either rewrites
// `packages/intelligence/config/review-defaults.json` - from which the engine's compiled defaults and the harness's own
// arms are both read - or refuses and says which of nine named conditions refused it.
//
// **Why a within-run comparison rather than a stored number.** The baseline arm is the arm whose knobs equal the
// configuration that currently ships, and it is *in the same run* as the challengers: same corpus slice, same pull
// requests, same goldens, same judge. **A promotion therefore never compares a figure against a remembered figure**, so
// the drift a stored baseline accumulates - a corpus that moved, a judge that was replaced, a harness that added a
// field - cannot be mistaken for a device that helped.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { pairedComparison } from './lib/paired-test.mjs';
import {
  GENERATED_PATH,
  KNOB_NAMES,
  readPromotionRule,
  readReviewDefaults,
  renderDefaultsModule,
} from './lib/review-defaults.mjs';

const round = (value) => Math.round(value * 10_000) / 10_000;

/**
 * **Where each knob's value is written in an artifact, and what has to be true for the run to have *read* it.**
 *
 * The second half is not pedantry. **R-67 was dispatched at a budget of 20 and its artifact said 20, and the run's
 * headline was what the engine emits with nothing cut at all** - because `maxFindingsPerPullRequest` is read inside
 * `reviewPullRequest` and nowhere else, so the number travelled to the artifact and not to the arm. **A knob that is
 * recorded and not applied is a challenger that never ran**, and §128 of `docs/EVAL-CONTRACT.md` is the readback of
 * what that cost. Every entry below therefore also names the field that proves the value arrived where it was read.
 */
export const KNOB_EVIDENCE = Object.freeze({
  // Read in `reviewPullRequest` only. The proof is the pull-request arm's own budget, which the engine writes from the
  // option it received: a `configuration.pullRequestArmBudget` that disagrees with `pullRequestArm.budgetPerPullRequest`
  // is a number that described a call nobody made.
  maxFindingsPerPullRequest: {
    read: (artifact) => artifact?.configuration?.pullRequestArmBudget,
    applied: (artifact, value) => artifact?.pullRequestArm?.budgetPerPullRequest === value,
    where: 'configuration.pullRequestArmBudget, proven by pullRequestArm.budgetPerPullRequest',
  },
  // Read by both arms as an engine-level option, and recorded by the harness from the same environment variable the
  // engine reads. The proof is therefore that the artifact records a boolean at all: an artifact that omits it is a
  // figure whose reviewer is unnamed.
  codeContext: {
    read: (c) => c?.configuration?.codeContext,
    applied: (c) => typeof c?.configuration?.codeContext === 'boolean',
    where: 'configuration.codeContext',
  },
  adjudicate: {
    read: (c) => c?.configuration?.adjudicate,
    applied: (c) => typeof c?.configuration?.adjudicate === 'boolean',
    where: 'configuration.adjudicate',
  },
  remarks: {
    read: (c) => c?.configuration?.remarks?.enabled,
    applied: (c) => typeof c?.configuration?.remarks?.enabled === 'boolean',
    where: 'configuration.remarks.enabled',
  },
  secondConcern: {
    read: (c) => c?.configuration?.secondConcern,
    applied: (c) => typeof c?.configuration?.secondConcern === 'boolean',
    where: 'configuration.secondConcern',
  },
  sameSiteConcerns: {
    read: (c) => c?.configuration?.sameSiteConcerns,
    applied: (c) => Number.isInteger(c?.configuration?.sameSiteConcerns),
    where: 'configuration.sameSiteConcerns',
  },
  languageChecklist: {
    read: (c) => c?.configuration?.languageChecklist,
    applied: (c) => typeof c?.configuration?.languageChecklist === 'boolean',
    where: 'configuration.languageChecklist',
  },
});

/** The knobs an artifact actually describes, with the evidence that the run read them. */
export function knobsOf(artifact) {
  const knobs = {};
  const missing = [];
  const unproven = [];
  for (const name of KNOB_NAMES) {
    const evidence = KNOB_EVIDENCE[name];
    const value = evidence.read(artifact);
    if (value === undefined || value === null) {
      missing.push(name);
      continue;
    }
    knobs[name] = value;
    if (!evidence.applied(artifact, value)) unproven.push(name);
  }
  return { knobs, missing, unproven };
}

/**
 * **The coverage set a paired test needs: `pull request # golden`, for every golden this arm matched.**
 *
 * A count cannot be paired. **Two arms that matched ninety goldens each may have matched ninety different ones**, and a
 * comparison between two counts is a comparison of two marginal totals - which is the statistic McNemar's test exists
 * to replace. `null` when the artifact predates `coveredGoldens`, because a set cannot be invented from a count and a
 * promoter that guessed would be promoting an unpaired difference.
 */
export function coverageOf(artifact) {
  const rows = artifact?.pullRequestArm?.perPullRequest;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const set = new Set();
  for (const row of rows) {
    if (!Array.isArray(row?.coveredGoldens)) return null;
    for (const index of row.coveredGoldens) set.add(`${String(row.pr)}#${String(index)}`);
  }
  return set;
}

/** A metric by dotted path, because the rule names one and the rule is a file. */
export function metricAt(artifact, path) {
  let node = artifact;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return null;
    node = node[key];
  }
  return typeof node === 'number' ? node : null;
}

const sameKnobs = (a, b) => KNOB_NAMES.every((name) => a?.[name] === b?.[name]);

/**
 * **The decision, as a value rather than as an edit.**
 *
 * Every refusal is a named reason, because a promoter that only said "no" would leave the next dispatch guessing which
 * of nine conditions it failed. **The list of refusals is the report**, and the outcome is `hold` whenever any
 * challenger was refused for a reason that is not "it lost".
 */
export function promote({ arms, defaults, rule }) {
  const rejections = [];
  const metricPath = rule.metric;

  // ---- every arm has to be readable at all -------------------------------------------------
  const read = [];
  for (const arm of arms) {
    const { knobs, missing, unproven } = knobsOf(arm.artifact);
    if (missing.length > 0) {
      rejections.push({
        arm: arm.label,
        reason: 'not-recorded',
        detail: `the artifact does not record ${missing.join(', ')}, so the run's reviewer is unnamed`,
      });
      continue;
    }
    if (unproven.length > 0) {
      rejections.push({
        arm: arm.label,
        reason: 'not-applied',
        detail: `${unproven.join(', ')} was recorded but the artifact carries no evidence the run read it (${KNOB_EVIDENCE[unproven[0]].where})`,
      });
      continue;
    }
    const score = metricAt(arm.artifact, metricPath);
    if (score === null) {
      rejections.push({
        arm: arm.label,
        reason: 'not-scored',
        detail: `the artifact carries no ${metricPath}`,
      });
      continue;
    }
    read.push({ label: arm.label, artifact: arm.artifact, knobs, score });
  }

  if (read.length === 0) {
    return { outcome: 'hold', reason: 'no-readable-arm', champion: null, rejections, metricPath };
  }

  // ---- the baseline is the arm that is the configuration currently shipped ------------------
  const baseline = read.find((arm) => sameKnobs(arm.knobs, defaults.knobs));
  if (baseline === undefined) {
    return {
      outcome: 'hold',
      reason: 'no-baseline',
      champion: null,
      rejections,
      metricPath,
      detail:
        'no arm in this set ran the configuration that ships, so the comparison would be against a remembered number rather than against a measured one',
    };
  }

  // ---- a promotion is a comparison inside one run or it is not a comparison ----------------
  const corpusKey = (artifact) =>
    JSON.stringify([
      artifact?.corpusSlice?.skip ?? null,
      artifact?.corpusSlice?.requested ?? null,
      artifact?.prsReviewed ?? null,
      artifact?.datasetRows ?? null,
    ]);
  const baselineCorpus = corpusKey(baseline.artifact);
  const comparable = [];
  for (const arm of read) {
    const shortSample =
      (arm.artifact?.prsReviewed ?? 0) < rule.minimumSample.pullRequests ||
      (arm.artifact?.pullRequestArm?.perPullRequest ?? []).reduce(
        (total, row) => total + (row.goldens ?? 0),
        0,
      ) < rule.minimumSample.goldens;
    if (shortSample) {
      rejections.push({
        arm: arm.label,
        reason: 'incomplete-sample',
        detail: `below the registered minimum of ${String(rule.minimumSample.pullRequests)} pull requests and ${String(rule.minimumSample.goldens)} goldens`,
      });
      continue;
    }
    if (corpusKey(arm.artifact) !== baselineCorpus) {
      rejections.push({
        arm: arm.label,
        reason: 'unpaired-corpus',
        detail:
          'a different slice of the corpus from the baseline, so a difference would be a difference of rows',
      });
      continue;
    }
    const coverage = coverageOf(arm.artifact);
    if (coverage === null) {
      rejections.push({
        arm: arm.label,
        reason: 'unpaired-coverage',
        detail:
          'the artifact carries no per-golden coverage, so the two arms cannot be paired and McNemar cannot be computed',
      });
      continue;
    }
    comparable.push({ ...arm, coverage });
  }

  if (comparable.length === 0) {
    return { outcome: 'hold', reason: 'no-comparable-arm', champion: null, rejections, metricPath };
  }

  // ---- rank, and treat everything inside the instrument's resolution as one rank ------------
  const ranked = comparable.slice().sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const band = ranked.filter((arm) => top.score - arm.score < rule.minimumDelta);
  // **A tie is broken by the rule and not by the order of the directories**: cheaper first, because two arms that a
  // corpus cannot tell apart should not be promoted for being more expensive.
  const costOf = (arm) => arm.artifact?.spend?.totalCacheNeutralUsd ?? Number.POSITIVE_INFINITY;
  const cheapest = band.slice().sort((a, b) => costOf(a) - costOf(b))[0];

  const baselineCoverage = coverageOf(baseline.artifact);
  const paired = pairedComparison(cheapest.coverage, baselineCoverage);
  const delta = round(cheapest.score - baseline.score);

  const refuse = (reason, detail) => ({
    outcome: 'hold',
    reason,
    champion: null,
    rejections,
    metricPath,
    baseline: { label: baseline.label, knobs: baseline.knobs, score: baseline.score },
    candidate: { label: cheapest.label, knobs: cheapest.knobs, score: cheapest.score },
    paired,
    delta,
    detail,
  });

  if (sameKnobs(cheapest.knobs, baseline.knobs)) {
    return refuse(
      'no-challenger',
      'the best arm in this set is the configuration that already ships, which is a result rather than a promotion',
    );
  }
  // **There is no "the challenger is worse" branch, and its absence is a theorem rather than an omission.** The baseline
  // is one of the arms, so a challenger that is behind it cannot be the best arm; and the resolution band is centred on
  // the best arm, so every arm inside it scored above the baseline. A `delta <= 0` branch would therefore be a branch no
  // arm can reach - and a branch no arm can reach is a reason string a report can print about a case that never
  // happened, which is the shape this repository's dead-branch rule exists to refuse.
  if (delta < rule.minimumDelta) {
    return refuse(
      'below-resolution',
      `the challenger is ${String(delta)} ahead, inside the instrument's own resolution of ${String(rule.minimumDelta)} - a noise draw rather than a device`,
    );
  }
  if (rule.requirePaired && paired.pValue > 0.05) {
    return refuse(
      'not-significant',
      `the challenger found ${String(paired.oursOnly)} goldens the baseline did not and missed ${String(paired.theirsOnly)} the baseline found, exact McNemar p = ${paired.pValue.toFixed(4)}`,
    );
  }

  const precision = metricAt(cheapest.artifact, 'pullRequestArm.precision');
  const recall = metricAt(cheapest.artifact, 'pullRequestArm.recall');
  if (precision !== null && precision < rule.guards.precision) {
    return refuse(
      'guard-regressed',
      `precision ${String(precision)} is below the registered floor of ${String(rule.guards.precision)}`,
    );
  }
  if (recall !== null && recall < rule.guards.recall) {
    return refuse(
      'guard-regressed',
      `recall ${String(recall)} is below the registered floor of ${String(rule.guards.recall)}`,
    );
  }

  return {
    outcome: 'promote',
    reason: 'beats-baseline',
    metricPath,
    delta,
    paired,
    rejections,
    baseline: { label: baseline.label, knobs: baseline.knobs, score: baseline.score },
    champion: {
      label: cheapest.label,
      knobs: cheapest.knobs,
      score: cheapest.score,
      precision,
      recall,
      pullRequests: cheapest.artifact?.prsReviewed ?? null,
      goldens: (cheapest.artifact?.pullRequestArm?.perPullRequest ?? []).reduce(
        (total, row) => total + (row.goldens ?? 0),
        0,
      ),
      runId: cheapest.artifact?.provenance?.runId ?? null,
      commit: cheapest.artifact?.provenance?.sha ?? null,
    },
  };
}

/** The configuration file with the champion's knobs and the record of who won them. */
export function defaultsWith(decision, defaults, { resolvedAt, runUrl = null, ruleVersion }) {
  return {
    ...defaults,
    knobs: { ...decision.champion.knobs },
    provenance: {
      decision: 'promoted',
      resolvedBy: 'aacr-promote.mjs',
      resolvedAt,
      ruleVersion,
      incumbent: {
        experiment: decision.baseline.label,
        metric: { [decision.metricPath]: decision.baseline.score },
        knobs: decision.baseline.knobs,
      },
      champion: {
        experiment: decision.champion.label,
        metric: { [decision.metricPath]: decision.champion.score },
        precision: decision.champion.precision,
        recall: decision.champion.recall,
        delta: decision.delta,
        pullRequests: decision.champion.pullRequests,
        goldens: decision.champion.goldens,
        mcnemarP: round(decision.paired.pValue),
        gained: decision.paired.oursOnly,
        lost: decision.paired.theirsOnly,
        runId: decision.champion.runId,
        runUrl,
      },
      whyHeld: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * **The self-test runs the rule against a fixture whose answer was written before the arithmetic was.**
 *
 * Six arms: a baseline, one challenger worth +0.06 with a clean pairing, one worth +0.01 (inside the resolution), one
 * whose budget was recorded and never applied, one on a different corpus slice, and one that is cheaper but no better.
 * **The four refusals are the assertions**; a promoter that promoted any of them would be promoting noise, and a
 * promoter that refused the first would be a promoter nobody runs twice.
 */
export function selfTest() {
  const fail = (message) => {
    throw new Error(`promotion self-test failed: ${message}`);
  };

  const knobs = {
    maxFindingsPerPullRequest: 12,
    sameSiteConcerns: 1,
    secondConcern: false,
    codeContext: false,
    adjudicate: false,
    remarks: false,
    languageChecklist: false,
  };
  const fixture = (
    label,
    overrides,
    { f1, precision = 0.5, recall = 0.5, skip = 0, unapplied = false, covered = [] } = {},
  ) => ({
    label,
    artifact: {
      configuration: {
        languageChecklist: false,
        codeContext: knobs.codeContext,
        adjudicate: false,
        remarks: { enabled: false },
        secondConcern: false,
        sameSiteConcerns: 1,
        pullRequestArmBudget: knobs.maxFindingsPerPullRequest,
        ...overrides,
      },
      pullRequestArm: {
        f1,
        precision,
        recall,
        budgetPerPullRequest: unapplied ? 12 : (overrides.pullRequestArmBudget ?? 12),
        perPullRequest: [
          { pr: 'p#1', goldens: 200, covered: covered.length, coveredGoldens: covered },
          { pr: 'p#2', goldens: 200, covered: 0, coveredGoldens: [] },
        ],
      },
      corpusSlice: { skip, requested: 40 },
      prsReviewed: 40,
      datasetRows: 200,
      spend: { totalCacheNeutralUsd: 10 },
    },
  });

  // **A discordance a corpus of forty pull requests can actually produce**: the baseline finds five goldens, the
  // challenger finds those four plus eight, and loses one. `oursOnly = 8, theirsOnly = 1` gives an exact McNemar tail of
  // 0.039 - significant - while +0.01 on five goldens does not, which is the distinction the rule exists to make.
  const base = [0, 1, 2, 3, 50];
  const arms = [
    fixture('baseline', {}, { f1: 0.2, covered: base }),
    fixture(
      'worth-0.06',
      { codeContext: true },
      { f1: 0.26, covered: [10, 11, 12, 13, 14, 15, 16, 17, 50, 1, 2, 3] },
    ),
    fixture('worth-0.01', { adjudicate: true }, { f1: 0.21, covered: [0, 1, 2, 3, 50, 60] }),
    fixture(
      'recorded-not-applied',
      { pullRequestArmBudget: 20 },
      { f1: 0.3, unapplied: true, covered: base },
    ),
    fixture('other-corpus', { remarks: { enabled: true } }, { f1: 0.3, skip: 50, covered: base }),
    fixture('cheaper-no-better', { sameSiteConcerns: 2 }, { f1: 0.2, covered: base }),
  ];

  const rule = {
    version: 1,
    metric: 'pullRequestArm.f1',
    primary: 'f1',
    minimumDelta: 0.0281,
    guards: { precision: 0.2, recall: 0.15 },
    minimumSample: { pullRequests: 30, goldens: 300 },
    requirePaired: true,
    requireApplied: true,
    tieBreak: ['f1', 'precision', 'cost'],
  };

  const decision = promote({ arms, defaults: { knobs }, rule });
  if (decision.outcome !== 'promote')
    fail(`the one real challenger was not promoted: ${JSON.stringify(decision)}`);
  if (decision.champion.label !== 'worth-0.06')
    fail(`promoted ${decision.champion.label}, not worth-0.06`);
  if (!decision.champion.knobs.codeContext)
    fail('the promoted configuration did not carry the winning knob');
  if (Math.abs(decision.delta - 0.06) > 1e-9) fail(`delta read as ${String(decision.delta)}`);

  const reasons = new Set(decision.rejections.map((entry) => entry.reason));
  for (const reason of ['not-applied', 'unpaired-corpus']) {
    if (!reasons.has(reason)) fail(`a refusal reason went unreported: ${reason}`);
  }

  // **And the refusal that is not an error.** A set whose best arm is the baseline is a run that measured nothing,
  // and promoting it would rewrite the file on every dispatch.
  const held = promote({
    arms: [fixture('baseline', {}, { f1: 0.2, covered: base })],
    defaults: { knobs },
    rule,
  });
  if (held.outcome !== 'hold' || held.reason !== 'no-challenger')
    fail(`one arm that is the baseline produced ${held.outcome}/${String(held.reason)}`);

  // **The two-sided refusal of a small win**, which is the assertion the whole rule is for: +0.01 is inside the
  // resolution and the promoter must say so by name rather than promoting it quietly.
  const inside = promote({
    arms: [
      fixture('baseline', {}, { f1: 0.2, covered: base }),
      fixture('small', { codeContext: true }, { f1: 0.21, covered: [...base, 4] }),
    ],
    defaults: { knobs },
    rule,
  });
  if (inside.outcome !== 'hold' || inside.reason !== 'below-resolution')
    fail(`a win inside the resolution produced ${inside.outcome}/${String(inside.reason)}`);

  return 'promotion: 8 assertions hold';
}

function readArtifacts(directories) {
  return directories.map((directory) => {
    const path = join(directory, 'aacr-bench.json');
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`an arm's artifact could not be read at ${path}: ${String(error)}`);
    }
    return { label: directory.replace(/\/+$/u, '').split('/').pop() ?? directory, artifact };
  });
}

function expand(argument) {
  // A directory of directories is what `download-artifact` leaves behind when it is told to keep the artifacts apart;
  // expanding here rather than in the workflow keeps the job's shell free of a `find` that a reader has to trust.
  let entries;
  try {
    entries = readdirSync(argument, { withFileTypes: true });
  } catch {
    return [argument];
  }
  const nested = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(argument, entry.name))
    .filter((path) => {
      try {
        readFileSync(join(path, 'aacr-bench.json'));
        return true;
      } catch {
        return false;
      }
    });
  return nested.length > 0 ? nested : [argument];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    process.stdout.write(`${selfTest()}\n`);
    return;
  }

  const directories = args.filter((argument) => !argument.startsWith('--')).flatMap(expand);
  if (directories.length === 0)
    throw new Error('no arm directories were given: pass one download directory per artifact');

  const write = args.includes('--write');
  const outFlag = args.indexOf('--out');
  const outPath = outFlag === -1 ? null : args[outFlag + 1];
  const runUrlFlag = args.indexOf('--run-url');
  const runUrl = runUrlFlag === -1 ? null : args[runUrlFlag + 1];

  const defaults = readReviewDefaults();
  const rule = readPromotionRule();
  const decision = promote({ arms: readArtifacts(directories), defaults, rule });

  const record = {
    ...decision,
    ruleVersion: rule.version,
    resolvedAt: new Date().toISOString().slice(0, 10),
    arms: directories.map(
      (directory) => directory.replace(/\/+$/u, '').split('/').pop() ?? directory,
    ),
  };
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);

  if (outPath !== null) writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);

  if (write && decision.outcome === 'promote') {
    const next = defaultsWith(decision, defaults, {
      resolvedAt: record.resolvedAt,
      runUrl,
      ruleVersion: rule.version,
    });
    writeFileSync(
      join(process.cwd(), 'packages/intelligence/config/review-defaults.json'),
      `${JSON.stringify(next, null, 2)}\n`,
    );
    // **The module the engine compiles, in the same breath as the JSON it is rendered from.** Two writes rather than
    // one because the engine cannot import JSON through `tsc` without pointing at a file the build never copies; the
    // guard test re-renders and compares, so a half-written pair is a red build rather than a silent disagreement.
    writeFileSync(GENERATED_PATH, renderDefaultsModule(next));
    process.stdout.write(
      'promoted: packages/intelligence/config/review-defaults.json was rewritten\n',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
