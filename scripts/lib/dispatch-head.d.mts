// **Declarations for the dispatch guard, because a test that imports a `.mjs` without them compiles against `any`.**
//
// An undeclared module is `any`, so `expect(result.ok).toBe(false)` would pass against a function that returned the
// string `'no'`. The shapes here are the ones the implementation builds and the CLI reads.

/** A refusal, or the value the check produced. */
export type HeadCheck = { ok: true; ref: string } | { ok: false; reason: string };

export type PathCheck = { ok: true; path: string; commit: string } | { ok: false; reason: string };

/** A workflow run as the list endpoint reports it: the four fields this guard reads and nothing else. */
export interface DispatchRun {
  id: number;
  head_sha: string;
  created_at: string;
  status?: string;
  conclusion?: string | null;
}

export type PickResult =
  | { ok: true; run: DispatchRun; others: DispatchRun[]; strays: DispatchRun[] }
  | { ok: false; reason: string; strays?: DispatchRun[] };

export declare function refusalForRef(options: {
  ref: string | null;
  defaultBranch: string | null;
}): HeadCheck;

export declare function refusalForPath(options: {
  path: string;
  commit: string;
  status: number;
}): PathCheck;

export declare function floorToSecond(at: string | number): number;

export declare function pickDispatchRun(options: {
  runs: DispatchRun[];
  tip: string;
  startedAt: string | number;
}): PickResult;
