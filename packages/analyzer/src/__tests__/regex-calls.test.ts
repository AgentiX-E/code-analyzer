import { describe, expect, it } from 'vitest';

import { captureRegexCallSites } from '../languages/regex-calls.js';

import type { RegexCallOptions } from '../languages/regex-calls.js';

const DART: RegexCallOptions = {
  filePath: 'a.dart',
  // **The keywords only.** A type name is not a keyword: `String topLevel(` is a declaration because a word stands
  // in front of the callee, and `return helper(` is a call because that word is one of these.
  skip: new Set(['if', 'while', 'return', 'function', 'final', 'var', 'const']),
};

const names = (source: string, options: RegexCallOptions = DART): string[] =>
  captureRegexCallSites(source, options).map((capture) => `${capture.tag}:${capture.name}`);

describe('a call site in a source that is only text', () => {
  it('finds a plain call', () => {
    expect(names('final x = helper(1);')).toEqual(['function.call:helper']);
  });

  it('finds a call whose callee is dotted, and files it as a method', () => {
    expect(names('Widget.of(1);')).toEqual(['method.call:of']);
  });

  it('finds a chain of calls, each at its own offset', () => {
    expect(names('a.b(1); c(2);')).toEqual(['method.call:b', 'function.call:c']);
  });

  it('records the argument count', () => {
    const [capture] = captureRegexCallSites('helper(1, 2, 3);', DART);
    expect(capture!.properties).toMatchObject({ argumentCount: '3' });
  });

  it('records zero for a call with an empty list', () => {
    const [capture] = captureRegexCallSites('helper();', DART);
    expect(capture!.properties).toMatchObject({ argumentCount: '0' });
  });

  it('states no count when a spread makes the length a runtime fact', () => {
    const [capture] = captureRegexCallSites('helper(...items);', DART);
    expect(capture!.properties?.argumentCount).toBeUndefined();
  });

  it('counts a nested call as one argument rather than flattening it', () => {
    const captures = captureRegexCallSites('outer(inner(1), 2);', DART);
    const outer = captures.find((capture) => capture.name === 'outer')!;
    expect(outer.properties).toMatchObject({ argumentCount: '2' });
    expect(captures.map((capture) => capture.name)).toEqual(['outer', 'inner']);
  });

  it('says nothing about a call whose parenthesis is never closed', () => {
    expect(names('helper(1, 2')).toEqual([]);
  });
});

describe('what is not a call', () => {
  it('skips a keyword that opens a parenthesis', () => {
    expect(names('if (x) { y(); }')).toEqual(['function.call:y']);
  });

  it('skips a declaration, whose parenthesis follows a return type', () => {
    expect(names('String topLevel(String name) { return helper(name); }')).toEqual([
      'function.call:helper',
    ]);
  });

  it('skips a callee behind an @, which is a builtin', () => {
    expect(names('const std = @import("std");')).toEqual([]);
  });

  it('does not read a call out of a string literal', () => {
    expect(names('final message = "call helper(1) later";')).toEqual([]);
  });

  it('does not read a call out of a line comment', () => {
    expect(names('// helper(1)\nrun();')).toEqual(['function.call:run']);
  });

  it('does not read a call out of a block comment', () => {
    expect(names('/* helper(1) */ run();')).toEqual(['function.call:run']);
  });

  it('does not read a call out of a Lua block comment', () => {
    expect(names('--[[ helper(1) ]] run();')).toEqual(['function.call:run']);
  });

  it('skips a single-quoted string as well as a double-quoted one', () => {
    expect(names("final a = 'helper(1)'; run();")).toEqual(['function.call:run']);
  });

  it('keeps the newlines so every offset still points at the file it came from', () => {
    const source = '// helper(1)\n\nrun();';
    const [capture] = captureRegexCallSites(source, DART);
    expect(capture!.startLine).toBe(3);
    expect(source.slice(capture!.startByte)).toMatch(/^run\(/);
  });
});

/**
 * **A file that ends in the middle of a comment or a string is a file being written.**
 *
 * The scanner reads text, so it meets the states a text file is in while an editor saves it: a line comment with no
 * newline after it, a block comment with no closing marker, a Lua block comment that never ends, and a string whose
 * escaped quote the scanner has to step over rather than end the literal at. Each has to leave the code after it
 * readable — a scanner that ran to the end of the buffer looking for a closing marker would report no call site in the
 * rest of the file.
 */
describe('a source that stops in the middle of a comment or a string', () => {
  it('treats a line comment that ends the file as a comment', () => {
    expect(names('run(); // helper(1)')).toEqual(['function.call:run']);
  });

  it('treats an unterminated block comment as a comment to the end of the file', () => {
    expect(names('run(); /* helper(1)')).toEqual(['function.call:run']);
  });

  it('treats an unterminated Lua block comment as a comment to the end of the file', () => {
    expect(names('run(); --[[ helper(1)')).toEqual(['function.call:run']);
  });

  it('treats a Lua line comment that ends the file as a comment', () => {
    expect(names('run(); -- helper(1)')).toEqual(['function.call:run']);
  });

  it('steps over an escaped quote inside a literal', () => {
    expect(names('final a = "x\\"helper(1)"; run();')).toEqual(['function.call:run']);
  });

  it('reads a call after a string that is never closed', () => {
    expect(names('final a = "unclosed; run();')).toEqual([]);
  });
});
