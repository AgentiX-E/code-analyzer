// @code-analyzer/shared — the glob matcher the include list is read with
//
// **The cases here are the patterns a reader actually types**, and the first two are the ones the previous three
// implementations got wrong: `**/*.kt` did not match a file at the root of a checkout, and `build/` did not name a
// directory's contents.

import { describe, expect, it } from 'vitest';

import { globToRegExp, matchesIncludePattern } from '../utils/glob.js';

describe('matchesIncludePattern', () => {
  it('includes everything when the list is empty', () => {
    expect(matchesIncludePattern('src/main/A.kt', [])).toBe(true);
  });

  it('matches a root file with the double-star form', () => {
    // **The defect this function exists to end.** `^.*/[^/]*\.kt$` needs a slash, so `build.kt` was excluded by the
    // pattern whose whole purpose is to include Kotlin.
    expect(matchesIncludePattern('build.kt', ['**/*.kt'])).toBe(true);
    expect(matchesIncludePattern('src/main/A.kt', ['**/*.kt'])).toBe(true);
    expect(matchesIncludePattern('src/main/a/b/c/A.kt', ['**/*.kt'])).toBe(true);
  });

  it('matches a bare glob against the basename', () => {
    expect(matchesIncludePattern('src/main/A.kt', ['*.kt'])).toBe(true);
    expect(matchesIncludePattern('A.kt', ['*.kt'])).toBe(true);
    expect(matchesIncludePattern('src/main/A.java', ['*.kt'])).toBe(false);
  });

  it('matches a directory pattern against its contents', () => {
    expect(matchesIncludePattern('src/A.kt', ['src/**'])).toBe(true);
    expect(matchesIncludePattern('src/main/deep/A.kt', ['src/**'])).toBe(true);
    expect(matchesIncludePattern('lib/A.kt', ['src/**'])).toBe(false);
    expect(matchesIncludePattern('src/A.kt', ['src/'])).toBe(true);
  });

  it('keeps a single star inside one segment', () => {
    expect(matchesIncludePattern('src/A.kt', ['src/*.kt'])).toBe(true);
    expect(matchesIncludePattern('src/main/A.kt', ['src/*.kt'])).toBe(false);
  });

  it('treats a question mark as one character within a segment', () => {
    expect(matchesIncludePattern('src/A.kt', ['src/?.kt'])).toBe(true);
    expect(matchesIncludePattern('src/AB.kt', ['src/?.kt'])).toBe(false);
  });

  it('normalises a leading ./ and a backslash separator', () => {
    expect(matchesIncludePattern('./src/A.kt', ['src/*.kt'])).toBe(true);
    expect(matchesIncludePattern('src\\A.kt', ['src/*.kt'])).toBe(true);
  });

  it('ignores blank patterns rather than matching nothing', () => {
    expect(matchesIncludePattern('src/A.kt', ['  ', 'src/*.kt'])).toBe(true);
    expect(matchesIncludePattern('src/A.kt', ['  '])).toBe(false);
  });

  it('treats negation as a literal, because this language has none', () => {
    expect(matchesIncludePattern('!A.kt', ['!A.kt'])).toBe(true);
    expect(matchesIncludePattern('A.kt', ['!A.kt'])).toBe(false);
  });

  it('reads a dot as a literal rather than any character', () => {
    expect(matchesIncludePattern('src/Axkt', ['src/A.kt'])).toBe(false);
    expect(matchesIncludePattern('src/A.kt', ['src/A.kt'])).toBe(true);
  });

  it('answers the same on a repeated pattern, which the cache serves', () => {
    expect(matchesIncludePattern('src/A.kt', ['src/*.kt'])).toBe(true);
    expect(matchesIncludePattern('src/A.kt', ['src/*.kt'])).toBe(true);
  });

  it('survives more distinct patterns than the cache holds', () => {
    // **A wholesale drop rather than an eviction policy**: the cache exists so that walking twenty thousand files does
    // not recompile ten patterns twenty thousand times, and a bounded map that grows without limit is a leak.
    for (let index = 0; index < 1_100; index++) globToRegExp(`src/${String(index)}/*.kt`);
    expect(matchesIncludePattern('src/5/A.kt', ['src/5/*.kt'])).toBe(true);
  });
});

describe('globToRegExp', () => {
  it('anchors both ends', () => {
    expect(globToRegExp('src/*.kt').test('prefix/src/A.kt')).toBe(false);
    expect(globToRegExp('src/*.kt').test('src/A.kt.suffix')).toBe(false);
  });

  it('lets a double star cross separators', () => {
    expect(globToRegExp('src/**.kt').test('src/a/b/c.kt')).toBe(true);
  });

  it('escapes the characters a regular expression would read as syntax', () => {
    expect(globToRegExp('a+b(c).kt').test('a+b(c).kt')).toBe(true);
  });
});
