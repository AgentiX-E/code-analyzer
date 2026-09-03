#!/usr/bin/env node
/**
 * Honest coverage measurement.
 *
 * V8 evaluates `/* v8 ignore *\/` hints natively inside the engine, so Vitest's
 * `coverage.ignoreHint` option cannot turn them off and every line inside an
 * ignored region is invisible to the coverage gate. The only way to observe the
 * true numbers is to make the comments unrecognisable to V8 before the run.
 *
 * This script rewrites `v8 ignore` to `v8x ignore` across production sources,
 * runs the test suite with coverage, restores every file byte-for-byte, and
 * prints the resulting summary. Originals are held in memory and restored in a
 * `finally` block, so a crashed or interrupted test run cannot leave the tree
 * mutated.
 *
 * Usage:
 *   node scripts/coverage-honest.js
 *   node scripts/coverage-honest.js --reportsDirectory /tmp/cov --json out.json
 *
 * Options:
 *   --root <dir>                Directory to neutralise (repeatable, default: packages)
 *   --reportsDirectory <dir>    Vitest coverage output directory
 *   --json <path>               Write the parsed summary as JSON
 *   --hidden-json <path>        Hidden-surface report from v8-ignore-audit.js,
 *                               merged into the GitHub step summary
 *   --vitest-args <args>        Extra arguments forwarded to vitest
 *
 * When GITHUB_STEP_SUMMARY is set, a markdown section is appended to it so the
 * reported-versus-honest gap is visible on the Actions run page.
 */

'use strict';

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join, resolve, relative, sep } = require('node:path');

const HINT = 'v8 ignore';
const NEUTRALISED = 'v8x ignore';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    roots: ['packages'],
    reportsDirectory: 'coverage-honest',
    json: null,
    hiddenJson: null,
    vitestArgs: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--root':
        if (args.roots[0] === 'packages') args.roots = [];
        args.roots.push(argv[++i]);
        break;
      case '--reportsDirectory':
        args.reportsDirectory = argv[++i];
        break;
      case '--json':
        args.json = argv[++i];
        break;
      case '--hidden-json':
        args.hiddenJson = argv[++i];
        break;
      case '--vitest-args':
        args.vitestArgs = argv[++i].split(' ').filter(Boolean);
        break;
      default:
        throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Source discovery (same exclusions as scripts/v8-ignore-audit.js)
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

function collectSourceFiles(root) {
  const found = [];
  const stack = [root];
  const { readdirSync } = require('node:fs');

  while (stack.length > 0) {
    const current = stack.pop();
    if (!existsSync(current)) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (['__tests__', 'test', 'tests'].includes(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        if (!(entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) continue;
        if (entry.name.endsWith('.d.ts')) continue;
        if (/\.(test|spec)\.(ts|js)$/.test(entry.name)) continue;
        found.push(full);
      }
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// GitHub step summary
// ---------------------------------------------------------------------------

const DIMENSIONS = ['statements', 'branches', 'functions', 'lines'];

function writeStepSummary(total, hiddenJsonPath) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const lines = ['## Honest coverage (v8 ignore hints disabled)', ''];

  if (hiddenJsonPath && existsSync(hiddenJsonPath)) {
    const hidden = JSON.parse(readFileSync(hiddenJsonPath, 'utf8'));
    lines.push(
      `Hidden surface: **${hidden.totalHidden}** of ${hidden.totalLines} lines ` +
        `(${hidden.totalPercent.toFixed(2)}%) across ${hidden.files.length} files.`,
    );
    lines.push('');
  }

  lines.push('| Dimension | Covered | Total | % | Gate |');
  lines.push('|-----------|---------|-------|---|------|');
  for (const dim of DIMENSIONS) {
    const value = total[dim];
    if (!value) continue;
    const pct = value.pct.toFixed(2);
    lines.push(
      `| ${dim} | ${value.covered} | ${value.total} | ${pct}% | ` +
        `${value.pct >= 95 ? 'pass' : 'BELOW 95%'} |`,
    );
  }
  lines.push('');

  const { appendFileSync } = require('node:fs');
  appendFileSync(summaryPath, `${lines.join('\n')}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));

  const files = [];
  const seen = new Set();
  for (const root of args.roots) {
    for (const file of collectSourceFiles(root)) {
      const abs = resolve(file);
      if (seen.has(abs)) continue;
      seen.add(abs);
      files.push(abs);
    }
  }

  // Hold originals in memory so restoration never depends on git state.
  const originals = new Map();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (source.includes(HINT)) originals.set(file, source);
  }

  const neutralise = () => {
    for (const [file, source] of originals) {
      writeFileSync(file, source.split(HINT).join(NEUTRALISED), 'utf8');
    }
  };

  const restore = () => {
    for (const [file, source] of originals) {
      writeFileSync(file, source, 'utf8');
    }
  };

  console.log(`Neutralising v8 ignore hints in ${originals.size} files...`);
  let exitCode = 0;

  try {
    neutralise();

    // Thresholds are zeroed because this is a measurement pass, not a gate.
    // Disabling the ignore hints can only lower the numbers, and the project's
    // global thresholds would then fail the run before the summary is written.
    // The real gate stays in the Coverage Gate job and coverage-report.js.
    const vitestArgs = [
      'vitest',
      'run',
      '--config',
      'vitest.config.ts',
      '--coverage.enabled=true',
      '--coverage.provider=v8',
      '--coverage.reporter=json-summary',
      '--coverage.thresholds.lines=0',
      '--coverage.thresholds.functions=0',
      '--coverage.thresholds.statements=0',
      '--coverage.thresholds.branches=0',
      `--coverage.reportsDirectory=${args.reportsDirectory}`,
      ...args.vitestArgs,
    ];

    const result = spawnSync('npx', vitestArgs, { stdio: 'inherit' });
    exitCode = result.status === null ? 1 : result.status;

    const summaryPath = join(args.reportsDirectory, 'coverage-summary.json');

    if (exitCode !== 0) {
      console.error(
        `::error::Test run exited with code ${exitCode}. Any numbers below come ` +
          `from an aborted run and are NOT valid measurements.`,
      );
    }

    if (existsSync(summaryPath)) {
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
      const total = summary.total || {};

      console.log('');
      console.log('Honest coverage (v8 ignore hints disabled):');
      console.log('');
      for (const dim of ['statements', 'branches', 'functions', 'lines']) {
        const value = total[dim];
        if (!value) continue;
        const flag = value.pct < 95 ? '  <-- BELOW 95% GATE' : '';
        console.log(
          `  ${dim.padEnd(11)} ${value.pct.toFixed(2)}%  ` +
            `(${value.covered}/${value.total})${flag}`,
        );
      }
      console.log('');

      if (args.json) {
        writeFileSync(args.json, `${JSON.stringify(total, null, 2)}\n`, 'utf8');
      }

      writeStepSummary(total, args.hiddenJson);
    } else {
      console.error(`::error::Coverage summary not found at ${summaryPath}`);
      if (exitCode === 0) exitCode = 1;
    }
  } finally {
    restore();
    console.log(`Restored ${originals.size} files to their original contents.`);
  }

  return exitCode;
}

process.exit(main());
