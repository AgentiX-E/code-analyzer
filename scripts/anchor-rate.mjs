#!/usr/bin/env node
// @code-analyzer — What the anchor bought, read off an artifact that already carries it
//
// **R-41's four numbers are arithmetic over rows the artifact already holds**, and until this file existed the only way
// to read them was a session that pasted a table into a document - which is the property `EVAL-CONTRACT.md` forbids,
// because a table nobody can rebuild is a table nobody can check.
//
//     node scripts/anchor-rate.mjs --bench /tmp/aacr-bench.json
//
// **The four numbers, and why each one is here rather than in a paragraph.**
//
// 1. **The anchoring rate**: of the comments the shipped rule emitted, how many named an added line through which the
//    defect is reached. §88.2 predicted 11 % → at least 45 %, and **a prediction about a rate needs the rate**.
// 2. **Precision among the anchored and among the rest.** §88.1 measured 0.343 against 0.161 on the *previous*
//    contract, where quoting was a coincidence. If the prompt works, the gap should survive; if it collapses, the
//    anchor is being produced by every comment and therefore selects nothing.
// 3. **Recall, on the artifact's own denominator**, because precision among a subset is free to buy by naming fewer
//    comments and the prediction was about F1.
// 4. **The 2×2**, because the two mechanisms are separable: a comment can be anchored and wrong, which is the case
//    that ends the programme rather than extends it.
//
// **Nothing here calls a model and nothing here reads the corpus**: the rows were judged when the run was paid for, and
// this is a re-read of that judgement - the same shape as `aacr-operating-point.mjs`, for the same reason.

import { readFileSync } from 'node:fs';

/**
 * **One cut of one artifact's emitted comments, scored against the artifact's own denominator.**
 *
 * `matchedGoldens` is what the judge matched, so a row with one or more is a true positive **by the artifact's own
 * definition** and this function does not re-decide it. **The false negatives are the artifact's**, not recomputed:
 * recall here is `tp / (tp + fn)` with both terms read from the run, because a recall recomputed from a subset would be
 * a different measurement wearing the same name.
 */
export function anchorTable(findings, falseNegatives) {
  const rows = findings.filter((finding) => finding?.features !== undefined);
  const kind = (finding) => (finding.features.anchored === true ? 'anchored' : 'unanchored');
  const hit = (finding) =>
    Array.isArray(finding.matchedGoldens) && finding.matchedGoldens.length > 0;

  const cell = (subset) => {
    const tp = subset.filter(hit).length;
    const emitted = subset.length;
    const precision = emitted === 0 ? 0 : tp / emitted;
    const recall = tp + falseNegatives === 0 ? 0 : tp / (tp + falseNegatives);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { emitted, tp, precision, recall, f1 };
  };

  const anchored = rows.filter((finding) => kind(finding) === 'anchored');
  const unanchored = rows.filter((finding) => kind(finding) === 'unanchored');
  return {
    emitted: rows.length,
    anchoringRate: rows.length === 0 ? 0 : anchored.length / rows.length,
    all: cell(rows),
    anchored: cell(anchored),
    unanchored: cell(unanchored),
    cell: {
      anchoredAndRight: anchored.filter(hit).length,
      anchoredAndWrong: anchored.filter((finding) => !hit(finding)).length,
      unanchoredAndRight: unanchored.filter(hit).length,
      unanchoredAndWrong: unanchored.filter((finding) => !hit(finding)).length,
    },
  };
}

/** Four decimals, so two runs print the same number and a reader can subtract them. */
const r4 = (value) => Math.round(value * 10_000) / 10_000;

/** The table the document quotes, printed from the artifact rather than typed into it. */
export function formatAnchorTable(table) {
  const line = (name, row) =>
    `| ${name.padEnd(11)} | ${String(row.emitted).padStart(6)} | ${String(row.tp).padStart(3)} | ${r4(
      row.precision,
    )
      .toFixed(4)
      .padStart(
        9,
      )} | ${r4(row.recall).toFixed(4).padStart(6)} | ${r4(row.f1).toFixed(4).padStart(6)} |`;
  return [
    `anchoring rate ${r4(table.anchoringRate).toFixed(4)} over ${table.emitted} emitted comments`,
    '',
    '| set         | emitted |  tp | precision | recall |     F1 |',
    '| ----------- | ------- | --- | --------- | ------ | ------ |',
    line('all', table.all),
    line('anchored', table.anchored),
    line('unanchored', table.unanchored),
    '',
    `2x2: anchored&right ${table.cell.anchoredAndRight}, anchored&wrong ${table.cell.anchoredAndWrong}, ` +
      `unanchored&right ${table.cell.unanchoredAndRight}, unanchored&wrong ${table.cell.unanchoredAndWrong}`,
  ].join('\n');
}

/** **The emitted list the artifact ranks**, whichever of the two views this artifact wrote. */
export function findingsOf(artifact) {
  const arm = artifact?.pullRequestArm ?? {};
  const ranked = arm.rankedFindings ?? artifact?.rankedFindings ?? [];
  return Array.isArray(ranked) ? ranked : [];
}

function main(argv) {
  const at = argv.indexOf('--bench');
  if (at === -1) {
    process.stderr.write('usage: anchor-rate.mjs --bench <artifact.json>\n');
    return 2;
  }
  const artifact = JSON.parse(readFileSync(argv[at + 1], 'utf8'));
  const table = anchorTable(findingsOf(artifact), Number(artifact.falseNegatives ?? 0));
  process.stdout.write(`${formatAnchorTable(table)}\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  process.exitCode = main(process.argv.slice(2));
}
