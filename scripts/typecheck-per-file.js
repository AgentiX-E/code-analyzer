#!/usr/bin/env node
/**
 * Per-file typecheck ratchet for the test tree.
 *
 * `tsconfig.base.json` excludes every test file from the build projects, so the test tree is
 * `noEmit` project (`tsconfig.tests.json`). That tree is known-red — 1829 errors across 184 files
 * at the time of writing — and a single total is a weak invariant: it holds while a clean file goes
 * dirty and another file improves, which is not a ratchet.
 *
 * This gate reads the compiler's output and enforces what the total cannot:
 *
 *   1. A file **absent** from the baseline must have **zero** errors. Every enrolled test file that
 *      is already clean stays clean, so new failures cannot hide behind an aggregate.
 *   2. A file **present** must not **exceed** its recorded count. Improving a file is always
 *      allowed; re-running with `--update` lowers its number so the ratchet only ever tightens.
 *
 * Usage:
 *   npx tsc -p tsconfig.tests.json --pretty false > /tmp/typecheck-tests.log
 *   node scripts/typecheck-per-file.js --log /tmp/typecheck-tests.log
 *   node scripts/typecheck-per-file.js --log /tmp/typecheck-tests.log --update
 *
 * Options:
 *   --log <path>       Compiler output to read (required)
 *   --baseline <path>  Baseline file (default: scripts/typecheck-tests-baseline.json)
 *   --update           Rewrite the baseline from the log instead of verifying
 */

'use strict';

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
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

const LOG_PATH = getArg('--log', '');
const BASELINE_PATH = resolve(
  process.cwd(),
  getArg('--baseline', 'scripts/typecheck-tests-baseline.json'),
);
const UPDATE = args.includes('--update');

const DIAGNOSTIC = /^(.+?)\(\d+,\d+\): error (TS\d+):/;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!LOG_PATH) {
    console.error('Error: --log <path> is required.');
    console.error('  npx tsc -p tsconfig.tests.json --pretty false > /tmp/typecheck-tests.log');
    process.exit(1);
  }
  if (!existsSync(LOG_PATH)) {
    console.error(`Error: Compiler log not found at ${LOG_PATH}`);
    process.exit(1);
  }

  const counts = new Map();
  const byCode = new Map();
  for (const rawLine of readFileSync(LOG_PATH, 'utf-8').split('\n')) {
    // `--pretty false` still emits colour when a wrapper sets FORCE_COLOR.
    const line = rawLine.replace(/\u001b\[[0-9;]*m/g, '');
    const match = DIAGNOSTIC.exec(line.trim());
    if (!match) continue;
    const file = match[1];
    const code = match[2];
    counts.set(file, (counts.get(file) || 0) + 1);
    byCode.set(code, (byCode.get(code) || 0) + 1);
  }

  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

  // -------------------------------------------------------------------------
  // --update: rewrite the baseline from this log
  // -------------------------------------------------------------------------
  if (UPDATE) {
    let existing = { comment: [], files: {} };
    if (existsSync(BASELINE_PATH)) {
      try {
        existing = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
      } catch {
        /* rewrite from scratch */
      }
    }
    const next = {
      comment: existing.comment || [],
      files: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `Baseline updated: ${counts.size} file(s), ${total} error(s) recorded in ${BASELINE_PATH}`,
    );
    return;
  }

  // -------------------------------------------------------------------------
  // Verify against the baseline
  // -------------------------------------------------------------------------
  if (!existsSync(BASELINE_PATH)) {
    console.error(`Error: Baseline not found at ${BASELINE_PATH}`);
    console.error('Create one with --update.');
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')).files || {};
  const baselineTotal = Object.values(baseline).reduce((sum, n) => sum + n, 0);

  // A log with no diagnostics while the baseline records hundreds does not mean the tree got
  // better — it means the compiler did not run (a broken config, a crashed process). Without this
  // the gate would report success on an empty file, which is the worst failure mode a gate has.
  if (total === 0 && baselineTotal > 0) {
    console.error(
      `Error: the log at ${LOG_PATH} contains no diagnostics, but the baseline records ` +
        `${baselineTotal} error(s) — the compiler did not run. Check the typecheck step above.`,
    );
    process.exit(1);
  }

  const newFailures = [];
  const regressions = [];
  const improvements = [];

  for (const [file, count] of counts) {
    const recorded = baseline[file];
    if (recorded == null) {
      newFailures.push({ file, count });
    } else if (count > recorded) {
      regressions.push({ file, count, recorded });
    } else if (count < recorded) {
      improvements.push({ file, count, recorded });
    }
  }
  // Files that were dirty and are now entirely clean deserve to be called out too.
  for (const [file, recorded] of Object.entries(baseline)) {
    if (!counts.has(file)) improvements.push({ file, count: 0, recorded });
  }

  console.log(
    `\nPer-file typecheck ratchet — no new errors, nothing may exceed its recorded count.`,
  );
  console.log(
    `Errors: ${total} (baseline ${baselineTotal}) · ${counts.size} file(s) with errors ` +
      `(baseline ${Object.keys(baseline).length})\n`,
  );

  if (improvements.length > 0) {
    console.log(`Improved since the baseline (lower it with --update):`);
    for (const i of improvements.slice(0, 15)) {
      console.log(`  • ${i.file}: ${i.recorded} → ${i.count}`);
    }
    if (improvements.length > 15) {
      console.log(`  … and ${improvements.length - 15} more`);
    }
    console.log('');
  }

  if (newFailures.length === 0 && regressions.length === 0) {
    console.log('✅ No new type errors, and no file exceeded its recorded count.');
    return;
  }

  console.error(`❌ Typecheck ratchet violated:\n`);
  for (const f of newFailures) {
    console.error(`  • ${f.file}: ${f.count} error(s) in a file that was clean`);
    console.log(
      `::error title=Typecheck ratchet::${f.file} has ${f.count} type error(s) but is not in the ` +
        `baseline — fix them, or record the file deliberately.`,
    );
  }
  for (const r of regressions) {
    console.error(`  • ${r.file}: ${r.recorded} → ${r.count} error(s)`);
    console.log(
      `::error title=Typecheck ratchet::${r.file} grew from ${r.recorded} to ${r.count} type ` +
        `error(s).`,
    );
  }
  console.error('');

  if (byCode.size > 0) {
    const top = [...byCode.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.error(`Most common codes overall: ${top.map(([c, n]) => `${c}×${n}`).join(', ')}\n`);
  }
  process.exit(1);
}

main();
