// **A page that recomputes is a page that can disagree.** Every bar on `docs/aacr-category-gap.html` comes from the record
// `scripts/aacr-category-gap.mjs` wrote, so the renderer's only job is to refuse input it cannot draw and to draw the rest
// without a network request. These cases hold the four ways it can fail:
//
//   1. **a version it does not know** - the fields below are v1's, and a v0 record read as if it were v1 draws zeros;
//   2. **rows that do not add back up to the record's own totals** - the §124 defect, one layer out from the instrument;
//   3. **a record with no categories** - a table with a header and no rows reads as "no gap" rather than "no reading";
//   4. **a page that needs the network** - the rule this repository applies to every page it commits: it must survive
//      being emailed.
//
// The last case is the one that keeps this honest: the committed record is drawn and the four figures §173.3 publishes are
// asserted from the page's own bytes, so a table that drifts from the section fails here rather than in a reader's quote.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/aacr-category-gap-page.mjs';
const RECORD = 'benchmarks/aacr-category-gap.json';

const FIXTURE = {
  version: 'aacr-category-gap-v1',
  source: 'dispatch 45924315931 · fixture',
  corpus: { pullRequests: 2, goldens: 5 },
  emission: { ours: 6, theirs: 4 },
  credited: { ours: 3, theirs: 2 },
  rows: [
    { category: 'Code Defect', goldens: 4, ours: 3, theirs: 2, oursRecall: 0.75, theirsRecall: 0.5, gap: -1 },
    { category: 'Performance', goldens: 1, ours: 0, theirs: 0, oursRecall: 0, theirsRecall: 0, gap: 0 },
  ],
};

interface Run {
  code: number;
  out: string;
  html: string | null;
}

function run(record: unknown = FIXTURE): Run {
  const directory = mkdtempSync(join(tmpdir(), 'gap-page-'));
  const recordPath = join(directory, 'record.json');
  writeFileSync(recordPath, JSON.stringify(record));
  const outPath = join(directory, 'page.html');
  const argv = [SCRIPT, '--record', recordPath, '--out', outPath];
  try {
    const out = execFileSync('node', argv, { encoding: 'utf8' });
    return { code: 0, out, html: readFileSync(outPath, 'utf8') };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, out: `${failed.stdout ?? ''}${failed.stderr ?? ''}`, html: null };
  }
}

describe('the gap page draws what the record holds, and refuses what it cannot', () => {
  it('draws every category with both arms and the signed gap', () => {
    const { code, out, html } = run();
    expect(code).toBe(0);
    expect(out.trim()).toContain('page.html');
    expect(html).toContain('Code Defect');
    expect(html).toContain('Performance');
    // **The gap keeps its sign**, because a page that printed `1` where the record says `-1` would invert the reading.
    expect(html).toContain('>-1<');
    expect(html).toContain('>0<');
    // **Both arms' credits and rates are on the bar**, so the picture cannot be read without its numbers.
    expect(html).toContain('3 · 75.0%');
    expect(html).toContain('2 · 50.0%');
  });

  it('is self-contained, so it survives being emailed', () => {
    const { html } = run();
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).not.toContain('<link');
  });

  it('refuses a version it does not know rather than reading v0 fields as undefined', () => {
    const { code, out } = run({ ...FIXTURE, version: 'aacr-category-gap-v0' });
    expect(code).toBe(2);
    expect(out).toContain('reads v1');
  });

  it('refuses rows that do not add back up to the totals they decompose', () => {
    // One credit is credited to nobody: the table would show three categories whose sum is one short of the figure the
    // section publishes, and a reader would have no way to see which number was the wrong one.
    const { code, out } = run({ ...FIXTURE, credited: { ours: 4, theirs: 2 } });
    expect(code).toBe(1);
    expect(out).toContain('do not add back up');
    expect(out).toContain('ours 3 != 4');
  });

  it('refuses a record with no categories, rather than drawing an empty table', () => {
    const { code, out } = run({ ...FIXTURE, rows: [], credited: { ours: 0, theirs: 0 }, corpus: { pullRequests: 0, goldens: 0 } });
    expect(code).toBe(2);
    expect(out).toContain('no categories');
  });

  it('draws the committed record, and the four figures §173.3 publishes are on it', () => {
    // **This is the case that ties the page to the section**: if a later run moves the arm, the record is regenerated and
    // this assertion is the place the prose and the picture disagree out loud.
    const html = readFileSync(RECORD, 'utf8');
    const record = JSON.parse(html) as {
      corpus: { pullRequests: number; goldens: number };
      credited: { ours: number; theirs: number };
      rows: { category: string; ours: number; theirs: number }[];
    };
    expect(record.corpus).toEqual({ pullRequests: 50, goldens: 452 });
    expect(record.credited).toEqual({ ours: 102, theirs: 164 });
    const row = (category: string) =>
      record.rows.find((entry) => entry.category === category) ?? { ours: -1, theirs: -1 };
    expect(row('Code Defect')).toMatchObject({ ours: 65, theirs: 96 });
    expect(row('Maintainability and Readability')).toMatchObject({ ours: 20, theirs: 45 });
    expect(row('Performance')).toMatchObject({ ours: 8, theirs: 14 });
    expect(row('Security Vulnerability')).toMatchObject({ ours: 9, theirs: 9 });

    const committed = readFileSync('docs/aacr-category-gap.html', 'utf8');
    expect(committed).toContain('Code Defect');
    expect(committed).toContain('Security Vulnerability');
  });
});
