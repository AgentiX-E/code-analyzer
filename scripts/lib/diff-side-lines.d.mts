// **Declarations for the diff lexer, because the readout's tests import a `.mjs` and an undeclared one is `any`.**
//
// The same rule `claims-match.d.mts` records: a test that reaches an undeclared module compiles against `any`, so a line
// number that is actually a string would be accepted by every assertion in the file. The shapes here are the ones the
// implementation builds, and they are the shapes the prompt and the quote check both read.

/** One line of the new revision inside a hunk. */
export interface SideLine {
  line: number;
  text: string;
  added: boolean;
}

/** One added line, as the new revision numbers it. */
export interface AddedLine {
  line: number;
  text: string;
}

/** One file's new-side lines, keyed by the path the new revision gives it. */
export interface FileSideLines {
  path: string;
  lines: SideLine[];
  added: AddedLine[];
  removed: number;
}

export declare function sideLinesByPath(diff: string): Map<string, FileSideLines>;

export declare function evidenceWindow(
  lines: AddedLine[],
  startLine: number,
  options?: { before?: number; after?: number; max?: number; width?: number },
): string[];
