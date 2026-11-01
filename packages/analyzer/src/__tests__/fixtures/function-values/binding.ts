/**
 * The four ways a function value is given a name, and the one way a call is given a receiver that is a class.
 *
 * Every declaration below is a callable in the program the compiler emits, and two of the four spellings used to
 * produce no callable in the graph at all: `const f = function () {}` was filed as a constant and `class C { static m =
 * () => {} }` was filed as a field type and nothing else, so the calls inside their bodies hung off the file.
 */

import { toArray, toSet } from './format';

/** A function expression bound to a constant. */
export const convertMap = function (input: string): string[] {
  return toArray(input);
};

/** The same spelling, calling its neighbour. This one is a same-file call. */
export const convertObject = function (input: string): string[] {
  return convertMap(input);
};

export class Payload {
  /** A static field holding an arrow: `Payload.make(…)` is a call to `make`. */
  static make = (input: string): Payload => new Payload(input);

  /** An instance field holding an arrow: `payload.handle(…)` is a call to `handle`. */
  handle = (input: string): Set<string> => toSet(input);

  private readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  describe(): string {
    return this.value;
  }
}

/** A class that declares the member name `put`, so that a call is resolved by receiver and not by member name. */
export class Sink {
  put(name: string): string {
    return name;
  }
}

export class Registry {
  static keys: string[] = [];

  static put(name: string): void {
    Registry.keys.push(name);
  }

  /** A call whose receiver names the class: `ClassName.staticMember(…)` reaches the static member. */
  static install(name: string): void {
    Registry.put(name);
    new Sink().put(name);
  }
}

/** A receiver that is a value rather than a class, carrying the same member name as `Registry.put`. */
export const alias = { put: (name: string): string => name };

export function viaAlias(name: string): string {
  return alias.put(name);
}

/** A local binding that shadows the class name, so the receiver is a value as well. */
export function shadowed(name: string): string {
  const Registry = { put: (value: string): string => value };
  return Registry.put(name);
}
