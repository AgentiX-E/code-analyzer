// @code-analyzer/intelligence — A hunk's shape, decided from the diff rather than from a reader
//
// **The measurement this file answers.** §78 paid 6 000 characters of surrounding context for every claim and moved F1
// by −0.0022. `difftastic` answers the same shortage the other way: it computes which lines are *novel* and hands over
// only those, because an edge that matches an unchanged node costs 1 while a novel node costs 300
// (`src/diff/graph.rs:324`) - **the diff already knows what changed; asking a reader to guess is what costs money.**
//
// **What this file is.** A classifier over one hunk's two sides. It answers a question with a checkable answer -
// "is every changed line accounted for by whitespace, comment text, or relocation?" - and it answers `substantive`
// whenever it cannot prove otherwise. **A classifier that guesses is worse than no classifier**, because the guess is
// what silently deletes a true positive from the pool.
//
// **What it is not.** It is not a parser and it does not import one. Relocation is decided by normalised line identity
// against the other side's full text, so an edited copy is not a move, and a file whose text was not supplied cannot
// be claimed as a relocation source at all.

/** What a hunk did, as far as the diff can prove. */
export type ChangeShape =
  /** Whitespace only: the multiset of non-whitespace characters is identical on both sides. */
  | 'reformatted'
  /** Comment text only: neither side contributes a non-comment character the other lacks. */
  | 'comment-only'
  /** Every added line already exists elsewhere on the old side, and every removed line elsewhere on the new side. */
  | 'moved'
  /** Anything the three proofs above do not cover. This is the default, and it is never a guess. */
  | 'substantive';

/** One hunk's two sides, plus the full texts that make a relocation claim checkable. */
export interface ChangeShapeInput {
  /** Removed lines, content only, no leading `-`. */
  readonly removed: readonly string[];
  /** Added lines, content only, no leading `+`. */
  readonly added: readonly string[];
  /** The old file's full text. Absent means relocation may not be claimed. */
  readonly oldText?: string | null;
  /** The new file's full text. Absent means relocation may not be claimed. */
  readonly newText?: string | null;
}

/** The verdict, and the lines that survive it. */
export interface ShapedHunk {
  readonly shape: ChangeShape;
  /**
   * Added lines that are not accounted for by whitespace, comment text, or relocation - **the only lines a finding may
   * stand on when the shape is not `substantive`**, and for a `substantive` hunk the added lines that are genuinely new.
   */
  readonly novelLines: readonly string[];
  /**
   * The indexes into `added` that `novelLines` came from, so a caller that maps lines to new-side numbers keeps the
   * mapping exact when two added lines carry the same text.
   */
  readonly novelIndexes?: readonly number[];
  /** Why the shape was chosen, as a token a test can assert on rather than a sentence a log must parse. */
  readonly because:
    | 'no-change'
    | 'same-non-whitespace'
    | 'same-non-comment'
    | 'relocated'
    | 'edited'
    | 'unprovable';
}

/**
 * **The whole-file line set, normalised once.** Whitespace is stripped because a relocation that also re-indents is
 * still a relocation; a line that differs in any other character is a different line.
 */
function lineSet(text: string | null | undefined): Set<string> | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  const set = new Set<string>();
  for (const line of text.split('\n')) {
    const normalised = normalise(line);
    if (normalised.length > 0) set.add(normalised);
  }
  return set;
}

/** Every whitespace character, gone. A reformat is a change in whitespace and nothing else. */
function normalise(line: string): string {
  return line.replace(/\s+/gu, '');
}

/**
 * **The comment characters of one line, removed.** Line comments (`//`, `#`, `--`) lose everything from the marker;
 * block-comment lines (an opener, a leading star, a closer) lose the marker itself. **A line that is nothing but a
 * comment normalises to the empty string**, which is exactly the test `comment-only` needs.
 *
 * The marker set is deliberately small and fixed. A language whose comments are not in it keeps its comments, which
 * makes the classifier say `substantive` - **the safe direction**, since the alternative is erasing code that a `#`
 * happens to start.
 */
function withoutComment(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length === 0) return '';

  // A block-comment body line: a star followed by space, another star, a slash, or the end of the line. **The
  // lookahead is what keeps `*p = 1;` as code** - a dereference has an identifier after the star, a comment has not.
  if (trimmed.startsWith('/*')) {
    const close = trimmed.indexOf('*/');
    return close < 0 ? '' : normalise(trimmed.slice(close + 2));
  }
  if (/^\*(?:\s|\/|$)/u.test(trimmed)) return '';

  const lineMarker = trimmed.search(/(^|\s)(\/\/|#|--)/u);
  if (lineMarker >= 0) return normalise(trimmed.slice(0, lineMarker));
  return normalise(trimmed);
}

/**
 * **The non-whitespace characters of one side, concatenated.**
 *
 * Line-by-line comparison cannot see a line that was wrapped into two, and that is the commonest reformat there is.
 * Concatenating keeps the order - so `ab` and `ba` still differ - and drops only the line break, which is whitespace.
 */
function concatenated(lines: readonly string[]): string {
  return lines.map(normalise).join('');
}

/** The non-whitespace multiset of one side, as a comparable string. */
function nonWhitespaceBag(lines: readonly string[]): string {
  return lines
    .map(normalise)
    .filter((line) => line.length > 0)
    .sort()
    .join('\u0000');
}

/** The non-comment, non-whitespace multiset of one side. */
function nonCommentBag(lines: readonly string[]): string {
  return lines
    .map(withoutComment)
    .filter((line) => line.length > 0)
    .sort()
    .join('\u0000');
}

/**
 * **Classify one hunk, cheapest proof first.**
 *
 * The order matters and is the argument: each step is a strictly weaker claim than the one above it, so the first
 * step that holds is the strongest statement the diff supports. `substantive` is what remains when no step holds.
 */
export function classifyChange(input: ChangeShapeInput): ShapedHunk {
  const removedBag = nonWhitespaceBag(input.removed);
  const addedBag = nonWhitespaceBag(input.added);

  // Nothing changed at all. A hunk that reaches this classifier with two empty sides is a diff-parser defect upstream,
  // and calling it `substantive` would send it to a reader that has nothing to read.
  if (removedBag.length === 0 && addedBag.length === 0) {
    return { shape: 'reformatted', novelLines: [], because: 'no-change' };
  }

  // Whitespace only, compared as one string so a wrapped line is still a reformat.
  const removedCharacters = concatenated(input.removed);
  const addedCharacters = concatenated(input.added);
  if (removedCharacters === addedCharacters) {
    return { shape: 'reformatted', novelLines: [], because: 'same-non-whitespace' };
  }

  // Comment text only: strip the comment bodies from both sides and compare what is left.
  const removedCode = nonCommentBag(input.removed);
  const addedCode = nonCommentBag(input.added);
  if (removedCode === addedCode) {
    return { shape: 'comment-only', novelLines: [], because: 'same-non-comment' };
  }

  // Relocation: every added line exists somewhere on the old side, and every removed line somewhere on the new side.
  // **Both sides must be present** - a hunk that only deletes is a deletion, and calling it a move is how a real
  // removal stops being reviewed. **Both directions must hold** - an addition that already existed beside a removal
  // that vanished is a copy plus a deletion, which is an edit.
  const oldLines = lineSet(input.oldText);
  const newLines = lineSet(input.newText);
  if (
    oldLines !== null &&
    newLines !== null &&
    input.added.length > 0 &&
    input.removed.length > 0
  ) {
    const addedAllSeen = input.added.every((line) => {
      const normalised = normalise(line);
      return normalised.length === 0 || oldLines.has(normalised);
    });
    const removedAllSeen = input.removed.every((line) => {
      const normalised = normalise(line);
      return normalised.length === 0 || newLines.has(normalised);
    });
    if (addedAllSeen && removedAllSeen) {
      return { shape: 'moved', novelLines: [], because: 'relocated' };
    }
  }

  // Substantive, and the novel lines are the added ones that are neither a rewrite of a removed line nor already on the
  // old side. **A rewrite is not novel**: `if (x) return 1;` rewritten as `if (x) return 1;` plus a guard is one new
  // line, not three. Without the old text the narrower claim cannot be made, so only rewrites are excluded.
  const removedNormalised = new Set(input.removed.map(normalise));
  const novelIndexes: number[] = [];
  input.added.forEach((line, index) => {
    const normalised = normalise(line);
    if (normalised.length === 0) return;
    if (removedNormalised.has(normalised)) return;
    if (oldLines !== null && oldLines.has(normalised)) return;
    novelIndexes.push(index);
  });

  return {
    shape: 'substantive',
    novelLines: novelIndexes.map((index) => input.added[index] ?? ''),
    novelIndexes,
    because: oldLines === null ? 'unprovable' : 'edited',
  };
}

/** Whether a line may carry a finding, given its hunk's shape. */
export function mayCarryFinding(shape: ChangeShape): boolean {
  return shape === 'substantive';
}

/** One hunk's shape plus the new-side numbers it does and does not stand on. */
export interface ShapedHunkSpan {
  readonly shape: ChangeShape;
  /** New-side line numbers this hunk added. */
  readonly addedLines: readonly number[];
  /** The subset of `addedLines` that is genuinely new - empty for every non-substantive shape. */
  readonly novelLines: readonly number[];
}

/** A whole patch's shape, as the gate consumes it. */
export interface ShapedPatch {
  readonly hunks: readonly ShapedHunkSpan[];
  /**
   * **Every new-side line number a finding may stand on**, across all substantive hunks. Empty means the patch changed
   * nothing a compiler would see, and a review of it can only be a review of whitespace.
   */
  readonly novelLines: ReadonlySet<number>;
  /** True when no hunk was substantive: the file is a reformat, a comment edit, or a move. */
  readonly noneSubstantive: boolean;
}

/**
 * **Read a unified patch and classify each of its hunks.**
 *
 * The parser is deliberately narrow: it reads hunk headers, `-` lines and `+` lines, and it stops reading a hunk at the
 * next header. A line it does not recognise is skipped rather than guessed at, and **a patch with no readable hunk is
 * `noneSubstantive: false`** - an unreadable patch must never be the reason a file is skipped.
 */
export function classifyPatch(
  patch: string,
  options: { readonly oldText?: string | null; readonly newText?: string | null } = {},
): ShapedPatch {
  const hunks: ShapedHunkSpan[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  let addedNumbers: number[] = [];
  let newLine = 0;
  let inHunk = false;

  const flush = (): void => {
    if (!inHunk) return;
    const shaped = classifyChange({
      removed,
      added,
      oldText: options.oldText ?? null,
      newText: options.newText ?? null,
    });
    const novelSet = new Set(shaped.novelIndexes ?? []);
    const novelLines =
      shaped.shape === 'substantive'
        ? addedNumbers.filter((_line, index) => novelSet.has(index))
        : [];
    hunks.push({ shape: shaped.shape, addedLines: [...addedNumbers], novelLines });
    removed = [];
    added = [];
    addedNumbers = [];
    inHunk = false;
  };

  for (const raw of patch.split('\n')) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw);
    if (header !== null) {
      flush();
      newLine = Number(header[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    if (raw.startsWith('-')) {
      removed.push(raw.slice(1));
      continue;
    }
    if (raw.startsWith('+')) {
      added.push(raw.slice(1));
      addedNumbers.push(newLine);
      newLine += 1;
      continue;
    }
    // Context line, or a line the parser does not recognise: advance the new-side counter and keep no content.
    newLine += 1;
  }
  flush();

  const novelLines = new Set<number>();
  for (const hunk of hunks) for (const line of hunk.novelLines) novelLines.add(line);

  return {
    hunks,
    novelLines,
    noneSubstantive: hunks.length > 0 && hunks.every((hunk) => hunk.shape !== 'substantive'),
  };
}
