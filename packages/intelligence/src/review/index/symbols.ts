// @code-analyzer/intelligence — the structure of a file, so a reader can be shown its contract instead of its borders
//
// **A window and an index answer the same question in opposite directions.** `code-context.ts` widens a hunk until the
// reader can see the block it sits in; §78 widened it again to 6 000 characters of surrounding lines and returned
// −0.0022 F1. `aoci-spec/aoci-code` narrows: one line per file naming what the file is for and what must not break.
// `Wilfred/difftastic` narrows too, in the other axis - it computes which lines are novel and hands over only those.
// **A window is what you read when you have no index.**
//
// **What this module is allowed to say, and what it is not.** It is a lexer, not a parser: it establishes which name is
// declared on which lines, whether it is exported, and which guard statements sit inside it. All three are checkable by
// opening the file, which is the property that makes them safe to put in a prompt. It establishes **nothing** about what
// a symbol is for or what it must not violate - those are the `F` and `S` fields of `aoci-code`'s index, and that
// repository's own `s-field-discipline` forbids deriving them from an AST, an import scan or a regular expression
// because *a regex-extracted invariant is not an invariant; it is a string that happens to sit next to one*. **A future
// model-written pass would add meaning beside this structure, never in place of it.**
//
// **And the failure direction is fixed in advance.** A construct this lexer does not understand - a regex literal
// containing a brace, a generic with a default that opens a block - must never make a symbol *end early*, because a
// symbol that ends early hides the guard that would have refuted a claim. So the scanner carries an explicit
// `uncertain` flag: once it has met a construct it cannot lex, every symbol still open at that point is extended to the
// end of the file rather than truncated at the next `}`.

/** What a declaration is, in the four shapes a reader distinguishes when deciding where a claim stands. */
export type SymbolKind =
  'function' | 'class' | 'interface' | 'type' | 'const' | 'method' | 'constructor' | 'property';

/** One declaration, with the lines it occupies and the signature a prompt can afford. */
export interface DeclaredSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  /** 1-based, and inclusive on both ends. */
  readonly startLine: number;
  readonly endLine: number;
  readonly exported: boolean;
  /** The declaration up to its body - one line where the source wrote one, joined where it wrapped. */
  readonly signature: string;
  /** Declarations nested directly in this one. Empty for everything but a class or an interface. */
  readonly members: readonly MemberSymbol[];
}

/** A declaration inside another one: a method, a constructor, or a field. */
export interface MemberSymbol {
  readonly name: string;
  readonly kind: 'method' | 'constructor' | 'property';
  readonly startLine: number;
  readonly endLine: number;
  readonly signature: string;
}

/** A file, read as structure. */
export interface FileSymbolIndex {
  readonly path: string;
  readonly symbols: readonly DeclaredSymbol[];
  /** The names the file offers to other files, in source order. */
  readonly exported: readonly string[];
  /** The file's own lines, 1-based at index 0, so a caller never keeps a second copy that can disagree. */
  readonly lines: readonly string[];
  /**
   * **Whether the lexer met a construct it could not read.** When it did, every symbol that was open at that moment
   * runs to the end of the file - the wider claim, never the narrower one, for the reason the header states.
   */
  readonly uncertain: boolean;
}

/** The scanner's state between lines, because a comment and a template literal are both allowed to cross one. */
interface ScanState {
  depth: number;
  blockComment: boolean;
  template: boolean;
}

const DECLARATION = new RegExp(
  [
    // `export default async function name`, `export function name`, `function* name`
    '^(?<prefix>(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?)',
    '(?<keyword>async\\s+function\\*?|function\\*?|class|interface|enum|type|const|let|var)\\s+',
    '(?<name>[A-Za-z_$][\\w$]*)',
  ].join(''),
);

/**
 * **The characters of one line that are code, with comments and string bodies blanked rather than removed.**
 *
 * Blanked rather than removed so that a `{` inside a string occupies no column but the line's length is unchanged -
 * which is what lets a signature be taken from the *original* line by the same offsets the scanner computed.
 */
function lexLine(line: string, incoming: ScanState): { code: string; state: ScanState } {
  const out: string[] = [];
  let blockComment = incoming.blockComment;
  let template = incoming.template;
  let quote: '"' | "'" | null = null;

  for (let at = 0; at < line.length; at += 1) {
    const char = line[at]!;
    const next = line[at + 1];

    if (blockComment) {
      out.push(' ');
      if (char === '*' && next === '/') {
        out.push(' ');
        at += 1;
        blockComment = false;
      }
      continue;
    }
    if (template) {
      out.push(' ');
      if (char === '\\') {
        out.push(' ');
        at += 1;
        continue;
      }
      if (char === '`') template = false;
      continue;
    }
    if (quote !== null) {
      out.push(' ');
      if (char === '\\') {
        out.push(' ');
        at += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      // The rest of the line is a comment; nothing after it can open a block.
      out.push(' '.repeat(line.length - at));
      at = line.length;
      continue;
    }
    if (char === '/' && next === '*') {
      out.push('  ');
      at += 1;
      blockComment = true;
      continue;
    }
    if (char === '"' || char === "'") {
      out.push(' ');
      quote = char;
      continue;
    }
    if (char === '`') {
      out.push(' ');
      template = true;
      continue;
    }
    out.push(char);
  }

  return { code: out.join(''), state: { ...incoming, blockComment, template } };
}

/** The number of `{` minus `}` in a line of code, ignoring the ones a template literal or comment already removed. */
function braceDelta(code: string): number {
  let delta = 0;
  for (const char of code) {
    if (char === '{') delta += 1;
    else if (char === '}') delta -= 1;
  }
  return delta;
}

const METHOD =
  /^\s*(?:(?:public|private|protected|static|readonly|async|override|abstract)\s+)*(?<name>[A-Za-z_$][\w$]*)\s*\(/u;
const CONSTRUCTOR = /^\s*(?:(?:public|private|protected)\s+)*constructor\s*\(/u;
const PROPERTY =
  /^\s*(?:(?:public|private|protected|static|readonly|declare|override)\s+)+(?<name>[A-Za-z_$][\w$]*)\s*[?!]?\s*:/u;

/** The signature of a declaration, joined from its first line up to the one that opens its body or ends it. */
function signatureOf(lines: readonly string[], start: number, limit: number): string {
  const collected: string[] = [];
  for (let at = start; at <= limit && at < lines.length; at += 1) {
    const text = lines[at]!.trim();
    collected.push(text);
    if (text.includes('{') || text.endsWith(';') || text.endsWith('}')) break;
  }
  return collected.join(' ').replace(/\s+/gu, ' ').trim();
}

/**
 * **Read a file as its declarations.**
 *
 * The walk is over lines rather than over a tree, and the two facts it needs from a line are the depth the line starts
 * at and the depth it ends at. A declaration begins at the depth its line starts at and ends at the first line after it
 * whose *ending* depth returns to that number.
 */
export function buildSymbolIndex(path: string, text: string): FileSymbolIndex {
  const lines = text.split('\n');
  const codes: string[] = [];
  const depthAtStart: number[] = [];
  const depthAtEnd: number[] = [];
  let state: ScanState = { depth: 0, blockComment: false, template: false };
  let uncertain = false;

  for (const line of lines) {
    depthAtStart.push(state.depth);
    const lexed = lexLine(line, state);
    const before = state;
    const delta = braceDelta(lexed.code);
    const depth = before.depth + delta;
    // **A depth below zero is a brace this lexer attributed to the wrong line**, which is the one shape of failure that
    // silently closes a symbol early. It is recorded rather than clamped, because a clamped depth would keep the error.
    if (depth < 0) uncertain = true;
    codes.push(lexed.code);
    depthAtEnd.push(Math.max(depth, 0));
    state = { ...lexed.state, depth: Math.max(depth, 0) };
  }

  /** The last line a declaration starting at `start` occupies. */
  const endOf = (start: number): number => {
    const startDepth = depthAtStart[start]!;
    if (depthAtEnd[start]! > startDepth) {
      for (let at = start + 1; at < lines.length; at += 1) {
        if (depthAtEnd[at] === startDepth) return at;
      }
      // **Unterminated rather than absent.** The file's last `}` was consumed by something this lexer mis-read.
      uncertain = true;
      return lines.length - 1;
    }
    return start;
  };

  const symbols: DeclaredSymbol[] = [];
  const exportedNames: string[] = [];

  for (let at = 0; at < lines.length; at += 1) {
    const code = codes[at]!;
    const depth = depthAtStart[at]!;
    if (depth !== 0) continue;

    const match = DECLARATION.exec(code.trim());
    if (match?.groups === undefined) continue;
    const keyword = match.groups['keyword']!;
    const name = match.groups['name']!;
    const prefix = match.groups['prefix']!;
    const kind: SymbolKind = keyword.includes('function')
      ? 'function'
      : keyword.startsWith('class')
        ? 'class'
        : keyword === 'interface'
          ? 'interface'
          : keyword === 'enum'
            ? 'class'
            : keyword === 'type'
              ? 'type'
              : 'const';
    const endLine = endOf(at);
    const exported = prefix.includes('export');

    symbols.push({
      name,
      kind,
      startLine: at + 1,
      endLine: endLine + 1,
      exported,
      signature: signatureOf(lines, at, endLine),
      members: kind === 'class' || kind === 'interface' ? membersOf(name, at + 1, endLine + 1) : [],
    });
    if (exported) exportedNames.push(name);
  }

  /** The declarations inside a class or an interface body, between two 1-based line numbers. */
  function membersOf(parent: string, from: number, to: number): MemberSymbol[] {
    const members: MemberSymbol[] = [];
    for (let at = from; at < to; at += 1) {
      const index = at;
      if (depthAtStart[index] !== 1) continue;
      const code = codes[index]!.trim();
      if (code.length === 0) continue;

      const isConstructor = CONSTRUCTOR.test(code);
      const method = METHOD.exec(code);
      const property = PROPERTY.exec(code);
      const name = isConstructor
        ? null
        : (method?.groups?.['name'] ?? property?.groups?.['name'] ?? null);
      const kind: MemberSymbol['kind'] = isConstructor
        ? 'constructor'
        : method !== null
          ? 'method'
          : 'property';
      // **A constructor is named after its class**, because `constructor` is a keyword rather than an identifier and a
      // prompt that says "inside constructor" has said less than one that says "inside Worker".
      const memberName = isConstructor ? parent : name;
      // A line that is a bare `}` or an expression inside a body matches none of the three and is not a member.
      if (memberName === null) continue;

      members.push({
        name: memberName,
        kind,
        startLine: index + 1,
        endLine: endOf(index) + 1,
        signature: signatureOf(lines, index, endOf(index)),
      });
    }
    return members;
  }

  return { path, symbols, exported: exportedNames, lines, uncertain };
}

/** How much a claim's context may spend, in characters. §78 spent 6 000 on the same question. */
export const INDEXED_CONTEXT_BUDGET = 600;

/**
 * **What a claim's reader is shown, and separately, what it may quote.**
 *
 * The two are not the same list and the difference is load-bearing. `exports: claim, Worker` is a fact about the file,
 * not a line of it: a quote checked against that string would be a quote checked against a sentence this module wrote.
 * **So the rendered block and the quotable lines are returned together rather than derived twice**, because two
 * derivations of "which lines did the reader see" is the defect `renderLines`'s `shown` field already exists to prevent.
 */
export interface IndexedContext {
  /** The rendered block, header first: what goes in the prompt. */
  readonly text: string;
  /** The file lines inside `text`, with the numbers it printed - the only lines a quote may be verified against. */
  readonly shown: ReadonlyArray<{ line: number; text: string }>;
}

/** The options `selectIndexedContext` reads. */
export interface IndexedContextRequest {
  readonly index: FileSymbolIndex;
  /** The new-side line numbers the claims stand on, in the order they were filed. */
  readonly lines: readonly number[];
  readonly budget?: number;
}

/** Every keyword whose line can refute a sentence about a neighbouring line. */
const GUARD = /\b(?:throw|assert|invariant|guard|expect|return|continue|break)\b|\bif\s*\(/u;

/** One rendered block, so the budget can be shared between claims instead of spent on the first. */
function renderClaim(index: FileSymbolIndex, line: number, allowance: number): string {
  const symbol = index.symbols.find(
    (candidate) => line >= candidate.startLine && line <= candidate.endLine,
  );
  const member = symbol?.members.find(
    (candidate) => line >= candidate.startLine && line <= candidate.endLine,
  );
  const out: string[] = [];

  if (symbol === undefined) {
    // **A claim no declaration contains is answered with its neighbours rather than with nothing**, because a prompt that
    // says nothing about a claim is a prompt the reader answers from the diff alone - which is where it already was.
    for (let at = Math.max(1, line - 1); at <= Math.min(index.lines.length, line + 1); at += 1) {
      // **Indexed rather than defaulted**: `at` is clamped to `1..lines.length` two lines above, so the element exists
      // and a `?? ''` here is a branch no test can take.
      out.push(`L${String(at)}: ${index.lines[at - 1]!}`.trimEnd());
    }
    return out.join('\n').slice(0, allowance);
  }

  out.push(`L${String(symbol.startLine)}: ${symbol.signature}`.trimEnd());
  if (member !== undefined && member.startLine !== symbol.startLine) {
    out.push(`L${String(member.startLine)}: ${member.signature}`.trimEnd());
  }

  // The guards nearest the claim first: the sentence being judged is about *this* line, and the line that decides it is
  // usually the one next to it rather than the one at the top of the function.
  const guards = index.lines
    .map((text, at) => ({ line: at + 1, text: text.trim() }))
    .filter(
      (candidate) =>
        candidate.line >= symbol.startLine &&
        candidate.line <= symbol.endLine &&
        candidate.line !== line &&
        GUARD.test(candidate.text),
    )
    .sort((left, right) => Math.abs(left.line - line) - Math.abs(right.line - line))
    .slice(0, 3)
    .sort((left, right) => left.line - right.line);

  for (const guard of guards) out.push(`L${String(guard.line)}: ${guard.text}`.trimEnd());
  const own = index.lines[line - 1]!.trim();
  if (own.length > 0) out.push(`L${String(line)}: ${own}`.trimEnd());

  return out.join('\n').slice(0, allowance);
}

/**
 * **What a claim's reader is shown once the file has been read as structure.**
 *
 * Three things, in the order a reader needs them: what the file offers, the declaration the claim stands in, and the
 * guards inside that declaration that could refute it. **Nothing about the rest of the file**, because a claim about
 * `claim()` is not made truer by seeing `Worker`.
 *
 * **The budget is shared rather than granted.** Every claim gets an equal allowance out of the total, so a file with six
 * findings does not buy a prompt whose last five claims are unreadable - the failure mode of a per-claim cap applied
 * after concatenation.
 */
export function selectIndexedContext(request: IndexedContextRequest): IndexedContext {
  const budget = request.budget ?? INDEXED_CONTEXT_BUDGET;
  const header = `exports: ${request.index.exported.length === 0 ? '(none)' : request.index.exported.join(', ')}`;
  const unique = [...new Set(request.lines)].filter((line) => Number.isInteger(line) && line >= 1);
  if (unique.length === 0) return { text: header.slice(0, budget), shown: [] };

  const allowance = Math.max(80, Math.floor((budget - header.length) / unique.length));
  const blocks = unique.map((line) => renderClaim(request.index, line, allowance));
  const text = [header, ...blocks].join('\n').slice(0, budget);

  // **The shown lines are read back out of the text rather than remembered**, so a line cut by the budget is not one a
  // quote can be verified against. A renderer that kept its own list would report a line the prompt never carried.
  const shown: Array<{ line: number; text: string }> = [];
  for (const row of text.split('\n')) {
    const match = /^L(\d+): (.*)$/u.exec(row);
    if (match === null) continue;
    shown.push({ line: Number(match[1]), text: match[2]! });
  }
  return { text, shown };
}
