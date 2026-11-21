// @code-analyzer/scripts — the `plan` job's entry point, and the only place a dispatch input becomes a matrix row
//
// **The mapping is explicit rather than a scan of the environment.** `process.env` holds every secret this job was
// given; a planner that read `INPUT_*` by prefix would turn an unrelated variable into a factor the moment somebody
// renamed one, and the failure mode is a matrix that buys an arm nobody asked for. Each line below is one
// `workflow_dispatch` input, and `a-plan-reads-the-inputs-it-names` asserts the set against the workflow's own
// declaration - a new input that nobody maps here is an input that silently does nothing.
//
// **It writes `matrix=<json>` to stdout and nothing else**, because the caller redirects stdout into `$GITHUB_OUTPUT`.
// A stray `console.log` would be parsed as an output key and fail the step, so the one debug channel this file has is a
// throw.

import { planMatrix } from './aacr-plan-matrix.mjs';

/** The inputs this planner reads, and the workflow variable each one arrives in. */
export const INPUT_VARS = Object.freeze([
  'window',
  'agent',
  'idioms',
  'remarks',
  'pair',
  'ensemble',
  'second_concern',
  'lane_set',
]);

const inputs = Object.fromEntries(
  INPUT_VARS.map((name) => [name, process.env[`INPUT_${name.toUpperCase()}`]]),
);

const rows = planMatrix(inputs);

if (rows.length === 0) {
  // **A plan with no rows is a job with no arms**, and GitHub would skip the matrix job silently - which reads as a
  // cancelled run rather than as a mistake in this file.
  throw new Error(`the planner produced no rows for ${JSON.stringify(inputs)}`);
}

process.stdout.write(`matrix=${JSON.stringify(rows)}\n`);
