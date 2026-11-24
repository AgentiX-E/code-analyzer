// **A cached file entry has exactly three shapes, and §149.5 is the cost of confusing two of them.**
//
// `scripts/gate-replay.mjs` writes one of three things under each path it fetched: the file's text, `null` for a 404, or
// `{ error }` for a request that did not complete. §150 split the last two into different buckets - an unpostable path
// and a gap in the evidence - and the test for the first of them was written as `text === null`, which the analyser
// cannot type on a value that came back through `JSON.parse`.
//
// **The discriminator moved into a predicate, so the shapes are pinned here rather than inferred from a corpus**: a test
// that pinned them through `main`'s output would be pinning them through fifty pull requests and a stubbed network.

import { describe, expect, it } from 'vitest';

import { isFailedRead } from '../../../scripts/gate-replay.mjs';

describe('the three shapes a cached file entry can take', () => {
  it('reads a failed request as an object', () => {
    expect(isFailedRead({ error: 'fetch failed' })).toBe(true);
  });

  it('reads a 404 as an absent path, not as a failure', () => {
    // **This is §149.5's defect in one line**: the run that read a `fetch failed` as "the head has no such file" told a
    // story about a deleted file disarming a pull request's gate, and the file was there.
    expect(isFailedRead(null)).toBe(false);
  });

  it('reads a file’s own text as neither', () => {
    expect(isFailedRead('const x = 1;')).toBe(false);
    // A string is not a failed read, and JSON.parse can hand back an array where an object is expected.
    expect(isFailedRead([])).toBe(false);
  });
});
