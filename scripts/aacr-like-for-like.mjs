#!/usr/bin/env node
// @code-analyzer — The head-to-head we can actually draw, and the sentence it replaces
//
// **`31.44` against `25.10` is a bar cleared on one corpus, not a win over a tool on another.** The bar is the target the
// standing instructions set - the competitor's published number, which has to be met or beaten - and clearing it is a
// fact about this repository's own fifty pull requests under this repository's own judge. The head-to-head is a
// different measurement: the same pull requests, the same reference comments, the same scorer, both artifacts.
//
// §140.5 printed `+10.19` as if it were that measurement. It was two row sets apart, and this script is why the sentence
// can no longer be written: **it scores only the rows both artifacts hold** and refuses when there are none.
//
//     node scripts/aacr-like-for-like.mjs benchmarks/aacr-bench.json benchmarks/aacr/competitor-baseline.json
//     node scripts/aacr-like-for-like.mjs run.json baseline.json --volume
//
// **The `--volume` table is §86.3's registered test, scored.** That section named the statistic that decides whether the
// gap is emission volume - *cut our list to the number they post and re-score* - and a statistic that decides something
// has to be computable from artifacts rather than argued in prose.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { atVolume, likeForLike, sharedRows } from './lib/like-for-like.mjs';

function argv(tokens) {
  const options = { bench: null, baseline: null, json: false, volume: false };
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === '--json') options.json = true;
    else if (token === '--volume') options.volume = true;
    else if (token === '--help' || token === '-h') options.bench = null;
    else if (options.bench === null && !token.startsWith('-')) options.bench = token;
    else if (options.baseline === null && !token.startsWith('-')) options.baseline = token;
    else throw new Error(`unknown argument "${token}"`);
  }
  return options;
}

function load(path, what) {
  const full = resolve(path);
  if (!existsSync(full)) throw new Error(`no ${what} at ${full}`);
  return JSON.parse(readFileSync(full, 'utf8'));
}

/** The artifact's rows, and a refusal rather than a guess when it carries none. */
function artifactRows(artifact, path) {
  const rows = artifact?.rankedFindings;
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error(`${path} carries no rankedFindings, so no row of it can be compared`);
  return rows;
}

const HEADER = `${'side'.padEnd(22)} ${'cmts'.padStart(5)} ${'TP'.padStart(4)} ${'P'.padStart(7)} ${'R'.padStart(7)} ${'F1'.padStart(7)}   | ${'hit'.padStart(4)} ${'cov'.padStart(4)} ${'P'.padStart(7)} ${'R'.padStart(7)} ${'F1'.padStart(7)}`;

function formatSide(label, side) {
  return [
    label.padEnd(22),
    String(side.emitted).padStart(5),
    String(side.protocol.tp).padStart(4),
    side.protocol.precision.toFixed(4).padStart(7),
    side.protocol.recall.toFixed(4).padStart(7),
    side.protocol.f1.toFixed(4).padStart(7),
    '  |',
    String(side.corpus.hitNewGt).padStart(4),
    String(side.corpus.coveredGoldens).padStart(4),
    side.corpus.precision.toFixed(4).padStart(7),
    side.corpus.recall.toFixed(4).padStart(7),
    side.corpus.f1.toFixed(4).padStart(7),
  ].join(' ');
}

function main() {
  const options = argv(process.argv.slice(2));
  if (options.bench === null || options.baseline === null) {
    console.log(
      'usage: node scripts/aacr-like-for-like.mjs <artifact.json> <competitor-baseline.json> [--volume] [--json]',
    );
    console.log(
      '  both artifacts are required: a comparison needs the rows both of them hold, and neither file says alone',
    );
    return;
  }
  const artifact = load(options.bench, 'artifact');
  const baseline = load(options.baseline, 'competitor baseline');
  const rows = artifactRows(artifact, options.bench);

  const comparison = likeForLike({ ourFindings: rows, competitorBaseline: baseline });
  const shared = sharedRows(rows, baseline);

  const volumeCurve = [];
  if (options.volume) {
    const ourShipped = shared.rows.flatMap((row) =>
      row.ours.filter((finding) => finding?.['actionable'] === true),
    );
    const theirEmitted = comparison.sides.theirs.emitted;
    const atTheirVolume = atVolume({
      findings: ourShipped,
      goldens: comparison.goldens,
      total: theirEmitted,
    });
    volumeCurve.push({ total: theirEmitted, side: atTheirVolume });
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          benchmark: options.bench,
          baseline: options.baseline,
          pullRequests: comparison.pullRequests,
          goldens: comparison.goldens,
          onlyThisRepository: comparison.onlyThisRepository,
          onlyTheCompetitor: comparison.onlyTheCompetitor,
          sides: comparison.sides,
          volume: volumeCurve,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `${comparison.pullRequests} shared pull requests, ${comparison.goldens} reference comments` +
      `  (${comparison.onlyThisRepository.length} held only here, ${comparison.onlyTheCompetitor.length} only by them)`,
  );
  console.log(HEADER);
  console.log(formatSide('this repository', comparison.sides.ours));
  console.log(formatSide('the competitor', comparison.sides.theirs));

  const protocolGap =
    (comparison.sides.ours.protocol.f1 - comparison.sides.theirs.protocol.f1) * 100;
  const corpusGap = (comparison.sides.ours.corpus.f1 - comparison.sides.theirs.corpus.f1) * 100;
  console.log(
    `gap, this repository minus the competitor: protocol ${protocolGap.toFixed(2)} points, ` +
      `corpus ${corpusGap.toFixed(2)} points`,
  );

  /**
   * **The file-shaped reading is printed and never subtracted.** The competitor's artifact carries no comment text, so a
   * per-file judge cannot be asked about its findings at any price; a difference between this line and their `corpus`
   * line would be a difference of instruments printed as a difference of reviewers.
   */
  const filed = comparison.sides.ours.filed;
  if (filed !== null) {
    console.log(
      `  this repository under the file-shaped judge, on the same rows: P ${filed.precision.toFixed(4)} ` +
        `R ${filed.recall.toFixed(4)} F1 ${filed.f1.toFixed(4)} ` +
        `(${filed.hitNewGt} new hits, ${filed.coveredGoldens} covered) - no counterpart exists, ` +
        'so it is not part of the gap',
    );
  }
  console.log(
    '  both sides were cut the way each shipped and scored against this row set, so the two figures are ' +
      'subtractable; a figure from a run on a different row set is not',
  );
  if (comparison.onlyThisRepository.length > 0 || comparison.onlyTheCompetitor.length > 0) {
    console.log(
      `  excluded: ${[...comparison.onlyThisRepository, ...comparison.onlyTheCompetitor].join(', ')}`,
    );
  }

  if (options.volume) {
    const row = volumeCurve[0];
    const ours = comparison.sides.ours.protocol;
    console.log('');
    console.log(
      `§86.3's test, scored: this repository cut to ${row.total} comments (the volume the competitor posts)`,
    );
    console.log(
      `  protocol P ${row.side.protocol.precision.toFixed(4)} at ${row.total} against ` +
        `${ours.precision.toFixed(4)} at ${comparison.sides.ours.emitted} - a ratio of ` +
        `${(row.side.protocol.precision / Math.max(ours.precision, 1e-9)).toFixed(2)}x, ` +
        'and §86.3 registered 2x as the line at which the gap is volume',
    );
    console.log(
      `  F1 ${row.side.protocol.f1.toFixed(4)} at ${row.total} against ${ours.f1.toFixed(4)} at ` +
        `${comparison.sides.ours.emitted}, so the cap costs ` +
        `${((ours.f1 - row.side.protocol.f1) * 100).toFixed(2)} points: precision rises and recall falls faster`,
    );
  }
}

main();
