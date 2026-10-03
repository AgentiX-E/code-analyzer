// The gate for the real ground-truth dataset.
//
// **Why a gate and not a sentence in a README.** The flagship figure of this project - PR-review F1 against a target
// of 0.68 and a competitor's 0.55 - was unpublishable for one reason: its dataset was 49 hand-written fixtures,
// below the declared minimum of 100, and not independent, because this project wrote them. A dataset that lifts that
// block has to be able to **show its own work**, and the properties that make it real are all checkable:
//
//   - every issue carries provenance naming a public commit, so a reader can check it against GitHub
//   - the line ranges say they are `authored` - read out of a human's patch - and the category says `inferred`
//   - no file path is a test, a baseline, a type declaration or a build artifact
//   - no hunk spans a rewrite, because a 69-line range is not one reviewable issue
//   - the count is reported, so the distance to `minimumGroundTruth` is a number rather than a feeling
//
// **The last one is the point of the dataset**, so the gate prints it whether or not the others pass.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DATASET = resolve(ROOT, 'benchmarks/real-ground-truth/issues.json');
const MANIFEST = resolve(ROOT, 'benchmarks/real-ground-truth/manifest.json');
const CITATIONS = resolve(ROOT, 'benchmarks/citations.json');

interface Provenance {
  repo: string;
  license: string;
  commit: string;
  commitUrl: string;
  ranges: string;
  category: string;
}
interface Issue {
  id: string;
  language: string;
  files: Array<{ filePath: string; beforeContent: string; afterContent: string }>;
  groundTruth: Array<{ filePath: string; startLine: number; endLine: number; category: string }>;
  provenance: Provenance;
}

function dataset(): { count: number; issues: Issue[] } | null {
  if (!existsSync(DATASET)) return null;
  return JSON.parse(readFileSync(DATASET, 'utf8'));
}

describe('the real ground-truth dataset', () => {
  const data = dataset();

  it('reports its distance to the declared minimum, pass or fail', () => {
    const minimum = JSON.parse(readFileSync(CITATIONS, 'utf8')).minimumGroundTruth as number;
    const count = data?.count ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `REAL-GT ${count} of ${minimum} ground-truth issues ` +
        `(${count >= minimum ? 'at or above the minimum' : `${minimum - count} short`})`,
    );
    expect(data === null || data.count === data.issues.length).toBe(true);
  });

  it('is absent or fully provenance-carrying, never partly', () => {
    if (data === null) {
      // A dataset that has not been extracted yet is a legitimate state; saying so is the point.
      expect(existsSync(MANIFEST)).toBe(true);
      return;
    }
    for (const issue of data.issues) {
      expect(issue.provenance, issue.id).toBeDefined();
      expect(issue.provenance.repo, issue.id).toMatch(/^[^/]+\/[^/]+$/);
      expect(issue.provenance.commit, issue.id).toMatch(/^[0-9a-f]{40}$/);
      expect(issue.provenance.commitUrl, issue.id).toContain(issue.provenance.commit);
      expect(issue.provenance.license, issue.id).not.toBe('');
    }
  });

  it('labels the half a human decided and the half a rule did', () => {
    if (data === null) return;
    for (const issue of data.issues) {
      // **The distinction the whole dataset rests on**: the ranges come from the author's patch, the category from
      // a regex over the message. A dataset that blurs them is claiming more authorship than it has.
      expect(issue.provenance.ranges, issue.id).toMatch(/authored/);
      expect(issue.provenance.category, issue.id).toMatch(/inferred/);
    }
  });

  it('holds production source only, by the manifest\u2019s own exclusion', () => {
    if (data === null) return;
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const excluded = new RegExp(manifest.excludedPathPattern as string);
    for (const issue of data.issues) {
      for (const file of issue.files) {
        // `/tsc/testdata/baselines/...` got through the first version of this pattern because it matched `test/`.
        expect(excluded.test(file.filePath), `${issue.id} ${file.filePath}`).toBe(false);
      }
    }
  });

  it('holds no hunk that spans a rewrite', () => {
    if (data === null) return;
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const bound = Number(manifest.maxLinesPerHunk ?? Infinity);
    for (const issue of data.issues) {
      for (const entry of issue.groundTruth) {
        const span = entry.endLine - entry.startLine + 1;
        expect(span, `${issue.id} lines ${entry.startLine}-${entry.endLine}`).toBeLessThanOrEqual(bound);
        expect(entry.startLine, issue.id).toBeGreaterThanOrEqual(1);
        expect(entry.endLine, issue.id).toBeGreaterThanOrEqual(entry.startLine);
      }
    }
  });

  it('names a file that the issue actually carries', () => {
    if (data === null) return;
    for (const issue of data.issues) {
      // **A file appears once per region of the diff**, so the pairing is (path, region) and not the path alone.
      const pairs = new Set(issue.files.map((f) => `${f.filePath}#${f.region}`));
      expect(issue.files.length, issue.id).toBeGreaterThan(0);
      for (const entry of issue.groundTruth) {
        expect(pairs.has(`${entry.filePath}#${entry.region}`), `${issue.id} ${entry.filePath}#${entry.region}`).toBe(
          true,
        );
      }
      for (const file of issue.files) {
        expect(file.beforeContent.length, issue.id).toBeGreaterThan(0);
        expect(file.beforeContent).not.toBe(file.afterContent);
      }
    }
  });

  it('has ranges that point into the before-content they came from', () => {
    if (data === null) return;
    for (const issue of data.issues) {
      const before = new Map(issue.files.map((f) => [`${f.filePath}#${f.region}`, f.beforeContent]));
      for (const entry of issue.groundTruth) {
        const lines = (before.get(`${entry.filePath}#${entry.region}`) ?? '').split('\n').length;
        // A range past the end of the file it names would be a range from a different revision.
        expect(entry.endLine, `${issue.id} ${entry.filePath}`).toBeLessThanOrEqual(lines);
      }
    }
  });
});
