#!/usr/bin/env node
/**
 * **What a batched judge call would cost, computed rather than bought.**
 *
 * ```
 * node scripts/judge-batch-arithmetic.mjs <aacr-bench.json> <positive_samples.json> [--batches 1,4,8] [--json]
 * ```
 *
 * The per-pair prompt is a pure function of a finding's text and a golden's note, so the ratio between the per-pair arm
 * and any batched arm is arithmetic. R-56's bar is 60 % of the per-pair prompt tokens and this prints what the ratio
 * would be, which is the number the run is then checked against.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CACHE_BLOCK_TOKENS, batchArithmetic } from './lib/judge-prompt-arithmetic.mjs';

const positional = process.argv.slice(2).filter((value) => !value.startsWith('-'));
const [benchPath, corpusPath] = positional;
if (benchPath === undefined || corpusPath === undefined) {
  console.error(
    'usage: judge-batch-arithmetic.mjs <aacr-bench.json> <positive_samples.json> [--batches 1,4,8] [--json]',
  );
  process.exit(2);
}

const sizesFlag = process.argv.findIndex((value) => value === '--batches');
const sizes =
  sizesFlag === -1
    ? [1, 2, 4, 8]
    : String(process.argv[sizesFlag + 1] ?? '')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value >= 1);

const bench = JSON.parse(readFileSync(resolve(process.cwd(), benchPath), 'utf8'));
const corpus = JSON.parse(readFileSync(resolve(process.cwd(), corpusPath), 'utf8'));
const arithmetic = batchArithmetic(bench, corpus, sizes);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(arithmetic, null, 2));
} else {
  console.log(
    `AACR-JUDGE-BATCH ${String(arithmetic.findings)} findings × ${String(arithmetic.goldens)} goldens → ${String(arithmetic.pairs)} pairs`,
  );
  // **The prefix, in characters, against the block the vendor caches in** - a necessary condition, and §117's 13.5 %
  // hit ratio is the evidence that it is not a sufficient one.
  const prefixTokens = arithmetic.meanSystemCharacters / 4;
  console.log(
    `  shared prefix: ${arithmetic.meanSystemCharacters.toFixed(0)} characters ≈ ${prefixTokens.toFixed(0)} tokens ` +
      `against a ${String(CACHE_BLOCK_TOKENS)}-token cache block`,
  );
  console.log('');
  console.log('  pairs/call     calls   calls vs 1   characters   chars/call   chars vs 1');
  for (const row of arithmetic.rows) {
    const callsRatio = row.callsRatio === null ? '-' : `${(row.callsRatio * 100).toFixed(1)} %`;
    const charsRatio =
      row.charactersRatio === null ? '-' : `${(row.charactersRatio * 100).toFixed(1)} %`;
    console.log(
      `  ${String(row.size).padStart(10)} ${String(row.calls).padStart(9)} ${callsRatio.padStart(12)} ` +
        `${String(row.characters).padStart(12)} ${row.charactersPerCall.toFixed(0).padStart(12)} ${charsRatio.padStart(12)}`,
    );
  }
  console.log('');
  console.log(
    '  characters, not tokens: proportional for one vocabulary over one corpus, and not the vendor count.',
  );
}
