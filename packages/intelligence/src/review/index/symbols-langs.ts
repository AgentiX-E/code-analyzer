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

/**
 * **A module-level assignment, whatever case its name is written in.**
 *
 * The rule was `[A-Z][A-Z0-9_]*` - a convention rather than a syntax - so `_cache: dict[str, int] = {}` declared nothing
 * and the tree-sitter oracle counted one name more than this scanner did. **A name assigned at module level is a name
 * the module has**, and the case it is spelled in is a style the file is free to break.
 *
 * **`=(?!=)` is the reason this is a regex and not a search for an equals sign**: `if x == 1:` holds the character and
 * declares nothing, and a rule that read it as one would invent a symbol on every comparison in the file.
 */
const PYTHON_ASSIGNMENT = /^[A-Za-z_]\w*\s*(?::[^=]+)?=(?!=)/u;

/** One link of a chained assignment: `NAME =`, `NAME: type =`, and nothing that is a comparison. */
const PYTHON_ASSIGNED = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*/u;

/** The statements that hold a module-level assignment without being a scope, so `try:` and `if:` are not functions. */
const PYTHON_MODULE_BLOCK = /^(?:if|elif|else|try|except|finally|for|while|with|match|case)\b/u;

/** Every name a line assigns, left to right, which is one for `x = 1` and two for `x = y = 1`. */
function pythonAssigned(code: string): string[] {
  const found: string[] = [];
  let rest = code;
  for (;;) {
    const link = PYTHON_ASSIGNED.exec(rest);
    if (link === null) break;
    found.push(link[1]!);
    rest = rest.slice(link[0].length);
  }
  return found;
}

/**
 * **Whether a line at an indent is still the module's, or is inside a function or a class.**
 *
 * The constant rule was `indent === 0`, which is **not a rule about scope but about layout**: `codecs.py` assigns its
 * four error handlers inside a module-level `try:` and `ctypes/__init__.py` assigns `BOM` inside a module-level `if`,
 * and both were invisible. The walk finds the nearest line written at a smaller indent - the block header - and asks what
 * it is: a `def` or a `class` closes the module, and a control-flow header at column zero keeps it open.
 */
function pythonModuleScope(file: PreparedFile, at: number, indent: number): boolean {
  let column = indent;
  for (let probe = at - 1; probe >= 0; probe -= 1) {
    const code = file.codes[probe]!;
    if (code.trim().length === 0) continue;
    const headerIndent = indentOf(code);
    if (headerIndent >= column) continue;
    const header = code.trim();
    if (/^(?:async\s+)?(?:def|class)\b/u.test(header)) return false;
    if (headerIndent === 0) return PYTHON_MODULE_BLOCK.test(header);
    column = headerIndent;
  }
  return true;
}

/** The words that start a statement rather than name a variable, so a `name = value` on their line is not a constant. */
const PYTHON_NOT_A_NAME = new Set([
  'if',
  'elif',
  'else',
  'while',
  'for',
  'try',
  'except',
  'finally',
  'with',
  'return',
  'yield',
  'assert',
  'raise',
  'del',
  'pass',
  'break',
  'continue',
  'global',
  'nonlocal',
  'lambda',
  'import',
  'from',
  'class',
  'def',
  'async',
  'await',
  'match',
  'case',
]);

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
    // **A chained assignment declares every name it writes**, and a name it writes inside a module-level `try:` is as
    // much the module's as one at column zero.
    const assigned =
      PYTHON_ASSIGNMENT.test(trimmed) && pythonModuleScope(file, at, indent)
        ? pythonAssigned(trimmed).filter((name) => !PYTHON_NOT_A_NAME.has(name))
        : [];
    const reads: { name: string; kind: SymbolKind }[] = [];
    if (def !== null) reads.push({ name: def[1]!, kind: 'function' });
    else if (klass !== null) reads.push({ name: klass[1]!, kind: 'class' });
    else for (const name of assigned) reads.push({ name, kind: 'const' });
    if (reads.length === 0) continue;

    const end = pythonBlockEnd(file, at, indent);
    for (const read of reads) {
      // **One name is declared once**: `FAST_PATH = True` in the `try` and `FAST_PATH = False` in the `except` are one
      // declaration of one name, and a list that carried it twice would make the recall of a file depend on how often
      // its author wrote the assignment.
      if (declarations.some((other) => other.name === read.name)) continue;
      declarations.push({ name: read.name, kind: read.kind, start: at, end, indent });
      if (!read.name.startsWith('_')) exported.push(read.name);
    }
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

/**
 * **C and C++, read as declarations, at whatever depth the file's own braces put them.**
 *
 * **The depth rule was the defect.** The scanner used to read line `at` only when `depthAtStart[at] === 0`, on the
 * argument that a declaration inside a body is a statement - **and `extern "C" {` is a brace.** Every C library's public
 * header wraps its whole surface in one, so `lv_xml.h` and `lv_animation.h` and 48 others indexed as **zero symbols**,
 * and C is 287 of the 569 findings on the artifact the review is measured on. **A namespace is the same brace in C++**,
 * so the same rule answered a namespaced header with nothing.
 *
 * **The rule that replaces it is about declarations rather than about depth**: a line inside a declaration already
 * emitted belongs to it, and every other line is asked the same three questions. **A body is then out of reach because
 * its opening declaration claimed it**, which is what the depth rule was reaching for.
 *
 * **And a prototype is a declaration.** The scanner used to refuse one because it has no lines a claim could be
 * refuted against - **true, and not a reason to say the file declares nothing**: its extent is its own line, and a
 * review that files a comment on `int panel_open(panel_state_t * state, size_t rows);` is filing it against a
 * declaration the index can name. §94.2 measures what that bought.
 */
export function scanCFamily(file: PreparedFile): ScannedDeclarations {
  const symbols: DeclaredSymbol[] = [];
  const exported: string[] = [];
  // **A line inside a declaration is that declaration's.** One set, written when a symbol is emitted, read at the top
  // of every iteration - and the reason a function body's `if (x) {` is never mistaken for a declaration.
  const claimed = new Set<number>();
  // **A header is an export surface and a translation unit is not**, which is why the same `int claim(` is public in
  // `usb_ids.h` and private to the file in `hidapi.c` unless it says `static` either way. The rule is still `static`,
  // and the difference the header makes is that a non-static name there is offered to every file that includes it.
  for (let at = 0; at < file.lines.length; at += 1) {
    if (claimed.has(at)) continue;
    const code = file.codes[at]!.trim();
    if (code.length === 0) continue;
    if (code.startsWith('#') || code.startsWith('}')) continue;
    const aggregate = /^(?:typedef\s+)?(struct|union|class|enum)\s+([A-Za-z_]\w*)/u.exec(code);
    if (aggregate !== null && code.includes('{')) {
      const end = file.endOf(at);
      for (let line = at; line <= end; line += 1) claimed.add(line);
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
    const prototype = read === null ? cDeclaration(code, file, at) : null;
    const name = read ?? prototype?.name ?? null;
    if (name === null) continue;
    const end = read === null ? prototype!.end : file.endOf(at);
    for (let line = at; line <= end; line += 1) claimed.add(line);
    const isExported = !/\bstatic\b/u.test(code.slice(0, code.indexOf(name)));
    symbols.push({
      name,
      kind: read === null && prototype!.typed ? 'type' : 'function',
      startLine: at + 1,
      endLine: end + 1,
      exported: isExported,
      signature: signatureOf(file.lines, at, end),
      members: [],
    });
    if (isExported) exported.push(name);
  }
  return { symbols, exported };
}

/** The words a `typedef` may end with that are a type rather than the name being declared. */
const C_TYPE_WORD =
  /^(?:int|void|char|short|long|float|double|signed|unsigned|const|volatile|struct|union|enum|size_t|ssize_t)$/u;

/**
 * **A declaration without a body: a prototype, or the name a `typedef` gives.**
 *
 * Two rules, both narrow on purpose.
 *
 * A *prototype* needs a return type - **`index >= 1`** - and that is what keeps a macro call at file scope from being
 * read as a declaration: `G_DEFINE_TYPE(Foo, foo, G_TYPE_OBJECT);` writes the name first and has nothing before it, and
 * a rule without this guard would declare a function called `G_DEFINE_TYPE` in every GLib source file.
 *
 * A *typedef* is named by its last word, **and refused when that word is a type**: `typedef void (*cb_t)(int);` ends in
 * `int`, and a scanner that answered `int` would be naming a type the file did not declare. **Nothing is the honest
 * answer**, and it is the answer this returns.
 *
 * **A prototype written over several lines is one prototype.** The join stops at the first `;` or `{`, and a `{` means
 * a definition, which is `cFunction`'s question rather than this one's.
 */
function cDeclaration(
  code: string,
  file: PreparedFile,
  at: number,
): { name: string; end: number; typed: boolean } | null {
  let text = code;
  let end = at;
  if (!text.includes(';') && text.includes('(')) {
    // **Eight lines is a bound rather than a guess**: a signature that wraps further than that is not a declaration a
    // reader could file a comment against, and an unbounded join on a file with no semicolons is a quadratic scan.
    while (end < Math.min(file.lines.length - 1, at + 7) && !text.includes(';')) {
      end += 1;
      const next = file.codes[end]!.trim();
      if (next.startsWith('{')) return null;
      text = `${text} ${next}`.trim();
    }
  }
  if (text.includes('=') || text.includes('{') || !text.endsWith(';')) return null;

  if (/^typedef\b/u.test(text)) {
    const named = /([A-Za-z_]\w*)\s*;\s*$/u.exec(text);
    if (named === null || C_TYPE_WORD.test(named[1]!)) return null;
    return { name: named[1]!, end, typed: true };
  }
  if (!text.includes('(') || !text.includes(')')) return null;
  const lineWords = words(text);
  const index = declaringWord(lineWords, text);
  // **A return type is what separates a prototype from a call**, and it is the only separator C gives.
  if (index < 1) return null;
  return { name: lineWords[index]!.text, end, typed: false };
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
  /**
   * **A body that opens and closes on one line is still a body.** `void setUp(void) {}` is the shape a Unity test file
   * writes thirty times, and it ends in `}` rather than in `{`, so a rule that only accepted the opening brace read the
   * whole file as declaring nothing - **and a declaration the index cannot name has no name to give a C `#include`
   * edge**, which is how §102's first measurement found it.
   */
  const inline = code.includes('{') && code.endsWith('}');
  const opensNext = code.endsWith(')') && (file.codes[at + 1] ?? '').trim().startsWith('{');
  if (!opensHere && !inline && !opensNext) return null;
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

/** A word that opens a block and therefore owes an `end`, when it stands at the start of a line. */
const RUBY_OPENS_A_LINE = /^(?:class|module|def|if|unless|while|until|case|begin|for)\b/u;

/**
 * **The same words opening a block as the value of an assignment**, which is where Ruby puts a conditional away from
 * the start of a line: `total = if urgent`, `@kind ||= case row.total`, `state = begin`.
 *
 * **A comparison is not an assignment, and the two look alike one character wide.** `capped = row.total >= limit` has
 * an `=` whose left neighbour is `>`, and a scanner that reads it as an assignment followed by a keyword raises the
 * depth by one - which does not mis-name anything, it **hides the next method inside this one**. `(?<![!<>])` is the
 * whole of the rule: `>=`, `<=`, `!=` and `==` are comparisons, and `+=`, `||=` and `&&=` are assignments whose last
 * character is still a bare `=`.
 *
 * **Why this is a second named pattern rather than the other branch of one alternation.** `^A|B` reads as `^(A|B)` and
 * parses as `(^A)|B`; the two branches answer different questions - *does this line start with a keyword* and *does
 * this line assign a keyword* - and CodeQL's `js/regex/missing-regexp-anchor` reports the shape for exactly that
 * reason. Splitting it costs one boolean and makes each half checkable on its own.
 */
const RUBY_OPENS_AFTER_ASSIGNMENT = /(?<![!<>])=(?!=)[ \t]*(?:if|unless|case|begin|while|until)\b/u;

/** Either shape: the line starts with a keyword, or its value is one. */
function opensRubyBlock(trimmed: string): boolean {
  return RUBY_OPENS_A_LINE.test(trimmed) || RUBY_OPENS_AFTER_ASSIGNMENT.test(trimmed);
}

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
    if (opensRubyBlock(trimmed) || RUBY_DO.test(trimmed)) balance += 1;
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

// ---------------------------------------------------------------------------
// Kotlin
// ---------------------------------------------------------------------------

/**
 * **The modifiers Kotlin writes before a declaration, consumed rather than listed as declarations.**
 *
 * `enum` is here for `enum class Color`, which is one declaration and not a declaration of an `enum` and a `class`;
 * `data`, `sealed`, `value` and `annotation` are the same shape. **`fun` is not here**, because `fun interface Foo` is
 * an interface declaration and a table that ate the `fun` would read it as one called `interface`.
 */
const KOTLIN_MODIFIERS =
  /^(?:(?:public|private|protected|internal|open|final|sealed|abstract|data|enum|annotation|value|inside|inline|suspend|operator|infix|tailrec|external|override|lateinit|const|actual|expect|companion|noinline|crossinline|vararg|reified)\s+)*/u;

const KOTLIN_TYPE = /^(class|interface|object|typealias)\s+([A-Za-z_]\w*)/u;

/** `fun <T> identity(`, `fun String.shout(` and `fun topLevel(` are one rule, with the receiver optional. */
const KOTLIN_FUN =
  /^fun\s+(?:<[^>]*>\s*)?(?:(?:[A-Za-z_][\w]*(?:<[^>]*>)?)\.)?([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/u;

const KOTLIN_PROPERTY = /^(?:val|var)\s+([A-Za-z_]\w*)/u;

/** A `val` or `var` in a class's primary constructor, which is a property of that class and nothing else. */
const KOTLIN_PRIMARY = /\b(?:val|var)\s+([A-Za-z_]\w*)/gu;

/**
 * **Kotlin, read as declarations.**
 *
 * Two of its rules are not shared with any language here. **`internal` is module-private**, so a name carrying it is not
 * offered - the same answer C# gives a type without `public`. And **a class's primary constructor declares properties**:
 * `data class Widget(val label: String)` has a member called `label`, and it is the only member of that declaration that
 * is not written inside its body.
 */
export function scanKotlin(file: PreparedFile): ScannedDeclarations {
  const symbols: DeclaredSymbol[] = [];
  const exported: string[] = [];
  for (let at = 0; at < file.lines.length; at += 1) {
    const depth = file.depthAtStart[at]!;
    if (depth > 1) continue;
    const code = file.codes[at]!.trim();
    if (code.length === 0 || code.startsWith('@')) continue;
    const isExported = !/\b(?:private|internal)\b/u.test(code);
    const rest = code.replace(KOTLIN_MODIFIERS, '');

    // **`fun interface` is an interface**, and the two words are one declaration rather than a function called
    // `interface`.
    const isFunInterface = /^fun\s+interface\s+([A-Za-z_]\w*)/u.exec(rest);
    const type = isFunInterface === null ? KOTLIN_TYPE.exec(rest) : null;
    const keyword = isFunInterface?.[1] !== undefined ? 'interface' : (type?.[1] ?? '');
    const name = isFunInterface?.[1] ?? type?.[2];
    if (name !== undefined && name !== null && name.length > 0) {
      const end = file.endOf(headerEnd(file.codes, at));
      const kind: SymbolKind =
        keyword === 'interface'
          ? 'interface'
          : keyword === 'typealias' || /\benum\s+class\b/u.test(code)
            ? 'type'
            : 'class';
      symbols.push({
        name,
        kind,
        startLine: at + 1,
        endLine: end + 1,
        exported: isExported,
        signature: signatureOf(file.lines, at, end),
        members: kotlinMembers(file, at, end, name),
      });
      if (isExported) exported.push(name);
      continue;
    }

    // **A function or a property one level in is a member**, and reading it as a top-level declaration would put `draw`
    // and `size` beside `Widget` in the list of what the file declares - the answer that made `exported` grow two names
    // the file does not have. **A type one level in is still a declaration**, which is why this check is here and not at
    // the top of the loop.
    if (depth === 1) continue;
    const call = KOTLIN_FUN.exec(rest);
    if (call !== null) {
      const end = file.endOf(at);
      symbols.push({
        name: call[1]!,
        kind: 'function',
        startLine: at + 1,
        endLine: end + 1,
        exported: isExported,
        signature: signatureOf(file.lines, at, end),
        members: [],
      });
      if (isExported) exported.push(call[1]!);
      continue;
    }

    const property = KOTLIN_PROPERTY.exec(rest);
    if (property !== null) {
      const end = file.endOf(at);
      symbols.push({
        name: property[1]!,
        kind: 'const',
        startLine: at + 1,
        endLine: end + 1,
        exported: isExported,
        signature: signatureOf(file.lines, at, end),
        members: [],
      });
      if (isExported) exported.push(property[1]!);
    }
  }
  return { symbols, exported };
}

/**
 * **The line on which a declaration's own parentheses close**, which is where its body may open.
 *
 * `class Widget(` followed by two parameter lines and `) {` opens a body on its third line, and the shared `endOf`
 * looks exactly one line ahead - so it answers `class Widget(` with a range of one line and no members. **The balance is
 * counted here rather than in `endOf`** because widening that rule would make a one-line `int x;` swallow the next
 * function's body, and the two declarations look nothing alike to a brace counter.
 */
function headerEnd(codes: readonly string[], at: number): number {
  let balance = 0;
  for (let line = at; line < codes.length; line += 1) {
    for (const char of codes[line]!) {
      if (char === '(') balance += 1;
      else if (char === ')') balance -= 1;
    }
    if (balance <= 0) return line;
  }
  return at;
}

/** The properties a primary constructor declares, in the order the parameters are written. */
function kotlinPrimary(file: PreparedFile, at: number, parent: string): MemberSymbol[] {
  const line = file.codes[at]!;
  const open = line.indexOf('(');
  if (open < 0) return [];
  // **The parameter list is read from the declaration's own line**, because that is where a primary constructor is
  // written; a list that wrapped onto the next line is a shape this scanner answers with nothing rather than a guess.
  const close = line.lastIndexOf(')');
  const parameters = close > open ? line.slice(open, close) : line.slice(open);
  const members: MemberSymbol[] = [];
  for (const read of parameters.matchAll(KOTLIN_PRIMARY)) {
    members.push({
      name: read[1]!,
      kind: 'property',
      startLine: at + 1,
      endLine: at + 1,
      signature: `${parent}(${parameters.slice(1).trim()})`.slice(0, 120),
    });
  }
  return members;
}

/** The members of a Kotlin class: its primary constructor's properties, then everything its body declares at depth one. */
function kotlinMembers(
  file: PreparedFile,
  at: number,
  end: number,
  parent: string,
): MemberSymbol[] {
  const members = kotlinPrimary(file, at, parent);
  for (let line = at + 1; line <= end; line += 1) {
    if (file.depthAtStart[line] !== file.depthAtStart[at]! + 1) continue;
    const code = file.codes[line]!.trim();
    if (code.length === 0 || code.startsWith('@')) continue;
    const rest = code.replace(KOTLIN_MODIFIERS, '');
    const block = file.endOf(line);
    const call = KOTLIN_FUN.exec(rest);
    if (call !== null) {
      members.push({
        name: call[1]!,
        kind: 'method',
        startLine: line + 1,
        endLine: block + 1,
        signature: signatureOf(file.lines, line, block),
      });
      continue;
    }
    const property = KOTLIN_PROPERTY.exec(rest);
    if (property !== null) {
      members.push({
        name: property[1]!,
        kind: 'property',
        startLine: line + 1,
        endLine: block + 1,
        signature: signatureOf(file.lines, line, block),
      });
      continue;
    }
    // **`constructor(` is a secondary constructor and is named after its class**, for the reason every scanner here gives:
    // a prompt that says "inside constructor" has said less than one that says which type it constructs.
    if (rest.startsWith('constructor')) {
      members.push({
        name: parent,
        kind: 'constructor',
        startLine: line + 1,
        endLine: block + 1,
        signature: signatureOf(file.lines, line, block),
      });
    }
  }
  return members;
}

// ---------------------------------------------------------------------------
// Groovy
// ---------------------------------------------------------------------------

/** The modifiers and annotations Groovy writes before a declaration. */
const GROOVY_MODIFIERS =
  /^(?:(?:@(?!interface\b)[\w.]+(?:\([^)]*\))?|public|protected|private|static|final|abstract|synchronized|transient|volatile|strictfp)\s+)*/u;

/**
 * `class`, `interface`, `trait`, `enum` and **`@interface`**, which Groovy shares with Java and which the first real
 * Groovy file this scanner was pointed at declared - `AutoExternalize.groovy` is an annotation type and nothing else, so a
 * table without it reported that the file declared nothing.
 */
const GROOVY_TYPE = /^(@?)(class|interface|trait|enum)\s+([A-Za-z_$][\w$]*)/u;

/** `def topLevel(` - the untyped form, which is how a Gradle build and a Jenkinsfile write almost everything. */
const GROOVY_DEF = /^def\s+([A-Za-z_$][\w$]*)\s*\(/u;

/** `void main(String[] args) {` - the typed form, whose name is the word before the paren and not the type. */
const GROOVY_TYPED = /^[A-Za-z_$][\w$.<>[\]]*\s+([A-Za-z_$][\w$]*)\s*\(/u;

/**
 * **Groovy, read as declarations.**
 *
 * It is the language a build script and a Jenkinsfile are written in, and **it is read with the Java scanner's two
 * shapes plus `def`**: a type keyword, and a name before a paren. Its `trait` is a type that can be implemented, which is
 * why it is reported as an interface rather than as a class - the distinction a reader would make.
 */
export function scanGroovy(file: PreparedFile): ScannedDeclarations {
  const symbols: DeclaredSymbol[] = [];
  const exported: string[] = [];
  for (let at = 0; at < file.lines.length; at += 1) {
    const depth = file.depthAtStart[at]!;
    if (depth > 1) continue;
    const code = file.codes[at]!.trim();
    // **`@interface` is a declaration and `@Deprecated` is not**, which is why this guard names the annotation type
    // rather than treating every `@` as a decorator that declares nothing.
    if (code.length === 0 || (code.startsWith('@') && !code.startsWith('@interface'))) continue;
    const isExported = !/\b(?:private|protected)\b/u.test(code);
    const rest = code.replace(GROOVY_MODIFIERS, '');
    const type = GROOVY_TYPE.exec(rest);
    if (type !== null) {
      const end = file.endOf(at);
      const keyword = type[2]!;
      const kind: SymbolKind =
        keyword === 'interface' || keyword === 'trait'
          ? 'interface'
          : keyword === 'enum'
            ? 'type'
            : 'class';
      symbols.push({
        name: type[3]!,
        kind,
        startLine: at + 1,
        endLine: end + 1,
        exported: isExported,
        signature: signatureOf(file.lines, at, end),
        members: membersAtDepth(file, at + 1, end, depth + 1, type[3]!),
      });
      if (isExported) exported.push(type[3]!);
      continue;
    }
    if (depth === 1) continue;
    const call = GROOVY_DEF.exec(rest) ?? GROOVY_TYPED.exec(rest);
    if (call === null) continue;
    const end = file.endOf(at);
    symbols.push({
      name: call[1]!,
      kind: 'function',
      startLine: at + 1,
      endLine: end + 1,
      exported: isExported,
      signature: signatureOf(file.lines, at, end),
      members: [],
    });
    if (isExported) exported.push(call[1]!);
  }
  return { symbols, exported };
}

// ---------------------------------------------------------------------------
// Swift
// ---------------------------------------------------------------------------

/** The modifiers and attributes Swift writes before a declaration. **`class` is absent on purpose**: `class Widget` is
 * a declaration, while `class func` only occurs inside a type and is read there. */
const SWIFT_MODIFIERS =
  /^(?:(?:@[\w.]+(?:\([^)]*\))?|public|private|fileprivate|internal|open|final|indirect|static|override|required|convenience|lazy|weak|unowned|nonisolated|mutating|nonmutating|prefix|postfix|infix|dynamic|optional)\s+)*/u;

/**
 * **The seven words Swift declares a type with, and `typealias` is one of them.**
 *
 * `public typealias Completion = (Result<Void, Error>) -> Void` declares a name, and it is the name a reader asks about
 * when a signature mentions `Completion`. The table had the six that open a body and not the one that does not, so
 * **a file whose only export was an alias answered that it exports nothing** - measured by the tree-sitter oracle on
 * `benchmarks/polyglot/hard/hard.swift`, which is the first corpus that contained one.
 */
const SWIFT_TYPE = /^(class|struct|enum|protocol|extension|actor|typealias)\s+([A-Za-z_]\w*)/u;

/** The words that follow `class` when `class` is marking a member rather than declaring a type. */
const SWIFT_MEMBER_KEYWORDS = new Set(['func', 'var', 'let', 'init', 'subscript', 'deinit']);

/** `func identity(` and `func identity<T>(` are one rule: the name stops where the paren or the generic clause does. */
const SWIFT_FUNC = /^func\s+([A-Za-z_]\w*)/u;

const SWIFT_INIT = /^init[?!]?\s*\(/u;

const SWIFT_BINDING = /^(?:let|var)\s+([A-Za-z_]\w*)/u;

/**
 * **Swift, read as declarations.**
 *
 * `struct` and `extension` are the two shapes it has that no language here had. **`struct` is a type and is reported as
 * a class**, and **`extension` is a range in the type it extends**: it declares no new name, so it is a symbol whose
 * lines a witness can point at and whose name is not offered twice.
 */
export function scanSwift(file: PreparedFile): ScannedDeclarations {
  const symbols: DeclaredSymbol[] = [];
  const exported: string[] = [];
  // **The types this line is inside, outermost first**, because Swift's own scope rule makes the name of a nested
  // declaration the parent's name plus its own. A cross-file edge is written outside the type by definition, so
  // `JSONEncoding.Error` is the only spelling that can cross a file boundary - and a symbol called `Error` is a symbol
  // that matches the word `Error` in every file that writes one.
  const enclosing: { name: string; endLine: number }[] = [];
  for (let at = 0; at < file.lines.length; at += 1) {
    while (enclosing.length > 0 && enclosing[enclosing.length - 1]!.endLine < at) enclosing.pop();
    const depth = file.depthAtStart[at]!;
    if (depth > 1) continue;
    const code = file.codes[at]!.trim();
    if (code.length === 0 || code.startsWith('@')) continue;
    // **Only `public` and `open` are offered**, because Swift's default is `internal` and `internal` stops at the module
    // boundary - the same answer Kotlin's `internal` gets and the same answer C# gives a type without a modifier.
    const isExported = /\b(?:public|open)\b/u.test(code);
    const rest = code.replace(SWIFT_MODIFIERS, '');
    const type = SWIFT_TYPE.exec(rest);
    // **`class func` and `class var` are modifiers, not declarations**: Swift marks a static member with `class`, and a
    // reader that took the first word as a keyword declared a type called `func` - one such symbol in `Alamofire`, which
    // then matched every file that wrote the word and made an edge of it.
    if (type !== null && !SWIFT_MEMBER_KEYWORDS.has(type[2]!)) {
      const end = file.endOf(at);
      const keyword = type[1]!;
      const kind: SymbolKind =
        keyword === 'protocol'
          ? 'interface'
          : keyword === 'enum' || keyword === 'typealias'
            ? 'type'
            : 'class';
      // **An extension offers nothing**, so it is neither in the exported list nor a second entry in it.
      const offers = isExported && keyword !== 'extension';
      // **A `typealias` opens no scope**, so it is named by its parent and encloses nothing itself.
      const opens = keyword !== 'typealias';
      const parent = enclosing.map((entry) => entry.name).join('.');
      const name = parent.length === 0 ? type[2]! : `${parent}.${type[2]!}`;
      symbols.push({
        name,
        kind,
        startLine: at + 1,
        endLine: end + 1,
        exported: offers,
        signature: signatureOf(file.lines, at, end),
        members: swiftMembers(file, at, end, type[2]!),
      });
      if (offers) exported.push(name);
      if (opens) enclosing.push({ name, endLine: end });
      continue;
    }
    if (depth === 1) continue;
    // **`class` is Swift's marker for a static member**, so it is stripped here and the member is read by the two rules
    // below - which is the reading a person does when they see `public class func f()`.
    const member = type === null ? rest : rest.replace(/^class\s+/u, '');
    const call = SWIFT_FUNC.exec(member);
    if (call !== null) {
      const end = file.endOf(at);
      symbols.push({
        name: call[1]!,
        kind: 'function',
        startLine: at + 1,
        endLine: end + 1,
        exported: isExported,
        signature: signatureOf(file.lines, at, end),
        members: [],
      });
      if (isExported) exported.push(call[1]!);
      continue;
    }
    const binding = SWIFT_BINDING.exec(member);
    if (binding !== null) {
      const end = file.endOf(at);
      symbols.push({
        name: binding[1]!,
        kind: 'const',
        startLine: at + 1,
        endLine: end + 1,
        exported: isExported,
        signature: signatureOf(file.lines, at, end),
        members: [],
      });
      if (isExported) exported.push(binding[1]!);
    }
  }
  return { symbols, exported };
}

/** The members a Swift type or extension declares at depth one, including `init` and a stored property with no `=`. */
function swiftMembers(file: PreparedFile, at: number, end: number, parent: string): MemberSymbol[] {
  const members: MemberSymbol[] = [];
  const base = file.depthAtStart[at]!;
  for (let line = at + 1; line <= end; line += 1) {
    if (file.depthAtStart[line] !== base + 1) continue;
    const code = file.codes[line]!.trim();
    if (code.length === 0 || code.startsWith('@')) continue;
    const rest = code.replace(SWIFT_MODIFIERS, '');
    const block = file.endOf(line);
    if (SWIFT_INIT.test(rest)) {
      members.push({
        name: parent,
        kind: 'constructor',
        startLine: line + 1,
        endLine: block + 1,
        signature: signatureOf(file.lines, line, block),
      });
      continue;
    }
    const call = SWIFT_FUNC.exec(rest.replace(/^class\s+/u, ''));
    if (call !== null) {
      members.push({
        name: call[1]!,
        kind: 'method',
        startLine: line + 1,
        endLine: block + 1,
        signature: signatureOf(file.lines, line, block),
      });
      continue;
    }
    const binding = SWIFT_BINDING.exec(rest);
    if (binding !== null) {
      members.push({
        name: binding[1]!,
        kind: 'property',
        startLine: line + 1,
        endLine: block + 1,
        signature: signatureOf(file.lines, line, block),
      });
    }
  }
  return members;
}

// ---------------------------------------------------------------------------
// The three documents
// ---------------------------------------------------------------------------

/** One key of a document, with the lines it stands for and the key that holds it. */
interface KeyRecord {
  readonly name: string;
  /** 0-based, inclusive. */
  readonly start: number;
  readonly end: number;
  /** The index of the record that holds this one, or -1 for a top-level key. */
  readonly parent: number;
}

/** One element of an XML file, with the element that holds it, kept by identity until every one of them is read. */
interface XmlElement {
  readonly id: number;
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly parent: number;
}

/**
 * **A document's records turned into the symbols a witness can name, and the members that hold them together.**
 *
 * The three readers below produce ranges and parents rather than symbols, because **the difference between JSON, YAML and
 * XML is how a key's range is found and not what a key is** - the assembly is written once so that a reader cannot
 * disagree with its neighbours about what a `key` means.
 */
function keySymbols(records: readonly KeyRecord[], file: PreparedFile): ScannedDeclarations {
  /**
   * **The children are grouped once by parent**, because the version that filtered the whole record list per record was
   * quadratic in the records and built a signature for every entry it kept - **which is what ran out of a four-gigabyte
   * heap on a 436 KB docset index**, not the scan that found the parents. One pass, one array per parent, same answer and
   * the same order.
   */
  const childrenOf = new Map<number, KeyRecord[]>();
  for (const record of records) {
    const bucket = childrenOf.get(record.parent);
    if (bucket === undefined) childrenOf.set(record.parent, [record]);
    else bucket.push(record);
  }
  const symbols: DeclaredSymbol[] = records.map((record, at) => ({
    name: record.name,
    kind: 'key',
    startLine: record.start + 1,
    endLine: record.end + 1,
    // **A document offers its top-level keys and nothing else**: an inner key is reachable only through the key above it.
    exported: record.parent < 0,
    signature: signatureOf(file.lines, record.start, record.end),
    members: (childrenOf.get(at) ?? []).map((candidate) => ({
      name: candidate.name,
      kind: 'key' as const,
      startLine: candidate.start + 1,
      endLine: candidate.end + 1,
      signature: signatureOf(file.lines, candidate.start, candidate.end),
    })),
  }));
  return { symbols, exported: records.filter((r) => r.parent < 0).map((r) => r.name) };
}

/**
 * **The record that holds a candidate**, which is the nearest earlier one whose range contains it.
 *
 * The nearest rather than the widest, because a document nests: `scripts` and its own `test` both contain the line
 * `"test": "vitest run"`, and the answer a witness needs is the one the claim is written inside.
 *
 * **YAML still uses this and JSON no longer does**: a YAML file's records are one per line and a document with four
 * thousand of them is not a shape a repository writes, so the scan is affordable where the stack would be a rewrite of a
 * reader whose ranges are already line-shaped. **JSON's is the shape that is generated**, and `scanJson` answers it with
 * the stack (§103).
 */
function enclosingRecord(
  records: readonly KeyRecord[],
  candidate: { start: number; end: number },
): number {
  for (let back = records.length - 1; back >= 0; back -= 1) {
    const other = records[back]!;
    if (other.start <= candidate.start && other.end >= candidate.end) return back;
  }
  return -1;
}

/**
 * **Every key a JSON line writes, read with the quote state the text implies.**
 *
 * Three defects are fixed by walking the line instead of matching its start, and **the third one is what makes the walk
 * necessary rather than convenient**:
 *
 * 1. A key anchored at the start of the line is invisible the moment a brace precedes it, so `{ "os": "linux" }` - the
 *    shape of every compact object in every array of objects - declared nothing.
 * 2. The name a key has is the string it decodes to: the file writes `"escaped\"quote"` and the key is `escaped"quote`,
 *    and **a name that carries its own backslash is a name no consumer can match** - not a JSON pointer, not a field
 *    lookup, not a prompt.
 * 3. A quoted word inside a *value* is not a key. `"argv": "echo \"ghost\": 1"` holds the characters of one, so a
 *    scanner that searched the line for `"…":` would invent `ghost` - **which is why the walk tracks whether it is
 *    inside a string rather than searching for a pattern**.
 *
 * The decode is `JSON.parse` on the literal this function has already balanced, and it is allowed to fail: a `.jsonc` or
 * a file with a stray control character is still a document whose keys a reader can see, so a failed decode falls back
 * to the raw body rather than dropping the key.
 */
function jsonKeysIn(line: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  let at = 0;
  while (at < line.length) {
    if (line[at] !== '"') {
      at += 1;
      continue;
    }
    const start = at;
    let probe = at + 1;
    let escaped = false;
    while (probe < line.length) {
      const char = line[probe]!;
      if (escaped) {
        escaped = false;
        probe += 1;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        probe += 1;
        continue;
      }
      if (char === '"') break;
      probe += 1;
    }
    // **An unterminated quote ends the walk**: a string that does not close cannot be a key, and continuing from the
    // next character would read the rest of the line as if it were code.
    if (probe >= line.length) break;
    const literal = line.slice(start, probe + 1);
    at = probe + 1;
    let colon = at;
    while (colon < line.length && (line[colon] === ' ' || line[colon] === '\t')) colon += 1;
    if (line[colon] !== ':') continue;
    let name = literal.slice(1, -1);
    try {
      name = JSON.parse(literal) as string;
    } catch {
      // A key that is not valid JSON is still a name the file wrote; the raw body is the closer answer.
    }
    if (seen.has(name)) continue;
    seen.add(name);
    found.push(name);
  }
  return found;
}

/**
 * **JSON, read as keys.**
 *
 * A key's range is the block its value opens, and the depth it opens is counted over **braces and brackets together**,
 * because `"files": [` returns to its own depth only after the `]` - a counter that watched braces alone would end the
 * key on the line that opens it and lose every key inside the array.
 */
export function scanJson(file: PreparedFile): ScannedDeclarations {
  const depthAt: number[] = [];
  const depthAfter: number[] = [];
  /**
   * **The brackets still open at the start of each line, as the characters that opened them.**
   *
   * A depth is not enough to say whether a key is the document's: `{` and `[{` both put a line one level in, and the
   * first holds a key of the file while the second holds a key of an array element. **The stack is the only thing that
   * tells them apart**, and it is what lets the reader answer `[{ "a": 1 }]` with nothing without also answering
   * `{ "a": 1 }` with nothing.
   */
  const openAt: string[] = [];
  const stack: string[] = [];
  for (const code of file.codes) {
    depthAt.push(stack.length);
    openAt.push(stack.slice(-8).join(''));
    for (const char of code) {
      if (char === '{' || char === '[') stack.push(char);
      else if (char === '}' || char === ']') stack.pop();
    }
    depthAfter.push(stack.length);
  }
  const records: KeyRecord[] = [];
  /**
   * **The records still open, as a stack**, which is the parent lookup in constant time.
   *
   * Keys arrive in source order and their ranges nest or are disjoint, so **the innermost record that holds a key is the
   * last one pushed whose range still reaches it** - one pop per key. The version this replaces scanned every record
   * already pushed, backwards, and a flat document - which is every generated index - made that scan walk the whole
   * document once per key.
   */
  const open: number[] = [];
  for (let at = 0; at < file.codes.length; at += 1) {
    // **The keys are read from the file's own line and not from the lexed one**, because the shared lexer blanks a quoted
    // body - which is what makes `"a":"b{c}"` safe to count braces over and what would turn every key into blanks.
    const keys = jsonKeysIn(file.lines[at]!);
    if (keys.length === 0) continue;
    let end = at;
    if (depthAfter[at]! > depthAt[at]!) {
      const target = depthAt[at]!;
      let probe = at + 1;
      while (probe < file.codes.length && depthAfter[probe]! > target) probe += 1;
      end = Math.min(probe, file.codes.length - 1);
    }
    for (const name of keys) {
      /**
       * **A document written on one line has no line-shaped nesting, and the honest answer is that every key is top
       * level.** Every key of a minified file shares one range, so the stack cannot separate a sibling from a child - the
       * version this replaces chained each key to the one before it, which made `{"a":1,"b":2}` declare `a` and file `b`
       * as a member of `a`. **A key that cannot be placed is not placed inside another key**, and the file it happens on
       * is a generated one, where the key list is the whole fact a reader was after.
       */
      const flat = file.codes.length <= 1;
      while (!flat && open.length > 0 && records[open[open.length - 1]!]!.end < end) open.pop();
      const parent = flat || open.length === 0 ? -1 : open[open.length - 1]!;
      // **A key belongs to the file when a recorded key holds it, or when the only thing holding it is the document's
      // own root object.** `[{ "a": 1 }]` is the case this branch exists for: the document is an array, the objects in it
      // are its elements, and **an element's key is not a key of the document** - naming it would put a name in the
      // top-level list that no reader can address from the root.
      const root = openAt[at] === '' || openAt[at] === '{';
      if (parent < 0 && !root) continue;
      records.push({ name, start: at, end, parent });
      if (!flat) open.push(records.length - 1);
    }
  }
  return keySymbols(records, file);
}

/** A YAML key: `key:`, `"key":` or `'key':`, with anything after the colon being its value rather than its block. */
const YAML_KEY = /^(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s:#][^:#]*?))\s*:(?:\s|$)/u;

/** One YAML line, as the column it starts at and the text left once its dashes are taken off. */
interface YamlLine {
  readonly indent: number;
  readonly text: string;
}

/**
 * **The indentation a YAML line is written at, and the text that is left once its sequence markers are removed.**
 *
 * -1 - which is `null` here - is a line that declares nothing: a blank one, or a comment. **A sequence marker is not part
 * of a key**: `- name: Checkout` names `name` at the column its `-` stands at plus two, and reading the dash as part of
 * the name is how a scanner reports a key called `- name`.
 */
function yamlLine(line: string): YamlLine | null {
  const trimmed = line.replace(/\s+$/u, '');
  if (trimmed.trim().length === 0 || trimmed.trimStart().startsWith('#')) return null;
  let indent = 0;
  let rest = trimmed;
  const spaces = (): void => {
    while (rest[0] === ' ') {
      indent += 1;
      rest = rest.slice(1);
    }
  };
  spaces();
  // **Tabs are not YAML indentation**, and a file that has one is answered as if it were four spaces - wide rather than
  // narrow, because a block that ends early hides the guard inside it.
  while (rest[0] === '\t') {
    indent += 4;
    rest = rest.slice(1);
    spaces();
  }
  while (rest.startsWith('- ')) {
    indent += 2;
    rest = rest.slice(2);
    spaces();
  }
  return { indent, text: rest };
}

/**
 * **The keys a flow mapping writes between its braces, and nothing a scalar holds.**
 *
 * `flow: { a: 1, b: 2 }` is a mapping with two keys written on one line, and a reader that only counts columns sees one
 * key called `flow`. **The walk tracks quotes as well as depth**, because `quoted: "key: with a colon"` holds the
 * characters of a key and names none - the same trap the JSON reader was rewritten for, in the same week.
 *
 * **The depth is counted from the opening brace**, so a nested flow mapping's keys belong to the key that opened them
 * and not to the document - which is the answer `enclosingRecord` would give if it could see a second key on one line.
 */
function yamlFlowKeys(value: string): string[] {
  if (!value.startsWith('{')) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  let depth = 0;
  let at = 0;
  while (at < value.length) {
    const char = value[at]!;
    if (char === '"' || char === "'") {
      // **A quoted scalar is skipped whole**, so the colon inside `"key: with a colon"` is never read as a separator.
      let probe = at + 1;
      while (probe < value.length && value[probe] !== char) {
        probe += value[probe] === '\\' && char === '"' ? 2 : 1;
      }
      const text = value.slice(at + 1, probe);
      let after = probe + 1;
      while (after < value.length && value[after] === ' ') after += 1;
      if (depth === 1 && value[after] === ':' && !seen.has(text)) {
        seen.add(text);
        found.push(text);
      }
      at = probe + 1;
      continue;
    }
    if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    if (depth === 1 && /[A-Za-z0-9_.-]/u.test(char)) {
      let probe = at;
      while (probe < value.length && /[A-Za-z0-9_.-]/u.test(value[probe]!)) probe += 1;
      let after = probe;
      while (after < value.length && value[after] === ' ') after += 1;
      const text = value.slice(at, probe);
      if (value[after] === ':' && !seen.has(text)) {
        seen.add(text);
        found.push(text);
      }
      at = probe;
      continue;
    }
    at += 1;
  }
  return found;
}

/**
 * **YAML, read by indentation.**
 *
 * **A key with nothing after its colon opens the block that follows; a key with a value on its own line occupies that
 * line and nothing else.** That one rule is what keeps `name: Checkout` from swallowing the `uses:` written under it -
 * the two are siblings in a sequence item, and an indentation-only rule would make the second a child of the first
 * because it is written two columns deeper.
 */
/**
 * **A key whose value is a block scalar, which is a value and not a table.**
 *
 * `command: |` says the lines under it are text. **Text is not a mapping**, so a line inside it that happens to look like
 * `echo "starting: app"` declares nothing - and the scanner, reading the file by columns, filed it under `command` as a
 * key. On this repository's own `.github/workflows/ci.yml` the same defect turned four lines of a shell script into four
 * keys, and the containment check that hid them (they *are* inside `run`) is the reason it took a corpus with a script
 * in it to see them.
 */
const YAML_BLOCK_SCALAR = /^[|>][+-]?\d*$/u;

export function scanYaml(file: PreparedFile): ScannedDeclarations {
  const read = file.lines.map(yamlLine);
  const meaningful = read.flatMap((line, at) => (line === null ? [] : [at]));
  const indents = read.map((line) => line?.indent ?? -1);
  const records: KeyRecord[] = [];
  // **A block scalar's body is text**, and the lines in it are skipped rather than read: the marker's own range is the
  // key's, and every line under it belongs to the value.
  const literal = new Set<number>();
  for (let entry = 0; entry < meaningful.length; entry += 1) {
    const at = meaningful[entry]!;
    if (literal.has(at)) continue;
    const indent = indents[at]!;
    const text = read[at]!.text.trim();
    const match = YAML_KEY.exec(text);
    if (match === null) continue;
    const name = match[1] ?? match[2] ?? match[3]!;
    const value = text.slice(match[0].length).trim();
    const isLiteral = YAML_BLOCK_SCALAR.test(value);
    let end = at;
    if (value.length === 0 || isLiteral) {
      // The block ends before the next meaningful line written at this key's own indentation or shallower.
      const next = meaningful.slice(entry + 1).find((probe) => indents[probe]! <= indent);
      end = next === undefined ? meaningful[meaningful.length - 1]! : next - 1;
      // **A blank line after the block is not part of it**, because a claim filed against one would render nothing.
      while (end > at && indents[end]! < 0) end -= 1;
    }
    if (isLiteral) {
      for (let line = at + 1; line <= end; line += 1) literal.add(line);
    }
    const parent = enclosingRecord(records, { start: at, end });
    records.push({ name, start: at, end, parent });
    // **A flow mapping's keys are the members of the key that opened it**, and their parent is written here rather than
    // searched for: two keys on one line have the same range, so `enclosingRecord` would offer the sibling that was
    // pushed a line earlier. **The index of the record just written is the only correct answer.**
    const owner = records.length - 1;
    for (const inner of yamlFlowKeys(value)) {
      records.push({ name: inner, start: at, end: at, parent: owner });
    }
  }
  return keySymbols(records, file);
}

/** An XML start tag, an end tag or a self-closing one, with the attributes in between. */
const XML_TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/gu;

/**
 * **XML, read as the elements a line stands in.**
 *
 * The nesting is a stack rather than an indent or a depth, because **an element's extent is its closing tag** and nothing
 * else says so. **A comment is stripped before the tags are read**, since `<!-- <foo> -->` is the one shape that would
 * otherwise declare an element no parser finds.
 */
export function scanXml(file: PreparedFile): ScannedDeclarations {
  const closed: XmlElement[] = [];
  const stack: Array<{ id: number; name: string; start: number; parent: number }> = [];
  let nextId = 0;
  let inComment = false;

  for (let at = 0; at < file.lines.length; at += 1) {
    let text = file.lines[at]!;
    if (inComment) {
      const close = text.indexOf('-->');
      if (close < 0) continue;
      text = text.slice(close + 3);
      inComment = false;
    }
    text = text.replace(/<!--[\s\S]*?-->/gu, ' ');
    const opened = text.lastIndexOf('<!--');
    if (opened >= 0) {
      text = text.slice(0, opened);
      inComment = true;
    }
    XML_TAG.lastIndex = 0;
    for (let match = XML_TAG.exec(text); match !== null; match = XML_TAG.exec(text)) {
      const name = match[2]!;
      if (match[1] === '/') {
        // **The innermost open element with this name is the one it closes.** A closing tag with no open element of that
        // name is ignored rather than closing something it did not open.
        for (let back = stack.length - 1; back >= 0; back -= 1) {
          if (stack[back]!.name !== name) continue;
          const element = stack[back]!;
          stack.length = back;
          closed.push({
            id: element.id,
            name,
            start: element.start,
            end: at,
            parent: element.parent,
          });
          break;
        }
        continue;
      }
      const parent = stack.at(-1)?.id ?? -1;
      if (match[4] === '/') {
        closed.push({ id: nextId, name, start: at, end: at, parent });
        nextId += 1;
        continue;
      }
      stack.push({ id: nextId, name, start: at, parent });
      nextId += 1;
    }
  }

  // **Every element is ordered before any parent is resolved**, because a parent's extent is only known when its closing
  // tag arrives - which is after its children's. A child that pointed at a list position would point at the wrong
  // element for every file that nests one.
  // **Three keys, because two elements can share both ends**: `<a><b>x</b></a>` writes them on one line, and the one that
  // opened first is the one that encloses the other - which is what the identity they were given records.
  const order = [...closed].sort(
    (left, right) => left.start - right.start || right.end - left.end || left.id - right.id,
  );
  const position = new Map(order.map((element, at) => [element.id, at]));
  const records: KeyRecord[] = order.map((element) => ({
    name: element.name,
    start: element.start,
    end: element.end,
    parent: element.parent < 0 ? -1 : (position.get(element.parent) ?? -1),
  }));
  return keySymbols(records, file);
}

/** What a scanner is given and what it returns, so the dispatcher can hold sixteen of them in one table. */
export type Scanner = (file: PreparedFile) => ScannedDeclarations;

/** The scanners, by the language a path is written in; `unknown` is absent because it reads nothing. */
export const LANGUAGE_SCANNERS: Readonly<Partial<Record<string, Scanner>>> = {
  go: scanGo,
  python: scanPython,
  c: scanCFamily,
  csharp: scanCSharp,
  php: scanPhp,
  java: scanJava,
  kotlin: scanKotlin,
  groovy: scanGroovy,
  ruby: scanRuby,
  swift: scanSwift,
  json: scanJson,
  yaml: scanYaml,
  xml: scanXml,
};
