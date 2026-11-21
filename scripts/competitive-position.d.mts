// **The declarations this generator needs in order to be testable at its refusals.**
//
// `scripts/competitive-position.mjs` is a dependency-free script whose output is a committed artefact, and the two
// predicates that refuse a figure were exported so that a test could ask them about a fixture instead of about the
// repository's own JSON. **That makes the shape of a row part of the contract**, so it is declared here rather than
// inferred from an `any`: a row whose `scope` was renamed would otherwise keep type-checking and stop being checked.

/** The row set a row was scored on. Both integers, because a scope written as prose cannot be compared. */
export interface RowScope {
  readonly pullRequests: number;
  readonly goldens: number;
}

/** The fields the two predicates read. A row may carry more; these are the ones a refusal depends on. */
export interface ScopedRow {
  readonly tool?: string;
  readonly scope?: RowScope;
}

/** A figure as the predicates see it: its identity, its rows, and the reason it mixes row sets if it does. */
export interface ScopedFigure {
  readonly id: string;
  readonly rows: readonly ScopedRow[];
  readonly mixedScope?: string;
}

/**
 * A row's scope as `"14 pr / 196 goldens"`, or `null` when the row declares none.
 *
 * @throws when a scope exists but is not two integers, because nothing can compare it.
 */
export declare function scopeOf(row: ScopedRow): string | null;

/**
 * The reason a figure has to print, or `null` when every row is on one row set.
 *
 * @throws when the figure mixes row sets without a reason, scopes only some of its rows, or carries a reason while its
 * rows agree.
 */
export declare function mixedScopeOf(figure: ScopedFigure): string | null;
