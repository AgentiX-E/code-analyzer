// The symbol index against a few hundred real files, per language, judged by somebody else's grammar.
//
// **The two corpora before this one were one file per language and one construct file per language.** Both answer a
// question a reviewer would ask - *can it read this* - and neither answers the one a maintainer asks: *how often is it
// right on the code it will actually meet*. This walks directories this machine already has, reads every file of the
// languages the oracle can judge, and reports the distribution rather than a verdict.
//
// **What it is not.** It is not a benchmark of the field: the files come from `node_modules` and a Python installation,
// so they are libraries rather than applications, and **eight of the eleven languages have no local corpus at all** -
// which is why the eleven-language table stays one file per language and this table is three rows long.
//
// Usage:
//   npx tsx scripts/polyglot-scale.ts [--per-language 120] [--root <dir>] [--json]

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import { buildSymbolIndex } from '../packages/intelligence/src/review/index/symbols.js';
import { declarations } from '../scripts/polyglot-oracle.mjs';

const args = process.argv.slice(2);
const perLanguage = Number(args[args.indexOf('--per-language') + 1]) || 120;
const asJson = args.includes('--json');
const roots = args.includes('--root')
  ? [args[args.indexOf('--root') + 1]!]
  : ['node_modules', '/root/.pyenv/versions/3.11.1/lib/python3.11'];

/** The extensions this can judge, which is the three languages both an oracle and a local corpus exist for. */
const LANGUAGE_OF: Readonly<Record<string, string>> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.ts': 'typescript',
  '.py': 'python',
};

/** Directories whose files are fixtures or builds rather than code a review would meet. */
const SKIP = /(?:^|\/)(?:\.git|dist|build|coverage|__pycache__|test|tests|fixtures?)\//u;

interface Candidate {
  readonly path: string;
  readonly language: string;
}

interface Row {
  readonly language: string;
  readonly path: string;
  readonly expected: number;
  readonly found: number;
  readonly both: number;
}

interface Bucket {
  files: number;
  expected: number;
  found: number;
  both: number;
  misses: Row[];
}

function walk(directory: string, found: Candidate[]): void {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (SKIP.test(`${path}/`)) continue;
    if (entry.isDirectory()) {
      walk(path, found);
      continue;
    }
    const language = LANGUAGE_OF[extname(entry.name)];
    if (language !== undefined) found.push({ path, language });
  }
}

const selected = new Map<string, Candidate[]>();
for (const root of roots) {
  const found: Candidate[] = [];
  walk(root, found);
  for (const candidate of found) {
    const list = selected.get(candidate.language) ?? [];
    if (list.length < perLanguage) list.push(candidate);
    selected.set(candidate.language, list);
  }
}

const rows: Row[] = [];
for (const [language, files] of selected) {
  for (const file of files) {
    let text: string;
    let expected: string[] | null;
    try {
      text = readFileSync(file.path, 'utf8');
      expected = declarations(file.path, language);
    } catch {
      // **A file the oracle cannot read is a file the comparison cannot score**, and dropping it is the only honest
      // option: scoring it as a miss would charge this scanner for a grammar's limit.
      continue;
    }
    if (expected === null || expected.length === 0) continue;
    // **A file may declare one name twice** - an overload set, a merged interface - and the oracle reports it twice. A
    // recall computed over a list with repeats can exceed its precision, which is how the first run of this script
    // reported **1.101**; the names are a set on both sides or the two figures are not comparable.
    const wanted = new Set(expected);
    const names = new Set(buildSymbolIndex(file.path, text).symbols.map((symbol) => symbol.name));
    rows.push({
      language,
      path: file.path,
      expected: wanted.size,
      found: names.size,
      both: [...wanted].filter((name) => names.has(name)).length,
    });
  }
}

const byLanguage: Record<string, Bucket> = {};
for (const row of rows) {
  const bucket = (byLanguage[row.language] ??= {
    files: 0,
    expected: 0,
    found: 0,
    both: 0,
    misses: [],
  });
  bucket.files += 1;
  bucket.expected += row.expected;
  bucket.found += row.found;
  bucket.both += row.both;
  if (row.both < row.expected) bucket.misses.push(row);
}

if (asJson) {
  console.log(JSON.stringify({ perLanguage, rows, summary: byLanguage }, null, 1));
} else {
  console.log('language     files  names  found  recall  precision');
  for (const [language, bucket] of Object.entries(byLanguage)) {
    const recall = (bucket.both / bucket.expected).toFixed(3);
    const precision = (bucket.both / bucket.found).toFixed(3);
    console.log(
      `${language.padEnd(12)} ${String(bucket.files).padStart(5)} ${String(bucket.expected).padStart(6)} ` +
        `${String(bucket.found).padStart(6)}  ${recall.padStart(6)}  ${precision.padStart(9)}`,
    );
  }
  const misses = Object.values(byLanguage).reduce((sum, bucket) => sum + bucket.misses.length, 0);
  console.log(`files with at least one missed name: ${misses} of ${rows.length}`);
}
