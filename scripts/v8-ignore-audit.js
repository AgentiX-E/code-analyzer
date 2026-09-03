#!/usr/bin/env node
/**
 * Hidden-coverage audit (v8 ignore ratchet).
 *
 * V8 processes `/* v8 ignore *\/` hints natively inside the engine, so Vitest's
 * `coverage.ignoreHint` option cannot disable them. Every line inside such a
 * region is invisible to the coverage gate, which means a package can report
 * "100% coverage" while large parts of it are never executed.
 *
 * This script statically measures that hidden surface and enforces a ratchet:
 * the hidden line count may never grow. Improvements are accepted
 * automatically; regressions fail the build until the baseline is explicitly
 * re-generated with --update-baseline.
 *
 * Usage:
 *   node scripts/v8-ignore-audit.js
 *   node scripts/v8-ignore-audit.js --root packages/intelligence
 *   node scripts/v8-ignore-audit.js --update-baseline
 *
 * Options:
 *   --root <dir>          Directory to scan (repeatable, default: packages)
 *   --baseline <path>     Baseline JSON file
 *                         (default: .github/coverage-hidden-baseline.json)
 *   --update-baseline     Regenerate the baseline from the current tree
 *   --max-file-hidden <n> Hard per-file cap on hidden percentage (default: 100)
 *   --json <path>         Also write the report as JSON
 *   --quiet               Only print failures
 */

'use strict';

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join, resolve, relative, sep } = require('node:path');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    roots: [],
    baseline: '.github/coverage-hidden-baseline.json',
    updateBaseline: false,
    maxFileHidden: 100,
    json: null,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--root':
        args.roots.push(argv[++i]);
        break;
      case '--baseline':
        args.baseline = argv[++i];
        break;
      case '--update-baseline':
        args.updateBaseline = true;
        break;
      case '--max-file-hidden':
        args.maxFileHidden = Number(argv[++i]);
        break;
      case '--json':
        args.json = argv[++i];
        break;
      case '--quiet':
        args.quiet = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }

  if (args.roots.length === 0) args.roots.push('packages');
  return args;
}

// ---------------------------------------------------------------------------
// Source discovery
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

function isTestFile(name) {
  return name.endsWith('.test.ts') || name.endsWith('.test.js') || name.endsWith('.spec.ts');
}

function isTestDir(name) {
  return name === '__tests__' || name === 'test' || name === 'tests';
}

function collectSourceFiles(root) {
  const found = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!existsSync(current)) continue;

    const entries = require('node:fs').readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || isTestDir(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        if (!(entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) continue;
        if (entry.name.endsWith('.d.ts')) continue;
        if (isTestFile(entry.name)) continue;
        found.push(full);
      }
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// v8 ignore parsing
// ---------------------------------------------------------------------------

// Matches both block (`/* v8 ignore ... */`) and line (`// v8 ignore ...`)
// comment forms, which V8 accepts interchangeably.
// The patterns are assembled from fragments rather than written as literals,
// because this file documents the hint syntax and would otherwise match its own
// patterns. A scanner that reports itself as a violation is worse than useless:
// running with `--root .` would produce a failure that no source change can fix.
// Whitespace between the two words stays as the regex atom `\s+`, so the
// reconstructed patterns are byte-identical to the literals they replace.
const HINT = 'v8' + '\\s+' + 'ignore';

const RE_START = new RegExp('(?:\\/\\*|\\/\\/)\\s*' + HINT + '\\s+start\\b');
const RE_STOP = new RegExp('(?:\\/\\*|\\/\\/)\\s*' + HINT + '\\s+stop\\b');
const RE_NEXT = new RegExp('(?:\\/\\*|\\/\\/)\\s*' + HINT + '\\s+next(?:\\s+(\\d+))?\\b');

/**
 * Count the number of source lines hidden behind v8 ignore hints.
 *
 * Block regions count every line strictly between `start` and `stop`.
 * `next [N]` marks the following N lines (N defaults to 1). Annotation lines
 * themselves are never counted, because an inline `next` hint sits beside live
 * code on the same line rather than replacing it.
 */
function countHiddenLines(source) {
  const lines = source.split('\n');
  let hidden = 0;
  let annotations = 0;
  let inBlock = false;
  let pending = 0;

  for (const line of lines) {
    if (pending > 0) {
      hidden += 1;
      pending -= 1;
      continue;
    }

    const nextMatch = RE_NEXT.exec(line);
    if (nextMatch) {
      annotations += 1;
      pending = nextMatch[1] ? Number(nextMatch[1]) : 1;
      continue;
    }

    if (RE_START.test(line)) {
      annotations += 1;
      inBlock = true;
      continue;
    }

    if (RE_STOP.test(line)) {
      annotations += 1;
      inBlock = false;
      continue;
    }

    if (inBlock) hidden += 1;
  }

  return { hidden, annotations, total: lines.length };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function buildReport(roots) {
  const files = [];
  const seen = new Set();

  for (const root of roots) {
    for (const file of collectSourceFiles(root)) {
      const abs = resolve(file);
      if (seen.has(abs)) continue;
      seen.add(abs);
      files.push(abs);
    }
  }

  const entries = [];
  let totalHidden = 0;
  let totalLines = 0;
  let totalAnnotations = 0;

  for (const file of files.sort()) {
    const { hidden, annotations, total } = countHiddenLines(readFileSync(file, 'utf8'));
    totalHidden += hidden;
    totalLines += total;
    totalAnnotations += annotations;
    if (annotations > 0) {
      entries.push({
        path: relative(process.cwd(), file).split(sep).join('/'),
        hidden,
        total,
        percent: total === 0 ? 0 : (hidden / total) * 100,
        annotations,
      });
    }
  }

  entries.sort((a, b) => b.hidden - a.hidden || a.path.localeCompare(b.path));

  return {
    files: entries,
    totalHidden,
    totalLines,
    totalAnnotations,
    totalPercent: totalLines === 0 ? 0 : (totalHidden / totalLines) * 100,
  };
}

function printTable(report) {
  const header = ['file', 'hidden', 'total', '%hidden', 'hints'];
  const rows = report.files.map((f) => [
    f.path,
    String(f.hidden),
    String(f.total),
    f.percent.toFixed(1),
    String(f.annotations),
  ]);

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));

  const line = (cells) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');

  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args.roots);

  if (args.json) {
    writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (args.updateBaseline) {
    const baseline = {
      totalHidden: report.totalHidden,
      totalLines: report.totalLines,
      files: Object.fromEntries(report.files.map((f) => [f.path, f.hidden])),
    };
    writeFileSync(args.baseline, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(
      `Baseline written to ${args.baseline}: ${report.totalHidden} hidden lines ` +
        `across ${report.files.length} files.`,
    );
    return 0;
  }

  if (!args.quiet) {
    console.log(
      `Hidden coverage: ${report.totalHidden} of ${report.totalLines} lines ` +
        `(${report.totalPercent.toFixed(2)}%) across ${report.files.length} files, ` +
        `via ${report.totalAnnotations} v8 ignore hints.`,
    );
    console.log('');
    printTable(report);
    console.log('');
  }

  const failures = [];

  // Ratchet: the hidden surface may shrink but never grow.
  if (existsSync(args.baseline)) {
    const baseline = JSON.parse(readFileSync(args.baseline, 'utf8'));
    const baselineFiles = baseline.files || {};

    if (report.totalHidden > baseline.totalHidden) {
      failures.push(
        `Total hidden lines grew from ${baseline.totalHidden} to ${report.totalHidden} ` +
          `(+${report.totalHidden - baseline.totalHidden}).`,
      );
    }

    for (const file of report.files) {
      const previous = baselineFiles[file.path];
      if (previous === undefined) {
        if (file.hidden > 0) {
          failures.push(
            `New v8 ignore usage in ${file.path}: ${file.hidden} hidden lines ` +
              `(not present in baseline).`,
          );
        }
      } else if (file.hidden > previous) {
        failures.push(
          `${file.path}: hidden lines grew from ${previous} to ${file.hidden} ` +
            `(+${file.hidden - previous}).`,
        );
      }
    }
  } else {
    failures.push(
      `Baseline ${args.baseline} is missing. Generate it with ` +
        `node scripts/v8-ignore-audit.js --update-baseline`,
    );
  }

  // Hard per-file cap, independent of the ratchet.
  for (const file of report.files) {
    if (file.percent > args.maxFileHidden) {
      failures.push(
        `${file.path}: ${file.percent.toFixed(1)}% of lines hidden ` +
          `(cap is ${args.maxFileHidden}%).`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`::error title=Hidden Coverage::${failures.length} violation(s) found`);
    for (const failure of failures) console.error(`::error::${failure}`);
    return 1;
  }

  if (!args.quiet) {
    console.log('Hidden-coverage ratchet holds — no growth in v8 ignore usage.');
  }
  return 0;
}

process.exit(main());
