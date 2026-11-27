/**
 * **A name is something a diff writes in code, not something a sentence happens to spell.**
 *
 * §166's adjacency was measured on the identifiers of the golden's own sentence, filtered by how rare they are on the
 * board, and §168.8 found the quantity that rule was actually measuring: of the twenty-seven plan entries, only four name
 * the symbol the plan's first entry points at, while **twenty-one name a word that happens to be in the golden's
 * sentence** - `Potential`, `Calling`, `Accessing`, `Using`, `particularly`, `floor`, `ceil`. A bag of words has no
 * reason to be a bag of code names, and the prize those entries priced was a prize on shared vocabulary.
 *
 * **So the set is rebuilt from the change itself.** A golden is about code the pull request touched, so the names that
 * can connect a golden to a comment are the identifiers **the pull request's own added lines** write. That set is free -
 * the diff is already being fetched to review the pull request - and it is a fact about the change rather than a
 * judgement about the sentence.
 *
 * **Two exclusions, and both are refusals to call a token a name:**
 *
 * - **A keyword is not a name.** `await`, `async`, `const`, `return` are in every diff and in every English sentence
 *   about a diff; a set that admitted them would re-import the bag of words through the front door.
 * - **A comment is not code.** The added side of a diff carries prose as often as it carries statements
 *   (`// This is particularly important`), so each added line is stripped of its comments **before** its identifiers are
 *   read. Strings are deliberately *not* stripped: an identifier inside a string literal is still a name the file writes,
 *   and the quotation `"calendarType"` is the same name as the variable.
 *
 * **`https://` is not a line comment**, which is the one lexer rule worth stating out loud: the colon before the slashes
 * is the only thing that distinguishes a URL from a comment, and a stripper that got it wrong would silently drop every
 * identifier on a line that happened to contain a link.
 *
 * **It is a lexer, not a parser**, for the reason `diff-side-lines.mjs` gives: a unified diff guarantees the line
 * prefixes and nothing else, and a stripper that needed a grammar would fail on the files whose grammar is unknown to it.
 */

import { sideLinesByPath } from './diff-side-lines.mjs';
import { identifiersOf } from './symbol-anatomy.mjs';

/**
 * **The tokens that are syntax rather than names**, across the ten languages this repository reads first.
 *
 * Case-sensitive on purpose: `string` is a keyword and `String` is a type a comment may legitimately name, so a table
 * lowercased for convenience would refuse a name that a reviewer would accept. The capitalised entries are the built-in
 * *shapes* - `Promise`, `Array`, `Long` - which carry no claim about any change and are therefore syntax in the only
 * sense this set cares about.
 */
export const KEYWORDS = new Set([
  // JavaScript and TypeScript
  'abstract',
  'any',
  'arguments',
  'as',
  'async',
  'await',
  'bigint',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'constructor',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'namespace',
  'never',
  'new',
  'null',
  'number',
  'object',
  'of',
  'package',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'set',
  'static',
  'string',
  'super',
  'switch',
  'symbol',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'unknown',
  'var',
  'void',
  'while',
  'with',
  'yield',
  // Python
  'and',
  'assert',
  'def',
  'del',
  'elif',
  'except',
  'global',
  'is',
  'lambda',
  'none',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'self',
  'true',
  'false',
  // Java, Kotlin and Groovy
  'byte',
  'char',
  'double',
  'final',
  'float',
  'int',
  'long',
  'native',
  'short',
  'synchronized',
  'throws',
  'transient',
  'volatile',
  'fun',
  'val',
  'data',
  'sealed',
  'companion',
  'override',
  'open',
  'internal',
  'lateinit',
  'suspend',
  'init',
  'it',
  'traits',
  'when',
  // Swift
  'func',
  'guard',
  'defer',
  'repeat',
  'struct',
  'protocol',
  'extension',
  'where',
  'inout',
  'some',
  'mutating',
  'lazy',
  'weak',
  'unowned',
  'indirect',
  'associatedtype',
  'subscript',
  'rethrows',
  'nil',
  // Go, Rust and C#
  'chan',
  'go',
  'map',
  'range',
  'select',
  'impl',
  'fn',
  'mut',
  'pub',
  'use',
  'crate',
  'mod',
  'match',
  'loop',
  'unsafe',
  'trait',
  'dyn',
  'ref',
  'move',
  'using',
  'foreach',
  'params',
  'out',
  'virtual',
  'partial',
  'record',
  'decimal',
  'bool',
  // The built-in shapes, which name no change
  'Promise',
  'String',
  'Number',
  'Boolean',
  'Object',
  'Array',
  'Map',
  'Set',
  'List',
  'Dict',
  'Tuple',
  'Optional',
  'Any',
  'Void',
  'Integer',
  'Long',
  'Double',
  'Float',
  'Character',
  'Byte',
  'Short',
  'UInt',
  'Int',
]);

/** The comment syntax a path's language uses, as the one property the stripper needs. */
const HASH = new Set([
  'py',
  'pyi',
  'rb',
  'yaml',
  'yml',
  'toml',
  'sh',
  'bash',
  'zsh',
  'r',
  'pl',
  'ex',
  'exs',
  'conf',
  'ini',
  'dockerfile',
  'makefile',
  'mk',
  'gitignore',
  'env',
  'properties',
  'gradle',
]);
const DASH = new Set(['sql', 'lua', 'hs', 'elm']);
const MARKUP = new Set(['xml', 'html', 'htm', 'vue', 'svelte', 'md', 'xhtml', 'svg']);

/**
 * **Which family a path belongs to, from its extension and not from its content.**
 *
 * A file with no extension is a `Dockerfile`, a `Makefile` or a `Jenkinsfile`, and three of those four are hash-commented
 * - so the default for an unknown name is `c` only when an extension exists, and `hash` when it does not.
 */
export function commentFamily(path) {
  const raw = String(path ?? '');
  const base = raw.slice(raw.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'hash';
  const extension = base.slice(dot + 1);
  if (HASH.has(extension)) return 'hash';
  if (DASH.has(extension)) return 'dash';
  if (MARKUP.has(extension)) return 'markup';
  return 'c';
}

/** A mutable flag the caller carries from line to line, because a block comment crosses them. */
const freshState = () => ({ block: false });

function stripMarkup(text, state) {
  let out = '';
  let rest = text;
  for (;;) {
    if (state.block) {
      const end = rest.indexOf('-->');
      if (end === -1) return out;
      rest = rest.slice(end + 3);
      state.block = false;
      continue;
    }
    const start = rest.indexOf('<!--');
    if (start === -1) return out + rest;
    out += rest.slice(0, start);
    rest = rest.slice(start + 4);
    state.block = true;
  }
}

/**
 * **The one lexer rule worth defending**: a `//` preceded by a colon is a URL, not the start of a comment.
 *
 * The colon is the whole test. `https://` and `file://` are the two shapes that occur in code, and both put a colon
 * immediately before the slashes - so the run is kept, scanning resumes after it, and a line that contains a link keeps
 * the identifiers on both sides of it.
 */
function stripCStyle(text, state) {
  let out = '';
  let at = 0;
  while (at < text.length) {
    if (state.block) {
      const end = text.indexOf('*/', at);
      if (end === -1) return out;
      at = end + 2;
      state.block = false;
      continue;
    }
    const line = text.indexOf('//', at);
    const block = text.indexOf('/*', at);
    const candidates = [line, block].filter((index) => index !== -1);
    if (candidates.length === 0) return out + text.slice(at);
    const cut = Math.min(...candidates);
    if (cut === line && cut > 0 && text[cut - 1] === ':') {
      out += text.slice(at, cut + 2);
      at = cut + 2;
      continue;
    }
    out += text.slice(at, cut);
    if (cut === block) {
      state.block = true;
      at = cut + 2;
      continue;
    }
    return out;
  }
  return out;
}

/**
 * **One added line with its comments removed**, and the block state carried forward.
 *
 * Exported because the exclusion is a claim that has to be testable on its own: a stripper asserted only through
 * `codeNamesOf` is asserted by a diff somebody wrote to pass, and the URL rule in particular is invisible in one.
 */
export function stripComments(text, path, state = freshState()) {
  const family = commentFamily(path);
  const raw = String(text ?? '');
  if (family === 'markup') return stripMarkup(raw, state);
  if (family === 'hash') {
    const at = raw.indexOf('#');
    return at === -1 ? raw : raw.slice(0, at);
  }
  if (family === 'dash') {
    const at = raw.indexOf('--');
    return at === -1 ? raw : raw.slice(0, at);
  }
  return stripCStyle(raw, state);
}

/**
 * **The names a diff writes**, which is the set a golden has to be adjacent to before any comment can be said to name it.
 *
 * Added lines only. A removed line is code the reader cannot see at head - the rule `diff-side-lines.mjs` states for
 * quotation and the same rule here: a name that only ever existed on the deleted side cannot be the thing a comment on
 * the pull request points a reader at.
 *
 * The result is sorted so that a record built from it is stable, because a record whose array order depends on the order
 * files happen to appear in a diff is a record no gate can compare.
 */
export function codeNamesOf(diff) {
  const names = new Set();
  for (const [path, file] of sideLinesByPath(String(diff ?? ''))) {
    const state = freshState();
    for (const line of file.added) {
      for (const token of identifiersOf(stripComments(line.text, path, state))) {
        if (!KEYWORDS.has(token)) names.add(token);
      }
    }
  }
  return [...names].sort();
}
