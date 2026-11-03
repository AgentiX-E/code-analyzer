// @code-analyzer/analyzer — an end-to-end walk of the declarations this iteration taught the graph to read.
//
// Every case here is a shape a real checkout writes and could not be resolved before it: `abstract class`, a class
// expression inside a constructor, an arrow that keeps `this`, a field initialised by a construction, a type alias used
// as a parameter's type, and a module-scope name bound to a class's static function. The unit tests state the facts one
// at a time; this file states that the pipeline turns them into edges.

import { beforeAll, describe, expect, it } from 'vitest';

import { buildGraph, callsFrom } from './support/pipeline-graph.js';

import type { KnowledgeGraph } from '@code-analyzer/shared';

describe('a declaration that names a scope or a type', () => {
  let graph: KnowledgeGraph;

  beforeAll(async () => {
    graph = await buildGraph('typescript-scopes');
  });

  it('answers a member of the abstract class the call is written in', () => {
    // `Shape.describe` calls `this.area()`, and `area` is declared `abstract` on `Shape` itself. Before the grammar's
    // `abstract_class_declaration` was read, this class held no members at all.
    expect(callsFrom(graph, 'Shape.describe')).toContainEqual(
      expect.objectContaining({ target: 'Shape.area', resolution: 'inherited' }),
    );
  });

  it('answers a field of the class through an arrow that keeps `this`', () => {
    // `const read = (): number => this.bounds.width` - the arrow is a declaration whose container is the method, and
    // the class is one step further out.
    expect(callsFrom(graph, 'Shape.measure.read')).toContainEqual(
      expect.objectContaining({ target: 'Bounds.half', resolution: 'receiverType' }),
    );
  });

  it('refuses the same field through a function expression, which is handed its own `this`', () => {
    expect(callsFrom(graph, 'Shape.rebound.read')).not.toContainEqual(
      expect.objectContaining({ target: 'Bounds.half' }),
    );
  });

  it('files the members of a class expression under the expression', () => {
    // `return class Inline extends Shape { area() { … } }` - the members belong to `Inline`, and `Inline` has a base.
    expect(callsFrom(graph, 'Factory.make.Inline.area')).toContainEqual(
      expect.objectContaining({ target: 'Bounds.half', resolution: 'receiverType' }),
    );
  });

  it('answers a field the class initialises by constructing it', () => {
    // `private readonly bounds = new Bounds(1)` states a type without an annotation.
    expect(callsFrom(graph, 'Factory.measure')).toContainEqual(
      expect.objectContaining({ target: 'Bounds.half', resolution: 'receiverType' }),
    );
  });

  it('answers a parameter whose type is an alias', () => {
    // `throughAlias(bounds: AnyBounds)` and `type AnyBounds = Bounds`.
    expect(callsFrom(graph, 'throughAlias')).toContainEqual(
      expect.objectContaining({ target: 'Bounds.half', resolution: 'receiverType' }),
    );
  });

  it('answers a call on a module-scope name bound to a class’s static function', () => {
    // `const maker = Maker.create` at the top of the file, called from a function below it.
    expect(callsFrom(graph, 'throughModuleBinding')).toContainEqual(
      expect.objectContaining({ target: 'Maker.resize', resolution: 'receiverType' }),
    );
  });
});
