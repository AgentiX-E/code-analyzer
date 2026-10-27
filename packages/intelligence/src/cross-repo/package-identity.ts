// @code-analyzer/intelligence — what a repository can be called, and where its modules live.
//
// **A cross-repository import does not name a path.** `from werkzeug.wrappers import Request` in a checkout of
// flask names an installed distribution; `import { z } from '@scope/zod'` names a registry package; `import
// "github.com/foo/bar/pkg"` names a module path. The indexer understood one shape — specifiers that walk out of the
// repository (`../../shared/types`), which is the monorepo layout — and nothing else.
//
// **Measured, before this file existed**: flask 3.0.3 + werkzeug 3.0.3 in one group, 230 files, 7 768 nodes,
// **0 `IMPORTS` edges and 0 `CROSS_REPO_*` edges**, against 49 distinct (file, module) import pairs counted by
// Python's own `ast`. The flagship claim of story 5 — one answer across repositories that depend on each other —
// produced an empty graph on the first real pair it was pointed at.
//
// **The manifest is the repository's own statement of identity**, and the source layout is the statement of where
// its modules are. Both are read here and nothing is inferred from directory names alone: a repository that
// publishes no manifest has no identity, and its imports stay unresolved rather than resolving to a guess.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A package a repository publishes, addressed the way an importer would address it. */
export interface PackageIdentity {
  /**
   * What an importer writes to reach this package: `werkzeug`, `@scope/pkg`, `github.com/foo/bar`.
   *
   * **`null` for languages that address a member by fully-qualified name instead** — `import com.acme.Foo;` names
   * the class, not a distribution, so there is no prefix to match and resolution is by existence under a source
   * root.
   */
  readonly importName: string | null;
  /** Repo-relative directories the package's modules live under (`''` is the repository root). */
  readonly roots: readonly string[];
  /** The file that justified this identity, so a reader can check the claim against the repository. */
  readonly manifest: string;
  /** The language whose import syntax this identity answers. */
  readonly language: string;
}

/** Extensions tried, in order, for a specifier that names a module without writing one. */
const PYTHON_SUFFIXES = ['.py', '.pyi'] as const;
const SCRIPT_SUFFIXES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;
const JVM_SUFFIXES = ['.java', '.kt'] as const;

function firstExisting(localPath: string, candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(join(localPath, candidate))) return candidate;
  }
  return null;
}

function readText(localPath: string, file: string): string {
  // The caller only asks for a file it has already found, so a read failure is a filesystem fault rather than a
  // case to model: letting it throw keeps the failure visible instead of reporting "no manifest".
  return readFileSync(join(localPath, file), 'utf-8');
}

/** Directories that may hold a Python package, most specific first. */
const PYTHON_LAYOUTS = ['src', 'lib', ''] as const;

/**
 * Python addresses a package by the **directory name**, not by the distribution name on PyPI.
 *
 * **`beautifulsoup4` is imported as `bs4` and `PyYAML` as `yaml`**, so a manifest's `name` is the wrong string to
 * match a specifier against — and a lookup keyed on it would have resolved nothing for two of the most imported
 * libraries in the corpus. The directory is what the interpreter itself uses, so the directory is what is read;
 * the manifest only decides whether the repository publishes anything at all.
 */
function detectPython(localPath: string): PackageIdentity[] {
  const manifest = firstExisting(localPath, ['pyproject.toml', 'setup.py', 'setup.cfg']);
  if (!manifest) return [];

  const identities: PackageIdentity[] = [];
  const seen = new Set<string>();

  for (const layout of PYTHON_LAYOUTS) {
    const base = layout === '' ? localPath : join(localPath, layout);
    if (!existsSync(base)) continue;

    let entries: string[];
    try {
      entries = readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      continue;
    }

    for (const name of entries) {
      if (seen.has(name)) continue;
      const root = layout === '' ? name : `${layout}/${name}`;
      if (!existsSync(join(base, name, '__init__.py'))) continue;
      seen.add(name);
      identities.push({ importName: name, roots: [root], manifest, language: 'python' });
    }
  }

  return identities;
}

/**
 * A `package.json` names the string an importer writes, verbatim — including the scope, which is part of the name
 * and not a directory.
 */
function detectNode(localPath: string): PackageIdentity[] {
  if (!existsSync(join(localPath, 'package.json'))) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(localPath, 'package.json'));
  } catch {
    return [];
  }

  const name = (parsed as { name?: unknown }).name;
  if (typeof name !== 'string' || name === '') return [];
  // **`private: true` is not an obstacle**: a workspace member imported by its siblings is private and imported on
  // every build, which is exactly the case this resolution exists for.
  const language = existsSync(join(localPath, 'tsconfig.json')) ? 'typescript' : 'javascript';
  return [{ importName: name, roots: [''], manifest: 'package.json', language }];
}

/** Java and Kotlin address a member as a fully-qualified name under a source root. */
function detectJvm(localPath: string): PackageIdentity[] {
  const manifest = firstExisting(localPath, ['pom.xml', 'build.gradle', 'build.gradle.kts']);
  if (!manifest) return [];

  const roots = ['src/main/java', 'src/main/kotlin'].filter((root) =>
    existsSync(join(localPath, root)),
  );
  if (roots.length === 0) return [];

  return [
    {
      importName: null,
      roots,
      manifest,
      language: roots[0]!.includes('kotlin') ? 'kotlin' : 'java',
    },
  ];
}

/** Go addresses a member by the module path declared in `go.mod`. */
function detectGo(localPath: string): PackageIdentity[] {
  if (!existsSync(join(localPath, 'go.mod'))) return [];

  const declared = /^module\s+(\S+)/m.exec(readText(localPath, 'go.mod'));
  if (!declared) return [];

  return [{ importName: declared[1]!, roots: [''], manifest: 'go.mod', language: 'go' }];
}

/** Rust addresses a crate by its name with hyphens folded to underscores, as `use` requires. */
function detectRust(localPath: string): PackageIdentity[] {
  if (!existsSync(join(localPath, 'Cargo.toml'))) return [];

  const section = tomlSection(readText(localPath, 'Cargo.toml'), 'package');
  const declared = section ? /^\s*name\s*=\s*["']([^"']+)["']/m.exec(section) : null;
  if (!declared) return [];

  return [
    {
      importName: declared[1]!.replace(/-/g, '_'),
      roots: [''],
      manifest: 'Cargo.toml',
      language: 'rust',
    },
  ];
}

/**
 * The body of one TOML section, or `null`.
 *
 * **`[\s\S]*?(?=^\s*\[|$)` is the one-liner this replaced, and with the `m` flag `$` matches at every line
 * break** — so the section body was empty and a `Cargo.toml` with `name = "my-crate"` published nothing.
 */
function tomlSection(text: string, name: string): string | null {
  const body: string[] = [];
  let inside = false;
  let found = false;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      inside = header[1] === name;
      if (inside) found = true;
      continue;
    }
    if (inside) body.push(line);
  }
  return found ? body.join('\n') : null;
}

/**
 * Every package a checkout publishes, one identity per package directory.
 *
 * A repository with no manifest publishes nothing this resolver can name, and an empty list is reported rather
 * than a guess: **an unresolved import is a gap a measurement can show, while a wrongly resolved one is a false
 * edge that no measurement can tell from a true one.**
 */
export function detectPackageIdentities(localPath: string): PackageIdentity[] {
  return [
    ...detectPython(localPath),
    ...detectNode(localPath),
    ...detectJvm(localPath),
    ...detectGo(localPath),
    ...detectRust(localPath),
  ];
}

/**
 * The repository-relative file a specifier names, or `null` when this identity does not answer for it.
 *
 * **Existence is the arbiter.** A candidate path is only returned when the file is on disk, so a specifier that
 * merely looks like it belongs to this repository (`import werkzeug` in a repository that does not contain
 * `werkzeug/__init__.py`) resolves to nothing instead of to a file that happened to sort first.
 */
export function resolvePackageMember(
  localPath: string,
  identity: PackageIdentity,
  specifier: string,
): string | null {
  const candidates = candidatePaths(identity, specifier);

  if (identity.language === 'go') {
    // **A Go import names a directory, and a directory is not a `File` node**: the candidate is a folder, so
    // `existsSync` alone would answer "yes" and hand back a path no node carries.
    for (const directory of candidates) {
      const file = firstGoFile(localPath, directory);
      if (file) return file;
    }
    return null;
  }

  return firstExisting(localPath, candidates);
}

/**
 * A Go import names a **directory**, and a directory is not a `File` node.
 *
 * The package's files share one directory, so the alphabetically first `.go` file stands for it: deterministic
 * across machines (unlike `readdir` order, which is filesystem-dependent) and enough for an edge that is anchored
 * to a file rather than to a package.
 */
function firstGoFile(localPath: string, relativeDir: string): string | null {
  const directory = relativeDir === '' ? localPath : join(localPath, relativeDir);
  let entries: string[];
  try {
    if (!statSync(directory).isDirectory()) return null;
    entries = readdirSync(directory).filter((name) => name.endsWith('.go'));
  } catch {
    return null;
  }
  const chosen = entries.sort()[0];
  if (chosen === undefined) return null;
  return relativeDir === '' ? chosen : `${relativeDir}/${chosen}`;
}

function candidatePaths(identity: PackageIdentity, specifier: string): string[] {
  const roots = identity.roots;
  const out: string[] = [];

  // **One early return removes four unreachable null-checks.** Java and Kotlin are the only languages that address a
  // member by fully-qualified name; after this block `importName` is a `string` for every remaining language, so the
  // per-language `stripPrefix` cannot fail for a reason the type does not already exclude.
  if (identity.importName === null) {
    // `com.acme.Foo` → `com/acme/Foo.java`. No prefix to strip; the source root does the addressing.
    const stem = specifier.replace(/\./g, '/');
    for (const root of roots) {
      for (const suffix of JVM_SUFFIXES) out.push(withRoot(root, stem + suffix));
    }
    return out;
  }

  const remainder = stripPrefix(specifier, identity.importName);
  if (remainder === null) return [];

  if (identity.language === 'go') {
    for (const root of roots) out.push(withRoot(root, remainder));
    return out;
  }

  if (identity.language === 'python') {
    const stem = remainder.replace(/\./g, '/');
    for (const root of roots) {
      const base = withRoot(root, stem);
      if (stem === '') {
        out.push(joinPosix(base, '__init__.py'));
      } else {
        for (const suffix of PYTHON_SUFFIXES) out.push(base + suffix);
        out.push(joinPosix(base, '__init__.py'));
      }
    }
    return out;
  }

  if (identity.language === 'rust') {
    const stem = remainder.replace(/::/g, '/');
    for (const root of roots) {
      if (stem === '') {
        out.push(joinPosix(root, 'src/lib.rs'), joinPosix(root, 'src/main.rs'));
      } else {
        out.push(withRoot(joinPosix(root, 'src'), stem + '.rs'));
        out.push(joinPosix(withRoot(joinPosix(root, 'src'), stem), 'mod.rs'));
      }
    }
    return out;
  }

  // JavaScript / TypeScript: `pkg`, `@scope/pkg`, and any subpath beneath either.
  for (const root of roots) {
    const base = withRoot(root, remainder);
    if (remainder === '') {
      for (const suffix of SCRIPT_SUFFIXES) out.push(`index${suffix}`);
      continue;
    }
    for (const suffix of SCRIPT_SUFFIXES) out.push(base + suffix);
    for (const suffix of SCRIPT_SUFFIXES) out.push(joinPosix(base, `index${suffix}`));
  }
  return out;
}

/** `werkzeug.wrappers` under `werkzeug` is `wrappers`; `werkzeugx` under `werkzeug` is not a member. */
function stripPrefix(specifier: string, importName: string): string | null {
  if (specifier === importName) return '';
  const dotted = `${importName}.`;
  if (specifier.startsWith(dotted)) return specifier.slice(dotted.length);
  const slashed = `${importName}/`;
  if (specifier.startsWith(slashed)) return specifier.slice(slashed.length);
  // Rust's separator: `my_crate::util` names `util` inside the crate.
  const scoped = `${importName}::`;
  if (specifier.startsWith(scoped)) return specifier.slice(scoped.length);
  return null;
}

/** Paths are compared as posix strings because that is how `File` nodes store `filePath`. */
function withRoot(root: string, stem: string): string {
  if (root === '') return stem;
  return stem === '' ? root : `${root}/${stem}`;
}

function joinPosix(base: string, leaf: string): string {
  return base === '' ? leaf : `${base}/${leaf}`;
}
