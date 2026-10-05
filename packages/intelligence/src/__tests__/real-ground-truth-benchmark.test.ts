// The flagship figure, measured on a dataset this project did not write - and the criterion that decides it.
//
// **What the first measurement said, and why it was three answers rather than one.** On a hundred real issues the
// engine scored F1 0.0021 while the internal forty-nine scored 0.761. The diagnosis was three layers:
//
//   1. `matchGroundTruth` requires `gt.category === result.category`. On a real window the ground truth is `bug` and
//      the findings are `style` and `maintainability`, so **no finding can match whatever the lines say**.
//   2. The line positions do not overlap either.
//   3. The engine does not report bugs on this code. It reports style.
//
// **This file measures layer one on its own.** The same findings, built through the same code path the runner uses,
// matched twice:
//
//   strict   file + category + line overlap     what `BenchmarkRunner` does today
//   overlap  file + line overlap                the criterion a real dataset needs
//
// **A human's patch says "these lines were wrong". It does not say which of our rule families should have caught
// them**, so category equality only holds when one author wrote both sides of the comparison - which is exactly what
// the internal fixtures have and a public dataset does not.
//
// Reporting both numbers is the point: the movement between them is caused by the criterion, and any movement after
// that is caused by the engine. **Collapsing the two would make an improvement in the criterion look like an
// improvement in the product.**

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDiff } from '../benchmark/benchmark-runner.js';
import { analyzeFileHeuristics } from '../review/heuristics.js';

const DATASET = resolve(process.cwd(), 'benchmarks/real-ground-truth/issues.json');

interface RealRange {
  filePath: string;
  startLine: number;
  endLine: number;
  category: string;
}
interface RealIssue {
  id: string;
  files: Array<{ filePath: string; beforeContent: string }>;
  groundTruth: RealRange[];
}
interface Finding {
  filePath: string;
  category: string;
  startLine: number;
  endLine: number;
}

function overlaps(a: { startLine: number; endLine: number }, b: { startLine: number; endLine: number }): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * Findings for one issue, through the runner's own path.
 *
 * **`beforeContent: ''` is load-bearing.** `runSingleCase` computes `changeType = beforeContent === '' ? 'added' :
 * 'modified'` and builds the diff from it; the path-based rules fire on the diff's lines. The window IS the changed
 * region, so it is `added`.
 */
function findingsFor(issue: RealIssue): Finding[] {
  const out: Finding[] = [];
  for (const file of issue.files) {
    const lines = file.beforeContent.split('\n');
    const diff = createDiff(file.filePath, 'added', file.beforeContent);
    for (const h of analyzeFileHeuristics(file.filePath, lines, diff)) {
      out.push({
        filePath: file.filePath,
        category: String(h.category),
        startLine: h.startLine,
        endLine: h.endLine,
      });
    }
  }
  return out;
}

/** One-to-one matching, returning the true positives and how many ground-truth entries were reached. */
function score(
  findings: Finding[],
  groundTruth: RealRange[],
  requireCategory: boolean,
): { tp: number; matched: number } {
  const used = new Set<number>();
  let tp = 0;
  for (const f of findings) {
    for (let i = 0; i < groundTruth.length; i += 1) {
      if (used.has(i)) continue;
      const gt = groundTruth[i]!;
      if (gt.filePath !== f.filePath) continue;
      if (requireCategory && gt.category !== f.category) continue;
      if (!overlaps(f, gt)) continue;
      used.add(i);
      tp += 1;
      break;
    }
  }
  return { tp, matched: used.size };
}

function prf(tp: number, fp: number, fn: number): { precision: number; recall: number; f1: number } {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const round = (x: number) => Math.round(x * 10000) / 10000;
  return { precision: round(precision), recall: round(recall), f1: round(f1) };
}

describe('the engine against real ground truth, under two criteria', () => {
  it('reports both numbers, so the criterion and the engine are not confused', () => {
    if (!existsSync(DATASET)) {
      expect(existsSync(DATASET)).toBe(false);
      return;
    }
    const data = JSON.parse(readFileSync(DATASET, 'utf8')) as { count: number; issues: RealIssue[] };

    let strictTP = 0;
    let overlapTP = 0;
    let findings = 0;
    let gtTotal = 0;
    let reachedStrict = 0;
    let reachedOverlap = 0;
    const engineCategories = new Map<string, number>();
    const gtCategories = new Map<string, number>();

    for (const issue of data.issues) {
      const f = findingsFor(issue);
      findings += f.length;
      gtTotal += issue.groundTruth.length;
      for (const x of f) engineCategories.set(x.category, (engineCategories.get(x.category) ?? 0) + 1);
      for (const g of issue.groundTruth) gtCategories.set(g.category, (gtCategories.get(g.category) ?? 0) + 1);
      const strict = score(f, issue.groundTruth, true);
      const loose = score(f, issue.groundTruth, false);
      strictTP += strict.tp;
      reachedStrict += strict.matched;
      overlapTP += loose.tp;
      reachedOverlap += loose.matched;
    }

    const strict = prf(strictTP, findings - strictTP, gtTotal - reachedStrict);
    const overlap = prf(overlapTP, findings - overlapTP, gtTotal - reachedOverlap);

    // Two lines, greppable, each carrying its population - a figure without its denominator is not a measurement.
    // eslint-disable-next-line no-console
    console.log(
      `REAL-F1 strict ${strict.f1} (p ${strict.precision} r ${strict.recall}) ` +
        `| overlap ${overlap.f1} (p ${overlap.precision} r ${overlap.recall}) ` +
        `| ${data.count} issues, ${findings} findings, ${gtTotal} ground-truth ranges`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `REAL-F1 engine categories ${[...engineCategories].map(([k, v]) => `${k}=${v}`).join(' ')} ` +
        `| ground truth ${[...gtCategories].map(([k, v]) => `${k}=${v}`).join(' ')}`,
    );

    expect(data.count).toBe(data.issues.length);
    expect(findings).toBeGreaterThan(0);
    expect(gtTotal).toBeGreaterThan(0);
    for (const m of [strict, overlap]) {
      for (const v of [m.precision, m.recall, m.f1]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // **Dropping the category requirement can only ever match more**, so this is an invariant rather than an
    // expectation: if overlap ever scores below strict, the matching is wrong.
    expect(overlapTP).toBeGreaterThanOrEqual(strictTP);
  }, 180_000);

  it('keeps every case traceable to a public commit', () => {
    if (!existsSync(DATASET)) return;
    const data = JSON.parse(readFileSync(DATASET, 'utf8')) as { issues: RealIssue[] };
    for (const issue of data.issues) expect(issue.id).toMatch(/^real-/);
  });
});
