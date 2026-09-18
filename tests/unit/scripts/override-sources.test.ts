// One place for overrides.
//
// `package.json` carried a `pnpm.overrides` block that pnpm stopped reading when it moved configuration into
// `pnpm-workspace.yaml`. The block was inert — which is why removing it changes no resolution — but an inert
// configuration block is worse than an absent one: it reads as a constraint that is being applied.
//
// This test asserts there is one source, and names it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('dependency overrides', () => {
  it('are declared in pnpm-workspace.yaml and nowhere else', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      pnpm?: { overrides?: unknown };
    };
    const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');

    expect(pkg.pnpm?.overrides).toBeUndefined();
    expect(workspace).toMatch(/^overrides:/m);
  });

  it('declare the overrides the lockfile was resolved with', () => {
    // A count rather than a list: the point is that the file is where overrides live and that it is not empty. If
    // this changes, the change is deliberate and this number moves with it — the same ratchet the other baselines
    // in this repository use.
    const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');
    const section = workspace.match(/^overrides:\n((?:\s+\S.*\n)+)/m);
    const entries = (section?.[1] ?? '').split('\n').filter((l) => l.trim() !== '');

    expect(entries).toHaveLength(7);
  });
});
