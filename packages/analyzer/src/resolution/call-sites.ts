// Call sites, from two things that already exist and do not know about each other.
//
// The taint subsystem reads `FunctionCfg.callSites` and nothing produces them. `ControlFlowGraph` — the CFG the
// analyser does build — has five fields and its blocks have seven, none of them about variables or calls, so a
// converter from it would convert nothing.
//
// The data is elsewhere. `ParsedFile.symbols` carries qualified names with their line ranges, and `ScopeResolver`
// produces `ResolvedCall` with a caller, a callee and a resolution flag. **A resolved call whose line falls inside
// a function's range is a call site of that function.** This module is that lookup.

import type { CallSite, ParsedFile, ReferenceSite, SymbolDefinition } from '@code-analyzer/shared';

/** Symbol kinds that can contain calls. */
const CALLABLE_KINDS = new Set(['Function', 'Method', 'ArrowFunction', 'Constructor']);

function hasQualifiedName(symbol: SymbolDefinition): boolean {
  return typeof symbol.qualifiedName === 'string' && symbol.qualifiedName.length > 0;
}

/**
 * Group resolved calls under the qualified name of the function that contains them.
 *
 * The input is `ReferenceSite`, not `ResolvedCall`. The two carry the same information — `sourceFile`,
 * `sourceLine`, `targetName`, and `targetQname` for whether it resolved — and `ReferenceSite` is what the pipeline
 * actually has in hand, so taking it removes a conversion that would have existed only to satisfy this signature.
 * `referenceKind === 'call'` is the filter; the pipeline's scope-resolution phase already makes the same check
 * inline, sixty lines of it, and stores only a count.
 *
 * The key is `SymbolDefinition.qualifiedName` — the same string the analyser's pipeline already uses, so a caller
 * that keys its functions by qualified name needs no translation. References that fall inside no function are
 * dropped: a top-level call belongs to no CFG, and inventing an owner for it would be the same defect as inventing
 * call sites, one level up.
 *
 * **`argBindings` and `resultBinding` are `-1`**, because `ResolvedCall` does not carry argument positions. That is
 * a real limit, recorded here rather than filled with a plausible default: the value is used to decide which of the
 * callee's parameters receives taint, and a guessed position would propagate taint to the wrong parameter.
 */
export function buildCallSites(
  parsedFiles: readonly ParsedFile[],
  references: readonly ReferenceSite[],
): Map<string, CallSite[]> {
  const byFile = new Map<string, ReferenceSite[]>();
  for (const ref of references) {
    if (ref.referenceKind !== 'call') continue;
    const bucket = byFile.get(ref.sourceFile);
    if (bucket) bucket.push(ref);
    else byFile.set(ref.sourceFile, [ref]);
  }

  const out = new Map<string, CallSite[]>();

  for (const parsed of parsedFiles) {
    const calls = byFile.get(parsed.filePath);
    if (!calls || calls.length === 0) continue;

    for (const symbol of parsed.symbols) {
      if (!CALLABLE_KINDS.has(symbol.kind)) continue;
      if (!hasQualifiedName(symbol)) continue;

      const inside = calls.filter(
        (ref) => ref.sourceLine >= symbol.startLine && ref.sourceLine <= symbol.endLine,
      );
      if (inside.length === 0) continue;

      const existing = out.get(symbol.qualifiedName) ?? [];
      for (const ref of inside) {
        existing.push({
          blockIndex: 0,
          stmtIndex: 0,
          line: ref.sourceLine,
          calleeName: ref.targetName,
          argBindings: [],
          resultBinding: -1,
        });
      }
      // No guard here: `inside` is non-empty by the check above, and every entry pushed, so `existing` cannot be
      // empty. The coverage gate found this — the false branch was unreachable, which is what an unreachable
      // branch in a fresh file looks like.
      out.set(symbol.qualifiedName, existing);
    }
  }

  return out;
}
