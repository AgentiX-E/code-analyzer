// **The铁律 was a sentence in eleven sections, and a sentence cannot refuse a number.**
//
// §173.5 wrote `S63`'s target as `code defect 0.3110 → ≥ 0.40`. The baseline was the **live** board's (`0.3828` on the
// pinned document), and the target `0.40` sat **below** the competitor's `0.4641` under our own DeepSeek - both in
// direct contradiction of the rule the contract states everywhere: a target may only be at or above the competitor
// under the same LLM. The number was copied into five sections, so no single edit corrected it. `scripts/target-gate.mjs`
// makes the rule executable against a single source of truth; these cases are the reasons it can never pass by accident.
//
//   1. A target below its competitor is refused, naming both.
//   2. A baseline that disagrees with the artifact is refused - the stale-document failure, one level up.
//   3. An unreadable or absent source is a refusal, never a value of zero.
//   4. A selector that names no row is a refusal, never an undefined that later reads as nothing.
//   5. A registry with no targets is a refusal - a gate that inspected nothing is a green gate.
//   6. The honest registry passes, and every figure is re-read from its artifact rather than trusted from the prose.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyse, resolveRef } from '../../../scripts/target-gate.mjs';

interface Target {
  id: string;
  baseline: { value: number; from: string };
  competitor: { value: number; from: string };
  target: number;
}

/** A scratch repo with one artifact carrying two figures, and a registry pointing at them. */
function fixture(
  overrides: {
    baseline?: number;
    competitor?: number;
    target?: number;
    baselineFrom?: string;
    competitorFrom?: string;
    withTargets?: boolean;
  } = {},
) {
  const repo = mkdtempSync(join(tmpdir(), 'target-gate-'));
  writeFileSync(
    join(repo, 'bench.json'),
    JSON.stringify(
      { f1: 0.3274, rows: [{ category: 'Code Defect', theirsRecall: 0.4641 }] },
      null,
      2,
    ),
  );
  const entry: Target = {
    id: 'aacr.f1',
    baseline: {
      value: overrides.baseline ?? 0.3274,
      from: overrides.baselineFrom ?? 'bench.json#f1',
    },
    competitor: {
      value: overrides.competitor ?? 0.4641,
      from: overrides.competitorFrom ?? 'bench.json#rows[category=Code Defect].theirsRecall',
    },
    target: overrides.target ?? 0.4641,
  };
  const registry = { targets: overrides.withTargets === false ? [] : [entry] };
  const registryPath = join(repo, 'targets.json');
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  return { repo, registryPath, entry };
}

describe('a target is never set below the competitor under the same LLM', () => {
  it('refuses a target below the competitor and names both figures', () => {
    const { repo, registryPath } = fixture({ target: 0.4 });
    const result = analyse(repo, registryPath);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(
      /target 0\.4000 is below the competitor under our LLM 0\.4641/,
    );
  });

  it('accepts a target exactly level with the competitor', () => {
    const { repo, registryPath } = fixture({ target: 0.4641 });
    expect(analyse(repo, registryPath).ok).toBe(true);
  });

  it('refuses a stale baseline even when the target is legal', () => {
    // **The `0.3110` defect.** The prose said `0.3110` where the artifact carried `0.3828`; a legal target must not
    // hide that the starting point names a document that no longer exists.
    const { repo, registryPath } = fixture({ baseline: 0.311 });
    const result = analyse(repo, registryPath);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(
      /baseline says 0\.3110 but bench\.json#f1 carries 0\.3274/,
    );
  });

  it('refuses a source that does not exist, rather than reading it as zero', () => {
    const { repo, registryPath } = fixture({ competitorFrom: 'gone.json#f1' });
    const result = analyse(repo, registryPath);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(
      /source cannot be read: file gone\.json does not exist/,
    );
  });

  it('refuses a selector that names no row', () => {
    const { repo, registryPath } = fixture({
      competitorFrom: 'bench.json#rows[category=No Such Category].theirsRecall',
    });
    const result = analyse(repo, registryPath);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/selects no row with category=No Such Category/);
  });

  it('refuses a registry with no targets', () => {
    const { repo, registryPath } = fixture({ withTargets: false });
    const result = analyse(repo, registryPath);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/names zero targets/);
  });

  it('reads every figure from its source, not from the value the registry claims', () => {
    // The registry's `competitor.value` is a lie (0.1), but the gate must price against the artifact (0.4641) - so a
    // target between them is still refused. A gate that trusted the registry could be talked down by editing one file.
    const { repo, registryPath } = fixture({ competitor: 0.1, target: 0.2 });
    const result = analyse(repo, registryPath);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/below the competitor under our LLM 0\.4641/);
  });
});

describe('resolveRef', () => {
  it('resolves a dotted field and a bracketed selector', () => {
    const { repo } = fixture();
    expect(resolveRef('bench.json#f1', repo)).toMatchObject({ ok: true, value: 0.3274 });
    expect(resolveRef('bench.json#rows[category=Code Defect].theirsRecall', repo)).toMatchObject({
      ok: true,
      value: 0.4641,
    });
  });

  it('refuses a non-finite value rather than reading it as zero', () => {
    const repo = mkdtempSync(join(tmpdir(), 'target-gate-'));
    writeFileSync(join(repo, 'v.json'), JSON.stringify({ f1: '0.4' }));
    expect(resolveRef('v.json#f1', repo)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not a finite number'),
    });
  });
});
