// @code-analyzer/analyzer — a C signature is read in one pass, whatever the line is made of
//
// **The pattern was quadratic in a way a pull request could choose.** Two nullable whitespace quantifiers sat next to
// each other - the qualifier run's trailing `[ \t]+` and the star group's `[ \t]*` - so the engine could split one
// whitespace run between them at every word boundary it had consumed. On a line of 8 000 short words followed by
// 24 000 spaces and no `(`, the old pattern took **1 869 ms**; the rewritten one takes **1 ms**. Nothing exotic is
// needed to produce that line: it is `int a a a a …` followed by an indent, which is what a generated header is.
//
// **The pattern is driven directly here, not only through the provider.** Every provider that hands a file to a regular
// expression first masks lines longer than `OVERLONG_LINE_BUDGET`, so a test through `parse()` alone measures the mask
// and stops before the pattern's own worst case. **The mask is a mitigation, not the fix** - a line at the budget is
// still quadratic - and a cost test that cannot see past the mask cannot say whether the pattern under it is linear.
//
// **Equivalence is the reason this is a rewrite and not a different parser.** The three spellings of a pointer return
// type that the star group exists for, two definitions on one line, and the shapes that must not be read as definitions
// are asserted through the provider, because a pattern that is right in isolation and wrong once its captures are
// indexed is still wrong.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { CProvider, cSignaturePattern } from '../languages/c.js';

import type { UnifiedCapture } from '@code-analyzer/shared';

/** CProvider with tree-sitter disabled, which is the path the pattern under test lives on. */
class RegexCProvider extends CProvider {
  constructor() {
    super();
    this.parser = null;
    this.languageGrammar = null;
  }
}

/** The names of the function definitions the provider captured. */
function functionNames(code: string): string[] {
  return new RegexCProvider()
    .parse(code, 'signature.c')
    .filter((capture: UnifiedCapture) => capture.tag === CAPTURE_TAGS.FUNCTION_DEF)
    .map((capture: UnifiedCapture) => capture.name ?? '');
}

/** Every signature name in a text, read by the pattern itself. */
function signatures(text: string): string[] {
  const pattern = cSignaturePattern();
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    found.push(match[3]!);
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return found;
}

describe('the signature pattern reads the same shapes it always did', () => {
  it.each([
    ['int main(void) {', ['main']],
    ['int* fp(void) {', ['fp']],
    ['int *fp(void) {', ['fp']],
    ['int * fp(void) {', ['fp']],
    ['static const char *name(int a) {', ['name']],
    ['int b() {} int a() {}', ['b', 'a']],
  ])('reads %s as %j', (code, expected) => {
    expect(functionNames(code)).toEqual(expected);
    // The pattern is asserted in the same breath, so a provider-level guard cannot hide a pattern-level regression.
    expect(signatures(code)).toEqual(expected);
  });

  it('does not read a call as a declaration', () => {
    expect(functionNames('foo(1, 2);')).toEqual([]);
    expect(functionNames('x = y(1);')).toEqual([]);
    expect(signatures('if (a) {')).toEqual([]);
  });

  it('still reads a declaration that follows an indent the analyzer does not mask', () => {
    // 600 spaces is under `OVERLONG_LINE_BUDGET`, so this line reaches the pattern the way a real indented line does.
    expect(functionNames(`\n${' '.repeat(600)}int later(void) {`)).toEqual(['later']);
  });

  it('gives every caller its own cursor', () => {
    // A `/g` pattern carries `lastIndex`. Two parses of the same file must not start where the first one stopped.
    const code = 'int first(void) {\nint second(void) {';
    expect(functionNames(code)).toEqual(['first', 'second']);
    expect(functionNames(code)).toEqual(['first', 'second']);
  });
});

describe('the signature pattern cannot be made to crawl', () => {
  it('reads a line of short words followed by an unclosed indent in linear time', () => {
    // The shape both nullable whitespace quantifiers were quadratic on: 8 000 words, 24 000 spaces, no `(`.
    const text = `\n${'a '.repeat(8_000)}${' '.repeat(24_000)}`;

    const started = performance.now();
    const found = signatures(text);
    const elapsed = performance.now() - started;

    // The old pattern took 1 869 ms on this input on the same machine; the bound is loose on purpose, because it is
    // answering "linear or not" rather than "how fast is this machine".
    expect(elapsed).toBeLessThan(400);
    expect(found).toEqual([]);
  });

  it('reads a long run of stars and spaces at the same cost', () => {
    const text = `\nint ${'*'.repeat(4_000)} ${' '.repeat(8_000)}not_a_definition`;

    const started = performance.now();
    signatures(text);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(400);
  });
});
