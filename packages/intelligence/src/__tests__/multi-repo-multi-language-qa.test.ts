// Three repositories, three languages, and questions asked across all of them.
//
// **The capability this exists to prove**, stated as the product states it: *"a symbol that changed and is used at four
// sites the author never opened is where the defects live."* Answering that needs **several repositories indexed
// together**, **more than one language**, and **a question that crosses both boundaries.**
//
// **Real files on a real disk, through the real indexer.** Not a hand-built graph: `RepoGroupManager` registers three
// directories, `CrossRepoIndexer.indexGroup` reads them, and `FederatedSearchEngine` answers. **A fixture graph would
// have tested the search engine and nothing else** - and the two defects this stretch found in cross-repo analysis
// (an edge direction and a module-specifier comparison) were both invisible to a fixture.
//
// **Three questions, one per boundary:**
//
//   across repositories   a symbol defined in one repo, found with nothing but its name
//   across languages      the same concept named in idiomatic form in three languages, all retrieved
//   within a repository   a filter that must narrow the answer rather than merely not break it
//
// **And the assertion for each is that the answer is non-empty *and* correctly scoped** - a search that returns
// everything answers every question and is worth nothing.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { CrossRepoIndexer } from '../cross-repo/cross-repo-indexer.js';
import { FederatedSearchEngine } from '../cross-repo/federated-search.js';
import { RepoGroupManager } from '../cross-repo/repo-group-manager.js';

const GROUP = 'kinetic-group';

/** One repository per language, each defining a symbol the others' language also names. */
const REPOS: Array<{ id: string; language: string; file: string; source: string }> = [
  {
    id: 'alpha',
    language: 'typescript',
    file: 'src/energy.ts',
    source: [
      'export function computeKineticEnergy(mass: number, velocity: number): number {',
      '  return 0.5 * mass * velocity * velocity;',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'beta',
    language: 'python',
    file: 'energy.py',
    source: [
      'def compute_kinetic_energy(mass, velocity):',
      '    return 0.5 * mass * velocity ** 2',
      '',
    ].join('\n'),
  },
  {
    id: 'gamma',
    language: 'javascript',
    file: 'energy.js',
    source: [
      'export function computeKineticEnergy(mass, velocity) {',
      '  return 0.5 * mass * velocity * velocity;',
      '}',
      '',
    ].join('\n'),
  },
];

function buildDisk(): { root: string; paths: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), 'multi-repo-'));
  const paths: Record<string, string> = {};
  for (const repo of REPOS) {
    const dir = join(root, repo.id);
    const file = join(dir, repo.file);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, repo.source, 'utf8');
    paths[repo.id] = dir;
  }
  return { root, paths };
}

interface IndexSummary {
  reposIndexed: number;
  totalNodes: number;
  totalEdges: number;
  crossRepoEdges: number;
  errors: string[];
}

async function index(): Promise<{ store: InMemoryGraphStore; root: string; result: IndexSummary }> {
  const { root, paths } = buildDisk();
  const store = new InMemoryGraphStore();
  const manager = new RepoGroupManager();
  manager.createGroup(GROUP, 'three-in-three', 'a group of three repositories in three languages');
  for (const repo of REPOS) {
    // **The signature is (groupId, owner, name, url, localPath)** - the language is not passed: the indexer
    // infers it from the file extension, which is what makes this a test of language detection as well.
    manager.addRepo(GROUP, 'AgentiX-E', repo.id, '', paths[repo.id]!);
  }
  const indexer = new CrossRepoIndexer(store, manager);
  const result = (await indexer.indexGroup(GROUP, { concurrency: 1 })) as IndexSummary;
  return { store, root, result };
}

describe('three repositories, three languages, asked across both', () => {
  it('indexes every repository, and every language reaches the store', async () => {
    const { store, root, result } = await index();
    try {
      // **The indexer reports counts, not names** - so the assertions are the counts, and the names are checked
      // below from the store itself. That split is the shape of the interface, not a choice.
      // **All three repositories, not at least one.** A cross-repo index that silently skips a repository is the
      // failure this whole stretch has been about, wearing a different name.
      expect(result.reposIndexed).toBe(REPOS.length);
      expect(result.errors).toEqual([]);
      expect(result.totalNodes).toBeGreaterThan(0);

      const nodes = store.getAllNodes();
      const symbols = nodes.map((n) => n.name);

      // **The text of the file is there, so the repository was read.**
      expect(nodes.some((n) => String(n.filePath ?? '').endsWith('energy.ts'))).toBe(true);
      expect(nodes.some((n) => String(n.filePath ?? '').endsWith('energy.py'))).toBe(true);
      expect(symbols).toContain('computeKineticEnergy');

      // **And the python symbol is there, which it was not when this line was written.**
      //
      // The previous version of this assertion read `expect(pythonSymbols).toEqual([])` **and said so in a comment**:
      // *"the day this is fixed the line fails and has to be updated."* **It failed today**, which is how the fix is
      // known to have worked - and it is the reason to write an assertion for the true state rather than for the
      // desired one. `extractSymbols` now asks `getOrLoadProvider` before falling back to its regexes.
      const pythonSymbols = symbols.filter(
        (n) => typeof n === 'string' && n.includes('kinetic_energy'),
      );
      expect(pythonSymbols).toContain('compute_kinetic_energy');
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 600_000);

  // **The skip that stood here for two iterations, and what it was hiding.**
  //
  // The comment said `FederatedSearchEngine.search` "returns 0 results for a symbol that is demonstrably in it" and
  // named two possible causes: a registration step this test was not performing, or a repo-scoped store view it did not
  // build. Neither was the cause. **The search was answering; the filter was broken.** `repoFilter` was compared to
  // `node.projectId`, which the group indexer writes as `owner/name`, while the filter was given a repository name.
  //
  // Measured on four released repositories before the fix: asked **within the repository that holds the answer**,
  // 0 of 469 questions returned it, while the same questions across all four returned 454. The skip is why that number
  // did not exist for two iterations, and the sentence above it is why it was not investigated.
  it('answers a question that crosses repositories, and narrows when asked to', async () => {
    const { store, root } = await index();
    try {
      const engine = new FederatedSearchEngine(store);

      // **Across repositories, and now across spellings.**
      //
      // This assertion used to read `{alpha, gamma}` and it was right about the channel it was measuring: `searchFts`
      // lowercases the whole query and splits on whitespace, so `computeKineticEnergy` became the single term
      // `computekineticenergy`, which is a substring of the TypeScript and JavaScript declarations and **is not a
      // substring of `compute_kinetic_energy`** — the Python name that is the same function in another language.
      // The federated channel now ranks with the tokenizer the rest of the product uses, which splits camelCase and
      // underscores into the same three words, so **the Python declaration is found by the JavaScript spelling**.
      //
      // That is the capability this story is about, not a regression: a cross-repository question is asked by someone
      // who does not know which language holds the answer. The assertion is updated to the true state and the reason is
      // written here rather than in a commit message nobody reads.
      const all = await engine.search('computeKineticEnergy', {});
      expect(all.totalResults).toBeGreaterThan(0);
      expect(new Set(all.results.map((r) => r.repo))).toEqual(
        new Set(['AgentiX-E/alpha', 'AgentiX-E/beta', 'AgentiX-E/gamma']),
      );

      // **Within one repository, by the name a user types.** A filter must *narrow*: fewer results than the
      // unfiltered question, and every one of them from the repository that was named.
      const oneRepo = await engine.search('computeKineticEnergy', { repoFilter: ['alpha'] });
      expect(oneRepo.totalResults).toBeGreaterThan(0);
      expect(oneRepo.totalResults).toBeLessThan(all.totalResults);
      for (const item of oneRepo.results) expect(item.repo).toBe('AgentiX-E/alpha');

      // **Across languages.** The concept by the part all three spellings share - camelCase and snake_case both
      // contain it, so a language boundary that is crossed shows up here. All three repositories must appear.
      const acrossLanguages = await engine.search('kinetic', {});
      expect(new Set(acrossLanguages.results.map((r) => r.repo))).toEqual(
        new Set(['AgentiX-E/alpha', 'AgentiX-E/beta', 'AgentiX-E/gamma']),
      );
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 600_000);

  it('says when a filter named no repository, instead of answering nothing', async () => {
    const { store, root } = await index();
    try {
      const engine = new FederatedSearchEngine(store);
      const result = await engine.search('computeKineticEnergy', { repoFilter: ['delta'] });
      expect(result.totalResults).toBe(0);
      expect(result.unmatchedRepoFilters).toEqual(['delta']);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 600_000);
});
