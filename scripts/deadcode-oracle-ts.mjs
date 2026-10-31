#!/usr/bin/env node
/**
 * A third reader for TypeScript dead code, sharing nothing with the product or with ts-prune.
 *
 * `scripts/deadcode-oracle.py` answers "does anything else in this corpus name this private function?" by walking
 * CPython's `ast`. There is no equivalent for TypeScript, and `ts-prune` cannot be used as one: it is the competitor
 * being measured, and a scorer that agrees with one side by construction scores nothing.
 *
 * So this reads TypeScript with `ts.createSourceFile` — pure syntax, no type checker, no relation to the product's
 * pipeline — and answers the question **ts-prune actually asks**, which is not the Python question:
 *
 *   * **Python's internal surface is real**: `_helper` in a module cannot be imported from outside, so "nothing in the
 *     corpus names it" is decidable and a private function is the whole universe.
 *   * **TypeScript's internal surface is mostly exported.** Measured here: `zod@3.23.8/src` declares 78 exports and
 *     `ioredis@5.4.2/lib` 54, and the internal helpers are exported too, because a module that wants its helper tested
 *     exports it. Restricting a TypeScript oracle to non-exported declarations leaves 29 and 24 symbols respectively,
 *     **none of them dead** — a universe with no positives cannot score recall, so it would look like a rigorous
 *     measurement while deciding nothing.
 *
 * So the TypeScript universe is ts-prune's: **module-scope exported value declarations** in the package, test files
 * aside. And the deciding question has two halves, because in TypeScript "exported" is not the same as "published":
 *
 *   1. **Is the name re-exported from the package entry?** `src/index.ts` with `export * from './errors'` makes every
 *      name in `./errors` part of the package's API — reachable from another repository — so it is not dead no matter
 *      how often this corpus names it. This is resolved by walking the entry's star- and named-re-export graph, which
 *      is exactly what a consumer's `import` would resolve through. **This is the half ts-prune does not model**, and
 *      the reason its findings on a package that publishes everything are structurally wrong.
 *   2. **Does anything name it?** If it is not published through the entry and no file in the corpus names it — as an
 *      identifier, an import specifier, a property name, or a word inside a string literal (`obj['name']`, a DI
 *      token) — then the symbol is unreachable by every route the language offers.
 *
 * The reader is deliberately **generous about liveness** — any textual occurrence anywhere keeps a symbol alive — so
 * that it under-reports rather than over-reports. That biases the oracle *against* the side that claims more, which is
 * the property a scorer needs: a false "dead" from the oracle would punish the honest tool.
 *
 * Usage:
 *   node scripts/deadcode-oracle-ts.mjs --root <dir> [--package <name>] [--json <file>]
 *   node scripts/deadcode-oracle-ts.mjs --root /tmp/corpus/zod-3.23.8/src --package src
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** The repository's own TypeScript, so the reader parses the grammar the corpus was written in. */
const ts = require('typescript');

const SOURCE = /\.(ts|tsx|mts|cts)$/;
const NOT_SOURCE = /\.d\.ts$/;
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', 'deno', 'static']);

function parseArgs(argv) {
  const args = { root: null, package: '', json: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = argv[++i];
    else if (argv[i] === '--package') args.package = argv[++i];
    else if (argv[i] === '--json') args.json = argv[++i];
  }
  if (args.root === null) throw new Error('--root is required');
  return args;
}

function walk(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) stack.push(full);
      else if (SOURCE.test(entry) && !NOT_SOURCE.test(entry)) files.push(full);
    }
  }
  files.sort();
  return files;
}

function hasExport(node) {
  return (ts.getModifiers?.(node) ?? node.modifiers ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

function hasDeclare(node) {
  return (ts.getModifiers?.(node) ?? node.modifiers ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword,
  );
}

function isModuleScope(node) {
  return node.parent !== undefined && ts.isSourceFile(node.parent);
}

/**
 * One declaration's contribution, and the textual occurrences of its name.
 *
 * Occurrence counting is corpus-wide by name rather than scope-resolved, because the question the oracle asks is the
 * question the Python oracle asks: *is this word used anywhere else*. A scope-accurate answer would need the type
 * checker and would then be measuring resolution accuracy, which is the product's job, not the oracle's.
 */
function main() {
  const args = parseArgs(process.argv);
  const root = args.root;
  const files = walk(root);
  const declarations = [];
  const occurrences = new Map();
  /** Module → the names a consumer of that module sees. */
  const moduleExports = new Map();
  /** Module → the modules it re-exports wholesale (`export * from './x'`). */
  const starExports = new Map();
  let declaredExports = 0;

  const count = (name) => {
    if (typeof name !== 'string' || name.length === 0) return;
    occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
  };

  const declared = new Map();

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = relative(root, file).split(sep).join('/');
    const ownExports = new Set();
    const stars = [];

    const visit = (node) => {
      // **Occurrences first**, from every node, so that a name is counted wherever it appears — including inside a
      // string literal, which is how TypeScript spells a property access it cannot resolve statically.
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) count(node.text);
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        for (const word of node.text.split(/[^A-Za-z0-9_$]+/)) count(word);
      }

      if (isModuleScope(node)) {
        const exported = hasExport(node);
        // **The export table of the module**, which is what a consumer's `import` resolves against. An
        // `ExportDeclaration` does not carry an `export` modifier — it *is* the export — so it is handled before the
        // modifier test; checking the modifier first was silently publishing nothing for a package whose entry is one
        // `export * from './x'` per line, which is how `zod` writes it.
        if (ts.isExportDeclaration(node)) {
          // **`export { a as b } from './x'` is a re-export and it carries a module specifier**, so the named-clause
          // case cannot be nested under "no module specifier" — that read `ioredis`'s entry as exporting two names
          // when it re-exports thirty, which would have declared most of the package dead.
          if (node.exportClause === undefined) {
            if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
              stars.push(node.moduleSpecifier.text);
            }
          } else if (ts.isNamespaceExport(node.exportClause)) {
            ownExports.add(node.exportClause.name.text);
          } else {
            for (const element of node.exportClause.elements) ownExports.add(element.name.text);
          }
        } else if (exported) {
          if (
            ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node) ||
            ts.isEnumDeclaration(node)
          ) {
            if (node.name !== undefined) {
              ownExports.add(node.name.text);
              declaredExports += 1;
            }
          } else if (ts.isVariableStatement(node)) {
            for (const list of node.declarationList.declarations) {
              if (!ts.isIdentifier(list.name)) continue;
              ownExports.add(list.name.text);
              declaredExports += 1;
            }
          }
        }

        // **The universe**: module-scope value declarations. Not `declare` — that describes something that exists
        // elsewhere, so this corpus never contained it.
        if (!hasDeclare(node)) {
          if (
            ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node) ||
            ts.isEnumDeclaration(node)
          ) {
            if (node.name !== undefined) {
              declarations.push({
                file: rel,
                line: lineOf(source, node),
                name: node.name.text,
                exported,
              });
              declared.set(node.name.text, (declared.get(node.name.text) ?? 0) + 1);
            }
          } else if (ts.isVariableStatement(node)) {
            for (const list of node.declarationList.declarations) {
              if (!ts.isIdentifier(list.name)) continue;
              // A variable is a function only when it is one; a constant string is not a symbol anybody can call.
              const isFunction =
                list.initializer !== undefined && ts.isArrowFunction(list.initializer);
              const isClass =
                list.initializer !== undefined && ts.isClassExpression(list.initializer);
              if (!isFunction && !isClass) continue;
              declarations.push({
                file: rel,
                line: lineOf(source, list),
                name: list.name.text,
                exported,
              });
              declared.set(list.name.text, (declared.get(list.name.text) ?? 0) + 1);
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(source);
    moduleExports.set(rel, ownExports);
    starExports.set(rel, stars);
  }

  // **The entry surface, resolved the way a consumer resolves it.** Start at the package's entry module and follow
  // `export * from` transitively; a name that comes out the other side is reachable from another repository and is
  // therefore not dead, however rarely this corpus names it.
  const entry = findEntry(root, files, declarations);
  const publishedNames = new Set();
  if (entry !== null) {
    const queue = [entry];
    const seen = new Set();
    while (queue.length > 0) {
      const module = queue.pop();
      if (seen.has(module)) continue;
      seen.add(module);
      for (const name of moduleExports.get(module) ?? []) publishedNames.add(name);
      for (const specifier of starExports.get(module) ?? []) {
        const resolved = resolveSpecifier(root, module, specifier);
        if (resolved !== null) queue.push(resolved);
      }
    }
  }

  const universe = declarations.filter((declaration) => !isTestPath(declaration.file));
  const oracleDead = universe.filter((declaration) => {
    // **Published through the entry**: reachable from outside the corpus, so no corpus-internal evidence can make it
    // dead. This is the half that `ts-prune` does not model.
    if (publishedNames.has(declaration.name)) return false;
    const total = occurrences.get(declaration.name) ?? 0;
    // The declaration name itself is one occurrence; a second declaration of the same name in another file is another.
    return total - (declared.get(declaration.name) ?? 1) <= 0;
  });

  const result = {
    corpus: args.package === '' ? root : args.package,
    files: files.length,
    entry,
    publishedNames: publishedNames.size,
    declarations: universe.length,
    exportedDeclarations: universe.filter((declaration) => declaration.exported).length,
    declaredExports,
    oracleDead,
    universe,
  };

  const text = JSON.stringify(result, null, 2);
  if (args.json !== null) writeFileSync(args.json, `${text}\n`, 'utf8');
  process.stdout.write(`${text}\n`);
}

const TEST_PATH = /(^|\/)(__tests__|__mocks__|test|tests|spec|specs)\//;

function isTestPath(file) {
  return TEST_PATH.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/**
 * The module a consumer imports. `index.ts` first, in every extension and case the ecosystem uses; then whatever
 * `package.json` names; then nothing — and "nothing" is reported as `entry: null` rather than silently treated as
 * "every module is an entry", which would publish the entire package and decide that nothing is dead.
 */
function findEntry(root, files, declarations) {
  const relatives = new Set();
  for (const file of files) relatives.add(relative(root, file).split(sep).join('/'));
  for (const candidate of [
    'index.ts',
    'index.tsx',
    'index.mts',
    'index.cts',
    'mod.ts',
    'main.ts',
  ]) {
    if (relatives.has(candidate)) return candidate;
  }
  const manifest = join(root, '..', 'package.json');
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    for (const field of ['source', 'module', 'main', 'types']) {
      const value = parsed?.[field];
      if (typeof value !== 'string') continue;
      const cleaned = value.replace(/^(\.\/)+/, '').replace(/\.[cm]?jsx?$/, '');
      for (const extension of ['.ts', '.tsx', '.mts', '.cts']) {
        if (relatives.has(`${cleaned}${extension}`)) return `${cleaned}${extension}`;
        if (relatives.has(`${cleaned}/index${extension}`)) return `${cleaned}/index${extension}`;
      }
    }
  } catch {
    // No manifest, or one that does not parse: the corpus has no resolvable entry, and the caller must be told so
    // rather than handed an empty published surface that would make every export look dead.
  }
  return null;
}

/** `./errors` from `src/index.ts` → `src/errors` or `src/errors/index.ts`, in the coordinates of the walk. */
function resolveSpecifier(root, fromModule, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = join(root, fromModule);
  const resolved = join(base, '..', specifier).replace(/\\/g, '/');
  const rel = relative(root, resolved).split(sep).join('/').replace(/\/+$/, '');
  for (const candidate of [
    rel,
    `${rel}.ts`,
    `${rel}.tsx`,
    `${rel}.mts`,
    `${rel}.cts`,
    `${rel}/index.ts`,
    `${rel}/index.tsx`,
  ]) {
    try {
      if (statSync(join(root, candidate)).isFile()) return candidate;
    } catch {
      // Not this one.
    }
  }
  return null;
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

main();
