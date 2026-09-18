// Call sites, from two things that already exist and do not know about each other.
//
// The taint subsystem reads `FunctionCfg.callSites` and nothing produces them. `ControlFlowGraph` — the CFG the
// analyser does build — has five fields and its blocks have seven, none of them about variables or calls, so a
// converter from it would convert nothing.
//
// The data is elsewhere. `ParsedFile.symbols` carries qualified names with their line ranges, and `ScopeResolver`
// produces `ResolvedCall` with a caller, a callee and a resolution flag. **A resolved call whose line falls inside
// a function's range is a call site of that function.** This module is that lookup.

import type { CallSite, ParsedFile, SymbolDefinition } from '@code-analyzer/shared';
import type { ResolvedCall } from './scope-resolver.js';

/** Symbol kinds that can contain calls. */
const CALLABLE_KINDS = new Set(['Function', 'Method', 'ArrowFunction', 'Constructor']);

function hasQualifiedName(symbol: SymbolDefinition): boolean {
  return typeof symbol.qualifiedName === 'string' && symbol.qualifiedName.length > 0;
}

/**
 * Group resolved calls under the qualified name of the function that contains them.
 *
 * The key is `SymbolDefinition.qualifiedName` — the same string the analyser's pipeline already uses, so a caller
 * that keys its functions by qualified name needs no translation. Calls that fall inside no function are dropped:
 * a top-level call belongs to no CFG, and inventing an owner for it would be the same defect as inventing call
 * sites, one level up.
 *
 * **`argBindings` and `resultBinding` are `-1`**, because `ResolvedCall` does not carry argument positions. That is
 * a real limit, recorded here rather than filled with a plausible default: the value is used to decide which of the
 * callee's parameters receives taint, and a guessed position would propagate taint to the wrong parameter.
 */
export function buildCallSites(
  parsedFiles: readonly ParsedFile[],
  resolvedCalls: readonly ResolvedCall[],
): Map<string, CallSite[]> {
  const byFile = new Map<string, ResolvedCall[]>();
  for (const call of resolvedCalls) {
    const bucket = byFile.get(call.sourceFile);
    if (bucket) bucket.push(call);
    else byFile.set(call.sourceFile, [call]);
  }

  const out = new Map<string, CallSite[]>();

  for (const parsed of parsedFiles) {
    const calls = byFile.get(parsed.filePath);
    if (!calls || calls.length === 0) continue;

    for (const symbol of parsed.symbols) {
      if (!CALLABLE_KINDS.has(symbol.kind)) continue;
      if (!hasQualifiedName(symbol)) continue;

      const inside = calls.filter(
        (call) => call.sourceLine >= symbol.startLine && call.sourceLine <= symbol.endLine,
      );
      if (inside.length === 0) continue;

      const existing = out.get(symbol.qualifiedName) ?? [];
      for (const call of inside) {
        if (call.calleeName === null) continue;
        existing.push({
          blockIndex: 0,
          stmtIndex: 0,
          line: call.sourceLine,
          calleeName: call.calleeName,
          argBindings: [],
          resultBinding: -1,
        });
      }
      if (existing.length > 0) out.set(symbol.qualifiedName, existing);
    }
  }

  return out;
}
