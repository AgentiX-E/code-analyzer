// The roots a project's own packages can be imported from, worked out from the files the scan phase listed.
//
// **This is what an absolute Python import means in a program that is not the library.** A checkout of a library holds
// the library *and* the examples that run it, and `examples/tutorial/flaskr/db.py` is imported as `flaskr.db` because
// `examples/tutorial` is on `sys.path` when that example runs - not the repository root, where the resolver looked.
// Measured on `pallets/flask` 3.0.3, every import from a test or an example into the application resolved to zero
// files, which is most of the repository.
//
// The rule the module encodes is Python's own marker - a directory holding `__init__.py` is a package, and the
// directory above it is a root - and the discipline every other name in this resolver follows: a name two roots both
// provide is refused rather than guessed.

import { describe, it, expect } from 'vitest';

import { buildPackageRoots, rootsFor } from '../resolution/package-roots.js';

const PROJECT = '/proj';

describe('buildPackageRoots', () => {
  it('makes the directory above a package’s `__init__.py` a root', () => {
    const roots = buildPackageRoots(['/proj/examples/tutorial/flaskr/__init__.py'], PROJECT);
    expect(rootsFor(roots, 'flaskr')).toEqual(['/proj/examples/tutorial']);
  });

  it('makes the directory above a module a root, because a module is importable the same way', () => {
    const roots = buildPackageRoots(['/proj/examples/tutorial/common.py'], PROJECT);
    expect(rootsFor(roots, 'common')).toEqual(['/proj/examples/tutorial']);
  });

  it('keeps one entry when a directory provides a package of its own name twice', () => {
    // `flaskr/__init__.py` and `flaskr/flaskr.py` both make `flaskr` importable from `flaskr/`. A second copy of the
    // same (name, root) pair is not an ambiguity - it is the same root said twice - and it must not become one.
    const roots = buildPackageRoots(
      ['/proj/flaskr/__init__.py', '/proj/flaskr/flaskr.py'],
      PROJECT,
    );
    expect(rootsFor(roots, 'flaskr')).toEqual(['/proj/flaskr']);
  });

  it('keeps one entry when a package and a module of the same name share a root', () => {
    // `examples/flaskr/__init__.py` and `examples/flaskr.py` are two spellings of one importable name at one root,
    // which is what a package mid-migration between the two layouts looks like. One root, so one entry.
    const roots = buildPackageRoots(
      ['/proj/examples/flaskr/__init__.py', '/proj/examples/flaskr.py'],
      PROJECT,
    );
    expect(rootsFor(roots, 'flaskr')).toEqual(['/proj/examples']);
  });

  it('accepts a project root written with a trailing separator', () => {
    // **A path a caller built by concatenation usually ends in a slash**, and comparing it to a root that does not
    // would make every root look like it came from outside the project.
    const roots = buildPackageRoots(['/proj/examples/flaskr/__init__.py'], '/proj/');
    expect(rootsFor(roots, 'flaskr')).toEqual(['/proj/examples']);
  });

  it('refuses a name two roots both provide', () => {
    // **The case with no evidence in it.** `flask/app.py` and an example that declares its own `app` both make `app`
    // importable from different directories, and picking one would be a coin toss written into the graph.
    const roots = buildPackageRoots(
      ['/proj/a/app/__init__.py', '/proj/b/app/__init__.py'],
      PROJECT,
    );
    expect(rootsFor(roots, 'app')).toEqual([]);
  });

  it('keeps the names that are not ambiguous beside the one that is', () => {
    const roots = buildPackageRoots(
      ['/proj/a/app/__init__.py', '/proj/b/app/__init__.py', '/proj/a/tools/__init__.py'],
      PROJECT,
    );
    expect(rootsFor(roots, 'tools')).toEqual(['/proj/a']);
    expect(rootsFor(roots, 'app')).toEqual([]);
  });

  it('drops the project root itself, which the ordinary anchoring already tries', () => {
    const roots = buildPackageRoots(['/proj/__init__.py'], PROJECT);
    expect(roots.roots.size).toBe(0);
  });

  it('drops a directory that holds somebody else’s code', () => {
    // `node_modules/pkg/__init__.py` is a package, but resolving to it would say the project's own code calls into
    // an installed dependency by name - which is the generic branch's question, not this one's.
    const roots = buildPackageRoots(
      ['/proj/node_modules/pkg/__init__.py', '/proj/venv/lib/site-packages/x/__init__.py'],
      PROJECT,
    );
    expect(roots.roots.size).toBe(0);
  });

  it('drops a name that is a directory nobody should resolve into', () => {
    // A `dist/__init__.py` makes `dist` importable, and every name in it is generated from source that is already
    // indexed - so a resolution into it points at a copy rather than at the declaration.
    const roots = buildPackageRoots(['/proj/dist/__init__.py'], PROJECT);
    expect(rootsFor(roots, 'dist')).toEqual([]);
  });

  it('ignores every file that is not Python', () => {
    const roots = buildPackageRoots(
      ['/proj/src/index.ts', '/proj/src/pkg/__init__.py', '/proj/README.md'],
      PROJECT,
    );
    expect(Array.from(roots.roots.keys())).toEqual(['pkg']);
  });

  it('drops a package that sits directly under the project root', () => {
    // The ordinary anchoring already tries `<projectRoot>/<name>/…`, so a root equal to the project root is the
    // anchor the resolver starts from rather than one this index adds.
    const roots = buildPackageRoots(['/proj/flask/__init__.py'], PROJECT);
    expect(roots.roots.size).toBe(0);
  });

  it('answers nothing for a package it never saw', () => {
    const roots = buildPackageRoots(['/proj/a/one/__init__.py'], PROJECT);
    expect(rootsFor(roots, 'two')).toEqual([]);
  });

  it('answers nothing when the project declared no roots at all', () => {
    // **The optional argument the resolver takes**, and the reason it is optional: a caller with no root list is a
    // caller that has not been taught to build one, and it must get the behaviour it had rather than an exception.
    expect(rootsFor(undefined, 'flaskr')).toEqual([]);
  });

  it('builds the same index from a set or from a list', () => {
    const paths = ['/proj/a/one/__init__.py', '/proj/b/two/__init__.py'];
    const fromList = buildPackageRoots(paths, PROJECT);
    const fromSet = buildPackageRoots(new Set(paths), PROJECT);
    expect(Array.from(fromSet.roots.entries())).toEqual(Array.from(fromList.roots.entries()));
  });
});
