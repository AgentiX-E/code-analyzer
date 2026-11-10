// @code-analyzer/infra — A git argument that cannot become a git option
//
// **Why this exists, and why the argv form was not the end of it.** Iteration 119 replaced every interpolated shell string
// in this package with an argument vector, which removed fourteen `js/shell-command-constructed-from-input` findings and
// the injection they described. **CodeQL then raised `js/second-order-command-line-injection` twice on the same call
// sites**, and the reading is correct: an argument vector closes the *shell* and leaves the *option parser*.
//
// `git fetch origin --upload-pack=touch /tmp/pwned` runs the value of `--upload-pack`. So does `git log --output=…` and a
// dozen others, and the shape is always the same: **a data value that begins with `-` stops being data**. Branch names,
// refs and commit ranges reach these modules from a repository the analyser does not control, and a pull request can name
// a branch.
//
// **The check is deliberately a rejection and not a sanitisation.** Escaping a leading `-` would produce a ref that git
// resolves to something the caller did not name, and a caller that receives a range for a ref it did not ask for cannot
// tell the substitution from a real answer. A refusal is a fact the caller can act on.

/** The characters no ref, range or commit may contain: git rejects them, and so does this. */
const FORBIDDEN = /[\0\n\r]/;

/**
 * Throws unless `value` is a git argument that cannot be read as a git option.
 *
 * `what` names the thing in the message, because "invalid value" is a message a caller cannot act on.
 */
export function assertGitArgument(value: string, what: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${what} may not be empty`);
  }
  if (value.startsWith('-')) {
    // **The whole of the argument-injection class, in one line.** `git` reads a leading `-` as an option before it reads
    // it as a ref, and several options execute their value.
    throw new Error(`${what} may not begin with '-' (got ${JSON.stringify(value)})`);
  }
  if (FORBIDDEN.test(value)) {
    throw new Error(`${what} may not contain a NUL, newline or carriage return`);
  }
}
