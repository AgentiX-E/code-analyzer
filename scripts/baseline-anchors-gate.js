#!/usr/bin/env node
/**
 * Baseline-anchor gate — every path a baseline records must be a path the repository has.
 *
 * This repository keeps four JSON files keyed by repository-relative path, and every one of them is read by a gate
 * that compares *numbers*:
 *
 *   - `scripts/lint-baseline.json` — files the linter may not get worse (`lint-per-file.js`)
 *   - `scripts/typecheck-tests-baseline.json` — errors a test file may keep (`typecheck-per-file.js`)
 *   - `scripts/coverage-per-file-exclusions.json` — files held to a lower floor (`coverage-per-file.js`)
 *   - `scripts/coverage-exclusion-register.json` — `vitest.config.ts`'s `exclude` entries (`coverage-exclusions-gate.js`)
 *
 * **Not one of those gates compared the key to the tree.** The cost is not theoretical. Iteration 94 deleted eleven
 * modules and `lint-baseline.json` kept fourteen allowances for files that no longer exist — 190 findings' worth,
 * 143 of them from one deleted test — and `coverage-exclusion-register.json` spent 26 words justifying the
 * exclusion of `packages/intelligence/src/__tests__/cross-service-linking.test.ts`, a path that no commit on any ref
 * has ever added: `git log --all --diff-filter=A` over the 1256 commits reachable from every ref names none. The
 * exclusion gate passes on it because it checks that the config and the register *agree*, and two lists of the same
 * fiction agree perfectly.
 *
 * A recorded file that stopped existing is not a stale comment. It is a **standing permission with no subject**: if
 * the path is ever re-created — a rename back, a `git checkout` of an old branch, a new file at a reused name — the
 * allowance applies to it immediately and silently.
 *
 * ## What counts as an anchor
 *
 * An entry may be a path or a glob, because `vitest.config.ts`'s `exclude` is glob-shaped. A glob is reduced to its
 * **literal anchor** — the longest run of segments containing no `*` — and the anchor must resolve:
 *
 * | entry                                     | anchor                                | where it resolves                |
 * | ----------------------------------------- | ------------------------------------- | -------------------------------- |
 * | `packages/analyzer/src/index.ts`          | itself                                | as a path                        |
 * | `packages/web/**`                         | `packages/web`                        | as a path                        |
 * | `**\/benchmarks/ca-bench/suites/**`       | `benchmarks/ca-bench/suites`          | anywhere in the tree             |
 * | `**\/benchmarks/search-benchmark.test.ts` | `benchmarks/search-benchmark.test.ts` | anywhere in the tree             |
 * | `**\/*.generated.ts`                      | none                                  | **fails** — nothing can check it |
 *
 * The last row matters. An entry with no literal anchor is not verifiable by this gate or by a reader, so it is
 * refused rather than skipped: the same rule as `lint-per-file.js`'s "zero files inspected is a failure", applied to
 * records instead of findings.
 *
 * Usage: `node scripts/baseline-anchors-gate.js [--root <dir>] [--quiet]`
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Directories that are never part of the repository's own paths. */
const IGNORED = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.turbo',
  'build',
  '.next',
  '.pnpm-store',
]);

/**
 * The four baselines, the field each keys its records by, and what a record means.
 *
 * The field is spelled out rather than sniffed: a gate that guessed would read `files` from a file that renamed it
 * to `allowances`, find zero records and report a clean tree — the empty-input failure this repository has paid for
 * once already.
 */
const BASELINES = [
  {
    file: 'scripts/lint-baseline.json',
    field: 'files',
    what: 'lint allowance',
  },
  {
    file: 'scripts/typecheck-tests-baseline.json',
    field: 'files',
    what: 'typecheck allowance',
  },
  {
    file: 'scripts/coverage-per-file-exclusions.json',
    field: 'exclusions',
    what: 'coverage exclusion',
  },
  {
    file: 'scripts/coverage-exclusion-register.json',
    field: 'configEntries',
    what: 'coverage exclude entry',
  },
];

const ROOT = path.resolve(__dirname, '..');

/**
 * The literal anchor of a record, or `null` when it has none.
 *
 * `**\/` at the front and `/**` at the end are stripped first: they state "any depth" and carry no path of their own,
 * and leaving them in makes every `**\/x/**` entry look unresolvable.
 */
function literalAnchor(entry) {
  let rest = entry.startsWith('./') ? entry.slice(2) : entry;
  let derivedFromGlob = rest !== entry;
  if (rest.startsWith('**/')) {
    rest = rest.slice(3);
    derivedFromGlob = true;
  }
  if (rest.endsWith('/**')) {
    rest = rest.slice(0, -3);
    derivedFromGlob = true;
  }
  if (rest.length === 0) return null;
  if (!rest.includes('*')) return { anchor: rest, from: derivedFromGlob ? 'glob' : 'path' };

  const segments = rest.split('/');
  const prefix = [];
  for (const segment of segments) {
    if (segment.includes('*')) break;
    prefix.push(segment);
  }
  if (prefix.length > 0) return { anchor: prefix.join('/'), from: 'prefix' };

  const suffix = [];
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i].includes('*')) break;
    suffix.unshift(segments[i]);
  }
  if (suffix.length > 0) return { anchor: suffix.join('/'), from: 'suffix' };

  return null;
}

let index = null;

/** Every file and directory in the tree, relative to the root, ignoring build output. */
function treeIndex(root) {
  if (index) return index;
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      found.push(path.relative(root, full).split(path.sep).join('/'));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  index = found;
  return index;
}

/** The value a failing record carried, short enough to read in a CI log. */
function showValue(value) {
  if (typeof value === 'number') return `recorded ${value}`;
  if (typeof value === 'string') {
    const oneLine = value.replace(/\s+/g, ' ').trim();
    return oneLine.length > 60 ? `"${oneLine.slice(0, 57)}…"` : `"${oneLine}"`;
  }
  return JSON.stringify(value);
}

/**
 * Why `entry` resolves to nothing, or `null` when it resolves.
 *
 * The tree index is only consulted when the cheap `existsSync` misses, so the 386 lint records cost 386 `stat` calls
 * rather than a full traversal each.
 */
function unresolvable(root, entry) {
  const found = literalAnchor(entry);
  if (!found) {
    return 'the entry has no literal anchor, so neither this gate nor a reader can tell what it covers';
  }
  const asPath = path.join(root, found.anchor);
  if (fs.existsSync(asPath)) return null;
  if (found.from === 'path') return `the path does not exist`;
  const matched = treeIndex(root).some(
    (candidate) => candidate === found.anchor || candidate.endsWith(`/${found.anchor}`),
  );
  if (matched) return null;
  return `the entry's literal anchor \`${found.anchor}\` resolves to nothing in the tree`;
}

function parseArgs(argv) {
  const args = { root: ROOT, quiet: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = path.resolve(argv[i + 1]);
    else if (argv[i] === '--quiet') args.quiet = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const failures = [];
  const report = [];

  for (const baseline of BASELINES) {
    const full = path.join(args.root, baseline.file);
    if (!fs.existsSync(full)) {
      failures.push(
        `${baseline.file} is missing — ${baseline.what}s are recorded there and a gate that cannot read them ` +
          `reports a clean tree`,
      );
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (error) {
      failures.push(`${baseline.file} is not readable JSON (${error.message})`);
      continue;
    }

    const records = parsed[baseline.field];
    if (records === undefined || records === null || typeof records !== 'object') {
      failures.push(
        `${baseline.file} has no \`${baseline.field}\` field — the gate reads records from there, and finding none ` +
          `would report every ${baseline.what} as anchored`,
      );
      continue;
    }

    const entries = Object.entries(records);
    const phantoms = [];
    for (const [entry, value] of entries) {
      const why = unresolvable(args.root, entry);
      if (why) phantoms.push(`${entry} — ${showValue(value)} — ${why}`);
    }

    report.push({ file: baseline.file, total: entries.length, phantoms: phantoms.length });
    if (phantoms.length > 0) {
      failures.push(
        `${baseline.file}: ${phantoms.length} of ${entries.length} record(s) name a path the repository does not ` +
          `have:\n${phantoms.map((p) => `      ${p}`).join('\n')}`,
      );
    }
  }

  if (!args.quiet) {
    console.log(
      'baseline anchors — every path a baseline records must be a path the repository has.',
    );
    for (const row of report) {
      const records = row.total === 1 ? '1 record' : `${row.total} records`;
      console.log(`  ${row.file}: ${records}, ${row.phantoms} phantom`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n❌ Baseline-anchor gate failed:\n${failures.map((f) => `  • ${f}`).join('\n')}\n`,
    );
    console.error(
      '  A record whose file is gone is a standing permission with no subject: a path re-created later inherits it\n' +
        '  silently. Remove the record, or point it at the path that took over.\n',
    );
    process.exit(1);
  }

  const total = report.reduce((sum, row) => sum + row.total, 0);
  console.log(`\n✅ ${total} recorded path(s), all present.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = { literalAnchor, unresolvable, BASELINES };
