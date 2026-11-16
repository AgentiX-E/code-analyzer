// @code-analyzer — the retry a transient failure earns, as a type the harness can read

/** The statuses worth another attempt: overload and rate limiting, not a wrong URL. */
export const TRANSIENT_STATUSES: readonly number[];

/** Whether a status is worth another attempt. A missing status is not. */
export function isTransientStatus(status: number | string | undefined | null): boolean;

/** The waits, in order, doubling from `baseMs` and capped. */
export function retryDelays(options?: { attempts?: number; baseMs?: number; capMs?: number }): number[];

/** One attempt's answer: a success carrying its value, or a failure carrying its reason and its own judgement. */
export interface AttemptResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly retryable?: boolean;
  readonly [key: string]: unknown;
}

/**
 * Signals an attempt until it succeeds or its failures stop being temporary; **the last reason survives**, so a pull
 * request that was finally lost still says why.
 */
export function withRetry(
  attempt: (index: number) => AttemptResult | Promise<AttemptResult>,
  options?: {
    attempts?: number;
    baseMs?: number;
    capMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<AttemptResult & { attempts: number }>;
