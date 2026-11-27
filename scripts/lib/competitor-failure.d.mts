// **Declarations for the failure classifier, because a test that imports a `.mjs` without them compiles against `any`.**
//
// The return is a union of three literals rather than a string: a case that asserted `'unreachable'` against a function
// returning `any` would pass for a function that returned nothing at all.

/** A failure the account caused, one the corpus caused, and one the tool caused. */
export type CompetitorFailure = 'credit' | 'unreachable' | 'ran';

export declare const CREDIT_REASON: string;

export declare function classifyCompetitorFailure(message: unknown): CompetitorFailure;

export declare function failureReason(kind: CompetitorFailure, raw: unknown): string;
