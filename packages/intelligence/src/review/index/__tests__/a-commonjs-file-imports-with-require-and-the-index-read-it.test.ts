/**
 * **A `.js` file imports with `require`, and the index could not see it.**
 *
 * §97.3 stated the gap: *JavaScript's `require()` is not read, so every CJS edge is missing.* The consequence was not
 * cosmetic - `impactOf` answered *nobody calls this* for a helper that three files require, which is the exact question a
 * review asks before it says a change is safe.
 *
 * **The shapes below are the ones a line-based reader gets wrong**, and each is a real one rather than an interesting
 * one: a destructuring pattern that names what crosses, a whole-module binding that names nothing, a call inside a
 * string (the defect §95.1 found in `benchmark-fixtures.ts`, in its third language), a commented-out call, a template
 * literal whose target is only known at run time, and `require.resolve` - which is not an import at all.
 */
import { describe, expect, it } from 'vitest';

import { readCommonJsRequires } from '../imports-langs.js';
import { buildRepoIndex, impactOf } from '../repo-index.js';
import { buildSymbolIndex } from '../symbols.js';

/**
 * Read one file the way `buildRepoIndex` does, **with the lexer's mask rather than the source as its own mask**.
 *
 * A test that passed `lines` for `codes` would be a test of a reader with no ability to tell code from text, and that is
 * the one ability this reader has that the ESM reader lacked until §95.1 found it in `benchmark-fixtures.ts`.
 */
const read = (text: string) => {
  const lines = text.split('\n');
  return readCommonJsRequires(lines, buildSymbolIndex('x.js', text).codes);
};

describe('a CommonJS require', () => {
  it('names the bindings a destructuring pattern takes, with the local name of each', () => {
    const [statement] = read("const { alpha, beta: renamed } = require('./named');");
    expect(statement?.specifier).toBe('./named');
    expect(statement?.names).toEqual([
      { imported: 'alpha', local: 'alpha' },
      { imported: 'beta', local: 'renamed' },
    ]);
    expect(statement?.namespace).toBe(false);
    expect(statement?.startLine).toBe(1);
  });

  it('treats a whole-module binding as a namespace, because it says nothing about which name crosses', () => {
    // **The same refusal the ESM reader makes for `import * as m`**, and for the same reason: `const m = require('./m')`
    // followed by `m.a` is a property access, and a name inferred from one is scope analysis this layer does not do.
    const [statement] = read("const whole = require('./whole');");
    expect(statement?.specifier).toBe('./whole');
    expect(statement?.names).toEqual([]);
    expect(statement?.namespace).toBe(true);
  });

  it('refuses a call that only looks like one: in a string, in a comment, in a template, or on require.resolve', () => {
    const text = [
      'const text = "require(\'./inside-a-string\')";',
      "// require('./commented-out')",
      "const tpl = `require('./inside-a-template')`;",
      "const resolved = require.resolve('./not-an-edge');",
      'require(`./template-specifier`);',
    ].join('\n');
    expect(read(text)).toEqual([]);
  });

  it('decides code from text on the mask rather than on the line, which is the only reading that holds', () => {
    // **The mask is what keeps a quoted `require` out**, and this case is the one that made §95.1 necessary: the call is
    // spelled exactly like a call and sits inside a literal.
    expect(read(`const s = "require('./x')"; const y = require('./y');`)).toEqual([
      {
        specifier: './y',
        names: [],
        namespace: true,
        startLine: 1,
        endLine: 1,
        kind: 'file',
      },
    ]);
  });

  it('reads two calls on one line as two statements, with the names each one binds', () => {
    const statements = read("const { a } = require('./a'); const b = require('./b');");
    expect(statements.map((statement) => statement.specifier)).toEqual(['./a', './b']);
    expect(statements[0]?.names).toEqual([{ imported: 'a', local: 'a' }]);
    expect(statements[1]?.namespace).toBe(true);
  });

  it('makes no statement from a line with no call, and none from a blank line', () => {
    expect(read(['', '   ', 'module.exports = {};'].join('\n'))).toEqual([]);
  });
});

describe('a CommonJS edge', () => {
  it('becomes a reference when the destructured name is used, and an impact set that says who requires it', () => {
    const index = buildRepoIndex([
      {
        path: 'lib/util.js',
        text: 'function helper() {\n  return 1;\n}\nmodule.exports = { helper };\n',
      },
      { path: 'lib/a.js', text: "const { helper } = require('./util');\n\nhelper();\n" },
      { path: 'lib/b.js', text: "const util = require('./util');\n\nutil.helper();\n" },
    ]);
    expect(index.references).toEqual([
      { fromPath: 'lib/a.js', fromLine: 3, toPath: 'lib/util.js', toName: 'helper' },
    ]);
    // **`b.js` requires the module and calls the name through it**, so it is a namespace statement and the impact set is
    // honest about not being able to name the crossing - it lists the file that was reached, not the call.
    expect(impactOf(index, 'lib/util.js', ['helper']).paths).toEqual(['lib/a.js']);
    expect(index.stats.namespaceImports).toBe(1);
  });

  it('resolves an extensionless specifier to a `.cjs` neighbour, which is how CommonJS writes every one', () => {
    const index = buildRepoIndex([
      {
        path: 'lib/util.cjs',
        text: 'function helper() {\n  return 1;\n}\nexports.helper = helper;\n',
      },
      { path: 'lib/a.js', text: "const { helper } = require('./util');\nhelper();\n" },
    ]);
    expect(index.stats.resolvedImports).toBe(1);
    expect(index.references).toEqual([
      { fromPath: 'lib/a.js', fromLine: 2, toPath: 'lib/util.cjs', toName: 'helper' },
    ]);
  });

  it('counts a require that answers no path as missing, because a path in this repository that is not here is a bug', () => {
    const index = buildRepoIndex([
      { path: 'lib/a.js', text: "const { x } = require('./nowhere');\nx();\n" },
    ]);
    expect(index.stats.missingImports).toBe(1);
    expect(index.unresolved[0]).toMatchObject({ fromPath: 'lib/a.js', specifier: './nowhere' });
  });

  it('leaves a TypeScript file to the ESM reader, because its judge does not resolve require', () => {
    // **§95.1 measures `.ts` relative specifiers against `ts.resolveModuleName`**, which resolves `import` declarations
    // and not `require` calls: adding specifiers the judge cannot see would lower an agreement that exists to be kept.
    const index = buildRepoIndex([
      { path: 'lib/util.ts', text: 'export const helper = 1;\n' },
      { path: 'lib/a.ts', text: "const { helper } = require('./util');\nhelper;\n" },
    ]);
    expect(index.imports).toEqual([]);
    expect(index.stats.externalImports).toBe(0);
  });

  it('leaves a bare specifier external, because it names a package rather than a path in this repository', () => {
    // **Most `require` calls in a repository are not edges in it**, and a reader that resolved `node:fs` to a file would
    // be inventing one - the same refusal the ESM path makes for `import { z } from 'zod'`.
    const index = buildRepoIndex([{ path: 'lib/a.js', text: "const fs = require('node:fs');\n" }]);
    expect(index.stats.externalImports).toBe(1);
    expect(index.stats.missingImports).toBe(0);
    expect(index.references).toEqual([]);
  });

  it('resolves from a file at the repository root, and from a specifier written as a root-relative path', () => {
    // **Both shapes are ordinary in a CJS repository and neither reaches a branch the rest of this file does**: a file
    // with no directory part has an empty `dirOf`, and `/util.js` names a path rather than a package.
    const index = buildRepoIndex([
      {
        path: 'util.js',
        text: 'function helper() {\n  return 1;\n}\nmodule.exports = { helper };\n',
      },
      { path: 'a.js', text: "const { helper } = require('./util');\nhelper();\n" },
      { path: 'b.js', text: "const { helper } = require('/util.js');\nhelper();\n" },
    ]);
    expect(index.references).toEqual([
      { fromPath: 'a.js', fromLine: 2, toPath: 'util.js', toName: 'helper' },
      { fromPath: 'b.js', fromLine: 2, toPath: 'util.js', toName: 'helper' },
    ]);
  });
});
