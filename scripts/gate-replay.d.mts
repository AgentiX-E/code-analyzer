/**
 * **The declaration for `scripts/gate-replay.mjs`.**
 *
 * Three things in the CLI are worth asserting rather than reading off its output: the pull-request URL parse, the split of
 * a unified diff by path (the only place a rename or a `/dev/null` section can be got wrong), and `main` itself, which the
 * test drives end to end over a small artifact and a stubbed network.
 */

/** `owner`, `repo` and the number, or `null` when the string is not a pull request URL. */
export function pullRequestOfUrl(
  url: string | null | undefined,
): { readonly owner: string; readonly repo: string; readonly number: number } | null;

/**
 * The unified diff cut into one section per path it names.
 *
 * **Both sides of a rename are keys**, because a finding may quote either, and the section text is kept whole: a
 * quotation can come from a removed line, and a split that kept only added lines would answer "no" to a true statement.
 */
export function splitUnifiedDiff(text: string | null | undefined): Map<string, string>;

/** The CLI. Returns the exit code, which `--check` sets to `1` when the recorded figure is not this replay's. */
export function main(
  argv: readonly string[],
  log?: (line: string) => void,
): Promise<number | undefined>;
