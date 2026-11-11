// @code-analyzer/intelligence — The code around the change, because a hunk is not a function
//
// **The problem this file answers, stated as the measurement that found it.** On the AACR-Bench artifact of
// 2026-11-11, 160 of the 282 expert-confirmed issues on thirty-six pull requests had a finding standing on the
// golden's own lines that the judge did not accept, and **91 of those rejections were on the exact line** - so the
// reviewer was not looking in the wrong place, it was saying the wrong thing about the right one. A finding that says
// "consider validating the input" where a reviewer said "this deletes the secret when the value is falsy" is what a
// review looks like when it can see five added lines and not the function they sit in: **a hunk carries the change and
// not the contract the change has to keep.**
//
// **What the competitor does differently, from its own logs.** `open-code-review` runs `code_search` and `file_read`
// before it comments - it reads the definition and the call sites, and then says what breaks. That is not a better
// sentence, it is a wider input, and it is why the same corpus gives it 113 accepted findings against our 59 on
// near-identical emission.
//
// **What this file is not.** It is not a repository indexer: the tokens it adds are bounded per file and per pull
// request, and the bound is a parameter because a context budget is a cost decision rather than a law. It is also not
// a parser: the enclosing block is found by brace depth with string literals skipped, and a file whose braces do not
// balance falls back to the hunk plus padding rather than to a guess - **a window that is merely wider is still
// honest; a window that claims to be a function when it is not is a false statement in the prompt.**

/** A span of new-file line numbers a diff hunk covers, inclusive on both ends. */
export interface ChangedRange {
  readonly startLine: number;
  readonly endLine: number;
}

/** How much code one file's block may carry, and how far it may wander before it is clipped. */
export interface CodeContextLimits {
  /** Lines kept either side of a hunk, and the floor a block is clipped back to when it is too large. */
  readonly padding: number;
  /** A block larger than this is clipped to the hunk plus padding: **a function of two thousand lines is a file**. */
  readonly maxBlockLines: number;
  /** Characters one file may contribute, headers included. */
  readonly maxCharsPerFile: number;
}

/**
 * **The shipped limits, and why these numbers.**
 *
 * `padding: 12` is a screen of context either side - enough for a guard clause and the call it protects. `maxBlockLines:
 * 80` is a long function and not a class: past it the block stops being the change's contract. `maxCharsPerFile: 2600`
 * is roughly 650 tokens, so **eight files of context cost about one lane call's completion budget** - a review that
 * costs twice as much to be twice as specific has to prove the second half, and that is what the run is for.
 */
export const DEFAULT_CODE_CONTEXT_LIMITS: CodeContextLimits = {
  padding: 12,
  maxBlockLines: 80,
  maxCharsPerFile: 2600,
};

/** `@@ -a,b +c,d @@` — the new-file side is all this needs, because a finding is placed in the new file. */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * **The hunk extents of one file's diff, in new-file line numbers.**
 *
 * A hunk header names where its new side starts and how many lines it covers, and **the extent rather than the added
 * lines is what a reviewer's eye lands on**: a change is read with its three lines of context, so the window this
 * returns is the window the reviewer was already looking at. A header whose count is omitted covers one line, which is
 * what git writes when a hunk adds or removes exactly one line.
 */
export function changedRangesFromDiff(diffText: string): ChangedRange[] {
  const ranges: ChangedRange[] = [];
  for (const line of diffText.split(/\r?\n/)) {
    const match = HUNK_HEADER.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isFinite(start) || start < 1) continue;
    // **A deletion has `+c,0`**: it covers no line of the new file, so the window it needs is the line it lands on and
    // the guard `Math.max(1, count)` is what keeps `endLine` from falling before `startLine`.
    ranges.push({ startLine: start, endLine: start + Math.max(1, count) - 1 });
  }
  return ranges;
}

/**
 * **One line of the diff, and the line number it claims to be in the new file.**
 *
 * The window is built from a file the caller read at some revision, and **nothing in the hunk header says which revision
 * the caller read**. A file taken at the pull request's base rather than its head is the same file with every line
 * number shifted by however many lines the change added - so the window would show the old code under the new
 * coordinates, and every finding against it would name a line that holds something else. **That is not a rendering
 * fault; it is a false statement in the prompt**, and it is silent.
 */
export interface HunkAnchor {
  /** The line number in the new file, from the hunk header. */
  readonly line: number;
  /** The text the diff says is on that line, prefix stripped. */
  readonly text: string;
}

/**
 * **The first line of every hunk, as the diff describes it.**
 *
 * Only the first line of each hunk is needed, because one comparison decides the question: **a file read at the wrong
 * revision disagrees on the first line it is asked about, and agrees nowhere after it.** A deleted line does not advance
 * the new file, so a hunk that opens with a deletion takes its anchor from the next line - which is still `newStart`.
 */
export function hunkAnchorsFromDiff(diffText: string): HunkAnchor[] {
  const anchors: HunkAnchor[] = [];
  let line = 0;
  let added: HunkAnchor | null = null;
  let context: HunkAnchor | null = null;
  // **The hunk ends when the next header starts**, and the anchor it contributes is decided at that moment: an added
  // line is the strongest evidence of which revision this is, and a hunk that adds nothing falls back to its first
  // context line.
  const flush = (): void => {
    const anchor = added ?? context;
    if (anchor) anchors.push(anchor);
    line = 0;
    added = null;
    context = null;
  };
  for (const text of diffText.split(/\r?\n/)) {
    const header = HUNK_HEADER.exec(text);
    if (header) {
      flush();
      line = Number(header[1]);
      continue;
    }
    if (line === 0) continue;
    if (text.startsWith('\\')) continue;
    const marker = text[0];
    if (marker === '+') {
      if (added === null) added = { line, text: text.slice(1) };
      line += 1;
    } else if (marker === ' ') {
      if (context === null) context = { line, text: text.slice(1) };
      line += 1;
    }
    // A `-` line is code the new file does not have: it advances nothing and is never an anchor.
  }
  flush();
  return anchors;
}

/**
 * **How much a line opens and closes, with strings and line comments skipped.**
 *
 * This is the whole of the parsing this file does, and it is deliberately crude in one direction: **it can only
 * over-count a block boundary, never silently pick a different one**, because a brace inside a string is skipped and a
 * brace inside a multi-line string is not - and the fallback below is what a file like that gets.
 */
function braceDelta(line: string): { delta: number; unbalanced: boolean } {
  let delta = 0;
  let quote: string | null = null;
  for (let at = 0; at < line.length; at += 1) {
    const character = line[at];
    if (quote !== null) {
      if (character === '\\') at += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '/' && line[at + 1] === '/') break;
    if (character === '#') break;
    if (character === '{') delta += 1;
    else if (character === '}') delta -= 1;
  }
  // An unterminated quote at the end of a line is the one case that makes the count untrustworthy: a template literal
  // or a raw string that spans lines will be counted from the next line as if it were code.
  return { delta, unbalanced: quote !== null };
}

/**
 * **The block a range sits in, as `[start, end]` in 0-based line indices, or `null` when the file has no block there.**
 *
 * The search walks outward from the range: up while the depth before a line is at least the depth at the range's first
 * line, and down until the depth returns to where the block opened. **Both directions are bounded by `maxBlockLines`**,
 * and a file whose depth ever goes negative is treated as having no block at all - because that is what a brace in a
 * multi-line string looks like from here.
 */
function enclosingBlock(
  depths: readonly number[],
  after: readonly number[],
  range: ChangedRange,
  maxBlockLines: number,
): { start: number; end: number } | null {
  const first = range.startLine - 1;
  const last = Math.min(range.endLine - 1, depths.length - 1);
  if (first < 0 || first >= depths.length) return null;
  const opening = depths[first]!;
  if (opening <= 0) return null;

  let start = first;
  while (start > 0 && depths[start - 1]! >= opening) start -= 1;
  // The line that opened the block is the one before the first line at this depth, and it belongs to the block: **a
  // function signature is part of the function.** The test is on the depth *after* that line rather than on `opening - 1`,
  // because **a line may open two blocks at once** (`if (x) { g({`) and a `- 1` test would then step over the very line
  // the window needs. A blank line above the block has an after-depth of zero and is correctly left out.
  if (start > 0 && after[start - 1] === opening) start -= 1;

  let end = last;
  // `depths[end + 1]` is the depth *after* line `end`: while it is still at the block's level the line did not close it.
  while (end + 1 < depths.length && depths[end + 1]! >= opening) end += 1;
  if (end - start + 1 > maxBlockLines) return null;
  return { start, end };
}

/**
 * **One file's window: the block around every hunk, or the hunk plus padding when there is no block.**
 *
 * The header carries three facts a model cannot recover from the text: which file, which lines of how many, and which
 * of those lines changed. **A window without its coordinates invites a finding about a line number the file does not
 * have**, and the engine's own range check would then discard it - the failure would look like a bad model call rather
 * than like a missing header.
 */
export function codeContextForFile(
  path: string,
  fileText: string,
  ranges: readonly ChangedRange[],
  limits: CodeContextLimits = DEFAULT_CODE_CONTEXT_LIMITS,
  anchors: readonly HunkAnchor[] = [],
): string {
  if (fileText.length === 0) return '';
  // `''.split()` is one empty line and never zero, so a `total === 0` guard here would be a branch no input reaches -
  // the empty file is the guard above, and a second one for the same case is a line that only a mutation test visits.
  const lines = fileText.split(/\r?\n/);
  const total = lines.length;

  // **The revision check, before any window is built.** A caller that read the file at the wrong commit gets no window
  // rather than a window under the wrong line numbers: the failure is then visible in the run's counters instead of
  // being a plausible-looking prompt that says line 40 holds code that is on line 46.
  for (const anchor of anchors) {
    if ((lines[anchor.line - 1] ?? '').trim() !== anchor.text.trim()) return '';
  }

  let depth = 0;
  let broken = false;
  const depths: number[] = [];
  // **The depth after each line as well as before it**, because the line that opened a block is identified by where it
  // left the depth and not by what it found there.
  const after: number[] = [];
  for (const line of lines) {
    depths.push(depth);
    const step = braceDelta(line);
    if (step.unbalanced) broken = true;
    depth += step.delta;
    after.push(depth);
    if (depth < 0) broken = true;
  }

  const windows: Array<{ start: number; end: number }> = [];
  const add = (start: number, end: number): void => {
    const from = Math.max(0, start);
    const to = Math.min(total - 1, end);
    if (to < from) return;
    const previous = windows[windows.length - 1];
    if (previous && from <= previous.end + 1) previous.end = Math.max(previous.end, to);
    else windows.push({ start: from, end: to });
  };

  for (const range of ranges) {
    const block = broken ? null : enclosingBlock(depths, after, range, limits.maxBlockLines);
    if (block) add(block.start, block.end);
    else add(range.startLine - 1 - limits.padding, range.endLine - 1 + limits.padding);
  }
  // **A diff with no hunk header still names a file**, and a caller that passed one gets the head of the file rather
  // than nothing: an empty window would be indistinguishable from a file that could not be read.
  if (windows.length === 0) add(0, limits.padding * 2);

  const changed = ranges.map((range) => `${range.startLine}-${range.endLine}`).join(', ');
  const header = `### ${path} — lines ${windows[0]!.start + 1}-${windows[windows.length - 1]!.end + 1} of ${total} — changed at ${changed || '(unknown)'}`;
  const body = windows
    .map((window) => lines.slice(window.start, window.end + 1).join('\n'))
    .join('\n... \n');

  const assembled = `${header}\n${body}`;
  if (assembled.length <= limits.maxCharsPerFile) return assembled;
  // **Clipped, and it says so with the number**, for the same reason the diff clip does: a model that is not told what
  // it was not shown reports the absence as a finding.
  const keep = Math.max(0, limits.maxCharsPerFile - header.length - 80);
  return `${header}\n${assembled.slice(header.length + 1, header.length + 1 + keep)}\n... [${assembled.length - keep} characters of this window not shown] ...`;
}

/** One file's diff, and the file it belongs to when the caller could read it. */
export interface ContextSection {
  readonly path: string;
  readonly diffText: string;
  /** The file's full text at the revision being reviewed, or undefined when the caller could not read it. */
  readonly fileText?: string;
}

/**
 * **The whole pull request's window, bounded in total and in file order.**
 *
 * The order is the diff's, not a ranking: **the corpus this is measured on has goldens in 249 files over 36 pull
 * requests**, so every file is one whose change somebody commented on, and a ranking that spent the budget on the
 * largest diffs would be a bet on size that nothing here has measured. What is bounded is the total, and a pull request
 * whose context does not fit says how many files were left out.
 */
export function codeContextForSections(
  sections: readonly ContextSection[],
  limits: CodeContextLimits = DEFAULT_CODE_CONTEXT_LIMITS,
  maxCharsTotal = 12_000,
): string {
  const blocks: string[] = [];
  let used = 0;
  let omitted = 0;
  let refused = 0;
  for (const section of sections) {
    if (section.fileText === undefined || section.fileText.length === 0) continue;
    const block = codeContextForFile(
      section.path,
      section.fileText,
      changedRangesFromDiff(section.diffText),
      limits,
      hunkAnchorsFromDiff(section.diffText),
    );
    // **A file whose text does not answer to the diff's own coordinates is refused and counted**, because the two
    // ways it happens - the wrong revision, and a diff for a different path - are both silent otherwise.
    if (block.length === 0) {
      refused += 1;
      continue;
    }
    if (used + block.length > maxCharsTotal) {
      omitted += 1;
      continue;
    }
    used += block.length;
    blocks.push(block);
  }
  if (blocks.length === 0) return '';
  const tail = omitted > 0 ? `\n... [${omitted} more file(s) not shown] ...` : '';
  const disowned =
    refused > 0
      ? `\n... [${refused} file(s) not shown: the text at the changed line did not match the diff] ...`
      : '';
  return `${blocks.join('\n\n')}${tail}${disowned}`;
}
