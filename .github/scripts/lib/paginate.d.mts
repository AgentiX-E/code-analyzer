// Types for `paginate.mjs`.
//
// Same reasoning as `unread-corpus.d.mts`: the module is imported by a `.mjs` script that runs under plain node and by
// tests that run through vitest, so the file that is imported has to be the file that runs.

/** A page limit that is a runaway detector, not a budget. */
export declare const MAX_PAGES: number;

/** Thrown when the walk stopped for a reason that is not "the server sent a short page". */
export declare class PaginationError extends Error {
  readonly pagesRead: number;
  readonly collected: number;
  constructor(message: string, facts: { pagesRead: number; collected: number });
}

/**
 * Collect every element the server will give, page by page.
 *
 * @throws {PaginationError} when a page is not an array, or when the walk reaches `MAX_PAGES` without ever seeing a
 * page shorter than `pageSize`.
 */
export declare function collectAllPages<T>(
  fetchPage: (page: number) => Promise<T[]>,
  options: { pageSize: number; what?: string },
): Promise<T[]>;

/** Count by a key, descending, with the total attached so the denominator is always printable. */
export declare function countBy<T>(
  items: T[],
  keyOf: (item: T) => string,
): { total: number; counts: Array<{ key: string; count: number }> };
