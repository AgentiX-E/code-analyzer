// @code-analyzer/analyzer — where a project's importable roots are, found from the files rather than assumed.
//
// **A repository is not always one package rooted at its top.** A checkout of a library holds the library *and* the
// examples that run it, and an example is its own program: `examples/tutorial/flaskr/db.py` is imported as `flaskr.db`
// because `examples/tutorial` is on `sys.path` when that example runs. A resolver anchored only at the repository root
// looks for `<root>/flaskr/db.py`, finds nothing, and reports an import it could not follow - which downstream is a
// caller it could not name, on a repository that is mostly examples.
//
// The marker is Python's own: **a directory with an `__init__.py` is a package**, and the directory above it is a root
// that package can be imported from. `name.py` beside it is a module and the directory above it is a root too. What is
// *not* a fact is which of several same-named directories is meant, so a name two roots provide is refused rather than
// guessed - the rule every other name in this resolver already follows.

import { basename, dirname, extname, sep } from 'node:path';

/** Directories that hold somebody else's code, and never the project's own packages. */
const NOT_A_ROOT = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  'venv',
  'site-packages',
  'dist',
]);

/** The package name → the roots that provide it. */
export interface PackageRoots {
  readonly roots: ReadonlyMap<string, readonly string[]>;
}

/**
 * Index every importable root the file list implies, keeping only the names one root provides.
 *
 * **One pass over the paths, no filesystem walk**: the scan phase has already listed every file in the project, so a
 * directory containing `__init__.py` is visible without a second traversal. A root equal to the project root is dropped
 * because the ordinary anchoring already tries it, and a name two roots provide is dropped because that is exactly the
 * case where a resolution would be a choice.
 */
export function buildPackageRoots(filePaths: Iterable<string>, projectRoot: string): PackageRoots {
  const roots = new Map<string, string[]>();
  const insideProject = projectRoot.endsWith(sep) ? projectRoot : `${projectRoot}${sep}`;
  const add = (name: string, root: string): void => {
    if (name.length === 0 || NOT_A_ROOT.has(name) || NOT_A_ROOT.has(basename(root))) return;
    // **A root outside the project is the filesystem's, not the project's.** `__init__.py` at the top of a checkout
    // makes the checkout importable from its parent directory, and resolving into `/` to satisfy a name like that is
    // a lookup nobody asked for. The project root itself is dropped for the reason below it.
    if (!root.startsWith(insideProject)) return;
    const known = roots.get(name);
    if (known === undefined) {
      roots.set(name, [root]);
      return;
    }
    if (!known.includes(root)) known.push(root);
  };

  for (const filePath of filePaths) {
    if (extname(filePath) !== '.py') continue;
    const directory = dirname(filePath);
    // `<root>/<name>/__init__.py` makes `name` importable from `<root>`.
    // `<root>/<name>.py` makes `name` importable from `<root>` too.
    //
    // **The root of a package is the directory *above* it**, which is the mistake this line had until a test asked
    // where `examples/tutorial/flaskr/__init__.py` puts `flaskr`: recorded as `examples/tutorial/flaskr`, the resolver
    // then looked for `examples/tutorial/flaskr/flaskr/db.py` and found nothing, so the arm existed and resolved
    // nothing. A module's root is its own directory, because that is where the `.py` file lives.
    const isPackage = basename(filePath) === '__init__.py';
    add(
      isPackage ? basename(directory) : basename(filePath, '.py'),
      isPackage ? dirname(directory) : directory,
    );
  }

  const unambiguous = new Map<string, readonly string[]>();
  for (const [name, candidates] of roots) {
    if (candidates.length === 1) unambiguous.set(name, candidates);
  }
  return { roots: unambiguous };
}

/** The roots that can provide a named top-level package - an empty list when the answer is none or several. */
export function rootsFor(roots: PackageRoots | undefined, packageName: string): readonly string[] {
  if (roots === undefined) return [];
  return roots.roots.get(packageName) ?? [];
}
