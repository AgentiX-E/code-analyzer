// @code-analyzer — the lane a finding came from, as a type the harness can read

import type { ReviewLane } from '@code-analyzer/shared';

/** One lane's result, as much of it as the flattening reads. */
export interface LaneResult {
  readonly lane?: ReviewLane | string | null;
  readonly filePath: string;
  readonly success?: boolean;
  readonly findings?: ReadonlyArray<Record<string, unknown>>;
}

/** A finding with the path its line numbers belong to, and the lane that produced it. */
export interface LocatedFinding {
  readonly finding: Record<string, unknown> & { lane?: ReviewLane | string | null };
  readonly path: string;
}

/**
 * **Each finding, attributed to the lane that produced it.** A finding that already names a lane keeps it, and a lane
 * that failed contributes nothing.
 */
export function locateLaneFindings(
  lanes: readonly LaneResult[] | null | undefined,
): LocatedFinding[];
