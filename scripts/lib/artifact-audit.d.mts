// Types for `scripts/lib/artifact-audit.mjs`, which is plain JavaScript because the workflow runs it with bare `node`.
//
// **The artifact is `unknown` on the way in and every reading is optional**, because the caller's whole purpose is to
// read files produced by a job that may have written any of it: a typed artifact would be a promise the audit is not in
// a position to make, and the checks exist precisely because a published shape can be wrong.

/** One consistency check, and what it saw. */
export interface AuditFinding {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Audit {
  ok: boolean;
  findings: AuditFinding[];
}

export interface BothMissedSummary {
  total: number;
  corpus: { pullRequests: number; goldens: number; withoutAttribution?: number } | null;
  byOurBucket: Array<{ name: string; count: number }>;
  byDirectory: Array<{ name: string; count: number }>;
  byPullRequest: Array<{ name: string; count: number }>;
}

export declare function auditArtifact(artifact: unknown): Audit;

export declare function formatAudit(audit: Audit): string;

export declare function summariseBothMissed(artifact: unknown): BothMissedSummary;

export declare function formatBothMissed(summary: BothMissedSummary): string;
