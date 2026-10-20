import { describe, expect, it } from 'vitest';

import { textOfContentStream, unescapePdfString } from '../languages/pdf-text.js';

/**
 * The escape handling in `unescapePdfString`, driven case by case.
 *
 * **Why this file exists**: `pdf-text.ts` reported **34 uncovered branches**, and **all of them were in two pure
 * functions** - **`unescapePdfString` and `textOfContentStream`**. **A pure function is the easiest thing in this
 * repository to test and it was the least tested**, because **its only caller takes a PDF buffer**, and **nobody
 * constructed one**.
 *
 * **So the functions are exported**, which is **a statement that they are worth calling directly**: **they have no
 * state, no I/O, and one job each.** **Testing them through a buffer would test the buffer.**
 */
describe('unescapePdfString', () => {
  it('passes ordinary characters through', () => {
    expect(unescapePdfString('hello')).toBe('hello');
  });

  it('unescapes each named escape', () => {
    // L42-L46: the five single-letter escapes.
    expect(unescapePdfString('a\\nb')).toBe('a\nb');
    expect(unescapePdfString('a\\rb')).toBe('a\rb');
    expect(unescapePdfString('a\\tb')).toBe('a\tb');
    expect(unescapePdfString('a\\bb')).toBe('a\bb');
    expect(unescapePdfString('a\\fb')).toBe('a\fb');
  });

  it('unescapes the three punctuation escapes', () => {
    // L47, both sides of each `||`.
    expect(unescapePdfString('\\(')).toBe('(');
    expect(unescapePdfString('\\)')).toBe(')');
    expect(unescapePdfString('\\\\')).toBe('\\');
  });

  it('unescapes a three-digit octal escape', () => {
    // L49-L53: the loop runs twice and both iterations accept a digit.
    expect(unescapePdfString('\\101')).toBe('A');
  });

  it('unescapes a two-digit octal escape and stops at a non-digit', () => {
    // L56: the `else break` when the next character is not octal.
    expect(unescapePdfString('\\10Z')).toBe('\bZ');
  });

  it('unescapes a one-digit octal escape at end of input', () => {
    // L53's false side on the second iteration, because the input ends.
    expect(unescapePdfString('\\7')).toBe('\u0007');
  });

  it('breaks on a trailing backslash rather than emitting it', () => {
    // L41: `next === undefined`, the branch a truncated literal reaches.
    expect(unescapePdfString('abc\\')).toBe('abc');
  });

  it('passes an unknown escape through unchanged', () => {
    // L59: the final `else`, which a `\q` reaches.
    expect(unescapePdfString('\\q')).toBe('q');
  });
});

describe('textOfContentStream', () => {
  it('returns the empty string for a stream with no text operators', () => {
    expect(textOfContentStream('')).toBe('');
  });

  it('extracts text from a Tj operator', () => {
    // L86/L87: the text-showing branches.
    const out = textOfContentStream('BT /F1 12 Tf (Hello) Tj ET');
    expect(out).toContain('Hello');
  });

  it('extracts text from a TJ array', () => {
    const out = textOfContentStream('BT [(Hel) -20 (lo)] TJ ET');
    expect(out).toContain('Hel');
    expect(out).toContain('lo');
  });

  it('concatenates two runs with no positioning between them, because that is what a PDF says', () => {
    // **And this is the case where my first assertion was wrong and the implementation was right.**
    //
    // **Two `Tj` operators with nothing between them render adjacent**, so `(a) Tj (b) Tj` IS `ab` - **there is no space
    // in the file and none on the page.** **I had asserted that separate runs are separate words**, and **that is true
    // of a page, not of a content stream**: **the separation in a PDF is done by `Td`/`TD`/`T*`, not by starting a new
    // `Tj`.**
    expect(textOfContentStream('BT (a) Tj (b) Tj ET')).toBe('ab\n');
  });

  it('separates runs that are positioned with Td', () => {
    // **`Td` is the operator that says "move"**, so this is where a word break comes from.
    const out = textOfContentStream('BT (a) Tj Td (b) Tj ET');
    expect(out).toContain('a');
    expect(out.split('\n').filter((s) => s.length > 0).length).toBeGreaterThanOrEqual(2);
  });
});
