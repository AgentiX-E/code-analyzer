// A finding's own words are the query, and the index answers with whole rows.
//
// §79.3 named this mechanism M3 and left it unbuilt: `aoci-code` retrieves with a substring and a tag filter over thirty
// whole lines, never with an embedding, and **the claim worth testing is that a finding's vocabulary is a good enough
// query**. These tests hold it to that claim and to the four properties a retrieval needs before a prompt can spend it:
// it finds the row, it does not return everything, it does not reorder itself, and it does not answer a question nobody
// asked.

import { describe, expect, it } from 'vitest';

import { queryWords, renderCognitionHits, searchCognitionIndex } from '../cognition-search.js';

import type { CognitionEntry } from '../cognition.js';

const QUEUE: CognitionEntry = {
  path: 'src/queue.ts',
  importance: 7,
  size: 'M',
  responsibility: 'bounded in-memory queue with a backpressure signal',
  readWith: ['src/metrics.ts'],
  dependedOnBy: ['the worker pool'],
  constraint: 'claim must be released before a job is dropped, or the slot leaks',
};

const METRICS: CognitionEntry = {
  path: 'src/metrics.ts',
  importance: 4,
  size: 'S',
  responsibility: 'counters and gauges',
  readWith: [],
  dependedOnBy: [],
  constraint: 'none',
};

const POOL: CognitionEntry = {
  path: 'src/pool.ts',
  importance: 9,
  size: 'M',
  responsibility: 'worker pool that drains the queue',
  readWith: ['src/queue.ts'],
  dependedOnBy: ['the http layer'],
  constraint: 'a job must never be started twice',
};

const INDEX = [QUEUE, METRICS, POOL];

describe('the query a finding text becomes', () => {
  it('splits on punctuation, folds case, and keeps identifiers whole', () => {
    expect(queryWords('getDirsFromFront(Base::Vector3d) leaks')).toEqual([
      'getdirsfromfront',
      'base',
      'vector3d',
      'leaks',
    ]);
  });

  it('drops the words every row contains, so a query can still be about something', () => {
    // `if`, `a`, `to` and `of` are in every row of every index; keeping them would make the score a rank of nothing.
    expect(queryWords('if a to of the')).toEqual(['the']);
  });
});

describe('the rows a finding retrieves', () => {
  it('finds the row whose contract mentions the subject of the finding', () => {
    const hits = searchCognitionIndex(INDEX, 'the claim is released after a job is dropped');

    expect(hits[0]?.entry.path).toBe('src/queue.ts');
    // **And the words that brought it back are named**, so a reader can see why rather than trust the order.
    expect(hits[0]?.matched).toEqual(expect.arrayContaining(['claim', 'released', 'dropped']));
  });

  it('does not return a row that shares no word with the query', () => {
    const hits = searchCognitionIndex(INDEX, 'backpressure');

    expect(hits.map((hit) => hit.entry.path)).toEqual(['src/queue.ts']);
  });

  it('answers an empty query with nothing rather than with the alphabet', () => {
    expect(searchCognitionIndex(INDEX, '')).toEqual([]);
    expect(searchCognitionIndex(INDEX, 'a of to')).toEqual([]);
  });

  it('breaks a tie by importance and then by path, so two runs of the same query agree', () => {
    // `worker` is in two rows. **A retrieval that reorders itself between two runs is one nobody can diff**, which is
    // the property a reader of an artifact depends on.
    const hits = searchCognitionIndex(INDEX, 'worker');

    expect(hits.map((hit) => hit.entry.path)).toEqual(['src/pool.ts', 'src/queue.ts']);
    expect(searchCognitionIndex(INDEX, 'worker')).toEqual(hits);
  });

  it('respects the cap, because the cap is what makes the result a prompt', () => {
    expect(searchCognitionIndex(INDEX, 'queue worker job', { limit: 1 })).toHaveLength(1);
    expect(searchCognitionIndex(INDEX, 'queue worker job', { limit: 0 })).toEqual([]);
  });

  it('does not match a row whose only claim is that it has no constraint', () => {
    // `none` is the row's *shape* - a file with nothing to break - and a query word that matched it would return every
    // unconstrained row in the repository.
    expect(searchCognitionIndex(INDEX, 'none')).toEqual([]);
  });
});

describe('the block a reader is shown', () => {
  it('renders whole rows, and omits the field a row does not have', () => {
    const rendered = renderCognitionHits(searchCognitionIndex(INDEX, 'backpressure'));

    expect(rendered).toBe(
      'src/queue.ts · F: bounded in-memory queue with a backpressure signal · S: claim must be released before a job is dropped, or the slot leaks · R: src/metrics.ts',
    );
  });

  it('omits the field a row does not have, rather than printing an empty one', () => {
    // The row with nothing to read with, which the literal `none` constraint makes otherwise unretrievable.
    expect(renderCognitionHits(searchCognitionIndex(INDEX, 'counters gauges'))).toBe(
      'src/metrics.ts · F: counters and gauges · S: none',
    );
  });

  it('renders nothing for nothing, rather than a blank line that reads as a row', () => {
    expect(renderCognitionHits([])).toBe('');
    expect(renderCognitionHits(searchCognitionIndex(INDEX, 'none'))).toBe('');
  });
});

describe('the orders a tie can take', () => {
  const row = (path: string, importance: number, responsibility: string): CognitionEntry => ({
    path,
    importance,
    size: 'S',
    responsibility,
    readWith: [],
    dependedOnBy: [],
    constraint: 'none',
  });

  it('orders two equal rows by path, in either direction', () => {
    // **The comparator's first two outcomes**, because a sort whose branches are never exercised is a sort that can
    // silently stop being deterministic - and determinism is the property that lets two runs be diffed.
    expect(
      searchCognitionIndex([row('src/b.ts', 5, 'queue'), row('src/a.ts', 5, 'queue')], 'queue').map(
        (h) => h.entry.path,
      ),
    ).toEqual(['src/a.ts', 'src/b.ts']);
    expect(
      searchCognitionIndex([row('src/a.ts', 5, 'queue'), row('src/b.ts', 5, 'queue')], 'queue').map(
        (h) => h.entry.path,
      ),
    ).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('says nothing about two rows that are the same in every way it ranks by', () => {
    // The third outcome: equal score, equal importance, equal path. A comparator that returned `-1` here would make the
    // sort depend on the input order rather than on the rows.
    const hits = searchCognitionIndex(
      [row('src/a.ts', 5, 'queue'), row('src/a.ts', 5, 'queue')],
      'queue',
    );

    expect(hits).toHaveLength(2);
  });
});
