// @code-analyzer/intelligence — a version is not a magic number
//
// **The defect this pins, in the review's own output.** On 2026-11-10 this product opened inline comments on a
// Dependabot pull request that said:
//
// ```
// 🟢 [style-magic-number] low — Literal values 26.6 should be extracted to named constants for readability.
// 💡 Suggestion: Extract to const: const MEANINGFUL_NAME = 26.6;
// "@types/node": "^26.6.6",
// ```
//
// **Three things were wrong with that and only one of them is the rule's.** The comment could not be anchored (the
// pull request does not touch those lines, and the poster's fallback is a separate fix), the suggestion was not
// applicable to a dependency range, and - the one this file owns - **the number was inside a string literal**, where no
// language on earth calls it a magic number.
//
// So the rule now reads the line with its string literals removed and finds numbers in what is left. **A magic number
// is a value in an expression**, which is what every linter means by the phrase.

import { describe, expect, it } from 'vitest';

import { analyzeStyle } from '../review/lenses/style-lens.js';

const magicNumbersIn = (line: string): string[] =>
  analyzeStyle(line, '/src/example.ts')
    .filter((finding) => finding.evidence.ruleId === 'style-magic-number')
    .map((finding) => finding.title);

describe('a number in a string literal', () => {
  it('is not a magic number, in the form that produced the false positive', () => {
    // The two lines the review actually commented on, verbatim.
    expect(magicNumbersIn('  "@types/node": "^26.6.6",')).toEqual([]);
    expect(magicNumbersIn('  "@vitest/coverage-v8": "^4.1.12",')).toEqual([]);
  });

  it('is not one in any of the other shapes a version takes', () => {
    for (const line of [
      `const version = '18.2.0';`,
      'const url = `https://example.com/v2/items?page=12`;',
      'logger.info("retrying in 5000 ms after 3 attempts");',
      `const re = "(?<digits>[0-9]{42})";`,
    ]) {
      expect(magicNumbersIn(line), line).toEqual([]);
    }
  });

  it('and the escaped quote inside a literal does not end it early', () => {
    // **The pattern's own hazard**: a literal containing `\"` must not be seen as a literal ending at the backslash.
    expect(magicNumbersIn(`const message = "the \\" value is 42";`)).toEqual([]);
  });

  it('but a number in an expression still is, which is the rule', () => {
    // **128 and not 100**: 100 is one of the values the rule allows by name, and an assertion that picked it would be
    // testing the allow-list rather than the stripping.
    const found = magicNumbersIn('  if (items.length > 128) {');
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('128');
  });

  it('and a number beside a string is still found, because the removal is of literals and not of lines', () => {
    const found = magicNumbersIn(`  setTimeout(flush, 2500, 'timeout');`);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('2500');
  });

  it('while the small constants that are never worth naming are still not reported', () => {
    // `3` is in the allowed set, so this asserts the filter still runs after the stripping rather than instead of it.
    expect(magicNumbersIn(`  for (let i = 0; i < 3; i += 1) {`)).toEqual([]);
  });
});
