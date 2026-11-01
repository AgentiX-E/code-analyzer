// @code-analyzer/analyzer — a bare call the file imports is not a call on the object itself.
//
// **A language with implicit `this` makes `m()` and `this.m()` the same spelling.** TypeScript, Java and Kotlin all
// read a bare call inside a method as a member call when nothing else binds the name, which is why the class-chain arm
// accepts one - and it is exactly why the binding has to be checked first.
//
// `redis/ioredis` is where this was measured. `Redis.sendCommand` writes `exists(command.name)`, and `exists` is
// imported from `@ioredis/commands`, which is not in the checkout. Nothing could resolve it, so the class-chain arm
// answered with `RedisCommander.exists` - a method of an interface, from a call that runs a package's function. Sixteen
// of that corpus's claims were this shape: `debug` and `exists`, both bound by imports, both answered by a class.

import { describe, expect, it } from 'vitest';

import { buildGraph, targets } from './support/pipeline-graph.js';

describe('a bare call whose name the file imports', () => {
  it('does not resolve to a member of the enclosing class', async () => {
    const graph = await buildGraph('implicit-this');
    // `exists` is imported from a package that is not in the corpus, so the call is real and its target is unknown.
    expect(targets(graph, 'Store.check')).toEqual([]);
  });

  it('does not resolve a bare call the module binds to a value', async () => {
    // **`const debug = Debug("redis")` is the shape, and it is one binding away from the case above.** The file does
    // not import `debug`; it declares it, at module scope, as a value. A class that inherits a `debug` member is
    // still not what a bare `debug(…)` runs.
    const graph = await buildGraph('implicit-this');
    expect(targets(graph, 'Store.report')).toEqual([]);
  });

  it('still resolves the same name written on the object itself', async () => {
    // **The control, and the whole purpose of the arm.** `this.exists(key)` names the member, and the import says
    // nothing about a name written on a receiver.
    const graph = await buildGraph('implicit-this');
    expect(targets(graph, 'Store.verify')).toEqual(['Store.exists']);
  });
});
