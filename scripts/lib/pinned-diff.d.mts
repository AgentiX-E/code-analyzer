// **Declarations for the pinned-diff fetch, because a test that imports a `.mjs` without them compiles against `any`.**
//
// The same rule `diff-side-lines.d.mts` records: an undeclared module is `any`, so an assertion about `pinned` would pass
// against a string. The shapes here are the ones the implementation builds and the ones the harness and the reach
// instrument read.

/** The commit pair a corpus row names: the base the goldens were written against and the head they describe. */
export interface CorpusCommits {
  base: string;
  head: string;
}

export interface PullParts {
  owner: string;
  repo: string;
  number: string;
}

/** A diff that was read at the corpus's own commits, or a refusal that says why it could not be. */
export type PinnedDiff =
  { ok: true; diff: string; pinned: true } | { ok: false; reason: string; status?: number };

export declare function commitsOf(row: unknown): CorpusCommits | null;

export declare function pullParts(url: unknown): PullParts | null;

export declare function compareDiffUrl(parts: PullParts & CorpusCommits): string;

export declare function fetchPinnedDiff(options: {
  url: unknown;
  commits: CorpusCommits | null;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<PinnedDiff>;
