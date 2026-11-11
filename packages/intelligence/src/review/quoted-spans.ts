// @code-analyzer/intelligence — the spans of a line that are inside quotes
//
// **The pattern this replaces is the one that reads a string literal, and it is quadratic in the run of escapes.** Both
// spellings in this repository - the unrolled `([^"\\]*(?:\\.[^"\\]*)*)` and the alternation `((?:[^"\\]|\\.)*)` - ask, at
// every `\\"`, whether the backslash starts an escape or the quote ends the string, and on a line where the string never
// closes every one of those decisions is tried and re-tried. Measured: **7 ms at five thousand escapes, 30 ms at ten, 118
// ms at twenty** - four times the cost for twice the input - and **1.6 seconds at eighty kilobytes** for the alternation
// and 3.0 for the unrolled form. A file of escaped quotes is not exotic: it is a generated fixture, a minified bundle, a
// JSON blob in a test, or a checkout that was truncated mid-string.
//
// **A scan has one reading.** Walk forward; a quote opens a span; inside a span a backslash takes the next character
// whatever it is; the matching quote closes it. One pass, one interpretation, and an unterminated span is not a span -
// which is also what the pattern did, since it required the closing quote.

/** One quoted span, with the offsets a caller needs to rebuild the line around it. */
export interface QuotedSpan {
  /** The quote character that opened the span, `"`, `'` or `` ` ``. */
  readonly quote: string;
  /** The text between the quotes, escapes untouched. */
  readonly body: string;
  /** Offset of the opening quote. */
  readonly start: number;
  /** Offset just past the closing quote. */
  readonly end: number;
}

/**
 * Every quoted span on a line, left to right, in the order the quotes appear.
 *
 * @param line The text to read. A line, because that is the unit both callers work in and a span does not cross one.
 * @param quotes Which quote characters open a span. `'` and `"` are the two a source file uses; a backtick is a
 *   template, which is a different language in JavaScript and a quoted string everywhere else, so the caller decides.
 */
export function readQuotedSpans(line: string, quotes: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  let at = 0;
  while (at < line.length) {
    const quote = line[at]!;
    if (!quotes.includes(quote)) {
      at += 1;
      continue;
    }
    let cursor = at + 1;
    let closed = -1;
    while (cursor < line.length) {
      const char = line[cursor]!;
      if (char === '\\') {
        // **An escape takes one character, whatever it is** - including the quote, which is the case the pattern could
        // not decide and this one does not have to.
        cursor += 2;
        continue;
      }
      if (char === quote) {
        closed = cursor;
        break;
      }
      cursor += 1;
    }
    if (closed < 0) break;
    spans.push({ quote, body: line.slice(at + 1, closed), start: at, end: closed + 1 });
    at = closed + 1;
  }
  return spans;
}

/**
 * The line with the body of every quoted span replaced, so that what remains is code.
 *
 * `replaceQuotedBodies('const a = "x";', '"', '')` gives `const a = "";`. **A replacement that keeps the quotes is
 * what a reader of an expression wants**: the string is still there and its contents are not.
 */
export function replaceQuotedBodies(line: string, quotes: string, replacement: string): string {
  const spans = readQuotedSpans(line, quotes);
  if (spans.length === 0) return line;
  let out = '';
  let at = 0;
  for (const span of spans) {
    out += line.slice(at, span.start) + span.quote + replacement + span.quote;
    at = span.end;
  }
  return out + line.slice(at);
}
