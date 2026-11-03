// @code-analyzer/analyzer — the type facts a declaration states without an annotation.
//
// Three spellings, and every one of them was a receiver with no type: a type alias (`type Any = Base`), a name bound to
// a class's static function (`const stringType = ZodString.create`), and a binding at module scope, which every
// declaration in the file can reach.

import { Bounds } from './shapes';

export type AnyBounds = Bounds;

export class Maker {
  static create = (): Maker => new Maker();

  resize(): number {
    return 0;
  }
}

const maker = Maker.create;

export function throughAlias(bounds: AnyBounds): number {
  return bounds.half();
}

export function throughModuleBinding(): number {
  // **The chain, not a local**: `const made = maker()` would ask the walk to infer a return type from a call it only
  // sees the name of, which is the shape this rule does *not* answer.
  return maker().resize();
}
