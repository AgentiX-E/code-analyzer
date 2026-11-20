// Types for `one-index-cache.mjs`.
//
// **Hand-written for the same reason the other declarations here are**: the module is imported by a `.mjs` script that
// runs under plain node and by tests that run through vitest, so the file that is imported has to be the file that runs.

/** An index holder with a capacity of one. */
export interface OneIndexCache<T> {
  /** The held value when `key` is the commit being held, `undefined` otherwise - which the caller reads as *build it*. */
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  /** `0` or `1`, by construction. */
  readonly held: number;
  /** How many commits were dropped to hold the current one. */
  readonly evictions: number;
}

export declare function createOneIndexCache<T = unknown>(): OneIndexCache<T>;

/**
 * The checkout directories a run may delete, given the commit it is about to read.
 *
 * Every directory but the current one; entries whose directory is `null` are skipped.
 */
export declare function checkoutsToPrune(
  entries: Iterable<readonly [string, string | null]>,
  currentSha: string,
): string[];
