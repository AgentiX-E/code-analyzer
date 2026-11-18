// @code-analyzer/intelligence — seven languages, because the corpus writes them and the lexer did not
//
// **The number that forced this file, and it is a count of paths rather than an opinion.** On the 311 findings the
// `m-off` artifact scored, 91 stand in `.go`, 50 in `.c`, 38 in `.py`, 32 in `.ts`, 22 in `.js`, 11 in `.h`, 10 in
// `.php`, 8 in `.cpp`, 6 in `.tsx` and 4 in `.cs`. `symbols.ts` read `function`, `class`, `interface` and `const` -
// **TypeScript's spellings** - so `func Claim(` was not a declaration, `int claim(int x) {` was not a declaration, and
// `def claim(self, id):` was not a declaration. **Eighty-one per cent of the corpus's findings stood in a file whose
// declarations the index could not name, and `selectIndexedContext` answered them with three raw lines**: the window it
// was built to replace, wearing the index's clothes.
//
// **What each scanner claims, and what none of them will.** A name, the lines it occupies, whether the file offers it
// to another file, and which declarations sit inside it. Each of the four is checkable by opening the file, which is
// the property `aoci-code`'s `s-field-discipline` requires of anything derived rather than written: **structure may be
// computed and meaning may not**, so there is still no field here that says what a symbol is for.
//
// **`exported` means what the language means by it, and the seven answers are different questions.** Go: the name's
// first letter. Python: not a leading underscore. C: not `static`. C# and Java: the `public` modifier. PHP: `public`, or
// no modifier at all. **Ruby: nothing, because Ruby has no file-private top-level definition** - so its answer is that
// every top-level declaration is reachable, which is true rather than borrowed. **A scanner that answered all seven with
// TypeScript's `export` keyword would report every Go function as private**, which is a fact about the scanner and not
// about the file.
//
// **The failure direction is unchanged from `symbols.ts`.** A declaration whose body the scanner cannot close runs to
// the end of the file and the index is marked `uncertain`, because **a symbol that ends early hides the guard that
// would have refuted a claim** - and a scanner that guessed would be inventing the very fact it was asked to establish.
// **Ruby is where that direction costs the most to keep**: it ends a block with a keyword rather than a brace, so its
// scanner counts `end`s, strips the heredoc bodies and `=begin` blocks that would fake one, treats a modifier `if` as
// no opener at all, and accepts a balance only on a line indented like the declaration.

import {
  declaringWord,
  indentOf,
  isGoExported,
  signatureOf,
  takeIdentifier,
  wordBefore,
  words,
} from './lexemes.js';

import type { Word } from './lexemes.js';
import type { DeclaredSymbol, MemberSymbol, SymbolKind } from './symbols.js';

/**
 * **One file, lexed once, as the raw material every scanner works from.**
 *
 * The comments and string bodies are already blanked in `codes` and the depth of every line is already computed, so
 * each scanner adds only the one thing its language does differently: which word makes a line a declaration. **The
 * blanking is shared rather than repeated** because four copies of "a brace inside a string is not a brace" is four
 * chances for one of them to be wrong in a way that only shows up on a file nobody tested.
 */
export interface PreparedFile {
  readonly path: string;
  readonly lines: readonly string[];
  readonly codes: readonly string[];
  readonly depthAtStart: readonly number[];
  readonly depthAtEnd: readonly number[];
  /** The last line a declaration that starts at `start` occupies, 0-based; marks the file uncertain on EOF. */
  readonly endOf: (start: number) => number;
  /**
   * **A scanner's only way to say it could not close a block.** The brace languages answer that question with `endOf`,
   * which runs to the file's last line and marks the index uncertain - **Ruby ends a block with a keyword instead**, so
   * its scanner has to be able to say the same thing without pretending it found a brace.
   */
  readonly markUncertain: () => void;
}

/** What one scanner produces: the declarations, and the names the file offers. */
export interface ScannedDeclarations {
  readonly symbols: DeclaredSymbol[];
  readonly exported: string[];
}

/** The names a member reader must not mistake for a callee, in the four languages that put a type before a name. */
const NOT_A_CALLEE = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'sizeof',
  'do',
  'else',
  'case',
  'new',
  'foreach',
  'using',
  'lock',
  'fixed',
  'typeof',
  'nameof',
  'static',
  'defined',
  'isset',
  'unset',
  'empty',
  'function',
  'print',
  'echo',
]);

/** A member read from one line of a body, before it is given its lines. */
interface MemberRead {
  readonly name: string;
  readonly kind: MemberSymbol['kind'];
}

/**
 * **The member a line declares, by the punctuation that ends it.**
 *
 * Three shapes, and the order they are tried in is the order of how much they say: a `(` makes it a method and the name
 * is the word before that paren; a `;` or a `{` makes it a field and the name is the word before it; anything else is
 * not a declaration. **A line whose last word before the punctuation is a keyword is not a member** - that is what stops
 * `return x;` from declaring a field called `x` and `if (x) {` from declaring a method called `if`.
 *
 * **And an initialiser outranks a call, which is the defect this line was written to fix.** `private final Map<String,
 * Entry> byId = load();` declares `byId` in four of these languages, and a reader that looked for a `(` first answered
 * `load` - a name that is in the file and is not the member's. **The comparison is between positions rather than
 * between marks**: whichever of `=` and `(` comes first is the one the line is about.
 */
function memberFrom(code: string): MemberRead | null {
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === '}' || trimmed === '{' || trimmed === '};') return null;
  // A visibility label (`public:` in C++, `private:` in C#) declares nothing.
  if (trimmed.endsWith(':')) return null;
  // **An annotation declares nothing**, and `@SuppressWarnings("unchecked")` would otherwise be read as a method named
  // after the annotation - `@Override` is the shape that shows up on the line before every overridden method in Java.
  if (trimmed.startsWith('@') || trimmed.startsWith('[')) return null;
  // **A type declared between other declarations is a declaration and not a member of the one around it.** Java's inner
  // classes and C#'s nested ones stand at the same depth as the fields beside them; a reader that claimed them would
  // report `Inner` as a property of `Outer`.
  if (TYPE_HEAD.test(trimmed)) return null;
  const lineWords = words(trimmed);
  if (lineWords.length === 0) return null;

  const callee = declaringWord(lineWords, trimmed);
  const eq = trimmed.indexOf('=');
  const paren = trimmed.indexOf('(');
  // **An initialiser outranks a call.** `private final Map<String, Entry> byId = new ConcurrentHashMap<>();` declares
  // `byId` in four of these languages: the `(` inside the initialiser is preceded by `>`, so no identifier touches it
  // and a reader looking for a callee first would answer with the *type's* last word. Whichever of `=` and `(` comes
  // first is what the line is about.
  if (eq >= 0 && (paren < 0 || eq < paren)) {
    return nameFrom(wordBefore(lineWords, '=', trimmed), 'property');
  }
  if (callee >= 0) return nameFrom(lineWords[callee], 'method');
  // **A paren no identifier touches names nothing this reader can claim**, and the shape is C's function-pointer field:
  // `int (*run)(int);` declares `run` inside the parens, which is a different reading from the one this line does. **It
  // is answered with nothing rather than with `int`**, the type that sits where the name would.
  if (paren >= 0) return null;
  // **An initialiser decides the name before the semicolon does**: `static int MAX = 5;` declares `MAX`, and the word
  // before its `;` is `5`. The order is the order of how much the punctuation says, and `''` is a line none of the
  // three ends - a `using Base::foo` alias, which declares no field.
  const terminator = ['=', ';', '{'].find((candidate) => trimmed.includes(candidate)) ?? '';
  if (terminator === '') return null;
  return nameFrom(wordBefore(lineWords, terminator, trimmed), 'property');
}

/**
 * **The member a word names, or `null` when the word is one of the keywords that only looks like a name.**
 *
 * One guard rather than three, and the reason is the only branch here that a real file reaches: **`static {` opens a
 * static initialiser in Java and C#, and the word before its brace is `static`** - a member called `static` is the
 * failure, and it is the failure this single check catches for all three shapes the reader tries.
 */
function nameFrom(word: Word | undefined, kind: MemberRead['kind']): MemberRead | null {
  if (word === undefined || NOT_A_CALLEE.has(word.text)) return null;
  return { name: stripSigil(word.text), kind };
}

/**
 * **A line whose first meaningful word is a type keyword**, in the four languages that declare a type inside a type.
 *
 * The modifiers ahead of the keyword are consumed rather than listed exhaustively, because a modifier this table has not
 * heard of must not turn `sealed class Inner` into a property called `Inner`.
 */
const TYPE_HEAD =
  /^(?:(?:public|private|protected|internal|static|abstract|final|sealed|non-sealed|partial|readonly|file|unsafe|new|data|open|inner|async|extern)\s+)*(?:class|interface|enum|struct|record|trait|@interface)\s+[A-Za-z_$]/u;

/** A member's name without the sigil its language spells it with, because `$name` and `name` are one field. */
function stripSigil(name: string): string {
  return name.startsWith('$') ? name.slice(1) : name;
}

/** A declaration's members, read from the lines whose depth is one deeper than the declaration's own. */
function membersAtDepth(
  file: PreparedFile,
  from: number,
  to: number,
  depth: number,
  parent: string,
): MemberSymbol[] {
  const members: MemberSymbol[] = [];
  for (let at = from; at < to; at += 1) {
    if (file.depthAtStart[at] !== depth) continue;
    const read = memberFrom(file.codes[at]!);
    if (read === null) continue;
    const end = file.endOf(at);
    // **Java, C# and Ruby spell the constructor as a method named after the class or after `initialize`**, which is the
    // same fact the `constructor` keyword states - and a field may legally carry the class's own name in Java, so the
    // name alone decides only when the line was read as a method.
    const isConstructor =
      isConstructorName(read.name) || (read.kind === 'method' && read.name === parent);
    members.push({
      // **A constructor is named after its class**, for the reason the TypeScript scanner gives: `constructor` is a
      // keyword rather than an identifier, and a prompt that says "inside constructor" says less than one that says
      // "inside Worker".
      name: isConstructor ? parent : read.name,
      kind: isConstructor ? 'constructor' : read.kind,
      startLine: at + 1,
      endLine: end + 1,
      signature: signatureOf(file.lines, at, end),
    });
  }
  return members;
}

/** Whether a member name is its language's name for a constructor, which the corpus spells four ways. */
function isConstructorName(name: string): boolean {
  return (
    name === 'constructor' ||
    name === '__init__' ||
    name === '__new__' ||
    name === '__construct' ||
    name === 'initialize'
  );
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

/** `func Claim(`, `func (w *Worker) claim(`, `type Entry struct {`, `const LIMIT = 3`. */
function goDeclaration(code: string): { name: string; kind: SymbolKind; members: boolean } | null {
  if (code.startsWith('func')) {
    let rest = code.slice(4).trimStart();
    // **A receiver is not the name.** `func (s *Entry) touch()` declares `touch` and not `s`, and the parenthesised
    // group is skipped by matching its closing paren rather than by a pattern, because a generic receiver has brackets
    // inside it.
    if (rest.startsWith('(')) {
      let depth = 0;
      let at = 0;
      for (; at < rest.length; at += 1) {
        if (rest[at] === '(') depth += 1;
        else if (rest[at] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      rest = rest.slice(at + 1).trimStart();
    }
    const taken = takeIdentifier(rest);
    if (taken.name === '') return null;
    return { name: taken.name, kind: 'function', members: false };
  }
  if (code.startsWith('type')) {
    const taken = takeIdentifier(code.slice(4).trimStart());
    if (taken.name === '' || taken.name === '(') return null;
    const tail = taken.rest.trimStart();
    // A generic type parameter list sits between the name and the keyword that says what the type is.
    const afterGenerics = tail.startsWith('[')
      ? tail.slice(tail.indexOf(']') + 1).trimStart()
      : tail;
    const keyword = /^(\w+)/u.exec(afterGenerics)?.[1] ?? '';
    const kind: SymbolKind =
      keyword === 'struct' ? 'class' : keyword === 'interface' ? 'interface' : 'type';
    return { name: taken.name, kind, members: kind !== 'type' };
  }
  if (code.startsWith('const') || code.startsWith('var')) {
    const taken = takeIdentifier(code.slice(code.startsWith('const') ? 5 : 3).trimStart());
    // `const (` opens a group, and the names inside it are at depth one - a line this scanner does not claim.
    if (taken.name === '' || taken.name === '(') return null;
    return { name: taken.name, kind: 'const', members: false };
  }
  return null;
}

/** Whether a Go `func` line carries a receiver, which is the one thing that separates a method from a function. */
function goHasReceiver(code: string): boolean {
  return /^func\s*\(/u.test(code);
}

/** **Go, read as declarations.** */
export function scanGo(file: PreparedFile): ScannedDeclarations {
  const symbols: DeclaredSymbol[] = [];
  const exported: string[] = [];
  for (let at = 0; at < file.lines.length; at += 1) {
    if (file.depthAtStart[at] !== 0) continue;
    const read = goDeclaration(file.codes[at]!.trim());
    if (read === null) continue;
    const end = file.endOf(at);
    const kind: SymbolKind =
      read.kind === 'function' && goHasReceiver(file.codes[at]!.trim()) ? 'method' : read.kind;
    const isExported = isGoExported(read.name);
    symbols.push({
      name: read.name,
      kind,
      startLine: at + 1,
      endLine: end + 1,
      exported: isExported,
      signature: signatureOf(file.lines, at, end),
      members: read.members ? goMembers(file, at + 1, end) : [],
    });
    if (isExported) exported.push(read.name);
  }
  return { symbols, exported };
}

/** The words that begin a Go declaration, which a struct or interface body never contains. */
const GO_DECLARATION_KEYWORD = /^(?:func|type|const|var)\b/u;

/** The fields of a struct or the methods of an interface, between two 0-based line indices. */
function goMembers(file: PreparedFile, from: number, to: number): MemberSymbol[] {
  const members: MemberSymbol[] = [];
  for (let at = from; at < to; at += 1) {
    if (file.depthAtStart[at] !== 1) continue;
    const code = file.codes[at]!.trim();
    if (code.length === 0) continue;
    // **A Go struct or interface body holds no `func`, `type`, `const` or `var`**, and the guard matters exactly when
    // the range is wrong: an unterminated struct runs to the end of the file, and the next top-level function would
    // otherwise be read as one of its methods. The declaration is not a member of anything here - it is a declaration.
    if (GO_DECLARATION_KEYWORD.test(code)) continue;
    // **What follows the first identifier decides what the line is.** An interface method puts `(` immediately after the
    // name (`Get(id string)`), and a function-typed field puts a type there (`onDone func(error)`) - so the two are told
    // apart by one character rather than by whether the line contains a paren, which both of them do.
    const head = takeIdentifier(code);
    if (head.rest.startsWith('(')) {
      members.push({
        name: head.name,
        kind: 'method',
        startLine: at + 1,
        endLine: at + 1,
        signature: code,
      });
      continue;
    }
    for (const name of goFieldNames(code)) {
      members.push({ name, kind: 'property', startLine: at + 1, endLine: at + 1, signature: code });
    }
  }
  return members;
}

/** The names a Go field line declares, in order; empty for an embedded field or a line that is not one. */
function goFieldNames(code: string): string[] {
  const names: string[] = [];
  let rest = code;
  for (;;) {
    const taken = takeIdentifier(rest);
    if (taken.name === '') return names;
    const after = taken.rest;
    if (after.startsWith(',')) {
      names.push(taken.name);
      rest = after.slice(1).trimStart();
      continue;
    }
    // A dot or a bracket where a space belongs is an embedded type or a generic one, and neither declares a field.
    if (after.length === 0 || after.startsWith('.') || after.startsWith('[')) return [];
    names.push(taken.name);
    return names;
  }
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

/** One Python declaration, before its members are attached. */
interface PythonDecl {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly start: number;
  readonly end: number;
  readonly indent: number;
}

/** **Python, read as declarations.** */
export function scanPython(file: PreparedFile): ScannedDeclarations {
  const declarations: PythonDecl[] = [];
  const exported: string[] = [];

  for (let at = 0; at < file.lines.length; at += 1) {
    const code = file.codes[at]!;
    const trimmed = code.trim();
    if (trimmed.length === 0) continue;
    const indent = indentOf(code);
    const def = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/u.exec(trimmed);
    const klass = /^class\s+([A-Za-z_]\w*)/u.exec(trimmed);
    const constant = indent === 0 ? /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/u.exec(trimmed) : null;
    let read: { name: string; kind: SymbolKind } | null = null;
    if (def !== null) read = { name: def[1]!, kind: 'function' };
    else if (klass !== null) read = { name: klass[1]!, kind: 'class' };
    else if (constant !== null) read = { name: constant[1]!, kind: 'const' };
    if (read === null) continue;

    const end = pythonBlockEnd(file, at, indent);
    declarations.push({ name: read.name, kind: read.kind, start: at, end, indent });
    if (!read.name.startsWith('_')) exported.push(read.name);
  }

  const symbols: DeclaredSymbol[] = declarations
    // **A method is a member and not a declaration of the file**, which is the difference between `symbols` and the
    // list this scanner builds: the same `def` has to be in both, and in `symbols` only once.
    .filter((declaration) => !enclosingClass(declarations, declaration))
    .map((declaration) => ({
      name: declaration.name,
      kind: declaration.kind,
      startLine: declaration.start + 1,
      endLine: declaration.end + 1,
      exported: !declaration.name.startsWith('_'),
      signature: signatureOf(file.lines, declaration.start, declaration.start),
      members: declaration.kind === 'class' ? pythonMembers(declarations, declaration, file) : [],
    }));
  return {
    symbols,
    exported: symbols.filter((symbol) => symbol.exported).map((symbol) => symbol.name),
  };
}

/** The innermost class a declaration is nested in, or undefined when it is not nested in one. */
function enclosingClass(
  declarations: readonly PythonDecl[],
  candidate: PythonDecl,
): PythonDecl | undefined {
  let found: PythonDecl | undefined;
  for (const other of declarations) {
    if (other.kind !== 'class' || other === candidate) continue;
    if (other.indent >= candidate.indent) continue;
    if (other.start >= candidate.start || other.end < candidate.end) continue;
    // **The innermost one wins**, and the last enclosing class in source order is the innermost one: a class that
    // encloses another starts before it. Comparing indents said the same thing and asked a question that never answers
    // `no` on a well-formed file.
    found = other;
  }
  return found;
}

/**
 * **The last line of a Python block, which is the last line indented deeper than its header.**
 *
 * A blank line does not end a block and a comment does not either - both are blanked to whitespace by the lexer, so the
 * scan walks past them and remembers the last line that was deeper. **A block whose body is empty ends on its own
 * header**, which is the only answer that cannot be wrong.
 */
function pythonBlockEnd(file: PreparedFile, start: number, indent: number): number {
  let end = start;
  for (let at = start + 1; at < file.lines.length; at += 1) {
    const code = file.codes[at]!;
    if (code.trim().length === 0) continue;
    if (indentOf(code) <= indent) break;
    end = at;
  }
  return end;
}

/** The methods a class holds: the declarations whose innermost enclosing class is this one. */
function pythonMembers(
  declarations: readonly PythonDecl[],
  parent: PythonDecl,
  file: PreparedFile,
): MemberSymbol[] {
  const members: MemberSymbol[] = [];
  for (const candidate of declarations) {
    if (candidate.kind !== 'function') continue;
    // **The nearest enclosing class owns the method**, so a method of a nested class is not a member of the outer one.
    if (enclosingClass(declarations, candidate) !== parent) continue;
    const isConstructor = isConstructorName(candidate.name);
    members.push({
      name: isConstructor ? parent.name : candidate.name,
      kind: isConstructor ? 'constructor' : 'method',
      startLine: candidate.start + 1,
      endLine: candidate.end + 1,
      signature: signatureOf(file.lines, candidate.start, candidate.start),
    });
  }
  return members;
}

// ---------------------------------------------------------------------------
// C and C++
// ---------------------------------------------------------------------------

/** **C and C++, read as declarations.** */
export function scanCFamily(file: PreparedFile): ScannedDeclarations {
  const symbols: DeclaredSymbol[] = [];
  const exported: string[] = [];
  // **A header is an export surface and a translation unit is not**, which is why the same `int claim(` is public in
  // `usb_ids.h` and private to the file in `hidapi.c` unless it says `static` either way. The rule is still `static`,
  // and the difference the header makes is that a non-static name there is offered to every file that includes it.
  for (let at = 0; at < file.lines.length; at += 1) {
    if (file.depthAtStart[at] !== 0) continue;
    const code = file.codes[at]!.trim();
    if (code.length === 0) continue;
    const aggregate = /^(?:typedef\s+)?(struct|union|class|enum)\s+([A-Za-z_]\w*)/u.exec(code);
    if (aggregate !== null && code.includes('{')) {
      const end = file.endOf(at);
      // **A type definition has no linkage**, so `static struct S {` is not a way to keep a type to one file and the
      // index does not pretend otherwise: an aggregate is offered by the file it is written in.
      symbols.push({
        name: aggregate[2]!,
        kind: aggregate[1] === 'enum' ? 'type' : 'class',
        startLine: at + 1,
        endLine: end + 1,
        exported: true,
        signature: signatureOf(file.lines, at, end),
        members: membersAtDepth(file, at + 1, end, 1, aggregate[2]!),
      });
      exported.push(aggregate[2]!);
      continue;
    }
    const read = cFunction(code, file, at);
    if (read === null) continue;
    const end = file.endOf(at);
    const isExported = !/\bstatic\b/u.test(code.slice(0, code.indexOf(read)));
    symbols.push({
      name: read,
      kind: 'function',
      startLine: at + 1,
      endLine: end + 1,
      exported: isExported,
      signature: signatureOf(file.lines, at, end),
      members: [],
    });
    if (isExported) exported.push(read);
  }
  return { symbols, exported };
}

/**
 * **The function a C line defines, or null.**
 *
 * A *definition* and not a *prototype*: the line has to open a body, either with its own `{` or with one on the next
 * line, because a prototype declares a name without the body a claim would be refuted against and **an index that
 * claimed a range for it would be claiming lines it does not have.** The name is the word before the argument list,
 * and a line whose word there is a keyword - `if (x) {` - is not a function.
 */
function cFunction(code: string, file: PreparedFile, at: number): string | null {
  if (code.startsWith('#') || code.startsWith('}') || code.includes('=')) return null;
  if (!code.includes('(')) return null;
  const opensHere = code.endsWith('{');
  const opensNext = code.endsWith(')') && (file.codes[at + 1] ?? '').trim().startsWith('{');
  if (!opensHere && !opensNext) return null;
  const lineWords = words(code);
  const index = declaringWord(lineWords, code);
  // **`declaringWord` already refuses every keyword**, because the four that open a body - `if`, `for`, `while`,
  // `switch` - are written with a space before their paren and so touch no word at all. The check that used to stand
  // here could not fail on any line C writes, and a branch no input takes is dead code rather than a safety net.
  return index < 0 ? null : lineWords[index]!.text;
}

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------

/** The modifiers a C# declaration may wear, which are consumed before the keyword that makes it a declaration. */
const CSHARP_MODIFIERS =
  /^(?:(?:public|private|protected|internal|static|abstract|sealed|partial|readonly|unsafe|new|file|async|extern)\s+)*/u;

/** Whether a declaration on `at` opens a body, on its own line or on the next one that carries code. */
function opensBody(file: PreparedFile, at: number, code: string): boolean {
  if (code.includes('{')) return true;
  let probe = at + 1;
  while (probe < file.codes.length && file.codes[probe]!.trim().length === 0) probe += 1;
  return probe < file.codes.length && file.codes[probe]!.trim().startsWith('{');
}

/** **C#, read as declarations.** */
export function scanCSharp(file: PreparedFile): ScannedDeclarations {
  const symbols: DeclaredSymbol[] = [];
  const exported: string[] = [];
  for (let at = 0; at < file.lines.length; at += 1) {
    // **A namespace puts every type one level in**, which is why this scanner reads depth one as well as depth zero:
    // a rule of "top level only" would find no declaration in any file that names its namespace with braces.
    const depth = file.depthAtStart[at]!;
    if (depth > 1) continue;
    const code = file.codes[at]!.trim();
    if (code.length === 0) continue;
    const rest = code.replace(CSHARP_MODIFIERS, '');
    const match = /^(class|interface|struct|enum|record|delegate)\s+([A-Za-z_]\w*)/u.exec(rest);
    if (match === null || !opensBody(file, at, code)) continue;
    const end = file.endOf(at);
    const isExported = /\bpublic\b/u.test(code);
    const kind: SymbolKind =
      match[1] === 'interface'
        ? 'interface'
        : match[1] === 'class' || match[1] === 'struct'
          ? 'class'
          : 'type';
    symbols.push({
      name: match[2]!,
      kind,
      startLine: at + 1,
      endLine: end + 1,
      exported: isExported,
      signature: signatureOf(file.lines, at, end),
      members: membersAtDepth(file, at + 1, end, depth + 1, match[2]!),
    });
    if (isExported) exported.push(match[2]!);
  }
  return { symbols, exported };
}

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

/** **PHP, read as declarations.** */
export function scanPhp(file: PreparedFile): ScannedDeclarations {
  const symbols: DeclaredSymbol[] = [];
  const exported: string[] = [];
  for (let at = 0; at < file.lines.length; at += 1) {
    const depth = file.depthAtStart[at]!;
    if (depth > 1) continue;
    const code = file.codes[at]!.trim();
    if (code.length === 0) continue;
    const klass =
      /^(?:(?:final|abstract|readonly)\s+)*(class|interface|trait)\s+([A-Za-z_]\w*)/u.exec(code);
    const fn =
      /^((?:public|private|protected|static|final|abstract)\s+)*function\s+([A-Za-z_]\w*)\s*\(/u.exec(
        code,
      );
    if (klass !== null) {
      const end = file.endOf(at);
      symbols.push({
        name: klass[2]!,
        kind: klass[1] === 'interface' ? 'interface' : 'class',
        startLine: at + 1,
        endLine: end + 1,
        exported: true,
        signature: signatureOf(file.lines, at, end),
        members: membersAtDepth(file, at + 1, end, 1, klass[2]!),
      });
      exported.push(klass[2]!);
      continue;
    }
    if (fn === null) continue;
    // **A method is a member and not an export**, so only a function declared outside a body is offered by the file -
    // and PHP has no private top-level function, which is why this one is offered unconditionally.
    if (depth !== 0) continue;
    const end = file.endOf(at);
    symbols.push({
      name: fn[2]!,
      kind: 'function',
      startLine: at + 1,
      endLine: end + 1,
      exported: true,
      signature: signatureOf(file.lines, at, end),
      members: [],
    });
    exported.push(fn[2]!);
  }
  return { symbols, exported };
}

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

/**
 * **What a Java type may wear ahead of its keyword, annotations included.**
 *
 * `@interface` is exempted from the annotation branch on purpose: it is the one annotation-shaped spelling that declares
 * a type rather than decorating one, and a prefix rule that ate it would find no declaration on the line that declares
 * an annotation type.
 */
const JAVA_PREFIX =
  /^(?:(?:@(?!interface\b)[\w.]+(?:\([^)]*\))?|public|protected|private|static|abstract|final|sealed|non-sealed|strictfp|default|native|synchronized|transient|volatile)\s+)*/u;

/** `class`, `interface`, `enum`, `record` and `@interface`, which are the five Java declares types with. */
const JAVA_TYPE = /^((?:@)?(?:class|interface|enum|record))\s+([A-Za-z_$][\w$]*)/u;

/** **Java, read as declarations.** */
export function scanJava(file: PreparedFile): ScannedDeclarations {
  const symbols: DeclaredSymbol[] = [];
  const exported: string[] = [];
  for (let at = 0; at < file.lines.length; at += 1) {
    // **A namespace puts nothing one level in**, unlike C#, so depth zero is where a Java file's types stand - and
    // depth one is where an inner class does, which is why both are read.
    const depth = file.depthAtStart[at]!;
    if (depth > 1) continue;
    const code = file.codes[at]!.trim();
    if (code.length === 0) continue;
    const match = JAVA_TYPE.exec(code.replace(JAVA_PREFIX, ''));
    if (match === null || !opensBody(file, at, code)) continue;
    const end = file.endOf(at);
    const keyword = match[1]!;
    const isExported = /\bpublic\b/u.test(code);
    const kind: SymbolKind = keyword.includes('interface')
      ? 'interface'
      : keyword === 'enum'
        ? 'type'
        : 'class';
    symbols.push({
      name: match[2]!,
      kind,
      startLine: at + 1,
      endLine: end + 1,
      exported: isExported,
      signature: signatureOf(file.lines, at, end),
      members: membersAtDepth(file, at + 1, end, depth + 1, match[2]!),
    });
    if (isExported) exported.push(match[2]!);
  }
  return { symbols, exported };
}

// ---------------------------------------------------------------------------
// Ruby
// ---------------------------------------------------------------------------

/** One line of Ruby once its comments and its heredoc bodies are gone, because neither can declare anything. */
interface RubyLine {
  readonly code: string;
  readonly indent: number;
}

/** The `<<~SQL` a line opens a heredoc with, and the terminator that closes it. */
const HEREDOC = /<<([~-]?)(['"`]?)([A-Za-z_]\w*)\2/u;

/** The two words that open a Ruby body, which are the two that can be named. */
const RUBY_TYPE = /^(class|module)\s+([A-Z][\w:]*)/u;

/** A method, including the singleton form the corpus writes as `def self.name`. */
const RUBY_DEF = /^def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/u;

/** The three accessor macros, whose arguments are the properties a class has. */
const RUBY_ATTR = /^attr_(?:reader|writer|accessor)\s+(.+)$/u;

/** A word that opens a block and therefore owes an `end`, when it is the first word of the line or follows an `=`. */
const RUBY_OPENS =
  /^(?:class|module|def|if|unless|while|until|case|begin|for)\b|=\s*(?:if|unless|case|begin|while|until)\b/u;

/** A `do` at the end of a line, with or without its block parameters. */
const RUBY_DO = /\bdo\s*(?:\|[^|]*\|)?$/u;

/** A line that closes the block it stands in. */
const RUBY_ENDS = /^end\b/u;

/** The line that ends a `=begin` block, which is a different word from the one that ends a block. */
const RUBY_EMBEDDED_END = /^=end\b/u;

/**
 * **A Ruby file with its comments and its heredoc bodies removed, and the depth of every line with them.**
 *
 * `#` is Ruby's comment marker and the lexer above knows only the three the other languages use, so it is cut here -
 * and it is safe to cut at the first one, because **a `#` inside a string was already blanked by the shared lexer and a
 * `#{}` interpolation was blanked with it.**
 *
 * The heredoc is the case that would otherwise truncate a method: `sql = <<~SQL` opens a body that may contain the word
 * `end` at the start of a line, and **a counter that read it would end the method three lines early, hiding the line the
 * guard stands on.** `=begin`/`=end` blocks are removed the same way, for the same reason.
 */
function rubyLines(file: PreparedFile): RubyLine[] {
  const out: RubyLine[] = [];
  let heredoc: string | null = null;
  let embedded = false;
  for (const code of file.codes) {
    const hash = code.indexOf('#');
    const cut = hash < 0 ? code : code.slice(0, hash);
    const trimmed = cut.trim();
    if (embedded) {
      if (RUBY_EMBEDDED_END.test(trimmed)) embedded = false;
      out.push({ code: '', indent: 0 });
      continue;
    }
    if (/^=begin\b/u.test(trimmed)) {
      embedded = true;
      out.push({ code: '', indent: 0 });
      continue;
    }
    if (heredoc !== null) {
      if (trimmed === heredoc) heredoc = null;
      out.push({ code: '', indent: 0 });
      continue;
    }
    out.push({ code: cut, indent: indentOf(cut) });
    heredoc = HEREDOC.exec(trimmed)?.[3] ?? null;
  }
  return out;
}

/**
 * **The last line of a Ruby block, found by counting the keywords that owe an `end`.**
 *
 * Ruby has no braces and no significant indentation to read, so the only provable answer is the balance of `end`s - and
 * the counting is deliberately asymmetric. **An opener is counted whenever it can open one**, including after an `=`,
 * because missing an opener would end the block early and a block that ends early hides the guard a claim is refuted
 * by. **A closer is counted only when it starts its line**, for the same reason in the other direction: a balance that
 * runs long sends the declaration to the end of the file and marks the index `uncertain`, which is a claim this package
 * is allowed to make and a truncated range is not.
 *
 * The indentation check is what stops a stray `end` from closing the wrong block: a balance of zero is accepted only on
 * a line indented like the declaration, and a file that never agrees runs to its last line instead.
 */
function rubyBlockEnd(
  lines: readonly RubyLine[],
  start: number,
  indent: number,
): { end: number; closed: boolean } {
  let balance = 1;
  for (let at = start + 1; at < lines.length; at += 1) {
    const { code, indent: ownIndent } = lines[at]!;
    const trimmed = code.trim();
    if (trimmed.length === 0) continue;
    if (RUBY_OPENS.test(trimmed) || RUBY_DO.test(trimmed)) balance += 1;
    if (RUBY_ENDS.test(trimmed)) balance -= 1;
    if (balance <= 0) {
      if (ownIndent === indent) return { end: at, closed: true };
      // **A balance below zero is an `end` this scan has no opener for**, and the block it closed is behind us: the rest
      // of the file is the only range that cannot be too short.
      balance = 0;
    }
  }
  return { end: Math.max(start, lines.length - 1), closed: false };
}

/** One Ruby declaration, before its members are attached. */
interface RubyDecl {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly start: number;
  readonly end: number;
  readonly indent: number;
}

/** **Ruby, read as declarations.** */
export function scanRuby(file: PreparedFile): ScannedDeclarations {
  const lines = rubyLines(file);
  const types: RubyDecl[] = [];
  const methods: RubyDecl[] = [];

  for (let at = 0; at < lines.length; at += 1) {
    const { code, indent } = lines[at]!;
    const trimmed = code.trim();
    if (trimmed.length === 0) continue;
    const type = RUBY_TYPE.exec(trimmed);
    const method = type === null ? RUBY_DEF.exec(trimmed) : null;
    if (type === null && method === null) continue;
    const name = type === null ? method![1]! : type[2]!;
    const block = rubyBlockEnd(lines, at, indent);
    if (!block.closed) file.markUncertain();
    const declaration: RubyDecl = {
      name,
      // **A module is a class's superclass in Ruby** - `Module` is what `Class` is an instance of - so the two are one
      // kind here rather than two kinds the reader has to keep apart.
      kind: type === null ? 'function' : 'class',
      start: at,
      end: block.end,
      indent,
    };
    (type === null ? methods : types).push(declaration);
  }

  const symbols: DeclaredSymbol[] = [
    ...types.map((declaration) => ({
      name: declaration.name,
      kind: declaration.kind,
      startLine: declaration.start + 1,
      endLine: declaration.end + 1,
      // **Ruby has no export keyword and no file-private definition**: a top-level class, module or `def` is reachable
      // from any file that requires this one, and a nested constant is reachable through its parent's name.
      exported: true,
      signature: signatureOf(file.lines, declaration.start, declaration.start),
      members: rubyMembers(file, lines, types, declaration),
    })),
    ...methods
      .filter((declaration) => enclosingType(types, declaration) === undefined)
      .map((declaration) => ({
        name: declaration.name,
        kind: declaration.kind,
        startLine: declaration.start + 1,
        endLine: declaration.end + 1,
        exported: true,
        signature: signatureOf(file.lines, declaration.start, declaration.start),
        members: [],
      })),
  ].sort((left, right) => left.startLine - right.startLine);

  return { symbols, exported: symbols.map((symbol) => symbol.name) };
}

/** The innermost type a declaration sits in, which is the one that owns its methods. */
function enclosingType(
  types: readonly RubyDecl[],
  candidate: { start: number; end: number; indent: number },
): RubyDecl | undefined {
  let found: RubyDecl | undefined;
  for (const type of types) {
    if (type.indent >= candidate.indent) continue;
    if (type.start >= candidate.start || type.end < candidate.end) continue;
    // **The last enclosing type in source order is the innermost one**, for the reason `enclosingClass` gives: Ruby nests
    // deeper than any language here, and `module Billing / class Charge / def claim` is three ranges over one line.
    found = type;
  }
  return found;
}

/** The methods and accessors a Ruby class or module holds, in source order. */
function rubyMembers(
  file: PreparedFile,
  lines: readonly RubyLine[],
  types: readonly RubyDecl[],
  parent: RubyDecl,
): MemberSymbol[] {
  const members: MemberSymbol[] = [];
  const owns = (candidate: { start: number; end: number; indent: number }): boolean =>
    enclosingType(types, candidate) === parent;
  for (let at = parent.start + 1; at <= parent.end; at += 1) {
    // **`at` is inside the parent's own range**, so the line exists: a fallback here would be a branch no file takes.
    const { code, indent } = lines[at]!;
    const trimmed = code.trim();
    if (trimmed.length === 0) continue;
    const method = RUBY_DEF.exec(trimmed);
    if (method !== null) {
      if (!owns({ start: at, end: at, indent })) continue;
      const isConstructor = isConstructorName(method[1]!);
      const block = rubyBlockEnd(lines, at, indent);
      members.push({
        name: isConstructor ? parent.name : method[1]!,
        kind: isConstructor ? 'constructor' : 'method',
        startLine: at + 1,
        endLine: (block.closed ? block.end : at) + 1,
        signature: signatureOf(file.lines, at, at),
      });
      continue;
    }
    const attr = RUBY_ATTR.exec(trimmed);
    if (attr === null || !owns({ start: at, end: at, indent })) continue;
    for (const read of attr[1]!.matchAll(/:([A-Za-z_]\w*)/gu)) {
      members.push({
        name: read[1]!,
        kind: 'property',
        startLine: at + 1,
        endLine: at + 1,
        signature: trimmed,
      });
    }
  }
  return members;
}

/** What a scanner is given and what it returns, so the dispatcher can hold seven of them in one table. */
export type Scanner = (file: PreparedFile) => ScannedDeclarations;

/** The scanners, by the language a path is written in; `unknown` is absent because it reads nothing. */
export const LANGUAGE_SCANNERS: Readonly<Partial<Record<string, Scanner>>> = {
  go: scanGo,
  python: scanPython,
  c: scanCFamily,
  csharp: scanCSharp,
  php: scanPhp,
  java: scanJava,
  ruby: scanRuby,
};
