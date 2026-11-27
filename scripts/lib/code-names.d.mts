/**
 * **The declaration for `code-names.mjs`, so the harvest and the test read one arithmetic.**
 *
 * The module is `.mjs` because plain `node` runs it, and this repository keeps a `.d.mts` beside such a file for the
 * reason `symbol-anatomy.d.mts` states: a shape that is only exercised through a command line is a shape asserted by
 * reading output.
 */

/** A mutable flag carried from line to line, because a block comment crosses them. */
export interface CommentState {
  block: boolean;
}

/** The comment syntax families this repository's ten languages divide into. */
export type CommentFamily = 'hash' | 'dash' | 'markup' | 'c';

/** The tokens that are syntax rather than names. */
export declare const KEYWORDS: Set<string>;

export declare function commentFamily(path: string): CommentFamily;
export declare function stripComments(text: string, path: string, state?: CommentState): string;
export declare function codeNamesOf(diff: string): string[];
