// **A cache keyed by every commit a run touches is a cache that grows with the corpus.**
//
// The reach arm needs the repository as it stood at the pull request's head commit, and it built that index once per
// head and kept every one of them. **The loop reviews one pull request at a time and consecutive pull requests never
// share a head**, so the map was written once per pull request, read once, and never read again - it was not a cache at
// all, it was a list of everything the run had ever built.
//
// The fifty-pull-request confirmation of R-44 died of it on 2026-11-20:
//
// ```
// [2825:0x190fd000] 2765524 ms: Mark-Compact 4055.0 (4141.3) -> 4040.2 (4142.6) MB
// FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
// ```
//
// - after the fourteen-pull-request run of the same code passed. **That is the shape of a leak and not of a big input**:
// the input grew by 3.6x and the retained heap grew with it, file for file.
//
// **The bound is the loop's own shape.** One pull request is reviewed at a time, so one index is in use at a time, and a
// cache of one answers the only question the loop asks - *is this the index I am already holding*. A head that recurs
// after another pull request was reviewed is **rebuilt rather than served**: the run pays seconds, and not gigabytes.
// **The eviction count is reported** so that an artifact can show the bound was reached rather than assuming it.

/**
 * An index holder with a capacity of one.
 *
 * `get` returns `undefined` for a commit that is not the one being held, which is exactly what the caller already reads
 * as *build it* - so the smaller cache changes a cost and not a control flow.
 */
export function createOneIndexCache() {
  let heldKey = null;
  let heldValue;
  let evictions = 0;
  return {
    get(key) {
      return heldKey === key ? heldValue : undefined;
    },
    set(key, value) {
      // **A rewrite of the commit already held is not an eviction**, and counting it as one would make the artifact's
      // `evictions === builds - 1` check fail for a reason that has nothing to do with memory.
      if (heldKey !== null && heldKey !== key) evictions += 1;
      heldKey = key;
      heldValue = value;
    },
    /** How many indexes are retained right now: never more than one, by construction rather than by care. */
    get held() {
      return heldKey === null ? 0 : 1;
    },
    get evictions() {
      return evictions;
    },
  };
}

/**
 * The checkout directories a run may delete, given the commit it is about to read.
 *
 * **Every directory but the current one**, because a clone is a working tree on a runner whose disk is fixed, and the
 * same argument that bounds the index bounds this: one pull request is reviewed at a time. An entry whose directory is
 * `null` is a clone that failed and is skipped rather than deleted - `rmSync(null)` would throw, and a counter that is
 * incremented by an exception is a counter nobody can read.
 */
export function checkoutsToPrune(entries, currentSha) {
  const out = [];
  for (const [sha, directory] of entries) {
    if (sha === currentSha) continue;
    if (typeof directory !== 'string' || directory.length === 0) continue;
    out.push(directory);
  }
  return out;
}
