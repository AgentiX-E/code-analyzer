export declare function retryAfterMs(header: unknown, now?: number): number | null;

export declare function backoffMs(
  attempt: unknown,
  options?: { baseMs?: number; capMs?: number; jitter?: number },
): number;

export declare const DEFAULT_ATTEMPTS: number;
