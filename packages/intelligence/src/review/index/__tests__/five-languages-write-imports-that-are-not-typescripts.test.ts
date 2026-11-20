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

  it('reads a backslash continuation, which is how Python wraps an import without parentheses', () => {
    const statements = read('python', 'import very.long.module, \\\n    another.module');
    expect(statements.map((statement) => statement.specifier)).toEqual([
      'very.long.module',
      'another.module',
    ]);
  });

  it('refuses a relative import that walks above the root, rather than resolving it to something', () => {
    const files = new Set(['mod.py']);
    expect(resolvePythonSpecifier('...mod', 'top.py', files)).toBeNull();
  });

  it('resolves a from-import of the package itself, which is what a lone dot means', () => {
    const files = new Set(['pkg/__init__.py']);
    expect(resolvePythonSpecifier('.', 'pkg/a.py', files)).toBe('pkg/__init__.py');
  });

  it('reads Swift’s modified forms and ignores a language it does not answer', () => {
    expect(read('swift', 'import class UIKit.UIView')[0]?.specifier).toBe('UIKit.UIView');
    expect(readLanguageImports('typescript', ['import a from "b"'], ['import a from "b"'])).toEqual(
      [],
    );
  });

  it('reads a JVM import with no semicolon, which Groovy allows', () => {
    expect(read('groovy', 'import groovy.transform.CompileStatic')[0]?.specifier).toBe(
      'groovy.transform.CompileStatic',
    );
  });

  it('refuses a lone dot at the root, where there is no package to mean', () => {
    expect(resolvePythonSpecifier('.', 'a.py', new Set(['__init__.py']))).toBeNull();
  });

  it('resolves an absolute Python import from the root, where there are no segments to walk', () => {
    const files = new Set(['pkg/mod.py']);
    expect(resolvePythonSpecifier('pkg.mod', 'a.py', files)).toBe('pkg/mod.py');
  });

  it('reads a static import with an alias, and a Kotlin script’s extension', () => {
    const [statement] = read('kotlin', 'import static a.b.C.m as n');
    expect(statement?.specifier).toBe('a.b.C');
    expect(statement?.names).toEqual([{ imported: 'm', local: 'n' }]);
    const byBase = new Map([['build.gradle.kts', ['build.gradle.kts']]]);
    expect(resolveJvmSpecifier('kotlin', 'build.gradle', byBase)).toBeNull();
  });

  it('stops a continuation at the end of the file rather than reading past it', () => {
    expect(read('python', 'import a\\')).toHaveLength(1);
    expect(read('python', 'from a import (b')).toHaveLength(1);
  });

  it('skips an empty piece in a Python list, which a trailing comma produces', () => {
    expect(read('python', 'from a import b,')).toHaveLength(1);
  });

  it('answers nothing for an empty Python specifier, which a malformed line produces', () => {
    expect(resolvePythonSpecifier('', 'a.py', new Set(['a.py']))).toBeNull();
  });

  it('answers a JVM specifier whose file sits at the source root, with no prefix to end with', () => {
    expect(resolveJvmSpecifier('java', 'C', new Map([['C.java', ['C.java']]]))).toBe('C.java');
  });

  it('makes no edge for a wildcard, because a package is not one file', () => {
    const index = buildRepoIndex([
      { path: 'a/b/C.java', text: 'package a.b;\npublic class C {}' },
      { path: 'a/b/Use.java', text: 'package a.b;\nimport a.b.*;\nclass Use {}' },
    ]);
    /**
     * **The edge is refused and the import is not called external.** §102 changed the second half: `a.b` is a package
     * this repository declares, so `import a.b.*` is a resolution with no file behind it - **`external` said the package
     * was somebody else's, which is the one thing the index can refute**. On `kotlinx.coroutines` 3 548 of 4 302
     * imports are wildcards, so the old answer described the shape of the imports rather than the coverage of the index.
     */
    expect(index.stats.externalImports).toBe(0);
    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.namespaceImports).toBe(1);
    expect(index.references).toEqual([]);
    expect(index.imports[0]?.why).toBe('package');
  });

  it('still calls a wildcard external when no package of this repository answers it', () => {
    const index = buildRepoIndex([
      { path: 'a/b/C.java', text: 'package a.b;\nimport java.util.*;\npublic class C {}' },
    ]);
    // **`java.util` is not in this checkout**, and the index has no way to be wrong about that.
    expect(index.stats.externalImports).toBe(1);
    expect(index.stats.resolvedImports).toBe(0);
  });

  it('declines an edge when the target does not declare the imported name, or the importer never uses it', () => {
    const index = buildRepoIndex([
      { path: 'pkg/mod.py', text: 'def other():\n    return 1\n' },
      { path: 'pkg/use.py', text: 'from .mod import missing, other\n' },
    ]);
    expect(index.references).toEqual([]);
    expect(index.stats.resolvedImports).toBe(1);
  });

  it('answers nothing when neither a module nor a package answers the specifier', () => {
    expect(resolvePythonSpecifier('nope', 'a.py', new Set(['pkg/mod.py']))).toBeNull();
  });

  it('reads a static wildcard, which names a type’s members rather than a type', () => {
    const [statement] = read('java', 'import static a.b.*;');
    expect(statement?.specifier).toBe('a');
    expect(statement?.namespace).toBe(true);
  });

  it('has no extension table for a language it does not resolve', () => {
    expect(resolveJvmSpecifier('swift', 'a.b.C', new Map([['C.java', ['C.java']]]))).toBeNull();
  });

  it('stops an unterminated parenthesised plain import at the bound', () => {
    expect(read('python', 'import (a')).toHaveLength(1);
  });

  it('reads only the import lines of a Swift file, because its body is not an import', () => {
    // **The branch this covers is the common case rather than an edge case**: a Swift file is mostly declarations, and
    // every one of them reaches the same guard an unmatched import line does.
    const statements = read(
      'swift',
      [
        'import Foundation',
        '',
        'struct Shapes {',
        '  let names: [String]',
        '  func count() -> Int { names.count }',
        '}',
      ].join('\n'),
    );
    expect(statements.map((statement) => statement.specifier)).toEqual(['Foundation']);
    expect(statements[0]?.kind).toBe('module');
  });

  it('chooses between two files with the same class name, and picks the package the import names', () => {
    // **The suffix index has more than one entry per basename the moment a repository holds two classes called `C`**, and
    // that is the case a first-match rule gets wrong: `x.y.C` and `a.b.C` share a name and not a package.
    const index = buildRepoIndex([
      {
        path: 'src/x/y/C.java',
        text: 'package x.y;\npublic class C { public static int m() { return 1; } }\n',
      },
      {
        path: 'src/a/b/C.java',
        text: 'package a.b;\npublic class C { public static int m() { return 2; } }\n',
      },
      {
        path: 'src/a/b/Use.java',
        text: 'package a.b;\nimport a.b.C;\nclass Use { int v = C.m(); }\n',
      },
    ]);
    expect(index.references).toContainEqual({
      fromPath: 'src/a/b/Use.java',
      fromLine: 3,
      toPath: 'src/a/b/C.java',
      toName: 'C',
    });
  });
});
