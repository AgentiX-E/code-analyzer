#!/usr/bin/env node
/**
 * **Whether a calibrated score floor is a precision device, measured on one half and accepted on the other.**
 *
 * §162.3 left two deficits: their comments are more often about something a human wrote about (precision), and their pool
 * reaches goldens ours never names (recall). **The first one looks like it should be cheap to fix** - a reviewer that is
 * confident about its top handful of comments can simply not post the rest - and this file asks whether our ranker is
 * confident enough for that to work, on the only evidence that can answer it: a floor chosen on one half of the board and
 * applied, unchanged, to the half that did not choose it.
 *
 * **Why the floor is calibrated here rather than in `operating-point.mjs`.** A cut is a policy that travels in a string
 * and can be applied to any artifact; a floor that was *chosen on this corpus* is a fitted parameter, and a fitted
 * parameter in a cut string is a number nobody can tell apart from a registered one. So the grid lives here, the choice
 * lives on the chosen half, and the reading lives on the held-out half - **the same split-half discipline §161.3 uses for
 * lane removal, for the same reason.**
 *
 * **What it must not become.** A floor picked on the whole board and reported on the whole board would always look like a
 * gain, because it was chosen to be one. The verdict below is `transfers` only when the held-out half gains at least the
 * board's own resolution, and it is `refused` otherwise - including when the gain is real but too small to distinguish
 * from noise.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { profileMaps, restrictFindings } from './lib/corpus-profile.mjs';
import { applyCut, score } from './lib/operating-point.mjs';

/** The board's resolution, the same `0.0126` every other reading in this repository is judged against. */
const RESOLUTION = 0.0126;

/** The grid the floor is chosen from. **Dense enough to find a knee, coarse enough that the choice is not a fit.** */
const GRID = Array.from({ length: 31 }, (_, at) => Number((0.3 + at * 0.02).toFixed(2)));

function parseArgs(argv) {
  const options = {
    artifact: null,
    baseline: null,
    corpus: null,
    profile: 'core',
    k: 5,
    json: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    if (arg === '--artifact') options.artifact = next();
    else if (arg === '--baseline') options.baseline = next();
    else if (arg === '--corpus') options.corpus = next();
    else if (arg === '--profile') options.profile = next();
    else if (arg === '--k') options.k = Number(next());
    else if (arg === '--json') options.json = next();
  }
  return options;
}

/**
 * **The two arms, reduced to the one question this file asks**: for every pull request, the comments a budget of `k` keeps,
 * in the order the arm ranked them, with the goldens the judge credited each one with.
 *
 * Our side is the artifact's own rows; the competitor's are the `detail` rows `scripts/same-cut.mjs` already reads. Both
 * are cut by `drop test` first — the step our shipped rule applies — so neither arm is credited with comments the product
 * would not post.
 */
function ourRows(artifact, maps) {
  const steps = [{ kind: 'drop', categories: ['test'] }];
  const findings = restrictFindings(artifact.rankedFindings ?? [], { maps });
  const kept = applyCut(findings, steps);
  const rows = new Map();
  for (const finding of kept) {
    const pr = String(finding?.['pr'] ?? '');
    const bucket = rows.get(pr);
    const entry = {
      score: Number(finding?.['score'] ?? 0),
      credited: finding?.profileGoldens ?? [],
    };
    if (bucket === undefined) rows.set(pr, [entry]);
    else bucket.push(entry);
  }
  return rows;
}

function theirRows(baseline, maps) {
  const rows = new Map();
  for (const [pr, row] of Object.entries(baseline.pulls ?? {})) {
    const index = maps.get(pr);
    if (index === undefined) continue;
    const entries = [];
    for (const detail of Array.isArray(row?.detail) ? row.detail : []) {
      if (String(detail?.category ?? '') === 'test') continue;
      entries.push({
        score: Number(detail?.score ?? 0),
        credited: (detail?.matchedGoldens ?? [])
          .map((golden) => index.get(golden))
          .filter((golden) => golden !== undefined),
      });
    }
    rows.set(pr, entries);
  }
  return rows;
}

/** One arm's point at a budget and a floor, over the pull requests the caller names. */
function pointAt(rows, k, floor, pullRequests, goldens, count) {
  const kept = [];
  for (const [pr, entries] of rows) {
    if (!pullRequests.has(pr)) continue;
    const ordered = [...entries]
      .map((entry, at) => ({ entry, at }))
      .sort((left, right) => right.entry.score - left.entry.score || left.at - right.at);
    for (const { entry } of ordered.slice(0, k)) {
      if (entry.score >= floor) kept.push({ pr, credited: entry.credited });
    }
  }
  return { goldens, ...count(kept) };
}

const options = parseArgs(process.argv.slice(2));
if (options.artifact === null || options.baseline === null || options.corpus === null) {
  process.stderr.write(
    'usage: score-floor.mjs --artifact <aacr-bench.json> --baseline <competitor-baseline.json> ' +
      '--corpus <positive_samples.json> [--profile core] [--k 5] [--json out]\n',
  );
  process.exit(2);
}

const artifact = JSON.parse(readFileSync(options.artifact, 'utf8'));
const baseline = JSON.parse(readFileSync(options.baseline, 'utf8'));
const corpus = JSON.parse(readFileSync(options.corpus, 'utf8'));

const { maps, goldens } = profileMaps(corpus, options.profile);
const arms = {
  ours: ourRows(artifact, maps),
  theirs: theirRows(baseline, maps),
};

/**
 * **The split is by pull request, and it is the same split for both arms** - a floor calibrated on one set of pull
 * requests and accepted on another set is a reading about a reviewer; the same pull requests on both sides is what makes
 * the two held-out figures comparable at all.
 */
const all = [...maps.keys()].filter((pr) => arms.ours.has(pr) || arms.theirs.has(pr)).sort();
const chosen = new Set(all.filter((_, at) => at % 2 === 0));
const heldOut = new Set(all.filter((_, at) => at % 2 === 1));
const goldensOf = (set) => [...set].reduce((total, pr) => total + (maps.get(pr)?.size ?? 0), 0);
const chosenGoldens = goldensOf(chosen);
const heldOutGoldens = goldensOf(heldOut);
if (chosenGoldens + heldOutGoldens !== goldens) {
  process.stderr.write(
    `the two halves hold ${String(chosenGoldens + heldOutGoldens)} goldens and the profile holds ${String(goldens)}\n`,
  );
  process.exit(1);
}

/**
 * **The published points rebuild before a floor is priced.** Our whole emission on this profile is what the artifact's own
 * `coverage` says it covered, and the competitor's is `616 / 109` on the board's 158 — the figure §160 published. A floor
 * priced over a different emission is a floor priced over a different run.
 */
const count = (kept) => {
  const findings = kept.map((item) => ({ pr: item.pr, matchedGoldens: item.credited }));
  return score(findings, (finding) => finding.matchedGoldens, goldens);
};

const readings = {};
for (const [name, rows] of Object.entries(arms)) {
  const atChosen = (floor) => pointAt(rows, options.k, floor, chosen, chosenGoldens, count);
  const atHeld = (floor) => pointAt(rows, options.k, floor, heldOut, heldOutGoldens, count);
  const base = atHeld(0);
  const curve = GRID.map((floor) => ({ floor, chosen: atChosen(floor) }));
  const best = curve.reduce((left, right) => (right.chosen.f1 > left.chosen.f1 ? right : left));
  const atFloor = atHeld(best.floor);
  readings[name] = {
    calibration: { floor: best.floor, chosenF1: best.chosen.f1 },
    heldOut: { base, atFloor, delta: atFloor.f1 - base.f1 },
    // **`transfers` needs the held-out half to clear the board's own resolution**, not merely to improve: a floor chosen
    // on thirty pull requests and worth `+0.0046` on the other thirty is a noise draw with a story attached.
    verdict: atFloor.f1 - base.f1 >= RESOLUTION ? 'transfers' : 'refused',
    curve,
  };
}

const line = (label, point) =>
  `${label.padEnd(12)}${String(point.emitted).padStart(6)}${String(point.truePositives).padStart(5)}` +
  `${point.precision.toFixed(4).padStart(10)}${point.recall.toFixed(4).padStart(9)}` +
  `${point.f1.toFixed(4).padStart(9)}`;

process.stdout.write(
  `score floor · ${options.profile} · k=${String(options.k)} · resolution ${String(RESOLUTION)} · ` +
    `chosen ${String(chosen.size)} PRs / ${String(chosenGoldens)} goldens · held out ${String(heldOut.size)} PRs / ${String(heldOutGoldens)} goldens\n\n` +
    `${'held-out half'.padEnd(21)}emitted   tp        P        R       F1\n` +
    Object.entries(readings)
      .map(
        ([name, reading]) =>
          `${line(`${name} base`, reading.heldOut.base)}\n` +
          `${line(`${name} floor`, reading.heldOut.atFloor)}` +
          `   floor ${reading.calibration.floor.toFixed(2)} · delta ${reading.heldOut.delta.toFixed(4)} · ${reading.verdict}\n`,
      )
      .join('\n') +
    `\nthe floor is chosen on the chosen half and accepted or refused on the half that did not choose it.\n`,
);

if (options.json) {
  writeFileSync(
    options.json,
    `${JSON.stringify(
      {
        version: 'score-floor-v1',
        artifact: options.artifact,
        baseline: options.baseline,
        corpus: options.corpus,
        profile: options.profile,
        k: options.k,
        resolution: RESOLUTION,
        split: {
          chosen: { pullRequests: chosen.size, goldens: chosenGoldens },
          heldOut: { pullRequests: heldOut.size, goldens: heldOutGoldens },
        },
        readings,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`wrote ${options.json}\n`);
}
