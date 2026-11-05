// The file-level fallback's own tests.
//
// **What can be wrong here without looking wrong.** A fallback is only worth having if its figure is on the instances
// the analysis refused, so the failures that matter are the ones that make it look like it ran when it did not: an
// extractor that finds no imports and reports a path-only document as a path-and-imports one; a document that quietly
// drops the path, which is the strongest feature this task has; a ranking that omits files whose head could not be read,
// shrinking the universe it claims to rank; a scorer that is not the control's, turning a one-variable experiment into a
// comparison of two formulas.
//
// **And one test is an equivalence rather than an example.** On a checkout where every file holds only its path and its
// imports, the fallback's document and the control's document are the same text - so the two rankings must be identical.
// That is the assertion that says the shared arithmetic in `search/lexical.ts` really is shared, and it fails the moment
// somebody copies one of the six components instead of importing it.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildPathImportsIndex,
  extractImports,
  IMPORT_HEAD_BYTES,
  pathDocument,
  pathImportsRanking,
  rankByPathImports,
} from '../../search/path-imports.js';
import { buildTermIndex, rankBm25 } from '../lca-baseline.js';
import { fallbackArm } from '../lca-fallback.js';

/** A checkout holding the named files, each with the content given. **Real files, because the head cap is about bytes.** */
function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'lca-fallback-'));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  return root;
}

describe('extractImports', () => {
  it('reads a Python from-import as the module it names', () => {
    expect(extractImports('from a.b.c import thing\n')).toEqual(['a.b.c']);
  });

  it('reads a Python plain import, which the loose pattern is left for', () => {
    expect(extractImports('import os\nimport a.b as c\n')).toEqual(['os', 'a.b']);
  });

  it('reads a Java import as the qualified name', () => {
    expect(
      extractImports('package x;\n\nimport java.util.List;\nimport static a.b.C.d;\n'),
    ).toEqual(['java.util.List', 'a.b.C.d']);
  });

  it('reads a Kotlin import the same way it reads a Java one', () => {
    expect(extractImports('import kotlinx.coroutines.flow.Flow\n')).toEqual([
      'kotlinx.coroutines.flow.Flow',
    ]);
  });

  it('reads a JavaScript default import as the module, **not as the bound name**', () => {
    // **The ordering bug this pins.** The loose `import ([\w.]+)` form matches `import express` here and captures the
    // local name; the module - the word that could appear in an issue - is on the other side of `from`.
    expect(extractImports("import express from 'express';\n")).toEqual(['express']);
    expect(extractImports("import type { X } from './types';\n")).toEqual(['./types']);
  });

  it('reads a side-effect import and a re-export', () => {
    expect(extractImports("import './polyfills';\nexport { x } from './y';\n")).toEqual([
      './polyfills',
      './y',
    ]);
  });

  it('reads a CommonJS require wherever it appears on the line', () => {
    expect(extractImports("const fs = require('node:fs');\n")).toEqual(['node:fs']);
  });

  it('reads a C# using, a Rust use, a C include and a Go import', () => {
    expect(
      extractImports('using A.B;\nuse a::b::c;\n#include <sys/types.h>\nimport "net/http"\n'),
    ).toEqual(['A.B', 'a::b::c', 'sys/types.h', 'net/http']);
  });

  it('finds nothing in prose, a comment or a blank line', () => {
    // **The miss that must be visible rather than noisy.** A body paragraph mentioning `import` mid-sentence is not an
    // import statement, and a fixture that counted it would inflate `importLines` on every instance.
    expect(extractImports('The import handler is broken.\n\n// import x from y\n')).toEqual([]);
  });

  it('drops an import whose subject is empty', () => {
    // **A real line in generated code**, and the only way the length check is a check rather than a guard.
    expect(extractImports("import '';\n")).toEqual([]);
  });

  it('counts one statement once when two forms could both match it', () => {
    expect(extractImports('import java.util.List;\n')).toHaveLength(1);
  });
});

describe('pathDocument', () => {
  it('puts the path in front of the imports, so a filename term matches', () => {
    const document = pathDocument('src/net/RetryPolicy.java', ['java.util.List']);
    expect(document.tokens).toContain('retrypolicy');
    expect(document.tokens).toContain('retry');
    expect(document.tokens).toContain('policy');
    expect(document.tokens).toContain('list');
    expect(document.importLines).toBe(1);
  });

  it('holds the path even when there are no imports', () => {
    // **A file with no imports still ranks on its name**, which is the half of the document that is always available.
    expect(pathDocument('src/http/client.ts', []).tokens).toEqual(
      expect.arrayContaining(['http', 'client', 'ts']),
    );
  });
});

describe('buildPathImportsIndex', () => {
  it('indexes exactly the files it is given', () => {
    const root = checkout({ 'a.py': 'import os\n', 'b.py': 'import sys\n', 'c.md': '# x\n' });
    const index = buildPathImportsIndex(root, ['a.py', 'b.py']);
    expect(index.documents.map((document) => document.path)).toEqual(['a.py', 'b.py']);
  });

  it('caps the head it reads rather than the file', () => {
    // **The head cap, tested through its consequence.** The import sits past the cap, so it is not in the document;
    // the path still is, which is what makes the cap a budget rather than a hole.
    const body = 'x'.repeat(IMPORT_HEAD_BYTES + 100);
    const root = checkout({ 'late.py': `${body}\nimport missing.module\n` });
    const index = buildPathImportsIndex(root, ['late.py']);
    expect(index.documentFrequency.has('missing')).toBe(false);
    expect(index.documentFrequency.has('late')).toBe(true);
  });

  it('honours a caller’s smaller cap', () => {
    const root = checkout({ 'a.py': 'import alpha.beta\n' });
    const index = buildPathImportsIndex(root, ['a.py'], { headBytes: 4 });
    expect(index.importLines).toBe(0);
  });

  it('keeps a file it could not read in the universe, and counts it', () => {
    // **Dropping an unreadable file would shrink the universe the ranking is a ranking of**, which is the one thing a
    // fallback may not do: it exists to rank everything.
    const root = checkout({ 'a.py': 'import os\n' });
    const index = buildPathImportsIndex(root, ['a.py', 'gone.py']);
    expect(index.unreadableFiles).toBe(1);
    expect(index.documents).toHaveLength(2);
  });

  it('has no document cap, which is the difference from the control', () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 4_500; index += 1) files[`f${String(index)}.py`] = 'import os\n';
    const root = checkout(files);
    expect(buildPathImportsIndex(root, Object.keys(files)).documents).toHaveLength(4_500);
    // The control, on the same answer space, holds four thousand and says how many it left out.
    expect(buildTermIndex(root, Object.keys(files)).documents).toHaveLength(4_000);
  });

  it('answers an empty answer space with an empty index rather than dividing by zero', () => {
    const root = checkout({});
    const index = buildPathImportsIndex(root, []);
    expect(index.averageLength).toBe(0);
    expect(rankByPathImports(index, 'anything', 10).ranked).toEqual([]);
  });
});

describe('rankByPathImports', () => {
  it('ranks the file whose name the question says first', () => {
    const root = checkout({
      'src/net/HttpClient.java': 'import java.util.List;\n',
      'src/net/RetryPolicy.java': 'import java.util.List;\n',
    });
    const result = pathImportsRanking({
      checkout: root,
      files: ['src/net/HttpClient.java', 'src/net/RetryPolicy.java'],
      query: 'retry policy drops the backoff',
      limit: 10,
    });
    expect(result.ranked[0]).toBe('src/net/RetryPolicy.java');
    expect(result.documents).toBe(2);
  });

  it('ranks on an import target the question names', () => {
    const root = checkout({
      'a/One.java': 'import org.apache.kafka.KafkaConsumer;\n',
      'a/Two.java': 'import java.util.List;\n',
    });
    const result = pathImportsRanking({
      checkout: root,
      files: ['a/One.java', 'a/Two.java'],
      query: 'kafka consumer rebalance storm',
      limit: 10,
    });
    expect(result.ranked).toEqual(['a/One.java']);
  });

  it('ties on path, so the ranking is a function of the corpus', () => {
    const root = checkout({ 'b/Same.java': 'import x.Y;\n', 'a/Same.java': 'import x.Y;\n' });
    const result = pathImportsRanking({
      checkout: root,
      files: ['b/Same.java', 'a/Same.java'],
      query: 'same',
      limit: 10,
    });
    expect(result.ranked).toEqual(['a/Same.java', 'b/Same.java']);
  });

  it('**agrees with the control when the document is the same**', () => {
    // **The equivalence, not an example.** Every file here holds only its path and its imports, so the control's
    // document (path + whole text) and the fallback's (path + imports) are the same string token for token. If the two
    // rankings differ, one of the six shared components was copied rather than imported - which is the defect this test
    // exists to make impossible to ship.
    const files = {
      'src/net/RetryPolicy.java': 'import java.util.List;\nimport org.slf4j.Logger;\n',
      'src/net/HttpClient.java': 'import java.util.List;\n',
      'src/util/Logger.java': 'import java.io.PrintStream;\n',
    };
    const root = checkout(files);
    const query = 'logger drops the last line';
    const names = Object.keys(files);
    const control = rankBm25(buildTermIndex(root, names, { includePath: true }), query, 10);
    const fallback = rankByPathImports(buildPathImportsIndex(root, names), query, 10).ranked;
    expect(fallback).toEqual(control);
  });
});

describe('fallbackArm', () => {
  it('scores a perfect first place at one, and reports where the answer sits', () => {
    const root = checkout({ 'src/RetryPolicy.java': 'import java.util.List;\n' });
    const arm = fallbackArm({
      checkout: root,
      files: ['src/RetryPolicy.java'],
      query: 'retry policy',
      expected: ['src/RetryPolicy.java'],
      depth: 200,
    });
    expect(arm.map).toBe(1);
    expect(arm.rank).toBe(1);
  });

  it('scores zero and says the answer was absent when no term matches', () => {
    const root = checkout({ 'src/One.java': 'import java.util.List;\n' });
    const arm = fallbackArm({
      checkout: root,
      files: ['src/One.java'],
      query: 'unrelated wording entirely',
      expected: ['src/One.java'],
      depth: 200,
    });
    expect(arm.map).toBe(0);
    expect(arm.rank).toBeNull();
    expect(arm.documents).toBe(1);
  });

  it('publishes the first ten of the ranking and no more', () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 20; index += 1) files[`src/Alpha_${String(index)}.java`] = '';
    const root = checkout(files);
    const arm = fallbackArm({
      checkout: root,
      files: Object.keys(files),
      query: 'alpha',
      expected: [],
      depth: 200,
    });
    expect(arm.ranked).toHaveLength(10);
    expect(arm.documents).toBe(20);
  });

  it('counts the import statements it found, so a missed language is visible', () => {
    const root = checkout({ 'a.py': 'import os\nfrom a.b import c\n', 'b.py': 'x = 1\n' });
    const arm = fallbackArm({
      checkout: root,
      files: ['a.py', 'b.py'],
      query: 'os',
      expected: ['a.py'],
      depth: 200,
    });
    expect(arm.importLines).toBe(2);
  });
});
