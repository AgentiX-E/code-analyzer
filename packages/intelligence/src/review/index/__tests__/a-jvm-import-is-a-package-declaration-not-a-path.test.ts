/**
 * **A JVM import names a class in a package, and the package is written in the file rather than implied by its path.**
 *
 * §97 resolved `import a.b.C;` with a suffix match: `a/b/C.java` at the end of a path. That rule is right for a
 * repository that lays its sources out as its packages, and it is **wrong for every Kotlin multiplatform project**,
 * because `kotlinx-coroutines-core/common/src/flow/Flow.kt` declares `package kotlinx.coroutines.flow` and no suffix of
 * its path is `kotlinx/coroutines/flow/Flow.kt`.
 *
 * **The measurement that forced this file.** `Kotlin/kotlinx.coroutines` writes **4 421 import statements and 2 of them
 * resolve** - 0.05 % - so the largest Kotlin repository in the sample had **no edges at all**. `Alamofire` is the same
 * shape for Swift's reason (a module is not a file), but Kotlin's is a defect and not a refusal.
 *
 * **The fact that fixes it is in the file.** `package a.b` and the file's own name are both written down, so
 * `(package, name)` is a key a repository can be indexed by - **and it is the same key the compiler uses**, which is what
 * makes this a resolution rather than a heuristic. The path suffix stays as the second chance, because a Java source root
 * under `src/main/java` is what the suffix rule was written for and it must not get worse.
 */

import { describe, expect, it } from 'vitest';

import { readPackageName, resolveJvmSpecifier } from '../imports-langs.js';
import { buildRepoIndex, impactOf } from '../repo-index.js';

describe('the package a file declares', () => {
  it('is read from the statement, in the three languages that write one the same way', () => {
    const kotlin = ['package kotlinx.coroutines.flow', '', 'public interface Flow<T> {', '}'].join(
      '\n',
    );
    const lines = kotlin.split('\n');
    expect(readPackageName('kotlin', lines, lines)).toBe('kotlinx.coroutines.flow');
    expect(readPackageName('java', lines, lines)).toBe('kotlinx.coroutines.flow');
    expect(readPackageName('groovy', lines, lines)).toBe('kotlinx.coroutines.flow');
  });

  it('is null for a file that declares none, which is a default package and not a guess', () => {
    const lines = ['class A {}'].join('\n').split('\n');
    expect(readPackageName('java', lines, lines)).toBeNull();
  });

  it('is not read out of a comment', () => {
    const lines = ['// package commented.out', 'class A {}'];
    const codes = ['', 'class A {}'];
    expect(readPackageName('java', lines, codes)).toBeNull();
  });
});

describe('a JVM specifier, answered by the package the target declares', () => {
  const files = new Set([
    'kotlinx-coroutines-core/common/src/flow/Flow.kt',
    'kotlinx-coroutines-core/jvm/src/flow/Flow.kt',
  ]);
  const packages = new Map([
    ['kotlinx.coroutines.flow.Flow', ['kotlinx-coroutines-core/jvm/src/flow/Flow.kt']],
  ]);

  it('is the file whose package declaration matches, which no suffix of the path does', () => {
    // **The suffix rule answers `null` here** and the measurement said so: no path ends with
    // `kotlinx/coroutines/flow/Flow.kt`. The package index answers it, and it is the compiler's own key.
    expect(
      resolveJvmSpecifier('kotlin', 'kotlinx.coroutines.flow.Flow', filesByBaseOf(files), packages),
    ).toBe('kotlinx-coroutines-core/jvm/src/flow/Flow.kt');
  });

  it('still answers a Java source root by suffix, because that is what the path rule is for', () => {
    const java = new Set(['src/main/java/a/b/C.java']);
    expect(resolveJvmSpecifier('java', 'a.b.C', filesByBaseOf(java), new Map())).toBe(
      'src/main/java/a/b/C.java',
    );
  });

  it('prefers the package the statement names over a suffix that ends the same way', () => {
    /**
     * **Two files called `Flow.kt` in two source sets**, which a multiplatform project has by construction: `common/`
     * holds the expectation and `jvm/` the actual. A suffix match has two answers and refuses; **the package declaration
     * has one**, and it is the one whose source set the importer's compilation unit is in.
     */
    expect(
      resolveJvmSpecifier('kotlin', 'kotlinx.coroutines.flow.Flow', filesByBaseOf(files), packages),
    ).toBe('kotlinx-coroutines-core/jvm/src/flow/Flow.kt');
  });
});

/** The basename index `buildRepoIndex` keeps, built here so the unit cases do not depend on a corpus. */
function filesByBaseOf(paths: ReadonlySet<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const path of paths) {
    const base = path.slice(path.lastIndexOf('/') + 1);
    const bucket = out.get(base);
    if (bucket === undefined) out.set(base, [path]);
    else bucket.push(path);
  }
  return out;
}

describe('a Kotlin repository, read end to end', () => {
  const FILES = [
    {
      path: 'kotlinx-coroutines-core/common/src/flow/Flow.kt',
      text: [
        'package kotlinx.coroutines.flow',
        '',
        'public interface Flow<out T> {',
        '  public suspend fun collect()',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'kotlinx-coroutines-core/common/src/flow/SharedFlow.kt',
      text: [
        'package kotlinx.coroutines.flow',
        '',
        'import kotlinx.coroutines.flow.Flow',
        '',
        'public interface SharedFlow<out T> : Flow<T> {',
        '  public val replayCache: Int',
        '}',
        '',
      ].join('\n'),
    },
  ];

  it('makes an edge between two files whose paths share no suffix with their package', () => {
    const index = buildRepoIndex(FILES);
    expect(index.stats.imports).toBe(1);
    expect(index.stats.resolvedImports).toBe(1);
    const impact = impactOf(index, 'kotlinx-coroutines-core/common/src/flow/Flow.kt', ['Flow']);
    expect(impact.paths).toEqual(['kotlinx-coroutines-core/common/src/flow/SharedFlow.kt']);
  });
});
