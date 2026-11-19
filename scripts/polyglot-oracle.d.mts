/**
 * The oracle's own types, so that the script which compares against it is checked like every other TypeScript file here.
 *
 * **This file exists because a `.mjs` import is untyped by default**, and an untyped import inside a typechecked project
 * is the shape that let a missing declaration reach CI in §86. The signature is the whole surface: one file, one
 * language, the names that language's grammar says the file declares.
 */
export declare function declarations(file: string, language: string): string[] | null;
