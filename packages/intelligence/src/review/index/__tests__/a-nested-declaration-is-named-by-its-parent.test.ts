/**
 * **A declaration inside a declaration is named by both of them, and the index named it by its own.**
 *
 * §103.8 read five of `Alamofire`'s new edges and two were wrong. One was fixed where it was wrong (`class func` is a
 * modifier). **The other is a naming defect and could not be fixed in a line**: `public enum Error` inside
 * `public struct JSONEncoding` was recorded as a symbol called `Error`, so **every file that wrote the word `Error`
 * got an edge into `ParameterEncoding.swift`** - and `Error` is the single most common word in Swift that is also a
 * type name.
 *
 * **The rule is Swift's own scope rule.** Outside the type, the name is `JSONEncoding.Error`; inside it, `Error`. A
 * cross-file edge is by definition written outside the type, so **the qualified spelling is the only one that can
 * cross a file boundary**, and the unqualified one is exactly the name that must not.
 *
 * **What this changes about every symbol the index reports.** A nested type used to be a top-level symbol with a short
 * name; it is now a symbol whose name carries its parent. **That is a change of shape, not of count** - and the count is
 * what the artifact reports, so both are stated in §104 rather than left for a reader to discover.
 *
 * **The limit, stated here rather than discovered later.** An extension qualifies its members by the name it extends,
 * which is the same rule; a type whose name is itself dotted (`extension Foo.Bar`) is qualified by what it spells, so a
 * nested declaration under it reads `Foo.Bar.Baz` - **the reader's name, not a resolution against the parent's file**.
 */

import { describe, expect, it } from 'vitest';

import { buildRepoIndex } from '../repo-index.js';
import { scanSwift } from '../symbols-langs.js';

import type { RepoFile } from '../repo-index.js';

const NESTED = [
  'public struct JSONEncoding: ParameterEncoding {',
  '    public enum Error: Swift.Error {',
  '        case invalidJSONObject',
  '    }',
  '',
  '    public func encode(_ value: Any) throws -> Data {',
  '        return Data()',
  '    }',
  '}',
  '',
  'extension JSONEncoding {',
  '    public struct Options {',
  '        public var pretty: Bool = false',
  '    }',
  '}',
].join('\n');

/** The tiny file model the scanners take, which is the shape `prepareFile` builds from a source text. */
function prepared(text: string) {
  const lines = text.split('\n');
  const depthAtStart: number[] = [];
  let depth = 0;
  for (const line of lines) {
    depthAtStart.push(depth);
    for (const character of line) {
      if (character === '{') depth += 1;
      else if (character === '}') depth = Math.max(0, depth - 1);
    }
  }
  return {
    lines,
    codes: lines,
    depthAtStart,
    endOf: (at: number) => {
      const base = depthAtStart[at]!;
      for (let line = at + 1; line < lines.length; line += 1) {
        if (depthAtStart[line]! <= base) return line - 1;
      }
      return lines.length - 1;
    },
  } as never;
}

describe('the name of a declaration inside a declaration', () => {
  it('carries its parent, and the short name is not a symbol at all', () => {
    const scanned = scanSwift(prepared(NESTED));
    const names = scanned.symbols.map((symbol) => symbol.name);
    expect(names).toContain('JSONEncoding');
    expect(names).toContain('JSONEncoding.Error');
    // **`Error` alone is the name that made a false edge**, so it must not be one of the symbols.
    expect(names).not.toContain('Error');
  });

  it('carries the name of the extension that declares it, because an extension is a scope too', () => {
    const scanned = scanSwift(prepared(NESTED));
    expect(scanned.symbols.map((symbol) => symbol.name)).toContain('JSONEncoding.Options');
  });

  it('is offered only when it is public, which is the rule a top-level type already followed', () => {
    const scanned = scanSwift(
      prepared(
        [
          'public struct Outer {',
          '    enum Hidden {',
          '        case one',
          '    }',
          '    public enum Shown {',
          '        case two',
          '    }',
          '}',
        ].join('\n'),
      ),
    );
    expect(scanned.exported).toContain('Outer.Shown');
    expect(scanned.exported).not.toContain('Outer.Hidden');
  });
});

describe('the edge a nested declaration makes', () => {
  const files: RepoFile[] = [
    {
      path: 'Source/JSONEncoding.swift',
      text: NESTED,
    },
    {
      path: 'Source/Caller.swift',
      text: [
        'import Alamofire',
        '',
        'func f() throws {',
        '    throw JSONEncoding.Error.invalidJSONObject',
        '}',
      ].join('\n'),
    },
    {
      path: 'Source/Bare.swift',
      text: ['import Alamofire', '', 'func g() {', '    let error = decodeError()', '}'].join('\n'),
    },
    {
      path: 'Package.swift',
      text: 'let package = Package(name: "Alamofire", targets: [.target(name: "Alamofire", path: "Source")])',
    },
  ];

  const index = buildRepoIndex(files, {
    swiftModules: new Map([['Alamofire', 'Source']]),
  });

  it('is an edge when the use site spells the parent, because that is the only spelling that crosses a file', () => {
    const edge = index.references.find(
      (reference) =>
        reference.fromPath === 'Source/Caller.swift' && reference.toName === 'JSONEncoding.Error',
    );
    expect(edge).toMatchObject({
      toPath: 'Source/JSONEncoding.swift',
      fromLine: 4,
    });
  });

  it('is not an edge when the use site writes the short name, which is the defect this test was written for', () => {
    // `Bare.swift` writes no name the target declares: `decodeError` is not a symbol and `error` is a local.
    expect(
      index.references.filter((reference) => reference.fromPath === 'Source/Bare.swift'),
    ).toEqual([]);
  });

  it('is placed on the first use after the import, and not on the first use in the file', () => {
    /**
     * **A file may spell a name before the statement that brings it in** - no compiler accepts it and a reader must not
     * care, because the question this index answers is *which line would a reviewer point at*. `Early.swift` writes the
     * dotted name on line 1 and imports on line 2, so the edge belongs on the later use and not on the earlier one.
     */
    const early: RepoFile[] = [
      { path: 'Source/JSONEncoding.swift', text: NESTED },
      {
        path: 'Source/Early.swift',
        text: [
          'func h() { _ = JSONEncoding.Error.invalidJSONObject }',
          'import Alamofire',
          '',
          'func i() { _ = JSONEncoding.Error.invalidJSONObject }',
        ].join('\n'),
      },
      {
        path: 'Package.swift',
        text: 'let package = Package(name: "Alamofire", targets: [.target(name: "Alamofire", path: "Source")])',
      },
    ];
    const indexWithEarly = buildRepoIndex(early, {
      swiftModules: new Map([['Alamofire', 'Source']]),
    });
    expect(
      indexWithEarly.references.filter(
        (reference) =>
          reference.fromPath === 'Source/Early.swift' && reference.toName === 'JSONEncoding.Error',
      ),
    ).toMatchObject([{ fromLine: 4 }]);
  });

  it('is not an edge at all when the only use precedes the import, because nothing would carry the line', () => {
    const beforeOnly: RepoFile[] = [
      { path: 'Source/JSONEncoding.swift', text: NESTED },
      {
        path: 'Source/Before.swift',
        text: ['func h() { _ = JSONEncoding.Error.invalidJSONObject }', 'import Alamofire'].join(
          '\n',
        ),
      },
      {
        path: 'Package.swift',
        text: 'let package = Package(name: "Alamofire", targets: [.target(name: "Alamofire", path: "Source")])',
      },
    ];
    const indexWithBefore = buildRepoIndex(beforeOnly, {
      swiftModules: new Map([['Alamofire', 'Source']]),
    });
    expect(
      indexWithBefore.references.filter(
        (reference) => reference.fromPath === 'Source/Before.swift',
      ),
    ).toEqual([]);
  });

  it('is not an edge inside the file that declares it, because a file is not its own target', () => {
    /**
     * **A definition is not a read.** `JSONEncoding.swift` declares `JSONEncoding.Error` and writes it on its own lines;
     * the file that owns a name cannot be a caller of it, which is the same refusal the word pass makes with `own`.
     */
    expect(
      index.references.filter(
        (reference) =>
          reference.fromPath === 'Source/JSONEncoding.swift' &&
          reference.toName === 'JSONEncoding.Error',
      ),
    ).toEqual([]);
  });

  it('counts one line once when the same pair is written twice on it', () => {
    /**
     * **Two uses on one line are one line.** The bucket that records where a dotted pair is written keeps lines, not
     * occurrences - a reviewer points at a line, and a second entry for the same line would make the binary search look
     * for a line that says nothing new.
     */
    const twice: RepoFile[] = [
      { path: 'Source/JSONEncoding.swift', text: NESTED },
      {
        path: 'Source/Twice.swift',
        text: [
          'import Alamofire',
          'let a = JSONEncoding.Error.invalidJSONObject; let b = JSONEncoding.Error.invalidJSONObject',
        ].join('\n'),
      },
      {
        path: 'Package.swift',
        text: 'let package = Package(name: "Alamofire", targets: [.target(name: "Alamofire", path: "Source")])',
      },
    ];
    const indexWithTwice = buildRepoIndex(twice, {
      swiftModules: new Map([['Alamofire', 'Source']]),
    });
    expect(
      indexWithTwice.references.filter(
        (reference) =>
          reference.fromPath === 'Source/Twice.swift' && reference.toName === 'JSONEncoding.Error',
      ),
    ).toMatchObject([{ fromLine: 2 }]);
  });
});
