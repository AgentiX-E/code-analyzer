#!/usr/bin/env node
/**
 * **Our Martian figure on the board's own denominator, from verdicts already paid for.**
 *
 * ```
 * node scripts/martian-profile.mjs benchmarks/martian-bench.json benchmarks/martian/positive_samples.json
 * ```
 *
 * The board scores the **Core** profile: 158 of 173 comments, the eight defect categories. This repository counted all 173,
 * so every published comparison divided our F1 by a larger number than the competitors' - the §140.5 defect one level up,
 * in the corpus. The re-index is exact and free: the judge already said yes or no to each (comment, golden) pair, and
 * restricting which goldens count does not change any verdict.
 *
 * **Nothing is printed until the cut reproduces the artifact's own shipped point**, because a reading against a different
 * emission is a reading about a different run. `--cut` defaults to the policy the artifact records for itself.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { CORPUS_PROFILE_VERSION, profileMaps, restrictFindings } from './lib/corpus-profile.mjs';
import { applyCut, maximumMatchingByPullRequest, parseCut, score } from './lib/operating-point.mjs';

function parseArgs(argv) {
  const options = { artifact: null, corpus: null, cut: null, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cut') options.cut = argv[(i += 1)];
    else if (arg === '--json') options.json = argv[(i += 1)];
    else if (!options.artifact) options.artifact = arg;
    else if (!options.corpus) options.corpus = arg;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options.artifact || !options.corpus) {
  process.stderr.write(
    'usage: martian-profile.mjs <artifact.json> <positive_samples.json> [--cut <cut>] [--json <out>]\n',
  );
  process.exit(2);
}

const artifact = JSON.parse(readFileSync(options.artifact, 'utf8'));
const corpus = JSON.parse(readFileSync(options.corpus, 'utf8'));
const findings = artifact.rankedFindings ?? [];
if (findings.length === 0) {
  process.stderr.write('the artifact has no rankedFindings, so there is nothing to re-index\n');
  process.exit(2);
}

const shipped = artifact.emissionRules?.shipped ?? {};

/**
 * **The cut is read from the artifact's own structured steps, not from its prose and not from a constant here.**
 *
 * The harness records `steps: [{kind: 'drop', categories: [...]}, {kind: 'budget', k: 12}]`, which is the same statement
 * `parseCut` reads as `drop:test+budget:12`. Rebuilding the string from the steps means a non-default arm - a different
 * budget, an extra dropped category - is priced against the cut it actually shipped, instead of being refused or, worse,
 * silently priced against the default one.
 */
function cutFromSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const parts = [];
  for (const step of steps) {
    if (step?.kind === 'drop' && Array.isArray(step.categories) && step.categories.length > 0) {
      parts.push(`drop:${step.categories.join('+')}`);
    } else if (step?.kind === 'budget' && Number.isFinite(step.k)) {
      parts.push(`budget:${step.k}`);
    } else {
      return null;
    }
  }
  return parts.length > 0 ? parts.join('+') : null;
}

const cut = options.cut ?? cutFromSteps(shipped.steps);
if (cut === null) {
  process.stderr.write(
    'the artifact does not record a cut this instrument can rebuild; pass --cut\n',
  );
  process.exit(2);
}

const steps = parseCut(cut);
const emitted = applyCut(findings, steps);
const creditOf = (finding) => finding.matchedGoldens ?? [];
const rebuilt = {
  emitted: emitted.length,
  truePositives: maximumMatchingByPullRequest(emitted, creditOf),
};
const published = { emitted: shipped.point?.k, truePositives: shipped.point?.truePositives };
if (rebuilt.emitted !== published.emitted || rebuilt.truePositives !== published.truePositives) {
  process.stderr.write(
    `cut ${cut} rebuilds ${rebuilt.emitted} comments / ${rebuilt.truePositives} true positives, ` +
      `and the artifact published ${published.emitted} / ${published.truePositives}\n`,
  );
  process.exit(1);
}

const readings = {};
for (const profile of ['all', 'core']) {
  const { maps, goldens } = profileMaps(corpus, profile);
  const restricted = restrictFindings(findings, { maps });
  const kept = applyCut(restricted, steps);
  readings[profile] = {
    profile,
    goldens,
    shipped: { goldens, ...score(kept, (finding) => finding.profileGoldens ?? [], goldens) },
    full: { goldens, ...score(restricted, (finding) => finding.profileGoldens ?? [], goldens) },
  };
}

const line = (label, point) =>
  `${label.padEnd(18)}${String(point.emitted).padStart(5)}${String(point.truePositives).padStart(6)}` +
  `${String(point.goldens).padStart(9)}${point.precision.toFixed(4).padStart(11)}` +
  `${point.recall.toFixed(4).padStart(9)}${point.f1.toFixed(4).padStart(9)}`;

process.stdout.write(
  `artifact ${options.artifact}\ncut      ${cut}   (rebuilt ${rebuilt.emitted} / ${rebuilt.truePositives}, as published)\n\n` +
    `${'profile           emitted    tp   goldens  precision   recall       F1'.padEnd(64)}\n` +
    `${line('all   shipped', readings.all.shipped)}\n` +
    `${line('all   full', readings.all.full)}\n` +
    `${line('core  shipped', readings.core.shipped)}\n` +
    `${line('core  full', readings.core.full)}\n\n` +
    `the board scores \`core\`; a competitor figure compared against \`all\` was divided by a larger denominator.\n`,
);

if (options.json) {
  writeFileSync(
    options.json,
    `${JSON.stringify({ artifact: options.artifact, corpus: options.corpus, version: CORPUS_PROFILE_VERSION, cut, readings }, null, 2)}\n`,
  );
  process.stdout.write(`wrote ${options.json}\n`);
}
