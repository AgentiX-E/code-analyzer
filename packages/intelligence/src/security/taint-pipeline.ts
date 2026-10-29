// @code-analyzer/intelligence — Inter-Procedural Taint Pipeline
// Connects the intra-procedural TaintPropagator to the InterprocSolver
// via FunctionSummary and CallGraphEdge conversion.
//
// **A call's result is what the callee returns, and the pipeline is the only place that can say so.** The propagator
// walks one function; the summary of a callee is a fact about another function; and the composition of the two is what
// turns `bar = helper(param)` from "the statement read a tainted name and wrote a name" into a claim with a reason
// behind it. `CallReturns` below performs that composition, and the propagator asks it through `definitionFilter`.
//
// Three things happen in order, and the order is the algorithm:
//
//   1. **Reachability facts and return summaries, once per function.** A summary is built without consulting anyone
//      else's, so it over-approximates what a parameter reaches - the safe direction for a summary that will be used to
//      *stop* a flow.
//   2. **The call-result table.** For every resolved call with a matching arity, which argument positions carry into the
//      result and which provably do not.
//   3. **Findings, refined.** The propagator runs again with that table, so a definition produced by a call inherits
//      only what the callee's returns actually read - and inherits the escapes the callee applied on the way out.

import {
  InterprocSolver,
  type FunctionSummary,
  type CallGraphEdge,
  type InterprocTaintResult,
  InterprocTaintFinding,
} from './interproc-solver.js';
import { summarizeReturns, UNKNOWN_RETURNS } from './return-summary.js';
import { TaintPropagator, type InjectedSource } from './taint-propagator.js';
import { computeReachingDefinitions } from '../cfg/reaching-defs.js';

import type { DefinitionEdge, DefinitionVerdict } from './flow-reach.js';
import type { ReturnSummary } from './return-summary.js';
import type { DefUseFact, FunctionCfg, TaintFunctionResult } from '../cfg/types.js';
import type { CallSite } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run end-to-end inter-procedural taint analysis across multiple functions.
 *
 * 1. For each function CFG, computes reaching definitions and a return summary
 * 2. Composes the summaries into a call-result table
 * 3. Runs the propagator with that table, so a call's result inherits only what the callee returns
 * 4. Converts intra-proc findings to FunctionSummary
 * 5. Feeds summaries + call graph to InterprocSolver
 * 6. Returns combined intra-proc + inter-proc findings
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

    // Step 1: reachability facts and return summaries, both derived from the same def-use graph.
    const facts = new Map<string, readonly DefUseFact[]>();
    const returns = new Map<string, ReturnSummary>();
    for (const [fnQn, cfg] of cfgs) {
      try {
        // Def-use facts from the reaching-definitions analysis, which is what the TODO here asked for. Without
        // them the propagator found nothing, every summary it built was empty, and the solver below had nothing to
        // solve — a subsystem that looked complete from every angle except its input.
        const reach = computeReachingDefinitions(cfg);
        facts.set(fnQn, reach);
        returns.set(fnQn, summarizeReturns(cfg, reach));
      } catch {
        facts.set(fnQn, []);
        returns.set(fnQn, UNKNOWN_RETURNS);
      }
    }

    // Step 2: what each call hands its caller, from the callee's own returns.
    const callReturns = new CallReturns(cfgs, returns);

    // Step 3: findings, with each call's result refined by the callee's summary.
    for (const [fnQn, cfg] of cfgs) {
      // Step 1 set an entry for every CFG, including the ones it could not walk, so this lookup is total.
      const reach = facts.get(fnQn)!;
      const filter = callReturns.filterFor(fnQn);
      // What the callees of *this* function hand back from their own sources, seeded where the results land.
      const injected = callReturns.sourcesFor(cfg);
      let result: TaintFunctionResult;
      try {
        result = this.propagator.analyze(cfg, reach, {
          ...(filter === undefined ? {} : { definitionFilter: filter }),
          ...(injected.length === 0 ? {} : { extraSources: injected }),
        });
      } catch {
        // A function the analysis cannot walk contributes a summary and no findings, rather than aborting the file.
        summaries.push(emptySummary(fnQn, cfg, returns.get(fnQn)));
        continue;
      }
      summaries.push(buildFunctionSummary(fnQn, cfg, result, knownFunctions, returns.get(fnQn)));

      // One flow inside one function: source and sink in the same place, no call chain to cross.
      for (const finding of result.findings) {
        // **A value a callee handed back started there, not here.** The walk that found it ran in the caller, but the
        // line the report would name holds a call, so the origin travels with the source and is reported as its own.
        const sourceFn = finding.source.origin ?? fnQn;
        intraProcFindings.push({
          id: `${fnQn}#${finding.id}`,
          source: finding.source,
          sink: finding.sink,
          sourceFn,
          sinkFn: fnQn,
          callChain: sourceFn === fnQn ? [fnQn] : [sourceFn, fnQn],
          sanitized: finding.sanitized,
          neutralizedKinds: [],
          // No call was crossed, so there are no hops to count beyond reaching the sink, and the propagator's own
          // confidence is used unchanged.
          hops: finding.hops,
          confidence: finding.confidence,
        });
      }
    }

    // Step 4: Load summaries and the call graph into the solver. `loadCallGraph` existed and was never called:
    // the parameter was named `_callGraph`, and `solve()` builds its reverse callee→caller index from the edges
    // loaded here. A summary naming a callee the solver cannot resolve is skipped by `if (!s2c.resolved) continue`.
    this.solver.loadSummaries(summaries);
    this.solver.loadCallGraph(callGraph);

    // Step 5: Run inter-procedural fixpoint
    const interProcResult = this.solver.solve();

    // Step 6: Merge and return — the merge the comment named and the code did not do. Intra-procedural findings come
    // first, because they are the ones a reader can act on without following a call.
    return {
      ...interProcResult,
      findings: [...intraProcFindings, ...interProcResult.findings],
      stats: { ...interProcResult.stats, intraProcFindings: intraProcFindings.length },
    };
  }
}

// ---------------------------------------------------------------------------
// Call results
// ---------------------------------------------------------------------------

/** One resolved call, reduced to the question the propagator will ask. */
interface CallableResult {
  /** Argument positions of this call, by the binding passed at each. */
  readonly positionOf: ReadonlyMap<number, number>;
  /** Number of argument positions the call site passes. */
  readonly arity: number;
  /** Number of parameters the callee declares. */
  readonly parameterCount: number;
  /** What the callee hands back. */
  readonly summary: ReturnSummary;
}

/**
 * What every call in a file hands back, indexed by the line the call sits on.
 *
 * **A verdict is only worth having where it is earned.** Three conditions gate it, and each exists because the
 * alternative is a wrong answer rather than a missing one:
 *
 *   - the callee resolved to a function this analysis built a CFG for,
 *   - the arity matches, because argument 1 of a two-argument call is not argument 1 of a three-argument one,
 *   - the callee's returns were read, because "no return reads this parameter" is a statement only where they were.
 */
class CallReturns {
  private readonly byLine = new Map<string, Map<number, CallableResult[]>>();

  constructor(
    private readonly cfgs: ReadonlyMap<string, FunctionCfg>,
    private readonly summaries: ReadonlyMap<string, ReturnSummary>,
  ) {
    for (const [fnQn, cfg] of cfgs) {
      const perLine = new Map<number, CallableResult[]>();
      for (const call of cfg.callSites ?? []) {
        const entry = this.describe(call);
        if (!entry) continue;
        const bucket = perLine.get(call.line);
        if (bucket) bucket.push(entry);
        else perLine.set(call.line, [entry]);
      }
      if (perLine.size > 0) this.byLine.set(fnQn, perLine);
    }
  }

  /** The verdict function for one caller, or `undefined` when nothing it calls has an answer. */
  filterFor(fnQn: string): ((edge: DefinitionEdge) => DefinitionVerdict | undefined) | undefined {
    const perLine = this.byLine.get(fnQn);
    if (!perLine) return undefined;
    // **The value being carried, not the name being written.** The question is whether *this argument* reaches the
    // callee's return; the binding the statement writes is the caller's local, which no callee has a parameter for.
    return (edge) => this.verdict(perLine.get(edge.line), edge.state.bindingIdx);
  }

  /**
   * The sources a callee's own returns carry into this function.
   *
   * **This is the generative direction, and the caller has nothing to offer it.** In `bar = helper(request)` the value
   * `helper` returns starts inside `helper`, from a read this file never performs; the argument is a request object, not
   * a tainted name, so no seed on the caller's side can be found by looking at the caller. Injecting the category the
   * callee read - at the binding the call's result lands in - is the only place the value can enter the walk, and once
   * it is there the same propagation that finds every other flow finds this one.
   *
   * A call whose result is discarded has nowhere to put the value, and a callee whose returns read no source of its own
   * hands back nothing untrusted; both are skipped rather than guessed at.
   */
  sourcesFor(cfg: FunctionCfg): InjectedSource[] {
    const injected: InjectedSource[] = [];
    const seen = new Set<string>();

    for (const call of cfg.callSites ?? []) {
      const summary = this.summaries.get(call.calleeName);
      if (summary?.known !== true || summary.ownCategories.size === 0) continue;

      // **Where the result lands is the name the statement writes.** No provider records `resultBinding` for a call -
      // it is -1 everywhere in the corpus - so the statement's own definitions are the anchor, and a call whose result
      // nothing receives has nowhere to put the value and is skipped.
      const written =
        call.resultBinding >= 0
          ? [call.resultBinding]
          : (cfg.stmtFacts.defs.get(call.blockIndex * 1024 + call.stmtIndex) ?? []).map(
              (definition) => definition.bindingIdx,
            );

      for (const bindingIdx of written) {
        for (const category of summary.ownCategories) {
          // Two calls on one line assigning the same name, or one callee reading two kinds of input, are one value: the
          // binding and the line identify it, and a second occurrence would be a second finding for the same flow.
          const key = `${bindingIdx}:${call.line}:${category}`;
          if (seen.has(key)) continue;
          seen.add(key);
          injected.push({
            occurrence: {
              bindingIdx,
              point: { blockIndex: call.blockIndex, stmtIndex: call.stmtIndex, line: call.line },
              category,
              description: `${call.calleeName} hands back what it read`,
              line: call.line,
              origin: call.calleeName,
            },
            // **The callee's escapes travel with its sources, not with its parameters.** A helper that reads the request
            // and escapes before returning hands back a value that is untrusted *for the kinds it did not neutralise*, and
            // the summary carries one set for the whole function: an approximation in the safe direction, because a kind
            // missing from it only ever adds a finding a reader can see and dismiss.
            ...(summary.ownSource.neutralized.size === 0
              ? {}
              : { neutralized: summary.ownSource.neutralized }),
          });
        }
      }
    }

    return injected;
  }

  private verdict(
    calls: readonly CallableResult[] | undefined,
    bindingIdx: number,
  ): DefinitionVerdict | undefined {
    if (!calls) return undefined;

    let neutralized: Set<string> | undefined;
    let carries = false;
    let clean = false;
    let looked = false;

    for (const call of calls) {
      const position = call.positionOf.get(bindingIdx);
      // The value is not an argument of this call, so this call says nothing about it. `new Helper()` on the same
      // line as the call that does consume the value is exactly this case, and it is why the answer is per call.
      if (position === undefined) continue;
      if (call.arity !== call.parameterCount) continue;
      // **The arity gate above is what makes this lookup total**: a summary fills one entry per declared parameter, and
      // a call whose arity equals that count passes a position inside it. A missing entry is not a state this pair of
      // facts can produce, so the branch that used to guard it was dead.
      const returned = call.summary.byParameter.get(position)!;
      looked = true;

      if (returned.lines.size > 0) {
        carries = true;
        neutralized ??= new Set<string>();
        for (const kind of returned.neutralized) neutralized.add(kind);
        continue;
      }
      // **A function that returns one of its own sources taints its result whatever the argument was**, and this model
      // cannot attach that value to the caller's name. Saying nothing leaves the conservative reading in place, which
      // is the over-approximation rather than a missing flow.
      //
      // **And a value that vanished into a call cannot be reported as not returning.** `map.put("k", param)` writes no
      // name, so the walk stops there; the collection hands the value back through a `get` no edge connects. The
      // negative answer is only available while the value never disappeared, which is what `lost` records.
      const vanished = call.summary.lost.has(position) || call.summary.ownLost;
      if (call.summary.ownSource.lines.size === 0 && !vanished) clean = true;
    }

    if (!looked) return undefined;
    // **A carry outranks a clean answer**: two calls on one line, one of which passes the value through, is a line
    // that passes the value through. Only when every call that could carry says it does not does the flow stop.
    // **A carry always has a set**: it is created the moment a return reads the value, empty when the callee escaped
    // nothing. Returning it rather than an empty verdict says the same thing - flow-reach only widens on a non-empty
    // set - and it says it without a second shape for the same answer.
    if (carries) return { neutralized: neutralized! };
    return clean ? { stop: true } : undefined;
  }

  /** Reduce one call site to the question, or `undefined` when it cannot be asked. */
  private describe(call: CallSite): CallableResult | undefined {
    const callee = this.cfgs.get(call.calleeName);
    const summary = this.summaries.get(call.calleeName);
    if (!callee || !summary || !summary.known) return undefined;

    const parameterCount = callee.parameterBindings?.length ?? 0;
    if (parameterCount === 0) return undefined;

    const positions = call.argArguments ?? [];
    // **Empty is the same as absent**, which is what `CallSite.argArguments` says an empty array means: the positions
    // were not recorded. Reading `[]` as "recorded, and there are none" dropped the call site entirely.
    const positionsKnown = positions.length > 0;

    const positionOf = new Map<number, number>();
    for (let index = 0; index < call.argBindings.length; index++) {
      const bindingIdx = call.argBindings[index]!;
      // **Without recorded positions the index in the list is the position**, which is what the field's contract says
      // an empty `argArguments` means. With them, an entry whose position was not recorded places nothing.
      const position = positionsKnown ? positions[index] : index;
      if (bindingIdx < 0 || position === undefined) continue;
      if (!positionOf.has(bindingIdx)) positionOf.set(bindingIdx, position);
    }
    if (positionOf.size === 0) return undefined;

    const arity = positionsKnown
      ? Math.max(...positions, -1) + 1
      : call.argBindings.filter((idx) => idx >= 0).length;

    return { positionOf, arity, parameterCount, summary };
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
 *   - param→return flows → paramToReturns, from the function's own return summary
 */

function emptySummary(
  fnQn: string,
  cfg: FunctionCfg,
  returns: ReturnSummary | undefined,
): FunctionSummary {
  return {
    fnQn,
    fnName: cfg.functionName,
    paramCount: 0,
    paramToSinks: [],
    sourceToCallArgs: [],
    paramToCallArgs: [],
    sourceToReturns: [],
    callResults: [],
    paramToReturns: paramToReturnsOf(returns),
    sourceFile: cfg.filePath,
  };
}

/**
 * Which parameters reach a return, in the shape the summary model uses.
 *
 * **`returnIndices` is always `[0]`**, because this analysis models one value coming back: a function returns one
 * value, and a caller that destructures a tuple is reading fields of it. A model with several return values would have
 * to say which field an argument reaches, and nothing in the capture vocabulary can say that.
 */
function paramToReturnsOf(returns: ReturnSummary | undefined): FunctionSummary['paramToReturns'] {
  if (!returns || !returns.known) return [];
  const out: FunctionSummary['paramToReturns'] = [];
  for (const [param, returned] of returns.byParameter) {
    if (returned.lines.size === 0) continue;
    out.push({
      param,
      returnIndices: [0],
      ...(returned.neutralized.size === 0 ? {} : { neutralized: [...returned.neutralized] }),
    });
  }
  return out;
}

function buildFunctionSummary(
  fnQn: string,
  cfg: FunctionCfg,
  result: TaintFunctionResult,
  knownFunctions: ReadonlySet<string>,
  returns: ReturnSummary | undefined,
): FunctionSummary {
  const fnName = cfg.functionName;
  // **`parameterBindings` is the count, and it used to be `bindings.filter(kind === 'param')` - which is always zero**,
  // because `buildStatementFacts` labels every capture-derived binding `local`: a parameter arrives as a `VARIABLE_DEF`
  // like any other. The `Math.max(paramCount, 1)` below then reported one parameter for every function in the program.
  const paramCount = cfg.parameterBindings?.length ?? 0;

  const paramToSinks: FunctionSummary['paramToSinks'] = [];
  const sourceToCallArgs: FunctionSummary['sourceToCallArgs'] = [];
  const paramToCallArgs: FunctionSummary['paramToCallArgs'] = [];
  const sourceToReturns: FunctionSummary['sourceToReturns'] = [];
  const paramToReturns: FunctionSummary['paramToReturns'] = paramToReturnsOf(returns);
  const callResults: FunctionSummary['callResults'] = [];

  // `findings` is a required array on TaintFunctionResult (the propagator always
  // returns one, empty when there are no sources), so iterating directly is
  // safe — a `for..of` over an empty array is a no-op. The previous truthiness
  // guard tested a state the type system already excludes.
  for (const finding of result.findings) {
    const source = finding.source;
    const sink = finding.sink;

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
  for (const sinkOccurrence of cfg.stmtFacts.sinkSites.values()) {
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
  for (const occurrence of cfg.stmtFacts.sourceSites.values()) {
    // **`bindingIdx` is a required field of `TaintSourceOccurrence`**, so the `if (bindingIdx === undefined) continue`
    // that stood here guarded a state its own type forbids - and a guard against a shape the type excludes is a
    // comment claiming the type is wrong.
    const bindingIdx = occurrence.bindingIdx;

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
  }

  // **Source → Return, which is the generative half and was permanently empty.** A function that reads a request and
  // hands it back is a source for every one of its callers, and nothing recorded that until returns were read.
  const seenSources = new Set<unknown>();
  for (const flow of result.returnFlows) {
    // **No `parameter` source can appear here.** Those are seeded by `summarizeReturns` for its own question and never
    // reach the pipeline, whose sources are the file's own reads plus what its callees handed back.
    if (seenSources.has(flow.source)) continue;
    seenSources.add(flow.source);
    // **One value comes back**, so the only return index is the value itself: a caller that destructures a tuple is
    // reading fields of it, and nothing in the capture vocabulary says which field an argument reaches.
    sourceToReturns.push({ source: flow.source, returnIndices: [0] });
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
