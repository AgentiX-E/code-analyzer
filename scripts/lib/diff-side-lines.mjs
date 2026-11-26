/**
 * **The lines a comment can quote, out of a unified diff, with the numbers the new revision gives them.**
 *
 * The two-sided verifier quotes by line, and a quotation has to be checkable against the revision it names - so the one
 * thing this module has to get right is **which line number a line has in the file after the change**. A hunk header
 * carries both, `@@ -a,b +c,d @@`, and the new-side counter is what a comment on the pull request is anchored to.
 *
 * **And context lines are quotable, which the first version of this file got wrong.** It numbered only `+` lines, on the
 * reasoning that a verifier should quote the change - and then a comment about a call whose callee is declared forty
 * unchanged lines above could quote exactly one side, and the pass answered `cannot` 118 times out of 217. **A line the
 * pull request did not touch is still a line the reader can see at head**, and the whole question is whether two of them
 * disagree. The fix was one word: a context line advances the new-side counter *and* is kept.
 *
 * **A removed line is still not evidence.** It is in the diff, it is often the thing being complained about, and a verifier
 * that quoted it would be quoting code the reader cannot see - §149.5's unpostable comment arriving by a second route.
 * Removed lines are counted rather than quoted, so a run can tell "the file had nothing here" from "the file did not parse".
 *
 * **And this is a lexer, not a parser.** It reads `+++`, `@@`, `+`, `-` and a leading space, which is what a unified diff
 * guarantees; a `+` inside a content line is content, and the prefix rule is the only thing that distinguishes them.
 */

/** The `b/` side of a `+++` header, without the prefix or the trailing timestamp git sometimes appends. */
function pathOf(header) {
  const raw = header
    .replace(/^\+\+\+\s+/, '')
    .replace(/\t.*$/, '')
    .trim();
  if (raw === '/dev/null') return '';
  return raw.replace(/^[ab]\//, '');
}

/**
 * Every file in the diff, with every line the new revision has in its hunks, numbered on the new side.
 *
 * A hunk header that will not parse ends the file's run rather than being guessed at: **a wrong line number is worse than
 * a missing one**, because a quotation attributed to the wrong line passes a check it should have failed.
 *
 * @param {string} diff
 * @returns {Map<string, {path: string, lines: Array<{line: number, text: string, added: boolean}>, added: Array<{line: number, text: string}>, removed: number}>}
 */
export function sideLinesByPath(diff) {
  const files = new Map();
  let current = null;
  let next = 0;
  for (const raw of String(diff ?? '').split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = pathOf(raw);
      current = path === '' ? null : { path, lines: [], added: [], removed: 0 };
      if (current !== null) files.set(path, current);
      continue;
    }
    if (raw.startsWith('@@')) {
      const match = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(raw);
      if (match === null) {
        current = null;
        continue;
      }
      next = Number(match[1]);
      continue;
    }
    if (raw.startsWith('diff ') || raw.startsWith('--- ')) {
      // **A file header is not a removal.** `--- a/...` starts with a minus and an earlier version of this lexer counted
      // it as one, which made every file's removed-line tally wrong by the number of files after it.
      current = null;
      continue;
    }
    if (current === null) continue;
    if (raw.startsWith('+')) {
      const text = raw.slice(1);
      current.lines.push({ line: next, text, added: true });
      current.added.push({ line: next, text });
      next += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      current.removed += 1;
      continue;
    }
    // **A context line advances the new side and is kept**; a `\ No newline` marker does neither, which is the one place
    // a lexer can drift by one and take every later quotation with it.
    if (raw.startsWith(' ')) {
      current.lines.push({ line: next, text: raw.slice(1), added: false });
      next += 1;
    }
  }
  return files;
}

/**
 * **The window a two-sided question is asked about.**
 *
 * Both sides of a symbol have to be quotable, and they are usually a few lines apart - so the window is asymmetric on
 * purpose: **twelve lines back for the declaration, assignment or callee, twenty forward for the use.** The first version
 * used six and eighteen against added lines only, and the pass answered `cannot` on more than half the emission; the window
 * is where that number lived.
 *
 * `max` is a hard bound rather than a target: an empty result means the diff says nothing about this file at all, which the
 * pass reads as "no evidence" and answers by keeping the sentence.
 *
 * @param {Array<{line: number, text: string}>} lines
 * @param {number} startLine
 * @param {{before?: number, after?: number, max?: number, width?: number}} [options]
 * @returns {string[]}
 */
export function evidenceWindow(lines, startLine, options = {}) {
  const before = options.before ?? 12;
  const after = options.after ?? 20;
  const max = options.max ?? 48;
  const width = options.width ?? 4;
  if (!Number.isFinite(startLine)) return [];
  const window = lines.filter(
    (entry) => entry.line >= startLine - before && entry.line <= startLine + after,
  );
  const kept = window.slice(0, max);
  return kept.map((entry) => `${String(entry.line).padStart(width)}| ${entry.text}`);
}
