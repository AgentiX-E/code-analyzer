// **A cache keyed by every commit a run touches is a cache that grows with the corpus.**
//
// The reach arm built one repository index per pull-request head commit and kept all of them: `reachIndexes` was a
// `Map` with no eviction, written once per pull request and never read twice, because **the loop reviews one pull
// request at a time and the next one always has a different head**. On 2026-11-20 the fifty-pull-request confirmation of
// R-44 died at 4 055 MB of heap - `FATAL ERROR: Reached heap limit` - after the fourteen-pull-request run of the same
// code had passed, which is the shape of a leak and not of a big input.
//
// The arithmetic the failure was: one index of a twenty-thousand-file checkout is tens of megabytes, and **fifty of them
// is the whole default heap**. A cache that answers one question - *is this the index I am already holding* - costs one
// entry; a cache that answers *have I ever seen this commit* costs the corpus.
//
// **The trade the smaller cache makes is stated, not hidden**: a head commit that recurs after another pull request was
// reviewed is rebuilt rather than served, so the run pays seconds and not gigabytes. A rebuild is slow; a heap limit is
// a run that produced nothing.
//
// The checkouts have the same shape one level down. Each clone is a directory, so remembering every commit also keeps
// every working tree on a runner with a fixed disk - and the same argument applies: **one pull request is reviewed at a
// time, so one checkout is in use at a time.**

import { describe, expect, it } from 'vitest';

import {
  checkoutsToPrune,
  createOneIndexCache,
} from '../../../.github/scripts/lib/one-index-cache.mjs';

describe('a run holds one index at a time', () => {
  it('serves the index it is holding and nothing else', () => {
    const cache = createOneIndexCache();
    expect(cache.held).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', { files: 1 });
    expect(cache.get('a')).toEqual({ files: 1 });
    expect(cache.held).toBe(1);
  });

  it('forgets the previous commit rather than the corpus', () => {
    const cache = createOneIndexCache();
    for (let at = 0; at < 50; at += 1) cache.set(`sha-${String(at)}`, { at });
    // **Fifty commits, one index**: the run's peak retention is one, whatever the corpus size.
    expect(cache.held).toBe(1);
    expect(cache.evictions).toBe(49);
    expect(cache.get('sha-49')).toEqual({ at: 49 });
    // **An evicted commit is rebuilt, not mis-answered** - `undefined` is what the caller reads as "build it".
    expect(cache.get('sha-0')).toBeUndefined();
  });

  it('does not count a rewrite of the commit it already holds as an eviction', () => {
    const cache = createOneIndexCache();
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.evictions).toBe(0);
    expect(cache.get('a')).toBe(2);
    expect(cache.held).toBe(1);
  });

  it('counts the commit it drops so the artifact can show the bound was reached', () => {
    const cache = createOneIndexCache();
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.evictions).toBe(1);
    // A run whose eviction count equals its index builds minus one is a run that never held two.
    expect(cache.evictions).toBe(1 - 0);
  });
});

describe('a run keeps one checkout on disk', () => {
  it('names every directory but the one in use', () => {
    const entries = [
      ['sha-new', '/tmp/agent-new'],
      ['sha-old', '/tmp/agent-old'],
      ['sha-failed', null],
    ];
    expect(checkoutsToPrune(entries, 'sha-new')).toEqual(['/tmp/agent-old']);
  });

  it('prunes nothing when only the current checkout exists', () => {
    expect(checkoutsToPrune([['sha-new', '/tmp/agent-new']], 'sha-new')).toEqual([]);
    expect(checkoutsToPrune([], 'sha-new')).toEqual([]);
  });

  it('never names the directory a pull request is about to read', () => {
    const entries = [
      ['sha-a', '/tmp/agent-a'],
      ['sha-b', '/tmp/agent-b'],
    ];
    expect(checkoutsToPrune(entries, 'sha-b')).not.toContain('/tmp/agent-b');
  });
});
