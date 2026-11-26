/**
 * **The lines a comment is about, out of a unified diff, with the numbers the new revision gives them.**
 *
 * The two-sided verifier quotes by line, and a quotation has to be checkable against the revision it names - so the one
 * thing this module has to get right is **which line number an added line has in the file after the change**. A hunk
 * header carries both, `@@ -a,b +c,d @@`, and the new-side counter is what a comment on the pull request is anchored to.
 *
 * **A removed line is not evidence.** It is in the diff, it is often the thing being complained about, and a verifier that
 * quoted it would be quoting code the reader cannot see at head - which is §149.5's unpostable comment arriving by a
 * different route. Removed lines are counted rather than quoted, so a run can tell "the file had no added lines here" from
 * "the file did not parse".
 *
 * **And this is a lexer, not a parser.** It reads `+++`, `@@`, `+` and `-` at the start of a line, which is what a unified
 * diff guarantees; a `+` inside a content line is content, and the prefix rule is the only thing that distinguishes them.
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
 * Every file in the diff, with its added lines numbered on the new side.
 *
 * A hunk header that will not parse ends the file's run rather than being guessed at: **a wrong line number is worse than
 * a missing one**, because a quotation attributed to the wrong line passes a check it should have failed.
 *
 * @param {string} diff
 * @returns {Map<string, {path: string, added: Array<{line: number, text: string}>, removed: number}>}
 */
export function addedLinesByPath(diff) {
  const files = new Map();
  let current = null;
  let next = 0;
  for (const raw of String(diff ?? '').split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = pathOf(raw);
      current = path === '' ? null : { path, added: [], removed: 0 };
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
      current.added.push({ line: next, text: raw.slice(1) });
      next += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      current.removed += 1;
      continue;
    }
    // **A context line advances the new side and a `\ No newline` marker does not**, which is the one place a lexer can
    // drift by one and take every later quotation with it.
    if (raw.startsWith(' ')) next += 1;
  }
  return files;
}

/**
 * **The window a two-sided question is asked about.**
 *
 * Both sides of a symbol have to be quotable, and they are usually a few lines apart - so the window is asymmetric on
 * purpose: **six lines back for the declaration or the assignment, eighteen forward for the use.** A symmetric window
 * spends a third of its budget on lines the comment is not about, and the prompt is what this pass pays for.
 *
 * `max` is a hard bound rather than a target: an empty result means the diff added nothing in this window, which the pass
 * reads as "no evidence" and answers by keeping the sentence.
 *
 * @param {Array<{line: number, text: string}>} added
 * @param {number} startLine
 * @param {{before?: number, after?: number, max?: number, width?: number}} [options]
 * @returns {string[]}
 */
export function evidenceWindow(added, startLine, options = {}) {
  const before = options.before ?? 6;
  const after = options.after ?? 18;
  const max = options.max ?? 40;
  const width = options.width ?? 4;
  if (!Number.isFinite(startLine)) return [];
  const window = added.filter(
    (entry) => entry.line >= startLine - before && entry.line <= startLine + after,
  );
  const kept = window.slice(0, max);
  return kept.map((entry) => `${String(entry.line).padStart(width)}| ${entry.text}`);
}
