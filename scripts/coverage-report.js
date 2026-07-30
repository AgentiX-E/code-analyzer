#!/usr/bin/env node
/**
 * CI coverage threshold gate.
 *
 * Reads vitest JSON coverage output and verifies all four dimensions
 * (lines, branches, functions, statements) meet the specified threshold.
 * Exits with code 1 if any dimension falls below threshold.
 *
 * Usage:
 *   node scripts/coverage-report.js --threshold 95 --json coverage/coverage-summary.json
 *
 * Options:
 *   --threshold <n>   Minimum coverage percentage (default: 95)
 *   --json <path>     Path to coverage-summary.json (default: coverage/coverage-summary.json)
 *   --quiet           Only output failures, not a full table
 */

'use strict';

const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name, defaultValue) {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultValue;
}

const THRESHOLD = Number(getArg('--threshold', '95'));
const JSON_PATH = resolve(process.cwd(), getArg('--json', 'coverage/coverage-summary.json'));
const QUIET = args.includes('--quiet');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!existsSync(JSON_PATH)) {
    console.error(`Error: Coverage summary not found at ${JSON_PATH}`);
    console.error('Run tests with --coverage.reporter=json-summary first.');
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
  } catch (err) {
    console.error(`Error: Failed to parse coverage JSON: ${err.message}`);
    process.exit(1);
  }

  const total = data.total;
  if (!total) {
    console.error('Error: No "total" key in coverage summary.');
    process.exit(1);
  }

  const dimensions = [
    { key: 'lines', label: 'Lines' },
    { key: 'branches', label: 'Branches' },
    { key: 'functions', label: 'Functions' },
    { key: 'statements', label: 'Statements' },
  ];

  let allPass = true;
  const results = [];

  for (const dim of dimensions) {
    const d = total[dim.key];
    if (!d) {
      console.error(`Error: Missing "${dim.key}" dimension in coverage summary.`);
      process.exit(1);
    }

    const pct = Number(d.pct || 0);
    const pass = pct >= THRESHOLD;
    if (!pass) allPass = false;

    results.push({
      label: dim.label,
      covered: d.covered || 0,
      total: d.total || 0,
      pct,
      pass,
    });
  }

  // Print report
  if (!QUIET) {
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║        Code Coverage Threshold Gate              ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║ Dimension    Covered / Total         %   Status ║');
    console.log('╠══════════════════════════════════════════════════╣');

    for (const r of results) {
      const pctStr = r.pct.toFixed(1).padStart(6);
      const status = r.pass ? '✅' : '❌';
      const label = r.label.padEnd(11);
      const count = `${String(r.covered)}/${String(r.total)}`.padStart(16);
      console.log(`║ ${label} ${count}  ${pctStr}%   ${status}  ║`);
    }

    console.log('╚══════════════════════════════════════════════════╝');
    console.log(`\nThreshold: ≥${THRESHOLD}%\n`);
  }

  if (allPass) {
    console.log(`✅ All ${results.length} dimensions meet the ≥${THRESHOLD}% threshold.`);
  } else {
    const failures = results.filter((r) => !r.pass);
    console.error(`\n❌ Coverage threshold NOT met! ${failures.length} dimension(s) below ${THRESHOLD}%:`);
    for (const f of failures) {
      console.error(`   ${f.label}: ${f.pct.toFixed(1)}% < ${THRESHOLD}%`);
    }

    // Write GitHub Actions annotation
    for (const f of failures) {
      console.log(
        `::error title=Coverage Threshold Failed::${f.label} coverage (${f.pct.toFixed(1)}%) is below the ${THRESHOLD}% threshold.`,
      );
    }

    process.exit(1);
  }
}

main();
