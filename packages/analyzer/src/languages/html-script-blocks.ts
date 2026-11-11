// @code-analyzer/analyzer — where an inline <script> or <style> block starts and ends

/**
 * The inline blocks a single-file component puts its code in.
 *
 * **Why this is a scanner and not the regular expression it replaces.** The pattern was
 * `/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi`, and it is wrong in three ways that a real file
 * produces:
 *
 * - **A `>` inside a quoted attribute ends the open tag early.** `<script data-template="a > b">`
 *   is one tag to a browser and two to the pattern, so the block's content starts in the middle of
 *   the attribute list.
 * - **An end tag may carry attributes and still end the element.** `</script\t\n bar>` closes a
 *   script to a browser; the pattern requires `>` or whitespace immediately after the name, so it
 *   closes nothing here and the block swallows the template that follows it.
 * - **A tag name is a name, not a prefix.** `<scriptfoo>` is an unknown element, and `\b` after
 *   `script` matches the boundary between `t` and `f`, so the pattern treated it as a script.
 *
 * The first and third of those are why `parseTemplateElements` also used `lastIndexOf('<script')`
 * to decide whether a component tag was inside code. That question is about the same boundaries,
 * so it is answered here as well rather than a second time with a second rule.
 *
 * **Where this deliberately stops.** A browser also hides `</script>` from the parser behind
 * `<!--`, and a `<script type="text/template">` holds markup rather than code. Both are named as
 * limits rather than guessed at: the caller receives the block and decides what its content means,
 * and a block this scan keeps too long is visible in the offsets rather than silent.
 */
export interface InlineBlock {
  /** The block's content, without its open or end tag. */
  readonly content: string;
  /** Offset of `content`'s first character in the source. */
  readonly offset: number;
}

/** A block's extent in the source, end exclusive. */
export interface InlineBlockRange {
  /** Offset of the first character after the open tag. */
  readonly start: number;
  /** Offset of the `<` that opens the end tag, or the source length when there is none. */
  readonly end: number;
}

/**
 * Whether the character at `index` continues a tag name.
 *
 * A tag name ends at whitespace, at `/` and at `>`. Anything else continues it, which is what makes
 * `<scriptfoo>` an element of its own.
 */
function continuesTagName(source: string, index: number): boolean {
  if (index >= source.length) return false;
  const ch = source[index]!;
  return ch !== '>' && ch !== '/' && ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r';
}

/**
 * The offset of the `>` that closes the tag opening at `from`, or `-1`.
 *
 * **A quoted attribute value is skipped rather than scanned**, because a `>` inside one belongs to
 * the value. Both quote characters are honoured, and an unterminated quote runs to the end of the
 * source - which is what a parser waiting for a closing quote does too.
 */
function findTagEnd(source: string, from: number): number {
  let quote: string | null = null;

  for (let index = from; index < source.length; index++) {
    const ch = source[index]!;

    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '>') return index;
  }

  return -1;
}

/**
 * The first `<` + `name` at or after `from` that is followed by a tag boundary, or `-1`.
 *
 * `lower` is the source lower-cased once by the caller, so a file with a thousand tags costs one
 * fold rather than a thousand. No regular expression is involved, for the reason the module header
 * gives: a pattern over unbounded markup is a pattern that has to be read twice to be trusted.
 */
function findTagStart(lower: string, from: number, name: string): number {
  const needle = `<${name}`;
  let at = from;

  for (;;) {
    const index = lower.indexOf(needle, at);
    if (index < 0) return -1;
    if (!continuesTagName(lower, index + needle.length)) return index;
    at = index + 1;
  }
}

/**
 * Every `name` block in `source`, in source order.
 *
 * A block whose end tag is missing runs to the end of the source: that is what a browser does with
 * an unclosed element, and reporting no block would make truncation look like absence.
 */
export function findInlineBlocks(source: string, name: string): InlineBlockRange[] {
  const lower = source.toLowerCase();
  const ranges: InlineBlockRange[] = [];
  let at = 0;

  for (;;) {
    const open = findTagStart(lower, at, name);
    if (open < 0) break;

    const openEnd = findTagEnd(source, open + name.length + 1);
    if (openEnd < 0) break;

    const contentStart = openEnd + 1;
    const close = findTagStart(lower, contentStart, `/${name}`);

    if (close < 0) {
      ranges.push({ start: contentStart, end: source.length });
      break;
    }

    ranges.push({ start: contentStart, end: close });

    const closeEnd = findTagEnd(source, close + name.length + 2);
    // An end tag with no `>` still ends the element. The next scan starts after the name, so a
    // malformed close cannot make the loop revisit the offset that produced it.
    at = closeEnd < 0 ? close + name.length + 2 : closeEnd + 1;
  }

  return ranges;
}

/** Every `name` block in `source`, with its content and the offset that content starts at. */
export function findInlineBlockContents(source: string, name: string): InlineBlock[] {
  return findInlineBlocks(source, name).map((range) => ({
    content: source.slice(range.start, range.end),
    offset: range.start,
  }));
}

/**
 * Whether `index` sits inside one of `ranges`.
 *
 * **Written for a caller walking matches in source order**, so the scan stops at the first range
 * that begins after `index`: a caller that only moves forward therefore examines each range a
 * bounded number of times, whatever the file holds.
 */
export function isInsideRanges(ranges: readonly InlineBlockRange[], index: number): boolean {
  for (const range of ranges) {
    if (index < range.start) return false;
    if (index < range.end) return true;
  }
  return false;
}
