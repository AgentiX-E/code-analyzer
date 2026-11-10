// @code-analyzer/intelligence — the module specifier of an import line, read in one pass
//
// **The pattern this replaces was the defect.** `import\s+.*\s+from\s+['"](.+)['"]` gave a backtracking engine two
// unbounded whitespace runs around a greedy body, so the cost of deciding whether a line is an import statement was a
// search over every way of splitting the gap between them. Bounding the two runs made it linear with a constant no test
// would want to live with - **forty kilobytes of spaces after the word `import` still cost half a second**, because each
// of forty thousand candidate positions still tried sixty-four widths of the run before giving up.
//
// A regex is the wrong instrument for "find the keyword `from` that follows whitespace and is followed by a quote".
// That is a scan, and a scan is what this is: one cursor that only moves forward, so every character is examined a
// bounded number of times and the cost is the length of the line whatever the line contains.

/** The characters a statement may separate its parts with, on one line. */
function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t';
}

/** Whether `line[index]` ends a word, so that `important` is not read as `import`. */
function isWordEnd(ch: string | undefined): boolean {
  return ch === undefined || !/[\w$]/.test(ch);
}

/**
 * The specifier of `import … from '<spec>'`, or `null` when the line is not such a statement.
 *
 * **One pass, forward only.** The cursor advances past every keyword it considers, so `indexOf` totals at most the
 * length of the line; nothing here can be made to look at a character twice.
 *
 * The specifier is `null` rather than an empty string when the line opens a quote it never closes: a path of zero
 * characters is not a module, and a caller cannot tell it apart from a match.
 */
export function readImportSpecifier(line: string): string | null {
  const importAt = line.indexOf('import');
  if (importAt < 0) return null;
  if (importAt > 0 && !isWordEnd(line[importAt - 1])) return null;
  if (!isWordEnd(line[importAt + 6])) return null;
  // `import …` needs a separator before anything else; `import{a}from'x'` is not the shape this reads, and neither was
  // it the shape the pattern read.
  if (!isSpace(line[importAt + 6])) return null;

  let cursor = importAt + 6;
  for (;;) {
    const fromAt = line.indexOf('from', cursor);
    if (fromAt < 0) return null;
    cursor = fromAt + 4;

    if (!isSpace(line[fromAt - 1])) continue;
    if (!isWordEnd(line[fromAt + 4])) continue;

    let quoteAt = fromAt + 4;
    while (isSpace(line[quoteAt])) quoteAt++;
    const quote = line[quoteAt];
    if (quote !== '"' && quote !== "'") continue;

    const closeAt = line.indexOf(quote, quoteAt + 1);
    if (closeAt < 0) return null;
    return line.slice(quoteAt + 1, closeAt);
  }
}
