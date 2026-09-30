#!/usr/bin/env node
// Which tests should run because of the files you changed.
//
// **The lesson this script encodes, six times over in one iteration**: a change was verified where it was
// demonstrated and not everywhere it applied. A vocabulary list updated in one provider and not another, a parameter
// arm added to one grammar and not the next, and an expectation updated in one test file and not the second one that
// carried it - each of those was found later, by a sweep, as a failure.
//
// The sweep is this: for every file in the change, print the test files that reach it, directly or through one
// import. Running them is then a decision rather than a guess.
//
//   node scripts/impact-of-change.mjs --changed        # uses git to find the change
//   node scripts/impact-of-change.mjs src/a.ts ...     # or name the files

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

/** The specifiers a file imports, as written. Resolution is the next step and only needs the relative ones. */
function importsOf(file) {
  const text = readFileSync(file, 'utf8');
  const out = new Set();
  for (const match of text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) out.add(match[1]);
  for (const match of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(match[1]);
  return out;
}

/** The source file a specifier names, when it is a relative one inside this repository. */
function resolveSpecifier(from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  let files = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--changed') || files.length === 0) {
    const changed = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const working = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
      .split('\n')
      .map((l) => l.slice(3))
      .filter(Boolean);
    files = [...new Set([...changed, ...working])];
  }

  const sources = walk(join(ROOT, 'packages'));
  const tests = sources.filter((f) => /__tests__|test\.tsx?$|\.test\.tsx?$/.test(f));

  // Tests that reach each source file, one import away.
  const testReaches = new Map();
  for (const test of tests) {
    const direct = new Set([test]);
    for (const specifier of importsOf(test)) {
      const target = resolveSpecifier(test, specifier);
      if (target) direct.add(resolve(target));
    }
    // And one level further, which is what a test of a subsystem needs.
    for (const first of [...direct]) {
      if (first === test || !existsSync(first)) continue;
      for (const specifier of importsOf(first)) {
        const target = resolveSpecifier(first, specifier);
        if (target) direct.add(resolve(target));
      }
    }
    for (const target of direct) {
      const list = testReaches.get(target) ?? [];
      list.push(relative(ROOT, test));
      testReaches.set(target, list);
    }
  }

  let total = 0;
  for (const file of files) {
    const abs = resolve(ROOT, file);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    const reached = [...(testReaches.get(abs) ?? [])].sort();
    if (reached.length === 0) continue;
    total += reached.length;
    console.log(`\n${file}`);
    for (const test of reached) console.log(`  ${test}`);
  }

  if (total === 0) {
    console.log('No test reaches the files named. That is a finding, not a pass.');
    process.exit(0);
  }
  console.log(`\n${total} test file(s) reach the change. Run them before committing.`);
}

main();
