// @code-analyzer/analyzer — the markers a documentation comment opens with, per language family

/**
 * The marker sets the tree-sitter providers disagree about.
 *
 * **Why this is a file and not a constant on the base class.** The base collects every comment node and attaches it to
 * the declaration it documents, which is right for Java, Go, Kotlin, Rust, Swift, Scala, Ruby and PHP: in each of those
 * a `//` line above a declaration *is* its documentation, and the toolchain renders it that way. JavaScript, TypeScript
 * and C# are the three where the grammar writes documentation and ordinary notes with nodes the provider cannot tell
 * apart, and where the language itself draws the line:
 *
 * - **JSDoc** — JavaScript and TypeScript — is introduced by a doubled star after the slash. `// TODO` above a function
 *   is a note to the next reader; an index that files it as the function's description answers "what does this do" with
 *   "rename it".
 * - **XML documentation comments** — C# — are three slashes, and the compiler reads them into the assembly's XML;
 *   a doubled star opens a documentation block there too, while a single one does not.
 *
 * **A marker is a prefix of the raw comment text, not of the stripped text**, because stripping removes the marker that
 * decides the question: both forms reduce to the same prose, and only the raw text says which rule applied.
 */
export const JSDOC_MARKERS: readonly string[] = ['/**'];

/** Three slashes or a doubled star open documentation in C#; a plain `//` or a single-star block does not. */
export const XML_DOC_MARKERS: readonly string[] = ['///', '/**'];
