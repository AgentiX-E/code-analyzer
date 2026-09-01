// @code-analyzer/intelligence — Type Registry Branch Coverage (round 2)
// Reaches the remaining uncovered members of type-registry.ts: the bulk
// registerAll helper, and the typeCount / finalized getters. (functionCount
// is already exercised by buildProjectRegistry in the round-1 suite.)

import { describe, it, expect } from 'vitest';
import { TypeRegistry } from '../lsp/type-registry.js';
import type { RegisteredType, RegisteredFunction } from '../lsp/type-registry.js';

function makeType(qn: string, shortName: string): RegisteredType {
  return {
    qn,
    shortName,
    label: 'Class',
    moduleQn: 'proj',
    type: { kind: 'unknown' },
    language: 'typescript',
    sourceFile: 'src/a.ts',
    sourceLine: 1,
  };
}

function makeFunc(qn: string, shortName: string): RegisteredFunction {
  return {
    qn,
    shortName,
    label: 'Function',
    moduleQn: 'proj',
    returnTypes: 'void',
    paramCount: 0,
    paramTypes: '',
    isAsync: false,
    language: 'typescript',
    sourceFile: 'src/a.ts',
    sourceLine: 1,
  };
}

describe('TypeRegistry — registerAll, typeCount, and finalized getters', () => {
  it('registers types and functions in bulk and exposes counts', () => {
    const registry = new TypeRegistry();

    // Fresh registry: not finalized and empty.
    expect(registry.finalized).toBe(false);
    expect(registry.typeCount).toBe(0);
    expect(registry.functionCount).toBe(0);

    registry.registerAll(
      [makeType('proj.A', 'A'), makeType('proj.B', 'B')],
      [makeFunc('proj.fn', 'fn')],
    );

    expect(registry.typeCount).toBe(2);
    expect(registry.functionCount).toBe(1);
    expect(registry.lookupType('proj.B')?.shortName).toBe('B');
    expect(registry.lookupFunction('proj.fn')?.shortName).toBe('fn');

    // Still open for registration until finalized.
    expect(registry.finalized).toBe(false);

    registry.finalize();
    expect(registry.finalized).toBe(true);
  });

  it('flips the finalized getter through the finalize lifecycle', () => {
    const registry = new TypeRegistry();
    registry.registerType(makeType('proj.C', 'C'));
    expect(registry.finalized).toBe(false);
    registry.finalize();
    expect(registry.finalized).toBe(true);
  });
});
