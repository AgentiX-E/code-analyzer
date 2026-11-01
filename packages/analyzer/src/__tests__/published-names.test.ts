// @code-analyzer/analyzer — a class a file reaches through the package that publishes it.
//
// **`from werkzeug.wrappers import Request` names a class that `wrappers/__init__.py` does not declare.** The
// package re-exports it from `wrappers/request.py`, and the class index had no way to follow that - so the name
// `Request` was looked up globally, where `pallets/werkzeug` declares it twice (once in `sansio/`, once in
// `wrappers/`), and the answer was "ambiguous". `Request.from_values(...)` in `tests/test_formparser.py` resolved to
// nothing in twelve tests, and the twelve edges were being produced by a rule that read the *last* file to declare
// the name - a coincidence, not evidence.
//
// **The fixture is the two spellings of one import.** `consumer.py` goes through the package and `direct.py` names
// the module, and both must reach the same declaration: a rule that answered one and not the other would be reading
// the import's shape rather than the name it binds.

import { describe, expect, it } from 'vitest';

import { buildGraph, callsFrom } from './support/pipeline-graph.js';

describe('a class reached through a package', () => {
  it('resolves a name the package re-exports from its module', async () => {
    const graph = await buildGraph('python-package');
    expect(callsFrom(graph, 'build_via_package')).toContainEqual(
      expect.objectContaining({
        target: 'Request.from_values',
        file: 'request.py',
        resolution: 'static',
      }),
    );
  });

  it('resolves the same class when the module is named directly', async () => {
    // **The control.** Without it, a rule that resolved every `X.m()` in this fixture to the first class it found
    // would pass the case above and mean nothing.
    const graph = await buildGraph('python-package');
    expect(callsFrom(graph, 'build_via_module')).toContainEqual(
      expect.objectContaining({
        target: 'Request.from_values',
        file: 'request.py',
        resolution: 'static',
      }),
    );
  });
});
