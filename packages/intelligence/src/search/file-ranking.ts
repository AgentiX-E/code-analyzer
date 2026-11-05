// @code-analyzer/intelligence — turning a ranking of declarations into a ranking of files
//
// **The unit of retrieval is a declaration and the unit of the answer is a file.** A question is matched against
// documents built out of one symbol's name, path, signature and body, because that is the granularity at which code
// says what it does; a reader who asks "where would I fix this" wants a path, and a benchmark that scores
// bug-localisation wants the set of files a commit touched. Something has to convert one into the other, and until now
// that something was ten lines inside `qa/ask.ts` that took the **first** declaration of each file it met and kept the
// order it arrived in.
//
// **First appearance is the maximum, stated as an accident.** If a file's position is the position of the earliest of
// its declarations, then a file's rank is the rank of its best declaration and nothing else about the file is read -
// not how many of its declarations matched, not how strongly the second-best one did, and not that the question is
// about a file with forty matching lines rather than one with a matching name. On the Long Code Arena corpus the
// consequence is visible in the rows: on `spring-cloud/spring-cloud-consul` the answer sits one place below a file
// whose single configuration class matched the question's words slightly harder, and the search list contained both.
//
// **So the aggregation is a parameter, and the alternatives are measured rather than argued.** `max` reproduces the old
// ordering exactly - it is the control inside the armature, and a bug in the wiring shows up as an arm that does not
// agree with the shipped column. `sum` is the file, read as the union of its declarations; `top2` and `top3` are that
// union with the long tail dropped, because a vendored directory is a file with two hundred declarations and a sum
// over all of them is a score for being large. `count` throws the magnitudes away and reads only breadth: how many of
// a file's declarations the question reached at all.
//
// **Every one of them is a pure function of the pool**, and every one of them keeps the pool's own order as the final
// tie-break. A ranking that depended on anything else would be a ranking that moved between two runs of the same
// corpus, which is the defect iteration 73 removed from the fusion step and is not reintroduced here.

/** One candidate file, with the score the retrieval stage gave the declaration that produced it. */
export interface PoolEntry {
  readonly filePath: string;
  readonly score: number;
}

/** A file's position, and what that position was computed from. */
export interface RankedFile {
  readonly filePath: string;
  /** The aggregated figure the order is read from. **Its unit depends on the aggregation and is not comparable across them.** */
  readonly score: number;
  /** How many of the file's declarations contributed to that figure. */
  readonly contributors: number;
}

/**
 * How a file's score is read off the declarations that live in it.
 *
 * * `max` — the best declaration, which is what first appearance always meant.
 * * `sum` — every declaration, so the file is scored as the union of its parts.
 * * `top2`, `top3` — the best two or three, so a file is not rewarded for having a thousand declarations.
 * * `count` — how many declarations matched at all, magnitudes ignored.
 * * `blend25`, `blend50`, `blend75` — the best declaration plus a fraction of the second. **A one-parameter family
 *   whose ends are `max` (0) and `top2` (1)**, so its response curve answers a question no single arm can: whether a
 *   second declaration is evidence in proportion to how much of it you count, or whether one arm happened to fit.
 */
export type FileAggregation =
  'max' | 'sum' | 'top2' | 'top3' | 'count' | 'blend25' | 'blend50' | 'blend75';

/**
 * Every aggregation, in the order they are published.
 *
 * **`max` is first because it is the shipped one and the control for the rest.** An armature whose control is not
 * bit-identical to the product measures the difference between the product and a second implementation of the product,
 * which is not the question anybody asked.
 */
export const FILE_AGGREGATIONS: readonly FileAggregation[] = [
  'max',
  'sum',
  'top2',
  'top3',
  'count',
  'blend25',
  'blend50',
  'blend75',
];

/** The aggregation the product ships. **A constant rather than a literal, so the armature can say what it compared against.** */
export const FILE_AGGREGATION: FileAggregation = 'max';

/** How many declarations each aggregation reads. `max` reads one, `sum` and `count` read all of them. */
function depthOf(aggregation: FileAggregation): number | null {
  switch (aggregation) {
    case 'max':
      return 1;
    case 'top2':
    case 'blend25':
    case 'blend50':
    case 'blend75':
      return 2;
    case 'top3':
      return 3;
    case 'sum':
    case 'count':
      return null;
  }
}

/** How much of the second declaration each blend counts. **The family's parameter, and the only number it has.** */
function blendOf(aggregation: FileAggregation): number {
  switch (aggregation) {
    case 'blend25':
      return 0.25;
    case 'blend50':
      return 0.5;
    case 'blend75':
      return 0.75;
    default:
      return 0;
  }
}

/** The aggregated figure for one file's declarations, given in descending score order. */
function aggregateOf(scores: readonly number[], aggregation: FileAggregation): number {
  if (aggregation === 'count') return scores.length;
  const weight = blendOf(aggregation);
  if (weight > 0) return scores[0]! + weight * (scores[1] ?? 0);
  const depth = depthOf(aggregation);
  const read = depth === null ? scores : scores.slice(0, depth);
  return read.reduce((sum, score) => sum + score, 0);
}

/**
 * Rank the files a pool of scored declarations came from.
 *
 * **The pool's order is the tie-break and it is the only one.** Ties are common - four declarations with the same
 * cosine, two files whose best match scored the same - and the order among them has to come from the evidence rather
 * than from a node id, which is insertion order. The pool arrives in rank order, so "the file whose best declaration
 * came first" is a fact about the search rather than about the run, and it stays the answer here.
 */
export function rankFiles(
  pool: readonly PoolEntry[],
  aggregation: FileAggregation = FILE_AGGREGATION,
): RankedFile[] {
  const grouped = new Map<string, { scores: number[]; order: number }>();
  for (const entry of pool) {
    const existing = grouped.get(entry.filePath);
    if (existing === undefined) {
      grouped.set(entry.filePath, { scores: [entry.score], order: grouped.size });
      continue;
    }
    // **Descending within the file as well**, because `top2` and `top3` read the best ones and the pool is only
    // guaranteed to be ordered overall - a caller that fused two lists can hand over a file's declarations in any
    // order, and the aggregate must not depend on which.
    existing.scores.push(entry.score);
  }

  const files: Array<{ filePath: string; score: number; contributors: number; order: number }> = [];
  for (const [filePath, group] of grouped) {
    const scores = [...group.scores].sort((left, right) => right - left);
    files.push({
      filePath,
      score: aggregateOf(scores, aggregation),
      contributors: scores.length,
      order: group.order,
    });
  }

  files.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.order - right.order;
  });

  return files.map(({ filePath, score, contributors }) => ({ filePath, score, contributors }));
}
