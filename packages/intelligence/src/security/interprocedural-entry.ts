// The middle of the bridge: from what the analyser produced, to a taint result.
//
// Three things existed without meeting:
//
//   - `TaintPipeline.analyze(cfgs, callGraph)` — the entry point, with no caller in production
//   - `buildFunctionCfgs` — the first producer of `FunctionCfg`, added for exactly this
//   - `scope-resolution` — which now stores the call sites it derives
//
// The packages decide where this can live. `analyzer` produces the call sites but cannot see `FunctionCfg`, so it
// cannot build the CFGs. **`intelligence` depends on `analyzer`**, so it can consume what the phase stored and build
// what the pipeline reads. That is the direction the dependency graph allows, and this module is the seam.

import { buildNameIndex, resolveFunctionName } from './name-index.js';
import { TaintPipeline } from './taint-pipeline.js';
import { buildFunctionCfgs } from '../cfg/from-parsed-files.js';

import type { CallGraphEdge, InterprocTaintResult } from './interproc-solver.js';
import type { FunctionCfg } from '../cfg/types.js';
import type { CallSite, ParsedFile } from '@code-analyzer/shared';

/**
 * Edges for the solver, from the call sites on each function.
 *
 * `calleeQn` is the resolved qualified name where one exists, and the written name otherwise, because
 * `resolveCallSites` has already rewritten the call sites this reads. A name that is written in full resolves to
 * itself; a unique simple name resolves to its function; **an ambiguous or unknown one stays as written**, and the
 * solver skips it. Guessing — by suffix matching, say — would attach taint to a function the call may not reach.
 *
 * Exported so the `?? []` below can be exercised. `buildFunctionCfgs` always sets `callSites`, so within this module
 * the guard is unreachable — but `FunctionCfg.callSites` is optional, the compiler requires the check, and a test
 * that passes a CFG without it is the honest way to cover a branch the type system mandates.
 */
export function toCallGraphEdges(
  cfgs: Map<string, { callSites?: readonly CallSite[] }>,
): CallGraphEdge[] {
  const edges: CallGraphEdge[] = [];
  for (const [callerQn, cfg] of cfgs) {
    for (const call of cfg.callSites ?? []) {
      edges.push({
        callerQn,
        calleeQn: call.calleeName,
        callLine: call.line,
        argCount: call.argBindings.length,
      });
    }
  }
  return edges;
}

/**
 * Run inter-procedural taint on what the pipeline produced.
 *
 * @param parsedFiles the parsed files, from the pipeline's parse phase
 * @param callSites call sites keyed by qualified name, from the scope-resolution phase
 */
export function analyzeInterproceduralTaint(
  parsedFiles: readonly ParsedFile[],
  callSites: ReadonlyMap<string, CallSite[]>,
): InterprocTaintResult {
  const cfgs = resolveCallSites(buildFunctionCfgs(parsedFiles, callSites));
  return new TaintPipeline().analyze(cfgs, toCallGraphEdges(cfgs));
}

/**
 * Rewrite each function's call sites so the callee is a qualified name where that can be known.
 *
 * This is what makes `resolved` reachable: `buildFunctionSummary` asks `knownFunctions.has(call.calleeName)`, and
 * `knownFunctions` holds qualified names, so a callee written `helper` never matches until it is rewritten.
 *
 * An unresolvable callee is left exactly as written — **not dropped, and not matched by suffix**. A call the
 * analysis cannot place is information; a call placed wrongly is a false finding.
 */
export function resolveCallSites(cfgs: ReadonlyMap<string, FunctionCfg>): Map<string, FunctionCfg> {
  const index = buildNameIndex(cfgs);
  const knownQualifiedNames = new Set(cfgs.keys());
  const out = new Map<string, FunctionCfg>();

  for (const [qualifiedName, cfg] of cfgs) {
    const callSites = (cfg.callSites ?? []).map((call) => ({
      ...call,
      calleeName:
        resolveFunctionName(call.calleeName, index, knownQualifiedNames) ?? call.calleeName,
    }));
    out.set(qualifiedName, { ...cfg, callSites });
  }

  return out;
}
