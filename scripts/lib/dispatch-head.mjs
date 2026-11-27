/**
 * **A dispatch names the trunk it means, and the run is read only when its head is the commit under test.**
 *
 * **The defect this exists for, which happened.** The instrument `§175` built - the diff read at the commits the corpus
 * names - was committed to `master` and pushed. The next dispatch was issued against `main`, a branch that had stopped
 * receiving at the same content level but under a different lineage of rebuilt commit identifiers, **and the run
 * started on a tree that did not contain the file at all** (`scripts/lib/pinned-diff.mjs` answered 404 at that ref).
 * Nothing in the run said so: a workflow dispatch is a request against a ref, the ref is a name, and **a name that is
 * not the default branch is a name that can be arbitrarily old**.
 *
 * **Two refusals, because there are two ways to buy the wrong tree.** The first is the ref: a dispatch that names a
 * branch other than the repository's default is asking for a tree nobody is maintaining, and the request is refused
 * before it is sent. The second is the tree: the branch's own tip has to hold the instrument whose figure the run is
 * supposed to produce - a path that answers 404 at that commit is an arm that will run without its repair.
 *
 * **And the check does not trust the dispatch.** A workflow dispatch answers `204 No Content` and no run identifier, so
 * the only way to know which commit a run started on is to read the run back. **A run whose `head_sha` is not the tip
 * that was dispatched is a run about a different tree**: it is cancelled rather than read, because a figure from it
 * would be a figure from a document nobody named - the same defect class as `§175`'s, one level up.
 */

/** A git commit reference: seven to forty hexadecimal characters and nothing else. */
const HEX = /^[0-9a-f]{7,40}$/i;

/**
 * **Whether the branch this dispatch names is the trunk it was told the repair is on.**
 *
 * `null` for either side is a refusal rather than a pass: a repository whose default branch could not be read is a
 * repository whose trunk is unknown, and an unknown trunk is not a licence to guess one.
 */
export function refusalForRef({ ref, defaultBranch }) {
  if (typeof defaultBranch !== 'string' || defaultBranch.trim() === '') {
    return {
      ok: false,
      reason: 'the repository did not report a default branch, so no ref can be checked',
    };
  }
  const wanted = String(ref ?? '').trim();
  if (wanted === '')
    return { ok: false, reason: 'no ref was named and no default branch was substituted' };
  if (wanted !== defaultBranch.trim()) {
    return {
      ok: false,
      reason: `ref "${wanted}" is not the default branch ("${defaultBranch.trim()}"), and a branch that is not the trunk is a tree nobody is maintaining`,
    };
  }
  return { ok: true, ref: wanted };
}

/**
 * **Whether the tip of that trunk holds the instrument the run is supposed to measure with.**
 *
 * The status is the API's own: `200` is present, `404` is a tree that does not have the file. Anything else - a rate
 * limit, a 5xx - is a tree this check could not read, and **a check that cannot read is never a pass**: it is the
 * `§175.5` rule about a fourth state, applied to a precondition instead of a corpus.
 */
export function refusalForPath({ path, commit, status }) {
  const name = String(path ?? '').trim();
  if (name === '')
    return { ok: false, reason: 'no path was named for the tree to be checked against' };
  if (status === 200) return { ok: true, path: name, commit };
  if (status === 404) {
    return {
      ok: false,
      reason: `"${name}" is not in ${HEX.test(String(commit ?? '')) ? String(commit).slice(0, 8) : String(commit)} - the run would measure a tree that does not carry it`,
    };
  }
  return {
    ok: false,
    reason: `"${name}" could not be checked at ${String(commit)} (status ${String(status)}), and an unchecked tree is not a passing one`,
  };
}

/** The second a dispatch started at, floored - GitHub reports `created_at` to the second, so a millisecond compare would miss a run. */
export function floorToSecond(at) {
  const ms = typeof at === 'number' ? at : Date.parse(String(at));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) * 1000 : NaN;
}

/**
 * **Which of the runs the workflow now reports is the one this dispatch bought.**
 *
 * Two things are decided here and they are different decisions. **A run on another head is a stray** - it is named so
 * the caller can cancel it instead of reading it, because cancelling is the only way to stop paying for a figure about
 * the wrong tree. **A run on the right head but older than the dispatch is not this dispatch's run**: the workflow list
 * is returned newest first and a reader that took the first row would attribute yesterday's figure to today's request.
 *
 * `run` is the earliest matching run, because a dispatch buys one run and a second one on the same head is either a
 * manual re-dispatch or a retry - neither of them this request.
 */
export function pickDispatchRun({ runs, tip, startedAt }) {
  const wanted = String(tip ?? '').trim();
  if (!HEX.test(wanted))
    return { ok: false, reason: `the dispatched tip "${String(tip)}" is not a commit` };
  const since = floorToSecond(startedAt);
  if (!Number.isFinite(since))
    return { ok: false, reason: 'the dispatch start time could not be read' };
  const fresh = (Array.isArray(runs) ? runs : []).filter((run) => {
    const at = floorToSecond(run?.created_at);
    return Number.isFinite(at) && at >= since;
  });
  const strays = fresh.filter((run) => String(run?.head_sha ?? '') !== wanted);
  const matching = fresh
    .filter((run) => String(run?.head_sha ?? '') === wanted)
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  if (matching.length === 0) {
    return {
      ok: false,
      reason: `no run on ${wanted.slice(0, 8)} has appeared since ${new Date(since).toISOString()}`,
      strays,
    };
  }
  return { ok: true, run: matching[0], others: matching.slice(1), strays };
}
