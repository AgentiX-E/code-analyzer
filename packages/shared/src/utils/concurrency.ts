// @code-analyzer/shared — bounded concurrency for per-item asynchronous work
//
// **A measurement that takes eighty-five minutes is a ceiling on how wide the next one can be.** The rerank ladder in
// `cosqa-retrieval.test.ts` is a thousand independent questions, each answered by one completion per arm per depth, and
// it ran them one at a time: six arms over five hundred questions is three thousand completions and eighty-five
// minutes, which is every wider ladder this project could afford priced into one queue.
//
// The work is independent by construction - question *i*'s prompt does not contain question *j*'s answer - so the only
// thing the sequential loop bought was a guarantee that the output array was assembled in the order the loop ran. This
// function keeps that guarantee **without** keeping the queue: results land in their input positions, so a caller that
// raises the limit changes how long a run takes and not what it measured.
//
// **Three properties are deliberate and each has a test.**
//
// 1. **Order is the input's, never the completion's.** A `Promise.all` over an array of promises already does this; a
//    version that pushed into a shared array as each finished would reorder the columns under concurrency, and a
//    reordered column is a different measurement rather than a slower one.
// 2. **`limit` is validated rather than coerced.** `0` workers would hang forever and `NaN` would compare false against
//    every bound, so an unusable limit throws instead of quietly running one at a time - **a silent fallback to serial
//    is the direction that looks like it worked**.
// 3. **A failure stops new work and cannot abandon running work.** Promises are not cancellable, so the honest contract
//    is: no further item starts, the in-flight items are awaited, and the first error is rethrown afterwards. A caller
//    that returns early while three completions are still open would report a bill it did not finish paying.

/**
 * Run `run` over every item with at most `limit` in flight, returning results in input order.
 *
 * @param items The work items. Read once; the array is not mutated.
 * @param limit How many items may be in flight at once. A positive integer; `1` is strictly sequential.
 * @param run The per-item work. Receives the item and its position in `items`.
 * @throws RangeError when `limit` is not a positive integer. **Thrown before any item is started**, so a caller that
 * mistyped the limit pays nothing.
 * @throws The first error `run` threw, after the items already in flight have settled.
 */
export async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  // **Validated before the first item runs.** A limit of `1.5` is not "about one"; it is a caller that computed the
  // limit wrongly, and rounding it would hide the arithmetic that produced it.
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`mapWithConcurrency requires a positive integer limit, received ${limit}`);
  }

  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;

  /**
   * One worker: claim the next unclaimed index, run it, repeat until the queue is empty or something failed.
   *
   * **The counter is shared and single-threaded**, so two workers cannot claim the same index: `next++` is evaluated
   * before the first `await` and JavaScript does not interleave synchronous statements.
   */
  const worker = async (): Promise<void> => {
    for (;;) {
      if (failed) return;
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await run(items[index]!, index);
      } catch (error: unknown) {
        // **The first failure wins the message**, because the second is usually the first one's consequence.
        if (!failed) {
          failed = true;
          failure = error;
        }
        return;
      }
    }
  };

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  if (failed) throw failure;
  return results;
}
