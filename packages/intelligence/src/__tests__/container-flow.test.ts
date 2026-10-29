// What a container holds, at the point a statement reads it.
//
// **Every case here is a shape the corpus writes and the model has to answer.** The assertions are on two facts: what a
// read receives (a use, which is how a value gets back out) and which writes the model followed (which is what lets the
// summary stop calling a value "lost"). The two are separate on purpose - a value can sit in a container no read ever
// touches, and that is an answer, not a gap.

import { describe, expect, it } from 'vitest';

import {
  NO_CONTAINER_FLOW,
  containerFlowOf,
  resolveContainerFlow,
  withContainerUses,
} from '../cfg/container-flow.js';

import type { ContainerInputs } from '../cfg/container-flow.js';
import type { BindingEntry, FunctionCfg, StatementFacts, UseSite } from '../cfg/types.js';
import type { ConditionalRegion, ContainerCall } from '@code-analyzer/analyzer';

/** Bindings named `param`, `bar`, `map`, ... indexed in the order given. */
function bindingsOf(names: readonly string[]): BindingEntry[] {
  return names.map((name, index) => ({
    index,
    name,
    kind: 'local' as const,
    declLine: 1,
    declColumn: 0,
    synthetic: false,
  }));
}

/** A call written the way the model reads it: receiver, method, and the names or literal each argument carries. */
function call(
  line: number,
  receiver: string,
  method: string,
  args: readonly (string | { names: readonly string[] })[],
): ContainerCall {
  return {
    line,
    receiver,
    method,
    args: args.map((arg) =>
      typeof arg === 'string' ? { literal: arg, names: [] } : { names: arg.names },
    ),
  };
}

/** The input the model takes, from a list of uses already reduced to names. */
function inputs(
  names: readonly string[],
  calls: readonly ContainerCall[],
  extraUses: readonly { stmtIndex: number; name: string }[] = [],
  regions: readonly ConditionalRegion[] = [],
): ContainerInputs {
  const bindings = bindingsOf(names);
  const indexOf = (name: string): number =>
    bindings.find((binding) => binding.name === name)!.index;
  const uses = new Map<number, UseSite[]>();
  for (const use of extraUses) {
    const bucket = uses.get(use.stmtIndex) ?? [];
    bucket.push({
      point: { blockIndex: 0, stmtIndex: use.stmtIndex, line: use.stmtIndex + 1 },
      bindingIdx: indexOf(use.name),
    });
    uses.set(use.stmtIndex, bucket);
  }
  return {
    facts: { defs: new Map(), uses },
    bindings,
    calls,
    regions,
    startLine: 1,
    endLine: 200,
  };
}

/** The names one statement's read receives. */
function carriedNames(
  inputsUnderTest: ContainerInputs,
  result: { carried: ReadonlyMap<number, ReadonlySet<number>> },
  stmtIndex: number,
): string[] {
  const carried = result.carried.get(stmtIndex);
  if (!carried) return [];
  return [...carried].map((index) => inputsUnderTest.bindings[index]?.name ?? '?').sort();
}

describe('resolveContainerFlow', () => {
  it('hands a read the value written under its own key, and not the one beside it', () => {
    // The corpus's map shape: three values in, two reads out, and the last one decides what the function returns.
    const input = inputs(
      ['param', 'bar', 'map'],
      [
        call(1, 'map', 'put', ['keyA', 'a_Value']),
        call(2, 'map', 'put', ['keyB', { names: ['param'] }]),
        call(3, 'map', 'put', ['keyC', 'another_Value']),
        call(4, 'map', 'get', ['keyB']),
        call(5, 'map', 'get', ['keyA']),
      ],
      // The receiver's own uses, at the statements its calls are on: `line - startLine` is the statement index.
      [
        { stmtIndex: 0, name: 'map' },
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 2, name: 'map' },
        { stmtIndex: 3, name: 'map' },
        { stmtIndex: 4, name: 'map' },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 3)).toEqual(['param']);
    expect(carriedNames(input, result, 4)).toEqual([]);
    // Every write is followed, because every read of the container was answered by a slot and the container never
    // left the function - including the write to `keyB`, which no read in this function received.
    // `${stmtIndex}:${bindingIdx}`, which is the coordinate `onLost` reports and therefore the one the summary reads.
    // One entry, because only one of the three writes carried a name: `"a_Value"` and `"another_Value"` are literals.
    expect([...result.followed].sort()).toEqual(['1:0']);
  });

  it('follows a value through a list that shuffles it, which is what the index arithmetic is for', () => {
    // `add("safe"); add(param); add("moresafe"); remove(0); get(1)` - the value sits at position 1 until the removal
    // shifts it to 0, and `get(1)` then reads `"moresafe"`. A model without positions answers the wrong question here.
    const input = inputs(
      ['param', 'bar', 'valuesList'],
      [
        call(2, 'valuesList', 'add', ['safe']),
        call(3, 'valuesList', 'add', [{ names: ['param'] }]),
        call(4, 'valuesList', 'add', ['moresafe']),
        call(5, 'valuesList', 'remove', ['0']),
        call(6, 'valuesList', 'get', ['1']),
      ],
      [
        { stmtIndex: 1, name: 'valuesList' },
        { stmtIndex: 2, name: 'valuesList' },
        { stmtIndex: 3, name: 'valuesList' },
        { stmtIndex: 4, name: 'valuesList' },
        { stmtIndex: 5, name: 'valuesList' },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 5)).toEqual([]);
    // The value is still in the list - at position 0, which nothing reads - and that is an answer: it cannot reach a
    // return through a read that never happens.
    // `add(param)` is on line 3, which is statement 2 of a function starting at line 1.
    expect(result.followed.has('2:0')).toBe(true);
  });

  it('hands a read of the remaining position the value the removal moved there', () => {
    const input = inputs(
      ['param', 'bar', 'l'],
      [
        call(2, 'l', 'add', ['safe']),
        call(3, 'l', 'add', [{ names: ['param'] }]),
        call(4, 'l', 'remove', ['0']),
        call(5, 'l', 'get', ['0']),
      ],
      [{ stmtIndex: 5, name: 'l' }],
    );
    const result = resolveContainerFlow(input);
    // `param` went in second and the removal of the first element moved it to position 0, which is what the read asks
    // for. A model that kept the value at the index it was written at answers `"safe"` here.
    expect(carriedNames(input, result, 4)).toEqual(['param']);
  });

  it('gives every read everything when a key is a runtime value', () => {
    // `map.put(key, param); map.get("keyA")` - the key is not a literal, so no slot can be pointed at, and the honest
    // answer is the whole container rather than the empty one a slot lookup would produce.
    const input = inputs(
      ['param', 'bar', 'key', 'map'],
      [
        call(2, 'map', 'put', [{ names: ['key'] }, { names: ['param'] }]),
        call(3, 'map', 'get', ['keyA']),
      ],
      [{ stmtIndex: 3, name: 'map' }],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 2)).toEqual(['param']);
    // And the container is no longer one the model can speak for: a read it answered with everything leaves the
    // question of what a write reached open.
    expect(result.followed.size).toBe(0);
  });

  it('stops following a container that leaves the function', () => {
    // `return list` hands the whole thing to the caller, so nothing this model can see decides what it reads.
    const input = inputs(
      ['param', 'l'],
      [call(2, 'l', 'add', [{ names: ['param'] }]), call(3, 'l', 'get', ['0'])],
      [
        { stmtIndex: 3, name: 'l' },
        // A use of the container that is not one of its own calls: a return, or an argument to something else.
        { stmtIndex: 4, name: 'l' },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 2)).toEqual(['param']);
    expect(result.followed.size).toBe(0);
  });

  it('refuses to speak about positions across two branches', () => {
    // `if (a) l.add(x); if (b) l.add(y); l.get(1)` - the first append may not have run, so index 1 means nothing.
    const input = inputs(
      ['param', 'l'],
      [
        call(2, 'l', 'add', [{ names: ['param'] }]),
        call(4, 'l', 'add', ['safe']),
        call(6, 'l', 'get', ['1']),
      ],
      [{ stmtIndex: 6, name: 'l' }],
      [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 5)).toEqual(['param']);
  });

  it('keeps positions across two statements in one branch', () => {
    // The same two appends inside one `if` body: the body runs or it does not, and when it runs the order holds.
    const input = inputs(
      ['param', 'l'],
      [
        call(3, 'l', 'add', [{ names: ['param'] }]),
        call(4, 'l', 'add', ['safe']),
        call(5, 'l', 'get', ['0']),
      ],
      [{ stmtIndex: 5, name: 'l' }],
      [{ from: 2, to: 6 }],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 4)).toEqual(['param']);
  });

  it('forgets what a reassigned receiver held', () => {
    const input = inputs(
      ['param', 'l'],
      [call(2, 'l', 'add', [{ names: ['param'] }]), call(4, 'l', 'get', ['0'])],
      [{ stmtIndex: 4, name: 'l' }],
    );
    // `l = new ArrayList<>()` on line 3: the name is a new container, and the value went with the old one.
    const withDefs: ContainerInputs = {
      ...input,
      facts: {
        ...input.facts,
        defs: new Map([
          [
            3,
            [
              {
                point: { blockIndex: 0, stmtIndex: 2, line: 3 },
                bindingIdx: 1,
                kind: 'may' as const,
              },
            ],
          ],
        ]),
      },
    };
    const result = resolveContainerFlow(withDefs);
    expect(carriedNames(withDefs, result, 3)).toEqual([]);
  });

  it('does not let one read change what a later read of another key receives', () => {
    // `map.toString()` is answered with everything the container holds - that is the answer to the statement that
    // asked, and it is not a new fact about the container. `map.get("keyB")` afterwards still receives only what was
    // written under `keyB`: **a read is a question, never a write**, and a union that handed back one of the slots it
    // merged would turn every keyed read after a whole-container read into a false positive.
    const input = inputs(
      ['param', 'bar', 'map'],
      [
        call(2, 'map', 'put', ['keyA', { names: ['param'] }]),
        call(3, 'map', 'put', ['keyB', 'safe']),
        call(4, 'map', 'toString', []),
        call(5, 'map', 'get', ['keyB']),
      ],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 2, name: 'map' },
        { stmtIndex: 3, name: 'map' },
        { stmtIndex: 4, name: 'map' },
      ],
    );
    const result = resolveContainerFlow(input);
    // The whole-container read does see the value, and the keyed read beside it does not.
    expect(carriedNames(input, result, 3)).toEqual(['param']);
    expect(carriedNames(input, result, 4)).toEqual([]);
  });

  it('reads a builder`s whole contents through `toString`', () => {
    const input = inputs(
      ['param', 'bar', 'sb'],
      [call(2, 'sb', 'append', [{ names: ['param'] }]), call(3, 'sb', 'toString', [])],
      [{ stmtIndex: 3, name: 'sb' }],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 2)).toEqual(['param']);
    // Nothing is followed, because the builder left the function: the use at statement 3 is not one of the builder's
    // own calls, which is what `helper(sb)` and `return sb` look like from here.
    expect(result.followed.size).toBe(0);
  });

  it('empties a container a `clear` was called on', () => {
    const input = inputs(
      ['param', 'l'],
      [
        call(2, 'l', 'add', [{ names: ['param'] }]),
        call(3, 'l', 'clear', []),
        call(4, 'l', 'get', ['0']),
      ],
      [{ stmtIndex: 4, name: 'l' }],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 3)).toEqual([]);
  });

  it('answers nothing for a file with no container calls', () => {
    const input = inputs(['param'], []);
    expect(resolveContainerFlow(input)).toBe(NO_CONTAINER_FLOW);
  });

  it('ignores a call whose receiver is not a binding of this function', () => {
    // A field or an outer variable outlives the statement; the model says nothing rather than guessing.
    const result = resolveContainerFlow(
      inputs(['param'], [call(2, 'this.cache', 'put', ['k', { names: ['param'] }])]),
    );
    expect(result.carried.size).toBe(0);
    expect(result.followed.size).toBe(0);
  });
});

// **The five degradations, one test each.** The guarantee is stated for containers whose every access this function
// saw; every test below is a shape outside it, and what each one asserts is the *direction* the model errs in. A
// degradation that erred the other way would be a false negative, which is why they are tested rather than assumed.
describe('the shapes outside the guarantee', () => {
  it('treats a method it has no meaning for as a mutation of the container', () => {
    // `map.putAll(other)` is in no table, so the model cannot say what it did — but `other` went in, and every later
    // read of any key may receive it. Reading the call as the container escaping instead was measured and rejected: it
    // made every `StringBuilder` chain in the corpus unfollowable.
    const input = inputs(
      ['param', 'other', 'bar', 'map'],
      [
        call(2, 'map', 'put', ['keyA', { names: ['param'] }]),
        call(3, 'map', 'putAll', [{ names: ['other'] }]),
        call(4, 'map', 'get', ['keyB']),
      ],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 2, name: 'map' },
        { stmtIndex: 3, name: 'map' },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 3)).toEqual(['other']);
    // And the value now has a destination this function can see, so the write is followed rather than left as lost.
    expect([...result.followed].sort()).toEqual(['1:0', '2:1']);
  });

  it('says nothing about a method it cannot read on a container it has never seen written', () => {
    // There is no state to mutate, so there is nothing to record: `map.putAll(other)` before any write this model
    // understood leaves the container as unknown as it was, and the read that follows receives nothing from it.
    const input = inputs(
      ['other', 'bar', 'map'],
      [call(2, 'map', 'putAll', [{ names: ['other'] }]), call(3, 'map', 'get', ['keyB'])],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 2, name: 'map' },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 2)).toEqual([]);
    expect(result.followed.size).toBe(0);
  });

  it('ignores a value that is not a binding of this function', () => {
    // `map.put("keyA", this.field)` — the field is not this function's to track, so the slot holds nothing nameable
    // and nothing is recorded as followed.
    const input = inputs(
      ['param', 'bar', 'map'],
      [call(2, 'map', 'put', ['keyA', { names: ['someField'] }]), call(3, 'map', 'get', ['keyA'])],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 2, name: 'map' },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 2)).toEqual([]);
    expect(result.followed.size).toBe(0);
  });

  it('ignores a definition whose binding is not in the table', () => {
    // The def→use facts and the binding table come from two walks, and a name one recorded and the other did not is a
    // gap rather than a new container: dropping the state on it would lose every value the container held.
    const input = inputs(
      ['param', 'bar', 'map'],
      [call(2, 'map', 'put', ['keyA', { names: ['param'] }]), call(4, 'map', 'get', ['keyA'])],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 3, name: 'map' },
      ],
    );
    const withDefs: ContainerInputs = {
      ...input,
      facts: {
        ...input.facts,
        defs: new Map([
          [
            3,
            [
              {
                point: { blockIndex: 0, stmtIndex: 3, line: 4 },
                bindingIdx: 99,
                kind: 'must' as const,
              },
            ],
          ],
        ]),
      },
    };
    const result = resolveContainerFlow(withDefs);
    expect(carriedNames(withDefs, result, 3)).toEqual(['param']);
  });

  it('ignores a use whose binding is not in the table', () => {
    // The same gap on the use side: a use the binding table cannot name is not evidence that the container escaped.
    const input = inputs(
      ['param', 'l'],
      [call(2, 'l', 'add', [{ names: ['param'] }]), call(3, 'l', 'get', ['0'])],
    );
    const withUses: ContainerInputs = {
      ...input,
      facts: {
        ...input.facts,
        uses: new Map([
          [1, [{ point: { blockIndex: 0, stmtIndex: 1, line: 2 }, bindingIdx: 1 }]],
          [
            2,
            [
              { point: { blockIndex: 0, stmtIndex: 2, line: 3 }, bindingIdx: 1 },
              { point: { blockIndex: 0, stmtIndex: 2, line: 3 }, bindingIdx: 42 },
            ],
          ],
        ]),
      },
    };
    const result = resolveContainerFlow(withUses);
    expect(carriedNames(withUses, result, 2)).toEqual(['param']);
    // The write is still followed, because a use the model cannot name did not take the container anywhere.
    expect([...result.followed]).toEqual(['1:0']);
  });

  it('keeps what a container held when the clear may not have run', () => {
    // `if (flag) map.clear();` — the clear is inside a branch, so the value may still be in the map. The clear was
    // read as certainly having run because the branch question was asked of `inSameBranch`, which answers "is this the
    // same branch as the last position op" and answers *true* when there is none — and a keyed write tracks no
    // position, so a `map.put` before the clear leaves that question with nothing to compare against.
    const input = inputs(
      ['param', 'bar', 'map'],
      [
        call(2, 'map', 'put', ['keyA', { names: ['param'] }]),
        call(4, 'map', 'clear', []),
        call(6, 'map', 'get', ['keyA']),
      ],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 3, name: 'map' },
        { stmtIndex: 5, name: 'map' },
      ],
      [{ from: 3, to: 5 }],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 5)).toEqual(['param']);
  });

  it('refuses to shift a sequence for a removal in another branch', () => {
    // `if (flag) list.remove(0);` — the removal may not have run, so the positions after it are not knowable, and a
    // read falls back to everything the list holds rather than to the slot the shift would have produced.
    const input = inputs(
      ['param', 'bar', 'l'],
      [
        call(2, 'l', 'add', [{ names: ['param'] }]),
        call(4, 'l', 'remove', ['0']),
        call(6, 'l', 'get', ['0']),
      ],
      [
        { stmtIndex: 1, name: 'l' },
        { stmtIndex: 3, name: 'l' },
        { stmtIndex: 5, name: 'l' },
      ],
      [{ from: 3, to: 5 }],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 5)).toEqual(['param']);
  });

  it('leaves a sequence alone for a removal it cannot place', () => {
    // A removal under a runtime index (`list.remove(i)`) deletes no slot this model can name, so the value stays where
    // it was written rather than being guessed away.
    const runtimeKey = inputs(
      ['param', 'i', 'l'],
      [
        call(2, 'l', 'add', [{ names: ['param'] }]),
        call(3, 'l', 'remove', [{ names: ['i'] }]),
        call(4, 'l', 'get', ['0']),
      ],
      [
        { stmtIndex: 1, name: 'l' },
        { stmtIndex: 2, name: 'l' },
        { stmtIndex: 3, name: 'l' },
      ],
    );
    expect(carriedNames(runtimeKey, resolveContainerFlow(runtimeKey), 3)).toEqual(['param']);

    // And a removal past the end (`list.remove(5)` on a one-element list) is a removal of nothing the model counted,
    // which makes every position suspect rather than making the read empty.
    const pastTheEnd = inputs(
      ['param', 'bar', 'l'],
      [
        call(2, 'l', 'add', [{ names: ['param'] }]),
        call(3, 'l', 'remove', ['5']),
        call(4, 'l', 'get', ['0']),
      ],
      [
        { stmtIndex: 1, name: 'l' },
        { stmtIndex: 2, name: 'l' },
        { stmtIndex: 3, name: 'l' },
      ],
    );
    expect(carriedNames(pastTheEnd, resolveContainerFlow(pastTheEnd), 3)).toEqual(['param']);
  });

  it('deletes the slot a keyed removal names, and follows the write anyway', () => {
    // `map.remove("keyA")` after `map.put("keyA", param)` is a slot this model can name exactly, so the read that
    // follows receives nothing — and the write is followed all the same, because a value with no read is an answer
    // rather than a gap.
    const input = inputs(
      ['param', 'bar', 'map'],
      [
        call(2, 'map', 'put', ['keyA', { names: ['param'] }]),
        call(3, 'map', 'remove', ['keyA']),
        call(4, 'map', 'get', ['keyA']),
      ],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 2, name: 'map' },
        { stmtIndex: 3, name: 'map' },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 3)).toEqual([]);
    expect([...result.followed]).toEqual(['1:0']);
  });

  it('answers a read whose key is a runtime value with the whole container', () => {
    // `map.get(key)` where `key` is a variable: no slot can be pointed at, and the honest answer is everything.
    const input = inputs(
      ['param', 'bar', 'key', 'map'],
      [
        call(2, 'map', 'put', ['keyA', { names: ['param'] }]),
        call(3, 'map', 'get', [{ names: ['key'] }]),
      ],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 2, name: 'map' },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 2)).toEqual(['param']);
  });

  it('stops trusting positions once two of them landed in different branches', () => {
    // An append after the model has already given up on positions joins the content it cannot place, so a read of any
    // index still receives the value that went in before it.
    const input = inputs(
      ['param', 'bar', 'l'],
      [
        call(2, 'l', 'add', [{ names: ['param'] }]),
        call(4, 'l', 'remove', ['0']),
        call(6, 'l', 'add', ['safe']),
        call(7, 'l', 'get', ['1']),
      ],
      [
        { stmtIndex: 1, name: 'l' },
        { stmtIndex: 3, name: 'l' },
        { stmtIndex: 5, name: 'l' },
        { stmtIndex: 6, name: 'l' },
      ],
      [{ from: 3, to: 5 }],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 6)).toEqual(['param']);
  });

  it('puts both values in one slot when two writes name the same key', () => {
    // `map.put("keyA", param); map.put("keyA", other);` — a slot holds both, because a read after either line may
    // see either value.
    const input = inputs(
      ['param', 'other', 'bar', 'map'],
      [
        call(2, 'map', 'put', ['keyA', { names: ['param'] }]),
        call(3, 'map', 'put', ['keyA', { names: ['other'] }]),
        call(4, 'map', 'get', ['keyA']),
      ],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 2, name: 'map' },
        { stmtIndex: 3, name: 'map' },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 3)).toEqual(['other', 'param']);
  });

  it('ignores a call outside the lines this function covers', () => {
    // `containerCalls` is a file's list and a function is a line range, so the two disagree at every function
    // boundary. A call past the range belongs to another function and must not touch this one's state.
    const onlyOutOfRange = inputs(
      ['param', 'map'],
      [call(500, 'map', 'put', ['keyA', { names: ['param'] }])],
    );
    expect(resolveContainerFlow(onlyOutOfRange).carried.size).toBe(0);

    const mixed = inputs(
      ['param', 'bar', 'map'],
      [
        call(2, 'map', 'put', ['keyA', { names: ['param'] }]),
        call(500, 'map', 'put', ['keyB', { names: ['param'] }]),
        call(3, 'map', 'get', ['keyB']),
      ],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 2, name: 'map' },
      ],
    );
    expect(carriedNames(mixed, resolveContainerFlow(mixed), 2)).toEqual([]);
  });

  it('records nothing for a mutation whose arguments it cannot name', () => {
    // `map.putAll(this.cache)` — the argument is a field, not a binding of this function, so it goes into no slot and
    // the write is not one the summary may claim to have followed.
    const input = inputs(
      ['param', 'bar', 'map'],
      [
        call(2, 'map', 'put', ['keyA', { names: ['param'] }]),
        call(3, 'map', 'putAll', [{ names: ['someField'] }]),
        call(4, 'map', 'get', ['keyB']),
      ],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 2, name: 'map' },
        { stmtIndex: 3, name: 'map' },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 3)).toEqual([]);
    expect([...result.followed]).toEqual(['1:0']);
  });

  it('records a write that names a key but hands over no value', () => {
    // `map.put("keyA")` is not Java, but `list.add()` and a truncated call are both shapes a parse can produce, and
    // the model answers with an empty slot rather than reading the key as the value.
    const input = inputs(
      ['param', 'bar', 'map'],
      [call(2, 'map', 'put', ['keyA']), call(3, 'map', 'get', ['keyA'])],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 2, name: 'map' },
      ],
    );
    const result = resolveContainerFlow(input);
    expect(carriedNames(input, result, 2)).toEqual([]);
    expect(result.followed.size).toBe(0);
  });

  it('keeps a keyed slot when a removal lands in another branch', () => {
    // A keyed container tracks no positions, so the only thing a removal in a branch can do is nothing: the value may
    // still be under its key, and a model that deleted it would be claiming a path it does not know.
    const input = inputs(
      ['param', 'bar', 'map'],
      [
        call(2, 'map', 'put', ['keyA', { names: ['param'] }]),
        call(4, 'map', 'remove', ['keyA']),
        call(6, 'map', 'remove', ['keyB']),
      ],
      [
        { stmtIndex: 1, name: 'map' },
        { stmtIndex: 3, name: 'map' },
        { stmtIndex: 5, name: 'map' },
      ],
      [{ from: 3, to: 4 }],
    );
    const result = resolveContainerFlow(input);
    expect([...result.followed]).toEqual(['1:0']);
  });
});

describe('withContainerUses', () => {
  it('adds the writers a read receives, without duplicating a use already there', () => {
    const facts: StatementFacts = {
      defs: new Map(),
      uses: new Map([[1, [{ point: { blockIndex: 0, stmtIndex: 1, line: 2 }, bindingIdx: 2 }]]]),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    };
    const merged = withContainerUses(
      facts,
      { carried: new Map([[1, new Set([2, 0])]]), followed: new Set() },
      1,
    );
    const uses = merged.uses.get(1) ?? [];
    expect(uses.map((use) => use.bindingIdx)).toEqual([2, 0]);
    expect(uses[1]?.point.line).toBe(2);
  });

  it('returns the same facts when nothing was carried', () => {
    const facts: StatementFacts = {
      defs: new Map(),
      uses: new Map(),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    };
    expect(withContainerUses(facts, NO_CONTAINER_FLOW, 1)).toBe(facts);
  });

  it('adds uses to a statement that had none, on the statement`s own line', () => {
    // A read statement has a use of its receiver recorded by the capture walk, but a statement the walk recorded
    // nothing for is the common case for `bar = map.get("keyB")` - `bar` is defined there and `map` may not be in the
    // use list at all.
    const facts: StatementFacts = {
      defs: new Map(),
      uses: new Map(),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    };
    const merged = withContainerUses(
      facts,
      { carried: new Map([[2, new Set([0])]]), followed: new Set() },
      1,
    );
    expect(merged.uses.get(2)).toEqual([
      { point: { blockIndex: 0, stmtIndex: 2, line: 3 }, bindingIdx: 0 },
    ]);
  });

  it('adds nothing when the only writer is a use the statement already had', () => {
    // `map.put("keyA", map)` puts the container into itself, so the statement that reads it back is already recorded
    // as reading that binding. Nothing is rebuilt, which is what keeps a function with no new fact allocation-free.
    const existing = [{ point: { blockIndex: 0, stmtIndex: 1, line: 2 }, bindingIdx: 2 }];
    const facts: StatementFacts = {
      defs: new Map(),
      uses: new Map([[1, existing]]),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    };
    const merged = withContainerUses(
      facts,
      { carried: new Map([[1, new Set([2])]]), followed: new Set() },
      1,
    );
    expect(merged.uses.get(1)).toBe(existing);
  });
});

/** A CFG with one block, for the cases that only need the join to have a shape to work on. */
function cfgOf(overrides: Partial<FunctionCfg> = {}): FunctionCfg {
  return {
    functionName: 'Test.run',
    filePath: 'Test.java',
    startLine: 1,
    startColumn: 0,
    blocks: [
      { index: 0, startLine: 1, endLine: 20, statementCount: 20, isEntry: true, isExit: true },
    ],
    edges: [],
    bindings: bindingsOf(['param', 'bar', 'map']),
    stmtFacts: {
      defs: new Map(),
      uses: new Map(),
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    },
    entryIndex: 0,
    exitIndex: 0,
    ...overrides,
  };
}

describe('containerFlowOf', () => {
  it('leaves a function alone when the provider cannot read containers at all', () => {
    // `null` is "this grammar was not read", not "this file has no containers": the CFG comes back untouched so the
    // rest of the analysis keeps the facts it had.
    const cfg = cfgOf();
    const flow = containerFlowOf(cfg, null, null);
    expect(flow.stmtFacts).toBe(cfg.stmtFacts);
    expect(flow.followed.size).toBe(0);
  });

  it('leaves a function alone when the file has no container calls', () => {
    const cfg = cfgOf();
    const flow = containerFlowOf(cfg, [], null);
    expect(flow.stmtFacts).toBe(cfg.stmtFacts);
    expect(flow.followed.size).toBe(0);
  });

  it('joins the uses the propagator needs with the writes the summary needs', () => {
    // The one place the two halves meet: the propagator reads `stmtFacts`, the summary reads `containerFollowed`.
    const cfg = cfgOf();
    const flow = containerFlowOf(
      cfg,
      [call(2, 'map', 'put', ['keyA', { names: ['param'] }]), call(3, 'map', 'get', ['keyA'])],
      // A provider that read the containers but not the branches: every statement is unconditional.
      null,
    );
    expect([...flow.followed]).toEqual(['1:0']);
    expect(flow.stmtFacts.uses.get(2)?.map((use) => use.bindingIdx)).toEqual([0]);
  });

  it('falls back to the function`s first line for a CFG with no block', () => {
    // A CFG this repository builds always has an entry block, but the type does not require one and a caller that
    // passed an empty list would otherwise read `undefined` into every statement index.
    const cfg = cfgOf({ blocks: [] });
    const flow = containerFlowOf(
      cfg,
      [call(1, 'map', 'put', ['keyA', { names: ['param'] }])],
      null,
    );
    expect([...flow.followed]).toEqual(['0:0']);
  });
});
