// Dependency overrides, and where they live.
//
// This file first asserted that `package.json` had no `pnpm.overrides` block, on the reasoning that pnpm 10+ reads
// `pnpm-workspace.yaml` and ignores the other. Removing the block broke seven workflows with
// `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`: the lockfile records the overrides configuration, and `--frozen-lockfile`
// compares it against the manifest. The block is not inert — it is part of what the install is verified against.
//
// So the invariant is not "one source". It is that both sources are present and that the lockfile agrees with them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('dependency overrides', () => {
  it('keep the manifest block the lockfile was resolved against', () => {
    // pnpm's frozen-lockfile check compares this block with the lockfile's copy. An absent block is not a no-op,
    // which is what this test now records.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      pnpm?: { overrides?: Record<string, string> };
    };

    expect(pkg.pnpm?.overrides).toBeDefined();
    expect(Object.keys(pkg.pnpm!.overrides!).length).toBeGreaterThan(0);
  });

  it('keep the workspace file as the source pnpm reads', () => {
    const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');
    const section = workspace.match(/^overrides:\n((?:\s+\S.*\n)+)/m);
    const entries = (section?.[1] ?? '').split('\n').filter((l) => l.trim() !== '');

    expect(entries).toHaveLength(7);
  });

  it('are recorded in the lockfile, which is what makes them load-bearing', () => {
    const lockfile = readFileSync('pnpm-lock.yaml', 'utf8');

    expect(lockfile).toMatch(/^overrides:/m);
  });
});
