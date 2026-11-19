#!/usr/bin/env node
// @code-analyzer/intelligence — the cross-file index measured against TypeScript's own resolver
//
// **A resolver checked with its own rules is checked by its author.** `repo-index.ts` decides which file an import
// names, and the only thing that can disagree with it is another resolver that is given the same repository: **the
// compiler's**. `ts.resolveModuleName` is the module resolution TypeScript ships, it is already a devDependency, and it
// answers the same question for every one of the 1 100 source files in this repository.
//
// **The two failure directions are counted separately**, because they are not the same defect. A specifier this index
// resolves and the compiler does not is a *wrong edge* - the consumer would be told a change reaches a file it does not.
// A specifier the compiler resolves and this index does not is a *missing edge* - the consumer is told a change is
// contained when it is not. **The first is worse and the report says so before the rates.**
//
// Usage:
//   node scripts/cross-file-report.mjs [--packages a,b] [--json]

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';

import { buildRepoIndex, impactOf } from '../packages/intelligence/dist/review/index/repo-index.js';
import { reachLine, reachNoteOf } from '../packages/intelligence/dist/review/index/cross-file.js';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const packagesArg = args.indexOf('--packages');
const packages =
  packagesArg >= 0
    ? args[packagesArg + 1].split(',')
    : readdirSync(join(ROOT, 'packages')).filter((name) => {
        return statSync(join(ROOT, 'packages', name)).isDirectory();
      });

/** Every `.ts` file under `packages/<name>/src`, repo-relative. */
function collectSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__')
          continue;
        walk(path);
        continue;
      }
      if (!/\.(?:ts|tsx|mts|cts)$/u.test(entry.name)) continue;
      if (/\.d\.ts$/u.test(entry.name)) continue;
      out.push(path);
    }
  };
  for (const name of packages) {
    try {
      walk(`packages/${name}/src`);
    } catch {
      // A package with no `src` is not a finding.
    }
  }
  return out;
}

const paths = collectSources();
const files = paths.map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }));

const started = Date.now();
const index = buildRepoIndex(files);
const elapsedMs = Date.now() - started;

/** The compiler's answer for the same specifier, in the same vocabulary this index uses. */
const options = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  jsx: ts.JsxEmit.Preserve,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
};
const host = ts.createCompilerHost(options, true);
const cache = new Map();
function compilerSays(fromPath, specifier) {
  const key = `${fromPath}\u0000${specifier}`;
  if (cache.has(key)) return cache.get(key);
  const containing = join(ROOT, fromPath);
  const resolved = ts.resolveModuleName(specifier, containing, options, host).resolvedModule;
  let answer = null;
  if (resolved !== undefined) {
    const plain = resolve(resolved.resolvedFileName);
    answer = plain.includes('/node_modules/')
      ? 'external'
      : relative(ROOT, plain).split('\\').join('/');
    // `index` files are spelled by the compiler and by us in the same way, so no folding is needed here.
  }
  cache.set(key, answer);
  return answer;
}

/**
 * **Only relative specifiers are compared, and that is the whole of the comparison's validity.**
 *
 * The first version put every import in the same table and reported 0.6949 agreement - **of which 162 "disagreements"
 * were `node:path` and 410 were `@code-analyzer/shared`**. Neither is a disagreement about this repository: a builtin is
 * not a file, and a workspace package resolves to `dist/`, which is not source. **A rate that mixes two questions cannot
 * be improved by fixing either one**, so the comparison is restricted to the population both resolvers are answering:
 * a relative specifier, where the question is exactly *which file in this repository*.
 */
const relativeImports = index.imports.filter(
  (row) => row.specifier.startsWith('.') || row.specifier.startsWith('/'),
);
const bareImports = index.imports.length - relativeImports.length;

const disagreements = { weOnly: [], theyOnly: [], bothDifferent: [] };
for (const row of relativeImports) {
  const theirs = compilerSays(row.fromPath, row.specifier);
  const ours = row.why === 'external' ? 'external' : row.target;
  if (theirs === null && ours === null) continue;
  if (theirs === null && ours !== null) disagreements.weOnly.push({ ...row, theirs });
  else if (theirs !== null && ours === null) disagreements.theyOnly.push({ ...row, theirs });
  else if (theirs !== ours) disagreements.bothDifferent.push({ ...row, ours, theirs });
}

const agreed =
  relativeImports.length -
  (disagreements.weOnly.length +
    disagreements.theyOnly.length +
    disagreements.bothDifferent.length);
const round4 = (x) => Math.round(x * 10_000) / 10_000;

// **What the edges are worth as a description of the repository**, not as a selector: how many declarations are read
// from outside their own file, and how concentrated that reading is.
const referenced = new Set(index.references.map((row) => `${row.toPath}#${row.toName}`));
const declared = [...index.files.values()].reduce((sum, file) => sum + file.symbols.length, 0);
const fanOut = new Map();
for (const row of index.references) fanOut.set(row.toName, (fanOut.get(row.toName) ?? 0) + 1);
const topFanOut = [...fanOut.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8);

/**
 * **What the block costs, measured before it is put in a prompt.**
 *
 * §100 hands the index to the reviewer as one line per changed file. **A context device is a token purchase**, and the
 * purchase has to be priced on a repository that exists before the run that tests it: this walks every source file,
 * renders the line a prompt would carry, and reports how long it is. **Characters divided by four is a proxy and it is
 * labelled one** — the same proxy §99.2 uses for the finding text, applied here so the two are comparable, and the only
 * claim that does not depend on it is the distribution of characters, which is what a budget is set against.
 */
const reachLengths = [];
let filesWithReach = 0;
let importersTotal = 0;
for (const path of paths) {
  const note = reachNoteOf(index, path);
  if (note === null) continue;
  filesWithReach += 1;
  importersTotal += note.importers;
  reachLengths.push(reachLine(note).length);
}
reachLengths.sort((left, right) => left - right);
const quantile = (q) =>
  reachLengths[Math.min(reachLengths.length - 1, Math.floor(q * reachLengths.length))] ?? 0;
const reach = {
  files: filesWithReach,
  withoutNote: index.stats.files - filesWithReach,
  chars: reachLengths.reduce((sum, value) => sum + value, 0),
  medianChars: quantile(0.5),
  p90Chars: quantile(0.9),
  maxChars: reachLengths.at(-1) ?? 0,
  meanImporters: round4(importersTotal / Math.max(1, filesWithReach)),
  tokensByProxy: Math.round(reachLengths.reduce((sum, value) => sum + value, 0) / 4),
  medianTokensByProxy: Math.round(quantile(0.5) / 4),
};

const report = {
  generatedBy: 'scripts/cross-file-report.mjs',
  packages,
  files: index.stats.files,
  lines: files.reduce((sum, file) => sum + file.text.split('\n').length, 0),
  stats: index.stats,
  elapsedMs,
  agreement: {
    compared: relativeImports.length,
    bareSpecifiers: bareImports,
    agreed,
    rate: round4(agreed / Math.max(1, relativeImports.length)),
    weResolveTheyDoNot: disagreements.weOnly.length,
    theyResolveWeDoNot: disagreements.theyOnly.length,
    bothResolveDifferently: disagreements.bothDifferent.length,
  },
  samples: {
    weResolveTheyDoNot: disagreements.weOnly.slice(0, 6),
    theyResolveWeDoNot: disagreements.theyOnly.slice(0, 6),
    bothResolveDifferently: disagreements.bothDifferent.slice(0, 6),
  },
  coverage: {
    declarations: declared,
    readFromAnotherFile: referenced.size,
    share: round4(referenced.size / Math.max(1, declared)),
    meanCallers: round4(index.stats.edges / Math.max(1, referenced.size)),
    topFanOut,
  },
  reach,
};

if (asJson)
  writeFileSync(
    join(ROOT, 'benchmarks/cross-file-index.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );

console.log(
  `files ${index.stats.files}  lines ${report.lines}  symbols ${declared}  ms ${elapsedMs}`,
);
console.log(
  `imports ${index.stats.imports}  resolved ${index.stats.resolvedImports}  external ${index.stats.externalImports}  missing ${index.stats.missingImports}  namespace ${index.stats.namespaceImports}`,
);
console.log(
  `edges ${index.stats.edges}  declarations read across a file ${referenced.size} (${report.coverage.share})`,
);
console.log(
  `agreement with tsc on relative specifiers ${agreed}/${relativeImports.length} = ${report.agreement.rate}  we-only ${disagreements.weOnly.length}  they-only ${disagreements.theyOnly.length}  different ${disagreements.bothDifferent.length}`,
);
for (const [label, rows] of Object.entries(report.samples)) {
  if (rows.length === 0) continue;
  console.log(`\n${label}:`);
  for (const row of rows)
    console.log(
      `  ${row.fromPath}:${row.line}  ${row.specifier}  ours=${row.ours ?? row.target}  theirs=${row.theirs}`,
    );
}
console.log('\ntop fan-out:');
for (const [name, count] of topFanOut) console.log(`  ${name} ${count}`);

console.log('\nreach block (the line §100 puts in a prompt):');
console.log(
  `  files with a note ${reach.files}  silent ${reach.withoutNote}  median ${reach.medianChars} chars  p90 ${reach.p90Chars}  max ${reach.maxChars}  mean importers ${reach.meanImporters}`,
);
console.log(
  `  total ${reach.chars} chars = ${reach.tokensByProxy} tokens by the chars/4 proxy  (median call ${reach.medianTokensByProxy})`,
);
