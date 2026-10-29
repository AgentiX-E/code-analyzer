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
// Kind-set exclusion model:
//   Taint carries a set of EXCLUDED SinkKinds. A sink fires unless its kind
//   is excluded. Sanitizer kills apply to the def they produce.
//   Intersection over paths: a def fed by multiple paths excludes a kind only
//   when EVERY path neutralizes it. Monotone shrink: re-derived taint with
//   fewer exclusions re-enqueues (strictly more dangerous).

import type {
  FunctionCfg,
  DefUseFact,
  TaintSourceOccurrence,
  TaintSinkOccurrence,
  SanitizerOccurrence,
  TaintFlowFinding,
  TaintFunctionResult,
} from '../cfg/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Kinds of taint sinks for exclusion tracking. */
export type SinkKind = string;

/** Internal taint state: a tainted binding at a program point. */
interface TaintState {
  /** Binding index carrying taint. */
  bindingIdx: number;
  /** Program point where taint was introduced. */
  point: { blockIndex: number; stmtIndex: number; line: number };
  /** Sink kinds EXCLUDED (neutralized by sanitizers on this path). */
  exclusions: ReadonlySet<SinkKind>;
  /** Source that introduced this taint. */
  source: TaintSourceOccurrence;
  /** Whether taint passed through an unmodeled call. */
  viaCall: boolean;
  /** Exclusion set size at last processing (for monotone detection). */
  processedSize: number;
  /** Blocks traversed from source to current point (for path reconstruction). */
  viaBlocks: readonly number[];
}

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

// ---------------------------------------------------------------------------
// Taint Propagator
// ---------------------------------------------------------------------------

/**
 * TaintPropagator performs intra-procedural forward taint analysis
 * over def→use facts computed by the reaching definitions analysis.
 */
/**
 * Whether a neutraliser applies to the value being carried.
 *
 * **Three answers, three analyses.** A neutraliser that names the value applies only when the value is one of its
 * arguments — `encodeForHTML(param)` does not clean `bar` in the same call. One that names nothing but *was* read has
 * literal arguments only, and literals carry no taint, so it cleans nothing that is being tracked. One whose arguments
 * could not be read has no answer to give, and the statement-level reading stays for it.
 */
function cleansValue(occurrence: SanitizerOccurrence, carriedName: string | undefined): boolean {
  const names = occurrence.neutralizedNames;
  if (names === undefined) return true;
  if (carriedName === undefined) return names.size === 0;
  return names.has(carriedName);
}

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
   * @returns Taint analysis result
   */
  analyze(cfg: FunctionCfg, defUseFacts: readonly DefUseFact[]): TaintFunctionResult {
    const startTime = performance.now();
    const findings: TaintFlowFinding[] = [];
    let sanitizerKills = 0;
    let factsProcessed = 0;
    // Findings a reader can act on, which is what the per-source cap bounds: a neutralised flow is reported so that a
    // caller can see the engine considered and cleared it, but it does not use up the budget.
    let liveFindings = 0;

    // Step 1: Identify all source occurrences
    const sources = this.collectSources(cfg);
    if (sources.length === 0) {
      return {
        functionName: cfg.functionName,
        filePath: cfg.filePath,
        findings: [],
        sanitizerKills: 0,
        factsProcessed: 0,
        durationMs: performance.now() - startTime,
      };
    }

    // Step 2: Build def→use fact index for fast lookup
    const defUseIndex = this.buildDefUseIndex(defUseFacts);

    // Step 3: Identify sink and sanitizer occurrences
    const sinkIndex = this.buildSinkIndex(cfg);
    const sanitizerIndex = this.buildSanitizerIndex(cfg);

    // Step 4: Forward propagation
    const worklist: TaintState[] = [];
    const processed = new Map<string, number>(); // key → exclusionSize at processing

    // Seed worklist with source occurrences
    for (const source of sources) {
      // Find the def points for the source binding
      const defKey = this.makeKey(source.point.blockIndex, source.point.stmtIndex);
      const defFacts = defUseIndex.get(defKey);

      if (defFacts && defFacts.length > 0) {
        // Taint the def sites of the source statement
        const defSites = this.getDefSites(cfg, source.point.blockIndex, source.point.stmtIndex);
        for (const defSite of defSites) {
          const state: TaintState = {
            bindingIdx: defSite.bindingIdx,
            point: {
              blockIndex: source.point.blockIndex,
              stmtIndex: defSite.stmtIndex,
              line: source.point.line,
            },
            // **A neutraliser on the source's own statement has already run when the value is created**, and this is
            // the read that needs no propagation to see it: `int id = Integer.parseInt(request.getParameter("id"))`
            // is one statement, so the flow from the parameter into `id` never leaves it. The seed carried an empty
            // exclusion set, and the neutraliser was only ever consulted on the statements the value travelled *to* —
            // so the one statement it could not reach was the one it sat on.
            exclusions: this.neutralizedAt(
              sanitizerIndex,
              defSite.stmtIndex,
              cfg.bindings[defSite.bindingIdx]?.name,
            ),
            source,
            viaCall: false,
            processedSize: 0,
            viaBlocks: [source.point.blockIndex],
          };
          worklist.push(state);
        }
      }

      // Rule (b): Statement-local source→sink (same statement)
      this.checkStatementLocal(cfg, source, sinkIndex, sanitizerIndex, findings);
    }

    // Worklist iteration
    let iteration = 0;
    while (worklist.length > 0 && iteration < this.config.maxIterations) {
      iteration++;
      const state = worklist.shift()!;

      // Track processed state
      const stateKey = this.stateKey(state);
      const prevSize = processed.get(stateKey);
      if (prevSize !== undefined && prevSize <= state.exclusions.size) {
        continue; // Already processed same or more exclusions
      }
      processed.set(stateKey, state.exclusions.size);

      // Find uses of this tainted binding → propagate to defs at the use site
      const defKey = this.makeKey(state.point.blockIndex, state.point.stmtIndex);
      const uses = defUseIndex.get(defKey);

      if (!uses || uses.length === 0) continue;
      factsProcessed += uses.length;

      for (const use of uses) {
        // **A neutraliser on this statement runs before the call on it does.** `db.query(escape(req.body.id))` is one
        // statement: the sink and the neutraliser are both filed there, and the neutraliser is the inner expression.
        // The exclusions were accumulated *after* the sink was checked, so a statement that neutralised its own
        // argument reported the flow as live — which is what a report full of already-safe code looks like.
        const useSanitizerKey = this.makeKey(use.use.blockIndex, use.use.stmtIndex);
        const sanitizers = sanitizerIndex.get(useSanitizerKey);

        let newExclusions = state.exclusions;
        if (sanitizers && sanitizers.length > 0) {
          // Union of neutralized kinds from the local neutralisers **that clean this value**. A neutraliser with no
          // readable arguments keeps the statement-level reading; one that names its arguments cleans only those, so
          // `println("prefix " + bar + encodeForHTML(param))` no longer reports `bar` as escaped.
          const neutralized = new Set(state.exclusions);
          const carriedName = cfg.bindings[state.bindingIdx]?.name;
          for (const san of sanitizers) {
            if (!cleansValue(san, carriedName)) continue;
            for (const kind of san.neutralizedKinds) {
              neutralized.add(kind);
            }
          }
          if (neutralized.size > state.exclusions.size) {
            newExclusions = neutralized;
            sanitizerKills++;
          }
        }

        // Check for sink at the use site
        const sinkKey = this.makeKey(use.use.blockIndex, use.use.stmtIndex);
        const sinks = sinkIndex.get(sinkKey);

        if (sinks && sinks.length > 0) {
          for (const sink of sinks) {
            // Build path trace from the propagated state's block trace
            const path = this.buildBlockPath(state);

            // **The state's own exclusions decide, and nothing else does.** They were accumulated where a neutraliser
            // was met on the way here, per sink kind, so a finding is sanitized exactly when the value that reached
            // this sink passed through a neutraliser for *this* kind. Asking the whole statement range instead — which
            // is what the previous version did, through `isNeutralized` — made every `PreparedStatement.setString(1,
            // "constant")` on the same path vouch for a query built by concatenation two lines above it.
            const sanitized = newExclusions.has(sink.kind);

            findings.push({
              id: `taint-${state.source.point.blockIndex}-${use.use.blockIndex}-${findings.length}`,
              source: state.source,
              sink,
              path,
              hops: path.length,
              sanitized,
              truncated: path.length >= this.config.maxPathLength,
              interproc: state.viaCall,
              confidence: this.computeConfidence(state, use, path.length),
            });

            // The cap exists to stop one source from filling the result. A neutralised flow is not a result a reader
            // can act on, so it does not count against the budget.
            if (!sanitized) {
              liveFindings++;
              if (liveFindings >= this.config.maxFindingsPerSource) break;
            }
          }
        }

        // Propagate taint: taint the defs produced by the use statement
        const useDefSites = this.getDefSites(cfg, use.use.blockIndex, use.use.stmtIndex);
        for (const defSite of useDefSites) {
          const newState: TaintState = {
            bindingIdx: defSite.bindingIdx,
            point: {
              blockIndex: use.use.blockIndex,
              stmtIndex: defSite.stmtIndex,
              line: use.use.line,
            },
            exclusions: newExclusions,
            source: state.source,
            viaCall: state.viaCall,
            processedSize: 0,
            viaBlocks: [...state.viaBlocks, use.use.blockIndex],
          };

          // Check if this state is worth processing (monotone: always enqueue if new exclusions are fewer)
          const nsKey = this.stateKey(newState);
          const nsPrev = processed.get(nsKey);
          if (nsPrev === undefined || newState.exclusions.size < nsPrev) {
            worklist.push(newState);
          }
        }
      }
    }

    return {
      functionName: cfg.functionName,
      filePath: cfg.filePath,
      findings,
      sanitizerKills,
      factsProcessed,
      durationMs: performance.now() - startTime,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private collectSources(cfg: FunctionCfg): TaintSourceOccurrence[] {
    return [...cfg.stmtFacts.sourceSites.values()];
  }

  private buildDefUseIndex(facts: readonly DefUseFact[]): Map<number, DefUseFact[]> {
    const index = new Map<number, DefUseFact[]>();
    for (const fact of facts) {
      const key = this.makeKey(fact.def.blockIndex, fact.def.stmtIndex);
      let bucket = index.get(key);
      if (!bucket) {
        bucket = [];
        index.set(key, bucket);
      }
      bucket.push(fact);
    }
    return index;
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

  private checkStatementLocal(
    cfg: FunctionCfg,
    source: TaintSourceOccurrence,
    sinkIndex: Map<number, TaintSinkOccurrence[]>,
    sanitizerIndex: Map<number, SanitizerOccurrence[]>,
    findings: TaintFlowFinding[],
  ): void {
    const key = this.makeKey(source.point.blockIndex, source.point.stmtIndex);
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
          source.point.stmtIndex,
          sink.kind,
          cfg.bindings[source.bindingIdx]?.name,
        ),
        truncated: false,
        interproc: false,
        confidence: 0.9, // Statement-local is high confidence
      });
    }
  }

  private getDefSites(
    cfg: FunctionCfg,
    blockIndex: number,
    stmtIndex: number,
  ): Array<{ bindingIdx: number; stmtIndex: number }> {
    const key = this.makeKey(blockIndex, stmtIndex);
    const defs = cfg.stmtFacts.defs.get(key);
    if (!defs) return [];
    return defs.map((d) => ({
      bindingIdx: d.bindingIdx,
      stmtIndex: d.point.stmtIndex,
    }));
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

  private computeConfidence(state: TaintState, _use: DefUseFact, pathLength: number): number {
    let confidence = 0.8;
    // Inter-procedural taint (viaCall === true) is not yet implemented, so the
    // ×0.7 call-crossing factor is intentionally omitted.
    if (state.exclusions.size > 0) confidence *= 0.5;
    if (pathLength > 5) confidence *= 0.8;
    if (pathLength > 10) confidence *= 0.6;
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  private makeKey(block: number, stmt: number): number {
    return block * 1024 + stmt;
  }

  private stateKey(state: TaintState): string {
    return `${state.bindingIdx}:${state.point.blockIndex}:${state.point.stmtIndex}`;
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
  /**
   * Every sink kind neutralised on one statement **for the value named `carriedName`**.
   *
   * A neutraliser that names its arguments contributes only when one of them is the value being carried; one whose
   * arguments could not be read contributes always, because the statement-level reading is the one every provider
   * before this could express.
   */
  private neutralizedAt(
    sanitizerIndex: Map<number, SanitizerOccurrence[]>,
    stmtIndex: number,
    carriedName: string | undefined,
  ): Set<string> {
    const kinds = new Set<string>();
    for (const occurrence of sanitizerIndex.get(stmtIndex) ?? []) {
      if (!cleansValue(occurrence, carriedName)) continue;
      for (const kind of occurrence.neutralizedKinds) kinds.add(kind);
    }
    return kinds;
  }

  private isNeutralized(
    sanitizerIndex: Map<number, SanitizerOccurrence[]>,
    stmtIndex: number,
    sinkKind: string,
    carriedName: string | undefined,
  ): boolean {
    for (const occurrence of sanitizerIndex.get(stmtIndex) ?? []) {
      if (!occurrence.neutralizedKinds.has(sinkKind)) continue;
      if (!cleansValue(occurrence, carriedName)) continue;
      return true;
    }
    return false;
  }
}
