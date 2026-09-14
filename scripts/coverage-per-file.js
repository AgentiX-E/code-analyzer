#!/usr/bin/env node
/**
 * Per-file coverage gate.
 *
 * `coverage-report.js` reads only `data.total`, so a run can pass while individual files sit far
 * below the threshold — that is exactly how thirteen files sat between 50% and 94% unnoticed.
 * This gate walks every file in `coverage-summary.json` and requires each one to meet the
 * threshold on all four dimensions.
 *
 * Two rules keep it honest rather than merely strict:
 *
 *   1. A file with no countable code — all four totals are 0, which is what a pure type module
 *      looks like to v8 — is skipped and counted. There is nothing to cover, so failing it would
 *      only teach people to delete or rename such files.
 *
 *   2. A file may be listed in `coverage-per-file-exclusions.json` with a `reason` and, where the
 *      residue cannot be reached on the platform the gate runs on, per-dimension `floors`. An
 *      entry is a reviewable decision to accept a *measured* floor: the file still fails if it
 *      drops below that floor, so the list is a ratchet rather than a hole.
 *
 * Usage:
 *   node scripts/coverage-per-file.js --json coverage/coverage-summary.json [--threshold 95]
 *
 * Options:
 *   --threshold <n>   Minimum percentage per file per dimension (default: 95)
 *   --json <path>     Path to coverage-summary.json (default: coverage/coverage-summary.json)
 *   --exclusions <p>  Path to the exclusion list (default: scripts/coverage-per-file-exclusions.json)
 */

'use strict';

const { readFileSync, existsSync } = require('node:fs');
const { resolve, relative, isAbsolute } = require('node:path');

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

const REPO_ROOT = resolve(__dirname, '..');
const THRESHOLD = Number(getArg('--threshold', '95'));
const JSON_PATH = resolve(process.cwd(), getArg('--json', 'coverage/coverage-summary.json'));
const EXCLUSIONS_PATH = resolve(
  process.cwd(),
  getArg('--exclusions', 'scripts/coverage-per-file-exclusions.json'),
);

const DIMENSIONS = [
  { key: 'statements', label: 'stmts' },
  { key: 'branches', label: 'branch' },
  { key: 'functions', label: 'funcs' },
  { key: 'lines', label: 'lines' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Repo-relative path, so the exclusion list is stable across machines and CI workspaces. */
function toRepoRelative(filePath) {
  if (!isAbsolute(filePath)) return filePath;
  const rel = relative(REPO_ROOT, filePath);
  // Fall back to the absolute path when the summary came from another checkout.
  return rel.startsWith('..') ? filePath : rel;
}

function loadExclusions() {
  if (!existsSync(EXCLUSIONS_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(EXCLUSIONS_PATH, 'utf-8'));
    return parsed.exclusions || {};
  } catch (err) {
    console.error(`Error: Failed to parse ${EXCLUSIONS_PATH}: ${err.message}`);
    process.exit(1);
  }
}

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

  const exclusions = loadExclusions();
  const failures = [];
  let checked = 0;
  let skipped = 0;
  const excluded = [];

  for (const [filePath, coverage] of Object.entries(data)) {
    if (filePath === 'total') continue;

    const counts = DIMENSIONS.map((dim) => coverage[dim.key] || { covered: 0, total: 0, pct: 0 });
    if (counts.every((c) => c.total === 0)) {
      skipped++;
      continue;
    }

    checked++;
    const rel = toRepoRelative(filePath);
    const entry = exclusions[rel];
    if (entry) excluded.push({ file: rel, reason: entry.reason, floors: entry.floors || {} });

    const below = [];
    DIMENSIONS.forEach((dim, index) => {
      const floor =
        entry && entry.floors && entry.floors[dim.key] != null
          ? Number(entry.floors[dim.key])
          : THRESHOLD;
      const pct = Number(counts[index].pct || 0);
      // A tolerance of 0.005 absorbs the two-decimal rounding in the summary.
      if (pct + 0.005 < floor) {
        below.push({ dim: dim.label, key: dim.key, pct, floor });
      }
    });

    if (below.length > 0) {
      failures.push({ file: rel, below, excluded: Boolean(entry) });
    }
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------

  console.log(`\nPer-file coverage gate — every file must reach ≥${THRESHOLD}% on all dimensions.`);
  console.log(
    `Files: ${checked} checked · ${skipped} skipped (no countable code) · ` +
      `${excluded.length} carrying a recorded floor\n`,
  );

  if (excluded.length > 0) {
    console.log('Recorded floors (the file must still stay above its floor):');
    for (const e of excluded) {
      const floors = Object.entries(e.floors)
        .map(([k, v]) => `${k} ≥ ${v}%`)
        .join(', ');
      console.log(`  • ${e.file} — ${floors}`);
      console.log(`      ${e.reason}`);
    }
    console.log('');
  }

  if (failures.length === 0) {
    console.log(`✅ Every file with countable code meets the threshold.`);
    return;
  }

  console.error(`❌ ${failures.length} file(s) below their threshold:\n`);
  for (const f of failures) {
    const detail = f.below.map((b) => `${b.dim} ${b.pct.toFixed(2)}% < ${b.floor}%`).join(', ');
    console.error(`  • ${f.file}${f.excluded ? ' (inside a recorded floor)' : ''}: ${detail}`);
    console.log(
      `::error title=Per-file coverage::${f.file} is below its floor — ${detail}. ` +
        `Raise the file's coverage or record a floor with a reason in ` +
        `scripts/coverage-per-file-exclusions.json.`,
    );
  }
  console.error('');
  process.exit(1);
}

main();
