// @code-analyzer/intelligence — a declaration in one file, and the files that read it
//
// **Every fact this index has produced so far is about one file.** `symbolAt` answers "which declaration does line 42
// stand in", and §93 measured that answer as a selector and found it to be the exact null - 73.03 % of the comments that
// found a defect stood in a declaration and 73.13 % of the ones that found nothing did too. **A fact that is equally
// true of every row cannot separate rows**, and the reason is structural: "this line is inside a declaration" is a
// property of a file's shape, and a comment about a defect and a comment about nothing share the shape.
//
// **The fact that is not about one file is the one the field's leaders are built on.** `sourcegraph/scip` exists to give
// every symbol a name that is stable across files (`path` + `descriptor`), which is what makes "who calls this" a query
// rather than a search. `greptile`'s whole pitch is a repository graph, and `coderabbit`'s per-pull-request code graph is
// the same idea at a smaller radius. **This module is the smallest version of it that stays checkable**: what a file
// imports, which file answers that import, and which names actually cross the boundary - all three established by
// reading two files, and none of them by guessing what a symbol is for.
//
// **What it refuses to do.** It does not resolve a bare specifier (`@scope/pkg` is a package, and where that package's
// files live is not in this repository), it does not follow a re-export chain, and it does not claim a call graph - it
// claims *references*, which are the edges that a diff can be checked against. **A wrong edge is worse than a missing
// one here**, because the consumer is a review deciding what a change reaches.

import { describe, expect, it } from 'vitest';

import { buildRepoIndex, impactOf } from '../repo-index.js';

/** A repository written inline, so a test states the files its claim is about. */
const repo = (...files: readonly [string, string][]) =>
  buildRepoIndex(files.map(([path, text]) => ({ path, text })));

describe('the file an import names, when the repository holds it', () => {
  it('answers a `.js` specifier with the `.ts` file beside it', () => {
    // Every relative import in this repository is written `./lexemes.js` and the file on disk is `lexemes.ts` - which
    // is what TypeScript requires of an ES module. **A resolver that took the specifier literally would resolve nothing
    // here and would report a healthy repository as 100 % broken.**
    const index = repo(
      ['src/a.ts', "import { helper } from './b.js';\nexport const a = helper();"],
      ['src/b.ts', 'export function helper(): number {\n  return 1;\n}'],
    );

    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.missingImports).toBe(0);
    expect(impactOf(index, 'src/b.ts', ['helper']).paths).toEqual(['src/a.ts']);
  });

  it('answers a directory with the `index` file inside it', () => {
    const index = repo(
      ['src/a.ts', "import { helper } from './lib';\nhelper();"],
      ['src/lib/index.ts', 'export function helper(): void {}'],
    );

    expect(index.stats.resolvedImports).toBe(1);
    expect(impactOf(index, 'src/lib/index.ts', ['helper']).paths).toEqual(['src/a.ts']);
  });

  it('walks `..` out of the importing file rather than out of the repository', () => {
    const index = repo(
      ['src/deep/a.ts', "import { helper } from '../../b.js';\nhelper();"],
      ['b.ts', 'export function helper(): void {}'],
    );

    expect(index.stats.resolvedImports).toBe(1);
    expect(impactOf(index, 'b.ts', ['helper']).paths).toEqual(['src/deep/a.ts']);
  });

  it('reads an import that the formatter wrapped over four lines', () => {
    // This repository's own style, which is why the reader joins before it looks for `from`.
    const index = repo(
      [
        'src/a.ts',
        ['import {', '  alpha,', '  beta,', "} from './b.js';", 'alpha(beta);'].join('\n'),
      ],
      ['src/b.ts', 'export const alpha = 1;\nexport const beta = 2;'],
    );

    expect(index.stats.resolvedImports).toBe(1);
    expect(impactOf(index, 'src/b.ts', ['alpha']).paths).toEqual(['src/a.ts']);
  });
});

describe('the imports this index refuses to answer, and why the refusal is a value', () => {
  it('calls a bare specifier external rather than missing', () => {
    // **The distinction is the difference between a repository that is broken and one that has dependencies.** A run
    // that counted both as `missing` would report a resolution rate that says more about `node_modules` than about the
    // resolver, and a reader has no way to tell the two populations apart from a single number.
    const index = repo(['src/a.ts', "import { z } from 'zod';\nz();"]);

    expect(index.stats.externalImports).toBe(1);
    expect(index.stats.missingImports).toBe(0);
    expect(index.unresolved.map((row) => row.why)).toEqual(['external']);
  });

  it('calls a relative specifier missing when no file answers it', () => {
    const index = repo(['src/a.ts', "import { gone } from './gone.js';\ngone();"]);

    expect(index.stats.missingImports).toBe(1);
    expect(index.unresolved[0]).toMatchObject({
      fromPath: 'src/a.ts',
      specifier: './gone.js',
      why: 'missing',
    });
  });

  it('counts a namespace import and makes no edge out of it', () => {
    // `import * as ns from './b.js'` says nothing about *which* name crosses; the crossing is `ns.helper` and finding
    // it is member resolution, which this module does not do. **Counting it as external would be wrong and counting it
    // as resolved would be an edge nobody established**, so it has its own counter and the count is visible.
    const index = repo(
      ['src/a.ts', "import * as ns from './b.js';\nns.helper();"],
      ['src/b.ts', 'export function helper(): void {}'],
    );

    expect(index.stats.namespaceImports).toBe(1);
    expect(index.stats.edges).toBe(0);
  });
});

describe('an edge is a name that is imported and used, and nothing weaker', () => {
  it('makes no edge from an import the file never uses', () => {
    // **An unused import is not a reference.** `tsc` deletes it, the bundler never sees it, and a review told that the
    // change reaches this file would be told something the compiler would not agree with.
    const index = repo(
      ['src/a.ts', "import { helper } from './b.js';\nexport const a = 1;"],
      ['src/b.ts', 'export function helper(): void {}'],
    );

    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.edges).toBe(0);
    expect(impactOf(index, 'src/b.ts', ['helper']).paths).toEqual([]);
  });

  it('makes no edge to a name the target file does not declare', () => {
    // The import resolves and the use is real, but the name is not in the target's own symbol list - a re-export, or a
    // name this index did not read. **The edge is withheld rather than attributed to the file**: a caller count that
    // included it would be a count of imports rather than of readers.
    const index = repo(
      ['src/a.ts', "import { renamed } from './b.js';\nrenamed();"],
      ['src/b.ts', 'export function helper(): void {}'],
    );

    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.edges).toBe(0);
  });

  it('carries the line the name is used on, and the name it is imported as', () => {
    const index = repo(
      ['src/a.ts', "import { helper as h } from './b.js';\nconst x = 1;\nh();"],
      ['src/b.ts', 'export function helper(): void {}'],
    );

    expect(impactOf(index, 'src/b.ts', ['helper']).callers).toEqual([
      { fromPath: 'src/a.ts', fromLine: 3, toPath: 'src/b.ts', toName: 'helper' },
    ]);
  });
});

describe('what a change reaches, which is the question a review cannot ask one file at a time', () => {
  it('reports each reading file once however many times it reads', () => {
    const index = repo(
      ['src/a.ts', "import { helper } from './b.js';\nhelper();\nhelper();\nhelper();"],
      ['src/b.ts', 'export function helper(): void {}'],
      ['src/c.ts', "import { helper } from './b.js';\nhelper();"],
    );

    const impact = impactOf(index, 'src/b.ts', ['helper']);
    expect(impact.paths).toEqual(['src/a.ts', 'src/c.ts']);
    expect(impact.unreachable).toEqual([]);
  });

  it('names the changed symbols nothing outside the file reads', () => {
    // **The half a caller count on its own would hide.** A review told "12 files" cannot tell whether the twelve are
    // the twelve it changed; a review told which names nobody reads outside the file is being told where the change is
    // *contained*, which is a different and cheap way to be wrong about blast radius.
    const index = repo(
      ['src/a.ts', "import { helper } from './b.js';\nhelper();"],
      ['src/b.ts', 'export function helper(): void {}\nexport function untested(): void {}'],
    );

    expect(impactOf(index, 'src/b.ts', ['helper', 'untested']).unreachable).toEqual(['untested']);
  });

  it('says a file that nothing imports reaches nothing, rather than failing', () => {
    const index = repo(['src/only.ts', 'export function helper(): void {}']);

    expect(impactOf(index, 'src/only.ts', ['helper'])).toEqual({
      callers: [],
      paths: [],
      unreachable: ['helper'],
    });
  });

  it('says nothing about a file it never indexed', () => {
    const index = repo(['src/a.ts', 'export const a = 1;']);

    expect(impactOf(index, 'src/absent.ts', ['helper']).callers).toEqual([]);
  });
});

describe('a crossing written from the other side, and the lines that are not one', () => {
  it('reads a re-export as the crossing it is', () => {
    // `export { helper } from './b.js'` is `import` and `export` in one statement: the file offers a name it does not
    // declare, and **the caller of that name reaches the file that declares it**. Reading only `import` would make every
    // barrel file look like a leaf.
    const index = repo(
      ['src/barrel.ts', "export { helper } from './b.js';"],
      ['src/b.ts', 'export function helper(): void {}'],
    );

    expect(index.stats.resolvedImports).toBe(1);
    expect(index.imports[0]).toMatchObject({ target: 'src/b.ts', why: 'resolved' });
  });

  it('reads a re-export whose specifier the formatter spaced away from `from`', () => {
    const index = repo(
      ['src/barrel.ts', "export  {  helper  }  from  '../b.js';"],
      ['b.ts', 'export function helper(): void {}'],
    );

    expect(index.imports[0]).toMatchObject({ target: 'b.ts', why: 'resolved' });
  });

  it('does not read `export const` as a crossing', () => {
    // Only a braced `export … from` re-exports. **A rule that matched the keyword would turn every exported constant
    // into an import**, and this repository writes one of those every twelve lines.
    const index = repo(['src/a.ts', 'export const a = 1;\nexport function b(): void {}']);

    expect(index.stats.imports).toBe(0);
  });

  it('declines an import that names no module at all', () => {
    // `import` at the end of a line, and an import whose quote it never closes: **both are statements this reader
    // cannot answer**, and the count of imports is the denominator of every rate above, so neither is counted.
    const index = repo(['src/a.ts', "import { a } from\nimport { b } from 'unclosed;\na();"]);

    expect(index.stats.imports).toBe(0);
  });
});

describe('the edges a count has to be trusted about', () => {
  it('does not treat a mention in a comment as a use', () => {
    // **The one way an edge can be wrong rather than missing.** `// helper still returns the stale value` writes the
    // name, and a reader that counted words would tell a review the change reaches a file that only talks about it.
    const index = repo(
      [
        'src/a.ts',
        "import { helper } from './b.js';\n// helper still returns the stale value\nexport const a = 1;",
      ],
      ['src/b.ts', 'export function helper(): void {}'],
    );

    expect(index.stats.edges).toBe(0);
    expect(impactOf(index, 'src/b.ts', ['helper']).paths).toEqual([]);
  });

  it('orders references by file and then by line, so two runs agree', () => {
    const index = repo(
      ['src/b-reader.ts', "import { helper } from './b.js';\nconst x = 1;\nhelper();"],
      ['src/a-reader.ts', "import { helper } from './b.js';\nhelper();"],
      ['src/b.ts', 'export function helper(): void {}'],
    );

    expect(impactOf(index, 'src/b.ts', ['helper']).callers.map((row) => row.fromPath)).toEqual([
      'src/a-reader.ts',
      'src/b-reader.ts',
    ]);
    expect(impactOf(index, 'src/b.ts', ['helper']).callers.map((row) => row.fromLine)).toEqual([
      2, 3,
    ]);
  });

  it('reports one file once when it reads two of the changed names', () => {
    const index = repo(
      ['src/a.ts', "import { alpha, beta } from './b.js';\nalpha();\nbeta();"],
      ['src/b.ts', 'export function alpha(): void {}\nexport function beta(): void {}'],
    );

    const impact = impactOf(index, 'src/b.ts', ['alpha', 'beta']);
    expect(impact.callers).toHaveLength(2);
    expect(impact.paths).toEqual(['src/a.ts']);
    expect(impact.unreachable).toEqual([]);
  });
});

describe('the imports that name a file and cross no name', () => {
  it('makes no edge from a default import, which names an export this index does not call a name', () => {
    // `import helper from './b.js'` crosses the file and not a *name*: the default export of `b.ts` may be spelled
    // anything, and **inventing `default` would put a name in the impact set that no source line writes**.
    const index = repo(
      ['src/a.ts', "import helper from './b.js';\nhelper();"],
      ['src/b.ts', 'export default function helper(): void {}'],
    );

    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.edges).toBe(0);
  });

  it('does not read a longer word as a use of the name inside it', () => {
    // `helperish` contains `helper`, and a reader that stopped at `includes` would make a file a caller of a function it
    // never calls. `wordsOf` is what stops it, and this is the case that proves the word boundary is doing work.
    const index = repo(
      ['src/a.ts', "import { helper } from './b.js';\nconst helperish = 1;"],
      ['src/b.ts', 'export function helper(): void {}'],
    );

    expect(index.stats.edges).toBe(0);
  });

  it('reads a name written with the digits and sigils an identifier may carry', () => {
    const index = repo(
      ['src/a.ts', "import { $el, x1 } from './b.js';\n$el(x1);"],
      ['src/b.ts', 'export const $el = 1;\nexport const x1 = 2;'],
    );

    expect(index.stats.edges).toBe(2);
    expect(impactOf(index, 'src/b.ts', ['$el', 'x1']).paths).toEqual(['src/a.ts']);
  });
});

describe('an import that is text rather than code', () => {
  it('does not read an import written inside a template literal', () => {
    // **Found by the resolver's own report rather than by reading this module.** `benchmark-fixtures.ts` in this
    // repository holds benchmark programs as template literals, and line 24 of it is `import { Database } from
    // './database';` - inside a string. The reader counted it as an import, failed to resolve it, and reported the one
    // `missing` in a repository whose relative imports resolve 1 257 of 1 257. **A fixture is not an import**, and the
    // lexer that knows which is which already exists.
    const index = repo([
      'src/fixtures.ts',
      ['export const sample = `', "import { gone } from './nowhere.js';", '`;'].join('\n'),
    ]);

    expect(index.stats.imports).toBe(0);
    expect(index.unresolved).toEqual([]);
  });

  it('does not read a use written inside a block comment', () => {
    const index = repo(
      [
        'src/a.ts',
        "import { helper } from './b.js';\n/* helper();\n   helper(); */\nexport const a = 1;",
      ],
      ['src/b.ts', 'export function helper(): void {}'],
    );

    expect(index.stats.edges).toBe(0);
  });
});
