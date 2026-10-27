// Tests for the identity a repository publishes — the string an importer writes, and where its modules are.
//
// **Every case builds a real directory.** The resolver's whole job is to answer "does this file exist under this
// layout", and a fixture that answers for it would be testing the fixture: `resolvePackageMember` decides by
// `existsSync`, so the only honest input is a filesystem.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  detectPackageIdentities,
  resolvePackageMember,
} from '../../cross-repo/package-identity.js';

import type { PackageIdentity } from '../../cross-repo/package-identity.js';

/** A temporary checkout holding exactly the files a case names. */
function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'pkg-identity-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function only(identities: PackageIdentity[]): PackageIdentity {
  expect(identities).toHaveLength(1);
  return identities[0]!;
}

describe('detectPackageIdentities — Python', () => {
  it('names the package after its directory under src, and records the manifest', () => {
    const root = checkout({
      'pyproject.toml': '[project]\nname = "Werkzeug"\n',
      'src/werkzeug/__init__.py': '',
      'src/werkzeug/utils.py': '',
    });

    const identity = only(detectPackageIdentities(root));
    // **The distribution name is `Werkzeug` and the import name is `werkzeug`**: matching a specifier against the
    // manifest would have failed on every import, which is also why `beautifulsoup4` → `bs4` works here.
    expect(identity).toEqual({
      importName: 'werkzeug',
      roots: ['src/werkzeug'],
      manifest: 'pyproject.toml',
      language: 'python',
    });
  });

  it('finds a package that sits at the repository root instead of under src', () => {
    const root = checkout({ 'setup.py': 'name="flat"\n', 'flat/__init__.py': '' });
    expect(only(detectPackageIdentities(root)).roots).toEqual(['flat']);
  });

  it('prefers src over a same-named directory at the root', () => {
    const root = checkout({
      'setup.cfg': '[metadata]\nname = dup\n',
      'dup/__init__.py': '',
      'src/dup/__init__.py': '',
    });
    expect(only(detectPackageIdentities(root)).roots).toEqual(['src/dup']);
  });

  it('publishes nothing when there is no manifest', () => {
    const root = checkout({ 'src/thing/__init__.py': '' });
    expect(detectPackageIdentities(root)).toEqual([]);
  });

  it('survives a checkout where a layout directory is a file', () => {
    // `src` can be a file — a stray artifact, a broken symlink target. `existsSync` says yes and `readdir` raises
    // ENOTDIR, which is the one way this guard is reachable, so it is tested rather than trusted.
    const root = checkout({ 'pyproject.toml': '', src: 'not a directory', 'flat/__init__.py': '' });
    expect(detectPackageIdentities(root).map((identity) => identity.roots)).toEqual([['flat']]);
  });

  it('ignores directories that are not packages', () => {
    const root = checkout({
      'pyproject.toml': '',
      'src/real/__init__.py': '',
      'src/notapackage/utils.py': '',
    });
    expect(detectPackageIdentities(root).map((identity) => identity.importName)).toEqual(['real']);
  });
});

describe('resolvePackageMember — Python', () => {
  const root = checkout({
    'pyproject.toml': '',
    'src/werkzeug/__init__.py': '',
    'src/werkzeug/utils.py': '',
    'src/werkzeug/wrappers/__init__.py': '',
    'src/werkzeug/wrappers/request.py': '',
  });
  const identity = only(detectPackageIdentities(root));

  it('resolves a dotted module to its file', () => {
    expect(resolvePackageMember(root, identity, 'werkzeug.utils')).toBe('src/werkzeug/utils.py');
  });

  it('resolves a package to its __init__', () => {
    expect(resolvePackageMember(root, identity, 'werkzeug.wrappers')).toBe(
      'src/werkzeug/wrappers/__init__.py',
    );
    expect(resolvePackageMember(root, identity, 'werkzeug')).toBe('src/werkzeug/__init__.py');
  });

  it('returns nothing for a module that is not there, or for another package', () => {
    expect(resolvePackageMember(root, identity, 'werkzeug.nonexistent')).toBeNull();
    // **`werkzeugx` is not a member of `werkzeug`**: prefix matching without the separator would resolve it.
    expect(resolvePackageMember(root, identity, 'werkzeugx.utils')).toBeNull();
    expect(resolvePackageMember(root, identity, 'django')).toBeNull();
  });
});

describe('detectPackageIdentities — Node', () => {
  it('keeps the scope as part of the name and calls it TypeScript when a tsconfig is present', () => {
    const root = checkout({
      'package.json': JSON.stringify({ name: '@acme/widgets', private: true }),
      'tsconfig.json': '{}',
      'index.ts': '',
    });

    const identity = only(detectPackageIdentities(root));
    expect(identity).toEqual({
      importName: '@acme/widgets',
      roots: [''],
      manifest: 'package.json',
      language: 'typescript',
    });
    expect(resolvePackageMember(root, identity, '@acme/widgets')).toBe('index.ts');
  });

  it('resolves a subpath and a directory index', () => {
    const root = checkout({
      'package.json': JSON.stringify({ name: 'widgets' }),
      'index.js': '',
      'lib/util.js': '',
      'lib/deep/index.js': '',
    });
    const identity = only(detectPackageIdentities(root));

    expect(resolvePackageMember(root, identity, 'widgets/lib/util')).toBe('lib/util.js');
    expect(resolvePackageMember(root, identity, 'widgets/lib/deep')).toBe('lib/deep/index.js');
    expect(resolvePackageMember(root, identity, 'widgets/lib/missing')).toBeNull();
    expect(resolvePackageMember(root, identity, 'other')).toBeNull();
  });

  it('publishes nothing without a name, and survives a malformed manifest', () => {
    expect(detectPackageIdentities(checkout({ 'package.json': '{}' }))).toEqual([]);
    expect(detectPackageIdentities(checkout({ 'package.json': '{not json' }))).toEqual([]);
  });
});

describe('detectPackageIdentities — JVM, Go, Rust', () => {
  it('addresses Java members by fully-qualified name under a source root', () => {
    const root = checkout({
      'pom.xml': '<project/>',
      'src/main/java/com/acme/App.java': '',
    });
    const identity = only(detectPackageIdentities(root));

    expect(identity.importName).toBeNull();
    expect(identity.language).toBe('java');
    expect(resolvePackageMember(root, identity, 'com.acme.App')).toBe(
      'src/main/java/com/acme/App.java',
    );
    expect(resolvePackageMember(root, identity, 'com.acme.Absent')).toBeNull();
  });

  it('reports Kotlin when the only source root is the Kotlin one', () => {
    const root = checkout({
      'build.gradle.kts': '',
      'src/main/kotlin/com/acme/App.kt': '',
    });
    const identity = only(detectPackageIdentities(root));
    expect(identity.language).toBe('kotlin');
    expect(resolvePackageMember(root, identity, 'com.acme.App')).toBe(
      'src/main/kotlin/com/acme/App.kt',
    );
  });

  it('publishes nothing for a JVM repository with no source root', () => {
    expect(detectPackageIdentities(checkout({ 'pom.xml': '<project/>' }))).toEqual([]);
  });

  it('resolves a Go module path to the first file of the named directory', () => {
    const root = checkout({
      'go.mod': 'module github.com/acme/kit\n\ngo 1.22\n',
      'pkg/util/b.go': '',
      'pkg/util/a.go': '',
    });
    const identity = only(detectPackageIdentities(root));

    expect(identity.importName).toBe('github.com/acme/kit');
    // Deterministic by name, because `readdir` order is a filesystem detail and this number goes in a report.
    expect(resolvePackageMember(root, identity, 'github.com/acme/kit/pkg/util')).toBe(
      'pkg/util/a.go',
    );
    expect(resolvePackageMember(root, identity, 'github.com/acme/kit/absent')).toBeNull();
    expect(resolvePackageMember(root, identity, 'github.com/other/kit')).toBeNull();
  });

  it('resolves the module root itself, and refuses a path that is a file', () => {
    const root = checkout({
      'go.mod': 'module example.com/rooted\n',
      'main.go': '',
      'docs/README.md': '',
    });
    const identity = only(detectPackageIdentities(root));

    // `import "example.com/rooted"` names the module root: the file is directly under the repository.
    expect(resolvePackageMember(root, identity, 'example.com/rooted')).toBe('main.go');
    // `README` exists but is not a directory, so it cannot be a Go package.
    expect(resolvePackageMember(root, identity, 'example.com/rooted/docs/README.md')).toBeNull();
  });

  it('publishes nothing for a go.mod without a module line, or a directory with no Go file', () => {
    expect(detectPackageIdentities(checkout({ 'go.mod': 'go 1.22\n' }))).toEqual([]);

    const root = checkout({ 'go.mod': 'module example.com/m\n', 'empty/.keep': '' });
    const identity = only(detectPackageIdentities(root));
    expect(resolvePackageMember(root, identity, 'example.com/m/empty')).toBeNull();
  });

  it('folds a Rust crate name the way `use` requires', () => {
    const root = checkout({
      'Cargo.toml': '[package]\nname = "my-crate"\nversion = "0.1.0"\n',
      'src/lib.rs': '',
      'src/util.rs': '',
      'src/deep/mod.rs': '',
    });
    const identity = only(detectPackageIdentities(root));

    expect(identity.importName).toBe('my_crate');
    expect(resolvePackageMember(root, identity, 'my_crate')).toBe('src/lib.rs');
    expect(resolvePackageMember(root, identity, 'my_crate::util')).toBe('src/util.rs');
    expect(resolvePackageMember(root, identity, 'my_crate::deep')).toBe('src/deep/mod.rs');
    expect(resolvePackageMember(root, identity, 'my_crate::absent')).toBeNull();
  });

  it('publishes nothing for a Cargo.toml without a [package] name', () => {
    expect(detectPackageIdentities(checkout({ 'Cargo.toml': '[workspace]\n' }))).toEqual([]);
  });
});

describe('detectPackageIdentities — a repository that publishes several packages', () => {
  it('returns one identity per package directory', () => {
    const root = checkout({
      'pyproject.toml': '',
      'package.json': JSON.stringify({ name: 'toolkit' }),
      'src/alpha/__init__.py': '',
      'src/beta/__init__.py': '',
    });

    const identities = detectPackageIdentities(root);
    expect(identities.map((identity) => identity.importName)).toEqual(['alpha', 'beta', 'toolkit']);
  });
});
