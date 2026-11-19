/**
 * **Five languages write an import five ways, and the reader is one function with three branches.**
 *
 * The cases below are the ones a line-based reader gets wrong, and each was chosen because it is a shape the field
 * writes rather than a shape a parser finds interesting: **a static import whose last segment is a member**, a wildcard
 * that names no name, **an import inside a string** (this repository's own `benchmark-fixtures.ts` defect, in five more
 * languages), **a Python `from … import (…)` over four lines**, and **a Swift import that names a module rather than a
 * file**.
 *
 * The resolution cases are separate, because a statement reader and a resolver fail differently: the first can invent a
 * statement, the second can invent an edge.
 */
import { describe, expect, it } from 'vitest';

import {
  readLanguageImports,
  resolveJvmSpecifier,
  resolvePythonSpecifier,
} from '../imports-langs.js';
import { buildRepoIndex, impactOf } from '../repo-index.js';

/** Read one file the way `buildRepoIndex` does, with the masked lines equal to the source when nothing is blanked. */
const read = (language: string, text: string) => {
  const lines = text.split('\n');
  return readLanguageImports(language, lines, lines);
};

describe('a JVM import', () => {
  it('names the type it imports, and a static import names the member', () => {
    const [plain, statik] = read(
      'java',
      ['import a.b.C;', 'import static a.b.C.m;', 'class X {}'].join('\n'),
    );
    expect(plain?.specifier).toBe('a.b.C');
    expect(plain?.names).toEqual([{ imported: 'C', local: 'C' }]);
    expect(statik?.specifier).toBe('a.b.C');
    expect(statik?.names).toEqual([{ imported: 'm', local: 'm' }]);
  });

  it('treats a wildcard as a namespace, because it says nothing about which name crosses', () => {
    const [wildcard] = read('kotlin', 'import kotlinx.coroutines.*');
    expect(wildcard?.specifier).toBe('kotlinx.coroutines');
    expect(wildcard?.namespace).toBe(true);
    expect(wildcard?.names).toEqual([]);
  });

  it('reads Kotlin’s alias, because the local name is what a later line uses', () => {
    const [aliased] = read('kotlin', 'import kotlin.math.max as largest');
    expect(aliased?.names).toEqual([{ imported: 'max', local: 'largest' }]);
  });

  it('reads no import from a line the lexer blanked, which is where a string and a comment live', () => {
    const text = ['class X {', '  String s = "import a.b.C;";', '  // import a.b.D;', '}'].join(
      '\n',
    );
    const lines = text.split('\n');
    const codes = lines.map((line) =>
      line.includes('"') ? '  String s =               ;' : line.replace(/\/\/.*$/u, ''),
    );
    expect(readLanguageImports('java', lines, codes)).toEqual([]);
  });
});

describe('a Python import', () => {
  it('reads a comma list as several imports, because it is several', () => {
    const statements = read('python', 'import sys, json as js');
    expect(statements.map((statement) => statement.specifier)).toEqual(['sys', 'json']);
    expect(statements[1]?.names).toEqual([{ imported: 'json', local: 'js' }]);
  });

  it('reads a parenthesised from-import over four lines as one statement with two names', () => {
    const [statement] = read(
      'python',
      ['from ..pkg.mod import (', '    first,', '    second as other,', ')'].join('\n'),
    );
    expect(statement?.specifier).toBe('..pkg.mod');
    expect(statement?.names).toEqual([
      { imported: 'first', local: 'first' },
      { imported: 'second', local: 'other' },
    ]);
    expect(statement?.endLine).toBe(4);
  });

  it('treats a star import as a namespace rather than as a name called *', () => {
    const [statement] = read('python', 'from typing import *');
    expect(statement?.namespace).toBe(true);
    expect(statement?.names).toEqual([]);
  });
});

describe('a Swift import', () => {
  it('is a module and not a file, so the resolver is told to refuse it', () => {
    const [statement] = read('swift', 'import struct Dispatch.DispatchTime');
    expect(statement?.specifier).toBe('Dispatch.DispatchTime');
    expect(statement?.kind).toBe('module');
    expect(statement?.names).toEqual([]);
  });
});

describe('resolution', () => {
  it('answers a JVM specifier wherever the source root is, which is a suffix rather than a path', () => {
    const byBase = new Map([['C.java', ['src/main/java/a/b/C.java']]]);
    expect(resolveJvmSpecifier('java', 'a.b.C', byBase)).toBe('src/main/java/a/b/C.java');
  });

  it('refuses a JVM specifier no file answers, rather than guessing a path', () => {
    expect(resolveJvmSpecifier('java', 'java.util.List', new Map())).toBeNull();
  });

  it('walks up one directory per dot after the first, which is the one rule that needs the importer', () => {
    const files = new Set([
      'pkg/a/mod.py',
      'pkg/mod.py',
      'pkg/a/__init__.py',
      'pkg/a/b/__init__.py',
    ]);
    expect(resolvePythonSpecifier('.mod', 'pkg/a/b.py', files)).toBe('pkg/a/mod.py');
    expect(resolvePythonSpecifier('..mod', 'pkg/a/b.py', files)).toBe('pkg/mod.py');
    expect(resolvePythonSpecifier('.', 'pkg/a/b.py', files)).toBe('pkg/a/__init__.py');
  });

  it('turns three of the five languages into edges, and says which name reaches which file', () => {
    const index = buildRepoIndex([
      {
        path: 'src/main/java/a/b/C.java',
        text: 'package a.b;\npublic class C { public static int m() { return 1; } }',
      },
      {
        path: 'src/main/java/a/b/Use.java',
        text: 'package a.b;\nimport a.b.C;\nclass Use { int v = 0; }',
      },
      { path: 'pkg/mod.py', text: 'def helper():\n    return 1\n' },
      { path: 'pkg/use.py', text: 'from .mod import helper\n\nprint(helper())\n' },
      { path: 'app/Main.swift', text: 'import Foundation\n' },
    ]);
    expect(index.stats.resolvedImports).toBe(2);
    expect(index.stats.externalImports).toBe(1);
    expect(index.references).toEqual([
      { fromPath: 'pkg/use.py', fromLine: 3, toPath: 'pkg/mod.py', toName: 'helper' },
    ]);
    // **A Java import of a type the file does not use is not an edge**, and the impact set says so.
    expect(impactOf(index, 'src/main/java/a/b/C.java', ['C']).callers).toEqual([]);
    expect(impactOf(index, 'pkg/mod.py', ['helper']).paths).toEqual(['pkg/use.py']);
  });
});
