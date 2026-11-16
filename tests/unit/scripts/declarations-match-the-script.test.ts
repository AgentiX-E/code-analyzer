// **A declaration file that names a function the module does not export is a test that cannot be checked, and four
// consecutive red CI runs were the price of not having this file.**
//
// Between §61 and §68 `aacr-ablation-compare.mjs` grew `registrationFor`, `registrationResolvable`,
// `resolutionForPullRequests`, `CORPUS_SAMPLING`, `MINIMUM_REGISTERED_GAIN`, `REPRODUCTION` and a second registration
// key. The `.d.mts` beside it declared none of them, so five test files imported names the type checker could not see and
// the `Type Check` job failed on `1ecda9a`, `1e67507`, `1fa3444` and `0765125` - **every one of them green locally,
// because the ratchet that refuses them was never run.**
//
// That is two defects and this file is the repair for both:
//
// - **the drift**: a hand-written declaration is a second copy of an export list, and nothing was comparing the copies;
// - **the gate that was skipped**: `pnpm format:check`, `pnpm typecheck` and the test-tree ratchet are now in
//   `scripts/ci-local.sh` beside the gates that were being run, so "green locally" means the same thing as green.
//
// **What this test does not do is require a declaration for every module.** Most of `scripts/lib/` is imported by tests
// that the ratchet already judges file by file, and a declaration written to satisfy a checker rather than to describe a
// return value is worse than the `any` it replaces. **What it requires is that a declaration that exists is true** - in
// both directions, because a declaration that omits a runtime export is the drift above and one that invents an export is
// a test asserting against something that is not there.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REGISTRATIONS } from '../../../.github/scripts/aacr-ablation-compare.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Directories whose `.mjs` files carry declarations, and the ones this project has decided to declare. */
const SEARCHED = ['.github/scripts', 'scripts', 'scripts/lib'];

/**
 * **The runtime names a module exports**: `export function`, `export const`, `export class`.
 *
 * Read with one expression rather than a parser, because the files this runs on are the ones this project writes and a
 * declaration that survives a regex is a declaration whose names are spelled the way the module spells them.
 */
function runtimeExports(source: string): Set<string> {
  const names = new Set<string>();
  const pattern = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of source.matchAll(pattern)) if (match[1]) names.add(match[1]);
  // **And the form that is a list**: `export { a, b as c }`, which is how a module re-exports a name it did not declare.
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const entry of (match[1] ?? '').split(',')) {
      const name = entry
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/**
 * **The names a declaration file states**: `declare function|const|class` and `interface|type`.
 *
 * Split in two because they answer different questions: a `declare` names a value that must exist at runtime, and an
 * `interface` names a shape that must not.
 */
function declaredNames(source: string): { values: Set<string>; types: Set<string> } {
  const values = new Set<string>();
  const types = new Set<string>();
  // **`declare` is optional in a declaration file** - `export function f(): void;` states the same promise as
  // `export declare function f(): void;` - and the first version of this reader accepted only the second form, so the
  // six declarations that use the first read as empty and the test would have demanded a rewrite of files that were
  // right. **A gate that fails on a correct file is a gate that gets disabled.**
  for (const match of source.matchAll(
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm,
  ))
    if (match[1]) values.add(match[1]);
  for (const match of source.matchAll(/^export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm))
    if (match[1]) types.add(match[1]);
  return { values, types };
}

/** Every `X.mjs` that has an `X.d.mts` beside it, as pairs of absolute paths. */
function declaredModules(): { module: string; declaration: string }[] {
  const pairs: { module: string; declaration: string }[] = [];
  for (const directory of SEARCHED) {
    const absolute = join(repoRoot, directory);
    let entries: string[];
    try {
      entries = readdirSync(absolute);
    } catch {
      continue;
    }
    const declarations = new Set(entries.filter((name) => name.endsWith('.d.mts')));
    for (const name of entries) {
      if (!name.endsWith('.mjs')) continue;
      const declaration = `${name.slice(0, -'.mjs'.length)}.d.mts`;
      if (!declarations.has(declaration)) continue;
      pairs.push({ module: join(absolute, name), declaration: join(absolute, declaration) });
    }
  }
  return pairs;
}

describe('a declaration file that is not the module is a test that cannot be checked', () => {
  const pairs = declaredModules();

  it('finds the declaration files this project maintains', () => {
    // **A test over an empty list passes and says nothing**, which is the shape of every gate that was never wired.
    expect(pairs.length).toBeGreaterThanOrEqual(12);
    const names = pairs.map((pair) => relative(repoRoot, pair.module)).sort();
    expect(names).toContain('.github/scripts/aacr-ablation-compare.mjs');
    expect(names).toContain('scripts/lib/claims-match.mjs');
  });

  it('declares every export the module has, in the module’s own spelling', () => {
    const missing: string[] = [];
    for (const pair of pairs) {
      const runtime = runtimeExports(readFileSync(pair.module, 'utf8'));
      const { values, types } = declaredNames(readFileSync(pair.declaration, 'utf8'));
      for (const name of runtime) {
        if (values.has(name) || types.has(name)) continue;
        missing.push(`${relative(repoRoot, pair.declaration)}: ${name}`);
      }
    }
    // **Named one by one rather than counted**, because the repair is per name: `CORPUS_SAMPLING` wants a `declare const`
    // and `PAIR_KINDS` wants a type that says what the array holds.
    expect(missing).toEqual([]);
  });

  it('invents no export the module does not have', () => {
    const invented: string[] = [];
    for (const pair of pairs) {
      const runtime = runtimeExports(readFileSync(pair.module, 'utf8'));
      const { values } = declaredNames(readFileSync(pair.declaration, 'utf8'));
      for (const name of values) {
        if (runtime.has(name)) continue;
        invented.push(`${relative(repoRoot, pair.declaration)}: ${name}`);
      }
    }
    // **The direction that catches a deleted function.** A `declare` is a promise that the value exists; a declaration
    // left behind after a rename makes a test compile against something the module stopped exporting, and it fails at
    // run time in a job nobody re-read.
    expect(invented).toEqual([]);
  });

  it('lists every registered device in the union, because a key the union omits is a registration no test can read', () => {
    // **This is the omission that cost four CI runs**, in the one form the type checker can see: the union in the
    // declaration file has to name every key the script registers, and the assertion reads both files rather than a copy.
    const declaration = readFileSync(
      join(repoRoot, '.github/scripts/aacr-ablation-compare.d.mts'),
      'utf8',
    );
    const omitted = Object.keys(REGISTRATIONS).filter((key) => !declaration.includes(`'${key}'`));
    expect(omitted).toEqual([]);
  });
});

describe('the declaration files stay inside the tree they describe', () => {
  it('declares nothing outside a directory this project searches', () => {
    // **A `.d.mts` in a directory nobody reads is a declaration nothing checks**, which is how the first one survived
    // being wrong for seven sections: it was in a place the old tests imported by relative path and no gate walked.
    const orphans: string[] = [];
    for (const file of walk(repoRoot)) {
      if (!file.endsWith('.d.mts')) continue;
      const module = file.replace(/\.d\.mts$/, '.mjs');
      let exists = true;
      try {
        statSync(module);
      } catch {
        exists = false;
      }
      if (!exists) orphans.push(relative(repoRoot, file));
    }
    expect(orphans).toEqual([]);
  });
});

/** Every file under a directory, skipping the ones that are never declared against. */
function walk(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'coverage' || entry === 'dist')
      continue;
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) found.push(...walk(absolute));
    else found.push(absolute);
  }
  return found;
}
