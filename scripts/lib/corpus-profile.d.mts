/**
 * **The declaration for `corpus-profile.mjs`.**
 *
 * The module re-indexes verdicts into a named corpus profile, so what a compiler can check is that a profile is a list of
 * categories or the absence of one, and that a re-index is a map from old index to new.
 */

/** The board's Core profile: the eight defect categories Martian scores. */
export const MARTIAN_CORE_CATEGORIES: readonly string[];

/** The registered profiles. `all` is `null`, which means "no filter" rather than "these ten categories". */
export const PROFILES: Readonly<Record<'all' | 'core', readonly string[] | null>>;

export const CORPUS_PROFILE_VERSION: string;

export class UnknownProfileError extends Error {}

/** `Map<oldIndex, newIndex>` for the comments a profile keeps, renumbered contiguously. */
export function profileIndex(
  categories: readonly (string | null | undefined)[],
  profileName: string,
): Map<number, number>;

/** One map per pull request, plus the profile's own golden count. */
export function profileMaps(
  corpus: readonly {
    readonly githubPrUrl?: string | null;
    readonly comments?: readonly { readonly category?: string | null }[];
  }[],
  profileName: string,
): { readonly maps: ReadonlyMap<string, ReadonlyMap<number, number>>; readonly goldens: number };

/**
 * The findings with each verdict re-indexed into the profile.
 *
 * A finding whose verdicts all fall outside the profile keeps an empty list: it was emitted, and a profile is a
 * denominator rather than a cut.
 */
export function restrictFindings<
  T extends { readonly pr?: string | null; readonly matchedGoldens?: readonly number[] },
>(
  findings: readonly T[],
  options: {
    readonly maps: ReadonlyMap<string, ReadonlyMap<number, number>>;
    readonly profileField?: string;
  },
): (T & { readonly profileGoldens: readonly number[] })[];

export {};
