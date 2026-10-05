// The matching criterion and the metric arithmetic, in one place because two harnesses now score the same dataset.
//
// **Why this is its own module.** The syntax-decidable engine and the semantic path are two different producers of
// findings, and they have to be scored by the same rule for their numbers to be comparable. Two copies of a
// three-line overlap test would agree today and would not necessarily agree after one of them is edited - which is
// the same defect as a second implementation of "how a case becomes findings", one level down.

export interface Range {
  filePath: string;
  startLine: number;
  endLine: number;
  category?: string;
}

export interface Metrics {
  precision: number;
  recall: number;
  f1: number;
}

/** Two ranges meet when they share at least one line of the same file. */
export function overlaps(a: Range, b: Range): boolean {
  return a.filePath === b.filePath && a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * One-to-one matching of findings against ground truth.
 *
 * **`requireCategory` is the whole difference between the two figures this dataset produces.** The runner's criterion
 * requires our category vocabulary to equal the human's, and on real code those vocabularies do not meet; the
 * criterion that a public dataset needs is the file and the lines, with the category reported beside it as a
 * breakdown rather than used as a gate. Keeping both here is what lets a harness print them side by side.
 */
export function score(
  findings: Range[],
  groundTruth: Range[],
  requireCategory = false,
): { tp: number; matched: number } {
  const used = new Set<number>();
  let tp = 0;
  for (const f of findings) {
    for (let i = 0; i < groundTruth.length; i += 1) {
      if (used.has(i)) continue;
      const gt = groundTruth[i]!;
      if (requireCategory && gt.category !== f.category) continue;
      if (!overlaps(f, gt)) continue;
      used.add(i);
      tp += 1;
      break;
    }
  }
  return { tp, matched: used.size };
}

export function prf(tp: number, fp: number, fn: number): Metrics {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const round = (x: number) => Math.round(x * 10000) / 10000;
  return { precision: round(precision), recall: round(recall), f1: round(f1) };
}

/** The metric a set of findings earns against a set of ground truth, under either criterion. */
export function measure(findings: Range[], groundTruth: Range[], requireCategory = false): Metrics {
  const { tp, matched } = score(findings, groundTruth, requireCategory);
  return prf(tp, findings.length - tp, groundTruth.length - matched);
}
