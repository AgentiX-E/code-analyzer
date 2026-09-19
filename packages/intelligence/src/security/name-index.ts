// Written names to qualified names, where that can be done without guessing.
//
// The scope-resolution phase stores each call's callee as the name written at the call site. The solver resolves a
// callee by looking that string up among the functions it was given, whose keys are qualified names — so a call
// written `helper()` never matches `file:src/a.ts:helper`. That is why `resolved` is false for every call in
// practice, and it is the last thing standing between the bridge and a cross-boundary finding.
//
// The analyser already resolves calls itself, inline, and prefers **not** to resolve an ambiguous simple name:
//
//   // Fallback: global name matching (only if unambiguous)
//   // If ambiguous (simple name matches multiple), don't resolve
//   // This prevents incorrect CALLS edges
//
// This index follows the same rule, for the same reason. Taint attributed to the wrong function is worse than taint
// left unreported: the first is a false finding, and a false finding is what makes a tool untrustworthy.

import type { FunctionCfg } from '../cfg/types.js';

/**
 * Index functions by the simple name their definition carries.
 *
 * A name that more than one function answers to maps to `null`, not to whichever was seen first. `null` means
 * "ambiguous", which is different from "absent" — a distinction the caller can act on.
 */
export function buildNameIndex(
  cfgs: ReadonlyMap<string, Pick<FunctionCfg, 'functionName'>>,
): Map<string, string | null> {
  const index = new Map<string, string | null>();

  for (const [qualifiedName, cfg] of cfgs) {
    const simple = cfg.functionName;
    // `functionName` is a `string` by its type, so `typeof` would be a branch no value can take — which is what the
    // per-file coverage gate reports, and it reported it here after reporting the same shape twice before. The one
    // check that can be false is the empty name.
    if (simple.length === 0) continue;

    if (index.has(simple)) {
      // Seen before: two functions share this name, so it can no longer be resolved to either.
      index.set(simple, null);
    } else {
      index.set(simple, qualifiedName);
    }
  }

  return index;
}

/**
 * The qualified name a written callee refers to, or `null` when that cannot be known.
 *
 * A qualified name is returned as itself, which covers a callee written in full. An ambiguous simple name returns
 * `null` rather than a guess.
 */
export function resolveFunctionName(
  written: string,
  index: ReadonlyMap<string, string | null>,
  knownQualifiedNames: ReadonlySet<string>,
): string | null {
  if (knownQualifiedNames.has(written)) return written;
  return index.get(written) ?? null;
}
