// @code-analyzer/core — Promise Timeout Utility

/**
 * Execute a promise with a timeout, rejecting if it does not settle in time.
 *
 * The timer handle is always assigned before it is cleared: the `Promise`
 * executor runs synchronously, so `setTimeout` has already returned by the time
 * `Promise.race` is awaited. Node's `setTimeout` always returns a truthy `Timeout`
 * object, and clearing an already-fired timer is a no-op, so the `finally` block
 * can clear unconditionally.
 *
 * @param promise - The promise to bound
 * @param ms - Timeout in milliseconds
 * @param timeoutMessage - Error message used when the timeout wins the race
 * @returns The resolved value of `promise`
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
