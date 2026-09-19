// The far side of the bridge: `FunctionCfg`s built from what the analyser actually has.
//
// Nothing in production constructed one. Every `FunctionCfg` in this repository came from a test fixture, which is
// why a 2,800-line subsystem — the propagator, the reaching-definitions analysis, the PDG builder, the pipeline and
// the solver — had never run on real input.
//
// This builds one per callable symbol: its name, file, line range, and the call sites computed from the resolved
// references. **Its `stmtFacts` is empty.** That is the honest state, not a placeholder to be filled later:

// - `defs` and `uses` need statement-level analysis over `ParsedFile.ast`, which is `unknown` and would need
//   per-language handling. That is a project, not a bridge, and it is recorded as such in the audit.
// - `sourceSites` and `sinkSites` need a source-and-sink model per language.
//
// So the propagator will find no flows through these yet. What becomes true is that `buildFunctionSummary` receives
// real functions with real call sites, and `resolved` becomes a question with an answer.

import type { FunctionCfg } from './types.js';
import type { CallSite, ParsedFile, SymbolDefinition } from '@code-analyzer/shared';

/** Symbol kinds that become a function CFG. Shared with the call-site builder by intent, not by import. */
const CALLABLE_KINDS = new Set(['Function', 'Method', 'ArrowFunction', 'Constructor']);

/**
 * Build one `FunctionCfg` per callable symbol, keyed by qualified name.
 *
 * @param parsedFiles the parsed files, whose symbols give names and line ranges
 * @param callSites call sites keyed by the same qualified names, from `buildCallSites`
 */
export function buildFunctionCfgs(
  parsedFiles: readonly ParsedFile[],
  callSites: ReadonlyMap<string, CallSite[]>,
): Map<string, FunctionCfg> {
  const out = new Map<string, FunctionCfg>();

  for (const parsed of parsedFiles) {
    for (const symbol of parsed.symbols) {
      if (!CALLABLE_KINDS.has(symbol.kind)) continue;
      if (typeof symbol.qualifiedName !== 'string' || symbol.qualifiedName.length === 0) continue;

      const endLine = Math.max(symbol.endLine, symbol.startLine);
      out.set(symbol.qualifiedName, {
        functionName: symbol.name,
        filePath: parsed.filePath,
        startLine: symbol.startLine,
        startColumn: 0,
        // One block spanning the function: without a statement map there is nothing else to say about its shape.
        blocks: [
          {
            index: 0,
            startLine: symbol.startLine,
            endLine,
            statementCount: endLine - symbol.startLine + 1,
            isEntry: true,
            isExit: true,
          },
        ],
        edges: [],
        // Parameters are not in `SymbolDefinition`, so there are none. Recorded rather than guessed: a binding
        // index that does not exist would send taint to the wrong parameter.
        bindings: [],
        stmtFacts: {
          defs: new Map(),
          uses: new Map(),
          sourceSites: new Map(),
          sinkSites: new Map(),
          sanitizerSites: new Map(),
        },
        entryIndex: 0,
        exitIndex: 0,
        callSites: callSites.get(symbol.qualifiedName) ?? [],
      });
    }
  }

  return out;
}

/** Whether a symbol becomes a CFG, so a caller can filter without duplicating the set. */
export function isCallableSymbol(symbol: SymbolDefinition): boolean {
  return CALLABLE_KINDS.has(symbol.kind);
}
