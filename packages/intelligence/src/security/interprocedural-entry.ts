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

import { TaintPipeline } from './taint-pipeline.js';
import { buildFunctionCfgs } from '../cfg/from-parsed-files.js';

import type { CallGraphEdge, InterprocTaintResult } from './interproc-solver.js';
import type { CallSite, ParsedFile } from '@code-analyzer/shared';

/**
 * Edges for the solver, from the call sites on each function.
 *
 * `calleeQn` is set from the name written at the call site, which is not necessarily a qualified name. The solver
 * resolves a callee by looking its name up among the functions it was given, so an edge whose name is written
 * bare will not resolve until something maps names to qualified names. **That mapping does not exist yet**, and
 * inventing one here — by suffix matching, say — would silently attach taint to the wrong function. The edge is
 * built with the name it has and left unresolved, which is visible.
 */
function toCallGraphEdges(cfgs: Map<string, { callSites?: readonly CallSite[] }>): CallGraphEdge[] {
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
  const cfgs = buildFunctionCfgs(parsedFiles, callSites);
  return new TaintPipeline().analyze(cfgs, toCallGraphEdges(cfgs));
}
