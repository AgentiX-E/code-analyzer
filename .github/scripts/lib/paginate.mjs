// Read every page, and fail when the reason you stopped is not "the corpus ended".
//
// **This module exists because of a counting error that survived three audits.** The code-scanning alerts were fetched
// with `per_page=100` and read as if that were the corpus. It is not: on 2026-11-10 the repository held 367 open alerts
// and the audit saw 100 of them, so `js/insecure-temporary-file` was recorded as nineteen findings when it was one
// hundred and thirty, and the temporary-path probe - which described itself as covering the rule - had looked at
// fourteen per cent of it. The number was not wrong because the query was wrong; it was wrong because a **page was
// treated as a set**, and nothing in the shape of the code said so: `await fetch(url)` returned an array, the array had
// a length, and every downstream calculation was correct about the wrong population.
//
// The repair is not to remember to paginate. It is to make "I stopped" a value the caller has to produce, and to refuse
// the stop reasons that are not "the server sent a short page". A caller that loops until it is done cannot undercount;
// a caller that reads one array can.

/** A page limit that is a runaway detector, not a budget: wanting more than this means the paging loop is wrong. */
export const MAX_PAGES = 500;

export class PaginationError extends Error {
  /**
   * @param {string} message
   * @param {{ pagesRead: number, collected: number }} facts
   */
  constructor(message, facts) {
    super(message);
    this.name = 'PaginationError';
    this.pagesRead = facts.pagesRead;
    this.collected = facts.collected;
  }
}

/**
 * Collect every element the server will give, page by page.
 *
 * `fetchPage(1)` is the first page. The walk ends when a page arrives with fewer than `pageSize` elements, which is the
 * only answer that carries information about the end of the corpus - an empty page included, because zero is fewer than
 * `pageSize`. A page that arrives **full** is not the end whatever its contents are, so the only way to leave this loop
 * with a full page in hand is to reach `MAX_PAGES` without ever seeing a short one.
 *
 * @template T
 * @param {(page: number) => Promise<T[]>} fetchPage
 * @param {{ pageSize: number, what?: string }} options
 * @returns {Promise<T[]>}
 */
export async function collectAllPages(fetchPage, options) {
  const { pageSize, what = 'results' } = options;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new PaginationError(`page size must be a positive integer, got ${String(pageSize)}`, {
      pagesRead: 0,
      collected: 0,
    });
  }

  /** @type {T[]} */
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await fetchPage(page);
    if (!Array.isArray(batch)) {
      throw new PaginationError(
        `page ${String(page)} of ${what} was not an array - the response was not read as a page at all`,
        { pagesRead: page, collected: all.length },
      );
    }
    all.push(...batch);
    if (batch.length < pageSize) {
      return all;
    }
  }

  throw new PaginationError(
    `stopped after ${String(MAX_PAGES)} full pages of ${what} - the walk is not terminating, so the count is not the corpus`,
    { pagesRead: MAX_PAGES, collected: all.length },
  );
}

/**
 * Count by a key, descending, with the total attached.
 *
 * The total is returned rather than left to the caller because the defect above was a denominator that nobody printed:
 * a table of per-rule counts with no total cannot be checked against the population it came from.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyOf
 * @returns {{ total: number, counts: Array<{ key: string, count: number }> }}
 */
export function countBy(items, keyOf) {
  /** @type {Map<string, number>} */
  const tally = new Map();
  for (const item of items) {
    const key = keyOf(item);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const counts = [...tally.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  return { total: items.length, counts };
}
