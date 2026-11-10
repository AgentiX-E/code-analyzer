// @code-analyzer/intelligence — the import-specifier scanner's own contract
//
// **The scanner replaced a pattern, and a replacement has to be read as carefully as the thing it replaced.** The lens
// that uses it exercises one shape; these cases are the shapes an import statement has and the shapes that merely look
// like one, because the difference between `from` and `fromage` is the difference between a linked module and a made-up
// one - and a lens that reports the second has reported a violation against a file that does not exist.

import { describe, expect, it } from 'vitest';

import { readImportSpecifier } from '../review/import-specifier.js';

describe('readImportSpecifier', () => {
  it('reads every form an import statement takes', () => {
    expect(readImportSpecifier("import { a, b } from './mod';")).toBe('./mod');
    expect(readImportSpecifier('import defaultExport from "pkg"')).toBe('pkg');
    expect(readImportSpecifier("import * as ns from '@scope/pkg/sub'")).toBe('@scope/pkg/sub');
    expect(readImportSpecifier("import 'side-effect-only'")).toBeNull();
    expect(readImportSpecifier("import\t{ a }\tfrom\t'tabbed'")).toBe('tabbed');
    // An indented statement is a statement.
    expect(readImportSpecifier("    import a from './indented';")).toBe('./indented');
  });

  it('keeps a specifier that contains what used to end it', () => {
    // **The pattern captured to the last `"` before the end of the line; the scanner captures to the first closing quote
    // of the same kind.** A path with a space, a quote of the other kind, or a `from` in its own name is a path.
    expect(readImportSpecifier("import a from './with space/mod'")).toBe('./with space/mod');
    expect(readImportSpecifier('import a from "./it\'s/a/path"')).toBe("./it's/a/path");
    expect(readImportSpecifier("import a from './from/here'")).toBe('./from/here');
  });

  it('refuses a line that contains the word without being an import', () => {
    expect(readImportSpecifier("const important = require('./x');")).toBeNull();
    expect(readImportSpecifier('important from "x"')).toBeNull();
    // `importx` is an identifier, not a keyword.
    expect(readImportSpecifier('importx from "pkg"')).toBeNull();
    // And so is `ximport`, which is the same test on the other side of the keyword - the case that separates "the line
    // starts with a keyword" from "the line contains one".
    expect(readImportSpecifier('ximport a from "pkg"')).toBeNull();
    // The keyword needs a separator, which `import{a}from'x'` does not have.
    expect(readImportSpecifier("import{a}from'x'")).toBeNull();
    expect(readImportSpecifier('import')).toBeNull();
    expect(readImportSpecifier('')).toBeNull();
    // An export re-exports; it does not import.
    expect(readImportSpecifier("export { a } from './mod';")).toBeNull();
  });

  it('skips a `from` that is not the one introducing the specifier', () => {
    // The first candidate is inside an identifier, so it fails the word test and the scan continues to the next one.
    expect(readImportSpecifier("import a fromageb from 'x'")).toBe('x');
    // The first is followed by something that is not a quote, so the scan continues rather than giving up.
    expect(readImportSpecifier('import a from from "x"')).toBe('x');
    // A `from` in the middle of a name is not preceded by whitespace.
    expect(readImportSpecifier("import abfrom 'x'")).toBeNull();
  });

  it('returns null rather than an empty string when the quote never closes', () => {
    // **A zero-length path is not a module**, and a caller cannot tell it from a match - so the refusal is `null`, which
    // is the same thing this returns for a line that is not an import at all.
    expect(readImportSpecifier("import a from './unclosed")).toBeNull();
    expect(readImportSpecifier('import a from "')).toBeNull();
  });

  it('costs the length of the line whatever the line contains', () => {
    // The shape that made the pattern unusable: the keyword, then forty thousand characters that never say `from`.
    const hostile = `import ${' '.repeat(40_000)}`;
    const started = performance.now();
    for (let i = 0; i < 5; i++) readImportSpecifier(hostile);
    expect(performance.now() - started).toBeLessThan(50);
    expect(readImportSpecifier(hostile)).toBeNull();
  });
});
