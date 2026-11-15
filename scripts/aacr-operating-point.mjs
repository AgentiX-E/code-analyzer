#!/usr/bin/env node
// @code-analyzer — Score any cut of a run's own verdicts, so an operating point costs nothing to ask about
//
// **Every published figure in this repository is one cut of one run's judged matrix**, and until now the cut was fixed
// before the run and could not be re-read afterwards. That priced the wrong thing: a dispatch costs about a dollar and
// two hours, and a question about a cut arrived with fresh model output on both sides, so the difference between two
// cuts carried the model's variance on top of the question's.
//
//     node scripts/aacr-operating-point.mjs --bench /tmp/aacr-bench.json
//     node scripts/aacr-operating-point.mjs --bench r21.json --bench r22a.json --cut drop:test+budget:13
//
// **The first form prints the registered cuts** - the shipped gate, no rule at all, the profile floor's own category
// sets, and the budgets the artifact already reports a curve for. **The second form is a confirmation**: one frozen cut,
// the two baselines it has to be read against, and one block per artifact, so a rule fitted on one run and confirmed on
// another prints as the pair it is.
//
// **Why this is a script and not a paragraph.** The table it prints is arithmetic over rows the artifact already
// carries, so a reader can reproduce every number in it from the artifact and this file - which is the property the
// numbers in `EVAL-CONTRACT.md` are required to have, and the one a table pasted from a one-off session does not.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cutComparison, pairArms } from './lib/arm-pair.mjs';
import { bestScoreThreshold, budgetRuleTable } from './lib/budget-rules.mjs';
import {
  TABLE_HEADER,
  applyCut,
  describeCut,
  formatRow,
  parseCut,
  registeredCuts,
  score,
} from './lib/operating-point.mjs';

function argv(tokens) {
  const options = { benches: [], cut: null, pair: null, budget: null, help: false };
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === '--bench') options.benches.push(tokens[(at += 1)] ?? '');
    else if (token === '--cut') options.cut = tokens[(at += 1)] ?? null;
    else if (token === '--budget') options.budget = tokens[(at += 1)] ?? null;
    else if (token === '--pair') {
      const [off = '', on = ''] = String(tokens[(at += 1)] ?? '').split(',');
      options.pair = { off, on };
    } else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`unknown argument "${token}"`);
  }
  if (options.benches.some((bench) => bench === '')) throw new Error('--bench needs a path');
  return options;
}

/**
 * **The denominator comes from the artifact's own full-emission row, not from the cut.**
 *
 * `truePositives + falseNegatives` at the point the run published is how many goldens the corpus held for the rows it
 * read. Reading it from the cut instead would make every cut's recall its own denominator, and a cut that dropped a
 * third of the emission would report the recall of the third it kept.
 */
function loadArtifact(path) {
  const full = resolve(path);
  if (!existsSync(full)) throw new Error(`no artifact at ${full}`);
  const artifact = JSON.parse(readFileSync(full, 'utf8'));
  const findings = artifact?.['rankedFindings'];
  if (!Array.isArray(findings) || findings.length === 0)
    throw new Error(`${path} carries no rankedFindings, so no cut of it can be scored`);
  const published = artifact?.['fullEmission'] ?? artifact;
  const goldens =
    Number(published?.['truePositives'] ?? 0) + Number(published?.['falseNegatives'] ?? 0);
  if (!Number.isFinite(goldens) || goldens <= 0)
    throw new Error(`${path} does not say how many goldens it was scored against`);
  return { artifact, findings, goldens };
}

const creditOf = (finding) => finding?.['matchedGoldens'] ?? [];

function block(path, findings, goldens, cuts) {
  console.log(`\n${path}  (${findings.length} findings over ${goldens} goldens)`);
  console.log(TABLE_HEADER);
  let best = null;
  for (const { steps } of cuts) {
    const point = score(applyCut(findings, steps), creditOf, goldens);
    console.log(formatRow(describeCut(steps), point));
    if (best === null || point.f1 > best.f1) best = point;
  }
  return best;
}

/**
 * **Two arms of one device, printed as one table and one pairing.**
 *
 * The two numbers a reader takes from a paired dispatch are the delta at a cut and the test over the goldens those cuts
 * kept, and **they have to be computed at the same point** - §51 is what happens when they are not: the table said
 * −0.0218 and the first pairing was taken over a cut neither arm shipped, and the two disagreed by seventeen goldens in
 * the `both` cell while both being correct arithmetic.
 */
function pairBlock(offPath, onPath) {
  const off = JSON.parse(readFileSync(resolve(offPath), 'utf8'));
  const on = JSON.parse(readFileSync(resolve(onPath), 'utf8'));
  const paired = pairArms(off, on);
  const rows = cutComparison(off, on);

  console.log(`\npair: ${offPath} -> ${onPath}`);
  console.log(
    `varied: ${paired.varied.join(', ') || 'nothing (the arms are the same configuration)'}`,
  );
  console.log('cut                              off F1    on F1     delta   off tp   on tp');
  for (const row of rows) {
    const delta = `${row.delta >= 0 ? '+' : ''}${row.delta.toFixed(4)}`;
    console.log(
      `${row.cut.padEnd(30)} ${row.off.f1.toFixed(4)}    ${row.on.f1.toFixed(4)}    ${delta.padStart(7)}   ${String(row.off.truePositives).padStart(6)}   ${String(row.on.truePositives).padStart(5)}`,
    );
  }
  console.log(
    `coverage: both ${paired.both}, off only ${paired.offOnly}, on only ${paired.onOnly}, ` +
      `p ${paired.pValue.toFixed(4)} (${paired.verdict})`,
  );
  console.log(
    'coverage is read from coverage.byPullRequest[].covered - the published point - so the test and the delta are ' +
      'about one configuration',
  );
}

/**
 * **The budget axis on one artifact**: the flat budget, the rules that scale it, the answer, and the bound.
 *
 * Printed here rather than kept in a session because **§52's argument is that the room a count could work in is +0.04**,
 * and a reader who wants to doubt it should be able to print the table rather than take the number.
 */
function budgetBlock(path) {
  const artifact = JSON.parse(readFileSync(resolve(path), 'utf8'));
  const { rows, goldens } = budgetRuleTable(artifact);
  const threshold = bestScoreThreshold(
    artifact,
    Array.from({ length: 10 }, (_unused, at) => at / 10),
  );
  console.log(`\n${path}  (${goldens} pull requests with coverage rows)`);
  console.log('rule                                n   tp       P       R      F1');
  for (const row of rows) {
    console.log(
      `${row.rule.padEnd(34)} ${String(row.emitted).padStart(4)} ${String(row.truePositives).padStart(4)}  ${row.precision.toFixed(4)}  ${row.recall.toFixed(4)}  ${row.f1.toFixed(4)}`,
    );
  }
  console.log(
    `best score threshold ${String(threshold?.threshold ?? 0)}: n ${String(threshold?.emitted ?? 0)} tp ${String(threshold?.truePositives ?? 0)} F1 ${(threshold?.f1 ?? 0).toFixed(4)}`,
  );
  console.log(
    'the oracle reads the answers and cannot be deployed; it is the room a count would have to work in',
  );
}

function main() {
  const options = argv(process.argv.slice(2));
  if (options.budget !== null) {
    budgetBlock(options.budget);
    return;
  }
  if (options.pair !== null) {
    pairBlock(options.pair.off, options.pair.on);
    return;
  }
  if (options.help || options.benches.length === 0) {
    console.log(
      'usage: node scripts/aacr-operating-point.mjs --bench <artifact.json> [--bench ...] [--cut <cut>]',
    );
    console.log('  without --cut: the registered cuts, one table per artifact');
    console.log('  with --cut   : that cut beside the two baselines it is read against');
    console.log(
      '  a cut is e.g. "gate", "no rule", "drop:test", "budget:13", "drop:test+budget:13"',
    );
    console.log(
      '  --pair <off.json>,<on.json>  : two arms of one device, every cut and the pairing',
    );
    return;
  }

  const cuts =
    options.cut === null
      ? registeredCuts()
      : [{ steps: [] }, { steps: [{ kind: 'gate' }] }, { steps: parseCut(options.cut) }];

  if (options.cut !== null) {
    console.log(`frozen cut: ${describeCut(parseCut(options.cut))}`);
    console.log(
      'read against "no rule" and "actionability gate" in the same block, over the same verdicts',
    );
  }

  for (const path of options.benches) {
    const { findings, goldens } = loadArtifact(path);
    block(path, findings, goldens, cuts);
  }
}

main();
