/**
 * **A Swift import names a module, and a module is a target, and a target is a directory the repository wrote down.**
 *
 * §102 answered every `import Foundation` and every `import Alamofire` `external`, and the refusal was right: **a module
 * is not a file**, and a resolver that guessed `Alamofire.swift` for it would invent an edge. What the refusal left out
 * is that the mapping from module to directory is **declared**, in `Package.swift`, by the same tool that builds the
 * package - so `import Alamofire` is answerable for the same reason `import "a/b"` is answerable in Go once `go.mod` is
 * read.
 *
 * **The measurement that forced this file.** `Alamofire` writes 170 import statements and **0 of them resolve**, which
 * this repository published as the fact that proves the edge layer reads modules rather than files. A published zero is
 * a reason to look again: 165 of those 170 name `Alamofire` itself or an Apple framework, and the five test targets that
 * import the library they test are edges the index could have had.
 *
 * **Three forms, one reader**, and each is a shape a real package writes:
 *
 * - `.target(name: "Alamofire", path: "Source")` — the path is spelled, so the directory is the path;
 * - `.testTarget(name: "AlamofireTests")` — the path is not spelled, so it is SwiftPM's default `Tests/<name>`, which is
 *   a rule rather than a guess and is checked against the checkout before it is believed;
 * - `.binaryTarget(name: "X", url: …)` — **a prebuilt framework has no sources in this repository**, so it is not a
 *   module this index can answer and it is dropped rather than mapped to the default directory.
 */

import { describe, expect, it } from 'vitest';

import { readSwiftTargets } from '../imports-langs.js';
import { buildRepoIndex } from '../repo-index.js';

import type { RepoFile } from '../repo-index.js';

const PACKAGE_SWIFT = [
  '// swift-tools-version:5.9',
  'import PackageDescription',
  '',
  'let package = Package(',
  '    name: "Alamofire",',
  '    platforms: [.iOS(.v12), .macOS(.v10_13)],',
  '    products: [',
  '        .library(name: "Alamofire", targets: ["Alamofire"]),',
  '    ],',
  '    targets: [',
  '        .target(',
  '            name: "Alamofire",',
  '            path: "Source"',
  '        ),',
  '        .testTarget(',
  '            name: "AlamofireTests",',
  '            dependencies: ["Alamofire"]',
  '        ),',
  '        .binaryTarget(name: "Prebuilt", url: "https://example.test/a.zip", checksum: "abc"),',
  '    ]',
  ')',
].join('\n');

describe('the targets of a Swift package', () => {
  it('are the modules a file can import, with the directory each one spells', () => {
    const targets = readSwiftTargets(PACKAGE_SWIFT);
    expect(targets).toEqual([
      { name: 'Alamofire', path: 'Source' },
      // **A target that spells no path has SwiftPM's default**, which the index answers as a candidate rather than as a
      // fact: the directory is believed only when the checkout holds it.
      { name: 'AlamofireTests', path: null },
    ]);
  });

  it('are not products, because a product is a name a consumer imports and a module is what sources live in', () => {
    // `.library(name: "Alamofire", targets: [...])` is a product. It happens to share a name with a target here and it
    // does not have to - `AlamofireDynamic` is a product of the same package with no target of that name.
    const targets = readSwiftTargets(`let package = Package(
        name: "x",
        products: [.library(name: "AlamofireDynamic", targets: ["Alamofire"])],
        targets: [.target(name: "Alamofire")]
    )`);
    expect(targets.map((target) => target.name)).toEqual(['Alamofire']);
  });

  it('are read without a parse of Swift, because a package manifest is a list of labels and string literals', () => {
    // **The reader is deliberately shallow.** It reads `.target` / `.testTarget` / `.executableTarget` and the
    // `name:` / `path:` labels inside each, in either order, with or without trailing commas - which is every manifest
    // SwiftPM accepts for the two fields this index needs. A manifest that computes its targets in a loop is answered
    // with the targets it spells and nothing more.
    const targets = readSwiftTargets(`let package = Package(
        targets: [
            .executableTarget(
                path: "cmd/tool",
                name: "tool",
            ),
        ]
    )`);
    expect(targets).toEqual([{ name: 'tool', path: 'cmd/tool' }]);
  });
});

/** A checkout in the shape `swift test` reads: a library target, a test target, and a manifest that maps both. */
const CHECKOUT: readonly RepoFile[] = [
  {
    path: 'Package.swift',
    text: PACKAGE_SWIFT,
  },
  {
    path: 'Source/Session.swift',
    text: [
      'public final class Session {',
      '    public init() {}',
      '    public func request(_ path: String) {}',
      '}',
    ].join('\n'),
  },
  {
    path: 'Source/Request.swift',
    text: ['public struct Request {', '    public let id: Int', '}'].join('\n'),
  },
  {
    path: 'Tests/SessionTests.swift',
    text: [
      'import XCTest',
      '@testable import Alamofire',
      '',
      'final class SessionTests: XCTestCase {',
      '    func testSession() {',
      '        let session = Session()',
      '        session.request("/a")',
      '    }',
      '}',
    ].join('\n'),
  },
];

/** The module map a caller derives from the manifest, which is what the index is given rather than a directory. */
const MODULES = new Map([['Alamofire', 'Source']]);

describe('a Swift module import, answered by the target it names', () => {
  it('resolves to the target directory, and the names that cross are the ones the importer uses', () => {
    const index = buildRepoIndex(CHECKOUT, { swiftModules: MODULES });
    const statement = index.imports.find((row) => row.specifier === 'Alamofire');
    expect(statement?.why).toBe('resolved');
    // **A target is several files**, so the statement is answered by the first of them in sorted order and the edge is
    // made to whichever of them declares the name - the same asymmetry a Go package has.
    expect(statement?.target).toBe('Source/Request.swift');

    const edge = index.references.find((row) => row.toName === 'Session');
    expect(edge).toMatchObject({
      fromPath: 'Tests/SessionTests.swift',
      fromLine: 6,
      toPath: 'Source/Session.swift',
      toName: 'Session',
    });
  });

  it('is read through the @testable attribute, which is the form every Swift test writes', () => {
    const index = buildRepoIndex(CHECKOUT, { swiftModules: MODULES });
    expect(index.imports.some((row) => row.specifier === 'Alamofire')).toBe(true);
  });

  it('is external when no target of this package names it, which is the one thing the manifest can refute', () => {
    const index = buildRepoIndex(CHECKOUT, { swiftModules: MODULES });
    expect(index.imports.find((row) => row.specifier === 'XCTest')?.why).toBe('external');
  });

  it('is external when the caller has no module map at all, which is every caller that did not read a manifest', () => {
    // **The refusal is preserved rather than degraded**: without `Package.swift` a module is not a file, and inventing a
    // path for it is the edge §102 declined to invent.
    const index = buildRepoIndex(CHECKOUT);
    expect(index.imports.find((row) => row.specifier === 'Alamofire')?.why).toBe('external');
  });

  it('names one declaration of a module when the statement says which one', () => {
    // `import struct Dispatch.DispatchTime` names a declaration inside a module, so the module is the first segment and
    // the declaration is the rest - the form the Swift standard library's own overlays use.
    const files: readonly RepoFile[] = [
      { path: 'Package.swift', text: PACKAGE_SWIFT },
      {
        path: 'Source/Session.swift',
        text: 'public final class Session {\n    public init() {}\n}\n',
      },
      {
        path: 'Tests/A.swift',
        text: ['import class Alamofire.Session', '', 'let s = Session()'].join('\n'),
      },
    ];
    const index = buildRepoIndex(files, { swiftModules: MODULES });
    const statement = index.imports.find((row) => row.specifier.startsWith('Alamofire'));
    expect(statement?.why).toBe('resolved');
    expect(
      index.references.some((row) => row.toName === 'Session' && row.fromPath === 'Tests/A.swift'),
    ).toBe(true);
  });
});

/**
 * **The manifest reader refuses more than it reads**, and each refusal is a branch a reviewer can check: a `.target(`
 * whose parentheses never close, a target that spells no `name:`, and a string literal inside the call that holds a
 * bracket. **A reader that threw on any of them would take a review down with a manifest**, and one that guessed would
 * map a module to a directory nobody wrote.
 */
describe('a manifest the reader cannot finish', () => {
  it('answers nothing for a call whose parentheses never close', () => {
    expect(readSwiftTargets('targets: [.target(name: "A"')).toEqual([]);
  });

  it('skips a call that spells no name, because a target without a name is not importable', () => {
    expect(readSwiftTargets('.target(path: "Source")')).toEqual([]);
  });

  it('reads a name past a string literal that holds a bracket', () => {
    // The `path:` here holds a `)`, which a depth counter that ignored strings would treat as the end of the call.
    expect(readSwiftTargets('.target(name: "A", path: "Sources/A)b")')).toEqual([
      { name: 'A', path: 'Sources/A)b' },
    ]);
  });
});

describe('a Swift import whose names do not cross', () => {
  it('is a resolution with no edge when the only use of a name is the import statement itself', () => {
    const files: readonly RepoFile[] = [
      { path: 'Package.swift', text: PACKAGE_SWIFT },
      { path: 'Source/Session.swift', text: 'public final class Session {\n}\n' },
      { path: 'Tests/A.swift', text: 'import class Alamofire.Session\n'.trimEnd() },
    ];
    const index = buildRepoIndex(files, { swiftModules: MODULES });
    expect(index.imports.find((row) => row.specifier.startsWith('Alamofire'))?.why).toBe(
      'resolved',
    );
    // **A declaration nobody reads is the other half of what a change reaches**, and the import line is not a read of
    // the name it imports.
    expect(index.stats.edges).toBe(0);
  });

  it('makes one edge when two files of the target declare the same name', () => {
    // `RequestInterceptor` is a protocol in one file and an `extension` in the next, which is a shape every Swift
    // library has - and **the same traversal reaching the same pair twice was 715 of `Alamofire`'s first 1 440 edges**.
    const files: readonly RepoFile[] = [
      { path: 'Package.swift', text: PACKAGE_SWIFT },
      {
        path: 'Source/A.swift',
        text: 'public protocol Interceptor {\n    func adapt()\n}\n',
      },
      { path: 'Source/B.swift', text: 'extension Interceptor {\n    func adapt() {}\n}\n' },
      { path: 'Tests/A.swift', text: 'import Alamofire\n\nlet i: Interceptor? = nil\n' },
    ];
    const index = buildRepoIndex(files, { swiftModules: MODULES });
    const interceptor = index.references.filter((row) => row.toName === 'Interceptor');
    expect(interceptor.map((row) => row.toPath)).toEqual(['Source/A.swift']);
    expect(index.stats.edges).toBe(1);
  });
});
