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
  /** Per-statement facts (defs, uses, sources, sinks, sanitizers). */
  readonly stmtFacts: StatementFacts;
  /** Index of the entry block. */
  readonly entryIndex: number;
  /** Index of the exit block (or -1 if none). */
  readonly exitIndex: number;
}

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

/** Taint analysis result for a function. */
export interface TaintFunctionResult {
  /** Function name. */
  readonly functionName: string;
  /** File path. */
  readonly filePath: string;
  /** Taint flow findings. */
  readonly findings: readonly TaintFlowFinding[];
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
