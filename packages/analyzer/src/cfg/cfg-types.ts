// @code-analyzer/analyzer — Control Flow Graph Types
// Core type definitions for CFG-based program analysis in the analyzer pipeline.

/**
 * A basic block in a function's control flow graph.
 * Each block represents a linear sequence of statements
 * that are always executed together.
 */
export interface BasicBlock {
  /** Unique block identifier within the CFG. */
  id: number;
  /** Human-readable label (e.g., "entry", "if.then.2", "loop.body.5"). */
  label: string;
  /** Number of statements contained in this block. */
  statements: number;
  /** IDs of blocks that can follow this block (outgoing edges). */
  successors: number[];
  /** IDs of blocks that can reach this block (incoming edges). */
  predecessors: number[];
  /** Start line number (1-based, inclusive). */
  startLine: number;
  /** End line number (1-based, inclusive). */
  endLine: number;
}

/**
 * A complete control flow graph for a single function or method.
 * Contains all basic blocks and the graph structure connecting them.
 */
export interface ControlFlowGraph {
  /** Name of the function/method this CFG represents. */
  functionName: string;
  /** File path containing this function. */
  filePath: string;
  /** All basic blocks in the CFG, indexed by their id. */
  blocks: BasicBlock[];
  /** ID of the entry block (function start). */
  entryBlockId: number;
  /** ID of the exit block (function return). */
  exitBlockId: number;
}
