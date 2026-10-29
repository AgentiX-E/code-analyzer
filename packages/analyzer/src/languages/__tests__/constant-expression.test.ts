// The evaluator's contract, one property at a time.
//
// **The negative cases are the point.** A folding mistake here does not make the analysis slower, it makes it stop
// reporting a real vulnerability - so every "cannot decide" below is as load-bearing as every value.

import { describe, expect, it } from 'vitest';

import { evaluateConstant, type ConstantValue, type FoldOptions } from '../constant-expression.js';

function fold(
  expression: string,
  bindings: Record<string, ConstantValue> = {},
  options?: FoldOptions,
): ConstantValue | undefined {
  return evaluateConstant(expression, new Map(Object.entries(bindings)), options);
}

describe('arithmetic on literals', () => {
  it('applies precedence and parentheses', () => {
    expect(fold('1 + 2 * 3')).toBe(7);
    expect(fold('(1 + 2) * 3')).toBe(9);
    expect(fold('(7 * 18) + 106')).toBe(232);
    expect(fold('100 / 4')).toBe(25);
    expect(fold('7 % 4')).toBe(3);
    expect(fold('10 - 3 - 2')).toBe(5);
  });

  // **Every operator in the table, on both of the types it accepts.** The corpus reaches `<` and `>` far more often
  // than the others, so an operator that is spelled wrong in the table - `<` scanning as `<=`, `!=` scanning as `!` -
  // would only show up as an unfolded expression, which is indistinguishable from a name the analysis does not know.
  it('reads every comparison on two numbers, and every arithmetic operator', () => {
    expect(fold('1 < 2')).toBe(true);
    expect(fold('2 <= 2')).toBe(true);
    expect(fold('2 > 1')).toBe(true);
    expect(fold('2 >= 3')).toBe(false);
    expect(fold('1 == 1')).toBe(true);
    expect(fold('1 != 2')).toBe(true);
    expect(fold('2 * 3')).toBe(6);
    expect(fold('7 - 2')).toBe(5);
  });

  it('reads the literal spellings Java and JavaScript allow', () => {
    expect(fold('1_000')).toBe(1000);
    expect(fold('106L')).toBe(106);
    expect(fold('1.5f')).toBe(1.5);
    expect(fold('0x1F')).toBe(31);
    expect(fold('0b1010')).toBe(10);
    expect(fold('010')).toBe(8);
    expect(fold('1e3')).toBe(1000);
  });

  it('refuses what it cannot decide, rather than guessing', () => {
    expect(fold('1 / 0')).toBeUndefined();
    expect(fold('1 % 0')).toBeUndefined();
    expect(fold('nope')).toBeUndefined();
    expect(fold('obj.field')).toBeUndefined();
    expect(fold('Math.max(1, 2)')).toBeUndefined();
    expect(fold("'unterminated")).toBeUndefined();
    expect(fold('')).toBeUndefined();
  });

  // The other half of the table: an operator applied to the wrong types is not a value, and neither is an operand
  // that never arrives.
  it('refuses an operator whose operands are the wrong type', () => {
    expect(fold('"a" - 1')).toBeUndefined();
    expect(fold('true * 2')).toBeUndefined();
    expect(fold('1 || 2')).toBeUndefined();
    expect(fold('1 && 2')).toBeUndefined();
  });

  it('refuses a sign on a non-number, and an operand that is missing', () => {
    expect(fold('+"a"')).toBeUndefined();
    expect(fold('1 +')).toBeUndefined();
    expect(fold('!')).toBeUndefined();
    expect(fold('!1')).toBeUndefined();
  });
});

describe('names resolved from the environment', () => {
  it('substitutes a known name and refuses an unknown one', () => {
    expect(fold('num > 200', { num: 106 })).toBe(false);
    expect(fold('num > 200', { num: 232 })).toBe(true);
    expect(fold('num > 200', {})).toBeUndefined();
    expect(fold('a + b', { a: 1 })).toBeUndefined();
  });

  it('keeps a name distinct from a longer name that starts with it', () => {
    expect(fold('num2', { num: 1 })).toBeUndefined();
    expect(fold('num2', { num: 1, num2: 2 })).toBe(2);
  });
});

describe('strings', () => {
  it('concatenates when either side is a string', () => {
    expect(fold('"a" + "b"')).toBe('ab');
    expect(fold('"n=" + 7')).toBe('n=7');
    expect(fold('7 + "n"')).toBe('7n');
  });

  it('reads escapes it models and refuses those it does not', () => {
    expect(fold('"a\\tb"')).toBe('a\tb');
    expect(fold("'it\\'s'")).toBe("it's");
    expect(fold('"a\\qb"')).toBeUndefined();
    expect(fold('"a" + "b')).toBeUndefined();
  });

  // **A literal whose backslash escapes the closing quote has no closing quote.** It opens and ends with a `"`, so the
  // shape check passes it, but there is nothing left to close the string: folding it to `a"` would decide a branch on
  // a value the compiler rejects.
  it('refuses a literal whose closing quote is escaped, and one that closes early', () => {
    expect(fold('"a\\"')).toBeUndefined();
    expect(fold('"a"b"')).toBeUndefined();
  });

  it('compares two strings only with two strings', () => {
    expect(fold('"abc" < "abd"')).toBe(true);
    expect(fold('"b" >= "a"')).toBe(true);
    expect(fold('"a" < 1')).toBeUndefined();
    expect(fold('"a" == 1')).toBeUndefined();
  });
});

describe('booleans and negation', () => {
  it('folds logical operators only over two booleans', () => {
    expect(fold('true && false')).toBe(false);
    expect(fold('true || false')).toBe(true);
    expect(fold('!true')).toBe(false);
    expect(fold('true && 1')).toBeUndefined();
    expect(fold('!1')).toBeUndefined();
  });

  it('folds a sign without mistaking a binary operator for it', () => {
    expect(fold('-5')).toBe(-5);
    expect(fold('+5')).toBe(5);
    expect(fold('2 * -3')).toBe(-6);
    expect(fold('2 - -3')).toBe(5);
    expect(fold('-"a"')).toBeUndefined();
  });
});

describe('conditional expressions', () => {
  // The corpus that motivated this module: OWASP Benchmark's constant-condition dead branch.
  const OWASP_SAFE = '(7 * 18) + num > 200 ? "This_should_always_happen" : param';
  const OWASP_VULNERABLE = '(7 * 18) + num > 200 ? param : "This_should_always_happen"';

  it('folds the arm control reaches, and only that arm', () => {
    expect(fold(OWASP_SAFE, { num: 106 })).toBe('This_should_always_happen');
    // The vulnerable variant resolves to an unknown name, which is exactly "cannot be decided".
    expect(fold(OWASP_VULNERABLE, { num: 106 })).toBeUndefined();
  });

  it('takes the alternative when the condition is false', () => {
    expect(fold('num > 200 ? "a" : "b"', { num: 1 })).toBe('b');
    expect(fold('num > 200 ? "a" : "b"', { num: 999 })).toBe('a');
  });

  it('refuses a condition that is not a boolean', () => {
    expect(fold('num ? "a" : "b"', { num: 1 })).toBeUndefined();
    expect(fold('param ? "a" : "b"', {})).toBeUndefined();
  });

  it('reads a nested conditional without losing the outer colon', () => {
    expect(fold('x ? (y ? 1 : 2) : 3', { x: false, y: true })).toBe(3);
    expect(fold('x ? (y ? 1 : 2) : 3', { x: true, y: true })).toBe(1);
    expect(fold('x ? (y ? 1 : 2) : 3', { x: true, y: false })).toBe(2);
  });

  it('does not read optional chaining or a nullish operator as a conditional', () => {
    expect(fold('a?.b')).toBeUndefined();
    expect(fold('a ?? b')).toBeUndefined();
  });

  // The `?` is a conditional only where an operand precedes it and a `:` closes it. Anything else is an expression this
  // evaluator has no reading for, and the arm it would otherwise skip is exactly the arm that may carry the flow.
  it('refuses a conditional missing an operand or its colon', () => {
    expect(fold('1 + ? "a" : "b"')).toBeUndefined();
    expect(fold('x ? y')).toBeUndefined();
    expect(fold('x ? "a" :')).toBeUndefined();
  });

  it('reads Python order when the language puts the condition in the middle', () => {
    const python: FoldOptions = { conditionalOrder: 'consequence-condition-alternative' };
    expect(fold('"a" if num > 200 else param', { num: 232 }, python)).toBe('a');
    expect(fold('param if num > 200 else "b"', { num: 232 }, python)).toBeUndefined();
    expect(fold('"a" if num > 200 else "b"', { num: 1 }, python)).toBe('b');
    // `notify` contains `if`, and a word boundary is what keeps it from being read as a conditional.
    expect(fold('notify("x")', {}, python)).toBeUndefined();
    // Without an `else` there is no alternative arm, so this is not Python's conditional at all.
    expect(fold('"a" if num > 200', { num: 232 }, python)).toBeUndefined();
  });
});

describe('grouping', () => {
  it('unwraps parentheses that hold the whole expression, and only those', () => {
    expect(fold('((1))')).toBe(1);
    expect(fold('(1) + (2)')).toBe(3);
    expect(fold('("a)")')).toBe('a)');
    expect(fold('(1')).toBeUndefined();
  });

  // A quote inside the grouping hides its parentheses, including the escaped quote that would otherwise close it.
  it('tracks a quoted parenthesis while deciding what the grouping holds', () => {
    expect(fold('("a\\")b")')).toBe('a")b');
  });

  it('refuses an unmatched closer rather than reading past it', () => {
    expect(fold('1) + (2')).toBeUndefined();
  });
});

describe('methods that are functions of their text', () => {
  it('indexes and measures a string the environment already knows', () => {
    // The corpus's `switch` shape: `char switchTarget = guess.charAt(1)` with `guess = "ABC"`.
    expect(fold('guess.charAt(1)', { guess: 'ABC' })).toBe('B');
    expect(fold('"ABC".charAt(0)')).toBe('A');
    expect(fold('"ABC".length()')).toBe(3);
    expect(fold('"abcdef".substring(2)')).toBe('cdef');
    expect(fold('"abcdef".substring(1, 3)')).toBe('bc');
    expect(fold('"abcabc".indexOf("ca")')).toBe(2);
  });

  it('rewrites a string only where the rewrite is total', () => {
    expect(fold('"abc".toUpperCase()')).toBe('ABC');
    expect(fold('"ABC".toLowerCase()')).toBe('abc');
    expect(fold('"  a ".trim()')).toBe('a');
    expect(fold('"abc".equals("abc")')).toBe(true);
    expect(fold('"abc".equalsIgnoreCase("ABC")')).toBe(true);
    expect(fold('"".isEmpty()')).toBe(true);
    expect(fold('7.toString()')).toBe('7');
  });

  it('refuses a call it cannot evaluate instead of assuming a value', () => {
    expect(fold('"ABC".charAt(9)')).toBeUndefined();
    expect(fold('"ABC".charAt(-1)')).toBeUndefined();
    expect(fold('"ABC".substring(9)')).toBeUndefined();
    expect(fold('"ABC".substring(2, 1)')).toBeUndefined();
    expect(fold('param.charAt(1)')).toBeUndefined();
    expect(fold('"abc".matches(".*")')).toBeUndefined();
    expect(fold('"abc".equals(1)')).toBeUndefined();
    expect(fold('"abc".length(1)')).toBeUndefined();
    expect(fold('"abc".indexOf(1)')).toBeUndefined();
    expect(fold('list.size()')).toBeUndefined();
    expect(fold('(a, b)')).toBeUndefined();
  });

  // **A call is read only when its shape is unambiguous.** A name with no receiver, a method that is not an identifier,
  // an unbalanced argument list and a grouping that never closes all describe something else, and something else is
  // "cannot decide" - the answer that keeps a branch open rather than closing it on a guess.
  it('refuses a call whose shape it cannot read', () => {
    expect(fold('a()')).toBeUndefined();
    expect(fold('x.1()')).toBeUndefined();
    expect(fold('"a".charAt((1)')).toBeUndefined();
    expect(fold('"a".charAt("x)')).toBeUndefined();
    // A nested grouping inside an argument is balanced, so it is read as the argument it wraps.
    expect(fold('"abc".indexOf(("a"))')).toBe(0);
    // A quoted comma is part of the argument, not a separator; a quoted escape is skipped by the splitter.
    expect(fold('"a,b".indexOf("b")')).toBe(2);
    expect(fold('"abc".equals("a\\"b")')).toBe(false);
  });

  // The methods that take no argument refuse one, because the arity is part of what makes them total.
  it('refuses an argument to a method that has none', () => {
    expect(fold('"abc".toUpperCase(1)')).toBeUndefined();
    expect(fold('"ABC".toLowerCase(1)')).toBeUndefined();
    expect(fold('" a ".trim(1)')).toBeUndefined();
    expect(fold('"abc".equalsIgnoreCase(1)')).toBeUndefined();
    expect(fold('"".isEmpty(1)')).toBeUndefined();
    expect(fold('7.toString(1)')).toBeUndefined();
  });

  it('folds a method call inside a larger expression', () => {
    expect(fold('guess.charAt(1) == "B"', { guess: 'ABC' })).toBe(true);
    expect(fold('guess.charAt(1) == "B" ? "yes" : param', { guess: 'ABC' })).toBe('yes');
    expect(fold('"x" + guess.charAt(0)', { guess: 'ABC' })).toBe('xA');
  });
});
