#!/usr/bin/env node
// @code-analyzer/intelligence — what the index reads in a repository it did not write, by language
//
// **Every figure this repository published about the index until §102 was measured on itself**, which is the one corpus
// guaranteed to be written in the languages the index already read: 485 TypeScript files, 1 265 of 1 265 specifiers
// resolved. **That is a measurement of the reader against the corpus it was written for.** The corpora the review is
// actually scored on are not this repository - `aacr-bench` v2 files 164 `.cpp`, 87 `.c`, 34 `.h` and 90 `.go` of its 944
// files - so the question *what does the index read in a repository it did not write* needs a checkout that is not this
// one.
//
// **What each row says, and what it refuses to say.** Files, declarations, import statements and the four refusals are
// facts a reader can check against the repository. `edges` is the number of names that cross a file boundary, and
// `filesWithReach` is how many files have a note a prompt could carry - **both of them are counts of what the index can
// say, not claims that what it says is right**; the correctness of a statement set is judged by
// `scripts/import-oracle.ts` against tree-sitter on the fixtures, and the two measurements are deliberately separate so
// that neither can be mistaken for the other.
//
// **The cost is measured too**, because the point of the index is a sentence in a prompt: `reachChars` is what the notes
// for one repository would add to a call, and it is reported per repository rather than per file so a reviewer can see
// whether the device is affordable at repository scale.
//
// Usage:
//   node scripts/corpus-index-report.mjs --root /path/to/checkout [--root …] [--json out.json]

import { writeFileSync } from 'node:fs';

import { reachNoteOf } from '../packages/intelligence/dist/review/index/cross-file.js';
import { buildRepoIndex } from '../packages/intelligence/dist/review/index/repo-index.js';
import { readRepoFiles } from '../packages/intelligence/dist/review/index/repo-files.js';

const args = process.argv.slice(2);
const roots = [];
const shas = [];
for (let at = 0; at < args.length; at += 1) {
  if (args[at] === '--root') roots.push(args[at + 1]);
  if (args[at] === '--sha') shas.push(args[at + 1]);
}
const jsonAt = args.indexOf('--json') >= 0 ? args[args.indexOf('--json') + 1] : null;
if (roots.length === 0) {
  process.stderr.write(
    'usage: node scripts/corpus-index-report.mjs --root <checkout> [--root …]\n',
  );
  process.exit(2);
}

const round4 = (x) => Math.round(x * 10_000) / 10_000;

/** The median of a list of numbers, which is what a note's cost is, because the mean is one long file's opinion. */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

const rows = [];
for (const [at, root] of roots.entries()) {
  const tree = readRepoFiles(root, { maxFiles: 20_000, maxTotalBytes: 128 * 1024 * 1024 });
  const started = Date.now();
  const index = buildRepoIndex(tree.files, { goModule: tree.goModule });
  const indexMs = Date.now() - started;

  /** What the index can say about one language, which is the only form the question *is Go supported* has an answer to. */
  const byLanguage = {};
  for (const [path, file] of index.files) {
    const bucket = (byLanguage[file.language] ??= {
      files: 0,
      symbols: 0,
      imports: 0,
      resolved: 0,
      external: 0,
      missing: 0,
      ambiguous: 0,
      edges: 0,
    });
    bucket.files += 1;
    bucket.symbols += file.symbols.length;
    void path;
  }
  for (const row of index.imports) {
    const language = index.files.get(row.fromPath)?.language ?? 'unknown';
    const bucket = byLanguage[language];
    if (bucket === undefined) continue;
    bucket.imports += 1;
    if (row.why === 'resolved') bucket.resolved += 1;
    else if (row.why === 'external') bucket.external += 1;
    else if (row.why === 'ambiguous') bucket.ambiguous += 1;
    else bucket.missing += 1;
  }
  for (const row of index.references) {
    const language = index.files.get(row.fromPath)?.language ?? 'unknown';
    const bucket = byLanguage[language];
    if (bucket !== undefined) bucket.edges += 1;
  }

  const noteChars = [];
  let filesWithSymbols = 0;
  let filesWithReach = 0;
  let emptyNotes = 0;
  let reachChars = 0;
  for (const [path, file] of index.files) {
    if (file.symbols.length === 0) continue;
    filesWithSymbols += 1;
    const note = reachNoteOf(index, path);
    if (note === null) continue;
    filesWithReach += 1;
    /**
     * **A note with no lines is not a note with no cost.** `reachNoteOf` answers `null` for a file that declares nothing
     * and a note with an empty `lines` for a file whose declarations nothing outside reads - the second still renders
     * `N names are read by no other file`, which is the half of the answer a containment claim needs. The two are
     * counted apart here because a median taken over both reports `0` for a repository where half the files are
     * leaves, which is a true statement about the repository and a useless one about the device.
     */
    if (note.lines.length === 0) {
      emptyNotes += 1;
      continue;
    }
    const chars = note.lines.join('; ').length;
    noteChars.push(chars);
    reachChars += chars;
  }

  rows.push({
    repo: root.split('/').filter(Boolean).slice(-1)[0],
    commit: shas[at] ?? null,
    goModule: tree.goModule,
    files: tree.stats.read,
    readerSkipped: {
      bySize: tree.stats.skippedBySize,
      overCap: tree.stats.skippedOverCap,
      overBytes: tree.stats.skippedOverBytes,
    },
    indexMs,
    stats: index.stats,
    byLanguage,
    reach: {
      filesWithSymbols,
      filesWithReach,
      emptyNotes,
      chars: reachChars,
      medianChars: median(noteChars),
      charsPerNonEmptyNote: noteChars.length === 0 ? 0 : round4(reachChars / noteChars.length),
    },
  });
}

const artifact = {
  comment: [
    'What the index reads in checkouts it did not write, by language. The statement set is judged separately, on the',
    'polyglot fixtures, by scripts/import-oracle.ts against tree-sitter; this file counts what the index can say and',
    'what a reach note for the whole repository would cost a prompt.',
  ],
  generatedBy: 'scripts/corpus-index-report.mjs',
  measuredAt: new Date().toISOString().slice(0, 10),
  repos: rows,
};

if (jsonAt === null) {
  for (const row of rows) {
    process.stdout.write(
      `${row.repo}: files ${row.files}, symbols ${row.stats.symbols}, imports ${row.stats.imports} ` +
        `(resolved ${row.stats.resolvedImports}, external ${row.stats.externalImports}, missing ${row.stats.missingImports}, ` +
        `ambiguous ${row.stats.ambiguousImports}), edges ${row.stats.edges}, ${row.indexMs} ms, ` +
        `reach ${row.reach.filesWithReach}/${row.reach.filesWithSymbols} files ${row.reach.chars} chars\n`,
    );
  }
} else {
  writeFileSync(jsonAt, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`wrote ${jsonAt}\n`);
}
