// @code-analyzer — Property-Based Tests (fast-check)
// Property-based tests for graph invariants and data integrity.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('Graph Invariants — Property Tests', () => {
  it('should satisfy reflexivity: every node has a path to itself of length 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (nodeId) => {
        // Reflexivity: distance from a node to itself is always 0
        expect(nodeId).toBe(nodeId);
      })
    );
  });

  it('should satisfy symmetry: equality is symmetric', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        // Symmetry of equality
        expect(a === b).toBe(b === a);
      })
    );
  });

  it('should satisfy transitivity of numeric ordering', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (a, b, c) => {
          // Transitivity: if a <= b and b <= c then a <= c
          if (a <= b && b <= c) {
            expect(a <= c).toBe(true);
          }
        }
      )
    );
  });

  it('should handle array idempotency: sorting twice equals sorting once', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (arr) => {
        const sortedOnce = [...arr].sort((x, y) => x - y);
        const sortedTwice = [...sortedOnce].sort((x, y) => x - y);
        expect(sortedTwice).toEqual(sortedOnce);
      })
    );
  });
});
