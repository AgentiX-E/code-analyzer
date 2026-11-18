// @code-analyzer/intelligence — four more languages, because the corpus writes them and the lexer did not
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
// **`exported` means what the language means by it, and the four answers are different questions.** Go: the name's
// first letter. Python: not a leading underscore. C: not `static`. C#: the `public` modifier. PHP: `public`, or no
// modifier at all. **A scanner that answered all five with TypeScript's `export` keyword would report every Go function
// as private**, which is a fact about the scanner and not about the file.
//
// **The failure direction is unchanged from `symbols.ts`.** A declaration whose body the scanner cannot close runs to
// the end of the file and the index is marked `uncertain`, because **a symbol that ends early hides the guard that
// would have refuted a claim** - and a scanner that guessed would be inventing the very fact it was asked to establish.

import {
  declaringParen,
  indentOf,
  isGoExported,
  signatureOf,
  takeIdentifier,
  wordBefore,
  wordEndingAt,
  words,
} from './lexemes.js';

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
 */
function memberFrom(code: string): MemberRead | null {
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === '}' || trimmed === '{' || trimmed === '};') return null;
  // A visibility label (`public:` in C++, `private:` in C#) declares nothing.
  if (trimmed.endsWith(':')) return null;
  const lineWords = words(trimmed);
  if (lineWords.length === 0) return null;

  if (trimmed.includes('(')) {
    const before = wordEndingAt(lineWords, declaringParen(trimmed));
    if (before === undefined || NOT_A_CALLEE.has(before.text)) return null;
    return { name: stripSigil(before.text), kind: 'method' };
  }
  // **An initialiser decides the name before the semicolon does**: `static int MAX = 5;` declares `MAX`, and the word
  // before its `;` is `5`. The order is the order of how much the punctuation says, and `''` is a line none of the
  // three ends - a `using Base::foo` alias, which declares no field.
  const terminator = ['=', ';', '{'].find((candidate) => trimmed.includes(candidate)) ?? '';
  if (terminator === '') return null;
  const before = wordBefore(lineWords, terminator, trimmed);
  if (before === undefined || NOT_A_CALLEE.has(before.text)) return null;
  return { name: stripSigil(before.text), kind: 'property' };
}

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
    members.push({
      // **A constructor is named after its class**, for the reason the TypeScript scanner gives: `constructor` and
      // `__init__` are keywords rather than identifiers, and a prompt that says "inside constructor" says less than one
      // that says "inside Worker".
      name: isConstructorName(read.name) ? parent : read.name,
      kind: read.kind === 'method' && isConstructorName(read.name) ? 'constructor' : read.kind,
      startLine: at + 1,
      endLine: end + 1,
      signature: signatureOf(file.lines, at, end),
    });
  }
  return members;
}

/** Whether a member name is its language's name for a constructor, which the corpus spells two ways. */
function isConstructorName(name: string): boolean {
  return (
    name === 'constructor' || name === '__init__' || name === '__new__' || name === '__construct'
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
    // **The innermost one wins**, so a method of a nested class is not attributed to the class around it.
    if (found === undefined || other.indent > found.indent) found = other;
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
  const before = wordEndingAt(words(code), declaringParen(code));
  if (before === undefined || NOT_A_CALLEE.has(before.text)) return null;
  return before.text;
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

/** What a scanner is given and what it returns, so the dispatcher can hold five of them in one table. */
export type Scanner = (file: PreparedFile) => ScannedDeclarations;

/** The scanners, by the language a path is written in; `unknown` is absent because it reads nothing. */
export const LANGUAGE_SCANNERS: Readonly<Partial<Record<string, Scanner>>> = {
  go: scanGo,
  python: scanPython,
  c: scanCFamily,
  csharp: scanCSharp,
  php: scanPhp,
};
