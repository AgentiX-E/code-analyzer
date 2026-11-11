// @code-analyzer/shared — glob matching for the two include/exclude lists a configuration carries
//
// **One matcher, because there were two and they disagreed.** The file discoverer in `@code-analyzer/infra` grew a
// `minimatch` of its own for `excludePatterns` and `includePatterns`, and the pipeline's own directory walk grew a
// third spell of the same idea in `gitignoreGlobToRegex`. The three were kept "in step" by nothing at all, and the
// disagreement was not academic: `**/*.kt` compiled to `^.*/[^/]*\.kt$`, which does not match `build.kt` at the root
// of a checkout - so the single pattern a user is most likely to type for "only Kotlin" silently dropped the files
// nearest the top.
//
// **What the syntax means, stated once.**
//   - `*` matches within one path segment; `**` crosses separators.
//   - `**/` matches **zero or more** leading directories, which is what makes `**/*.kt` include `a.kt`.
//   - `?` is one character inside a segment.
//   - A trailing `/` makes the pattern about a directory's contents (`build/` is `build/**`).
//   - A pattern is tested against the whole repository-relative path **and** against the bare basename, so `*.kt`
//     finds `src/main/A.kt` - the reading every tool that takes this kind of list gives it.
//
// **Negation is not part of this language.** `!pattern` is a literal in an include list; the exclude list in the
// discoverer has its own rule for it (`!` re-includes, last match wins), and merging the two languages is how a
// pattern list stops being predictable.
//
// **An empty list includes everything**, which is the only default that keeps a caller who never thought about
// `includePatterns` measuring the same repository as before it existed.

/** Compiled patterns, keyed by their source. **A path is tested against every pattern of every file walked.** */
const compiled = new Map<string, RegExp>();

/** How many compiled patterns to keep before the cache is dropped wholesale. */
const CACHE_LIMIT = 1_024;

/**
 * The regular expression body for one glob, with a double star, a single star and a question mark translated in a
 * single left-to-right pass. **A trailing slash is the caller's business** (`globToRegExp` appends the double star), so
 * this function never has to think about directory patterns.
 */
function globBody(glob: string): string {
  let body = '';
  let index = 0;
  while (index < glob.length) {
    const char = glob[index]!;
    if (char === '*') {
      if (glob[index + 1] === '*') {
        // `**/` is zero or more directories; a bare `**` is any run of characters, separators included.
        if (glob[index + 2] === '/') {
          body += '(?:[^/]+/)*';
          index += 3;
        } else {
          body += '.*';
          index += 2;
        }
      } else {
        body += '[^/]*';
        index += 1;
      }
      continue;
    }
    if (char === '?') {
      body += '[^/]';
      index += 1;
      continue;
    }
    body += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    index += 1;
  }
  return body;
}

/**
 * The body of the regular expression for one glob, without the anchors.
 *
 * **A caller that matches a glob *anywhere* in a path needs this, and there are two of them**: an exclude list in the
 * editor's file watcher and a path filter in search both ask "does this path contain the shape", not "is this path the
 * shape". Both used to answer the question by replacing `.` with `\\.` and every `*` with `[^/]*` - which leaves `+`,
 * `(`, `[`, `$` and `|` in the pattern doing regex work. **`v1.2` matched `v1x2` and `a(b` threw.** A translation that is
 * shared is a translation that can be checked once; the anchors are the caller's decision.
 */
export function globToRegExpBody(pattern: string): string {
  return globBody(pattern.endsWith('/') ? `${pattern}**` : pattern);
}

/** The compiled form of one glob. **Exported for the tests that pin the translation rather than a match.** */
export function globToRegExp(pattern: string): RegExp {
  const cached = compiled.get(pattern);
  if (cached !== undefined) return cached;
  // A trailing `/` names a directory, and a directory's contents are what a pattern list is about.
  const source = pattern.endsWith('/') ? `${pattern}**` : pattern;
  const regex = new RegExp(`^${globBody(source)}$`);
  if (compiled.size >= CACHE_LIMIT) compiled.clear();
  compiled.set(pattern, regex);
  return regex;
}

/** The basename of a repository-relative POSIX path, **without importing `node:path` for one split**. */
function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * Whether a repository-relative path is admitted by an include list.
 *
 * **Empty means everything**, and every pattern is tried against the full path and the basename.
 */
export function matchesIncludePattern(relativePath: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return true;
  // **The path arrives with whatever separator the caller had**, and a matcher that only understood `/` would make the
  // answer depend on the operating system the analysis ran on.
  const path = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const name = baseName(path);
  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (trimmed.length === 0) continue;
    const regex = globToRegExp(trimmed);
    if (regex.test(path) || regex.test(name)) return true;
  }
  return false;
}
