/**
 * **The diff the answer key was written on, rather than the diff the pull request has today.**
 *
 * **The defect this exists for.** A golden names a path and a line, and the arm is handed a diff. The corpus names a
 * `source_commit` and a `target_commit` on every one of its rows - the pair the competitor's harness is invoked
 * `--from source --to target` with - **and the harness has never used them for the diff**: it asks the pull request
 * resource for its `.diff`, which is the pull request *as it stands today*. A force-push, a rebase or a squashed
 * re-upload replaces that text, and the answer key does not move with it.
 *
 * **Measured on the fifty-pull-request slice of `Alibaba-Aone/aacr-bench` (`§175`).** `41` of `452` goldens stand on a
 * path that today's pull-request diff does not contain at all - `FreeCAD#20825`'s `Library.cpp`,
 * `CherryHQ/cherry-studio#5540`'s `DataSettings.tsx` - and `scripts/corpus-reach.mjs` prices that partition. Both arms
 * were scored against the answer key, so the ranking between them does not move; **what moves is whether the run can be
 * replayed**, and a benchmark whose input is a live pull request is a benchmark whose figure expires without saying so.
 *
 * **The comparison request, and why the corpus's pair is the authority.** `GET /repos/{owner}/{repo}/compare/{base}...{head}`
 * answers with the diff between exactly those two commits, in the same unified format the pull-request endpoint serves.
 * **The base is the corpus's `source_commit` and not the pull request's current base**: a pull request retargeted since
 * the corpus was written has a base the goldens were never written against, and reading the current one would reproduce
 * the drift this file exists to remove.
 *
 * **A pin that fails is a fallback with a name.** A compare of a range the API refuses (too many commits, a commit that
 * no longer exists on the remote) leaves the live diff as the only text available, and **the caller is told which one it
 * received** rather than being left to infer it from a figure - the same rule `§173.1` applied to a denominator.
 */

/** A git commit reference the corpus may carry: seven to forty hexadecimal characters and nothing else. */
const COMMIT = /^[0-9a-f]{7,40}$/i;

/**
 * **The commit pair a corpus row names, or `null` when it names none.**
 *
 * `null` is a fact and not a failure: the Martian corpus carries no commits, which is why the competitor arm has always
 * read them off the pull request resource there. **Two equal commits are also `null`** - a compare of a commit with
 * itself has no diff, and a run that treated it as a pin would report an empty change as a pinned one.
 */
export function commitsOf(row) {
  const base = String(row?.source_commit ?? '').trim();
  const head = String(row?.target_commit ?? '').trim();
  if (!COMMIT.test(base) || !COMMIT.test(head) || base === head) return null;
  return { base, head };
}

/** `owner`, `repo` and the pull request number out of a pull request URL, or `null` when the URL is not one. */
export function pullParts(url) {
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url ?? ''));
  return match === null ? null : { owner: match[1], repo: match[2], number: match[3] };
}

/** The comparison endpoint, pinned at both ends. */
export function compareDiffUrl({ owner, repo, base, head }) {
  return `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`;
}

/**
 * **The diff between the corpus's two commits, or a refusal with its reason.**
 *
 * Four attempts for the transient failures and none for the terminal ones, which is the rule the harness's own fetch
 * holds: a `500` with budget left is a request that failed, and a `404` is a range that will answer the same way four
 * times. **The status is returned beside the reason** so a caller can say which failure it fell back from.
 */
export async function fetchPinnedDiff({ url, commits, token = '', fetchImpl = fetch }) {
  const parts = pullParts(url);
  if (parts === null)
    return { ok: false, reason: `"${String(url ?? '')}" is not a pull request URL` };
  if (commits === null)
    return { ok: false, reason: 'the corpus row names no commit pair to pin the diff to' };
  const target = compareDiffUrl({ ...parts, ...commits });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetchImpl(target, {
        headers: {
          accept: 'application/vnd.github.v3.diff',
          'user-agent': 'agentix-e-pinned-diff',
          ...(token ? { authorization: `token ${token}` } : {}),
        },
      });
      if (res.ok) return { ok: true, diff: await res.text(), pinned: true };
      if (res.status === 404) {
        return { ok: false, status: 404, reason: `the compare request returned 404 for ${target}` };
      }
      if (res.status !== 429 && res.status < 500) {
        return {
          ok: false,
          status: res.status,
          reason: `the compare request returned ${String(res.status)}`,
        };
      }
    } catch (error) {
      if (attempt === 3) {
        return {
          ok: false,
          reason: `the compare request threw: ${String(error?.message ?? error)}`,
        };
      }
    }
    await new Promise((done) => setTimeout(done, 500 * (attempt + 1)));
  }
  return { ok: false, reason: 'the compare request did not succeed in four attempts' };
}
