// @code-analyzer/intelligence — the file-level fallback: a ranking built from a path and its import statements
//
// **The gap this exists to close is not a ranking gap, it is a coverage gap, and coverage is what a published mean is
// taken over.** Measured on Long Code Arena, this product produced a ranking on **105 of 150 instances**; the other 45
// were refused by the harness's own bounds, and the refusals are not scattered - they are every checkout above the file
// cap and every analysis that projected past the memory ceiling. Ranking is harder on a larger repository because there
// are more candidates, so a mean taken over the instances that fitted is a mean over the **easiest** half of the corpus,
// and printing it beside a baseline table measured over all fifty instances per split is two numbers in one font.
//
// **Two years of this project's own reasoning said the fix was to make the analyser smaller.** Sharding the graph,
// streaming the parse, storing nodes out of process - all of them are the right direction and none of them is a ranking,
// and every one of them leaves the figure missing exactly the rows it cannot reach. **The refusal is a decision to
// produce no answer; a fallback is a decision to produce a worse one**, and a worse answer over the whole corpus is a
// measurement where a missing answer is a hole.
//
// **What the fallback reads is the published strong configuration for this task: a file's path and its imports.** Not
// its body - the body is what the analyser reads, and a fallback that read the body would be the same instrument with a
// smaller budget rather than a second one. A file's path says what the file is for and its imports say what it is wired
// to; an issue that says "the retry decorator loses the timeout" names both.
//
// **It differs from the lexical control in exactly one thing, and that is the experiment.** `lexical.ts` is the shared
// tokeniser, saturation, length normalisation, dropped-zero rule and tie-break; `benchmark/lca-baseline.ts` reads a
// file's whole text as a document and this module reads its path and imports. **Same formula, same tokens, different
// document** - so a difference between the two is the document and cannot be the arithmetic.
//
// **And it is bounded by the answer space, not by the runner.** One head read per file, no parser, no graph, no model:
// a token array per file rather than a map per file, because a map costs an object, a bucket array and a string key per
// term and this holds twenty thousand of them at once on the exact checkouts the analyser refused.

import { join } from 'node:path';

import { readHead } from './file-head.js';
import { averageLengthOf, documentFrequencies, rankBm25Documents, tokenize } from './lexical.js';

import type { LexicalDocument } from './lexical.js';

/**
 * How much of a file is read to find its imports.
 *
 * **Eight kilobytes, because an import block is at the top and a body is not read at all.** The largest import header
 * this project measured is a thousand-line generated Kotlin file's; 8 KB is sixty times the median and still small
 * enough that twenty thousand of them are a hundred and sixty megabytes of sequential read rather than of resident
 * memory - the bytes are released as soon as their file's tokens are built.
 */
export const IMPORT_HEAD_BYTES = 8_192;

/**
 * The import forms the fallback recognises, one pattern per line and **anchored at the start of a line**.
 *
 * **Order is part of the definition, not an accident of the array.** The first pattern that matches a line wins, so the
 * forms with more structure come first: a Java `import a.b.C;` also satisfies the looser Python `import a.b` shape, and
 * a JavaScript `import x from 'y'` satisfies the loose Java shape with `x` instead of `y` - running the loose one first
 * would capture the bound name and throw the module away, which is the half of the statement that carries the word.
 *
 * **Languages, not a parser.** The corpus this was built for is Python, Java and Kotlin; the other eight are here
 * because the product supports them and a fallback that silently found no imports in a TypeScript repository would
 * report a path-only document and call it a path-and-import one. **A miss is visible** - `importLines` is published per
 * instance - which is what makes the list checkable rather than aspirational.
 */
const IMPORT_PATTERNS: readonly RegExp[] = [
  // Python: `from a.b import c`
  /^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/u,
  // JavaScript, TypeScript: `import x from 'a'`, `import type {x} from 'a'`
  //
  // **`{0,512}` and not `*`, and the number is a bound rather than a style.** `[^'"]*` followed by `from` is quadratic
  // on a line that starts with `import` and never says `from`: the engine advances the star to the end of the line,
  // fails, and tries the next start position, for every position. **A minified bundle's single line is exactly that
  // input**, and this file reads eight kilobytes of every file in a checkout it did not write. Five hundred characters
  // is longer than any import statement this project has measured, and **a miss is not silent** - `importLines` is
  // published per instance, so an input this bound rejects is a visible zero rather than a quiet one.
  /^\s*import\s+[^'"]{0,512}from\s+['"]([^'"]+)['"]/u,
  // JavaScript, TypeScript: `import 'a'` for a side effect
  /^\s*import\s+['"]([^'"]+)['"]/u,
  // Re-exports: `export { x } from 'a'`
  //
  // The same bound for the same reason: the shape that never reaches `from` is the shape that makes the star quadratic.
  /^\s*export\s+[^'"]{0,512}from\s+['"]([^'"]+)['"]/u,
  // CommonJS: `require('a')`, an expression rather than a statement, so it is not anchored
  /require\(\s*['"]([^'"]+)['"]\s*\)/u,
  // Java, Kotlin, Scala, Groovy: `import a.b.C;`, `import static a.b.C.d;`
  /^\s*import\s+(?:static\s+)?([\w.]+)/u,
  // Python: `import a.b as c`, reached only when no structured form matched
  /^\s*import\s+([A-Za-z_][\w.]*)/u,
  // C#: `using A.B;`
  /^\s*using\s+([\w.]+)\s*;/u,
  // Rust: `use a::b::c;`
  /^\s*use\s+([\w:]+)/u,
  // C, C++: `#include <a/b.h>`
  /^\s*#\s*include\s+[<"]([^>"]+)[>"]/u,
  // Go: `import "a/b/c"` and the single-line form with an alias
  /^\s*import\s+(?:\w+\s+)?"([\w./-]+)"/u,
];

/** One file-level document: its path, its imports, and the terms of the two together. */
export interface PathDocument extends LexicalDocument {
  /** How many import statements the head held. **Published, because a zero here is a miss rather than a ranking.** */
  readonly importLines: number;
}

/** Everything the fallback's ranking needs, built once per instance. */
export interface PathImportsIndex {
  readonly documents: readonly PathDocument[];
  readonly documentFrequency: ReadonlyMap<string, number>;
  readonly averageLength: number;
  /** Files whose head could not be read. **Not the same fact as a file with no imports.** */
  readonly unreadableFiles: number;
  /** Total import statements across the index. **The figure that says whether the extraction works at all.** */
  readonly importLines: number;
}

/**
 * The import statements in a file's head, as the module or symbol each one names.
 *
 * **Blank lines and comments are skipped for free**: no pattern matches them, so the scanner needs no notion of either.
 * A line is tested against the patterns in order and the first match wins, which is what keeps `import a.b.C;` from also
 * matching the Python `import a.b` form and counting the same statement twice.
 */
export function extractImports(head: string): string[] {
  const found: string[] = [];
  for (const line of head.split('\n')) {
    for (const pattern of IMPORT_PATTERNS) {
      const match = pattern.exec(line);
      if (match === null) continue;
      // **Every pattern above has exactly one capturing group and none of them can capture nothing**: the asserts
      // `"..."` and the qualified names `[\w.]` both require at least one character, so `import ''` - a line that does
      // occur in generated code - matches no pattern at all and is dropped by the loop rather than by a check here. The
      // assertion states the group's presence instead of guarding a case the patterns cannot produce, and the test that
      // pins it is the one that feeds `import ''` in and expects nothing.
      found.push(match[1] as string);
      break;
    }
  }
  return found;
}

/**
 * The document the fallback ranks: **the path, then the imports.**
 *
 * **The path comes first and is not repeated.** A file's own name is the single strongest feature this task has - an
 * issue that mentions `RetryPolicy` is usually about the file called `RetryPolicy` - and it is worth exactly the same
 * as one occurrence of the term in the document, which is what BM25's saturation then decides the value of. Repeating
 * it, or weighting it, would be a parameter chosen on the corpus being measured, and this module has no parameters.
 */
export function pathDocument(path: string, imports: readonly string[]): PathDocument {
  return {
    path,
    tokens: tokenize(`${path} ${imports.join(' ')}`),
    importLines: imports.length,
  };
}

/** Options for {@link buildPathImportsIndex}. **Stated at the call site so the artefact can print them.** */
export interface PathImportsOptions {
  /** Bytes read from the head of each file. */
  readonly headBytes?: number;
}

/**
 * Index an answer space as paths and imports.
 *
 * **No document cap, and its absence is the point.** The control caps at four thousand documents because it holds every
 * document's term counts as a map; this one holds a token array per file and can index the twenty-thousand-file checkout
 * the analyser refused, which is the entire reason it exists. What bounds it is the answer space itself.
 *
 * **The answer space, not the checkout** - the same set the published baselines rank, so the two figures are about the
 * same question.
 */
export function buildPathImportsIndex(
  checkout: string,
  files: readonly string[],
  options: PathImportsOptions = {},
): PathImportsIndex {
  const headBytes = options.headBytes ?? IMPORT_HEAD_BYTES;
  const documents: PathDocument[] = [];
  let unreadableFiles = 0;
  let importLines = 0;

  for (const path of files) {
    const head = readHead(join(checkout, path), headBytes);
    // **A file that cannot be read still ranks on its path.** Its imports are unknown rather than absent, and dropping
    // it from the answer space would quietly shrink the universe the ranking is measured over.
    const imports = head === null ? [] : extractImports(head);
    if (head === null) unreadableFiles += 1;
    importLines += imports.length;
    documents.push(pathDocument(path, imports));
  }

  return {
    documents,
    documentFrequency: documentFrequencies(documents),
    averageLength: averageLengthOf(documents),
    unreadableFiles,
    importLines,
  };
}

/** One fallback ranking: the paths, and what the index was. */
export interface PathImportsResult {
  /** The ranked paths, deepest first. */
  readonly ranked: readonly string[];
  /** How many documents the index held. **The universe this ranking is a ranking of.** */
  readonly documents: number;
  readonly unreadableFiles: number;
  readonly importLines: number;
}

/**
 * Rank an answer space by path and imports.
 *
 * **The same scorer as the control** - `rankBm25Documents` is `lexical.ts`, so the weighting, the smoothed inverse
 * document frequency, the drop-the-zeros rule and the path tie-break are the control's. The only thing this function
 * decides is which text a document is.
 */
export function rankByPathImports(
  index: PathImportsIndex,
  query: string,
  limit: number,
): PathImportsResult {
  return {
    ranked: rankBm25Documents(
      index.documents,
      index.documentFrequency,
      index.averageLength,
      query,
      limit,
    ),
    documents: index.documents.length,
    unreadableFiles: index.unreadableFiles,
    importLines: index.importLines,
  };
}

/** Path and imports of one checkout, ranked against one question. **The one-call form the harness and the CLI use.** */
export function pathImportsRanking(input: {
  readonly checkout: string;
  readonly files: readonly string[];
  readonly query: string;
  readonly limit: number;
  readonly options?: PathImportsOptions;
}): PathImportsResult {
  return rankByPathImports(
    buildPathImportsIndex(input.checkout, input.files, input.options ?? {}),
    input.query,
    input.limit,
  );
}
