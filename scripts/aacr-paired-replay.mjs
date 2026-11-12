#!/usr/bin/env node
// @code-analyzer — Recompute a run's head-to-head from its artifact, without a model, a network or a corpus
//
// **The claim this makes possible.** Every figure the project publishes about a competitor comes from two files that
// were already paid for. `scripts/lib/paired-replay.mjs` recomputes them, and this is the command a reader runs:
//
//     node scripts/aacr-paired-replay.mjs --bench benchmarks/aacr-bench.json \
//       --baseline benchmarks/aacr/competitor-baseline.json --check
//
// **`--check` is the useful mode**: it replays the arm the artifact was run under and compares the result to the
// precision, recall and F1 the artifact itself publishes, exiting non-zero if they disagree. That is a claim about the
// artifact rather than about this script - **the published figure is either derivable from the rows beside it or the
// rows do not say what the figure says.**
//
// **What it cannot do, said here rather than in a report.** It recomputes the comparison; it does not re-judge. The
// verdicts it replays are the judge's, and a defect in what the judge accepted is invisible to it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareReplayToArtifact, replayHeadToHead } from './lib/paired-replay.mjs';

/**
 * **Our arms, named once.** The published arm is one of these, so a checker that printed three of four would report a
 * figure it also refused to show - which is what happened to the reading reviewer's arm.
 */
const OUR_ARMS = ['everything', 'gate', 'profile', 'everything-filtered'];

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/** `--name value` and `--flag`, because the callers are a workflow and a human and neither wants a parser. */
function argv(tokens) {
  const options = { bench: null, baseline: null, drop: null, check: false, json: false };
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === '--check') options.check = true;
    else if (token === '--json') options.json = true;
    else if (token === '--bench') options.bench = tokens[(at += 1)] ?? null;
    else if (token === '--baseline') options.baseline = tokens[(at += 1)] ?? null;
    else if (token === '--drop') options.drop = tokens[(at += 1)] ?? null;
  }
  return options;
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found at ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  const options = argv(process.argv.slice(2));
  const benchPath = resolve(REPO, options.bench ?? 'benchmarks/aacr-bench.json');
  const baselinePath = resolve(
    REPO,
    options.baseline ??
      (existsSync(resolve(REPO, 'benchmarks/aacr/competitor-baseline.json'))
        ? 'benchmarks/aacr/competitor-baseline.json'
        : 'benchmarks/competitor-matrix-baseline.json'),
  );

  const bench = readJson(benchPath, 'bench artifact');
  const baseline = readJson(baselinePath, 'competitor baseline');

  // **The categories are read from the artifact when it recorded them, and from the command line when it did not.**
  // An artifact written before `emissionProfile` existed cannot say which categories its profile dropped, and **guessing
  // them would make this script's figure a figure about a run nobody performed** - so the guess is refused and the
  // caller states them.
  const recorded = bench?.emissionProfile?.dropped;
  const dropped = options.drop
    ? options.drop
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : recorded && typeof recorded === 'object'
      ? Object.keys(recorded)
      : [];

  const replay = replayHeadToHead({ bench, baseline, dropCategories: dropped });
  const verdict = compareReplayToArtifact(replay, bench);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ replay, verdict }, null, 2)}\n`);
  } else {
    const line = (label, arm) =>
      `  ${label.padEnd(12)} P ${String(arm.precision).padEnd(7)} R ${String(arm.recall).padEnd(7)} F1 ${String(arm.f1).padEnd(7)} tp ${String(arm.truePositives).padEnd(4)} fp ${String(arm.falsePositives).padEnd(4)} fn ${arm.falseNegatives}`;
    console.log(
      `AACR-PAIRED-REPLAY ${replay.measuredAt ?? 'undated'} · ${replay.pullRequestsScored} pull requests · ${replay.goldensScored} goldens`,
    );
    console.log(`  whole corpus`);
    // **Every arm the replay computed, in a fixed order**, so a new one cannot be measured without being printed: the
    // list used to be written out by hand here, and the reading reviewer's published arm was not on it.
    for (const name of OUR_ARMS) console.log(line(name, replay.whole[name]));
    console.log(line('theirs', replay.whole.theirs));
    console.log(line('theirs·raw', replay.whole.theirsEverything));
    console.log(
      `  paired subset · ${replay.paired.pullRequests} pull requests · ${replay.paired.goldens} goldens`,
    );
    for (const name of OUR_ARMS) {
      const arm = replay.paired[name];
      console.log(line(name, arm));
      if (arm.discordance) {
        console.log(
          `      discordance ours-only ${arm.discordance.oursOnly} · theirs-only ${arm.discordance.theirsOnly}`,
        );
      }
    }
    console.log(line('theirs', replay.paired.theirs));
    console.log(line('theirs·raw', replay.paired.theirsEverything));
    console.log(
      `      discordance ours-raw vs theirs-raw · ours-only ${replay.paired.oursUngatedAgainstTheirsUngated.oursOnly} · theirs-only ${replay.paired.oursUngatedAgainstTheirsUngated.theirsOnly}`,
    );
    console.log(
      `  excluded by them ${replay.paired.excluded.length} · scored by them only ${replay.paired.scoresByThemOnly.length}`,
    );
  }

  if (options.check) {
    if (!verdict.ok) {
      console.error(
        `AACR-PAIRED-REPLAY the artifact's published figures are not derivable from its rows: ${JSON.stringify(verdict.mismatches)}`,
      );
      process.exitCode = 1;
    } else {
      console.log(`AACR-PAIRED-REPLAY reproduces the published ${verdict.arm} figures exactly`);
    }
  }
}

main();
