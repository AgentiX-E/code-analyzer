#!/usr/bin/env node
/**
 * **What a conditioning device could reach, priced on the artifact that refused the last one.**
 *
 * ```
 * node scripts/symbol-adjacency.mjs --arm benchmarks/martian-wide-bench.json \
 *   --reference benchmarks/aacr/competitor-baseline.json \
 *   --corpus benchmarks/martian/positive_samples.json --profile core --budget 5
 * ```
 *
 * §165 refused a sixth call because it changed *which* comments were emitted and not *what they said*, and it left the
 * campaign with one question: **of the goldens only the competitor credits, how many sit on something we already wrote
 * about?** §164.3 answered it by hand - twenty of thirty-two, "a symbol appears in our text" - and a hand count of a
 * lexical rule is not a measurement, because the rule is the thing that needs to be defended.
 *
 * This instrument makes the rule mechanical (`scripts/lib/symbol-anatomy.mjs`), publishes the sweep over its one
 * parameter, and adds the two controls a count of matches needs: **a permutation null** and **a wrong-pull-request
 * control**. Then it prices the prize rather than the gap: the comment that names a golden's symbol is already posted, so
 * crediting the golden to that comment is the sentence being corrected and nothing else moving - and the distance from
 * that point to the bar is the number the next device has to be judged on.
 *
 * **Three refusals, and each of them is a claim that the file is not what it says:**
 *
 * - the arm's published point must rebuild through its own cut on its own denominator (`exit 2` for an artifact with no
 *   cut, `exit 1` for one whose arithmetic disagrees with its own record);
 * - the reference must overlap the arm at all, because a set difference against nothing is the arm's own pool wearing the
 *   other arm's name (`exit 2`);
 * - a sweep whose loose end is adjacent to everything is published with the fact that it is, rather than as a reading.
 *
 * **Nothing here costs anything.** It reads three committed files and buys no model call.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { profileMaps, restrictFindings } from './lib/corpus-profile.mjs';
import { applyCut, score } from './lib/operating-point.mjs';
import {
  adjacency,
  baseRate,
  conversionCurve,
  conversionsNeeded,
  creditSets,
  firstClearing,
  creditedGoldens,
  documentFrequency,
  goldenKey,
  permutationNull,
  ranksOf,
  rewriteOracle,
  specificSymbols,
  splitKey,
  wrongPullRequest,
} from './lib/symbol-anatomy.mjs';

const REPO = resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const options = {
    arm: null,
    reference: null,
    corpus: null,
    profile: 'core',
    budget: 5,
    cap: 1,
    permutations: 500,
    seed: 20261126,
    target: 0.3735,
    json: null,
  };
  const numeric = new Set(['budget', 'cap', 'permutations', 'seed', 'target']);
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    if (!arg.startsWith('--')) {
      options.arm = arg;
      continue;
    }
    const name = arg.slice(2);
    if (!(name in options)) {
      process.stderr.write(`unknown option ${arg}\n`);
      process.exit(2);
    }
    if (name === 'json') options.json = argv[(at += 1)];
    else if (numeric.has(name)) options[name] = Number(argv[(at += 1)]);
    else options[name] = argv[(at += 1)];
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.arm === null || options.reference === null || options.corpus === null) {
  process.stderr.write(
    'usage: symbol-adjacency.mjs --arm <artifact.json> --reference <competitor-baseline.json> ' +
      '--corpus <positive_samples.json> [--profile core|all] [--budget k] [--cap n] ' +
      '[--permutations n] [--seed n] [--target f1] [--json out]\n',
  );
  process.exit(2);
}

const read = (path) => JSON.parse(readFileSync(resolve(REPO, path), 'utf8'));
const arm = read(options.arm);
const reference = read(options.reference);
const corpus = read(options.corpus);

/**
 * **Guard: the pool has to be this run's pool, on the run's own denominator, before the profile is applied to it.**
 *
 * The order is the one `pool-density.mjs` and `lane-discovery.mjs` both use, and getting it wrong refuses a good artifact:
 * the guard is about the run, the profile is about the corpus, and comparing a re-index against a point published on the
 * whole board is the §164.8 defect in the other direction.
 */
const steps = arm.emissionRules?.shipped?.steps ?? null;
const published = arm.emissionRules?.shipped?.point ?? null;
if (steps === null || published === null) {
  process.stderr.write(
    `${options.arm} publishes no emissionRules.shipped (steps and point), so its pool cannot be rebuilt\n`,
  );
  process.exit(2);
}
const rawFindings = arm.rankedFindings ?? [];
const rawCredit = (finding) => finding.matchedGoldens ?? [];
const rawGoldens = Number(arm.truePositives ?? 0) + Number(arm.falseNegatives ?? 0);
const rebuiltRaw = score(applyCut(rawFindings, steps), rawCredit, rawGoldens);
if (rebuiltRaw.emitted !== published.k || rebuiltRaw.truePositives !== published.truePositives) {
  process.stderr.write(
    `refusing: the rebuild emits ${String(rebuiltRaw.emitted)} comments / ${String(rebuiltRaw.truePositives)} true positives and the artifact published ${String(published.k)} / ${String(published.truePositives)}\n`,
  );
  process.exit(1);
}

const { maps } = profileMaps(corpus, options.profile);
const rows = restrictFindings(rawFindings, { maps });
const creditOf = (finding) => finding.profileGoldens ?? [];
let goldens = 0;
for (const index of maps.values()) goldens += index.size;

/**
 * **A golden's note, addressed by the identity the profile gave it.**
 *
 * The profile re-indexes a pull request's goldens, so the index in `profileGoldens` is not the index into the answer key
 * and a lookup that used it directly would read the wrong sentence for every pull request with a filtered category -
 * which is 24 of the board's 50. The reverse map is built once, from the same map the restriction used, so the two
 * cannot drift.
 */
const reverse = new Map();
for (const [pullRequest, index] of maps) {
  const back = new Map();
  for (const [full, remapped] of index) back.set(remapped, full);
  reverse.set(pullRequest, back);
}
const noteOf = new Map();
for (const row of corpus) {
  (row?.comments ?? []).forEach((comment, at) => {
    noteOf.set(`${String(row?.githubPrUrl ?? '')}#${String(at)}`, comment);
  });
}

/**
 * **The pool adjacency is measured against is the cut's pool, not the run's.**
 *
 * `drop test` is the first step of the board's cut, so 192 of this run's findings never reach a reader. A golden adjacent
 * only to one of them is adjacent to nothing, and counting it would inflate the one number this instrument exists for.
 * The rows are tagged with their position *before* the cut, because the rewrite addresses the artifact's row and a plan
 * that pointed at a copy would rewrite nothing.
 */
const withoutBudget = steps.filter((step) => step.kind !== 'budget');
const tagged = rows.map((row, at) => ({ ...row, at }));
const poolByPullRequest = new Map();
for (const row of applyCut(tagged, withoutBudget)) {
  const key = String(row?.pr ?? '');
  if (!poolByPullRequest.has(key)) poolByPullRequest.set(key, []);
  poolByPullRequest.get(key).push({ at: Number(row.at), row });
}

const sets = creditSets({ ours: rows, theirs: reference.pulls ?? {}, maps, creditOf });
if (sets.shared === 0) {
  process.stderr.write(
    `refusing: ${options.reference} shares no credited golden with ${options.arm}, so there is no set difference to read\n`,
  );
  process.exit(2);
}

const frequency = documentFrequency(poolByPullRequest);

/** **The nineteen characters a golden's text needs**, in the one shape the rest of this file reads. */
function goldensOf(cap) {
  return sets.onlyTheirs.map((key) => {
    const [pullRequest, remapped] = splitKey(key);
    const full = reverse.get(pullRequest)?.get(remapped);
    const note = String(noteOf.get(`${pullRequest}#${String(full)}`)?.note ?? '');
    return {
      key,
      pullRequest,
      index: remapped,
      category: String(noteOf.get(`${pullRequest}#${String(full)}`)?.category ?? ''),
      symbols: specificSymbols(note, frequency, cap),
      note,
    };
  });
}

/**
 * **The sweep, because the one parameter this instrument has is the one that decides its answer.**
 *
 * At `cap = 1` a symbol belongs to one pull request's pool and the count is a claim about place. At `cap` beyond the
 * pool's vocabulary every golden is adjacent to something and the count is a claim about English. Both ends are published
 * so that a reader can see where the reading stops being a reading - the same reason §162.6 published a floor it chose and
 * the window it chose it in.
 */
const sweepCaps = [1, 2, 3, 5, 8, 12, 1000];
const sweep = sweepCaps.map((cap) => {
  const goldensAt = goldensOf(cap);
  const found = adjacency({ goldens: goldensAt, poolByPullRequest });
  return {
    cap,
    withSymbols: goldensAt.filter((golden) => golden.symbols.length > 0).length,
    adjacent: found.filter((golden) => golden.matches.length > 0).length,
    null: permutationNull({
      goldens: found,
      poolByPullRequest,
      permutations: options.permutations,
      seed: options.seed,
    }),
  };
});

/**
 * **Every golden in the profile, so that the rate on the set has a denominator outside it.**
 *
 * `adjacency` on its own says "twenty-seven of thirty-three", and a reader cannot know whether twenty-seven is a lot.
 * The goldens that are *not* in the set are the only honest comparison, and they cost nothing to count: same rule, same
 * pool, same profile.
 */
function everyGolden(cap) {
  const out = [];
  for (const [pullRequest, index] of maps) {
    for (const [full, remapped] of index) {
      const note = String(noteOf.get(`${pullRequest}#${String(full)}`)?.note ?? '');
      out.push({
        key: goldenKey(pullRequest, remapped),
        pullRequest,
        index: remapped,
        category: String(noteOf.get(`${pullRequest}#${String(full)}`)?.category ?? ''),
        symbols: specificSymbols(note, frequency, cap),
        note,
      });
    }
  }
  return out;
}

const chosenGoldens = goldensOf(options.cap);
const found = adjacency({ goldens: chosenGoldens, poolByPullRequest });
const nullDistribution = permutationNull({
  goldens: found,
  poolByPullRequest,
  permutations: options.permutations,
  seed: options.seed,
});

/**
 * **The plan: one comment per adjacent golden, and the comment is the highest-scoring one that names its symbol.**
 *
 * The highest-scoring one and not the first, because a rewrite is a product decision about what the comment at that site
 * says, and the comment at that site is the one the reader would see first. A golden with no adjacent comment has no
 * plan entry, and `converted` counts only the entries that have one - so `converted / adjacent` is the device's coverage
 * and not its opportunity.
 */
const repositoryOf = (pullRequest) => String(pullRequest).split('/pull/')[0];
const plan = [];
for (const golden of found) {
  if (golden.matches.length === 0) continue;
  const best = golden.matches.reduce((left, right) =>
    Number(rows[right]?.score ?? 0) > Number(rows[left]?.score ?? 0) ? right : left,
  );
  plan.push({
    key: golden.key,
    golden: golden.index,
    findingAt: best,
    symbols: golden.symbols.slice(0, 4),
  });
}
const ranked = ranksOf({ plan, rows, steps, poolByPullRequest });
const rewrite = rewriteOracle({
  rows,
  creditOf,
  goldens,
  steps,
  budget: options.budget,
  plan: plan.map((entry, at) => ({ ...entry, rank: ranked[at].rank })),
});
const curve = conversionCurve({
  rows,
  creditOf,
  goldens,
  steps,
  budget: options.budget,
  plan,
});
const baseAtBudget = score(
  applyCut(rows, [
    ...steps.filter((step) => step.kind !== 'budget'),
    { kind: 'budget', k: options.budget },
  ]),
  creditOf,
  goldens,
);
const baseCeiling = creditedGoldens(applyCut(tagged, withoutBudget), creditOf).size;

const ranks = ranked.map((entry) => entry.rank).filter((rank) => rank !== null);
ranks.sort((left, right) => left - right);
const bar = Number(options.target);
const needed = conversionsNeeded({
  truePositives: baseAtBudget.truePositives,
  emitted: baseAtBudget.emitted,
  goldens,
  target: bar,
});

const record = {
  version: 'symbol-adjacency-v1',
  /** **The artifact's own clock**, because a record that stamps itself with the reader's clock is not reproducible. */
  measuredAt: String(arm.measuredAt ?? ''),
  arm: options.arm,
  reference: options.reference,
  corpus: options.corpus,
  profile: options.profile,
  budget: options.budget,
  guard: [
    { field: 'k', published: published.k, rebuilt: rebuiltRaw.emitted },
    {
      field: 'truePositives',
      published: published.truePositives,
      rebuilt: rebuiltRaw.truePositives,
    },
  ],
  goldens,
  sets: {
    ours: sets.ours.size,
    theirs: sets.theirs.size,
    shared: sets.shared,
    onlyOurs: sets.onlyOurs,
    onlyTheirs: sets.onlyTheirs.length,
  },
  rule: {
    identifier: 'four or more characters, identifier-shaped',
    specificity: 'the number of pull requests whose pool names it',
    cap: options.cap,
    sweep,
  },
  base: {
    ceiling: baseCeiling,
    atBudget: {
      k: baseAtBudget.emitted,
      truePositives: baseAtBudget.truePositives,
      f1: Number(baseAtBudget.f1.toFixed(4)),
    },
  },
  adjacency: {
    goldensWithSymbols: found.filter((golden) => golden.symbols.length > 0).length,
    adjacent: plan.length,
    null: nullDistribution,
    wrongPullRequest: wrongPullRequest({ goldens: found, poolByPullRequest, repositoryOf }),
    baseRate: (() => {
      const inside = new Set(sets.onlyTheirs);
      const rest = everyGolden(options.cap).filter((golden) => !inside.has(golden.key));
      return baseRate({ goldens: rest, poolByPullRequest });
    })(),
  },
  ranks: {
    within: ranked.filter((entry) => entry.rank !== null && entry.rank <= options.budget).length,
    median: ranks.length === 0 ? null : ranks[Math.floor(ranks.length / 2)],
    max: ranks.length === 0 ? null : ranks[ranks.length - 1],
  },
  rewrite: {
    converted: rewrite.converted,
    findings: rewrite.findings,
    additive: {
      ceiling: rewrite.additive.ceiling,
      atBudget: {
        k: rewrite.additive.atBudget.emitted,
        truePositives: rewrite.additive.atBudget.truePositives,
        f1: Number(rewrite.additive.atBudget.f1.toFixed(4)),
      },
    },
    replacement: {
      ceiling: rewrite.replacement.ceiling,
      atBudget: {
        k: rewrite.replacement.atBudget.emitted,
        truePositives: rewrite.replacement.atBudget.truePositives,
        f1: Number(rewrite.replacement.atBudget.f1.toFixed(4)),
      },
    },
  },
  bar: { target: bar, needed, clearing: firstClearing(curve, bar) },
  curve,
  plan: ranked.map((entry) => ({
    key: entry.key,
    golden: entry.golden,
    findingAt: entry.findingAt,
    rank: entry.rank,
    path: String(rows[entry.findingAt]?.path ?? ''),
    symbols: entry.symbols,
  })),
};

if (options.json !== null)
  writeFileSync(resolve(REPO, options.json), `${JSON.stringify(record, null, 2)}\n`);

const { adjacent, null: nulls, wrongPullRequest: wrong } = record.adjacency;
const line = (label, value) => `${label.padEnd(26)}${value}`;
process.stdout.write(
  [
    `SYMBOL-ADJACENCY ${record.sets.onlyTheirs} goldens only they credit · ${String(adjacent)} on a symbol we name · cap ${String(options.cap)}`,
    '',
    line(
      'ours / theirs',
      `${String(record.sets.ours)} / ${String(record.sets.theirs)} on ${String(goldens)} goldens`,
    ),
    line(
      'shared',
      `${String(record.sets.shared)} · only ours ${String(record.sets.onlyOurs)} · only theirs ${String(record.sets.onlyTheirs)}`,
    ),
    line(
      'adjacent',
      `${String(adjacent)} of ${String(record.sets.onlyTheirs)} (${String(record.adjacency.goldensWithSymbols)} carried a specific symbol)`,
    ),
    line(
      'null',
      `mean ${String(nulls.mean)} · p95 ${String(nulls.p95)} · max ${String(nulls.max)} over ${String(nulls.permutations)} permutations`,
    ),
    line(
      'the same rate outside',
      `${String(record.adjacency.baseRate.adjacent)} of ${String(record.adjacency.baseRate.goldens)} goldens not in the set`,
    ),
    line(
      'wrong pull request',
      `${String(wrong.adjacent)} of ${String(record.sets.onlyTheirs)}${wrong.uncontrolled === 0 ? '' : ` (${String(wrong.uncontrolled)} uncontrolled)`}`,
    ),
    line(
      'rank at the budget',
      `${String(record.ranks.within)} of ${String(adjacent)} inside k=${String(options.budget)} · median ${String(record.ranks.median)}`,
    ),
    '',
    `  cap  withSymbol  adjacent   null mean · p95`,
    ...sweep.map(
      (row) =>
        `  ${String(row.cap).padStart(3)} ${String(row.withSymbols).padStart(11)} ${String(row.adjacent).padStart(9)} ${String(row.null.mean).padStart(11)} · ${String(row.null.p95)}`,
    ),
    '',
    line(
      'the arm at k=' + String(options.budget),
      `${String(record.base.atBudget.k)} comments · ${String(record.base.atBudget.truePositives)} credited · F1 ${record.base.atBudget.f1.toFixed(4)}`,
    ),
    line('the ceiling', String(record.base.ceiling)),
    line(
      'the prize (additive)',
      `ceiling ${String(record.rewrite.additive.ceiling)} · k=${String(options.budget)} ${String(record.rewrite.additive.atBudget.truePositives)} credited · F1 ${record.rewrite.additive.atBudget.f1.toFixed(4)}`,
    ),
    line(
      'the prize (replacement)',
      `ceiling ${String(record.rewrite.replacement.ceiling)} · k=${String(options.budget)} ${String(record.rewrite.replacement.atBudget.truePositives)} credited · F1 ${record.rewrite.replacement.atBudget.f1.toFixed(4)}`,
    ),
    '',
    `  converted  credited      F1`,
    ...curve.map(
      (point) =>
        `  ${String(point.converted).padStart(9)} ${String(point.credited).padStart(9)} ${point.f1.toFixed(4).padStart(8)}`,
    ),
    '',
    line(
      'the bar',
      `F1 ${bar.toFixed(4)} · ${String(record.bar.clearing)} of ${String(plan.length)} conversions` +
        ` (the arithmetic floor is ${String(needed.replacement)}, which assumes a conversion is a credit)`,
    ),
    '',
  ].join('\n'),
);
