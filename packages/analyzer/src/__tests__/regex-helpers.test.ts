/**
 * The four text helpers the providers without a grammar share.
 *
 * **They had no test of their own.** `captureDocComments` was reached through Dart, Lua and Zig; `extractSecretSources`
 * through the configuration providers; `sanitizeSource` and `lineNumber` through all of them. Indirect coverage is
 * enough to execute a function and not enough to state what it does, and the arms a real file does not happen to take -
 * a line with no secret keyword on it, a doc block with no declaration under it - were executed by nothing at all.
 */

import { describe, expect, it } from 'vitest';

import {
  captureDocComments,
  extractSecretSources,
  lineNumber,
  sanitizeSource,
} from '../languages/regex-helpers.js';

import type { UnifiedCapture } from '@code-analyzer/shared';

describe('the secrets a configuration line declares', () => {
  it('reports one source per matching line', () => {
    const sources = extractSecretSources('password: hunter2\nport: 80', 'config', ['password']);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ name: 'password', line: 1, sourceType: 'config' });
  });

  it('matches a keyword whatever case it is written in', () => {
    const sources = extractSecretSources('API_KEY = "x"', 'config', ['api_key']);
    expect(sources.map((source) => source.line)).toEqual([1]);
  });

  /**
   * **The line that carries no keyword is the majority of a configuration file**, and it is the input the scan is
   * written to skip: a keyword list is walked per line, so the arm that finds nothing is the one every unrelated line
   * takes.
   */
  it('says nothing about lines that declare none of the keywords', () => {
    expect(
      extractSecretSources('port: 80\nhost: localhost', 'config', ['password', 'token']),
    ).toEqual([]);
  });

  it('reports the first keyword a line matches, not every one', () => {
    const sources = extractSecretSources('token: password', 'config', ['token', 'password']);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.name).toBe('token');
  });
});

describe('a source as the scanner wants to read it', () => {
  it('takes a byte-order mark off the front', () => {
    expect(sanitizeSource('\uFEFFpassword: x')).toBe('password: x');
  });

  it('takes a byte-order mark out of the middle too', () => {
    expect(sanitizeSource('a\uFEFFb')).toBe('ab');
  });

  it('reads every line ending as a newline', () => {
    expect(sanitizeSource('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('removes a zero-width joiner, which no parser accepts inside an identifier', () => {
    expect(sanitizeSource('a\u200Bb\u200Cc\u200Dd')).toBe('abcd');
  });

  it('counts the lines before an offset, one-based', () => {
    expect(lineNumber('a\nb\nc', 3)).toBe(2);
  });
});

describe('a doc comment a text provider has to find by shape', () => {
  const declaration = (startLine: number): UnifiedCapture => ({
    tag: 'class.def',
    text: 'class Widget',
    startLine,
    endLine: startLine,
    startByte: 0,
    endByte: 0,
    name: 'Widget',
    properties: {},
  });

  it('documents the declaration on the line below it', () => {
    const target = declaration(2);
    const captures = captureDocComments(
      '/// A widget.\nclass Widget {}',
      'a.dart',
      ['///'],
      [target],
    );
    expect(captures).toHaveLength(1);
    expect(target.properties?.docstring).toBe('A widget.');
  });

  it('joins the lines of a block into one docstring', () => {
    const target = declaration(3);
    const captures = captureDocComments(
      '/// A widget.\n/// It is round.\nclass Widget {}',
      'a.dart',
      ['///'],
      [target],
    );
    expect(target.properties?.docstring).toBe('A widget.\nIt is round.');
    expect(captures[0]!.startLine).toBe(1);
    expect(captures[0]!.endLine).toBe(2);
  });

  /**
   * **The blank line detaches the block from the declaration and does not delete the block.** A text provider has only
   * adjacency, so a comment two lines above a declaration documents nothing — and it is still a comment in the file.
   * The version of this function that cleared the block instead of flushing it lost every doc comment at the end of a
   * file, because the newline that ends the last line of a file is a blank line.
   */
  it('documents nothing when a blank line separates it from the declaration', () => {
    const target = declaration(3);
    const captures = captureDocComments(
      '/// A widget.\n\nclass Widget {}',
      'a.dart',
      ['///'],
      [target],
    );
    expect(captures).toHaveLength(1);
    expect(target.properties?.docstring).toBeUndefined();
  });

  it('keeps a block at the end of a file that ends with a newline', () => {
    const captures = captureDocComments('/// nothing follows\n', 'a.dart', ['///'], []);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.tag).toBe('docstring');
  });

  it('reads whichever of the language markers opens the block', () => {
    const target = declaration(2);
    captureDocComments('-- A widget.\nlocal Widget = {}\n', 'a.lua', ['--'], [target]);
    expect(target.properties?.docstring).toBe('A widget.');
  });
});
