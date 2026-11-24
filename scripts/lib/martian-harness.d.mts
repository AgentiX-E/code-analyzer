// @code-analyzer — the field's corpus and the field's file, as the two arms of the Martian harness share them

/** One golden pull request: its repository, its title, its URL, and the comments a maintainer wrote. */
export interface GoldenPullRequest {
  readonly repo: string;
  readonly prTitle: string;
  readonly url: string;
  readonly comments: readonly unknown[];
}

/** Reads `offline/golden_comments/*.json` into a flat list; a missing directory is an empty corpus. */
export function readGolden(dir: string): GoldenPullRequest[];

/** The `owner/repo/pull/number` a URL names, or `null` when it names none. */
export function pullOf(
  url: string | null | undefined,
): { owner: string; repo: string; number: string } | null;

/** The unified diff of a pull request, or `null` when the API does not supply one. */
export function fetchDiff(url: string, token?: string): Promise<string | null>;

/** The base and head commits of a pull request, which is what a range review needs. */
export function pullCommits(
  url: string,
  token?: string,
): Promise<{ source: string; target: string } | null>;

/** One comment as the field's schema stores it: where it points and what it says. */
export interface ReviewComment {
  readonly path?: string;
  readonly line?: number;
  readonly body?: string;
  readonly category?: string | null;
  readonly severity?: string | null;
  readonly created_at?: string;
}

/** One arm's review of one pull request, under the tool name the arm wrote it with. */
export interface ToolReview {
  readonly tool: string;
  readonly pr_url?: string;
  readonly review_comments?: readonly ReviewComment[];
  readonly candidates?: readonly string[];
}

/** One arm's rows, keyed by pull request URL, in their `benchmark_data.json` entry shape. */
export interface ReviewRows {
  readonly [url: string]: {
    readonly pr_title?: string;
    readonly original_url?: string;
    readonly source_repo?: string;
    readonly golden_comments?: readonly unknown[];
    readonly reviews?: readonly ToolReview[];
  };
}

/** What a merge changed: rows touched, pull requests in the file, and the tool count before and after. */
export interface MergeOutcome {
  readonly merged: number;
  readonly prs: number;
  readonly toolsBefore: number;
  readonly toolsAfter: number;
}

/** Replaces one tool's reviews and leaves every other tool's alone; idempotent on a rerun. */
export function mergeReviews(existing: ReviewRows, rows: ReviewRows, tool: string): MergeOutcome;

/** Merges one tool's candidate statements into `candidates.json` rather than replacing the file. */
export function mergeCandidates(
  path: string,
  perUrl: { readonly [url: string]: readonly unknown[] },
  tool: string,
): { rows: number; tools: number };
