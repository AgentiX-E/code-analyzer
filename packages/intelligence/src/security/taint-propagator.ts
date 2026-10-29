// @code-analyzer/intelligence — Taint Propagation Engine
// Forward taint reachability over def→use facts using the two-rule model.
//
// Two-rule model (from GitNexus taint/propagate.ts):
//   Rule (a), worklist: For each tainted (binding, defPoint), every def→use
//     fact delivers taint to a use statement. Occurrences in sink positions
//     produce findings. The statement's defs are tainted onward.
//   Rule (b), statement-local: A matched SOURCE member-read whose parent chain
//     reaches a matched SINK arg position produces an immediate single-hop finding.
//
// **The walk itself is `flow-reach.ts`.** This module is the *finding* question asked of it: which sinks did a value
// reach, with which neutralisations, along which path. Two other questions are asked of the same walk - "which returns
// hand a value back" (the summary builder) and "did this value vanish where nothing writes a name" (the blind-loss
// rule) - and they are hooks rather than second loops, so a change to how a definition inherits a value cannot make the
// three disagree.
//
// Reachability model:
//   A definition the file's arithmetic decides (`bar = cond ? "constant" : param` with a constant condition) holds
//   one value and it is not the tainted one, so it is not seeded and does not propagate. A line a constant condition
//   closes is not read at all. **Both facts are optional**, and their absence leaves every definition a may-definition,
//   which is what the analysis did before reachability existed - the conservative direction.
//
// Call-result model:
//   `bar = helper(param)` writes `bar` from a statement that read `param`, and a single-block CFG cannot tell "the
//   callee passed it through" from "the callee ignored it". `definitionFilter` is where that answer arrives: the caller
//   supplies a verdict from the callee's own summary, and a verdict may stop the edge or add the neutralisations the
//   callee's body applied on the way back. **Absent means every definition inherits**, which is what the engine did
//   before summaries could answer.
//
// Kind-set exclusion model:
//   Taint carries a set of EXCLUDED SinkKinds. A sink fires unless its kind
//   is excluded. Sanitizer kills apply to the def they produce.
//   Intersection over paths: a def fed by multiple paths excludes a kind only
//   when EVERY path neutralizes it. Monotone shrink: re-derived taint with
//   fewer exclusions re-enqueues (strictly more dangerous).

import { cleansValue, neutralizedAt, propagate } from './flow-reach.js';

import type { DefinitionEdge, ReachState, SinkKind } from './flow-reach.js';
import type {
  FunctionCfg,
  DefUseFact,
  TaintSinkOccurrence,
  TaintSourceOccurrence,
  SanitizerOccurrence,
  TaintFlowFinding,
  TaintFunctionResult,
  TaintReturnFlow,
} from '../cfg/types.js';

export type { SinkKind };

/** Internal taint state: a tainted binding at a program point. */
type TaintState = ReachState;

/** Configuration for taint propagation. */
export interface TaintPropagationConfig {
  /** Maximum number of findings per source. */
  maxFindingsPerSource: number;
  /** Maximum path length (block count). */
  maxPathLength: number;
  /** Maximum worklist iterations. */
  maxIterations: number;
  /** Whether to include inter-procedural edges. */
  interproc: boolean;
}

const DEFAULT_CONFIG: TaintPropagationConfig = {
  maxFindingsPerSource: 20,
  maxPathLength: 15,
  maxIterations: 5000,
  interproc: false,
};

/** What one run of the analysis is allowed to assume about its callees, and which bindings it seeds. */
export interface PropagatorOptions {
  /**
   * What happens to the value a written name inherits.
   *
   * Supplied by the pipeline, which is the only place that knows the callee's summary. A verdict may stop the edge -
   * "the callee's returns do not read this parameter, and its body has no place for a value to hide" - or add the
   * neutralisations applied on the way back out. `undefined` keeps the conservative reading.
   */
  readonly definitionFilter?: (edge: DefinitionEdge) => DefinitionVerdictLike | undefined;
  /**
   * Seed only these binding indices from each source statement.
   *
   * **A parameter's taint is asked one parameter at a time**: `doSomething(request, param)` declares both names on
   * one line, so a source on that line seeds both and the answer could not say which one an argument position carries.
   */
  readonly seedBindings?: ReadonlySet<number>;
  /**
   * Sources this file did not read, seeded alongside the ones it did.
   *
   * A caller that wants to ask "can this parameter reach a return" has to put a source where the parameter is, and
   * that source is not in the file: no provider extracts `param` as untrusted input. The occurrence says so by naming
   * its category `parameter`, which also makes it the one source that seeds exactly one definition rather than every
   * name its statement writes.
   *
   * **The same channel carries a callee's own source into its caller.** `bar = helper(request)` where `helper` reads the
   * request itself leaves `bar` with no source in this file at all, and injecting the category the callee read is the
   * only way the walk can find the value the callee handed back.
   */
  readonly extraSources?: readonly InjectedSource[];
  /**
   * Called when a value is consumed by a statement that writes no name.
   *
   * **This is where a value can vanish without a trace**, and a summary that claims a parameter does not reach a
   * return has to know it did not simply disappear into a collection it could not follow: `map.put("k", param)` reads
   * `param`, writes nothing, and hands the value back through a `get` that this model has no edge for.
   */
  readonly onLost?: (state: ReachState, use: DefUseFact) => void;
}

/** A verdict from the caller about one definition edge. */
interface DefinitionVerdictLike {
  readonly stop?: boolean;
  readonly neutralized?: ReadonlySet<SinkKind>;
}

/** A source the caller supplies, with the neutralisations that already applied before it got here. */
export interface InjectedSource {
  /** The occurrence to seed, positioned where the file holds the value. */
  readonly occurrence: TaintSourceOccurrence;
  /**
   * Kinds already neutralised before the value exists at this point.
   *
   * **A callee can escape a value and still hand it back**, and the caller inherits both facts at once: the value is
   * untrusted and it has been escaped for one kind of sink. Dropping the second turns a correctly-sanitised flow into a
   * false positive, which is the same mistake as dropping the first, one direction over.
   */
  readonly neutralized?: ReadonlySet<SinkKind>;
}

// ---------------------------------------------------------------------------
// Taint Propagator
// ---------------------------------------------------------------------------

export class TaintPropagator {
  private config: TaintPropagationConfig;

  constructor(config?: Partial<TaintPropagationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run taint propagation on a function CFG with pre-computed reaching definitions.
   *
   * @param cfg — Function control flow graph with source/sink/sanitizer occurrences
   * @param defUseFacts — Pre-computed def→use facts from reaching definitions
   * @param options — what the caller knows about this function's callees, and which bindings to seed
   * @returns Taint analysis result
   */
  analyze(
    cfg: FunctionCfg,
    defUseFacts: readonly DefUseFact[],
    options?: PropagatorOptions,
  ): TaintFunctionResult {
    const startTime = performance.now();
    const findings: TaintFlowFinding[] = [];
    const returnFlows: TaintReturnFlow[] = [];

    // Step 1: Identify all source occurrences
    const injected = options?.extraSources ?? [];
    // The neutralisations an injected source arrives with, by occurrence: they were applied somewhere this file cannot
    // see - inside the callee that handed the value back - so they can only come from the caller.
    const injectedKinds = new Map(
      injected.map((entry) => [entry.occurrence, entry.neutralized] as const),
    );
    const sources = [...this.collectSources(cfg), ...injected.map((entry) => entry.occurrence)];
    if (sources.length === 0) {
      return {
        functionName: cfg.functionName,
        filePath: cfg.filePath,
        findings: [],
        returnFlows: [],
        sanitizerKills: 0,
        factsProcessed: 0,
        durationMs: performance.now() - startTime,
      };
    }

    // **Reachability, read once.** A constant definition and a dead line are facts about the file, not about a path,
    // so they are consulted by the walk and nowhere else.
    const deadLines = cfg.stmtFacts.unreachableLines;
    const constantDefs = cfg.stmtFacts.constantDefs;
    const returnLines = cfg.stmtFacts.returnLines;

    // Step 2: Identify sink and sanitizer occurrences
    const sinkIndex = this.buildSinkIndex(cfg);
    const sanitizerIndex = this.buildSanitizerIndex(cfg);

    // Step 3: Seeds, one per (source, definition) pair the source statement writes.
    const seeds: TaintState[] = [];
    for (const source of sources) {
      // **A source on a line nothing reaches is not a source.** OWASP Benchmark's safe cases put the tainted read in
      // an arm a constant condition closes, and the read is real code - it simply cannot run.
      if (deadLines?.has(source.point.line) === true) continue;

      for (const definition of this.definitionsOfSource(cfg, source)) {
        if (
          options?.seedBindings !== undefined &&
          !options.seedBindings.has(definition.bindingIdx)
        ) {
          continue;
        }
        // **A source whose own definition folds to a constant is not a source.** The walk applies this rule to every
        // definition it hands on; the seed is a definition too, and skipping the check here seeded a value the file's
        // arithmetic says the name cannot hold.
        if (constantDefs?.get(definition.stmtIndex)?.has(definition.bindingIdx) === true) continue;
        // **A neutraliser on the source's own statement has already run when the value is created**, and this is the
        // read that needs no propagation to see it: `int id = Integer.parseInt(request.getParameter("id"))` is one
        // statement, so the flow from the parameter into `id` never leaves it. The seed carried an empty exclusion set,
        // and the neutraliser was only ever consulted on the statements the value travelled *to* - so the one statement
        // it could not reach was the one it sat on.
        const here = neutralizedAt(
          sanitizerIndex,
          source.point.blockIndex * 1024 + source.point.stmtIndex,
          cfg.bindings[definition.bindingIdx]?.name,
        );
        const arrival = injectedKinds.get(source);
        seeds.push({
          bindingIdx: definition.bindingIdx,
          point: {
            blockIndex: source.point.blockIndex,
            stmtIndex: definition.stmtIndex,
            line: source.point.line,
          },
          exclusions:
            arrival === undefined || arrival.size === 0 ? here : new Set([...here, ...arrival]),
          source,
          viaBlocks: [source.point.blockIndex],
        });
      }

      // Rule (b): Statement-local source→sink (same statement)
      this.checkStatementLocal(cfg, source, sinkIndex, sanitizerIndex, findings);
    }

    // Step 4: Forward propagation, with this class answering the two hooks.
    const outcome = propagate(
      cfg,
      defUseFacts,
      seeds,
      {
        onUse: (state, use) => {
          this.recordUse(state, use, sinkIndex, returnLines, findings, returnFlows);
        },
        onDefinition: (edge) => options?.definitionFilter?.(edge),
        onDeadEnd: (state, use) => options?.onLost?.(state, use),
      },
      { sanitizers: sanitizerIndex, maxIterations: this.config.maxIterations },
    );

    // The cap bounds what a reader is shown, not what is explored: a neutralised flow is reported so a caller can see
    // the engine considered and cleared it, but it does not use up the budget.
    const capped: TaintFlowFinding[] = [];
    let live = 0;
    for (const finding of findings) {
      if (finding.sanitized) {
        capped.push(finding);
        continue;
      }
      if (live >= this.config.maxFindingsPerSource) continue;
      live++;
      capped.push(finding);
    }

    return {
      functionName: cfg.functionName,
      filePath: cfg.filePath,
      findings: capped,
      returnFlows,
      sanitizerKills: outcome.sanitizerKills,
      factsProcessed: outcome.factsProcessed,
      durationMs: performance.now() - startTime,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * The names a source statement writes.
   *
   * **A source names an expression** — `request.getParameter("x")` — and the statement writes the name that receives
   * it. Usually that is one name, but `int a = x, b = request.getParameter()` writes two, and both hold the value, so
   * both are seeded.
   *
   * **A `parameter` source is the exception, and it must be**: `doSomething(request, param)` declares two names on one
   * line, and seeding both from either one would make "argument 1 reaches a return" indistinguishable from "argument
   * 0 does". A parameter source names exactly one binding by construction, so only that one is seeded.
   */
  private definitionsOfSource(
    cfg: FunctionCfg,
    source: TaintSourceOccurrenceLike,
  ): Array<{ bindingIdx: number; stmtIndex: number }> {
    const key = source.point.blockIndex * 1024 + source.point.stmtIndex;
    const defs = cfg.stmtFacts.defs.get(key);
    if (!defs || defs.length === 0) return [];
    if (source.category === 'parameter') {
      const own = defs.find((d) => d.bindingIdx === source.bindingIdx);
      return own === undefined
        ? []
        : [{ bindingIdx: own.bindingIdx, stmtIndex: own.point.stmtIndex }];
    }
    return defs.map((d) => ({ bindingIdx: d.bindingIdx, stmtIndex: d.point.stmtIndex }));
  }

  private collectSources(cfg: FunctionCfg): TaintSourceOccurrenceLike[] {
    return [...cfg.stmtFacts.sourceSites.values()];
  }

  private buildSinkIndex(cfg: FunctionCfg): Map<number, TaintSinkOccurrence[]> {
    const index = new Map<number, TaintSinkOccurrence[]>();
    for (const [key, sink] of cfg.stmtFacts.sinkSites) {
      // `sinkSites` is a ReadonlyMap with unique statement keys, so each key is
      // visited exactly once and a fresh bucket is always required.
      index.set(key, [sink]);
    }
    return index;
  }

  private buildSanitizerIndex(cfg: FunctionCfg): Map<number, SanitizerOccurrence[]> {
    const index = new Map<number, SanitizerOccurrence[]>();
    for (const [key, san] of cfg.stmtFacts.sanitizerSites) {
      // `sanitizerSites` is a ReadonlyMap with unique statement keys, so each
      // key is visited exactly once and a fresh bucket is always required.
      index.set(key, [san]);
    }
    return index;
  }

  /** A value arrived at a statement: report the sinks it reached and the returns it can leave by. */
  private recordUse(
    state: TaintState,
    use: DefUseFact,
    sinkIndex: Map<number, TaintSinkOccurrence[]>,
    returnLines: ReadonlySet<number> | undefined,
    findings: TaintFlowFinding[],
    returnFlows: TaintReturnFlow[],
  ): void {
    // **A return hands the value back to the caller**, which is a fact about the callee that no caller can derive for
    // itself. It is recorded against the line, and the neutralisations accumulated to here travel with it, so a helper
    // that escapes its argument reports an escaped value rather than a clean one.
    if (returnLines?.has(use.use.line) === true) {
      returnFlows.push({ source: state.source, line: use.use.line, neutralized: state.exclusions });
    }

    const key = use.use.blockIndex * 1024 + use.use.stmtIndex;
    const sinks = sinkIndex.get(key);
    if (!sinks || sinks.length === 0) return;

    for (const sink of sinks) {
      const path = this.buildBlockPath(state);

      // **The state's own exclusions decide, and nothing else does.** They were accumulated where a neutraliser was
      // met on the way here, per sink kind, so a finding is sanitized exactly when the value that reached this sink
      // passed through a neutraliser for *this* kind.
      const sanitized = state.exclusions.has(sink.kind);

      findings.push({
        id: `taint-${state.source.point.blockIndex}-${use.use.blockIndex}-${findings.length}`,
        source: state.source,
        sink,
        path,
        hops: path.length,
        sanitized,
        truncated: path.length >= this.config.maxPathLength,
        interproc: false,
        confidence: this.computeConfidence(state, path.length),
      });
    }
  }

  private checkStatementLocal(
    cfg: FunctionCfg,
    source: TaintSourceOccurrenceLike,
    sinkIndex: Map<number, TaintSinkOccurrence[]>,
    sanitizerIndex: Map<number, SanitizerOccurrence[]>,
    findings: TaintFlowFinding[],
  ): void {
    const key = source.point.blockIndex * 1024 + source.point.stmtIndex;
    const sinks = sinkIndex.get(key);
    if (!sinks) return;

    for (const sink of sinks) {
      findings.push({
        id: `taint-local-${source.point.blockIndex}-${findings.length}`,
        source,
        sink,
        path: [source.point.blockIndex],
        hops: 1,
        // One statement, so the neutraliser that matters is the one on it, for this sink's kind, and for this value.
        sanitized: this.isNeutralized(
          sanitizerIndex,
          key,
          sink.kind,
          cfg.bindings[source.bindingIdx]?.name,
        ),
        truncated: false,
        interproc: false,
        confidence: 0.9, // Statement-local is high confidence
      });
    }
  }

  /**
   * Reconstruct the block-level path from source to sink using the
   * viaBlocks trace accumulated during worklist propagation.
   * Each propagation step appends the destination block, so the
   * final trace is complete.
   */
  private buildBlockPath(state: TaintState): number[] {
    return [...state.viaBlocks];
  }

  private computeConfidence(state: TaintState, pathLength: number): number {
    let confidence = 0.8;
    // Inter-procedural taint (viaCall === true) is not yet implemented, so the
    // ×0.7 call-crossing factor is intentionally omitted.
    if (state.exclusions.size > 0) confidence *= 0.5;
    if (pathLength > 5) confidence *= 0.8;
    if (pathLength > 10) confidence *= 0.6;
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Whether a neutraliser on this one statement makes **this sink kind** safe.
   *
   * This is only asked where a source and a sink share a statement — `db.query(escape(req.body.id))` — because
   * everywhere else the answer comes from the exclusions the propagation accumulated, which are per kind and per
   * path. **Two parameters changed the answer here.** Without `sinkKind` the check returned true for the mere
   * presence of a neutraliser, so `encodeForHTML(param)` vouched for a query; without the narrowing to one statement
   * it returned true for a neutraliser anywhere in the range, so `setString(1, "constant")` vouched for a query built
   * two lines above it.
   */
  private isNeutralized(
    sanitizerIndex: Map<number, SanitizerOccurrence[]>,
    key: number,
    sinkKind: string,
    carriedName: string | undefined,
  ): boolean {
    for (const occurrence of sanitizerIndex.get(key) ?? []) {
      if (!occurrence.neutralizedKinds.has(sinkKind)) continue;
      if (!cleansValue(occurrence, carriedName)) continue;
      return true;
    }
    return false;
  }
}

/** The occurrence shape this module reads, structurally, so a caller may pass its own value. */
type TaintSourceOccurrenceLike = TaintState['source'];
