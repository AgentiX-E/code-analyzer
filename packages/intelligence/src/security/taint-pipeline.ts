// @code-analyzer/intelligence — Inter-Procedural Taint Pipeline
// Connects the intra-procedural TaintPropagator to the InterprocSolver
// via FunctionSummary and CallGraphEdge conversion.
//
// This is the missing link that makes inter-procedural taint analysis
// actually work end-to-end.

import {
  InterprocSolver,
  type FunctionSummary,
  type CallGraphEdge,
  type InterprocTaintResult,
  InterprocTaintFinding,
} from './interproc-solver.js';
import { TaintPropagator } from './taint-propagator.js';
import { computeReachingDefinitions } from '../cfg/reaching-defs.js';

import type { FunctionCfg, TaintFunctionResult } from '../cfg/types.js';

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run end-to-end inter-procedural taint analysis across multiple functions.
 *
 * 1. For each function CFG, runs TaintPropagator (intra-procedural)
 * 2. Converts intra-proc findings to FunctionSummary
 * 3. Builds call graph from CFG edges (CALLS relationships)
 * 4. Feeds summaries + call graph to InterprocSolver
 * 5. Returns combined intra-proc + inter-proc findings
 */
export class TaintPipeline {
  private propagator: TaintPropagator;
  private solver: InterprocSolver;

  constructor() {
    this.propagator = new TaintPropagator();
    this.solver = new InterprocSolver();
  }

  /**
   * Analyze a set of CFGs with full inter-procedural taint tracking.
   *
   * @param cfgs - Map of function qualified name → FunctionCfg
   * @param callGraph - Call graph edges (caller → callee)
   * @returns Combined inter-procedural taint analysis result
   */
  analyze(cfgs: Map<string, FunctionCfg>, callGraph: CallGraphEdge[]): InterprocTaintResult {
    const summaries: FunctionSummary[] = [];
    // The names a callee can be resolved against. Computed once rather than per summary.
    const knownFunctions = new Set(cfgs.keys());
    // Findings the propagator produced inside a function. They were computed, used to build summaries, and then left
    // out of the result — the comment below said "Merge and return" while the code returned the solver's result
    // alone. These are the findings a caller can act on, so they belong in the result.
    const intraProcFindings: InterprocTaintFinding[] = [];
    // Step 1: Run intra-procedural analysis on each function
    for (const [fnQn, cfg] of cfgs) {
      try {
        // Def-use facts from the reaching-definitions analysis, which is what the TODO here asked for. Without
        // them the propagator found nothing, every summary it built was empty, and the solver below had nothing to
        // solve — a subsystem that looked complete from every angle except its input.
        const result = this.propagator.analyze(cfg, computeReachingDefinitions(cfg));
        const summary = buildFunctionSummary(fnQn, cfg, result, knownFunctions);
        summaries.push(summary);

        // One flow inside one function: source and sink in the same place, no call chain to cross.
        for (const finding of result.findings) {
          intraProcFindings.push({
            id: `${fnQn}#${finding.id}`,
            source: finding.source,
            sink: finding.sink,
            sourceFn: fnQn,
            sinkFn: fnQn,
            callChain: [fnQn],
            sanitized: finding.sanitized,
            neutralizedKinds: [],
            // No call was crossed, so there are no hops to count beyond reaching the sink, and the propagator's own
            // confidence is used unchanged.
            hops: finding.hops,
            confidence: finding.confidence,
          });
        }
      } catch {
        // Skip functions that fail intra-procedural analysis
        summaries.push(emptySummary(fnQn, cfg));
      }
    }

    // Step 3: Load summaries and the call graph into the solver. `loadCallGraph` existed and was never called:
    // the parameter was named `_callGraph`, and `solve()` builds its reverse callee→caller index from the edges
    // loaded here. A summary naming a callee the solver cannot resolve is skipped by `if (!s2c.resolved) continue`.
    this.solver.loadSummaries(summaries);
    this.solver.loadCallGraph(callGraph);

    // Step 4: Run inter-procedural fixpoint
    const interProcResult = this.solver.solve();

    // Step 5: Merge and return — the merge the comment named and the code did not do. Intra-procedural findings come
    // first, because they are the ones a reader can act on without following a call.
    return {
      ...interProcResult,
      findings: [...intraProcFindings, ...interProcResult.findings],
      stats: { ...interProcResult.stats, intraProcFindings: intraProcFindings.length },
    };
  }
}

// ---------------------------------------------------------------------------
// FunctionSummary Builder
// ---------------------------------------------------------------------------

/**
 * Build a FunctionSummary from TaintPropagator results.
 *
 * Maps intra-procedural taint findings to the summary format expected
 * by InterprocSolver:
 *   - source→sink flows → paramToSinks + sourceToCallArgs
 *   - def→use chains → paramToReturns + paramToCallArgs (TITO)
 */

function emptySummary(fnQn: string, cfg: FunctionCfg): FunctionSummary {
  return {
    fnQn,
    fnName: cfg.functionName,
    paramCount: 0,
    paramToSinks: [],
    sourceToCallArgs: [],
    paramToCallArgs: [],
    sourceToReturns: [],
    callResults: [],
    paramToReturns: [],
    sourceFile: cfg.filePath,
  };
}

function buildFunctionSummary(
  fnQn: string,
  cfg: FunctionCfg,
  result: TaintFunctionResult,
  knownFunctions: ReadonlySet<string>,
): FunctionSummary {
  const fnName = cfg.functionName;
  const paramCount = cfg.bindings.filter((b) => b.kind === 'param').length;

  const paramToSinks: FunctionSummary['paramToSinks'] = [];
  const sourceToCallArgs: FunctionSummary['sourceToCallArgs'] = [];
  const paramToCallArgs: FunctionSummary['paramToCallArgs'] = [];
  const sourceToReturns: FunctionSummary['sourceToReturns'] = [];
  const paramToReturns: FunctionSummary['paramToReturns'] = [];
  const callResults: FunctionSummary['callResults'] = [];

  // `findings` is a required array on TaintFunctionResult (the propagator always
  // returns one, empty when there are no sources), so iterating directly is
  // safe — a `for..of` over an empty array is a no-op. The previous truthiness
  // guard tested a state the type system already excludes.
  for (const finding of result.findings) {
    const source = finding.source;
    const sink = finding.sink;

    // **Nothing** - see the seeding loop below for where the seeds actually come from.

    // Source → Sink flow
    if (source.category === 'source') {
      // Check if this is source→callArg (seed for fixpoint)
      // or source→sink (intra-proc finding)
      if (sink.kind !== 'source') {
        paramToSinks.push({
          param: 0, // Simplified: map to first param
          sinkLine: sink.point.line,
          sink,
          hops: finding.hops,
        });
      }
    }
  }

  // **The sink side of the same join.** A taint wave arrives at this function as *parameter N*, and the sink that
  // should match it receives that parameter as an argument - so a sink whose argument is a parameter's binding
  // belongs in `paramToSinks`. It used to be built only from `result.findings`, which needs the function to hold a
  // source of its own; `inner` in the cross-function shape holds the sink and no source, so nothing was ever pushed
  // and the wave arrived to find no sinks at all.
  for (const [sinkStmtIndex, sinkOccurrence] of cfg.stmtFacts.sinkSites) {
    for (const call of cfg.callSites ?? []) {
      if (call.line !== sinkOccurrence.point.line) continue;
      for (const bindingIdx of call.argBindings) {
        const param = (cfg.parameterBindings ?? []).indexOf(bindingIdx);
        if (param < 0) continue;
        paramToSinks.push({
          param,
          sinkLine: sinkOccurrence.point.line,
          sink: sinkOccurrence,
          hops: 1,
        });
      }
    }
    void sinkStmtIndex;
  }

  // TITO seeds, from the function's **sources** and its **call sites**.
  //
  // This loop used to live inside the findings loop above, which made a seed depend on the function already having a
  // finding of its own. **The caller in the cross-function case has no sink** - `handler` reads a source and passes it
  // to `inner`, which holds the sink - so the loop body never ran, no seed was produced, and the interprocedural join
  // had nothing to start from. That is why the cross-function shape reached zero while the call graph was built and
  // resolved.
  //
  // The seed is a source bound to a definition and passed as an argument: the source is in `stmtFacts.sourceSites`,
  // its binding is the def at the same statement, and the position is where that binding appears among the call's
  // arguments.
  //
  // `argBindings[i]` is the binding passed at argument `i`; a binding is passed at exactly one position, so its index
  // is that position. Hardcoding 0 was the mistake `CallSite.argBindings` documents: an empty array means the
  // positions are not known, and treating that as "first argument" is the one thing it forbids.
  for (const [stmtIndex, occurrence] of cfg.stmtFacts.sourceSites) {
    const bindingIdx = occurrence.bindingIdx;
    if (bindingIdx === undefined) continue;

    for (const call of cfg.callSites ?? []) {
      const flat = call.argBindings.indexOf(bindingIdx);
      if (flat < 0) continue;
      // **The argument, which is what the callee has a parameter for.** `argBindings` is flat, so a template
      // literal's second substitution sits at a position the callee does not have; `argArguments` says which
      // argument that position belongs to.
      const argIndex = call.argArguments?.[flat] ?? flat;
      sourceToCallArgs.push({
        source: occurrence,
        calleeName: call.calleeName,
        callLine: call.line,
        argIndex,
        resolved: knownFunctions.has(call.calleeName),
      });
    }
    void stmtIndex;
  }

  return {
    fnQn,
    fnName,
    paramCount: Math.max(paramCount, 1),
    paramToSinks,
    sourceToCallArgs,
    paramToCallArgs,
    sourceToReturns,
    callResults,
    paramToReturns,
    sourceFile: cfg.filePath,
  };
}

// ---------------------------------------------------------------------------
// Call Graph Builder
// ---------------------------------------------------------------------------

/**
 * Build CallGraphEdges from a map of CFGs by scanning for CALLS edges.
 * This is a heuristic: any CFG edge labeled as a call creates a caller→callee
 * relationship.
 */
export function buildCallGraph(cfgs: Map<string, FunctionCfg>): CallGraphEdge[] {
  const edges: CallGraphEdge[] = [];
  const fnNames = new Set(cfgs.keys());

  for (const [callerQn, cfg] of cfgs) {
    for (const edge of cfg.edges) {
      // CFG edges don't directly encode call targets, so we use
      // a heuristic: any block that contains a call statement
      if (edge.kind === 'seq' || edge.kind === 'cond-true') continue;

      // For each call-like edge, try to find a matching callee
      for (const calleeQn of fnNames) {
        if (calleeQn !== callerQn) {
          edges.push({
            callerQn,
            calleeQn,
            callLine: cfg.blocks[edge.from]?.startLine ?? 0,
            argCount: 1,
          });
        }
      }
    }
  }

  return edges;
}
