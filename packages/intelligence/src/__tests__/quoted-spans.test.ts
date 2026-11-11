// @code-analyzer/intelligence — the scan that replaced the string-literal pattern
//
// **The scan is a function, so its contract is checked rather than inferred from the two lenses that use it.** The
// pattern it replaced had two spellings in this repository and both were exponential in the number of escapes: a line of
// `\"` costs time proportional to two to the power of the escapes, and eighty kilobytes of them measured **three
// seconds**. What the scan has to be right about is what the pattern was right about - an escaped quote does not close a
// string - and what it has to be right about that the pattern was not: the number of readings.

import { describe, expect, it } from 'vitest';

import { readQuotedSpans, replaceQuotedBodies } from '../review/quoted-spans.js';

describe('readQuotedSpans', () => {
  it('reads a double-quoted span', () => {
    const spans = readQuotedSpans('const a = "x";', '"');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ quote: '"', body: 'x', start: 10, end: 13 });
  });

  it('does not close a span on an escaped quote', () => {
    // **The case the pattern could not decide.** `\"` is not the end of the string, and a reader that stops there reads
    // the rest of the line as code.
    const spans = readQuotedSpans('const a = "he said \\"hi\\" twice";', '"');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.body).toBe('he said \\"hi\\" twice');
  });

  it('treats a backslash before a backslash as a single escape, so the quote after it closes', () => {
    // `"a\\\\"` is the two-character body `\\` and then the closing quote. A scanner that counted escapes in pairs would
    // read the closing quote as escaped and swallow the rest of the line.
    const spans = readQuotedSpans('const a = "a\\\\";', '"');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.body).toBe('a\\\\');
  });

  it('reads spans in the order they appear, whatever the quote', () => {
    const spans = readQuotedSpans(`a = 'one' + "two" + 'three'`, `'"`);
    expect(spans.map((span) => span.body)).toEqual(['one', 'two', 'three']);
    expect(spans.map((span) => span.quote)).toEqual(["'", '"', "'"]);
  });

  it('reads only the quotes it was asked for', () => {
    // A backtick is a template literal in JavaScript and ordinary text in YAML, so the caller decides.
    expect(readQuotedSpans('a = `x` + "y"', '"').map((span) => span.body)).toEqual(['y']);
    expect(readQuotedSpans('a = `x` + "y"', '`"').map((span) => span.body)).toEqual(['x', 'y']);
  });

  it('answers nothing for an unterminated span, because an unclosed string is not a string', () => {
    expect(readQuotedSpans('const a = "no closing quote', '"')).toHaveLength(0);
    expect(readQuotedSpans('const a = "opened then \\" escaped', '"')).toHaveLength(0);
  });

  it('reads a span that starts and ends at the first character', () => {
    expect(readQuotedSpans('""', '"')).toHaveLength(1);
    expect(readQuotedSpans('""', '"')[0]!.body).toBe('');
  });
});

describe('replaceQuotedBodies', () => {
  it('replaces the body of every span and keeps the quotes', () => {
    expect(replaceQuotedBodies('const a = "x" + \'y\';', `'"`, '')).toBe('const a = "" + \'\';');
  });

  it('leaves a line with no span alone', () => {
    expect(replaceQuotedBodies('const a = 1;', `'"`, '')).toBe('const a = 1;');
  });

  it('does not re-read the text it produced', () => {
    // **The replacement is a body, not a pattern**, so a quote in the replacement cannot open a new span.
    expect(replaceQuotedBodies(`a = "x"`, '"', '"')).toBe('a = """');
  });

  it('keeps everything between two spans', () => {
    expect(replaceQuotedBodies(`"a" and "b"`, '"', '')).toBe(`"" and ""`);
  });
});

describe('the cost of reading a line of escapes', () => {
  it('is linear rather than exponential', () => {
    // **Two spells of this pattern cost seconds here.** At four kilobytes the unrolled form measured 29 ms and the
    // alternation 17 ms; at forty they measured **3 045 ms and 1 654 ms**, which is the signature of an exponential and
    // not of a slow constant. The assertion is a ceiling well above the scan's own cost and far below either.
    const read = (characters: number): number => {
      const line = `const a = "${'\\"'.repeat(characters / 2)}";`;
      const started = performance.now();
      readQuotedSpans(line, '"');
      return performance.now() - started;
    };
    read(40_000);
    const elapsed = read(400_000);
    expect(
      elapsed,
      `reading 400 000 characters of escapes took ${String(Math.round(elapsed))} ms`,
    ).toBeLessThan(50);
  });
});
