// @code-analyzer/intelligence — the repository a question names
//
// **A workspace is not a corpus.** Four checkouts in one group are one graph and four vocabularies, and the vocabulary
// of one can be the ordinary language of another: the acceptance suite on flask, werkzeug, express and
// spring-petclinic asks "where does an express application mount middleware", and werkzeug is a library whose every
// module is named after a kind of middleware. Measured on that workspace, the node that answers the question -
// express's `lib/application.js:use`, whose own comment says "add middleware to the app router" - ranked **22nd**
// lexically, so it was not in the twelve-block context at all; the two express nodes that did appear were a file node
// and the router's `route`. **No ranking function can be asked to know that "middleware" was meant as a thing the
// application does rather than as the name of another repository's package**, and no scorer was changed to try: the
// word that disambiguates the question is already in it, and it is the repository's own name.
//
// **So a question that names a repository is answered about that repository.** This is what a person means by "how
// does express mount middleware", it is what every code-search product does with `repo:`, and it is the only scope
// signal the product can read without guessing: a name it already has, matched against the question it was given.

import { tokenize } from '../search/hybrid-search.js';

/**
 * Names that are ordinary words, and therefore do not scope anything.
 *
 * **A repository called `app` is not a mention, it is the word "app"** - and a workspace of microservices called
 * `api`, `core`, `web` and `worker` would have every question silently decided by whichever of those words happened to
 * appear in it. The list is the vocabulary of repository names rather than of English: a name on it is skipped, and a
 * question that names only such repositories falls back to the whole workspace, which is the safe direction to fail.
 */
export const GENERIC_REPOSITORY_NAMES: ReadonlySet<string> = new Set([
  'admin',
  'agent',
  'agents',
  'android',
  'api',
  'apis',
  'app',
  'apps',
  'assets',
  'auth',
  'backend',
  'base',
  'blog',
  'build',
  'cli',
  'client',
  'cloud',
  'common',
  'config',
  'core',
  'data',
  'demo',
  'docs',
  'engine',
  'example',
  'examples',
  'frontend',
  'gateway',
  'go',
  'infra',
  'ios',
  'java',
  'kit',
  'lib',
  'libs',
  'main',
  'mobile',
  'model',
  'models',
  'node',
  'proxy',
  'public',
  'python',
  'rust',
  'sdk',
  'server',
  'service',
  'services',
  'shared',
  'site',
  'src',
  'static',
  'test',
  'tests',
  'tool',
  'tools',
  'ui',
  'utils',
  'web',
  'worker',
  'workers',
]);

/** The name of a project, which is the part after the owner. **A bare id with no owner is its own name.** */
export function projectName(projectId: string): string {
  const cut = projectId.lastIndexOf('/');
  return cut < 0 ? projectId : projectId.slice(cut + 1);
}

/**
 * Suffixes that name a language or a file format rather than the thing.
 *
 * **`micro-kinetic-ts` is about kinetics, not about TypeScript**, and `my-app.js` is about an app. A name whose head
 * word is on this list is read through to the word before it, which is what a person means when they say the name.
 */
export const LANGUAGE_SUFFIXES: ReadonlySet<string> = new Set([
  'c',
  'cpp',
  'cs',
  'go',
  'js',
  'json',
  'kt',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'ts',
  'yml',
]);

/**
 * The word of a name that decides whether it is distinctive.
 *
 * **The head word, because it is the noun** - unless the head is a language suffix, in which case the noun is the word
 * before it: `micro-kinetic-ts` is distinctive because `kinetic` is, and `my-app.js` is not because `app` is not.
 */
export function headWord(name: string): string {
  const words = tokenize(name);
  if (words.length === 0) return '';
  const last = words[words.length - 1]!;
  if (LANGUAGE_SUFFIXES.has(last) && words.length > 1) return words[words.length - 2]!;
  return last;
}

/**
 * Whether a name is distinctive enough to scope a question with.
 *
 * **The head word decides, because it is the noun**: `my-app` and `payments-api` are generic, `spring-petclinic` and
 * `express` are not. A name shorter than three characters is refused as well - it is a token that will appear inside
 * other words' identifiers, and a scope chosen by accident is worse than no scope.
 */
export function isDistinctiveName(name: string): boolean {
  const head = headWord(name);
  if (head.length < 3) return false;
  return !GENERIC_REPOSITORY_NAMES.has(head);
}

/** Where `needle` appears as a contiguous run of whole words in `haystack`, or `-1`. */
export function indexOfWords(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  const last = haystack.length - needle.length;
  for (let start = 0; start <= last; start += 1) {
    let offset = 0;
    while (offset < needle.length && haystack[start + offset] === needle[offset]) offset += 1;
    if (offset === needle.length) return start;
  }
  return -1;
}

/** One project named by a question, and the words that named it. */
export interface NamedProject {
  projectId: string;
  name: string;
}

/**
 * Every project the question names, in the order they were given.
 *
 * **Matching is on whole tokens, so `express` does not match `expressive`**, and a hyphenated name matches whether the
 * question writes it hyphenated or spaced - both are the same two tokens after tokenization.
 */
export function namedProjects(question: string, projectIds: readonly string[]): NamedProject[] {
  const words = tokenize(question);
  if (words.length === 0) return [];

  const found: NamedProject[] = [];
  const seen = new Set<string>();
  for (const projectId of projectIds) {
    const name = projectName(projectId);
    if (!isDistinctiveName(name)) continue;
    if (indexOfWords(words, tokenize(name)) < 0) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    found.push({ projectId, name });
  }
  return found;
}

/**
 * The one project the question names, or `null`.
 *
 * **Two names is not a scope, it is a comparison** - "how does flask's session differ from werkzeug's" has to reach
 * both repositories, and picking the first would answer half of it. Ambiguity therefore resolves to the whole
 * workspace, and the caller is told which project was chosen, if any, in the result.
 */
export function resolveScope(question: string, projectIds: readonly string[]): NamedProject | null {
  const named = namedProjects(question, projectIds);
  return named.length === 1 ? named[0]! : null;
}
