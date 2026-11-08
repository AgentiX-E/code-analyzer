// @code-analyzer/analyzer — the line table a text provider reads instead of slicing
//
// **A line number is a lookup, and every text provider was computing it by copying the file.** The idiom was
// `source.slice(0, offset).split('\n').length`, which is correct, obvious, and O(offset) - so a provider that emits
// `m` captures over a file of `n` bytes copies `O(n * m)` characters to label them. On a 1 MB file with two thousand
// declarations that is two gigabytes of string allocation for two thousand integers, and the cost is invisible in any
// test whose fixture is a hundred lines.
//
// **The table is built once per source and read by binary search.** `lineStarts` holds the offset of the first
// character of every line; the line containing an offset is the last start at or before it, which a binary search
// finds in `O(log lines)`. Building it is one pass over the source, so a provider that asks for one line number pays
// one scan and a provider that asks for ten thousand pays the same one.

/** Offsets of every line start, plus the two lookups a provider needs from them. */
export interface LineIndex {
  /** Offsets of the first character of each line, ascending. `starts[0]` is always `0`. */
  readonly starts: readonly number[];
  /** How many lines the source has, counting a final line that is empty after its newline. */
  readonly lineCount: number;
  /** The 1-based line number that contains `offset`. */
  lineOf(offset: number): number;
  /** The offset of the first character of a 1-based line; `0` past the end. */
  offsetOf(line: number): number;
}

/**
 * The line table for a source.
 *
 * **A trailing newline does not open a line.** `"a\n"` has one line and not two, which is what every editor and every
 * compiler diagnostic means by "line 1"; the empty string has one line, because an offset of `0` in an empty file is
 * a position on line 1 rather than an error.
 */
export function createLineIndex(source: string): LineIndex {
  const starts: number[] = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  // **A file that ends with a newline has no line after it**, so the last start is not a line - but it stays in the
  // table, because the offset *at* the end of such a file is the position `split` calls the next (empty) line, and a
  // table that answered differently from the slice it replaces would be a new arithmetic rather than a faster one.
  const trailing = starts.length > 1 && starts[starts.length - 1] === source.length;
  const lineCount = trailing ? starts.length - 1 : starts.length;
  return {
    starts,
    lineCount,
    lineOf(offset: number): number {
      // **Clamped rather than thrown on**: a caller holding a byte offset from a regex match is inside the source by
      // construction, and a provider that overshoots by one is a label rather than a defect.
      const target = offset < 0 ? 0 : offset;
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if ((starts[middle] as number) <= target) low = middle;
        else high = middle - 1;
      }
      return low + 1;
    },
    offsetOf(line: number): number {
      if (line <= 1) return 0;
      return starts[line - 1] ?? source.length;
    },
  };
}

/**
 * The 1-based line number of an offset, with the line table kept from the last call.
 *
 * **One entry, because the calls arrive in runs.** Every provider computes a line number per capture over the *same*
 * source, so a single-entry memo turns `m` scans of `n` bytes into one, which is the whole difference between
 * `O(n * m)` and `O(n + m log n)`. A second source interleaved with the first rebuilds the table and cannot make
 * anything slower than the copy it replaces, so the cache is a bound on the old cost rather than a new risk.
 *
 * `starts` is compared by reference first: the same file arriving twice is the common case, and identity is `O(1)`
 * where a value comparison of two long strings would not be.
 */
let lastSource: string | null = null;
let lastIndex: LineIndex | null = null;

export function lineOf(source: string, offset: number): number {
  if (source !== lastSource) {
    lastSource = source;
    lastIndex = createLineIndex(source);
  }
  return (lastIndex as LineIndex).lineOf(offset);
}

/**
 * The same source with every line longer than `budget` blanked, and the count of lines that were.
 *
 * **Same length, same newlines, same offsets** - the mask is a `\u0000` fill rather than a truncation, because every
 * capture a provider emits carries a byte offset and a line number into the *original* file, and shifting either would
 * put the answer somewhere the code is not.
 *
 * **Why a line has a budget at all, and why the fill is NUL.** A declaration pattern is a scan for a shape that
 * appears near the start of a line; a line of fifty thousand characters is a data literal, a minified bundle or a
 * generated table, and the patterns cost their worst case on exactly those inputs - `\s+` before a word backtracked
 * once per position is cubic in the line length. Measured with the hostile fixture in `hostile-input.test.ts`, the
 * four regex-only providers returned **the same zero captures** on such a line and took 1.5 to 5 seconds to say so.
 * NUL is the fill rather than a space because a space is what `\s` matches: filling with spaces leaves the ambiguity
 * that caused the cost, while NUL is not `\s`, not `\w`, and not in any character class a declaration pattern uses.
 */
export interface OverlongMask {
  readonly text: string;
  /** How many lines were blanked. */
  readonly lines: number;
  readonly budget: number;
}

/** Blank every line longer than `budget`. */
export function maskOverlongLines(source: string, budget: number): OverlongMask {
  if (source.length <= budget) return { text: source, lines: 0, budget };
  let text = '';
  let blanked = 0;
  let start = 0;
  for (let index = 0; index <= source.length; index += 1) {
    const atEnd = index === source.length;
    if (!atEnd && source.charCodeAt(index) !== 10) continue;
    const line = source.slice(start, index);
    if (line.length > budget) {
      text += '\u0000'.repeat(line.length);
      blanked += 1;
    } else {
      text += line;
    }
    if (!atEnd) text += '\n';
    start = index + 1;
  }
  return { text, lines: blanked, budget };
}

/**
 * The length at which a line stops being code and starts being data.
 *
 * **Chosen by measurement rather than taste.** The hostile fixture in `hostile-input.test.ts` is one line of 8 000 to
 * 50 000 characters; at this budget every provider in the analyzer reads it in under a tenth of a second, and at
 * twice the budget the regex-only providers are already seconds behind it. Four thousand characters is also forty
 * times the widest line any formatter in this repository produces, so nothing a person wrote is masked.
 */
export const OVERLONG_LINE_BUDGET = 4_000;
