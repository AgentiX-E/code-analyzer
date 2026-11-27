// **Declarations for the dispatch guard, because a test that imports a `.mjs` without them compiles against `any`.**
//
// `scripts/lib/dispatch-head.d.mts` covers the three pure checks; this covers the flow that spends the money, so a case
// can assert a *stage* - which of the three refusals fired - rather than only that something failed.

export interface DispatchOptions {
  apiBase: string;
  token: string;
  repo: string;
  workflow: string;
  expect: string[];
  inputs: Record<string, string>;
  dryRun: boolean;
  wait: number;
  interval: number;
  ref: string | null;
}

/** A dispatch that bought a run, one that would have, or one that was refused before or after the request. */
export type DispatchOutcome =
  | { ok: true; dryRun: true; ref: string; tip: string; inputs: number }
  | {
      ok: true;
      dryRun: false;
      ref: string;
      tip: string;
      run: { id: number; url: string | null; createdAt: string };
      others: number;
      cancelled: unknown[];
    }
  | {
      ok: false;
      stage: 'repo' | 'ref' | 'tip' | 'path' | 'dispatch' | 'read-back' | 'stray';
      reason: string;
      ref?: string;
      tip?: string;
      cancelled?: unknown[];
    };

export declare function runDispatch(options: {
  options: DispatchOptions;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}): Promise<DispatchOutcome>;
