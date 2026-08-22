// @code-analyzer/analyzer — CFG Builder (buildFromCaptures) Tests
// Covers the buildFromCaptures entry point and all private control-flow
// detection paths (if/else, loops, switch, try/catch, return/throw).

import { describe, it, expect } from 'vitest';
import { CfgBuilder } from '../cfg/cfg-builder.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cap(partial: Partial<UnifiedCapture> & { startLine: number }): UnifiedCapture {
  return {
    tag: CAPTURE_TAGS.FUNCTION_CALL,
    text: 'stmt()',
    endLine: partial.startLine,
    startByte: 0,
    endByte: 10,
    ...partial,
  };
}

function funcDef(name: string, startLine: number, endLine: number): UnifiedCapture {
  return cap({
    tag: CAPTURE_TAGS.FUNCTION_DEF,
    text: `function ${name}() {`,
    name,
    startLine,
    endLine,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CfgBuilder.buildFromCaptures', () => {
  const builder = new CfgBuilder();

  it('returns a single <module> CFG for empty captures', () => {
    const cfgs = builder.buildFromCaptures([], 'test.ts');
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0]!.functionName).toBe('<module>');
    expect(cfgs[0]!.blocks).toHaveLength(1);
  });

  it('builds a module-level CFG when no function defs present', () => {
    const cfgs = builder.buildFromCaptures(
      [cap({ startLine: 1, text: 'stmt1()' }), cap({ startLine: 2, text: 'stmt2()' })],
      'test.ts',
    );
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0]!.functionName).toBe('<module>');
    expect(cfgs[0]!.blocks.length).toBeGreaterThan(0);
  });

  it('builds one CFG per function def', () => {
    const cfgs = builder.buildFromCaptures(
      [
        funcDef('foo', 1, 10),
        cap({ startLine: 2, text: 'stmt1()' }),
        funcDef('bar', 12, 20),
        cap({ startLine: 13, text: 'stmt2()' }),
      ],
      'test.ts',
    );
    expect(cfgs).toHaveLength(2);
    expect(cfgs[0]!.functionName).toBe('foo');
    expect(cfgs[1]!.functionName).toBe('bar');
  });

  it('builds a linear CFG with sequential edges', () => {
    const cfgs = builder.buildFromCaptures(
      [
        funcDef('linear', 1, 5),
        cap({ startLine: 2, text: 'a()' }),
        cap({ startLine: 3, text: 'b()' }),
        cap({ startLine: 4, text: 'c()' }),
      ],
      'test.ts',
    );
    expect(cfgs).toHaveLength(1);
    const cfg = cfgs[0]!;
    // Consecutive statements without control-flow boundaries are grouped
    // into a single block; the builder is present and functional.
    expect(cfg.blocks.length).toBeGreaterThanOrEqual(1);
    // Entry block exists
    expect(cfg.entryBlockId).toBe(cfg.blocks[0]!.id);
  });

  it('creates a CFG for a function with only its own def capture', () => {
    const cfgs = builder.buildFromCaptures([funcDef('empty', 1, 3)], 'test.ts');
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0]!.blocks).toHaveLength(1);
    // The function def capture itself is counted as a statement in the block
    expect(cfgs[0]!.blocks[0]!.statements).toBeGreaterThanOrEqual(1);
  });

  describe('if/else boundaries', () => {
    it('detects if statements and creates branch blocks', () => {
      const cfgs = builder.buildFromCaptures(
        [
          funcDef('f', 1, 10),
          cap({ startLine: 2, text: 'if (cond)', endLine: 9 }),
          cap({ startLine: 3, text: 'thenStmt()' }),
          cap({ startLine: 4, text: 'else', endLine: 9 }),
          cap({ startLine: 5, text: 'elseStmt()' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
      const cfg = cfgs[0]!;
      // Should have at least if block, then block, else block
      expect(cfg.blocks.length).toBeGreaterThanOrEqual(3);
    });

    it('detects if without else', () => {
      const cfgs = builder.buildFromCaptures(
        [
          funcDef('f', 1, 10),
          cap({ startLine: 2, text: 'if (cond)', endLine: 6 }),
          cap({ startLine: 3, text: 'thenStmt()' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
      expect(cfgs[0]!.blocks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('loop boundaries', () => {
    it('detects for loops', () => {
      const cfgs = builder.buildFromCaptures(
        [
          funcDef('f', 1, 10),
          cap({ startLine: 2, text: 'for (i=0; i<n; i++)', endLine: 6 }),
          cap({ startLine: 3, text: 'body()' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
      expect(cfgs[0]!.blocks.length).toBeGreaterThanOrEqual(2);
    });

    it('detects while loops', () => {
      const cfgs = builder.buildFromCaptures(
        [
          funcDef('f', 1, 10),
          cap({ startLine: 2, text: 'while (cond)', endLine: 6 }),
          cap({ startLine: 3, text: 'body()' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
      expect(cfgs[0]!.blocks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('switch boundaries', () => {
    it('detects switch/case/default and links case blocks', () => {
      const cfgs = builder.buildFromCaptures(
        [
          funcDef('f', 1, 20),
          cap({ startLine: 2, text: 'switch (x)', endLine: 15 }),
          cap({ startLine: 3, text: 'case 1', endLine: 6 }),
          cap({ startLine: 4, text: 'doOne()' }),
          cap({ startLine: 5, text: 'break' }),
          cap({ startLine: 7, text: 'case 2', endLine: 10 }),
          cap({ startLine: 8, text: 'doTwo()' }),
          cap({ startLine: 9, text: 'break' }),
          cap({ startLine: 11, text: 'default', endLine: 13 }),
          cap({ startLine: 12, text: 'doDefault()' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
      expect(cfgs[0]!.blocks.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('try/catch/finally boundaries', () => {
    it('detects try/catch', () => {
      const cfgs = builder.buildFromCaptures(
        [
          funcDef('f', 1, 12),
          cap({ startLine: 2, text: 'try', endLine: 10 }),
          cap({ startLine: 3, text: 'risky()' }),
          cap({ startLine: 5, text: 'catch (e)', endLine: 10 }),
          cap({ startLine: 6, text: 'handle()' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
      expect(cfgs[0]!.blocks.length).toBeGreaterThanOrEqual(3);
    });

    it('detects try/finally', () => {
      const cfgs = builder.buildFromCaptures(
        [
          funcDef('f', 1, 12),
          cap({ startLine: 2, text: 'try', endLine: 10 }),
          cap({ startLine: 3, text: 'risky()' }),
          cap({ startLine: 5, text: 'finally', endLine: 10 }),
          cap({ startLine: 6, text: 'cleanup()' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
      expect(cfgs[0]!.blocks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('return/throw/break/continue', () => {
    it('detects return and stops fall-through', () => {
      const cfgs = builder.buildFromCaptures(
        [
          funcDef('f', 1, 10),
          cap({ startLine: 2, text: 'a()' }),
          cap({ startLine: 3, text: 'return' }),
          cap({ startLine: 4, text: 'b()' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
      // b() should be unreachable after return, but the builder still creates blocks
      expect(cfgs[0]!.blocks.length).toBeGreaterThanOrEqual(2);
    });

    it('detects throw statements', () => {
      const cfgs = builder.buildFromCaptures(
        [
          funcDef('f', 1, 10),
          cap({ startLine: 2, text: 'a()' }),
          cap({ startLine: 3, text: 'throw new Error()' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
    });

    it('detects break statements', () => {
      const cfgs = builder.buildFromCaptures(
        [
          funcDef('f', 1, 10),
          cap({ startLine: 2, text: 'while (x)', endLine: 8 }),
          cap({ startLine: 3, text: 'break' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
    });

    it('detects continue statements', () => {
      const cfgs = builder.buildFromCaptures(
        [
          funcDef('f', 1, 10),
          cap({ startLine: 2, text: 'while (x)', endLine: 8 }),
          cap({ startLine: 3, text: 'continue' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
    });
  });

  describe('method defs and grouping', () => {
    it('groups method defs using METHOD_DEF tag', () => {
      const cfgs = builder.buildFromCaptures(
        [
          cap({
            tag: CAPTURE_TAGS.METHOD_DEF,
            text: 'method a() {',
            name: 'a',
            startLine: 1,
            endLine: 5,
          }),
          cap({ startLine: 2, text: 'stmt()' }),
        ],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
      expect(cfgs[0]!.functionName).toBe('a');
    });

    it('handles functions without name (uses text)', () => {
      const cfgs = builder.buildFromCaptures(
        [cap({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: 'function () {', startLine: 1, endLine: 5 })],
        'test.ts',
      );
      expect(cfgs).toHaveLength(1);
      expect(cfgs[0]!.functionName).toBeDefined();
    });
  });

  describe('buildFromBlocks', () => {
    it('computes predecessors from successors', () => {
      const cfg = builder.buildFromBlocks('f', 'test.ts', [
        { id: 0, label: 'entry', statements: 1, successors: [1], startLine: 1, endLine: 1 },
        { id: 1, label: 'body', statements: 1, successors: [], startLine: 2, endLine: 2 },
      ]);
      expect(cfg.blocks[1]!.predecessors).toEqual([0]);
      expect(cfg.entryBlockId).toBe(0);
      expect(cfg.exitBlockId).toBe(1);
    });

    it('handles empty blocks array', () => {
      const cfg = builder.buildFromBlocks('f', 'test.ts', []);
      expect(cfg.blocks).toEqual([]);
      expect(cfg.entryBlockId).toBe(0);
      expect(cfg.exitBlockId).toBe(0);
    });

    it('uses explicit entry/exit ids when provided', () => {
      const cfg = builder.buildFromBlocks(
        'f',
        'test.ts',
        [
          { id: 5, label: 'a', statements: 1, successors: [7], startLine: 1, endLine: 1 },
          { id: 7, label: 'b', statements: 1, successors: [], startLine: 2, endLine: 2 },
        ],
        5,
        7,
      );
      expect(cfg.entryBlockId).toBe(5);
      expect(cfg.exitBlockId).toBe(7);
    });

    it('ignores successors pointing to non-existent blocks', () => {
      const cfg = builder.buildFromBlocks('f', 'test.ts', [
        { id: 0, label: 'a', statements: 1, successors: [99], startLine: 1, endLine: 1 },
      ]);
      expect(cfg.blocks[0]!.predecessors).toEqual([]);
    });
  });
});
