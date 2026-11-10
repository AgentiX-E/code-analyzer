// **React and React DOM must be the same version, and nothing in this repository said so.**
//
// Dependabot opened a pull request that moved `react` to 19.3.1 and left `react-dom` at 19.2.7 — a stale resolution in
// the lockfile rather than a wrong declaration, because both are declared `^19.0.0`. The result was not one failing
// assertion: **four suites failed at import time** with `Incompatible React versions: The "react" and "react-dom"
// packages must have the exact same version`, and the message arrives from React's own internals, in a job called
// "Web UI Tests", with no line of ours in it.
//
// **The declared ranges are not the invariant; the installed versions are.** Both being `^19.0.0` is exactly why a skew
// can happen, so this reads what pnpm actually resolved. **A named invariant that fails in one place is worth more than
// four suites that fail in four**, and the fix it names — reinstall so the pair resolves together — is one line.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const WEB = join(import.meta.dirname, '..', '..', '..', 'packages', 'web', 'node_modules');

/** The version pnpm resolved for a package inside the web workspace, or `null` when it is not installed. */
function resolvedVersion(pkg: string): string | null {
  const manifest = join(WEB, pkg, 'package.json');
  if (!existsSync(manifest)) return null;
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string };
  return parsed.version ?? null;
}

const react = resolvedVersion('react');
const reactDom = resolvedVersion('react-dom');

describe('the React runtime is one version', () => {
  // **Skipped rather than failed when the workspace is not installed**, because a test that fails before `pnpm install`
  // is a test people learn to ignore — and the failure this guards against only exists after an install.
  it.skipIf(react === null || reactDom === null)(
    'resolves react and react-dom to the same version',
    () => {
      expect(
        reactDom,
        `react is ${String(react)} and react-dom is ${String(reactDom)}. React refuses to run when the pair differs, so ` +
          'the four web suites fail at import with a message that names neither package.json nor the lockfile. ' +
          'Reinstall so both resolve together: `pnpm install --no-frozen-lockfile`.',
      ).toBe(react);
    },
  );

  it.skipIf(react === null)('declares a range that can still satisfy a shared resolution', () => {
    const manifest = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'packages', 'web', 'package.json'),
        'utf8',
      ),
    ) as { dependencies?: Record<string, string> };
    // **A pinned exact version here would make the skew permanent** rather than a transient lockfile state: react and
    // react-dom release separately, and two pins that must agree are two pins that drift.
    expect(String(manifest.dependencies?.['react'] ?? '')).toMatch(/^[\^~]/);
    expect(String(manifest.dependencies?.['react-dom'] ?? '')).toMatch(/^[\^~]/);
  });
});
