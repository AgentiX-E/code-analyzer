// @code-analyzer — the lane a finding came from, kept when the findings are flattened into one list
//
// **Five lanes review one diff and the artifact could not say which of them earned its model calls.** The result of a
// lane call carries `lane`, the finding does not, so flattening `lanes.flatMap((l) => l.findings)` produced a list in
// which **every row's `lane` was null** - 1 109 findings of the discovery run, none attributable. The per-lane table
// this repository would need to retire a lane is a table nobody could build from its own artifacts.
//
// **Why this is a function and not a spread inside the harness.** The flattening is where the attribute is lost, so it
// is where the repair belongs, and a named function is the only version of it a test can call. The harness has one
// caller; the next one will not read the harness to find out how the field is set.
//
// **Two properties are load-bearing.** A finding that already names its lane keeps it - the reading agent stamps
// `'agent'` on its own findings, and an arm that ran both reviewers must not relabel the reader's rows as the five
// lanes'. And a lane that failed contributes nothing, because a lane that produced no findings and a lane that failed
// are the same zero in a figure and different facts about the reviewer.

/**
 * **Each finding with the path its line numbers belong to and the lane that produced it.**
 *
 * `path` comes from the result rather than from the finding for the reason the harness already documents: a lane reviews
 * one file and its line numbers are in that file, so a flattened finding without the result's path cannot be grounded
 * against any diff.
 */
export function locateLaneFindings(lanes) {
  const located = [];
  for (const lane of lanes ?? []) {
    if (!lane || lane.success !== true) continue;
    for (const finding of lane.findings ?? []) {
      // **A finding that names a lane keeps it**, so the reader's own stamps survive a merge with the five lanes.
      const attributed = finding?.lane ? finding : { ...finding, lane: lane.lane ?? null };
      located.push({ finding: attributed, path: lane.filePath });
    }
  }
  return located;
}
