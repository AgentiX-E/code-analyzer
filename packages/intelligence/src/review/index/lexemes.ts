// @code-analyzer/intelligence — the words a declaration is spelled with, in the five languages the corpus writes
//
// **Nothing here decides what a declaration is**; that is each scanner's question, because Go's `func`, C's
// `int name(args) {` and Python's indentation are three different answers to it. What they share is the arithmetic a
// lexer does on a line of code once the comments and string bodies are blanked out: read a word, skip a space, find the
// identifier that a `(` or a `;` is about. **Kept in one place so that five scanners cannot disagree about what an
// identifier is.**

/** One word of code: where it starts, where it stops, and what it says. */
export interface Word {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Whether a character can be part of an identifier, in every language the corpus is written in. */
function isWordChar(character: string): boolean {
  return /[\w$@]/u.test(character);
}

/**
 * **The words of a line of code, in order**, where a quoted body has already been blanked by the caller's lexer and so
 * contributes no word. `$` is a word character because PHP's variables are spelled with one, and `@` because a C#
 * attribute is - **a scanner that dropped them would read `@Override` as `Override`, which is a name that is not in the
 * file.**
 */
export function words(line: string): Word[] {
  const out: Word[] = [];
  let at = 0;
  while (at < line.length) {
    if (!isWordChar(line[at]!)) {
      at += 1;
      continue;
    }
    const start = at;
    while (at < line.length && isWordChar(line[at]!)) at += 1;
    out.push({ text: line.slice(start, at), start, end: at });
  }
  return out;
}

/** The identifier a string starts with, and the rest of it once that identifier is taken. */
export function takeIdentifier(text: string): { name: string; rest: string } {
  const match = /^[$@\w]+/u.exec(text);
  if (match === null) return { name: '', rest: text };
  return { name: match[0], rest: text.slice(match[0].length) };
}

/**
 * **The signature of a declaration: its first line up to the one that opens its body.**
 *
 * A signature is what a prompt can afford where a body cannot, so it stops at the first line that opens a block, ends
 * a statement, or closes one - and it is joined and squeezed, because a declaration that wrapped is one sentence in the
 * file and must be one sentence in the prompt. **The three terminators are the ones `symbols.ts` shipped with**, because
 * a signature that changed shape for one language would be a diff in every prompt that carried it.
 */
export function signatureOf(lines: readonly string[], start: number, limit: number): string {
  const collected: string[] = [];
  for (let at = start; at <= limit && at < lines.length; at += 1) {
    const text = lines[at]!.trim();
    collected.push(text);
    if (text.includes('{') || text.endsWith(';') || text.endsWith('}')) break;
  }
  return collected.join(' ').replace(/\s+/gu, ' ').trim();
}

/**
 * **How deep a line is indented, in spaces, with a tab counted as four.**
 *
 * Python is the one language here whose blocks are indentation, and **a tab is four spaces because that is what
 * `python3 -tt` refuses and what every reader sees**: a scanner that counted a tab as one would end a block early on a
 * file that mixes the two, which is the failure direction this package forbids everywhere else.
 */
export function indentOf(line: string): number {
  let width = 0;
  for (const character of line) {
    if (character === ' ') width += 1;
    else if (character === '\t') width += 4;
    else break;
  }
  return width;
}

/**
 * **Whether a name is exported in Go**, which is decided by its first letter and by nothing else.
 *
 * `\p{Lu}` rather than `/^[A-Z]/` because Go's rule is Unicode's uppercase category, and a scanner that read `Écrire`
 * as unexported would be reporting a fact the compiler disagrees with.
 */
export function isGoExported(name: string): boolean {
  return /^\p{Lu}/u.test(name);
}

/**
 * **The identifier a `(` or a `;` is about, given the words of a line.**
 *
 * C, C++, C# and PHP all put the name *before* the thing that makes the line a declaration, and none of them put it
 * first: `public static int Claim(string id) {` has four words ahead of the name. **Reading the word immediately before
 * the last `(` is what all four have in common** - and the caller rejects the line when that word is a keyword, which
 * is what stops `if (x) {` from becoming a function called `if`.
 */
export function wordBefore(
  words: readonly Word[],
  punctuation: string,
  line: string,
): Word | undefined {
  const at = lastIndexOf(line, punctuation);
  if (at < 0) return undefined;
  return wordEndingAt(words, at);
}

/** The last index of a character in a line, or `-1`. */
function lastIndexOf(line: string, character: string): number {
  for (let index = line.length - 1; index >= 0; index -= 1) {
    if (line[index] === character) return index;
  }
  return -1;
}

/** The word that ends immediately before a position, or undefined when no word does. */
export function wordEndingAt(words: readonly Word[], at: number): Word | undefined {
  let found: Word | undefined;
  for (const word of words) {
    if (word.end <= at) found = word;
  }
  return found;
}

/**
 * **The word a declaration's argument list is about, as an index into the line's words, or `-1`.**
 *
 * The last `(` is the wrong one in both directions, and the corpus has a case of each: `Get(id string) (*Entry, error)`
 * has a *second* paren for its result list, and `void (*callback)(void);` has its first paren after a space. **The
 * argument list is the first paren whose preceding character is part of a word**, which is true of `Get(`,
 * `Claim(string id)` and `claim($id)` and false of `(id string)`, `(*callback)` and `if (x)`.
 *
 * **The answer is an index rather than a position, and that is the whole point of the signature.** Asking for the
 * column and then looking up the word that ends there left a lookup that could not fail and a branch no input could
 * take - the shape of dead code this package refuses to keep. A word is followed by `(` exactly when the character
 * after it is `(`, so the question is answered while walking the words and never needs a second question.
 */
export function declaringWord(words: readonly Word[], line: string): number {
  for (let index = 0; index < words.length; index += 1) {
    if (line[words[index]!.end] === '(') return index;
  }
  return -1;
}
