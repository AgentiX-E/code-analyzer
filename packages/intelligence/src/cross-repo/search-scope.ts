// @code-analyzer/intelligence — repository selectors, resolved against project ids.
//
// **The defect this module exists to remove**: `FederatedSearchEngine.search` compared `repoFilter` entries to
// `node.projectId` with `Set.has`, and every test that exercised the filter built its nodes with a projectId equal to
// the repository *name* (`repo-a`). The group indexer builds them as `owner/name` (`pallets/flask`), because that is
// what `RepoGroupManager.addRepo(owner, name)` produces. So on a real workspace the filter matched nothing:
//
//   measured on four released repositories, 469 questions answerable by name, asked **within the repository that holds
//   the answer**: `repoFilter: ['flask']` returned 0 results while the same question across all four returned the
//   answer. The unit tests could not see it, because a fixture is a checkout whose projectIds the author chose.
//
// The fix is not "also try the name part" - it is a named function for *what a selector means*, so that the answer to
// "did my filter name a repository that exists?" is a value the caller can read rather than an empty list.

/**
 * Does `selector` name the repository whose project id is `projectId`?
 *
 * Three shapes are accepted, because all three are written by callers who mean the same repository:
 *
 *   `owner/name`   the project id itself, which is what `RepoGroupManager` registers
 *   `name`         the repository's own name, which is what a user types and what the old tests used
 *   `OWNER/NAME`   the same, in any case - GitHub resolves repository names case-insensitively, and a filter that is
 *                  strict about case would be the second way to silently select nothing
 */
export function repoSelectorMatches(selector: string, projectId: string): boolean {
  const wanted = selector.trim();
  if (wanted === '') return false;

  const project = projectId.trim();
  if (project === '') return false;

  if (project === wanted) return true;
  if (project.toLowerCase() === wanted.toLowerCase()) return true;

  const namePart = project.slice(project.lastIndexOf('/') + 1);
  if (namePart === wanted) return true;
  return namePart.toLowerCase() === wanted.toLowerCase();
}

/** The repositories a set of selectors names, and the selectors that named none of the candidates offered. */
export interface RepoScope {
  /** Project ids selected. Empty means "no selector was given", which is not the same as "nothing matched". */
  selected: Set<string>;
  /** Selectors that matched none of the candidate project ids they were resolved against. */
  unmatched: string[];
}

/**
 * Resolve `selectors` against the project ids the store actually returned.
 *
 * **`unmatched` is the difference between an empty answer and a wrong filter**, and it is reported only when there
 * were candidates to match against: a query that found nothing at all cannot say which selector was at fault, and
 * claiming one was would be the same silent guess in the other direction.
 */
export function resolveRepoScope(
  selectors: readonly string[],
  candidateProjectIds: Iterable<string>,
): RepoScope {
  const candidates = [...candidateProjectIds];
  const selected = new Set<string>();
  const matched = new Set<number>();

  for (const projectId of candidates) {
    for (let i = 0; i < selectors.length; i++) {
      if (repoSelectorMatches(selectors[i]!, projectId)) {
        selected.add(projectId);
        matched.add(i);
      }
    }
  }

  const unmatched: string[] = [];
  if (candidates.length > 0) {
    for (let i = 0; i < selectors.length; i++) {
      if (!matched.has(i)) unmatched.push(selectors[i]!);
    }
  }

  return { selected, unmatched };
}
