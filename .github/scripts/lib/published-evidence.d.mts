/**
 * **The declaration for `published-evidence.mjs`**, so the evidence channel has a shape a compiler can refuse.
 *
 * The defect this file exists for is a field name: the harness read `finding.existingCode` off an `LLMFinding`, which
 * declares `snippet`. A declaration that names the fields is the cheapest place to stop that happening twice.
 */

/** What one published row carries as evidence, and the name of what filled it. */
export interface PublishedEvidence {
  readonly existingCode: string;
  /** `snippet` when the finding carried a quotation, `none` otherwise - **and the two are different facts**. */
  readonly existingCodeFrom: 'snippet' | 'none';
}

/** The finding a row is built from, in as much of its shape as this reader touches. */
export type QuotationSource = Readonly<Record<string, unknown>> | null | undefined;

export function quotationOf(finding: QuotationSource): PublishedEvidence;

/** Counts published beside the rows, so a run that loses every quotation says so in its own artifact. */
export function evidenceSummary(
  rows: readonly Readonly<Record<string, unknown>>[] | null | undefined,
): {
  readonly version: string;
  readonly field: string;
  readonly rows: number;
  readonly quoted: number;
  readonly none: number;
  readonly note: string;
};

export const EVIDENCE_VERSION: string;
export const QUOTATION_FIELD: string;
