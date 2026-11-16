#!/usr/bin/env node
/**
 * **What the misses say, on the artifact that produced the figure.**
 *
 * `scripts/lib/miss-anatomy.mjs` does the arithmetic; this is the command a person runs after a benchmark completes,
 * instead of opening 455 records by hand. It reads only what the artifact carries, buys nothing, and is safe to run on
 * an artifact from another commit - which is the point: **the diagnosis of a run should cost nothing and be repeatable by
 * a reader who does not trust the paragraph**.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decomposeMisses, describeMisses } from './lib/miss-anatomy.mjs';

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith('-'));
if (path === undefined) {
  console.error('usage: aacr-miss-anatomy.mjs <aacr-bench.json> [--json]');
  process.exit(2);
}

const bench = JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
const anatomy = decomposeMisses(bench);

if (args.includes('--json')) {
  console.log(JSON.stringify(anatomy, null, 2));
} else {
  const { matrix } = anatomy;
  console.log(`AACR-MISS ${describeMisses(anatomy)}`);
  console.log('');
  console.log('  band      beside an accepted comment   beside a rejected one');
  for (const name of ['sameLine', 'near', 'beyond']) {
    const row = matrix[name];
    console.log(
      `  ${name.padEnd(9)} ${String(row['true-positive']).padStart(6)}                     ${String(row['false-positive']).padStart(6)}`,
    );
  }
  console.log('');
  // **A table whose rows do not add up is a table that lost a row**, so it says so rather than printing a total that
  // disagrees with the artifact's own bucket count.
  console.log(
    anatomy.reconciled
      ? `  ${String(anatomy.rejected)} rejects, all accounted for${anatomy.unlinked > 0 ? ` (${String(anatomy.unlinked)} unlinked to a ranked finding)` : ''}`
      : `  NOT RECONCILED: ${String(anatomy.rejected)} rejects against ${String(anatomy.rejected - anatomy.unlinked)} placed`,
  );
}
