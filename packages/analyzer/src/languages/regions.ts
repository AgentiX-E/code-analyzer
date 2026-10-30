// The line ranges a statement occupies, and the two questions that need them.
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
//
// **The second question is the mirror of the first, and it is about where a value goes.** A statement that computes a
// value and never stores it throws it away — `map.put("k", param);`, `b.append(param);`, `log(param);` — and a walk
// carrying a tainted value cannot follow it past such a statement, because nothing in the def→use graph holds the
// result. A statement whose value *is* kept is a different thing entirely: `bar = new String(decode(encode(param)))`
// passes the value through three calls, and every one of them belongs to one statement that writes `bar`. Whether a
// statement keeps its value is therefore one bit per statement too, and it is the bit that decides whether a value
// "disappeared" or merely travelled.

import { walkPreOrder } from './syntax-cursor.js';

import type { ConstantDialect } from './constant-fold.js';
import type { CursorWalkable } from './syntax-cursor.js';

/** A range of 1-based lines, inclusive at both ends. */
export interface SourceRegion {
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
): SourceRegion[] {
  if (types.length === 0) return [];
  const ranges: SourceRegion[] = [];
  walkPreOrder(root, (type, _depth, cursor) => {
    if (!types.includes(type)) return;
    ranges.push({ from: cursor.startPosition.row + 1, to: cursor.endPosition.row + 1 });
  });
  return ranges;
}

/**
 * Every statement in the file whose value nothing keeps, in document order.
 *
 * **A statement that is not an assignment throws its value away**, and that is the whole test: a statement node whose
 * first child is one of the grammar's value-keeping productions writes that child's value somewhere, and one whose
 * first child is anything else evaluates it and drops it. `bar = map.get("k");` keeps what the call returned;
 * `map.put("k", bar);` and `b.append(bar);` keep nothing.
 *
 * **The first child is read from the walk rather than from the node.** `walkPreOrder` visits a node before its
 * children, so the visit that follows a statement one level deeper is that statement's first child — and taking it
 * that way keeps the walk free of node materialisation, which is the entire reason the cursor interface exists. A
 * statement with no children is dropped on the very next visit, which is at its own depth or above it.
 */
export function extractDiscardedValueRegions(
  root: CursorWalkable,
  dialect: ConstantDialect,
): SourceRegion[] {
  const statementTypes = dialect.expressionStatementTypes;
  if (statementTypes.length === 0) return [];
  const keeping = dialect.valueKeepingTypes;
  const ranges: SourceRegion[] = [];
  // The statement waiting to see its first child, with the range it would occupy if that child keeps nothing.
  let pending: { readonly depth: number; readonly from: number; readonly to: number } | null = null;

  walkPreOrder(root, (type, depth, cursor) => {
    if (pending !== null) {
      if (depth === pending.depth + 1 && !keeping.includes(type)) {
        ranges.push({ from: pending.from, to: pending.to });
      }
      // Either way the question is answered: a child was seen, or the statement has none. Nothing can become its first
      // child later in a pre-order walk.
      pending = null;
    }
    if (statementTypes.includes(type)) {
      pending = { depth, from: cursor.startPosition.row + 1, to: cursor.endPosition.row + 1 };
    }
  });

  return ranges;
}

/**
 * Whether a line sits in any of the regions.
 *
 * `regions` is short — one entry per branch in one function — so a scan beats sorting plus a binary search, and the
 * caller asks this question once per definition rather than once per line.
 */
export function insideRegion(line: number, regions: readonly SourceRegion[]): boolean {
  for (const region of regions) if (line >= region.from && line <= region.to) return true;
  return false;
}
