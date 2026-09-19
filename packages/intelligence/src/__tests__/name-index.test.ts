// Resolving a written callee name, and refusing to when the answer is not unique.
//
// The analyser resolves calls inline and refuses ambiguous simple names on purpose, with a comment saying it
// "prevents incorrect CALLS edges". This index is the same rule for the taint path, where the consequence of a wrong
// resolution is a taint finding attributed to the wrong function.

import { describe, it, expect } from 'vitest';

import { buildNameIndex, resolveFunctionName } from '../security/name-index.js';

import type { FunctionCfg } from '../cfg/types.js';

function cfg(functionName: string): Pick<FunctionCfg, 'functionName'> {
  return { functionName };
}

describe('buildNameIndex', () => {
  it('maps a unique simple name to its qualified name', () => {
    const index = buildNameIndex(
      new Map([
        ['file:src/a.ts:handler', cfg('handler')],
        ['file:src/b.ts:helper', cfg('helper')],
      ]),
    );

    expect(index.get('handler')).toBe('file:src/a.ts:handler');
    expect(index.get('helper')).toBe('file:src/b.ts:helper');
  });

  it('maps a name two functions share to null, rather than to one of them', () => {
    // The important case. Picking either would attach taint to a function the call may not refer to.
    const index = buildNameIndex(
      new Map([
        ['file:src/a.ts:helper', cfg('helper')],
        ['file:src/b.ts:helper', cfg('helper')],
      ]),
    );

    expect(index.get('helper')).toBeNull();
  });

  it('skips a function whose name is empty', () => {
    const index = buildNameIndex(new Map([['file:src/a.ts:', cfg('')]]));

    expect(index.size).toBe(0);
  });
});

describe('resolveFunctionName', () => {
  const index = buildNameIndex(new Map([['file:src/a.ts:handler', cfg('handler')]]));
  const qualified = new Set(['file:src/a.ts:handler']);

  it('accepts a callee already written as a qualified name', () => {
    expect(resolveFunctionName('file:src/a.ts:handler', index, qualified)).toBe(
      'file:src/a.ts:handler',
    );
  });

  it('resolves a unique simple name', () => {
    expect(resolveFunctionName('handler', index, qualified)).toBe('file:src/a.ts:handler');
  });

  it('returns null for a name it cannot place', () => {
    expect(resolveFunctionName('somewhereElse', index, qualified)).toBeNull();
  });

  it('returns null for an ambiguous name, which is the same answer as absent', () => {
    // Both are "do not resolve". The caller cannot act on the difference, and a caller that could would be one
    // deciding to guess.
    const ambiguous = buildNameIndex(
      new Map([
        ['file:src/a.ts:helper', cfg('helper')],
        ['file:src/b.ts:helper', cfg('helper')],
      ]),
    );

    expect(resolveFunctionName('helper', ambiguous, new Set())).toBeNull();
  });
});
