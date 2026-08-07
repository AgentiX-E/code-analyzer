// @code-analyzer/analyzer — Control Flow Graph Builder
// Builds CFGs from AST captures (UnifiedCapture[] from the pipeline).
// Groups captures by function/method, identifies control flow boundaries,
// and constructs basic blocks with successor/predecessor edges.

import type { UnifiedCapture } from '@code-analyzer/shared';
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { BasicBlock, ControlFlowGraph } from './cfg-types.js';

/**
 * Control flow boundary information for a block.
 */
interface BoundaryInfo {
  type: 'if' | 'else' | 'for' | 'while' | 'switch' | 'case' | 'default' | 'try' | 'catch' | 'finally' | 'return' | 'throw' | 'break' | 'continue';
  line: number;
  /** For if/while/for: line of the matching end/close brace */
  endLine?: number;
  /** For if: line of the else clause; for case: line of next case/break */
  nextLine?: number;
  /** For case/default: the switch boundary this belongs to */
  switchBoundary?: BoundaryInfo;
}

/**
 * Builder that constructs Control Flow Graphs from unified captures.
 * Handles if/else, switch, for/while loops, and try/catch blocks.
 */
export class CfgBuilder {
  private nextBlockId: number;

  constructor() {
    this.nextBlockId = 0;
  }

  /**
   * Build CFGs for all functions found in the given captures.
   * Groups captures by function scope and builds one CFG per function.
   *
   * @param captures - UnifiedCapture array from the parse phase
   * @param filePath - Source file path for the CFG
   * @returns Array of ControlFlowGraphs, one per function/method
   */
  buildFromCaptures(captures: UnifiedCapture[], filePath: string): ControlFlowGraph[] {
    this.nextBlockId = 0;
    const functions = this.groupByFunction(captures);
    return functions.map(({ name, funcCaptures }) =>
      this.buildFunctionCfg(name, funcCaptures, filePath),
    );
  }

  /**
   * Build a CFG from a manually-defined block structure.
   * Used for testing and for programmatic CFG construction.
   *
   * @param functionName - Name of the function
   * @param filePath - Source file path
   * @param blocks - Array of basic blocks with successors defined
   * @param entryBlockId - ID of the entry block (default: first block's id)
   * @param exitBlockId - ID of the exit block (default: last block's id)
   * @returns Constructed ControlFlowGraph
   */
  buildFromBlocks(
    functionName: string,
    filePath: string,
    blocks: Array<Omit<BasicBlock, 'predecessors'>>,
    entryBlockId?: number,
    exitBlockId?: number,
  ): ControlFlowGraph {
    // Compute predecessors from successors
    for (const block of blocks) {
      (block as BasicBlock).predecessors = [];
    }
    for (const block of blocks) {
      for (const succId of block.successors) {
        const succBlock = blocks.find((b) => b.id === succId);
        if (succBlock) {
          (succBlock as BasicBlock).predecessors.push(block.id);
        }
      }
    }

    return {
      functionName,
      filePath,
      blocks: blocks as BasicBlock[],
      entryBlockId: entryBlockId ?? blocks[0]?.id ?? 0,
      exitBlockId: exitBlockId ?? blocks[blocks.length - 1]?.id ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: Build CFG from captures
  // ---------------------------------------------------------------------------

  /**
   * Group captures by their containing function/method.
   */
  private groupByFunction(
    captures: UnifiedCapture[],
  ): Array<{ name: string; funcCaptures: UnifiedCapture[] }> {
    // Find function/method definitions to establish scope boundaries
    const funcDefs = captures.filter(
      (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF || c.tag === CAPTURE_TAGS.METHOD_DEF,
    );

    if (funcDefs.length === 0) {
      // No functions found, treat all captures as one scope
      return [{ name: '<module>', funcCaptures: captures }];
    }

    // Sort by start line
    funcDefs.sort((a, b) => a.startLine - b.startLine);

    const functions: Array<{ name: string; funcCaptures: UnifiedCapture[] }> = [];

    for (let i = 0; i < funcDefs.length; i++) {
      const funcDef = funcDefs[i]!;
      const funcEndLine = funcDef.endLine;
      const nextFuncStart = funcDefs[i + 1]?.startLine ?? Infinity;

      // Collect captures within this function's line range
      const funcCaptures = captures.filter(
        (c) => c.startLine >= funcDef.startLine && c.endLine <= funcEndLine && c.endLine < nextFuncStart,
      );

      functions.push({
        name: funcDef.name ?? funcDef.text ?? `func_${i}`,
        funcCaptures,
      });
    }

    return functions;
  }

  /**
   * Build a CFG for a single function from its captures.
   */
  private buildFunctionCfg(
    functionName: string,
    captures: UnifiedCapture[],
    filePath: string,
  ): ControlFlowGraph {
    // Sort captures by line number
    const sorted = [...captures].sort((a, b) => a.startLine - b.startLine);

    if (sorted.length === 0) {
      return this.createEmptyCfg(functionName, filePath);
    }

    // Identify control flow boundaries
    const boundaries = this.identifyBoundaries(sorted);

    // Build basic blocks
    const blocks = this.createBlocks(sorted, boundaries);

    // Compute edges
    this.computeEdges(blocks, boundaries);

    const entryId = blocks[0]?.id ?? 0;
    const exitId = blocks[blocks.length - 1]?.id ?? 0;

    return {
      functionName,
      filePath,
      blocks,
      entryBlockId: entryId,
      exitBlockId: exitId,
    };
  }

  /**
   * Identify control flow boundaries from captures.
   * Scans for keywords that create control flow splits.
   */
  private identifyBoundaries(captures: UnifiedCapture[]): BoundaryInfo[] {
    const boundaries: BoundaryInfo[] = [];
    const lines = new Set<number>();

    for (const cap of captures) {
      lines.add(cap.startLine);
    }

    // Use text content to identify control flow structures
    const fullText = captures
      .map((c) => ({ line: c.startLine, text: c.text }))
      .sort((a, b) => a.line - b.line);

    // Track switch boundaries for case/default grouping
    let currentSwitch: BoundaryInfo | null = null;

    for (const cap of captures) {
      const text = cap.text.trim().toLowerCase();

      // Detect if statements
      if (text.startsWith('if ') || text === 'if') {
        boundaries.push({ type: 'if', line: cap.startLine, endLine: cap.endLine });
      }

      // Detect else statements
      if (text.startsWith('else') || text === 'else') {
        boundaries.push({ type: 'else', line: cap.startLine, endLine: cap.endLine });
      }

      // Detect for loops
      if (text.startsWith('for ') || text === 'for') {
        boundaries.push({ type: 'for', line: cap.startLine, endLine: cap.endLine });
      }

      // Detect while loops
      if (text.startsWith('while ') || text === 'while') {
        boundaries.push({ type: 'while', line: cap.startLine, endLine: cap.endLine });
      }

      // Detect switch statements
      if (text.startsWith('switch ') || text === 'switch') {
        currentSwitch = { type: 'switch', line: cap.startLine, endLine: cap.endLine };
        boundaries.push(currentSwitch);
      }

      // Detect case/default
      if (text.startsWith('case ') || text === 'case') {
        const caseB: BoundaryInfo = {
          type: 'case',
          line: cap.startLine,
          switchBoundary: currentSwitch ?? undefined,
        };
        boundaries.push(caseB);
      }
      if (text.startsWith('default') || text === 'default:') {
        const defaultB: BoundaryInfo = {
          type: 'default',
          line: cap.startLine,
          switchBoundary: currentSwitch ?? undefined,
        };
        boundaries.push(defaultB);
      }

      // Detect try/catch/finally
      if (text.startsWith('try ') || text === 'try') {
        boundaries.push({ type: 'try', line: cap.startLine, endLine: cap.endLine });
      }
      if (text.startsWith('catch ') || text === 'catch') {
        boundaries.push({ type: 'catch', line: cap.startLine, endLine: cap.endLine });
      }
      if (text.startsWith('finally') || text === 'finally') {
        boundaries.push({ type: 'finally', line: cap.startLine, endLine: cap.endLine });
      }

      // Detect return statements
      if (text.startsWith('return') || text === 'return') {
        boundaries.push({ type: 'return', line: cap.startLine });
      }

      // Detect throw statements
      if (text.startsWith('throw ') || text === 'throw') {
        boundaries.push({ type: 'throw', line: cap.startLine });
      }

      // Detect break/continue
      if (text === 'break' || text === 'break;') {
        boundaries.push({ type: 'break', line: cap.startLine });
      }
      if (text === 'continue' || text === 'continue;') {
        boundaries.push({ type: 'continue', line: cap.startLine });
      }
    }

    // Sort boundaries by line number
    boundaries.sort((a, b) => a.line - b.line);

    return boundaries;
  }

  /**
   * Create basic blocks by grouping statements between control flow boundaries.
   */
  private createBlocks(
    captures: UnifiedCapture[],
    boundaries: BoundaryInfo[],
  ): BasicBlock[] {
    const blocks: BasicBlock[] = [];
    const sortedCaps = [...captures].sort((a, b) => a.startLine - b.startLine);

    // Create a set of boundary lines for quick lookup
    const boundaryLines = new Set(boundaries.map((b) => b.line));

    // Group captures into blocks based on control flow boundaries
    let currentBlockCaptures: UnifiedCapture[] = [];
    let labelCounter = 0;

    // Find the minimum line number among all captures
    const minLine = sortedCaps.length > 0 ? sortedCaps[0]!.startLine : 1;

    // Build a map of line -> captures for block assignment
    const lineToCaptures = new Map<number, UnifiedCapture[]>();
    for (const cap of sortedCaps) {
      const existing = lineToCaptures.get(cap.startLine) ?? [];
      existing.push(cap);
      lineToCaptures.set(cap.startLine, existing);
    }

    // Get sorted unique line numbers
    const uniqueLines = [...new Set(sortedCaps.map((c) => c.startLine))].sort((a, b) => a - b);

    for (const line of uniqueLines) {
      const lineCaps = lineToCaptures.get(line) ?? [];

      // Check if this line starts a new control flow boundary
      const boundaryAtLine = boundaries.find((b) => b.line === line);

      if (boundaryAtLine && boundaryAtLine.type !== 'case' && boundaryAtLine.type !== 'default') {
        // Flush current block if it has captures
        if (currentBlockCaptures.length > 0) {
          blocks.push(this.makeBlock(currentBlockCaptures, `block_${labelCounter++}`));
          currentBlockCaptures = [];
        }

        // Create a block for the control flow boundary itself
        currentBlockCaptures.push(...lineCaps);
        const label = `${boundaryAtLine.type}_${labelCounter++}`;
        blocks.push(this.makeBlock(currentBlockCaptures, label));
        currentBlockCaptures = [];
      } else {
        currentBlockCaptures.push(...lineCaps);
      }
    }

    // Flush remaining captures
    if (currentBlockCaptures.length > 0) {
      blocks.push(this.makeBlock(currentBlockCaptures, `block_${labelCounter++}`));
    }

    // If no blocks were created, create a single block
    if (blocks.length === 0) {
      blocks.push({
        id: this.nextBlockId++,
        label: 'entry',
        statements: 0,
        successors: [],
        predecessors: [],
        startLine: minLine,
        endLine: minLine,
      });
    }

    // Post-process: handle case/default blocks within switch
    this.processSwitchBlocks(blocks, boundaries);

    return blocks;
  }

  /**
   * Create a basic block from a set of captures.
   */
  private makeBlock(captures: UnifiedCapture[], label: string): BasicBlock {
    const id = this.nextBlockId++;
    const lines = captures.map((c) => c.startLine);
    return {
      id,
      label,
      statements: captures.length,
      successors: [],
      predecessors: [],
      startLine: lines.length > 0 ? Math.min(...lines) : 0,
      endLine: lines.length > 0 ? Math.max(...captures.map((c) => c.endLine)) : 0,
    };
  }

  /**
   * Process switch blocks: mark case/default blocks as successors of the switch header.
   */
  private processSwitchBlocks(blocks: BasicBlock[], boundaries: BoundaryInfo[]): void {
    const switchBoundaries = boundaries.filter((b) => b.type === 'switch');
    const caseBoundaries = boundaries.filter((b) => b.type === 'case' || b.type === 'default');

    for (const switchB of switchBoundaries) {
      const switchBlock = blocks.find((b) => b.startLine <= switchB.line && b.endLine >= switchB.line);
      if (!switchBlock) continue;

      // Find all case/default blocks within this switch's line range
      const switchCases = caseBoundaries.filter(
        (c) => c.line >= switchB.line && (!switchB.endLine || c.line <= switchB.endLine),
      );

      for (const caseB of switchCases) {
        const caseBlock = blocks.find((b) => b.startLine <= caseB.line && b.endLine >= caseB.line);
        if (caseBlock && caseBlock.id !== switchBlock.id) {
          switchBlock.successors.push(caseBlock.id);
          caseBlock.predecessors.push(switchBlock.id);
        }
      }
    }
  }

  /**
   * Compute successor/predecessor edges between blocks based on boundaries
   * and control flow structure.
   */
  private computeEdges(blocks: BasicBlock[], boundaries: BoundaryInfo[]): void {
    if (blocks.length === 0) return;

    // Default: sequential flow between blocks
    for (let i = 0; i < blocks.length - 1; i++) {
      const current = blocks[i]!;
      const next = blocks[i + 1]!;

      // Check if current block ends with a control flow terminator
      const currentHasBoundary = boundaries.some((b) => b.line >= current.startLine && b.line <= current.endLine);
      const hasReturn = boundaries.some(
        (b) => b.type === 'return' && b.line >= current.startLine && b.line <= current.endLine,
      );
      const hasThrow = boundaries.some(
        (b) => b.type === 'throw' && b.line >= current.startLine && b.line <= current.endLine,
      );

      // If current block has a return/throw, it doesn't fall through
      if (hasReturn || hasThrow) {
        continue;
      }

      // Add sequential edge
      current.successors.push(next.id);
      next.predecessors.push(current.id);
    }

    // Process if/else boundaries: add branch edges
    this.processIfElseEdges(blocks, boundaries);

    // Process for/while boundaries: add loop back-edges
    this.processLoopEdges(blocks, boundaries);

    // Process try/catch/finally boundaries
    this.processTryCatchEdges(blocks, boundaries);
  }

  /**
   * Process if/else edges: add true and false branch edges.
   */
  private processIfElseEdges(blocks: BasicBlock[], boundaries: BoundaryInfo[]): void {
    const ifBoundaries = boundaries.filter((b) => b.type === 'if');
    const elseBoundaries = boundaries.filter((b) => b.type === 'else');

    for (const ifB of ifBoundaries) {
      const ifBlock = blocks.find((b) => b.startLine <= ifB.line && b.endLine >= ifB.line);
      if (!ifBlock) continue;

      // Find the matching else if it exists
      const matchingElse = elseBoundaries.find(
        (e) => e.line > ifB.line && (!ifB.endLine || e.line <= ifB.endLine),
      );

      // Find successor blocks after the if/else
      const ifEndLine = matchingElse ? matchingElse.endLine ?? matchingElse.line : ifB.endLine ?? ifB.line;

      // Find the first block after the if statement's scope
      const thenBlock = blocks.find(
        (b) => b.startLine > ifBlock.endLine && (!matchingElse || b.endLine < matchingElse.line),
      );

      const elseBlock = matchingElse
        ? blocks.find((b) => b.startLine <= matchingElse.line && b.endLine >= matchingElse.line)
        : undefined;

      if (thenBlock) {
        ifBlock.successors.push(thenBlock.id);
        thenBlock.predecessors.push(ifBlock.id);
      }

      if (elseBlock && elseBlock.id !== ifBlock.id) {
        ifBlock.successors.push(elseBlock.id);
        elseBlock.predecessors.push(ifBlock.id);
      }
    }
  }

  /**
   * Process loop edges: add back-edges from loop end to loop header.
   */
  private processLoopEdges(blocks: BasicBlock[], boundaries: BoundaryInfo[]): void {
    const loopBoundaries = boundaries.filter((b) => b.type === 'for' || b.type === 'while');

    for (const loop of loopBoundaries) {
      const loopBlock = blocks.find((b) => b.startLine <= loop.line && b.endLine >= loop.line);
      if (!loopBlock) continue;

      // Find the last block within the loop body (before the loop's end line)
      const loopBodyBlocks = blocks.filter(
        (b) => b.startLine > loopBlock.endLine && (loop.endLine ? b.endLine <= loop.endLine : true),
      );

      if (loopBodyBlocks.length > 0) {
        // Add back edge from last body block to loop header
        const lastBodyBlock = loopBodyBlocks[loopBodyBlocks.length - 1]!;
        lastBodyBlock.successors.push(loopBlock.id);
        loopBlock.predecessors.push(lastBodyBlock.id);
      }

      // Find the exit (first block after loop)
      const exitBlock = blocks.find(
        (b) => b.startLine > (loop.endLine ?? loop.line),
      );

      if (exitBlock) {
        loopBlock.successors.push(exitBlock.id);
        exitBlock.predecessors.push(loopBlock.id);
      }
    }
  }

  /**
   * Process try/catch/finally edges: add exception and normal flow edges.
   */
  private processTryCatchEdges(blocks: BasicBlock[], boundaries: BoundaryInfo[]): void {
    const tryBoundaries = boundaries.filter((b) => b.type === 'try');
    const catchBoundaries = boundaries.filter((b) => b.type === 'catch');
    const finallyBoundaries = boundaries.filter((b) => b.type === 'finally');

    for (const tryB of tryBoundaries) {
      const tryBlock = blocks.find((b) => b.startLine <= tryB.line && b.endLine >= tryB.line);
      if (!tryBlock) continue;

      // Find matching catch blocks
      const matchingCatches = catchBoundaries.filter(
        (c) => c.line > tryB.line && (!tryB.endLine || c.line <= tryB.endLine),
      );

      for (const catchB of matchingCatches) {
        const catchBlock = blocks.find((b) => b.startLine <= catchB.line && b.endLine >= catchB.line);
        if (catchBlock && catchBlock.id !== tryBlock.id) {
          tryBlock.successors.push(catchBlock.id);
          catchBlock.predecessors.push(tryBlock.id);
        }
      }

      // Find matching finally block
      const matchingFinally = finallyBoundaries.find(
        (f) => f.line > tryB.line && (!tryB.endLine || f.line <= tryB.endLine),
      );

      if (matchingFinally) {
        const finallyBlock = blocks.find(
          (b) => b.startLine <= matchingFinally.line && b.endLine >= matchingFinally.line,
        );
        if (finallyBlock && finallyBlock.id !== tryBlock.id) {
          tryBlock.successors.push(finallyBlock.id);
          finallyBlock.predecessors.push(tryBlock.id);
        }
      }
    }
  }

  /**
   * Create an empty CFG for functions with no captures.
   */
  private createEmptyCfg(functionName: string, filePath: string): ControlFlowGraph {
    const entryBlock: BasicBlock = {
      id: this.nextBlockId++,
      label: 'entry',
      statements: 0,
      successors: [],
      predecessors: [],
      startLine: 1,
      endLine: 1,
    };

    return {
      functionName,
      filePath,
      blocks: [entryBlock],
      entryBlockId: entryBlock.id,
      exitBlockId: entryBlock.id,
    };
  }
}
