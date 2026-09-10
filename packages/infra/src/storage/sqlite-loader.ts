// @code-analyzer/infra — Optional better-sqlite3 Loader

/**
 * Constructor of the `better-sqlite3` `Database` class (the module's CJS export).
 */
export type BetterSqlite3Ctor = typeof import('better-sqlite3');

/**
 * Resolves the `better-sqlite3` module. Injectable so that the
 * missing-dependency path can be exercised without uninstalling the package.
 */
export type Sqlite3Loader = () => BetterSqlite3Ctor;

/**
 * Default loader — resolves the optional `better-sqlite3` dependency installed
 * under `packages/infra`. Node caches module resolution, so calling this more
 * than once is cheap.
 */
export const loadDefaultBetterSqlite3: Sqlite3Loader = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('better-sqlite3') as BetterSqlite3Ctor;

/**
 * Load `better-sqlite3`, returning `null` when the optional dependency is not
 * installed instead of propagating the resolution error.
 *
 * `better-sqlite3` is declared in `optionalDependencies`, so a valid install may
 * legitimately omit it; callers are expected to surface a clear, actionable
 * error rather than a bare `MODULE_NOT_FOUND`.
 *
 * @param load - Resolver to use, defaulting to `loadDefaultBetterSqlite3`.
 * @returns The `better-sqlite3` constructor, or `null` if it is unavailable.
 */
export function loadBetterSqlite3(
  load: Sqlite3Loader = loadDefaultBetterSqlite3,
): BetterSqlite3Ctor | null {
  try {
    return load();
  } catch {
    return null;
  }
}
