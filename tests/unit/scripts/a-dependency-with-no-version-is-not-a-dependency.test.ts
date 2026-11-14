// code-analyzer — an install that names no version is not an install, and the rule is ours rather than the scanner's
//
// `PinnedDependencies` reported 18 findings on 2026-11-14. Three groups came out of reading them, and only the first is
// a defect this repository could fix:
//
//   1. **Nothing was named at all**: a Dockerfile `FROM` on a moving tag, `pip install pyarrow`, `npm install -g
//      @augmentcode/auggie`, and two `curl | bash`. Fixed here - a digest for the base image, `==` for pip, `@x.y.z`
//      for npm, a commit sha for the one installer that has a repository.
//   2. **A version was named and the scanner does not read it.** `checks/raw/shell_download_validate.go` treats an npm
//      install as pinned only when it is `npm ci` or a git URL carrying a 40-character sha, and a pip install as pinned
//      only with `--require-hashes` or a wheel: `pkg@1.2.3` and `pkg==1.2.3` are both read as unpinned. Ten findings
//      sit here, and no rewrite of the command changes the verdict.
//   3. **The scanner cannot express the shape**: four `FROM base AS <stage>` lines inherit a stage, which the detector
//      scores by name lookup rather than by resolving what the stage was built from - those cleared when the base image
//      got its digest - and one vendor ships an installer with no revision to name.
//
// **So this file asserts the rule the repository can hold itself to, which is the stricter one**: a version, a digest,
// a commit sha, or a named entry in one of the tables below that says why there is none. The tables are the whole point
// - an exclusion with a reason is a decision, and an exclusion nobody wrote down is the thing this file exists to
// prevent. The failures read `docker build` and `pip`-own reasons rather than scanner vocabulary, because the next
// person to hit one will be editing a workflow, not reading a SARIF file.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DOCKERFILE = 'Dockerfile';

/**
 * **`npm install` with no package name installs the project, not a dependency**, so there is no version to name. The
 * workspace lockfile is what fixes this tree, and the npm call exists only because `vsce` wants a flat `node_modules`
 * rather than pnpm's symlink layout. Named here so the exception is a sentence and not a hole.
 */
const PROJECT_INSTALL_ALLOWED: ReadonlyArray<{ readonly path: string; readonly why: string }> = [
  {
    path: '.github/workflows/vscode-ci.yml',
    why: 'reinstalls the production tree from the workspace lockfile for a flat layout',
  },
];

/**
 * **A `curl | bash` is only pinned when the URL carries a commit sha.** `raw.githubusercontent.com/<owner>/<repo>/<sha>/`
 * satisfies that and needs no entry here. Everything else is a vendor script with no revision to name, and each one is
 * listed with the reason it is still run - or, for `cubic`, with the reason it is still *listed* in the probe.
 */
const DOWNLOAD_THEN_RUN_ALLOWED: ReadonlyArray<{ readonly match: string; readonly why: string }> = [
  {
    match: 'deb.nodesource.com/setup_22.x',
    why: 'NodeSource publishes one script per major version and no revisioned URL; the apt package it installs is versioned',
  },
  {
    match: 'cubic.dev/install',
    why: 'the vendor ships no npm package and no revisioned installer, which the probe records as a finding about the vendor',
  },
];

interface Occurrence {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/** Every file under `dir` whose name ends with one of `suffixes`, in a stable order. */
function walk(dir: string, suffixes: readonly string[], found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, suffixes, found);
      continue;
    }
    if (suffixes.some((suffix) => entry.name.endsWith(suffix))) found.push(path);
  }
  return found;
}

function linesOf(path: string): Occurrence[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((text, index) => ({ path, line: index + 1, text }))
    .filter((entry) => !entry.text.trimStart().startsWith('#'));
}

/** The package arguments of a command, with quotes and the failure path removed. */
function packagesOf(rest: string): string[] {
  // `||` and everything after it is the failure path, not an argument - and it is cut first, because splitting on
  // whitespace first would leave `echo "not installable ..."` looking like eleven packages.
  const head = rest.split('||')[0] ?? '';
  return head
    .split(/\s+/)
    .map((token) => token.replace(/^["']|["']$/g, ''))
    .filter((token) => token !== '' && !token.startsWith('-'));
}

const INSTALLS = [...walk('.github/workflows', ['.yml', '.yaml']), ...walk('scripts', ['.sh'])];

describe('every dependency this repository installs names what it installs', () => {
  it('pins every globally installed npm package to a version', () => {
    const unpinned: string[] = [];

    for (const path of INSTALLS) {
      for (const entry of linesOf(path)) {
        const install = /npm install ((?:-\S+ )*)-g (.+)$/.exec(entry.text);
        if (install === null) continue;
        for (const name of packagesOf(install[2] ?? '')) {
          // `@scope/name@1.2.3` - the version is the last `@`, which is why a scoped name is not the test.
          if (!/@\d+\.\d+\.\d+/.test(name)) unpinned.push(`${path}:${entry.line} ${name}`);
        }
      }
    }

    expect(
      unpinned,
      'a global install with no version moves the tool under the measurement',
    ).toEqual([]);
  });

  it('pins every pip package to an exact version', () => {
    const unpinned: string[] = [];

    for (const path of INSTALLS) {
      for (const entry of linesOf(path)) {
        const install = /(?:python3? -m )?pip3? install (.+)$/.exec(entry.text);
        if (install === null) continue;
        for (const name of packagesOf(install[1] ?? '')) {
          if (!name.includes('==') && !name.endsWith('.whl')) {
            unpinned.push(`${path}:${entry.line} ${name}`);
          }
        }
      }
    }

    expect(
      unpinned,
      'a pip install with no version is a reader that changes under the corpus',
    ).toEqual([]);
  });

  it('installs the project rather than a package only where the lockfile is what pins it', () => {
    const bare: string[] = [];

    for (const path of INSTALLS) {
      for (const entry of linesOf(path)) {
        if (!/(?:^|\s)npm (?:ci|install)\s/.test(entry.text)) continue;
        if (entry.text.includes(' -g ')) continue;
        // `npm ci` verifies the lockfile by definition; only a bare `npm install` is the case with nothing behind it.
        if (/(?:^|\s)npm ci\s/.test(entry.text)) continue;
        if (PROJECT_INSTALL_ALLOWED.some((allowed) => allowed.path === path)) continue;
        bare.push(`${path}:${entry.line}`);
      }
    }

    expect(bare, 'a project install outside the allowlist has no lockfile behind it').toEqual([]);
  });

  it('runs a downloaded script only from a commit sha or from a named vendor exception', () => {
    const unlisted: string[] = [];

    for (const path of INSTALLS) {
      for (const entry of linesOf(path)) {
        const pipe = /curl\s.*https:\/\/\S+\s*\|\s*(?:sudo -E )?(?:ba|z)?sh/.exec(entry.text);
        if (pipe === null) continue;
        // **The only form that can be verified from the URL alone**, and the one `PinnedDependencies` agrees with.
        if (/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//.test(entry.text)) continue;
        if (DOWNLOAD_THEN_RUN_ALLOWED.some((allowed) => entry.text.includes(allowed.match)))
          continue;
        unlisted.push(`${path}:${entry.line} ${entry.text.trim()}`);
      }
    }

    expect(
      unlisted,
      'an unversioned installer is a script that runs with the runner token',
    ).toEqual([]);
  });

  it('builds on a base image identified by digest, not by a tag that can be repointed', () => {
    const unpinned: string[] = [];
    const stages = new Set<string>();

    for (const entry of linesOf(DOCKERFILE)) {
      const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?$/i.exec(entry.text.trim());
      if (from === null) continue;
      const image = from[1] ?? '';
      const alias = from[2];
      // **A stage is as pinned as the image it was built from**, which is the relation the scanner resolves by name.
      const isStage = stages.has(image);
      if (!isStage && !/@(?:sha256:[a-f0-9]{64}|\$\{[^}]*DIGEST[^}]*\})/i.test(image)) {
        unpinned.push(`${DOCKERFILE}:${entry.line} ${image}`);
      }
      if (alias !== undefined) stages.add(alias);
    }

    expect(unpinned, 'a base image on a mutable tag is a different image next week').toEqual([]);
  });

  it('keeps every exception above to a path that exists, so a stale one is not a licence', () => {
    for (const allowed of [...PROJECT_INSTALL_ALLOWED, ...DOWNLOAD_THEN_RUN_ALLOWED]) {
      const target = 'path' in allowed ? allowed.path : allowed.match;
      const found = INSTALLS.some((path) => readFileSync(path, 'utf8').includes(target));
      expect(found, `${target} is listed but nothing installs it`).toBe(true);
    }
  });
});
