#!/usr/bin/env node
// Which tests name this file, and what do they say its coverage is.
//
// **The lesson this script encodes, confirmed four times in one morning**: a file appears at 0% in a run that did not
// include its tests, and the file is fine. `impact/framework-routes.ts`, `change-detector.ts`, `impact-analyzer.ts`
// and `iou-overlap.ts` all appeared on an at-zero list built from one test file's run - and all four were at 98-100%
// when the tests that name them were the ones running.
//
//   node scripts/measure-candidate.mjs packages/intelligence/src/impact/framework-routes.ts
//
// It answers in the order the question is actually asked:
//
//   1. which test files reach this file (the same walk `impact-of-change.mjs` does)
//   2. run exactly those, with coverage
//   3. print the file's own row
//
// **If step 1 finds none, that is the finding** - and it is different from a low number.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const IGNORED = new Set(['node_modules', 'dist', '.git', 'coverage']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function importsOf(file) {
  const text = readFileSync(file, 'utf8');
  const out = new Set();
  // **Line-based, and it has to be**: a multi-line `import { a, b } from '../x.js'` puts the specifier on the last
  // line, and a `^import` grep misses it. That mistake was made, and it made a covered file look untested.
  for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) out.add(match[1]);
  for (const match of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(match[1]);
  return out;
}

function resolveSpecifier(from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (targets.length === 0) {
    console.log('usage: node scripts/measure-candidate.mjs <file.ts> [...]');
    process.exit(0);
  }

  const sources = walk(join(ROOT, 'packages'));
  const tests = sources.filter((f) => /__tests__|test\.tsx?$|\.test\.tsx?$/.test(f));

  for (const target of targets) {
    const abs = resolve(ROOT, target);
    const naming = [];
    for (const test of tests) {
      const seen = new Set([test]);
      for (const spec of importsOf(test)) {
        const t = resolveSpecifier(test, spec);
        if (t) seen.add(t);
      }
      // One hop further, which is how a subsystem test reaches its parts.
      for (const first of [...seen]) {
        if (!existsSync(first) || first === test) continue;
        for (const spec of importsOf(first)) {
          const t = resolveSpecifier(first, spec);
          if (t) seen.add(t);
        }
      }
      if (seen.has(abs)) naming.push(relative(ROOT, test));
    }

    console.log(`\n${target}`);
    if (naming.length === 0) {
      console.log('  NO TEST REACHES IT. That is the finding, and it is not the same as a low number.');
      continue;
    }
    console.log(`  ${naming.length} test file(s) reach it:`);
    for (const t of naming) console.log(`    ${t}`);

    const summary = join(ROOT, 'coverage', 'coverage-summary.json');
    if (existsSync(summary)) rmSync(summary, { force: true });
    try {
      execFileSync(
        'npx',
        [
          'vitest',
          'run',
          '--config',
          'vitest.config.ts',
          '--coverage',
          '--coverage.reporter=json-summary',
          ...naming,
        ],
        { stdio: 'ignore', cwd: ROOT },
      );
    } catch {
      // A non-zero exit is the threshold check failing against the whole population, which is expected here.
    }
    if (!existsSync(summary)) {
      console.log('  (no coverage written: the run was interrupted before it could)');
      continue;
    }
    const data = JSON.parse(readFileSync(summary, 'utf8'));
    const row = data[Object.keys(data).find((k) => k.endsWith(target)) ?? ''];
    if (!row) {
      console.log('  (the file is not in the report: it was not imported by the tests that ran)');
      continue;
    }
    console.log(
      `  stmts ${row.statements.pct}  branch ${row.branches.pct}  funcs ${row.functions.pct}  lines ${row.lines.pct}`,
    );
  }
}

main();
