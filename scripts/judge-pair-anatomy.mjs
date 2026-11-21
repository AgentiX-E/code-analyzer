#!/usr/bin/env node
/**
 * **What the judge would stop being asked, if the pairs were filtered.**
 *
 * `scripts/lib/judge-pair-anatomy.mjs` does the arithmetic; this is the command a person runs against an artifact and
 * one corpus file. It buys nothing and it decides nothing - it exists so that the next registered device is the one the
 * pairs support, rather than the one that looked obvious.
 *
 * ```
 * node scripts/judge-pair-anatomy.mjs <aacr-bench.json> <positive_samples.json>
 * ```
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pairAnatomy } from './lib/judge-pair-anatomy.mjs';

const positional = process.argv.slice(2).filter((value) => !value.startsWith('-'));
const [benchPath, corpusPath] = positional;
if (benchPath === undefined || corpusPath === undefined) {
  console.error('usage: judge-pair-anatomy.mjs <aacr-bench.json> <positive_samples.json> [--json]');
  process.exit(2);
}
const asJson = process.argv.includes('--json');

const bench = JSON.parse(readFileSync(resolve(process.cwd(), benchPath), 'utf8'));
const corpus = JSON.parse(readFileSync(resolve(process.cwd(), corpusPath), 'utf8'));
const anatomy = pairAnatomy(bench, corpus);

if (asJson) {
  console.log(JSON.stringify(anatomy, null, 2));
} else {
  const percent = (value) => `${(value * 100).toFixed(2)} %`;
  const point = (row) =>
    `${String(row.truePositives).padStart(5)} ${row.precision.toFixed(4)} ${row.recall.toFixed(4)} ${row.f1.toFixed(4)}`;

  console.log(
    `AACR-PAIRS ${String(anatomy.findings)} findings × ${String(anatomy.goldens)} goldens → ${String(anatomy.allPairs)} pairs`,
  );
  console.log(
    `  the artifact also paid the competitor arm: ${String(anatomy.judgeCalls)} judge calls, ${String(anatomy.allPairs)} of them ours`,
  );
  console.log('');
  console.log(
    `  shipped point: TP ${String(anatomy.shipped.truePositives)} P ${anatomy.shipped.precision.toFixed(4)} ` +
      `R ${anatomy.shipped.recall.toFixed(4)} F1 ${anatomy.shipped.f1.toFixed(4)}`,
  );
  console.log('');
  console.log(
    '  rule                              pairs  kept      TP     P      R     F1     dF1(filter)  dF1(gate)',
  );
  for (const row of anatomy.rows) {
    console.log(
      `  ${row.name.padEnd(32)} ${String(row.pairs).padStart(6)} ${percent(row.survival ?? 0).padStart(7)}  ` +
        `${point(row.filtered)}  ${row.deltaFiltered >= 0 ? '+' : ''}${row.deltaFiltered.toFixed(4)}      ` +
        `${row.deltaGated >= 0 ? '+' : ''}${row.deltaGated.toFixed(4)}`,
    );
  }
  console.log('');
  // **The sentence a reader needs before quoting the gate column**, printed where the table is rather than in a note
  // three files away.
  console.log(
    '  dF1(filter) prices the evaluation asking fewer questions. dF1(gate) prices a review that',
  );
  console.log('  filters itself, which no product can do: every rule here reads the golden path.');
}
