/**
 * The function values that declare nothing, and the ones that are not function values at all.
 *
 * A provider has to walk past all of these without inventing a declaration: a callback, a destructuring binding, a
 * field of a class that has no name to file it under, and a field whose value is a number.
 */

/** A callback passed straight into a call: `anonymousCallback` is the generator's name for it, not a name in the file. */
export const mapped = [1, 2, 3].map(function anonymousCallback(value: number): number {
  return value * 2;
});

/** A function expression bound to a pattern rather than to a name. */
export const { broken } = function (): Record<string, number> {
  return {};
};

/** A class expression with no name: its fields have no container to be filed under. */
export const Anonymous = class {
  handler = (): string => 'anonymous';
};

/** A field whose value is a value. */
export class Counter {
  count = 0;

  static label = 'counter';
}
