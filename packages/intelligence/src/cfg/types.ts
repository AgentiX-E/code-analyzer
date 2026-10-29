import type { CallSite } from '@code-analyzer/shared';

// @code-analyzer/intelligence — Control Flow Graph Data Model
// Core types for CFG-based program analysis: PDG, reaching definitions, taint tracking.
//
// References:
//   - Cytron, Ferrante, Rosen, Wegman & Zadeck. "Efficiently Computing Static
//     Single Assignment Form and the Control Dependence Graph." TOPLAS 1991.
//   - Cooper, Harvey & Kennedy. "A Simple, Fast Dominance Algorithm." 2001.
//   - Sharir & Pnueli. "Two Approaches to Interprocedural Data Flow Analysis." 1981.

/** Unique identifier for a program point: block index + statement index within block. */
export interface ProgramPoint {
  readonly blockIndex: number;
  readonly stmtIndex: number;
  readonly line: number;
}

/** A basic block in a function's control flow graph. */
export interface BasicBlock {
  /** Zero-based block index within the function. */
  readonly index: number;
  /** Start line of this block (1-based, inclusive). */
  readonly startLine: number;
  /** End line of this block (1-based, inclusive). */
  readonly endLine: number;
  /** Number of statements in this block. */
  readonly statementCount: number;
  /** Whether this block is a function entry point. */
  readonly isEntry: boolean;
  /** Whether this block is a function exit point (return/throw). */
  readonly isExit: boolean;
}

/** Kinds of CFG edges. */
export type CfgEdgeKind =
  | 'seq' // Sequential fall-through
  | 'cond-true' // True branch of a conditional
  | 'cond-false' // False branch of a conditional
  | 'loop-back' // Back-edge from loop end to header
  | 'throw' // Exception edge
  | 'return' // Return from function
  | 'switch-case' // Switch case fall-through
  | 'fallthrough'; // Implicit fall-through

/** A directed edge in the CFG. */
export interface CfgEdge {
  /** Source block index. */
  readonly from: number;
  /** Target block index. */
  readonly to: number;
  /** Edge kind. */
  readonly kind: CfgEdgeKind;
}

/** Kinds of variable bindings. */
export type BindingKind = 'param' | 'local' | 'captured' | 'global' | 'synthetic';

/** A variable binding (definition site). */
export interface BindingEntry {
  /** Binding index (position in the function's binding table). */
  readonly index: number;
  /** Variable name. */
  readonly name: string;
  /** Binding kind. */
  readonly kind: BindingKind;
  /** Declaration line (1-based). */
  readonly declLine: number;
  /** Declaration column (1-based). */
  readonly declColumn: number;
  /** Whether this is a synthetic binding (e.g., implicit 'this'). */
  readonly synthetic: boolean;
  /**
   * Position among the function's parameters, when the provider recorded it.
   *
   * **A parameter is an argument position, and position is the only thing a caller's call site agrees with.** The
   * previous rule was "declared on the signature's first line", which is right for `void m(int a, int b)` and wrong
   * for `void doPost(HttpServletRequest request,\n HttpServletResponse response)` — the wrapped signature every
   * servlet in the corpus uses, where the parameters are declared on the *second* line and none were found at all.
   */
  readonly parameterIndex?: number;
}

/** A definition site (variable is assigned). */
export interface DefinitionSite {
  /** Program point of the definition. */
  readonly point: ProgramPoint;
  /** Binding index being defined. */
  readonly bindingIdx: number;
  /** Whether this is a MAY-def (conservative) or MUST-def (killing). */
  readonly kind: 'must' | 'may';
}

/** A use site (variable is read). */
export interface UseSite {
  /** Program point of the use. */
  readonly point: ProgramPoint;
  /** Binding index being used. */
  readonly bindingIdx: number;
}

/** A single matched source occurrence in the code. */
export interface TaintSourceOccurrence {
  /** The binding carrying taint (parameter or call-result). */
  readonly bindingIdx: number;
  /** Where the source occurs. */
  readonly point: ProgramPoint;
  /** Source category (e.g., 'remote-input', 'file-read', 'database-input'). */
  readonly category: string;
  /** Human-readable source description. */
  readonly description: string;
  /** Line of the source. */
  readonly line: number;
  /**
   * The function the value actually came from, when this file received it rather than read it.
   *
   * **A callee's own read is a source in its caller, and the caller is not where it happened.** `bar = helper(request)`
   * puts a tainted value at the caller's binding, and reporting that as a flow that starts in the caller is a flow
   * whose origin a reader cannot find - the line the report names holds a call, not a read. Absent means the source is
   * this file's own.
   */
  readonly origin?: string;
}

/** A single matched sink occurrence in the code. */
export interface TaintSinkOccurrence {
  /** Where the sink occurs. */
  readonly point: ProgramPoint;
  /** Sink category (e.g., 'sql-injection', 'command-injection'). */
  readonly kind: string;
  /** CWE identifier if applicable. */
  readonly cweId?: string;
  /** Human-readable sink description. */
  readonly description: string;
  /** Line of the sink. */
  readonly line: number;
}

/** A single matched sanitizer occurrence. */
export interface SanitizerOccurrence {
  /** Where the sanitizer occurs. */
  readonly point: ProgramPoint;
  /** Sink categories neutralized by this sanitizer. */
  readonly neutralizedKinds: ReadonlySet<string>;
  /**
   * The values this neutraliser cleans, by name; **absent** when its arguments could not be read at all.
   *
   * **Neutralisation is per value, and the statement is only the approximation.** A call that escapes one argument and
   * passes another through untouched is one statement, and treating the statement as clean loses the flow through the
   * second. Empty keeps the statement-level reading for a provider that cannot say.
   */
  readonly neutralizedNames?: ReadonlySet<string>;
  /** Human-readable sanitizer description. */
  readonly description: string;
}

/** Statement-level facts for analysis. */
export interface StatementFacts {
  /** Indexed by `blockIndex * STRIDE + stmtIndex`. */
  readonly defs: ReadonlyMap<number, readonly DefinitionSite[]>;
  /** Indexed by `blockIndex * STRIDE + stmtIndex`. */
  readonly uses: ReadonlyMap<number, readonly UseSite[]>;
  /** Per-statement source occurrences. */
  readonly sourceSites: ReadonlyMap<number, TaintSourceOccurrence>;
  /** Per-statement sink occurrences. */
  readonly sinkSites: ReadonlyMap<number, TaintSinkOccurrence>;
  /** Per-statement sanitizer occurrences. */
  readonly sanitizerSites: ReadonlyMap<number, SanitizerOccurrence>;
  /**
   * Definitions whose value the file's own arithmetic decides, by statement index.
   *
   * **A definition here does not carry taint, because there is nothing in it to carry.** `bar = (7 * 18) + num > 200 ?
   * "constant" : param` gives `bar` one value that is not `param`'s, and a model that treats every definition as a
   * may-definition reports the flow anyway. **Absent means the analysis has no reachability information**, which is the
   * conservative direction: every definition stays a may-definition and nothing is suppressed on a guess.
   */
  readonly constantDefs?: ReadonlyMap<number, ReadonlySet<number>>;
  /**
   * 1-based lines no execution path reaches, because a condition that decides them is constant.
   *
   * **Lines rather than statements, because a dead arm is a range**: `if (false) { a(); b(); }` closes two statements
   * that share no definition and no sink. Absent means nothing is known to be dead.
   */
  readonly unreachableLines?: ReadonlySet<number>;
  /**
   * 1-based lines that hand a value back to the caller.
   *
   * **Nobody recorded a `return` until this existed.** Every provider captured declarations, assignments, calls and
   * loops; `return bar;` captured nothing at all, so the value a function gives back had no use site, no name could be
   * seen leaving a function, and the whole inter-procedural return channel was empty by construction rather than by
   * policy. **Absent means the provider cannot read returns**, and an analysis must then say nothing about what a call
   * returns — which is the conservative direction, and different from a function with no return at all.
   */
  readonly returnLines?: ReadonlySet<number>;
}

/** A complete function CFG with all analysis data. */
export interface FunctionCfg {
  /** Function qualified name. */
  readonly functionName: string;
  /** File path containing this function. */
  readonly filePath: string;
  /** Start line of the function definition. */
  readonly startLine: number;
  /** Start column of the function definition. */
  readonly startColumn: number;
  /** Basic blocks in the CFG. */
  readonly blocks: readonly BasicBlock[];
  /** CFG edges between blocks. */
  readonly edges: readonly CfgEdge[];
  /** Variable bindings. */
  readonly bindings: readonly BindingEntry[];
  /**
   * The binding indices of this function's parameters, in order.
   *
   * A parameter is the position a taint wave arrives as, and a sink receives it as an argument - so the summary
   * needs to know which bindings are parameters and in what order, and no provider recorded that on the binding.
   */
  readonly parameterBindings?: readonly number[];
  /** Per-statement facts (defs, uses, sources, sinks, sanitizers). */
  readonly stmtFacts: StatementFacts;
  /** Index of the entry block. */
  readonly entryIndex: number;
  /** Index of the exit block (or -1 if none). */
  readonly exitIndex: number;
  /**
   * Call sites inside this function, in CFG coordinates.
   *
   * Optional and additive: the CFG's parsers do not populate it yet, so every existing construction stays valid.
   * It exists because inter-procedural taint had no way to learn that one function calls another — the summary
   * builder was fabricating call-argument entries from path blocks, with an empty callee name, because the data it
   * needed was not in this model.
   */
  readonly callSites?: readonly CallSite[];

  /**
   * The writes whose value this function followed into a container and back out.
   *
   * **This is the list that replaces "lost".** A value handed to `map.put("k", param)` is not lost to the program, only
   * to a model with no containers; a slot that some read in the same function resolves is a value with a destination,
   * and the summary may then answer the question instead of declining it. Keyed `${stmtIndex}:${bindingIdx}`, the same
   * coordinate `onLost` reports.
   *
   * Absent means no container was followed, which leaves every such write lost and the summary as conservative as it
   * was before containers existed.
   */
  readonly containerFollowed?: ReadonlySet<string>;
}

// `CallSite` lives in @code-analyzer/shared: the analyser builds them and this package consumes them, and
// neither package depends on the other.

// ---------------------------------------------------------------------------
// Reaching Definitions Types
// ---------------------------------------------------------------------------

/** A reaching definition fact: def-site → use-site for one binding. */
export interface DefUseFact {
  /** Binding index (into FunctionCfg.bindings). */
  readonly bindingIdx: number;
  /** Definition program point. */
  readonly def: ProgramPoint;
  /** Use program point. */
  readonly use: ProgramPoint;
  /** Binding name for readability. */
  readonly bindingName: string;
}

// ---------------------------------------------------------------------------
// Control Dependence Types
// ---------------------------------------------------------------------------

/** Label for control dependence edges ('T' = true branch, 'F' = false branch). */
export type CdgLabel = 'T' | 'F';

/** A control dependence edge. */
export interface ControlDepEdge {
  /** The block whose branch outcome controls execution. */
  readonly controllerBlock: number;
  /** The block that executes only when the controller takes this label. */
  readonly dependentBlock: number;
  /** Branch sense: 'T' (true/switch-case) or 'F' (false). */
  readonly label: CdgLabel;
}

// ---------------------------------------------------------------------------
// Post-dominator Tree
// ---------------------------------------------------------------------------

/** Post-dominator tree for a function. */
export interface PostDomTree {
  /** ipdom[b] = immediate post-dominator of block b, or -1 for the root (EXIT). */
  readonly ipdom: readonly number[];
}

// ---------------------------------------------------------------------------
// Taint Finding Types
// ---------------------------------------------------------------------------

/** A single taint flow finding. */
export interface TaintFlowFinding {
  /** Unique finding identifier. */
  readonly id: string;
  /** Source occurrence that introduced taint. */
  readonly source: TaintSourceOccurrence;
  /** Sink occurrence where taint reaches a dangerous operation. */
  readonly sink: TaintSinkOccurrence;
  /** Block-level path from source to sink. */
  readonly path: readonly number[];
  /** Number of def→use hops. */
  readonly hops: number;
  /** Whether a sanitizer was encountered on the path. */
  readonly sanitized: boolean;
  /** Whether the path was truncated (too long). */
  readonly truncated: boolean;
  /** Whether the taint crossed a call boundary. */
  readonly interproc: boolean;
  /** Confidence score (0.0 - 1.0). */
  readonly confidence: number;
}

/** One value a function hands back, and what it carries. */
export interface TaintReturnFlow {
  /** The occurrence that introduced the value. */
  readonly source: TaintSourceOccurrence;
  /** 1-based line of the `return` that hands it back. */
  readonly line: number;
  /** Sink kinds neutralised on every path from the source to this return. */
  readonly neutralized: ReadonlySet<string>;
}

/** Taint analysis result for a function. */
export interface TaintFunctionResult {
  /** Function name. */
  readonly functionName: string;
  /** File path. */
  readonly filePath: string;
  /** Taint flow findings. */
  readonly findings: readonly TaintFlowFinding[];
  /**
   * Every `return` a tracked value can leave by.
   *
   * This is the callee half of every inter-procedural question, and it is the half that could not be asked before:
   * `bar = helper(param)` is only precise when the callee can say whether its own returns read `param`, and the only
   * place that answer exists is inside the callee.
   */
  readonly returnFlows: readonly TaintReturnFlow[];
  /** Sanitizer kills found. */
  readonly sanitizerKills: number;
  /** Total def→use facts processed. */
  readonly factsProcessed: number;
  /** Processing time in milliseconds. */
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// PDG Query Types
// ---------------------------------------------------------------------------

/** PDG query for control dependence. */
export interface PdgControlQuery {
  /** What block do we want control dependents for? */
  readonly controllerBlock: number;
  /** Return dependents (branched-from) or controllers (branch-into)? */
  readonly direction: 'dependents' | 'controllers';
}

/** PDG query for data dependence. */
export interface PdgDataQuery {
  /** Binding index to query. */
  readonly bindingIdx: number;
  /** Block index to query. */
  readonly blockIndex: number;
  /** Statement index within block. */
  readonly stmtIndex: number;
  /** Return defs (where does value go) or uses (where did value come from)? */
  readonly direction: 'defs' | 'uses';
}

/** Result of a PDG query. */
export interface PdgQueryResult {
  /** Control dependence edges matching the query. */
  readonly controlEdges: readonly ControlDepEdge[];
  /** Reaching definition facts matching the query. */
  readonly dataFacts: readonly DefUseFact[];
  /** Whether results were truncated. */
  readonly truncated: boolean;
}
