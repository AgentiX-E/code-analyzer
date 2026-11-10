// A page of results is not the corpus, and the difference has to be computed rather than remembered.
//
// **The bill.** `docs/SECURITY.md` was written on 2026-11-10 after a triage of the code-scanning corpus. It recorded
// "twenty-five alerts, six catastrophic, nineteen not" for the regular-expression rules and "nineteen open" for
// `js/insecure-temporary-file`, and it wrote the rule that an unmeasured alert is not triaged. Every number in it came
// from one request:
//
//     GET /repos/AgentiX-E/code-analyzer/code-scanning/alerts?state=open&per_page=100
//
// The repository held **367** open alerts that day. The request returned an array of a hundred. The array had a length,
// the length was used, and the rule counts inside those hundred were 19 for `js/insecure-temporary-file` and 25 for the
// regex rules combined. The real corpus was **130** for the first rule and **79 + 4** for the second. So the file that
// declared "not yet measured means not triaged" had itself measured fourteen per cent of the thing it named, and the
// sentence "it is the next security item" was written about a seventh of the work.
//
// Nothing threw. That is the shape: `fetch` returned something array-shaped, the arithmetic on it was correct, and the
// only wrong object was the population. **This file holds the repair** - a walk that ends only on a short page, and a
// count that carries its own total - and it asserts the arithmetic of the specific error above, so the next reader can
// check the instrument instead of trusting it.

import { describe, expect, it } from 'vitest';

import {
  MAX_PAGES,
  PaginationError,
  collectAllPages,
  countBy,
} from '../../../.github/scripts/lib/paginate.mjs';

/** A server that holds `items` and paginates them honestly, `pageSize` at a time. */
function server<T>(items: T[], pageSize = 100) {
  const requested: number[] = [];
  return {
    requested,
    fetchPage: async (page: number): Promise<T[]> => {
      requested.push(page);
      const from = (page - 1) * pageSize;
      return items.slice(from, from + pageSize);
    },
  };
}

/** Three hundred and sixty-seven alerts, of which one hundred and thirty are one rule - the day's real shape. */
function theRealCorpus(): { rule: { id: string } }[] {
  const alerts: { rule: { id: string } }[] = [];
  for (let index = 0; index < 130; index += 1)
    alerts.push({ rule: { id: 'js/insecure-temporary-file' } });
  for (let index = 0; index < 79; index += 1) alerts.push({ rule: { id: 'js/polynomial-redos' } });
  for (let index = 0; index < 158; index += 1) alerts.push({ rule: { id: 'other' } });
  return alerts;
}

describe('a corpus larger than one page', () => {
  it('is collected in full, so the count is 130 and not 100', async () => {
    const { fetchPage } = server(theRealCorpus());
    const all = await collectAllPages(fetchPage, { pageSize: 100, what: 'alerts' });

    expect(all).toHaveLength(367);
    const { total, counts } = countBy(all, (alert) => alert.rule.id);
    expect(total).toBe(367);
    expect(counts[0]).toEqual({ key: 'other', count: 158 });
    expect(counts.find((entry) => entry.key === 'js/insecure-temporary-file')?.count).toBe(130);
  });

  it('is the number the audit got wrong, so the two answers are pinned side by side', async () => {
    const corpus = theRealCorpus();
    const { fetchPage } = server(corpus);

    // What the single request saw: the first page, read as if it were everything.
    const onePage = await fetchPage(1);
    const pageView = countBy(onePage, (alert) => alert.rule.id);
    // What the walk saw.
    const wholeView = countBy(
      await collectAllPages(fetchPage, { pageSize: 100 }),
      (alert) => alert.rule.id,
    );

    expect(pageView.total).toBe(100);
    expect(wholeView.total).toBe(367);
    expect(pageView.counts.find((entry) => entry.key === 'js/insecure-temporary-file')?.count).toBe(
      100,
    );
    expect(
      wholeView.counts.find((entry) => entry.key === 'js/insecure-temporary-file')?.count,
    ).toBe(130);
  });

  it('asks for one page at a time, in order, and never asks twice', async () => {
    const { fetchPage, requested } = server(theRealCorpus());
    await collectAllPages(fetchPage, { pageSize: 100 });

    expect(requested).toEqual([1, 2, 3, 4]);
  });

  it('stops on the short page that follows the last full one', async () => {
    const { fetchPage, requested } = server([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4);
    const all = await collectAllPages(fetchPage, { pageSize: 4 });

    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(requested).toEqual([1, 2, 3]);
  });
});

describe('a corpus that ends exactly on a page boundary', () => {
  it('is allowed one empty page, because a full page carries no information about the end', async () => {
    const { fetchPage, requested } = server([1, 2, 3, 4, 5, 6, 7, 8], 4);
    const all = await collectAllPages(fetchPage, { pageSize: 4 });

    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(requested).toEqual([1, 2, 3]);
  });

  it('rejects a server that answers page one forever, because no page it sent was ever short', async () => {
    // A server that ignores `page` answers page one forever. Every answer is full, so no answer is the end, and the only
    // way out is the runaway detector - which is why the detector counts *pages* and not items.
    const fetchPage = async (): Promise<number[]> => Array.from({ length: 4 }, (_, index) => index);
    const error = (await collectAllPages(fetchPage, { pageSize: 4, what: 'alerts' }).catch(
      (thrown: unknown) => thrown,
    )) as PaginationError;

    expect(error).toBeInstanceOf(PaginationError);
    expect(error.pagesRead).toBe(MAX_PAGES);
    expect(error.collected).toBe(MAX_PAGES * 4);
    expect(error.message).toMatch(/not the corpus/);
  });
});

describe('a walk that stops for a reason other than the end of the corpus', () => {
  it('rejects a response that was never a page', async () => {
    const fetchPage = async (): Promise<number[]> =>
      ({ message: 'Bad credentials' }) as unknown as number[];

    await expect(collectAllPages(fetchPage, { pageSize: 100, what: 'alerts' })).rejects.toThrow(
      /was not an array/,
    );
  });

  it('rejects a page size that is not a positive integer', async () => {
    const fetchPage = async (): Promise<number[]> => [];

    await expect(collectAllPages(fetchPage, { pageSize: 0 })).rejects.toThrow(/positive integer/);
    await expect(collectAllPages(fetchPage, { pageSize: 1.5 })).rejects.toThrow(/positive integer/);
  });

  it('carries how far it got, so a failure names the population it had', async () => {
    let call = 0;
    const fetchPage = async (): Promise<number[]> => {
      call += 1;
      if (call === 1) return [1, 2, 3];
      return { message: 'rate limited' } as unknown as number[];
    };

    const error = (await collectAllPages(fetchPage, { pageSize: 3 }).catch(
      (thrown: unknown) => thrown,
    )) as PaginationError | undefined;
    expect(error?.pagesRead).toBe(2);
    expect(error?.collected).toBe(3);
  });
});

describe('an empty corpus', () => {
  it('is an empty array and not an error', async () => {
    const { fetchPage } = server([]);
    await expect(collectAllPages(fetchPage, { pageSize: 100 })).resolves.toEqual([]);
  });
});

describe('a count that carries its own total', () => {
  it('is descending, and ties are ordered by key so a table does not move between runs', () => {
    const items = ['b', 'a', 'c', 'a', 'c', 'd'];
    const { total, counts } = countBy(items, (item) => item);

    expect(total).toBe(6);
    expect(counts).toEqual([
      { key: 'a', count: 2 },
      { key: 'c', count: 2 },
      { key: 'b', count: 1 },
      { key: 'd', count: 1 },
    ]);
  });

  it('reports zero rather than nothing for an empty corpus', () => {
    expect(countBy([], (item: string) => item)).toEqual({ total: 0, counts: [] });
  });
});
