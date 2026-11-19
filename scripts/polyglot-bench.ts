// The symbol index against eleven languages, judged by a parser this repository did not write.
//
// **The question this answers, and the one it refuses.** §89 taught `symbols-langs.ts` Kotlin, Groovy, Swift, ArkTS and
// the three documents, and the tests for them were written by the same hand as the scanners. This script asks the
// complementary question - **which names does the file declare at its top level, according to somebody else's grammar**
// - and reports recall and precision per language over `benchmarks/polyglot/manifest.json`.
//
// **It refuses to score ranges, kinds and exports.** Those are three answers the two implementations compute differently
// and on purpose: a grammar knows where a class ends, and the lexer answers `uncertain` when it cannot. A disagreement
// about them would be a disagreement about the question rather than about the answer, and the artifact says so.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildSymbolIndex } from '../packages/intelligence/src/review/index/symbols.js';
import { declarations } from '../scripts/polyglot-oracle.mjs';

interface ManifestEntry {
  readonly language: string;
  readonly path: string;
  readonly origin: string;
  readonly repo?: string;
}

interface Row {
  readonly language: string;
  readonly path: string;
  readonly oracleCount: number;
  readonly oursCount: number;
  readonly both: number;
  readonly missing: string[];
  /** Names this index claims that the oracle does not, split by whether another symbol of the same file contains them. */
  readonly nested: string[];
  readonly phantom: string[];
}

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}benchmarks/polyglot/manifest.json`, 'utf8')) as {
  files: readonly ManifestEntry[];
};

const rows: Row[] = [];
for (const entry of manifest.files) {
  const file = `${root}${entry.path}`;
  const text = readFileSync(file, 'utf8');
  const index = buildSymbolIndex(entry.path, text);
  const expected = new Set(declarations(file, entry.language) as string[]);
  const found = new Set(index.symbols.map((symbol) => symbol.name));
  const both = [...expected].filter((name) => found.has(name));
  // **An extra is either a declaration the oracle does not count or a claim neither implementation can support.** The
  // difference is whether another symbol of the same file contains it: `symbolAt` answers the innermost declaration, so a
  // method inside a class is a symbol here on purpose, and a name no symbol contains is a name that is not in the file.
  const extras = [...found].filter((name) => !expected.has(name));
  const contained = (name: string): boolean => {
    const symbol = index.symbols.find((candidate) => candidate.name === name);
    if (symbol === undefined) return false;
    return index.symbols.some(
      (other) =>
        other !== symbol &&
        (other.startLine !== symbol.startLine || other.endLine !== symbol.endLine) &&
        other.startLine <= symbol.startLine &&
        other.endLine >= symbol.endLine,
    );
  };
  rows.push({
    language: entry.language,
    path: entry.path,
    oracleCount: expected.size,
    oursCount: found.size,
    both: both.length,
    missing: [...expected].filter((name) => !found.has(name)),
    nested: extras.filter((name) => contained(name)),
    phantom: extras.filter((name) => !contained(name)),
  });
}

const byLanguage = new Map<string, { oracle: number; ours: number; both: number }>();
for (const row of rows) {
  const total = byLanguage.get(row.language) ?? { oracle: 0, ours: 0, both: 0 };
  total.oracle += row.oracleCount;
  total.ours += row.oursCount;
  total.both += row.both;
  byLanguage.set(row.language, total);
}

const summary = [...byLanguage.entries()]
  .map(([language, total]) => ({
    language,
    oracle: total.oracle,
    ours: total.ours,
    both: total.both,
    recall: total.oracle === 0 ? 0 : total.both / total.oracle,
    precision: total.ours === 0 ? 0 : total.both / total.ours,
  }))
  .sort((left, right) => left.language.localeCompare(right.language));

const artifact = {
  comment: [
    'The symbol index against the eleven languages the question names, judged by tree-sitter and by Python standard',
    'libraries rather than by this repository. **Recall is the figure that measures a scanner**: a name the oracle found',
    'and the lexer did not is a miss by whichever of the two is wrong. **Precision below one is named rather than',
    'explained away**, because the two implementations disagree on purpose about two shapes: a type declared inside a',
    'type is a declaration the index emits at every language it reads. **The artifact separates those from phantoms**: a',
    'name no other symbol contains is a name that is not in the file, and that count is the one to read.',
  ],
  measuredAt: new Date().toISOString().slice(0, 10),
  where: 'local',
  manifest: 'benchmarks/polyglot/manifest.json',
  oracle: 'scripts/polyglot-oracle.mjs',
  summary,
  rows,
};

writeFileSync(`${root}benchmarks/polyglot-bench.json`, `${JSON.stringify(artifact, null, 2)}\n`);

const pad = (value: string, width: number): string => value.padEnd(width);
console.log(
  `${pad('language', 12)} ${pad('oracle', 7)} ${pad('ours', 6)} ${pad('both', 5)} recall precision`,
);
for (const row of summary) {
  console.log(
    `${pad(row.language, 12)} ${pad(String(row.oracle), 7)} ${pad(String(row.ours), 6)} ${pad(String(row.both), 5)} ` +
      `${row.recall.toFixed(3)}  ${row.precision.toFixed(3)}`,
  );
}
const missed = rows.filter((row) => row.missing.length > 0);
for (const row of missed) {
  console.log(`missed in ${row.language}: ${row.missing.join(', ')}`);
}
const phantoms = rows.filter((row) => row.phantom.length > 0);
for (const row of phantoms) {
  console.log(`phantom in ${row.language}: ${row.phantom.join(', ')}`);
}
console.log(
  `extras contained in another declaration: ${rows.reduce((sum, row) => sum + row.nested.length, 0)}, ` +
    `phantoms: ${rows.reduce((sum, row) => sum + row.phantom.length, 0)}`,
);
