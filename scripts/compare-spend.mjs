#!/usr/bin/env node
// @code-analyzer/code-analyzer — two artifacts, four units, and the one a cost clause may be read on
//
// **What it is for.** A cost clause compares two arms of one dispatch. The arms are billed at different cache states,
// because the vendor's prefix cache outlives the process and the second arm inherits a warm prefix - so **the unit the
// clause is usually written in (`totalUsd`) answers a question about job order.** This prints the same pair in four
// units and says which of them move when the order does.
//
// **Usage.** `node scripts/compare-spend.mjs <a.json> <b.json>`, where `b` is the arm being claimed cheaper. Prices are
// read from the repository's own table and the multiplier is recovered per arm from the bill it was charged, so an
// artifact measured at the vendor's peak and one measured off-peak are each priced at their own hour.

import { readFileSync } from 'node:fs';

import { compareSpend, readArm } from './lib/spend-pair.mjs';

const [aPath, bPath] = process.argv.slice(2);
if (aPath === undefined || bPath === undefined) {
  console.error('usage: node scripts/compare-spend.mjs <a.json> <b.json>');
  process.exit(1);
}

const { LLM_PRICE_TABLE, priceFor } =
  await import('../packages/intelligence/dist/review/llm/cost.js');

function load(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const a = load(aPath);
const b = load(bPath);

const model = a?.configuration?.judgeModel ?? b?.configuration?.judgeModel ?? 'deepseek-chat';
const row = priceFor(model) ?? LLM_PRICE_TABLE[0];
if (row === undefined) {
  console.error(`no price row for ${model}, and the table is empty`);
  process.exit(1);
}
const prices = row.usdPerMillion;

const comparison = compareSpend(readArm(a, prices), readArm(b, prices), prices);

const money = (value) => (value === null ? '      -' : value.toFixed(4));
const percent = (value) => (value === null ? '     -' : `${(value * 100).toFixed(1)}%`);

console.log(
  `prices · ${model} · hit ${prices.cacheHit} · miss ${prices.cacheMiss} · out ${prices.output} USD/M`,
);
console.log(`arms   · a = ${comparison.a} · b = ${comparison.b}`);
console.log('');
console.log('part    arm  calls   prompt    cacheHit  hitRatio  factor      usd   coldUsd');
for (const row of comparison.rows) {
  for (const side of ['a', 'b']) {
    const bill = row[side];
    console.log(
      `${row.part.padEnd(7)} ${side}  ${String(bill.calls).padStart(5)}  ${String(bill.promptTokens).padStart(8)}  ` +
        `${String(bill.cacheHitTokens).padStart(8)}  ${percent(bill.hitRatio).padStart(8)}  ` +
        `${(bill.factor == null ? '-' : bill.factor.toFixed(2)).padStart(6)}  ` +
        `${money(bill.usd).padStart(8)}  ${money(bill.coldUsd).padStart(8)}`,
    );
  }
}
console.log('');
console.log('ratio b/a   usd   coldUsd   promptTokens   calls');
for (const row of comparison.rows) {
  const cell = (value) => (value === null ? '    -' : `${(value * 100).toFixed(1)}%`.padStart(6));
  console.log(
    `${row.part.padEnd(10)} ${cell(row.usdRatio)}  ${cell(row.coldUsdRatio)}  ${cell(row.promptTokenRatio).padStart(13)}  ${cell(row.callRatio)}`,
  );
}
console.log('');

// **The sentence the tool will not write for the reader.** Whether the bar was met is the clause's business; whether the
// two units agree about the direction is this file's, and a disagreement means the pair was never measured in the unit
// the bar was set in.
if (comparison.unitsAgree === null) {
  console.log('units disagree check · not available: one of the totals could not be priced');
} else if (comparison.unitsAgree) {
  console.log('units agree · the direction holds in both the billed and the cold-cache figure');
} else {
  console.log(
    'units disagree · the billed figure and the cold-cache figure point opposite ways, so the difference is the ' +
      'cache state the arms ran in and not the work they did',
  );
}
