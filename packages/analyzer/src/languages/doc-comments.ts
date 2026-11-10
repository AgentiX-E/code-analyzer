// @code-analyzer/analyzer — the doc-comment blocks of a source file, found by scanning
//
// **The pattern this replaces could not be made linear, and that is the finding.** `\/\*\*([\s\S]*?)\*\//` was a lazy
// body between a delimiter and its terminator; the unrolled form `\/\*\*(?:[^*]|\*(?!\/))*\*\/` - which is what a
// careful author writes - is still quadratic when the terminator is **absent**, because every starting position walks
// to the end of the file and then gives the walk back one character at a time. Measured on forty kilobytes of `/**`
// with no closing `*/`: **502 ms and rising quadratically**, with the same constant as before, which is what the assay
// in `scripts/redos-assay.mjs` reports as `quadratic` on growth alone.
//
// "Find the next `*/` after this `/**`" is a scan. `indexOf` is a scan. Every character is examined a bounded number of
// times, an unterminated comment costs one pass instead of one pass per position, and the contract is small enough to
// test on its own rather than infer from two parsers that happen to call it.

/** One doc comment, with the offsets a caller needs to attribute it to a line. */
export interface DocComment {
  /** The whole comment, delimiters included - what the previous pattern's `m[0]` held. */
  readonly text: string;
  /** Offset of the opening `/`. */
  readonly start: number;
  /** Offset just past the closing `/`. */
  readonly end: number;
}

/**
 * Every `/** … *\/` block in `source`, in the order they appear.
 *
 * **An unterminated opener ends the walk rather than swallowing the rest of the file.** The regex it replaces could not
 * match an unterminated comment either - it simply failed to - so this is the same answer reached in one pass, and a
 * half-written comment at the end of a file in progress is not a comment.
 *
 * **`/*` and `//` are not doc comments** and are skipped by construction: the opener is the three-character `/**`.
 * **An empty body is still a block**, because the delimiters are what make it one.
 */
export function readDocComments(source: string): DocComment[] {
  const comments: DocComment[] = [];
  let at = source.indexOf('/**');
  while (at >= 0) {
    // **From `at + 2` rather than `at + 3`, because an empty block shares a character with its opener.** The four
    // characters open-star-star-slash are one comment whose closing star is the opener's second star, and a search that
    // started past it found no closer and reported an empty block as an unterminated one - which the pattern being
    // replaced did not.
    const close = source.indexOf('*/', at + 2);
    if (close < 0) break;
    const end = close + 2;
    comments.push({ text: source.slice(at, end), start: at, end });
    at = source.indexOf('/**', end);
  }
  return comments;
}
