// @code-analyzer/analyzer — CFG Builder Edge-Linking Tests
// Asserts that control-flow boundaries (switch/if/loop/try) produce the
// correct successor/predecessor edges after block construction.

import { describe, it, expect } from 'vitest';
import { CfgBuilder } from '../cfg/cfg-builder.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

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

function build(captures: UnifiedCapture[]) {
  return new CfgBuilder().buildFromCaptures(captures, 'test.ts')[0]!;
}

function blockAt(cfg: ReturnType<typeof build>, line: number) {
  return cfg.blocks.find((b) => b.startLine === line);
}

describe('CfgBuilder switch edge linking', () => {
  it('links the switch header to each case and default block', () => {
    const cfg = build([
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
    ]);

    const switchBlock = blockAt(cfg, 2)!;
    const case1 = blockAt(cfg, 3)!;
    const case2 = blockAt(cfg, 7)!;
    const defaultBlock = blockAt(cfg, 11)!;

    expect(switchBlock.successors).toEqual(
      expect.arrayContaining([case1.id, case2.id, defaultBlock.id]),
    );
    expect(case1.predecessors).toContain(switchBlock.id);
    expect(case2.predecessors).toContain(switchBlock.id);
    expect(defaultBlock.predecessors).toContain(switchBlock.id);
  });
});

describe('CfgBuilder if/else edge linking', () => {
  it('links the if header to its then and else blocks', () => {
    const cfg = build([
      funcDef('f', 1, 10),
      cap({ startLine: 2, text: 'if (cond)', endLine: 9 }),
      cap({ startLine: 3, text: 'thenStmt()' }),
      cap({ startLine: 4, text: 'else', endLine: 9 }),
      cap({ startLine: 5, text: 'elseStmt()' }),
    ]);

    const ifBlock = blockAt(cfg, 2)!;
    const thenBlock = blockAt(cfg, 3)!;
    const elseBlock = blockAt(cfg, 4)!;

    expect(ifBlock.successors).toEqual(expect.arrayContaining([thenBlock.id, elseBlock.id]));
    expect(thenBlock.predecessors).toContain(ifBlock.id);
    expect(elseBlock.predecessors).toContain(ifBlock.id);
  });

  it('links an if header without else to its then block', () => {
    const cfg = build([
      funcDef('f', 1, 10),
      cap({ startLine: 2, text: 'if (cond)', endLine: 6 }),
      cap({ startLine: 3, text: 'thenStmt()' }),
    ]);

    const ifBlock = blockAt(cfg, 2)!;
    const thenBlock = blockAt(cfg, 3)!;
    expect(ifBlock.successors).toContain(thenBlock.id);
  });
});

describe('CfgBuilder loop edge linking', () => {
  it('adds a back edge from the loop body and an exit edge after the loop', () => {
    const cfg = build([
      funcDef('f', 1, 10),
      cap({ startLine: 2, text: 'for (i=0; i<n; i++)', endLine: 6 }),
      cap({ startLine: 3, text: 'body()' }),
      cap({ startLine: 7, text: 'return' }),
    ]);

    const loopBlock = blockAt(cfg, 2)!;
    const bodyBlock = blockAt(cfg, 3)!;
    const exitBlock = blockAt(cfg, 7)!;

    // Back edge: body -> loop header
    expect(bodyBlock.successors).toContain(loopBlock.id);
    expect(loopBlock.predecessors).toContain(bodyBlock.id);
    // Exit edge: loop header -> block after the loop
    expect(loopBlock.successors).toContain(exitBlock.id);
    expect(exitBlock.predecessors).toContain(loopBlock.id);
  });
});

describe('CfgBuilder try/catch/finally edge linking', () => {
  it('links try to catch blocks', () => {
    const cfg = build([
      funcDef('f', 1, 12),
      cap({ startLine: 2, text: 'try', endLine: 10 }),
      cap({ startLine: 3, text: 'risky()' }),
      cap({ startLine: 5, text: 'catch (e)', endLine: 10 }),
      cap({ startLine: 6, text: 'handle()' }),
    ]);

    const tryBlock = blockAt(cfg, 2)!;
    const catchBlock = blockAt(cfg, 5)!;
    expect(tryBlock.successors).toContain(catchBlock.id);
    expect(catchBlock.predecessors).toContain(tryBlock.id);
  });

  it('links try to a finally block', () => {
    const cfg = build([
      funcDef('f', 1, 12),
      cap({ startLine: 2, text: 'try', endLine: 10 }),
      cap({ startLine: 3, text: 'risky()' }),
      cap({ startLine: 5, text: 'finally', endLine: 10 }),
      cap({ startLine: 6, text: 'cleanup()' }),
    ]);

    const tryBlock = blockAt(cfg, 2)!;
    const finallyBlock = blockAt(cfg, 5)!;
    expect(tryBlock.successors).toContain(finallyBlock.id);
    expect(finallyBlock.predecessors).toContain(tryBlock.id);
  });
});

describe('CfgBuilder defensive branches', () => {
  it('handles case/default boundaries without a surrounding switch', () => {
    const cfg = build([
      funcDef('f', 1, 5),
      cap({ startLine: 2, text: 'case 1', endLine: 3 }),
      cap({ startLine: 3, text: 'default', endLine: 4 }),
    ]);
    expect(cfg.blocks.length).toBeGreaterThan(0);
  });

  it('skips a case block that starts before the case keyword', () => {
    const cfg = build([
      funcDef('f', 1, 10),
      cap({ startLine: 2, text: 'switch (x)', endLine: 8 }),
      cap({ startLine: 3, text: 'foo()' }),
      cap({ startLine: 4, text: 'case 1', endLine: 6 }),
      cap({ startLine: 5, text: 'doOne()' }),
    ]);
    expect(cfg.blocks.length).toBeGreaterThan(0);
  });

  it('handles an if header with no then block before the else', () => {
    const cfg = build([
      funcDef('f', 1, 8),
      cap({ startLine: 2, text: 'if (cond)', endLine: 6 }),
      cap({ startLine: 3, text: 'else', endLine: 6 }),
      cap({ startLine: 4, text: 'elseStmt()' }),
    ]);
    expect(cfg.blocks.length).toBeGreaterThan(0);
  });

  it('handles a loop with no body block', () => {
    const cfg = build([
      funcDef('f', 1, 5),
      cap({ startLine: 2, text: 'for (i=0; i<n; i++)', endLine: 4 }),
    ]);
    expect(cfg.blocks.length).toBeGreaterThan(0);
  });
});
