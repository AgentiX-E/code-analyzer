// One pass over a file, for the three questions taint analysis asks of it.
//
// **A file used to be traversed three times**: once for sources, once for sinks, once for neutralisers. Each traversal
// materialised every node in the tree - the binding builds a JS object per node from a 24-byte native record - and
// measured on this repository's own TypeScript the three of them were **23 % of a full index**, more than the parser
// they were asking about.
//
// **The three questions are the same two node shapes.** A source is a member read or a call, a sink is a call, a
// neutraliser is a member or a call; the tree does not change between them. So the traversal is done once, over the
// cursor, and each candidate is handed to whichever of the three collects it.
//
// **Nothing is materialised.** The cursor reports `nodeType`, `nodeText` and `startPosition` as plain values, so a node
// the rules do not name costs one string comparison and nothing else - which is most of the tree.

import { walkPreOrder } from './syntax-cursor.js';

import type { CursorWalkable } from './syntax-cursor.js';
import type { TaintSanitizer, TaintSink, TaintSource } from './tree-sitter-base.js';

/**
 * The three answers a taint pass produces.
 *
 * **One return value, because there is one traversal.** Asking for a source used to cost a walk, and asking for a sink
 * bought the same walk again; they are produced together now, and a caller reads the ones it wanted.
 */
export interface TaintCollections {
  readonly sources: TaintSource[];
  readonly sinks: TaintSink[];
  readonly sanitizers: TaintSanitizer[];
}

/**
 * A candidate expression, as the collector sees it.
 *
 * **Text and line, not a node.** Every rule in the taint vocabulary is a question about the expression's text -
 * `sourceFor`, `sinkFor`, `sanitizerFor` and `argumentsOf` all take a string - so a node would be an object the
 * collector immediately discards, obtained at the cost of marshalling it.
 */
export interface TaintSite {
  readonly type: string;
  readonly text: string;
  /** The line the expression starts on, 1-based. */
  readonly line: number;
  /**
   * The line of the outermost expression this one is nested inside, 1-based.
   *
   * **A neutraliser is filed where its statement is filed, not where its own name is.**
   * `response.getWriter()\n  .println(\n    "value: " + ESCAPE.encode(param))` is one statement: the sink and the
   * tainted use of `param` are filed on its first line, and the encoder is two lines below. Keyed by its own line the
   * encoder neutralised a statement that held neither the use nor the sink, so a flow the code had already made safe
   * stayed live - **measured, see `benchmarks/owasp-benchmark.json`**.
   */
  readonly statementLine: number;
}

/** The two node shapes the vocabulary can name, and what to do with each. */
export interface TaintScanRules {
  /** Node types denoting `a.b` - a member or attribute read. */
  readonly memberTypes: readonly string[];
  /** Node types denoting a call. */
  readonly callTypes: readonly string[];
  onMember(site: TaintSite): void;
  onCall(site: TaintSite): void;
}

/**
 * Hand every member read and every call in the tree to the rules, once each, in source order.
 *
 * **Source order is load-bearing on the sink side**: a chained call arrives outer-first, so
 * `require('node:child_process').execSync(cmd)` visits `execSync(cmd)` before `require(...)`, and the collector drops
 * the inner one because the outer is already recorded. A post-order walk would report the wrong callee.
 *
 * **The statement line is tracked by depth, not by a second climb.** An expression's statement is the outermost
 * expression above it, so entering one records its line and leaving its subtree - detected by depth - clears it. That
 * is the same rule the recursive collector carried as a parameter, made positional.
 */
export function scanTaint(root: CursorWalkable, rules: TaintScanRules): void {
  // **Sets, because these are consulted once per node.** An array scan per node over two entries is two comparisons
  // where a set is one hash, and the tree has millions of nodes.
  const members = new Set(rules.memberTypes);
  const calls = new Set(rules.callTypes);
  /** The line of the outermost expression the walk is inside, or -1 outside every one of them. */
  let statementLine = -1;
  /** The depth that expression was entered at. */
  let statementDepth = -1;

  walkPreOrder(root, (type, depth, cursor) => {
    // **Leaving is detected by depth**: the node after a subtree is at the subtree's depth or above it.
    if (statementLine >= 0 && depth <= statementDepth) statementLine = -1;

    const isMember = members.has(type);
    const isCall = calls.has(type);
    if (!isMember && !isCall) return;

    const line = cursor.startPosition.row + 1;
    const site: TaintSite = {
      type,
      text: cursor.nodeText,
      line,
      statementLine: statementLine >= 0 ? statementLine : line,
    };
    if (statementLine < 0) {
      statementLine = line;
      statementDepth = depth;
    }

    if (isMember) rules.onMember(site);
    if (isCall) rules.onCall(site);
  });
}
