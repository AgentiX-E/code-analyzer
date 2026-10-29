// The line ranges a statement may not run in, and the one question that needs them.
//
// **Since this project's CFG has a single block per function, every definition it records is a `may`-definition**, and
// the comment on that decision says why: nothing knows whether a statement sits inside an `if`, so treating an
// assignment as a kill would drop the value it overwrote along paths that never ran the assignment. That reasoning is
// exactly right, and it is also exactly reversible — the missing input is one bit per statement, and this module is
// that bit.
//
// A definition is a **kill** when control cannot skip it: it sits at the function's own level, so every path from the
// entry reaches it, and no path reaches it twice. Everything inside `if`, a loop, a `switch` arm, a `try` or a `catch`
// fails one of those tests — an `if` arm may not run at all, a loop body may run zero or many times — and stays a
// `may`-definition, which is the answer the code gave before this module existed.
//
// The ranges are the node's own extent, so a whole `if` statement including its condition is one range. That
// over-approximates: a definition in the condition itself does run whenever the `if` is reached, and it is treated as
// conditional here. Over-approximating costs precision in a shape nobody writes; under-approximating would make a kill
// out of a statement that can be skipped, which is a false negative.

import { walkPreOrder } from './syntax-cursor.js';

import type { CursorWalkable } from './syntax-cursor.js';

/** A range of 1-based lines whose statements may not run exactly once. */
export interface ConditionalRegion {
  readonly from: number;
  readonly to: number;
}

/**
 * Every region in the file whose statements may run zero times or more than once, in document order.
 *
 * Nested constructs produce nested ranges, and that is harmless: membership is a disjunction, so the outer range
 * already answers for the inner one. Keeping both means a caller never has to reason about containment.
 */
export function extractConditionalRegions(
  root: CursorWalkable,
  types: readonly string[],
): ConditionalRegion[] {
  if (types.length === 0) return [];
  const ranges: ConditionalRegion[] = [];
  walkPreOrder(root, (type, _depth, cursor) => {
    if (!types.includes(type)) return;
    ranges.push({ from: cursor.startPosition.row + 1, to: cursor.endPosition.row + 1 });
  });
  return ranges;
}

/**
 * Whether a line sits in any of the regions.
 *
 * `ranges` is short — one entry per branch in one function — so a scan beats sorting plus a binary search, and the
 * caller asks this question once per definition rather than once per line.
 */
export function isConditional(line: number, ranges: readonly ConditionalRegion[]): boolean {
  for (const range of ranges) if (line >= range.from && line <= range.to) return true;
  return false;
}
