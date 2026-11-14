// @code-analyzer/intelligence — the question the second reader is asked
//
// **Why a separate prompt rather than one more paragraph in the lane prompts.** The lanes are asked to *find*. This
// call is asked to *disagree*, and the two requests pull in opposite directions: a finder rewarded for coverage reads
// "is this right?" as an invitation to restate its case. **A claim that is checked by the process that produced it is
// checked by an instrument that agrees with itself**, which is the failure this corpus's own benchmark is criticised
// for and the reason the check is a second call with a different job.
//
// **What is shown, and what is deliberately withheld.** The second reader gets the changed lines with their numbers,
// the surrounding block, and the comment - and **not** the diff's other files, the lane that produced the comment, or
// the score it was ranked with. A reader told which lane wrote a comment anchors on that lane's concerns; a reader told
// a score anchors on the score. What it needs is the code and the sentence.
//
// **The four refutations are enumerated because an open-ended "is this correct?" is answered "yes" by default.** Each
// one names something the reader can check rather than a level of confidence it can feel: restating the diff,
// contradicting the code, describing a failure no input can reach, and raising something with no behavioural
// consequence. **The last is the one that removes the corpus's largest false-positive block** - comments that are
// true, unobjectionable, and about nothing.

import { numberedAddedLines, type NumberedAddedLine } from './patch-lines.js';

import type { LLMFinding } from '../llm/prompts.js';

/** The most a single adjudication prompt may carry, in characters, across the code and the comment together. */
export const ADJUDICATION_CODE_BUDGET = 12_000;

/**
 * **How many added lines of the file the reader is shown at once.**
 *
 * A hundred and twenty is about two screens: enough for the function the comment is in and the declarations it depends
 * on, and small enough that the comment's own line is always inside the block rather than inside the part the budget cut.
 * **The old input was the whole patch clipped from the middle out**, which for the 26,926-character
 * `DimensionValidators.cpp` patch of FreeCAD#19411 meant the reader was shown the first six thousand characters and the
 * last six thousand - **and the comment it was asked to check sat in the four thousand in between.**
 */
export const ADJUDICATION_LINE_WINDOW = 120;

/** Everything one adjudication call is given. */
export interface AdjudicationRequest {
  /** The file the comment is about. */
  path: string;
  /** The candidate, as the lane filed it. */
  finding: LLMFinding;
  /**
   * **The patch text, or a code window when no patch exists.**
   *
   * It is read as a patch when it is one - the added lines are numbered and the window is centred on the comment - and
   * otherwise shown as it stands, because the product path hands in the block the hunk sits in rather than a diff.
   */
  addedCode: string;
  /** The block the hunks sit in, when the review was given one. */
  fileContext?: string;
}

/**
 * **Clip a block of code to the budget from the middle out.**
 *
 * The same shape the engine's own truncation uses, and for the same reason: a window that keeps the first N characters
 * of a file shows the imports and not the function, and **the function is what the comment is about**. Halves from both
 * ends keep the declaration and the closing brace, and a comment in the middle of a two-thousand-line file is rare
 * enough that the trade is worth taking once rather than solving.
 */
export function clipCode(code: string, budget = ADJUDICATION_CODE_BUDGET): string {
  if (code.length <= budget) return code;
  const half = Math.floor(budget / 2);
  return `${code.slice(0, half)}\n\n... [${code.length - budget} characters not shown] ...\n\n${code.slice(code.length - half)}`;
}

/**
 * **The added lines, numbered, in a window that contains the line the comment is about.**
 *
 * **This is the repair §45 registers.** The reader used to be given the patch with its `+` prefixes and no numbers, and
 * was told *"a comment may only be filed on one of these"* **without being told which one the comment was filed on** -
 * so it had to infer the location from the comment's prose and then answer *"does the code contradict this?"* about a
 * file rather than about a line. On the fifty-pull-request run of §44 it answered REFUTED 494 times out of 587.
 *
 * **The window is where the line is, not the first hundred and twenty lines.** A reader shown the top of a long patch
 * and asked about line 675 of it is being asked about something it cannot see, and **would answer "I cannot establish
 * this" for a reason that has nothing to do with the comment** - which is indistinguishable, in a counter, from the
 * comment being wrong.
 */
export function renderAddedLines(
  lines: ReadonlyArray<NumberedAddedLine>,
  focus: { startLine: number; endLine: number },
  window = ADJUDICATION_LINE_WINDOW,
): string {
  if (lines.length === 0) return '';
  // **The first added line at or after the comment**, because a comment is filed on an added line by construction and a
  // range that starts on one may end on context.
  let at = lines.findIndex((entry) => entry.line >= focus.startLine);
  if (at < 0) at = lines.length - 1;
  const head = Math.max(0, at - Math.floor(window / 4));
  const tail = Math.min(lines.length, head + window);
  // **The widest number in the block is the last line's**, so the column is computed once from the file's own maximum
  // rather than from the line the window happens to end on - and there is no defensive fallback here because a
  // non-empty list always has a last entry, which is the rule this repository applies to every unreachable default.
  const width = String(lines[lines.length - 1]!.line).length;
  const body = lines
    .slice(head, tail)
    .map((entry) => `${String(entry.line).padStart(width, ' ')} | ${entry.text}`)
    .join('\n');
  const before = head > 0 ? `... ${head} earlier added lines not shown ...\n` : '';
  const after =
    tail < lines.length ? `\n... ${lines.length - tail} later added lines not shown ...` : '';
  return `${before}${body}${after}`;
}

/**
 * **The prompt.**
 *
 * It states the verdict vocabulary, the four refutations, the repair contract, and the answer shape - and nothing else.
 * **Every sentence that does not change an answer was removed**, because this call runs once per candidate finding and
 * a paragraph of encouragement is a paragraph of tokens multiplied by the number of things the reviewer noticed.
 */
export function buildAdjudicationPrompt(request: AdjudicationRequest): string {
  const { path, finding, addedCode } = request;
  const context = request.fileContext
    ? `\nSurrounding code, unchanged lines included:\n\`\`\`\n${clipCode(request.fileContext)}\n\`\`\`\n`
    : '';
  // **No `?? ''` here, and it is a deletion rather than a tidy-up.** `LLMFinding` declares these four fields as
  // required and the parser that produces them enforces exactly that, so a default here is a branch no call can reach -
  // and a defensive default is worse than none when it is unreachable, because it makes an impossible state look
  // handled. A finding that arrives from JSON without them never becomes an `LLMFinding` in the first place.
  const claim = finding.description.trim();
  const suggestion = finding.suggestion ? `\nProposed fix: ${finding.suggestion}` : '';
  const numbered = numberedAddedLines(addedCode);
  // **Where the comment is, stated rather than left to be inferred from its prose.** A reader that has to guess which
  // line is being defended will check the claim against the change and not against the line.
  const where = `The comment is filed on line ${String(finding.startLine)}${
    finding.endLine === finding.startLine
      ? ''
      : ` and covers lines ${String(finding.startLine)}-${String(finding.endLine)}`
  }.`;
  const code =
    numbered === null
      ? `Code around the comment (this text carries no line numbers, so quote the code rather than a number):\n\`\`\`\n${clipCode(addedCode)}\n\`\`\``
      : `Lines this file's diff added, numbered as the file numbers them:\n\`\`\`\n${renderAddedLines(numbered, finding)}\n\`\`\``;

  return `You are the second reader of a code review comment. Another reviewer filed the comment below. Your job is not to agree with it and not to write a better review: it is to decide whether the comment is TRUE of this code exactly as written, and if it is not, whether the code it points at does contain a defect the comment mis-stated.

File: ${path}
${where}
${code}
${context}
The comment under review:
  title: ${finding.title}
  category: ${finding.category}, severity: ${finding.severity}
  says: ${claim}${suggestion}

Answer REFUTED when any of these holds:
1. **It restates the change.** The comment says what the diff did - a type changed, a member was added, a method now takes something else - and never says what the code then does wrong.
2. **The code contradicts it.** The claim is about code that does not read the way the comment says: a guard is present, the branch it says is missing exists, the value it says is null is checked, the case it says is unhandled is handled.
3. **No input can reach it.** The failure it describes cannot occur for any value or state, because the path to it is unreachable, the types make it impossible, or the code it depends on already prevents it.
4. **Nothing behaves differently.** The comment is a preference - naming, layout, an alternative design - and you cannot name a single input or state whose outcome changes. **A comment whose own words argue the code is correct is refuted here.**

Answer UPHELD only when you can name the input or state that triggers the failure and what the code then does. If you cannot name one, the answer is REFUTED - not because the comment is rude, but because it has not been established.

Answer REPAIRED only when the lines the comment points at do contain a defect a reviewer would raise, and the comment identified the place but described a different problem. A repair names the defect that is actually there, as a failure, with the input that triggers it - never as an improvement, and never as the fix.
- Never move a comment to another file, and never name a defect outside the lines shown.
- If the code at those lines is fine, the answer is REFUTED. Do not repair a comment into an invention.

Answer with one JSON object and nothing else:
{"verdict":"upheld"|"refuted"|"repaired","line":<the single added line number the comment is about>,"reason":"<one sentence; for refuted and repaired, cite the code that decides it>","title":"<only for repaired>","description":"<only for repaired: the failure, the input that triggers it, and what happens>","severity":"critical"|"high"|"medium"|"low","category":"bug"|"security"|"performance"|"maintainability"|"test"|"architecture"|"style"|"documentation"|"other","suggestion":"<only for repaired, or null>"}`;
}
