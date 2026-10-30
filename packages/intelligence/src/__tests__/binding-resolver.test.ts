// **A name is not a variable**, and this is the only thing that decides which variable a spelling means.
//
// The resolver is four lines of arithmetic over scope regions and it carries the whole of the model: the innermost
// region containing the occurrence is the declaration it sees. Every case below is a shape the corpus or a real
// repository contains, and the last one states the answer for a grammar that reads no scopes at all — the answer this
// analysis gave before the question was asked.

import { describe, expect, it } from 'vitest';

import { bindingResolver } from '../cfg/bindings.js';

import type { BindingEntry } from '../cfg/types.js';
import type { SourceRegion } from '@code-analyzer/analyzer';

/** A binding declared on `declLine`; the other fields are the ones the resolver never reads. */
function binding(index: number, name: string, declLine: number): BindingEntry {
  return { index, name, kind: 'local', declLine, declColumn: 0, synthetic: false };
}

describe('bindingResolver', () => {
  it('answers the only binding of a name, without consulting the line', () => {
    const resolve = bindingResolver([binding(0, 'param', 12)], [{ from: 10, to: 20 }]);
    expect(resolve('param', 15)).toBe(0);
    // A line nowhere near the declaration still resolves: a name declared once means the same thing in the whole
    // function, and the fallback is what keeps a parameter's signature line from being a special case.
    expect(resolve('param', 900)).toBe(0);
  });

  it('answers nothing for a name this function does not declare', () => {
    // **A field or an outer variable is not a binding here**, and the analysis must have nothing to say about it rather
    // than something wrong. `undefined` is that sentence.
    const resolve = bindingResolver([binding(0, 'param', 12)], [{ from: 10, to: 20 }]);
    expect(resolve('other', 15)).toBeUndefined();
  });

  it('separates two declarations of one spelling that sit in sibling scopes', () => {
    // The corpus's last two false positives: `String value` in one loop and `Element value` in another. Neither scope
    // contains the other, so line 12 means the first variable and line 22 means the second.
    const resolve = bindingResolver(
      [binding(0, 'value', 12), binding(1, 'value', 22)],
      [
        { from: 10, to: 15 },
        { from: 20, to: 25 },
      ],
    );
    expect(resolve('value', 12)).toBe(0);
    expect(resolve('value', 22)).toBe(1);
    // Outside both, the outermost binding is the answer — the same one the pre-scope model would have given.
    expect(resolve('value', 30)).toBe(0);
  });

  it('lets an inner declaration shadow the outer one, and only inside its own scope', () => {
    const resolve = bindingResolver(
      [binding(0, 'x', 2), binding(1, 'x', 10)],
      [
        { from: 1, to: 20 },
        { from: 8, to: 12 },
      ],
    );
    expect(resolve('x', 9)).toBe(1);
    expect(resolve('x', 15)).toBe(0);
    expect(resolve('x', 4)).toBe(0);
  });

  it('lets a declaration outside every region see the whole file', () => {
    // **A parameter's capture sits on the signature line, which is above the body block.** That line is in no region,
    // and the answer is not "no region" but "the file's own level", which contains every block — so a use inside a
    // loop still resolves to the parameter.
    const resolve = bindingResolver([binding(0, 'request', 1)], [{ from: 3, to: 9 }]);
    expect(resolve('request', 5)).toBe(0);
  });

  it('keeps one variable per name when the grammar reads no scopes', () => {
    // Two bindings of one name and no scope information is the state JavaScript leaves the analysis in; the first
    // binding answers, which is exactly what `Map<name, index>` did before this module existed.
    const resolve = bindingResolver([binding(0, 'x', 2), binding(1, 'x', 10)], undefined);
    expect(resolve('x', 11)).toBe(0);
    expect(resolve('x', 2)).toBe(0);
  });
});

/** The region type is re-exported by the analyzer, and used here only to state the fixtures. */
const _regions: readonly SourceRegion[] = [];
void _regions;
