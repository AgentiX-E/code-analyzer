// @code-analyzer — the competitor's report format and range runner, declared for the callers that typecheck them

/** The separator: three U+2500 box-drawing characters, a path, and a line range. */
export const REVIEW_SEPARATOR: RegExp;

/** The bracketed tag: a category and a severity, dot-separated. */
export const REVIEW_TAG: RegExp;

/** The header's own count, which is what a parser's omissions are measured against. */
export const REVIEW_COUNT: RegExp;

/** One finding as the report states it, with its body gathered across lines. */
export interface ProseFinding {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly category: string | null;
  readonly severity: string | null;
  readonly body: string;
}

/** The report: the tool's own count beside what parsing recovered. */
export interface ProseReport {
  readonly declaredCount: number | null;
  readonly findings: ProseFinding[];
}

/** Parses one whole `ocr review` output. */
export function parseProseReport(text: string): ProseReport;

/** `owner/repo` of a pull request URL, or `null` when the URL does not name one. */
export function shortRepo(url: string | null | undefined): string | null;

/** What one range review produced: the whole report, or the reason there is none. */
export interface RangeReview {
  readonly ok: boolean;
  readonly stdout?: string;
  readonly outputFile?: string | null;
  readonly declaredCount?: number | null;
  readonly findings?: ProseFinding[];
  readonly reason?: string;
  readonly status?: number | null;
  readonly signal?: string | null;
}

/**
 * Reviews a two-commit range with the competitor's CLI, using the endpoint and key given; the checkout is temporary and
 * blobless, and every fallible step returns a reason rather than throwing.
 */
export function reviewRange(options: {
  url?: string;
  repo?: string | null;
  source: string;
  target: string;
  endpoint?: string;
  key?: string;
  model?: string;
  outputDir?: string | null;
  timeoutMs?: number;
  cloneTimeoutMs?: number;
}): RangeReview;
