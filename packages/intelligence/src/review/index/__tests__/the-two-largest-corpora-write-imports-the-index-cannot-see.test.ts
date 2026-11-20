/**
 * **Two of the three largest corpora the review benchmark scores are written in two languages whose imports this index
 * read as zero.**
 *
 * The measurement, taken from `dataset/v2/positive_samples.json` rather than from an opinion: of the 944 files
 * `Alibaba-Aone/aacr-bench` files a finding against, **164 are `.cpp`, 34 `.h`, 87 `.c` and 90 `.go`** - 375 files, or
 * **39.7 % of the corpus**, in the two languages an import edge cannot be read for at all. A probe over three real
 * checkouts said the same thing in three lines: `gin-gonic/gin` 99 files and 0 imports, `DaveGamble/cJSON` 99 files and
 * 0 imports, `stedolan/jq` 81 files and 0 imports - **every declaration indexed, no edge indexed.**
 *
 * **Why one file for two languages.** They fail for the same reason and the reason is worth stating once: `readStatement`
 * reads `import … from './x'`, Go writes `import "a/b"` with no `from` and no quotes to find it by, and C does not have
 * an import at all - it has a preprocessor directive that pastes a file into another. **The three shapes are three
 * different resolutions**, and each one is a rule a repository can check without a compiler:
 *
 * - **Go's import names a package**, which is a *directory* of files, and the module prefix in `go.mod` is what turns
 *   `github.com/gin-gonic/gin/internal/bytesconv` into `internal/bytesconv/`. A name crosses as `pkg.Name`, and Go's own
 *   rule makes that decidable: **a file's package identifiers are unique bindings**, so `bytesconv.X` in a file that
 *   imported `bytesconv` refers to that package and to nothing else.
 * - **C's `#include "x.h"` pastes a file**, so the edge is the file, and the names that cross are the ones the importer
 *   actually uses. `<stdio.h>` is a system header and is answered `external` - a path invented for it would be an edge
 *   invented for it.
 * - **ArkTS writes TypeScript's import and HarmonyOS writes it in `.ets`**, so the extension list a specifier is answered
 *   from is the one thing that file needed and did not have.
 */

import { describe, expect, it } from 'vitest';

import {
  readCIncludes,
  readGoImports,
  readPackageName,
  resolveCInclude,
  resolveGoPackage,
} from '../imports-langs.js';
import { buildRepoIndex, impactOf } from '../repo-index.js';

/** Read one file the way `buildRepoIndex` does when nothing is blanked by the lexer. */
const go = (text: string) => {
  const lines = text.split('\n');
  return readGoImports(lines, lines);
};
const c = (text: string) => {
  const lines = text.split('\n');
  return readCIncludes(lines, lines);
};

describe('a Go import', () => {
  it('reads the single-statement form, which has no `from` and no name list', () => {
    const [statement] = go(
      ['package main', '', 'import "github.com/gin-gonic/gin"', ''].join('\n'),
    );
    expect(statement?.specifier).toBe('github.com/gin-gonic/gin');
    // **A Go import binds a package identifier and says nothing about which name crosses** until the body writes
    // `pkg.Name`, so the statement carries no names and the crossing is read at the use site.
    expect(statement?.names).toEqual([]);
    expect(statement?.startLine).toBe(3);
  });

  it('reads the block form, with an alias, a blank identifier and a dot import', () => {
    const statements = go(
      [
        'package main',
        '',
        'import (',
        '\t"os"',
        '\tbytesconv "github.com/gin-gonic/gin/internal/bytesconv"',
        '\t_ "github.com/mattn/go-sqlite3"',
        '\t. "math"',
        ')',
      ].join('\n'),
    );
    expect(statements.map((statement) => statement.specifier)).toEqual([
      'os',
      'github.com/gin-gonic/gin/internal/bytesconv',
      'github.com/mattn/go-sqlite3',
      'math',
    ]);
    expect(statements.map((statement) => statement.alias)).toEqual([
      undefined,
      'bytesconv',
      '_',
      '.',
    ]);
    // **The block's lines are strings and nothing else**, so the lexer masks them to blanks - a reader that required a
    // word of code on the line would read an empty block, which is the shape `gofmt` writes every import as.
    expect(statements[0]?.startLine).toBe(4);
    expect(statements[3]?.startLine).toBe(7);
  });

  it('does not read an import inside a comment or a raw string', () => {
    const statements = go(
      [
        'package main',
        '',
        '// import "commented/out"',
        '/* import "blocked/out" */',
        'var query = `import "in/a/string"`',
      ].join('\n'),
    );
    expect(statements).toEqual([]);
  });
});

describe('a Go specifier, which is a package and not a file', () => {
  const files = new Set([
    'internal/bytesconv/bytesconv.go',
    'internal/bytesconv/string.go',
    'internal/bytesconv/nested/deep.go',
    'main.go',
  ]);

  it('is the directory the module prefix leaves, and every file directly in it', () => {
    expect(
      resolveGoPackage(
        'github.com/gin-gonic/gin/internal/bytesconv',
        'github.com/gin-gonic/gin',
        files,
      ),
    ).toEqual(['internal/bytesconv/bytesconv.go', 'internal/bytesconv/string.go']);
  });

  it('is null outside the module, because a dependency lives in another repository', () => {
    expect(
      resolveGoPackage('github.com/mattn/go-sqlite3', 'github.com/gin-gonic/gin', files),
    ).toBeNull();
    expect(resolveGoPackage('os', 'github.com/gin-gonic/gin', files)).toBeNull();
  });

  it('is null when the module is unknown, because a path guessed from a suffix is an edge guessed', () => {
    // **The refusal that keeps a wrong edge out.** Without `go.mod` there is no way to tell a module path from a
    // dependency path, and a suffix match would resolve `github.com/x/gin/main` inside a repository that merely has a
    // `main/` directory.
    expect(resolveGoPackage('github.com/gin-gonic/gin/internal/bytesconv', null, files)).toBeNull();
  });
});

describe('a C include', () => {
  it('reads a quoted directive as a file and an angled one as a system header', () => {
    const statements = c(
      ['#include "cJSON.h"', '#include <stdio.h>', '#  include "internal/x.h"', ''].join('\n'),
    );
    expect(statements.map((statement) => statement.specifier)).toEqual([
      'cJSON.h',
      'stdio.h',
      'internal/x.h',
    ]);
    expect(statements.map((statement) => statement.kind)).toEqual(['file', 'module', 'file']);
  });

  it('does not read a directive inside a comment', () => {
    expect(c(['/* #include "a.h" */', '// #include "b.h"'].join('\n'))).toEqual([]);
  });
});

describe('a C specifier, which is a path relative to the includer', () => {
  const files = new Set(['src/cJSON.h', 'src/cJSON.c', 'tests/unity/unity.h', 'unity.h']);

  it('is the includer directory first, which is what a quoted directive means', () => {
    expect(resolveCInclude('cJSON.h', 'src/cJSON.c', files)).toEqual({
      target: 'src/cJSON.h',
      why: 'resolved',
    });
  });

  it('is a unique suffix when the includer directory does not hold it', () => {
    // `-I` flags are not in the statement, so the second chance is a suffix match - and it is taken **only when exactly
    // one path ends that way**, which is the difference between a resolution and a guess.
    expect(resolveCInclude('unity/unity.h', 'tests/all.c', files)).toEqual({
      target: 'tests/unity/unity.h',
      why: 'resolved',
    });
  });

  it('refuses a suffix that two files answer, rather than picking one', () => {
    // **`unity.h` is at the root and under `tests/unity/`**, which is a real shape in a vendored repository. Choosing
    // the shorter path would be a wrong edge in a review that then says the change reaches a file it does not.
    const ambiguous = resolveCInclude('unity.h', 'src/x.c', files);
    expect(ambiguous.target).toBeNull();
    expect(ambiguous.why).toBe('ambiguous');
  });

  it('is missing when no file holds it', () => {
    expect(resolveCInclude('gone.h', 'src/cJSON.c', files)).toEqual({
      target: null,
      why: 'missing',
    });
  });
});

describe('a repository the index can now read end to end', () => {
  const GO_FILES = [
    {
      path: 'go.mod',
      text: 'module github.com/gin-gonic/gin\n\ngo 1.21\n',
    },
    {
      path: 'internal/bytesconv/bytesconv.go',
      text: [
        'package bytesconv',
        '',
        '// StringToBytes converts a string to a byte slice without copying.',
        'func StringToBytes(s string) []byte {',
        '\treturn []byte(s)',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'render/text.go',
      text: [
        'package render',
        '',
        'import (',
        '\t"os"',
        '\t"github.com/gin-gonic/gin/internal/bytesconv"',
        ')',
        '',
        'func Write(s string, f *os.File) error {',
        '\t_, err := f.Write(bytesconv.StringToBytes(s))',
        '\treturn err',
        '}',
        '',
      ].join('\n'),
    },
  ];

  it('makes an edge from `pkg.Name` to the file that declares the name', () => {
    const index = buildRepoIndex(GO_FILES, { goModule: 'github.com/gin-gonic/gin' });
    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.externalImports).toBe(1);
    const impact = impactOf(index, 'internal/bytesconv/bytesconv.go', ['StringToBytes']);
    expect(impact.paths).toEqual(['render/text.go']);
    expect(impact.callers[0]?.fromLine).toBe(9);
  });

  it('makes no edge for a package whose names the file never uses', () => {
    const unused = [
      GO_FILES[0]!,
      GO_FILES[1]!,
      {
        path: 'render/dead.go',
        text: [
          'package render',
          '',
          'import "github.com/gin-gonic/gin/internal/bytesconv"',
          '',
        ].join('\n'),
      },
    ];
    const index = buildRepoIndex(unused, { goModule: 'github.com/gin-gonic/gin' });
    // The statement resolved; nothing crossed, so the edge count is the fact and the resolution is the other one.
    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.edges).toBe(0);
  });

  it('binds no name for `_` and `.`, which are the two imports a use site cannot spell', () => {
    /**
     * **`_ "x"` imports a package for its side effect and `. "x"` pastes its exported names into the file**, so neither
     * binds an identifier a `pkg.Name` could be written with. Both resolve - the package is in this repository - and
     * neither makes an edge, because **a name nobody spelled is a name nobody can be told crosses**.
     */
    const files = [
      GO_FILES[0]!,
      GO_FILES[1]!,
      {
        path: 'render/side.go',
        text: [
          'package render',
          '',
          'import (',
          '\t_ "github.com/gin-gonic/gin/internal/bytesconv"',
          '\t. "github.com/gin-gonic/gin/internal/bytesconv"',
          ')',
          '',
          'func Use() []byte { return StringToBytes("x") }',
          '',
        ].join('\n'),
      },
    ];
    const index = buildRepoIndex(files, { goModule: 'github.com/gin-gonic/gin' });
    expect(index.stats.resolvedImports).toBe(2);
    expect(index.stats.edges).toBe(0);
  });

  it('makes no edge for a name Go does not export, because no other file can spell it', () => {
    // **Go's rule rather than this index's**: a lowercase name belongs to its package, and a `.lowercase` selector in
    // another package does not compile. An edge for one would be a fact the compiler refuses.
    const files = [
      GO_FILES[0]!,
      {
        path: 'internal/bytesconv/bytesconv.go',
        text: ['package bytesconv', '', 'func hidden() int { return 1 }', ''].join('\n'),
      },
      {
        path: 'render/text.go',
        text: [
          'package render',
          '',
          'import "github.com/gin-gonic/gin/internal/bytesconv"',
          '',
          'func Use() int { return bytesconv.hidden() }',
          '',
        ].join('\n'),
      },
    ];
    const index = buildRepoIndex(files, { goModule: 'github.com/gin-gonic/gin' });
    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.edges).toBe(0);
  });

  it('answers the module root itself, which is a package like any other', () => {
    // `import "github.com/gin-gonic/gin"` is legal and names the repository's own root package.
    expect(
      resolveGoPackage(
        'github.com/gin-gonic/gin',
        'github.com/gin-gonic/gin',
        new Set(['main.go']),
      ),
    ).toEqual(['main.go']);
  });

  const C_FILES = [
    {
      path: 'src/cJSON.h',
      text: ['#ifndef cJSON_H', '#define cJSON_H', 'char *cJSON_Print(void *item);', '#endif'].join(
        '\n',
      ),
    },
    {
      path: 'src/cJSON.c',
      text: [
        '#include "cJSON.h"',
        '#include <stdlib.h>',
        '',
        'char *cJSON_Print(void *item) {',
        '\treturn (char *)item;',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/print.c',
      text: ['#include "cJSON.h"', '', 'void run(void *item) {', '\tcJSON_Print(item);', '}'].join(
        '\n',
      ),
    },
  ];

  it('makes an edge from a header to the file that includes it and uses what it declares', () => {
    const index = buildRepoIndex(C_FILES);
    expect(index.stats.resolvedImports).toBe(2);
    expect(index.stats.externalImports).toBe(1);
    const impact = impactOf(index, 'src/cJSON.h', ['cJSON_Print']);
    /**
     * **`src/cJSON.c` includes the header and defines the function**, and that is not a read of it: C's own rule says
     * the file's definition shadows the header's declaration, and a definition is not a use. The edge the header has is
     * `src/print.c`, the file that calls the function without declaring it.
     */
    expect([...impact.paths].sort()).toEqual(['src/print.c']);
  });

  it('does not make an edge to a system header, because a header that is not here is not a path', () => {
    const index = buildRepoIndex(C_FILES);
    const stdlib = index.unresolved.find((row) => row.specifier === 'stdlib.h');
    expect(stdlib?.why).toBe('external');
  });

  it('does not credit a header with a name the including file defines itself', () => {
    /**
     * **The shape `tests/unity` writes thirty times**: `unity.h` declares `void setUp(void);`, and every test file
     * includes the header and then *defines* `setUp`. A raw word match credited thirty edges to a header nobody read
     * that name from - the defect the first measurement of `DaveGamble/cJSON` found, where 81 of 120 edges were
     * `setUp`, `tearDown` and `reset`.
     */
    const files = [
      { path: 'unity.h', text: 'void setUp(void);\nvoid tearDown(void);\n' },
      {
        path: 'test_a.c',
        text: [
          '#include "unity.h"',
          '',
          'void setUp(void) {}',
          'void tearDown(void) {}',
          'void test_a(void) { setUp(); tearDown(); }',
        ].join('\n'),
      },
    ];
    const index = buildRepoIndex(files);
    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.edges).toBe(0);
  });

  const ETS_FILES = [
    {
      path: 'entry/src/main/ets/model/Counter.ets',
      text: ['export class Counter {', '  value: number = 0;', '}', ''].join('\n'),
    },
    {
      path: 'entry/src/main/ets/pages/Index.ets',
      text: [
        "import { Counter } from '../model/Counter'",
        '',
        '@Entry',
        '@Component',
        'struct Index {',
        '  build() {',
        '    Counter',
        '  }',
        '}',
        '',
      ].join('\n'),
    },
  ];

  it('answers a TypeScript import with a `.ets` file, which is the only extension ArkTS writes', () => {
    const index = buildRepoIndex(ETS_FILES);
    // **The import is TypeScript's and the extension is not**, and a candidate list without `.ets` answered every
    // ArkTS import in a HarmonyOS application as `missing` - 100 % of the edges in that corpus.
    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.missingImports).toBe(0);
  });

  it('binds the module itself when its path has no dot and no slash', () => {
    // **`lastSegmentOf` has one arm that only a single-segment module reaches**, and a workspace module named `shapes`
    // imports its own root as `shapes`. The name it binds is the path itself.
    const files = [
      { path: 'go.mod', text: 'module shapes\n\ngo 1.21\n' },
      { path: 'root.go', text: 'package shapes\n\nfunc Exported() int { return 1 }\n' },
      {
        path: 'cmd/main.go',
        text: [
          'package main',
          '',
          'import "shapes"',
          '',
          'func Run() int { return shapes.Exported() }',
          '',
        ].join('\n'),
      },
    ];
    const index = buildRepoIndex(files, { goModule: 'shapes' });
    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.edges).toBe(1);
  });

  it('counts one edge for a name spelled twice, because a line is a site and not a use count', () => {
    // **The use index is built once per file and asked once per declaration**, and a file that calls the same function on
    // two lines must still be one edge: the first line is the site, and a second site for one name is the `(+n)` a reach
    // note prints. The cache is what makes the second question cheap rather than a second scan.
    const files = [
      { path: 'go.mod', text: 'module shapes\n\ngo 1.21\n' },
      { path: 'root.go', text: 'package shapes\n\nfunc Exported() int { return 1 }\n' },
      {
        path: 'cmd/main.go',
        text: [
          'package main',
          '',
          'import "shapes"',
          '',
          'func Run() int {',
          '\tfirst := shapes.Exported()',
          '\treturn first + shapes.Exported()',
          '}',
          '',
        ].join('\n'),
      },
    ];
    const index = buildRepoIndex(files, { goModule: 'shapes' });
    expect(index.stats.edges).toBe(1);
    expect(index.references[0]?.fromLine).toBe(6);
  });

  it('leaves a specifier with an unrecognised extension to its literal path', () => {
    /**
     * **A `.json` import is a path and not a compiled artefact**, so the resolver tries the specifier as written and does
     * not swap the extension - the arm `extension === ''` and the arm `COMPILED.has` both miss, and a rule that fell
     * through to the suffix list would answer `theme.json` with `theme.ts` if one existed.
     *
     * **`import "./styles.css"` is not read, and this case says so rather than hiding it.** A side-effect import has no
     * `from` clause, and `readStatement` finds the specifier by looking for one; a reader that added the quoted run after
     * the keyword would read it, and that reader does not exist yet. **The gap is one line of the table in §102.7** and
     * not a quiet failure: the statement is absent from `imports`, so a report that counts it sees zero rather than a
     * wrong edge.
     */
    const files = buildRepoIndex([
      { path: 'src/styles.css', text: '.x { color: red; }' },
      { path: 'src/theme.json', text: '{ "a": 1 }' },
      { path: 'src/b.ts', text: 'export const b = 1;\n' },
      {
        path: 'src/a.ts',
        text: [
          'import "./styles.css";',
          'import theme from "./theme.json";',
          'export const a = theme;',
        ].join('\n'),
      },
    ]);
    expect(files.stats.resolvedImports).toBe(1);
    expect(files.imports.map((row) => row.specifier)).toEqual(['./theme.json']);
  });

  it('reads a re-export whose brace list was never closed as a specifier with no names', () => {
    // **A formatter cannot produce this and a merge conflict can**: `export { alpha from './b.js'` with the closing brace
    // lost. The specifier is still readable and the names are not, which is the answer `braceNames` gives.
    const index = buildRepoIndex([
      { path: 'src/b.ts', text: 'export const alpha = 1;\n' },
      { path: 'src/a.ts', text: "export { alpha from './b.js'\n" },
    ]);
    expect(index.stats.resolvedImports).toBe(1);
    expect(index.stats.edges).toBe(0);
  });

  it('answers a Python import from another root as missing only when it is relative', () => {
    const index = buildRepoIndex([
      { path: 'pkg/mod.py', text: 'value = 1\n' },
      { path: 'pkg/a.py', text: 'from .nowhere import gone\n' },
      { path: 'pkg/b.py', text: 'import os\n' },
    ]);
    const byFile = new Map(index.unresolved.map((row) => [row.fromPath, row.why]));
    // **A leading dot is a claim about this repository**; a bare `os` is a claim about `sys.path`.
    expect(byFile.get('pkg/a.py')).toBe('missing');
    expect(byFile.get('pkg/b.py')).toBe('external');
  });

  it('reads a single-statement import with an alias, which is one line and two words', () => {
    // **The alias and the specifier are the only two things on the line**, and the reader takes both from the same match.
    const [statement] = go(
      ['package main', '', 'import bc "github.com/gin-gonic/gin/internal/bytesconv"', ''].join(
        '\n',
      ),
    );
    expect(statement?.alias).toBe('bc');
    expect(statement?.specifier).toBe('github.com/gin-gonic/gin/internal/bytesconv');
  });

  it('walks past a blank line and a comment inside an import block', () => {
    // **`gofmt` writes a comment between groups**, and a reader that stopped at the first line it could not parse would
    // read one import out of three.
    const statements = go(
      [
        'package main',
        '',
        'import (',
        '\t"os"',
        '',
        '\t// the codec is only needed by the json build tag',
        '\t"encoding/json"',
        ')',
      ].join('\n'),
    );
    expect(statements.map((statement) => statement.specifier)).toEqual(['os', 'encoding/json']);
  });

  it('answers no package when the directory holds no Go file', () => {
    // **A directory of `.md` files under a module path is not a package**, and an empty answer is the honest one.
    expect(
      resolveGoPackage(
        'example.com/m/docs',
        'example.com/m',
        new Set(['docs/readme.md', 'main.go']),
      ),
    ).toBeNull();
  });

  it('leaves a package declaration alone in a language that does not have one', () => {
    // **`readPackageName` is asked of every file with a package statement and of nothing else**, and a Python file that
    // happens to start with the word is not a JVM source.
    const lines = ['package = "demo"', 'value = 1'];
    expect(readPackageName('python', lines, lines)).toBeNull();
  });
});
