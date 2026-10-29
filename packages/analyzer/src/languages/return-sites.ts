// The lines a file hands a value back to its caller from.
//
// **Nothing in this repository recorded a `return` statement before this module's consumer existed.** Every provider
// captured declarations, assignments, calls, loops and catches; `return bar;` captured nothing, so the value a function
// gives back had no use site and no name could be seen leaving a function. The consequence was structural rather than
// cosmetic: `paramToReturns`, `sourceToReturns` and `callResults` in the inter-procedural summary were permanent empty
// arrays, the solver's return branch was a loop over empty data, and a caller's `bar = helper(param)` could only be
// answered by the conservative rule "the statement read a tainted name and wrote a name, so the written name is
// tainted" - which charges a caller for a call that ignores its argument.
//
// **The fact is deliberately only the lines.** What a return hands back is already a *use* once the provider records
// the returned expression's names anchored at the return's line, so a reachability analysis over def-use needs to know
// which lines are returns and nothing else. Anything richer would be a second, competing model of the same relation.

import { walkPreOrder } from './syntax-cursor.js';

import type { ConstantDialect } from './constant-fold.js';
import type { CursorWalkable } from './syntax-cursor.js';

/**
 * Every line in the tree that returns, in document order.
 *
 * A nested function's returns are included: they are returns, and the caller of this function decides by line range
 * which of them belong to which function. That division is the consumer's, because the CFG is built per symbol and only
 * it knows the symbol's extent.
 */
export function extractReturnLines(root: CursorWalkable, dialect: ConstantDialect): number[] {
  const lines: number[] = [];
  walkPreOrder(root, (type, _depth, cursor) => {
    if (!dialect.returnTypes.includes(type)) return;
    lines.push(cursor.startPosition.row + 1);
  });
  return lines;
}
