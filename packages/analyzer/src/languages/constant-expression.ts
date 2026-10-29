// Constant folding for the expressions a taint analysis has to be able to rule out.
//
// **Why a textual evaluator rather than a visitor over the parse tree.** The questions that matter are small and closed:
// `bar = (7 * 18) + num > 200 ? "constant" : param` is a value that cannot be tainted, and `num` is 106 four lines
// above. Answering it needs arithmetic, comparison, a conditional and a lookup - not a type checker, not name
// resolution, not an AST. A parser over the expression's own text answers exactly that, is language-independent down to
// the literal syntax, and **fails closed**: anything it does not recognise returns `undefined`, and `undefined` means
// "assume the value flows", which is the direction a security tool must err in.
//
// The one property that cannot be given up is **laziness in a conditional's arms**. In `cond ? "constant" : param`,
// `param` is a variable the caller did not resolve, and an evaluator that folded the unselected arm would report the
// whole expression as undecidable - losing precisely the case this module exists for. So an arm is evaluated only where
// control would reach it.

/** What a folded expression can be. Deliberately narrow: a value the analysis can compare, that is not a name. */
export type ConstantValue = number | string | boolean;

/** The shape of a conditional expression in the source language. */
export type ConditionalOrder =
  /** `condition ? consequence : alternative` — Java, JavaScript, TypeScript, C, C++, C#, Kotlin, Swift, PHP. */
  | 'condition-consequence-alternative'
  /** `consequence if condition else alternative` — Python. */
  | 'consequence-condition-alternative';

/** Options that change how the text reads, rather than what it means. */
export interface FoldOptions {
  readonly conditionalOrder?: ConditionalOrder;
}

/** Operators this evaluator understands, grouped by precedence. */
type BinaryOperator =
  '||' | '&&' | '==' | '!=' | '<=' | '>=' | '<' | '>' | '+' | '-' | '*' | '/' | '%';

/**
 * Binary operators, **lowest precedence first**.
 *
 * Within one level the longer spelling is listed first, because a scanner that tests `<` before `<=` reads `a <= b` as
 * a comparison with a stray `=` and gives up. Only operators whose meaning is closed over numbers, strings and booleans
 * appear: bitwise shifts and the rest of the C precedence table are left out, and an expression using them folds to
 * `undefined`.
 */
const BINARY_LEVELS: readonly (readonly BinaryOperator[])[] = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<=', '>=', '<', '>'],
  ['+', '-'],
  ['*', '/', '%'],
];

/** Characters that open a grouping whose end the scanner has to track. */
const OPENERS: ReadonlySet<string> = new Set(['(', '[', '{']);

/** Characters that close one. */
const CLOSERS: ReadonlySet<string> = new Set([')', ']', '}']);

/**
 * Fold an expression to a value, or say that it cannot be decided.
 *
 * @param expression the expression's own source text, without a trailing semicolon
 * @param env values already known for names in scope; a name absent from it makes the expression undecidable
 */
export function evaluateConstant(
  expression: string,
  env: ReadonlyMap<string, ConstantValue>,
  options: FoldOptions = {},
): ConstantValue | undefined {
  return evaluate(expression, env, options.conditionalOrder ?? 'condition-consequence-alternative');
}

function evaluate(
  expression: string,
  env: ReadonlyMap<string, ConstantValue>,
  order: ConditionalOrder,
): ConstantValue | undefined {
  const text = unwrap(expression.trim());
  if (text.length === 0) return undefined;

  const conditional = splitConditional(text, order);
  if (conditional) {
    const condition = evaluate(conditional.condition, env, order);
    if (typeof condition !== 'boolean') return undefined;
    // **Only the arm control reaches is read.** The other one is skipped without being parsed, which is what lets a
    // conditional whose dead arm is an unresolved name still fold.
    return evaluate(condition ? conditional.consequence : conditional.alternative, env, order);
  }

  for (const level of BINARY_LEVELS) {
    const parts = splitTopLevel(text, level);
    if (parts) return foldLevel(parts, env, order);
  }

  const negated = unaryOperand(text, '!');
  if (negated !== null) {
    const value = evaluate(negated, env, order);
    return typeof value === 'boolean' ? !value : undefined;
  }
  const negatedNumber = unaryOperand(text, '-');
  if (negatedNumber !== null) {
    const value = evaluate(negatedNumber, env, order);
    return typeof value === 'number' ? -value : undefined;
  }
  const posited = unaryOperand(text, '+');
  if (posited !== null) {
    const value = evaluate(posited, env, order);
    return typeof value === 'number' ? value : undefined;
  }

  return atom(text, env, order);
}

/** One level of binary operators, folded left to right. */
function foldLevel(
  parts: readonly string[],
  env: ReadonlyMap<string, ConstantValue>,
  order: ConditionalOrder,
): ConstantValue | undefined {
  let accumulator = evaluate(parts[0]!, env, order);
  for (let index = 1; index < parts.length; index += 2) {
    if (accumulator === undefined) return undefined;
    const right = evaluate(parts[index + 1]!, env, order);
    if (right === undefined) return undefined;
    accumulator = OPERATORS[parts[index] as BinaryOperator](accumulator, right);
  }
  return accumulator;
}

/** What each operator means, with no arm that cannot be reached. */
const OPERATORS: Readonly<
  Record<BinaryOperator, (left: ConstantValue, right: ConstantValue) => ConstantValue | undefined>
> = {
  // Concatenation is the one place Java, JavaScript and Python agree: a string on either side makes a string.
  '+': (left, right) =>
    typeof left === 'string' || typeof right === 'string'
      ? `${left}${right}`
      : bothNumbers(left, right, (a, b) => a + b),
  '-': (left, right) => bothNumbers(left, right, (a, b) => a - b),
  '*': (left, right) => bothNumbers(left, right, (a, b) => a * b),
  // Division by zero is not a value to fold: integer and floating semantics differ, and Java throws.
  '/': (left, right) =>
    typeof left === 'number' && typeof right === 'number' && right !== 0 ? left / right : undefined,
  '%': (left, right) =>
    typeof left === 'number' && typeof right === 'number' && right !== 0 ? left % right : undefined,
  '<': (left, right) =>
    compare(
      left,
      right,
      (a, b) => a < b,
      (a, b) => a < b,
    ),
  '<=': (left, right) =>
    compare(
      left,
      right,
      (a, b) => a <= b,
      (a, b) => a <= b,
    ),
  '>': (left, right) =>
    compare(
      left,
      right,
      (a, b) => a > b,
      (a, b) => a > b,
    ),
  '>=': (left, right) =>
    compare(
      left,
      right,
      (a, b) => a >= b,
      (a, b) => a >= b,
    ),
  '==': (left, right) => (typeof left === typeof right ? left === right : undefined),
  '!=': (left, right) => (typeof left === typeof right ? left !== right : undefined),
  '&&': (left, right) =>
    typeof left === 'boolean' && typeof right === 'boolean' ? left && right : undefined,
  '||': (left, right) =>
    typeof left === 'boolean' && typeof right === 'boolean' ? left || right : undefined,
};

/** A numeric operation, or `undefined` when either side is not a number. */
function bothNumbers(
  left: ConstantValue,
  right: ConstantValue,
  operation: (a: number, b: number) => number,
): ConstantValue | undefined {
  return typeof left === 'number' && typeof right === 'number' ? operation(left, right) : undefined;
}

/**
 * An ordering comparison over two numbers or two strings, and nothing else.
 *
 * **Two lambdas rather than one generic one**, because JavaScript's `<` on a `number | string` union is a type error and
 * the narrowing has to happen somewhere; doing it here keeps the operator table a table.
 */
function compare(
  left: ConstantValue,
  right: ConstantValue,
  onNumbers: (a: number, b: number) => boolean,
  onStrings: (a: string, b: string) => boolean,
): ConstantValue | undefined {
  if (typeof left === 'number' && typeof right === 'number') return onNumbers(left, right);
  if (typeof left === 'string' && typeof right === 'string') return onStrings(left, right);
  return undefined;
}

/**
 * Split on one level's operators, or `null` when none appears at the top level.
 *
 * **A leading operator is unary, and an operator after another operator is unary too** — `a * -1` must not split at the
 * minus, and the guard is that the text before it ends with an operand. Groupings and quotes are tracked so an operator
 * inside them is not seen at all.
 */
function splitTopLevel(text: string, operators: readonly string[]): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;

  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quote.length > 0) {
      if (character === '\\') index++;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (OPENERS.has(character)) {
      depth++;
      continue;
    }
    if (CLOSERS.has(character)) {
      depth--;
      continue;
    }
    if (depth !== 0) continue;

    const operator = operators.find((candidate) => text.startsWith(candidate, index));
    if (!operator) continue;
    if (endsWithOperator(text.slice(start, index))) continue;

    parts.push(text.slice(start, index), operator);
    index += operator.length - 1;
    start = index + 1;
  }

  // A level with no operator leaves no split, and a trailing operator leaves an empty operand: neither is this level's
  // expression, so both fall through to the next level down.
  if (parts.length === 0) return null;
  const tail = text.slice(start);
  if (tail.trim().length === 0) return null;
  parts.push(tail);
  return parts;
}

/** Whether an operand position holds something that is not yet an operand. */
function endsWithOperator(prefix: string): boolean {
  const trimmed = prefix.trimEnd();
  if (trimmed.length === 0) return true;
  // **The last character decides, not the whole prefix.** Testing the prefix for *any* operator made `(1 + 2) * 3`
  // unsplittable at the `*`, because the operand before it contains a `+`.
  const last = trimmed[trimmed.length - 1]!;
  return /[+\-*/%<>=!&|?:,([{$.]/.test(last);
}

/** The operand of a prefix operator, or `null` when the text is not one. */
function unaryOperand(text: string, operator: string): string | null {
  if (!text.startsWith(operator)) return null;
  // `!=` is a comparison, not a negation, and it reaches here only when its level found no operator — which means the
  // text is something this evaluator cannot read.
  const operand = text.slice(operator.length).trim();
  return operand.length > 0 ? operand : null;
}

interface ConditionalParts {
  readonly condition: string;
  readonly consequence: string;
  readonly alternative: string;
}

/**
 * The three parts of a conditional expression, or `null` when the text is not one.
 *
 * **The `?` is only a conditional when an operand precedes it**, which is what keeps an optional-chaining `?.` from
 * being read as one.
 */
function splitConditional(text: string, order: ConditionalOrder): ConditionalParts | null {
  if (order === 'consequence-condition-alternative') return splitPythonConditional(text);

  const questionMark = findTopLevelCharacter(text, '?');
  if (questionMark < 0) return null;
  if (text[questionMark + 1] === '.' || text[questionMark + 1] === '?') return null;
  if (endsWithOperator(text.slice(0, questionMark))) return null;

  const colon = matchColon(text, questionMark + 1);
  if (colon < 0) return null;

  return {
    condition: text.slice(0, questionMark),
    consequence: text.slice(questionMark + 1, colon),
    alternative: text.slice(colon + 1),
  };
}

/** Python's `a if condition else b`, whose condition sits between the two arms. */
function splitPythonConditional(text: string): ConditionalParts | null {
  const ifIndex = findTopLevelWord(text, 'if');
  if (ifIndex < 0) return null;
  const elseIndex = findTopLevelWord(text, 'else', ifIndex + 'if'.length);
  if (elseIndex < 0) return null;

  return {
    consequence: text.slice(0, ifIndex),
    condition: text.slice(ifIndex + 'if'.length, elseIndex),
    alternative: text.slice(elseIndex + 'else'.length),
  };
}

/** The first index of a character outside every grouping and quote, or -1. */
function findTopLevelCharacter(text: string, target: string, from = 0): number {
  return scan(text, from, (character) => character === target);
}

/** The first index of a whole word outside every grouping and quote, or -1. */
function findTopLevelWord(text: string, word: string, from = 0): number {
  return scan(
    text,
    from,
    (_character, index) =>
      text.startsWith(word, index) &&
      !isWordCharacter(text[index - 1]) &&
      !isWordCharacter(text[index + word.length]),
  );
}

/** Whether a character can continue an identifier, which is what stops `if` matching the middle of `notify`. */
function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

/** The `:` that closes a conditional's `?`, skipping the ones inside a nested conditional, a grouping or a string. */
function matchColon(text: string, from: number): number {
  let nested = 0;
  let quote = '';
  for (let index = from; index < text.length; index++) {
    const character = text[index]!;
    if (quote.length > 0) {
      if (character === '\\') index++;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '?' && text[index + 1] !== '.' && text[index + 1] !== '?') nested++;
    if (character !== ':') continue;
    if (nested === 0) return index;
    nested--;
  }
  return -1;
}

/**
 * Walk from `from` to the first position outside every grouping and quote that `matches`.
 *
 * Depth is tracked rather than recomputed because an operator inside a grouping belongs to that grouping's own
 * expression, and a colon inside a string is a character.
 */
function scan(
  text: string,
  from: number,
  matches: (character: string, index: number) => boolean,
): number {
  let depth = 0;
  let quote = '';
  for (let index = from; index < text.length; index++) {
    const character = text[index]!;
    if (quote.length > 0) {
      if (character === '\\') index++;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (OPENERS.has(character)) {
      depth++;
      continue;
    }
    if (CLOSERS.has(character)) {
      depth--;
      // An unmatched closer means the text is not an expression this module can read.
      if (depth < 0) return -1;
      continue;
    }
    if (depth === 0 && matches(character, index)) return index;
  }
  return -1;
}

/** Strip parentheses that wrap the whole expression. */
function unwrap(text: string): string {
  let current = text;
  for (;;) {
    if (!current.startsWith('(') || !current.endsWith(')')) return current;
    // The opening parenthesis must close at the very end, or this is `(a) + (b)`.
    let depth = 0;
    let quote = '';
    for (let index = 0; index < current.length; index++) {
      const character = current[index]!;
      if (quote.length > 0) {
        if (character === '\\') index++;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === '(') depth++;
      if (character !== ')') continue;
      depth--;
      if (depth === 0 && index !== current.length - 1) return current;
    }
    current = current.slice(1, -1).trim();
  }
}

/** A literal, or a name the environment already knows, or a call to a method that is a function of its text. */
function atom(
  text: string,
  env: ReadonlyMap<string, ConstantValue>,
  order: ConditionalOrder,
): ConstantValue | undefined {
  const numeric = parseNumericLiteral(text);
  if (numeric !== undefined) return numeric;
  const string = parseStringLiteral(text);
  if (string !== undefined) return string;
  if (text === 'true') return true;
  if (text === 'false') return false;
  const call = splitMethodCall(text);
  if (call) return applyMethod(call, env, order);
  return env.get(text);
}

/**
 * The receiver, method and arguments of `receiver.method(args)`, or `null` when the text is not one.
 *
 * **A whitelist of methods, not a general call**, because a call this module cannot evaluate has to fall out as
 * undecidable rather than as a value. The ones listed in `STRING_METHODS` are total functions of their text, which is
 * what makes folding them sound: `"ABC".charAt(1)` is `'B'` in every JVM, and `guess.charAt(1)` is `'B'` once `guess`
 * is known to be `"ABC"`.
 */
function splitMethodCall(
  text: string,
): { receiver: string; method: string; args: readonly string[] } | null {
  if (!text.endsWith(')')) return null;
  const open = matchingOpenParenthesis(text);
  if (open <= 1) return null;
  const signature = text.slice(0, open);
  const dot = signature.lastIndexOf('.');
  if (dot <= 0) return null;
  const method = signature.slice(dot + 1);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method)) return null;
  const args = splitArguments(text.slice(open + 1, -1));
  if (args === null) return null;
  return { receiver: signature.slice(0, dot), method, args };
}

/** The index of the `(` that the trailing `)` closes, or -1. */
function matchingOpenParenthesis(text: string): number {
  let depth = 0;
  let quote = '';
  for (let index = text.length - 1; index >= 0; index--) {
    const character = text[index]!;
    if (character === '"' || character === "'") {
      // **A quote scans backwards only where it is not escaped**, and the forward scanners get this for free by
      // stepping over the character after a backslash. Scanning from the end has no such step, so `"a\"b"` would
      // otherwise read its escape as a quote that opens a string and never close it - losing the call entirely.
      if (isEscaped(text, index)) continue;
      if (quote.length > 0) {
        if (character === quote) quote = '';
        continue;
      }
      quote = character;
      continue;
    }
    if (quote.length > 0) continue;
    if (character === ')') depth++;
    if (character !== '(') continue;
    depth--;
    if (depth === 0) return index;
  }
  return -1;
}

/** Whether the character at `index` is preceded by an odd number of backslashes, and so is escaped. */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let before = index - 1; before >= 0 && text[before] === '\\'; before--) backslashes++;
  return backslashes % 2 === 1;
}

/** Argument texts, split on commas at the top level. `null` when a nesting is unbalanced. */
function splitArguments(text: string): string[] | null {
  if (text.trim().length === 0) return [];
  const args: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quote.length > 0) {
      if (character === '\\') index++;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (OPENERS.has(character)) depth++;
    else if (CLOSERS.has(character)) depth--;
    else if (character === ',' && depth === 0) {
      args.push(text.slice(start, index));
      start = index + 1;
    }
  }
  if (depth !== 0 || quote.length > 0) return null;
  args.push(text.slice(start));
  return args;
}

/**
 * The value of a text-total method, or `undefined`.
 *
 * **Every arm is a function of the receiver's text and nothing else.** `charAt` and `substring` index it, `length`
 * measures it, `indexOf` searches it, and the three case and whitespace methods rewrite it; nothing here reads state the
 * analysis cannot see, which is the whole reason these and not others are listed.
 */
function applyMethod(
  call: { receiver: string; method: string; args: readonly string[] },
  env: ReadonlyMap<string, ConstantValue>,
  order: ConditionalOrder,
): ConstantValue | undefined {
  const receiver = evaluate(call.receiver, env, order);
  const values = call.args.map((arg) => evaluate(arg, env, order));

  if (typeof receiver === 'string') {
    const text = receiver;
    const indexes = values.map((value) => (typeof value === 'number' ? value : undefined));
    switch (call.method) {
      case 'charAt': {
        const index = indexes[0];
        return index !== undefined && index >= 0 && index < text.length
          ? text.charAt(index)
          : undefined;
      }
      case 'length':
        return call.args.length === 0 ? text.length : undefined;
      case 'substring': {
        const [from, to] = indexes;
        if (from === undefined || from < 0 || from > text.length) return undefined;
        if (call.args.length === 1) return text.slice(from);
        if (to === undefined || to < from || to > text.length) return undefined;
        return text.slice(from, to);
      }
      case 'indexOf': {
        const needle = values[0];
        const needleText = typeof needle === 'string' ? needle : undefined;
        return needleText === undefined ? undefined : text.indexOf(needleText);
      }
      case 'toUpperCase':
        return call.args.length === 0 ? text.toUpperCase() : undefined;
      case 'toLowerCase':
        return call.args.length === 0 ? text.toLowerCase() : undefined;
      case 'trim':
        return call.args.length === 0 ? text.trim() : undefined;
      case 'equals': {
        const other = values[0];
        return typeof other === 'string' ? text === other : undefined;
      }
      case 'equalsIgnoreCase': {
        const other = values[0];
        return typeof other === 'string' ? text.toLowerCase() === other.toLowerCase() : undefined;
      }
      case 'isEmpty':
        return call.args.length === 0 ? text.length === 0 : undefined;
      default:
        return undefined;
    }
  }

  // A numeric receiver has one method worth folding, and only for an integral argument.
  if (typeof receiver === 'number' && call.method === 'toString' && call.args.length === 0) {
    return String(receiver);
  }
  return undefined;
}

/**
 * A numeric literal, or `undefined`.
 *
 * The suffixes Java and C# require (`106L`, `1.5f`) and the separators JavaScript and Java allow (`1_000`) are part of
 * the literal's spelling, not of its value, so they are removed rather than making the literal unrecognisable.
 */
function parseNumericLiteral(text: string): number | undefined {
  const normalised = text.replace(/_/g, '');
  if (/^0[xX][0-9a-fA-F]+[lL]?$/.test(normalised)) {
    return Number.parseInt(normalised.replace(/[lL]$/, ''), 16);
  }
  if (/^0[bB][01]+[lL]?$/.test(normalised)) {
    return Number.parseInt(normalised.replace(/[lL]$/, '').slice(2), 2);
  }
  // A leading zero is octal in Java and C, and a decimal fraction in JavaScript; only the integer form is read here,
  // and `0` itself is decimal.
  if (/^0[0-7]+[lL]?$/.test(normalised)) {
    return Number.parseInt(normalised.replace(/[lL]$/, ''), 8);
  }
  if (!/^\d+(\.\d+)?([eE][+-]?\d+)?[fFdDlL]?$/.test(normalised)) return undefined;
  // **`Number` cannot fail on a spelling that just matched.** The pattern is digits, an optional fraction and an
  // optional exponent, so the conversion is total and a `Number.isNaN` guard beside it was a branch no input takes.
  return Number(normalised.replace(/[fFdDlL]$/, ''));
}

/** A quoted string literal, or `undefined`. An escape this module does not model makes it undecidable. */
function parseStringLiteral(text: string): string | undefined {
  if (text.length < 2) return undefined;
  const quote = text[0];
  if (quote !== '"' && quote !== "'") return undefined;
  if (text[text.length - 1] !== quote) return undefined;

  const escapes: Readonly<Record<string, string>> = {
    n: '\n',
    t: '\t',
    r: '\r',
    '\\': '\\',
    '"': '"',
    "'": "'",
    '0': '\0',
  };

  let value = '';
  for (let index = 1; index < text.length - 1; index++) {
    const character = text[index]!;
    if (character === quote) return undefined;
    if (character !== '\\') {
      value += character;
      continue;
    }
    // **An escape that would consume the closing quote leaves the literal unterminated.** `"a\"` opens and ends with a
    // quote, so the shape check above passes it, but the backslash escapes that quote and the string is never closed -
    // it is a syntax error, not the value `a"`. Folding it would decide a branch on a literal that does not exist.
    if (index + 2 >= text.length) return undefined;
    const replacement = escapes[text[index + 1]!];
    if (replacement === undefined) return undefined;
    value += replacement;
    index++;
  }
  return value;
}
