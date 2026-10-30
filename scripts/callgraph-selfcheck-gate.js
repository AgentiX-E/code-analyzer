#!/usr/bin/env node
// @code-analyzer — the self-check, held to its floors.
//
// **What this gate is for, in one number.** `TypeScriptProvider` emitted every call site twice for months. Two copies
// of a correct edge are still correct edges, so every assertion about "the right edges exist" passed. The only figure
// that moves is the share of edges that are a second copy of a site that already has one, and it moves a long way:
// measured on this repository's own sources, **31.57 % before the fix and 0.55 % after**.
//
// The floor is 2 %, four times the measurement and sixteen times below the defect — a margin wide enough that ordinary
// code changes cannot trip it and narrow enough that a second producer cannot hide in it.
//
// **The share is not zero and must not be asserted as zero.** A function may legitimately call one callee twice on one
// line (`f(f(x))`), and that is two call sites and two edges. A gate that demanded zero would be a gate that lies about
// the data it is reading.
//
// Usage: node scripts/callgraph-selfcheck-gate.js [--json <path>]

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function argOf(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const artifactPath =
  argOf('json') ?? path.join(REPO_ROOT, 'benchmarks', 'callgraph-selfcheck.json');
if (!fs.existsSync(artifactPath)) {
  console.error(`self-check artifact not found at ${artifactPath}`);
  console.error('run: npx tsx scripts/callgraph-selfcheck.ts');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const calls = report.calls ?? {};
const typescript = (report.byLanguage ?? {}).typescript ?? { edges: 0, withReceiver: 0 };

/** Every floor carries the measurement it was set from, so a reader can tell a floor from a wish. */
const rows = [
  {
    figure: 'calls.share',
    measured: calls.share,
    floor: 0.02,
    ok: typeof calls.share === 'number' && calls.share <= 0.02,
    note: 'measured 0.55 %, 31.57 % with a second producer',
  },
  {
    figure: 'calls.edges',
    measured: calls.edges,
    floor: 4000,
    ok: calls.edges >= 4000,
    note: 'measured 4 750; a graph that lost half its edges is not a cheaper graph',
  },
  {
    figure: 'calls.untagged',
    measured: report.untagged,
    floor: 0,
    ok: report.untagged === 0,
    note: 'every edge names its rule; the deleted cartesian pass wrote none',
  },
  {
    figure: 'typescript.withReceiver',
    measured: typescript.withReceiver,
    floor: 1500,
    ok: typescript.withReceiver >= 1500,
    note: 'measured 2 248 of 4 750; 0 while `text` held the whole call instead of the callee',
  },
];

console.log('| figure | measured | floor | |');
console.log('| --- | --- | --- | --- |');
for (const row of rows) {
  console.log(
    `| ${row.figure} | ${String(row.measured)} | ${String(row.floor)} | ${row.ok ? '✓' : '❌'} |`,
  );
}
console.log('');
for (const row of rows) console.log(`  ${row.figure}: ${row.note}`);
console.log('');
console.log(
  `${String(calls.distinctSites)} distinct call sites across ${String((report.roots ?? []).length)} roots, ` +
    `${String(calls.repeatedEdges)} repeated edges, measured ${String(report.measuredAt)}`,
);

const failed = rows.filter((row) => !row.ok);
if (failed.length > 0) {
  console.error(`\n❌ ${String(failed.length)} self-check figure(s) below their floor:`);
  for (const row of failed) {
    console.error(
      `  ${row.figure} = ${String(row.measured)}, floor ${String(row.floor)} — ${row.note}`,
    );
  }
  process.exit(1);
}

console.log('\n✅ Every self-check figure is at or above its floor.');
