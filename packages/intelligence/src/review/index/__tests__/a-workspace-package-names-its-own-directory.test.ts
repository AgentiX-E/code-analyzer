// @code-analyzer/intelligence — a workspace package's name is a directory, and the manifest says which
//
// **The measurement this file was written after.** zod's `packages/zod/src` holds 333 files and 928 import statements;
// **513 resolved and 415 were answered `external`, and 192 of those 415 name the repository itself** - `import { z } from
// 'zod'`, written by zod's own sources 192 times. The index read the manifests of no language, so a monorepo's own
// packages arrived at the resolver as dependencies. **55.3 % was a statement about the resolver, not about the code.**
//
// **What the rule must not become.** A bare specifier is a dependency far more often than it is this repository's own
// package, and a resolver that treats every bare name as one would invent edges across a repository from a name that
// merely looks like a directory. So the manifest is the only source: a name is a package because a `package.json`
// declares it, in the directory the walk found it in.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { packageNameOf, readRepoFiles } from '../repo-files.js';
import { buildRepoIndex } from '../repo-index.js';

let root = '';

function write(path: string, text: string): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
}

/** The statement a file wrote about a specifier, or `undefined` when it wrote none. */
function statementOf(
  index: ReturnType<typeof buildRepoIndex>,
  fromPath: string,
  specifier: string,
) {
  return index.imports.find(
    (statement) => statement.fromPath === fromPath && statement.specifier === specifier,
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'workspace-packages-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the name a manifest declares', () => {
  it('reads a name and refuses everything that is not one', () => {
    expect(packageNameOf('{"name":"zod"}')).toBe('zod');
    expect(packageNameOf('{"name":"@scope/pkg","version":"1.0.0"}')).toBe('@scope/pkg');
    // **A manifest with no name is not a package this repository can be indexed by**, and a version-only file is the
    // ordinary case in a private workspace: the reference implementation refuses it rather than inventing a directory.
    expect(packageNameOf('{"version":"1.0.0"}')).toBeNull();
    expect(packageNameOf('{"name":42}')).toBeNull();
    expect(packageNameOf('{"name":""}')).toBeNull();
    expect(packageNameOf('not json at all')).toBeNull();
    expect(packageNameOf('{"name":"' + 'x'.repeat(300) + '"}')).toBeNull();
  });

  it('refuses JSON that is not an object, which a manifest must be', () => {
    // **`null`, a string and an array are legal JSON and none of them is a manifest**, and the branch that says so is the
    // one a reader of `parsed?.name` never sees: `null` would throw on the property read, `"x"` would answer `undefined`
    // and an array would answer `undefined` too - so all three are refused explicitly rather than by accident.
    expect(packageNameOf('null')).toBeNull();
    expect(packageNameOf('"zod"')).toBeNull();
    expect(packageNameOf('[]')).toBeNull();
    expect(packageNameOf('42')).toBeNull();
  });
});

describe('a checkout that declares its own packages', () => {
  beforeEach(() => {
    write('packages/zod/package.json', '{"name":"zod"}\n');
    write('packages/zod/src/index.ts', 'export const z = 1;\n');
    write('packages/zod/src/v4/index.ts', 'export const v4 = 1;\n');
    write('packages/app/package.json', '{"name":"@app/core"}\n');
    write(
      'packages/app/src/use.ts',
      "import { z } from 'zod';\nimport { v4 } from 'zod/v4';\nimport { a } from '@app/core';\nexport const y = z;\n",
    );
    write('packages/app/src/self.ts', "import { a } from '@app/core';\nexport const s = a;\n");
    write('packages/app/src/index.ts', 'export const a = 1;\n');
  });

  it('collects the packages the walk passed, keyed by the name their manifest declares', () => {
    const tree = readRepoFiles(root, { extensions: ['.ts'] });
    expect(tree.workspacePackages.get('zod')).toBe('packages/zod');
    expect(tree.workspacePackages.get('@app/core')).toBe('packages/app');
    // **The root is not a package here**, because the fixture has no manifest at the root: a repository that declares
    // no name at its top is a workspace of packages rather than a package.
    expect(tree.workspacePackages.has('')).toBe(false);
  });

  it('resolves a bare specifier to the package directory, and a subpath below it', () => {
    const tree = readRepoFiles(root, { extensions: ['.ts'] });
    const index = buildRepoIndex(tree.files, { packages: tree.workspacePackages });
    // **`packages/zod/src/index.ts`, not `packages/zod/index.ts`**: the manifest sits one level above the code, and the
    // two-base candidate list is what lets the resolver see both layouts without being told which one it is looking at.
    expect(statementOf(index, 'packages/app/src/use.ts', 'zod')).toMatchObject({
      target: 'packages/zod/src/index.ts',
      why: 'resolved',
    });
    expect(statementOf(index, 'packages/app/src/use.ts', 'zod/v4')).toMatchObject({
      target: 'packages/zod/src/v4/index.ts',
      why: 'resolved',
    });
    expect(statementOf(index, 'packages/app/src/use.ts', '@app/core')).toMatchObject({
      target: 'packages/app/src/index.ts',
      why: 'resolved',
    });
  });

  it('counts the resolutions, so the rate is a rate over this checkout', () => {
    const tree = readRepoFiles(root, { extensions: ['.ts'] });
    const index = buildRepoIndex(tree.files, { packages: tree.workspacePackages });
    expect(index.stats.resolvedImports).toBe(4);
    expect(index.stats.externalImports).toBe(0);
    expect(index.stats.missingImports).toBe(0);
  });

  it('leaves a name nobody declares external', () => {
    // **The rule's whole safety is that a manifest is the only evidence.** `vitest` is a dependency in this fixture's
    // world as surely as it is in zod's, and a resolver that fell back to a directory named after the specifier would
    // report a package the checkout does not hold as one it does.
    write(
      'packages/app/src/test.ts',
      "import { expect } from 'vitest';\nexport const t = expect;\n",
    );
    const tree = readRepoFiles(root, { extensions: ['.ts'] });
    const index = buildRepoIndex(tree.files, { packages: tree.workspacePackages });
    expect(statementOf(index, 'packages/app/src/test.ts', 'vitest')).toMatchObject({
      target: null,
      why: 'external',
    });
  });

  it('answers the same way for a `require` in a CommonJS file', () => {
    // **A `.js` file writes both forms and the corpus does not say which** (§95.1), so a rule that only reached the ESM
    // reader would resolve half of a JavaScript monorepo and report the rate of the half it read.
    write('packages/app/lib/load.js', "const zod = require('zod');\nmodule.exports = zod;\n");
    const tree = readRepoFiles(root, { extensions: ['.ts', '.js'] });
    const index = buildRepoIndex(tree.files, { packages: tree.workspacePackages });
    expect(statementOf(index, 'packages/app/lib/load.js', 'zod')).toMatchObject({
      target: 'packages/zod/src/index.ts',
      why: 'resolved',
    });
  });

  it('resolves nothing when the caller cannot see the manifests', () => {
    // **The control.** Without the map the same checkout answers exactly what §102 measured: every bare specifier is a
    // dependency. A rule that resolved without the map would be reading the directory tree rather than the declaration.
    const tree = readRepoFiles(root, { extensions: ['.ts'] });
    const index = buildRepoIndex(tree.files);
    for (const specifier of ['zod', 'zod/v4', '@app/core'])
      expect(statementOf(index, 'packages/app/src/use.ts', specifier)).toMatchObject({
        target: null,
        why: 'external',
      });
  });
});
