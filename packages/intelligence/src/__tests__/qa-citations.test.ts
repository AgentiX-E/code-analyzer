// The citation check — unit tests.
//
// **This is the module that turns "the model said something" into a number**, so the cases are the shapes a model
// actually writes and the shapes it writes when it is wrong. Both matter: a parser that rejects `[3, 4]` fails a
// correct answer, and a parser that accepts `line 42` turns every answer into a grounded one.

import { describe, expect, it } from 'vitest';

import { hasGroundedClaim, parseCitationIds, sentences, verifyCitations } from '../qa/citations.js';

import type { ContextBlock } from '../qa/types.js';

function block(
  id: number,
  filePath = `src/f${String(id)}.ts`,
  name = `f${String(id)}`,
): ContextBlock {
  return {
    id,
    nodeId: id * 10,
    name,
    qualifiedName: `app.${name}`,
    label: 'Function',
    filePath,
    startLine: id * 10,
    endLine: id * 10 + 5,
    language: 'typescript',
    signature: null,
    body: null,
    origin: 'retrieved',
    reachedBy: null,
    score: 1,
  };
}

describe('parseCitationIds', () => {
  it('reads a single bracket', () => {
    expect(parseCitationIds('The token is parsed in [2].')).toEqual([2]);
  });

  it('reads a comma-separated list', () => {
    expect(parseCitationIds('Both [3, 5] agree.')).toEqual([3, 5]);
  });

  it('reads a list without spaces', () => {
    expect(parseCitationIds('See [1,2,3].')).toEqual([1, 2, 3]);
  });

  it('expands a range, because that is how a person cites adjacent blocks', () => {
    expect(parseCitationIds('See [3-5].')).toEqual([3, 4, 5]);
  });

  it('reads the full-width brackets a CJK answer produces', () => {
    expect(parseCitationIds('见【4】。')).toEqual([4]);
  });

  it('deduplicates, keeping first-appearance order', () => {
    expect(parseCitationIds('[5] then [2] then [5]')).toEqual([5, 2]);
  });

  it('ignores a bare number, because prose is full of them', () => {
    // **`line 42` and `#7` are not pointers.** Accepting them would make every answer cite something, which is the
    // opposite of what this check is for.
    expect(parseCitationIds('At line 42 the issue 7 appears twice in 2024.')).toEqual([]);
  });

  it('ignores zero and a negative, which no block has', () => {
    expect(parseCitationIds('See [0] and [-1].')).toEqual([]);
  });

  it('caps a pathological range instead of expanding it', () => {
    // **`[1-1000000]` is a model failure, not a million citations.** The loop must not be the denial of service.
    expect(parseCitationIds('[1-1000000]')).toEqual([]);
  });

  it('returns nothing for empty prose', () => {
    expect(parseCitationIds('')).toEqual([]);
  });
});

describe('sentences', () => {
  it('splits on sentence ends', () => {
    expect(sentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('splits on a blank line as well, because an answer is often a list', () => {
    expect(sentences('Intro paragraph.\n\n- a [1]\n- b [2]')).toEqual([
      'Intro paragraph.',
      '- a [1]\n- b [2]',
    ]);
  });

  it('returns nothing for blank prose', () => {
    expect(sentences('   \n ')).toEqual([]);
  });
});

describe('verifyCitations', () => {
  const context = [block(1), block(2, 'src/other.ts'), block(3, 'src/other.ts')];

  it('resolves a citation that exists, with the place it names', () => {
    const report = verifyCitations('Parsed in [2].', context);
    expect(report.unknownIds).toEqual([]);
    expect(report.allCitationsResolve).toBe(true);
    expect(report.cited).toEqual([
      { id: 2, filePath: 'src/other.ts', startLine: 20, endLine: 25, name: 'f2' },
    ]);
  });

  it('reports a citation that does not exist, and says the answer is not fully grounded', () => {
    const report = verifyCitations('Parsed in [9].', context);
    // **Nine is not a rounding error**: it is the model naming a block it was never shown.
    expect(report.unknownIds).toEqual([9]);
    expect(report.allCitationsResolve).toBe(false);
    expect(report.cited).toEqual([]);
  });

  it('keeps the resolving half of a mixed answer', () => {
    const report = verifyCitations('[1] is right and [9] is invented.', context);
    expect(report.unknownIds).toEqual([9]);
    expect(report.cited.map((citation) => citation.id)).toEqual([1]);
  });

  it('lists the blocks the answer did not use', () => {
    const report = verifyCitations('Only [2].', context);
    expect(report.uncited).toEqual([1, 3]);
  });

  it('lists every block as uncited when the answer cites nothing', () => {
    const report = verifyCitations('The repository has no tests.', context);
    expect(report.uncited).toEqual([1, 2, 3]);
    expect(report.allCitationsResolve).toBe(true);
  });

  it('treats an empty answer as citing nothing rather than as a failure to parse', () => {
    const report = verifyCitations('', context);
    expect(report.cited).toEqual([]);
    expect(report.unknownIds).toEqual([]);
    expect(report.uncited).toEqual([1, 2, 3]);
  });

  it('reports duplicate citations once', () => {
    const report = verifyCitations('[1] and again [1].', context);
    expect(report.cited).toHaveLength(1);
  });
});

describe('hasGroundedClaim', () => {
  const context = [block(1)];

  it('is true when one citation resolves', () => {
    expect(hasGroundedClaim(verifyCitations('Answer [1].', context))).toBe(true);
  });

  it('is false when the answer cites nothing', () => {
    expect(hasGroundedClaim(verifyCitations('Answer with no pointer.', context))).toBe(false);
  });

  it('is false when every citation is invented', () => {
    // **An answer that cites only non-existent blocks is worse than one that cites none**: it looks auditable.
    expect(hasGroundedClaim(verifyCitations('Answer [7].', context))).toBe(false);
  });
});
