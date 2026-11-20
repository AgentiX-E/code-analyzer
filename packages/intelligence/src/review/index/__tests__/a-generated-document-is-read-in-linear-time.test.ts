/**
 * **A generated document is a document, and reading its keys cost two quadratic passes until a corpus said so.**
 *
 * `Alamofire` ships two 436 KB `docs/search.json` files - the search index of a generated docset, ten thousand keys under
 * one root object - and **they took 2 520 ms each to index while the other 138 files in the same checkout took 480 ms
 * together**. The walk reads `.json` because the index now has an edge layer for it (§103), so a generated document is no
 * longer a file the reader never saw; it is a file the reader saw and could not afford - and at twelve thousand keys the
 * same reader ran the process out of a four-gigabyte heap.
 *
 * **Two passes, two causes, one shape.** Both walked the records that had already been pushed:
 *
 * 1. **The parent lookup** scanned them backwards for the range that contains the key's, and in a flat document every
 *    sibling's range is disjoint, so the scan walked past all of them to the root - ten thousand keys is fifty million
 *    comparisons. **The stack the ranges already describe answers it**: keys arrive in source order, so the enclosing
 *    record is the last one still open.
 * 2. **The member list** was rebuilt per record by filtering the whole array, and each entry carried a signature built by
 *    slicing the file - **O(k²) entries and O(k³) work**, which is what exhausted the heap. **Grouping the children once
 *    by parent is the same answer** and it is one pass.
 *
 * **What this file asserts is the answer and the cost together**, because a fast scan that dropped keys would be a
 * different defect wearing a timing test.
 */

import { describe, expect, it } from 'vitest';

import { buildSymbolIndex } from '../symbols.js';

/** A search index in the shape a docset ships: one root object, a key per row, two fields under each. */
function generatedDocument(keys: number): string {
  const rows: string[] = [];
  for (let at = 0; at < keys; at += 1) {
    rows.push(`"k${String(at)}":{"l":"row ${String(at)}","t":"title ${String(at)}"}`);
  }
  return `{${rows.join(',')}}`;
}

describe('a generated JSON document', () => {
  it('is read in time linear in its keys, which a backward scan of the records is not', () => {
    const text = generatedDocument(3_000);
    const started = Date.now();
    const index = buildSymbolIndex('docs/search.json', text);
    const elapsed = Date.now() - started;
    // **The bound is loose on purpose** - a linear pass over 3 000 keys is single-digit milliseconds, and 250 ms is the
    // point past which a review would rather not have the key list at all. Measured at §103: 2 517 ms before, 24 ms
    // after.
    expect(elapsed).toBeLessThan(250);
    expect(index.language).toBe('json');
    // **Every key is still a symbol and every key is still the document's**: a one-line document has no line-shaped
    // nesting to place a key in, so the key list is flat - and filing `b` inside `a` for `{"a":1,"b":2}`, which the
    // version this replaces did, is a claim the line does not support.
    // **Three thousand keys and two distinct field names**, because a symbol list is a list of names: `l` and `t` are
    // declared three thousand times each and the list carries them once.
    expect(index.symbols).toHaveLength(3_002);
    expect(index.symbols.every((symbol) => symbol.exported)).toBe(true);
    expect(index.symbols[0]!.members).toEqual([]);
  });

  it('keeps the parent it had before the stack, on a document nested four deep', () => {
    const text = [
      '{',
      '  "a": {',
      '    "b": {',
      '      "c": { "d": 1 }',
      '    }',
      '  },',
      '  "e": 2',
      '}',
    ].join('\n');
    const index = buildSymbolIndex('w.json', text);
    const byName = new Map(index.symbols.map((symbol) => [symbol.name, symbol]));
    // **A nested key is a member of the key above it and not a key of the document**, which is the rule the parent index
    // carries and the reason the parent has to survive the rewrite.
    expect(byName.get('a')?.exported).toBe(true);
    expect(byName.get('a')?.members?.map((member) => member.name)).toEqual(['b']);
    expect(byName.get('e')?.exported).toBe(true);
    expect([...byName.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
