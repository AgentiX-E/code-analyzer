// A run that read three quarters of its corpus may not report the figure as if it read all of it.
//
// **What this file was written against.** Run
// [42811727182](https://github.com/AgentiX-E/code-analyzer/actions/runs/42811727182) reviewed **38 of the 50 pull
// requests** it was dispatched for and published `prsWithoutDiff: 12` - a count, with no list, in an artifact whose other
// fields each carry the reason they need one. So the run could not say whether the cause was a rate limit, a typo in the
// corpus, or a network fault, **and those three have different repairs**.
//
// Worse, both arms of the same dispatch disagreed: the `with` arm read all 50 and the `without` arm read 38. **The paired
// comparison between them is therefore restricted to the pull requests they share**, which is correct and is also
// something a reader has to be told rather than left to derive.

import { describe, expect, it } from 'vitest';

import {
  UNREAD_DISCLOSURE_THRESHOLD,
  describeUnread,
  readTheWholeCorpus,
  unreadCorpus,
} from '../../../.github/scripts/lib/unread-corpus.mjs';

describe('how much of the corpus arrived', () => {
  it('derives the read count from the two it was given rather than trusting a third', () => {
    expect(unreadCorpus({ requested: 50, unread: 12 })).toEqual({
      requested: 50,
      unread: 12,
      read: 38,
      share: 0.24,
    });
  });

  it('never reports more unread than requested, because a negative read count is not a corpus', () => {
    expect(unreadCorpus({ requested: 5, unread: 9 }).read).toBe(0);
    expect(unreadCorpus({ requested: 5, unread: 9 }).share).toBe(1);
  });

  it('treats an empty corpus as nothing lost rather than as a division by zero', () => {
    expect(unreadCorpus({ requested: 0, unread: 0 }).share).toBe(0);
  });

  it('clamps nonsense rather than publishing a fractional number of pull requests', () => {
    expect(unreadCorpus({ requested: 50.7, unread: -3 })).toEqual({
      requested: 50,
      unread: 0,
      read: 50,
      share: 0,
    });
  });
});

describe('the log line says how much and why, or nothing at all', () => {
  it('is absent when the whole corpus arrived, because a line that always prints is a line nobody reads', () => {
    expect(describeUnread({ requested: 50, unread: 0, pulls: [] })).toBeNull();
  });

  it('names the share and the first reason when part of it did not', () => {
    const line = describeUnread({
      requested: 50,
      unread: 12,
      pulls: [
        {
          key: 'https://github.com/a/b/pull/1',
          reason: 'the diff request returned 403 with 0 requests left',
        },
        {
          key: 'https://github.com/a/b/pull/2',
          reason: 'the diff request returned 403 with 0 requests left',
        },
      ],
    });
    expect(line).toContain('12 of 50');
    expect(line).toContain('24 %');
    // **The first reason and not all twelve**, because twelve identical rate-limit messages are twelve lines that say one
    // thing, and the thing that matters is which of the three causes it is.
    expect(line).toContain('403');
    expect(line).not.toContain('pull/2');
  });

  it('says so when the loss has no recorded reason, rather than printing an empty sentence', () => {
    expect(describeUnread({ requested: 10, unread: 4, pulls: [] })).toContain('no reason recorded');
  });
});

describe('whether the figure is about the corpus or about the part that arrived', () => {
  it('treats a loss inside the threshold as a result about the whole corpus', () => {
    expect(readTheWholeCorpus({ requested: 50, unread: 2 })).toBe(true);
    expect(readTheWholeCorpus({ requested: 50, unread: 0 })).toBe(true);
  });

  it('treats the run this file was written for as a result about 38 pull requests', () => {
    // **A quarter of the corpus gone is not a footnote.** The threshold is one in twenty, and the run that produced this
    // file lost twenty-four percent.
    expect(readTheWholeCorpus({ requested: 50, unread: 12 })).toBe(false);
    expect(UNREAD_DISCLOSURE_THRESHOLD).toBe(0.05);
  });

  it('is a disclosure rather than a refusal, because a run that read 38 of 50 is still a result', () => {
    // The distinction matters: refusing to publish would throw away a paid run, and publishing it as if it were the whole
    // corpus is what this file exists to prevent. **The share travels; the figure stays.**
    const facts = unreadCorpus({ requested: 50, unread: 12 });
    expect(facts.read).toBe(38);
    expect(facts.share).toBeGreaterThan(UNREAD_DISCLOSURE_THRESHOLD);
  });
});
