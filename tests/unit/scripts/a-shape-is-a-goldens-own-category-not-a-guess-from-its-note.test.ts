import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyDefectShapes } from '../../../scripts/lib/defect-shapes.mjs';

const PINNED = 'benchmarks/aacr-bench-pinned-50.json';
const CORPUS = '/tmp/aacr/dataset/v1/positive_samples.json';
function pinnedData() {
  return existsSync(PINNED) && existsSync(CORPUS)
    ? {
        artifact: JSON.parse(readFileSync(PINNED, 'utf8')),
        corpus: JSON.parse(readFileSync(CORPUS, 'utf8')),
      }
    : null;
}
const pinned = pinnedData();

/**
 * **A shape is a property of a golden the corpus has already categorised, not a guess from the words in its note.**
 *
 * §178.3 published a four-shape table as a partition of the 209 `Code Defect` goldens. It was computed by keyword over
 * every one of the 452 `missedGoldens.records`, without first joining the corpus's own `category`. The table therefore
 * counted `Maintainability and Readability` notes ("typo in variable name", "use std::ranges::find_if for clarity") as
 * `Code Defect` misses. This module makes the join that table skipped, and refuses a partition whose rows do not add up.
 */

const note = (text: string) => ({
  pr: 'https://github.com/o/r/pull/1',
  goldenIndex: 0,
  bucket: 'findingOnPathRejected',
  path: 'src/a.ts',
  note: text,
  proximity: 0,
  matchedFindings: [],
  nearestFinding: null,
});

function fixture() {
  const corpus = [
    {
      githubPrUrl: 'https://github.com/o/r/pull/1',
      comments: [
        { category: 'Code Defect', body: 'error path' },
        { category: 'Maintainability and Readability', body: 'a typo' },
      ],
    },
  ];
  const records = [
    { ...note('an error path left unhandled'), goldenIndex: 0 },
    { ...note('the variable name has a typo'), goldenIndex: 1 },
  ];
  return { artifact: { missedGoldens: { records } }, corpus };
}

describe('defect shapes are a golden category, not a keyword over every note', () => {
  it('refuses to count a Maintainability note as a Code Defect shape', () => {
    const { artifact, corpus } = fixture();
    const out = classifyDefectShapes({ artifact, corpus });
    // Only goldenIndex 0 is Code Defect. The "typo" note (index 1) must not appear in any shape bucket.
    expect(out.codeDefect.total).toBe(1);
    expect(out.codeDefect.shapes.error_path.miss).toBe(1);
    expect(JSON.stringify(out.codeDefect.shapes)).not.toContain('typo');
  });

  it('reports the contamination the unfiltered table would have added', () => {
    const { artifact, corpus } = fixture();
    const out = classifyDefectShapes({ artifact, corpus });
    // One of the two records was not Code Defect; the old table counted it.
    expect(out.contamination).toBe(1);
    expect(out.allRecords).toBe(2);
  });

  it('refuses a partition whose shape rows do not add back up', () => {
    const { artifact, corpus } = fixture();
    const out = classifyDefectShapes({ artifact, corpus });
    expect(out.codeDefect.reconciled).toBe(true);
    expect(out.codeDefect.rejected).toBe(1);
  });

  it('leaves a golden with no matching keyword unclassified rather than inventing a shape', () => {
    const { artifact, corpus } = fixture();
    artifact.missedGoldens.records[0]!.note = 'a refactor that reads cleanly';
    const out = classifyDefectShapes({ artifact, corpus });
    expect(out.codeDefect.none).toBe(1);
    expect(out.codeDefect.shapes.error_path.miss).toBe(0);
  });

  it.skipIf(pinned === null)('reproduces the pinned board without the §178.3 contamination', () => {
    const data: { artifact: unknown; corpus: unknown } = pinned!;
    const out = classifyDefectShapes(data);
    // The corpus publishes 209 Code Defect goldens; the old table poured all 452 records into its shapes.
    expect(out.allRecords).toBe(452);
    expect(out.codeDefect.total).toBe(209);
    expect(out.codeDefect.rejected).toBe(83);
    expect(out.contamination).toBe(243);
    expect(out.codeDefect.reconciled).toBe(true);
  });

  it('the committed record matches a fresh reading of the pinned board', () => {
    if (pinned === null) return;
    const record = JSON.parse(readFileSync('benchmarks/defect-shapes-pinned-50.json', 'utf8'));
    const data: { artifact: unknown; corpus: unknown } = pinned!;
    const fresh = classifyDefectShapes(data);
    expect(record.codeDefect.total).toBe(fresh.codeDefect.total);
    expect(record.codeDefect.rejected).toBe(fresh.codeDefect.rejected);
    expect(record.contamination).toBe(fresh.contamination);
    expect(record.codeDefect.reconciled).toBe(true);
    // No script, no network: the page is one file a reader can open and quote.
    const page = readFileSync('docs/defect-shapes.html', 'utf8');
    expect(page).not.toContain('<script');
    expect(page).toContain('243 of 452');
  });
});
