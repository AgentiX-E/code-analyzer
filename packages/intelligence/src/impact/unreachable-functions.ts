// Functions nothing calls, and the reason to be careful about saying so.
//
// **The feature a competitor ships and this product did not**, and the reason it is buildable now: `CALLS` edges
// exist. **They did not until this week** - the captures were being produced by every language provider and no phase
// read them, so the edge type was in the vocabulary with zero edges on any graph. **A dead-code detector written
// before that fix would have reported every function as dead**, which is the failure mode this file is written
// against and the reason its first assertion is about the edges rather than about the findings.
//
// **What "unreachable" means here, stated narrowly because the wide reading is wrong.** A function with no incoming
// `CALLS` edge is **not necessarily dead**:
//
//   * it may be **called from outside this repository** - a published API, a CLI entry point, a framework hook
//   * it may be **called in a way this graph does not model** - reflection, a string-keyed dispatcher, a test
//   * it may be **a test's helper**, which by construction nothing in the product calls
//
// **So every finding carries the reason it is a candidate rather than a verdict**, and the callers most likely to be
// wrong are excluded by name rather than by hoping. **A tool that reports certainty it does not have is worse than
// one that reports less** - which is the same lesson the whole of this stretch has been about.

import { EDGE_CALLS } from '@code-analyzer/shared';

import type { KnowledgeGraph, NodeLabel } from '@code-analyzer/shared';

/** Why a function with no callers is a candidate rather than a certainty. */
export interface UnreachableCandidate {
  name: string;
  filePath: string;
  label: NodeLabel;
  /** The rule that matched, so a reader can disagree with it. */
  reason: string;
  /** True when the file it lives in is a test, which nothing in the product calls by construction. */
  inATest: boolean;
}

export interface UnreachableOptions {
  /**
   * Report functions in test files too.
   *
   * **Off by default.** A test file is full of functions the product never calls, and reporting them buries the
   * findings that matter. **The count is still returned** so nothing is hidden by the choice.
   */
  includeTests?: boolean;
}

export interface UnreachableReport {
  /** Functions with no incoming `CALLS` edge, after the exclusions below. */
  candidates: UnreachableCandidate[];
  /** How many were excluded for living in a test, so the exclusion is visible rather than silent. */
  excludedByTestCount: number;
  /** The total number of function-like nodes considered. */
  considered: number;
  /** **Zero here makes every candidate meaningless**, so it is reported rather than assumed. */
  callsEdgeCount: number;
}

const TEST_PATH = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test-/;

/** Entry points, which nothing calls and which are not dead. */
const ENTRY_NAMES = new Set(['main', 'index', 'start', 'bootstrap', 'handler', 'activate', 'deactivate']);

function isFunctionLike(label: NodeLabel | string): boolean {
  return /Function|Method/i.test(String(label));
}

/**
 * Functions nothing calls.
 *
 * **The first thing this checks is that the graph can answer the question at all.** `CALLS` edges were zero on every
 * graph until this week, and **a detector that reports "every function is dead" on a graph without edges is worse
 * than no detector**, because the answer looks like a finding. **So an empty edge set returns no candidates** and
 * says so in `callsEdgeCount`.
 */
export function findUnreachableFunctions(
  graph: KnowledgeGraph,
  options: UnreachableOptions = {},
): UnreachableReport {
  const called = new Set<number>();
  let callsEdgeCount = 0;
  for (const edge of graph.edges.values()) {
    if (String(edge.type) !== EDGE_CALLS) continue;
    callsEdgeCount++;
    called.add(edge.targetId);
  }

  // **The guard that makes the rest honest.** Without call edges every function looks uncalled, and a report of
  // "all of them are dead" is not a finding - it is a missing prerequisite.
  if (callsEdgeCount === 0) {
    return { candidates: [], excludedByTestCount: 0, considered: 0, callsEdgeCount: 0 };
  }

  const candidates: UnreachableCandidate[] = [];
  let excludedByTestCount = 0;
  let considered = 0;

  for (const node of graph.nodes.values()) {
    if (!isFunctionLike(node.label)) continue;
    considered++;
    if (called.has(node.id)) continue;

    const filePath = String(node.filePath ?? '');
    const name = String(node.name ?? '');
    // **An entry point is called by the runtime, not by this code**, and saying otherwise is a false positive with a
    // confident voice.
    if (ENTRY_NAMES.has(name)) continue;

    const inATest = TEST_PATH.test(filePath);
    if (inATest && !options.includeTests) {
      excludedByTestCount++;
      continue;
    }

    candidates.push({
      name,
      filePath,
      label: node.label,
      reason: inATest
        ? 'no incoming CALLS edge, and it lives in a test file where nothing in the product calls it'
        : 'no incoming CALLS edge from anywhere in this graph',
      inATest,
    });
  }

  return { candidates, excludedByTestCount, considered, callsEdgeCount };
}
