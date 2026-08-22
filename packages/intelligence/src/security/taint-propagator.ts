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
            exclusions: new Set(),
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
        // Check for sink at the use site
        const sinkKey = this.makeKey(use.use.blockIndex, use.use.stmtIndex);
        const sinks = sinkIndex.get(sinkKey);

        if (sinks && sinks.length > 0) {
          for (const sink of sinks) {
            // Check if this sink kind is excluded
            if (!state.exclusions.has(sink.kind)) {
              // Build path trace from the propagated state's block trace
              const path = this.buildBlockPath(state);

              findings.push({
                id: `taint-${state.source.point.blockIndex}-${use.use.blockIndex}-${findings.length}`,
                source: state.source,
                sink,
                path,
                hops: path.length,
                sanitized: false,
                truncated: path.length >= this.config.maxPathLength,
                interproc: state.viaCall,
                confidence: this.computeConfidence(state, use, path.length),
              });

              if (findings.length >= this.config.maxFindingsPerSource) break;
            }
          }
        }

        // Check for sanitizers at the use site
        const useSanitizerKey = this.makeKey(use.use.blockIndex, use.use.stmtIndex);
        const sanitizers = sanitizerIndex.get(useSanitizerKey);

        let newExclusions = state.exclusions;
        if (sanitizers && sanitizers.length > 0) {
          // Union of neutralized kinds from all local sanitizers
          const neutralized = new Set(state.exclusions);
          for (const san of sanitizers) {
            for (const kind of san.neutralizedKinds) {
              neutralized.add(kind);
            }
          }
          newExclusions = neutralized;
          sanitizerKills++;
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
      let bucket = index.get(key);
      if (!bucket) {
        bucket = [];
        index.set(key, bucket);
      }
      bucket.push(sink);
    }
    return index;
  }

  private buildSanitizerIndex(cfg: FunctionCfg): Map<number, SanitizerOccurrence[]> {
    const index = new Map<number, SanitizerOccurrence[]>();
    for (const [key, san] of cfg.stmtFacts.sanitizerSites) {
      let bucket = index.get(key);
      if (!bucket) {
        bucket = [];
        index.set(key, bucket);
      }
      bucket.push(san);
    }
    return index;
  }

  private checkStatementLocal(
    _cfg: FunctionCfg,
    source: TaintSourceOccurrence,
    sinkIndex: Map<number, TaintSinkOccurrence[]>,
    _sanitizerIndex: Map<number, SanitizerOccurrence[]>,
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
        sanitized: false,
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
    if (state.viaCall) confidence *= 0.7;
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
}
