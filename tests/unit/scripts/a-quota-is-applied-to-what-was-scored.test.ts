// **The quota was applied to the questions asked, and a rejected rewrite is a question that was not scored.** §41.3's R1
// said every repository contributes 60–70 scored rows, the first six-repository run produced 59 from `pallets/flask`
// because eight of its sixty-seven rewrites were rejected twice, and the gate refused the artifact. **The gate was
// right**: a denominator that shrinks by an eighth while the artifact still says "six repositories, one quota each" is
// the same defect one level down.
//
// The fix is not a wider band. It is that the quota belongs to the accepted set: the sample asks for slightly more than
// a quota per repository, and the scored set is trimmed back to the water-filled share of what was actually accepted.
// **Nothing is invented and nothing is asked twice** - the rows were already generated and already measured, and the
// trim only decides which of them count.
//
// The properties below are what makes the trim safe: it never adds a row, never reorders, drops from the widest
// repository rather than from the front, and reproduces the same set twice.

import { describe, expect, it } from 'vitest';

import { trimToQuota } from '../../../scripts/lib/multirepo-harness.js';

interface Row {
  repo: string;
  at: number;
}

/** The shape the first six-repository run produced: 370 accepted rows over six repositories. */
const accepted: Row[] = [];
for (const [repo, count] of [
  ['BurntSushi/ripgrep', 65],
  ['expressjs/express', 56],
  ['gin-gonic/gin', 63],
  ['google/gson', 66],
  ['pallets/flask', 59],
  ['sindresorhus/got', 61],
] as const) {
  for (let at = 0; at < count; at++) accepted.push({ repo, at });
}

const of = (row: Row): string => row.repo;

function counts(rows: readonly Row[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) result[row.repo] = (result[row.repo] ?? 0) + 1;
  return result;
}

describe('a quota is applied to the rows that were scored', () => {
  it('leaves no repository above the water-filled share, and the smallest ones whole', () => {
    const scored = trimToQuota(accepted, of, 360);
    const byRepo = counts(scored);

    // **360 over six is 61 with four repositories taking one more**, and `express` has 56 - fewer than its share, so it
    // keeps all 56 and the surplus goes to the repositories that can take it.
    expect(Object.keys(byRepo).sort()).toEqual([...new Set(accepted.map((row) => row.repo))].sort());
    expect(byRepo['expressjs/express']).toBe(56);
    expect(scored.length).toBe(360);
    for (const count of Object.values(byRepo)) expect(count).toBeLessThanOrEqual(62);
    // **What the trim is for**: the repository that documents itself most carries 17 per cent of the measurement rather
    // than the 67 per cent a stride gave it.
    expect(byRepo['google/gson']! / scored.length).toBeLessThanOrEqual(0.18);
  });

  it('is a no-op when the accepted set is already at or below the target', () => {
    // The trim decides which rows count; it never decides that fewer should count just because a target was named.
    expect(trimToQuota(accepted, of, accepted.length)).toHaveLength(accepted.length);
    const byRepo = counts(trimToQuota(accepted, of, 400));
    expect(byRepo['pallets/flask']).toBe(59);
  });

  it('never adds a row and never invents one', () => {
    const scored = trimToQuota(accepted, of, 300);
    const keys = new Set(accepted.map((row) => `${row.repo}:${row.at}`));
    for (const row of scored) expect(keys.has(`${row.repo}:${row.at}`)).toBe(true);
    expect(scored.length).toBeLessThanOrEqual(300);
  });

  it('drops from the widest repository rather than from the front of it', () => {
    // **Dropping the tail of a sorted list is dropping an alphabet**, and the list is sorted by symbol name. The trim
    // keeps an even spread for the same reason the sample does.
    const wide: Row[] = Array.from({ length: 200 }, (_, at) => ({ repo: 'a/wide', at }));
    const scored = trimToQuota(wide, of, 50);
    const kept = scored.map((row) => row.at);
    expect(kept[0]).toBeLessThan(6);
    expect(kept[kept.length - 1]).toBeGreaterThan(190);
  });

  it('is the same set on a second call', () => {
    const first = trimToQuota(accepted, of, 366).map((row) => `${row.repo}:${row.at}`);
    const second = trimToQuota(accepted, of, 366).map((row) => `${row.repo}:${row.at}`);
    expect(second).toEqual(first);
  });

  it('returns everything when the target is not smaller than the input', () => {
    expect(trimToQuota(accepted, of, accepted.length)).toHaveLength(accepted.length);
    expect(trimToQuota(accepted, of, 1000)).toHaveLength(accepted.length);
  });
});
