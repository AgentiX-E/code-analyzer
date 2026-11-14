// @code-analyzer/intelligence — which line numbers a diff actually added
//
// **Why this is a parser and not a subtraction.** The engine is handed a `GitDiff`, and a `GitDiff` carries hunk
// metadata rather than content: `ranges: [{ oldStart, oldEnd, newStart, newEnd }]`. **Those numbers are the file's own
// line numbers when the diff came from git - and they are the diff's line numbers when it came from
// `createDiff(content)`**, which is what the benchmark runner builds out of a patch's text. The engine has already paid
// for this confusion once: a filter compared the model's *file* line numbers against the *diff's* line count, so a
// correct finding at line 900 of a 1,500-line file died on a 40-line diff.
//
// **So the added lines are read out of the patch text itself**, where the coordinates are unambiguous by construction:
// a hunk header states the new side's start, and every line that is neither `-` nor a `\ No newline` marker advances
// it. **That is the only reading of a patch that cannot be off by a constant.**
//
// **And the "cannot tell" case is a value rather than an empty set.** A caller may hand this a code window instead of a
// patch - the product path does exactly that when it shows a lane the block its hunk sits in - and **an empty set would
// then mean "the diff added nothing", which would refuse every comment in the review.** `null` means *this text is not
// a patch and no line constraint can be derived from it*, and the adjudicator treats it as "no constraint" rather than
// as "no lines".

/** `@@ -oldStart,oldCount +newStart,newCount @@` - the counts are optional in the format and git omits `,1`. */
const HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

/** One added line, with the number the file gives it and the text the patch gives it. */
export interface NumberedAddedLine {
  /** The new-side file line number. */
  line: number;
  /** The line's content, without the patch's leading `+`. */
  text: string;
}

/**
 * **The added lines with their numbers and their text, or `null` when the text is not a patch.**
 *
 * This is the single walk over the format; `addedLinesOf` is the set of what it returns. **Two walks would be two chances
 * to disagree about which line is which**, and the disagreement would be invisible: a set that said `{675}` and a
 * rendered block that printed `674| ...` would both look right in a report and would point the reader at the wrong line.
 *
 * **The text is kept because the second reader has to be able to quote it.** A reader asked to cite the code that decides
 * a question cannot cite a number, and **a reader shown a patch with `+` prefixes and no numbers cannot say which of the
 * comments's lines it is looking at** - which is the instrument defect §45 records a falsified registration against.
 */
export function numberedAddedLines(
  patchText: string | undefined | null,
): NumberedAddedLine[] | null {
  const text = String(patchText ?? '');
  if (!text.includes('@@')) return null;

  const numbered: NumberedAddedLine[] = [];
  let newLine = 0;
  let insideHunk = false;
  /**
   * **Whether the text carried any hunk content at all**, which is the difference between a patch and a list of hunk
   * headers.
   *
   * The engine's own `buildDiffContent` emits `@@ -8,11 +8,14 @@` lines with no content beneath them, and **a walk that
   * trusts the headers alone reads that as a patch that added nothing** - which is a real answer for a deletion and the
   * wrong answer here, where it would refuse every comment in the review. A genuine patch always has at least one
   * content line in a hunk: a hunk of pure context does not exist in a diff.
   */
  let contentLines = 0;

  for (const raw of text.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      newLine = Number(header[3]);
      insideHunk = true;
      continue;
    }
    if (!insideHunk) continue;

    // **Three file-level lines that start with the diff's own markers and are not content.** `diff --git`, `+++` and
    // `---` all appear between hunks when a patch carries more than one file, and each of them would otherwise be read
    // as a change.
    if (
      raw.startsWith('diff --git ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('index ') ||
      raw.startsWith('\\ No newline')
    ) {
      continue;
    }

    if (raw.startsWith('+')) {
      contentLines += 1;
      numbered.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      contentLines += 1;
      continue;
    }
    // **Context advances the new side and so does an empty line inside a hunk**, because an empty line in a patch is a
    // context line whose leading space was stripped by an editor - and treating it as nothing would shift every
    // following number in the hunk up by one.
    contentLines += 1;
    newLine += 1;
  }

  // **Headers with nothing under them are not a patch**, for the reason above: the numbers they name are real but
  // nothing distinguishes them from a walk that lost the content.
  if (contentLines === 0) return null;

  return numbered;
}

/**
 * **The new-side line numbers a patch adds, or `null` when the text is not a patch.**
 *
 * The walk is the format's own: a `+` line is added and advances the new side, a ` ` line is context and advances it, a
 * `-` line advances the old side only, and everything else - the header, the `\ No newline at end of file` marker, a
 * blank separator between file sections - advances neither.
 *
 * **`+++` and `---` are skipped explicitly rather than by accident.** They begin with `+` and `-` and they are file
 * headers, so a walk that only looks at the first character counts them as an added line and an old-side line, and
 * **every line number in the file then shifts by the number of file headers before it** - which is off by one for one
 * file, two for two, and invisible in a report that only prints totals.
 *
 * **A patch whose hunks added nothing is a deletion, and an empty set is the right answer for it**: nothing may be filed,
 * because a comment on a deleted line is a comment on code that no longer exists.
 */
export function addedLinesOf(patchText: string | undefined | null): Set<number> | null {
  const numbered = numberedAddedLines(patchText);
  return numbered === null ? null : new Set(numbered.map((entry) => entry.line));
}
