// The parts of the cross-repository measurement that two corpora share.
//
// **The verbatim corpus and the paraphrase corpus ask the same question about the same symbols**, so they must look the
// same code at the same symbols in the same order - otherwise a difference between the two figures would be a difference
// between two checkouts rather than between two ways of asking. Everything up to "here are the questions" is therefore
// one module: the four pinned checkouts, the index over them, the symbol selection, and the rank arithmetic.
//
// **What is not here is how a question is worded.** A verbatim question is the first sentence of the symbol's own doc
// comment; a paraphrase is a model's rewrite of it. That is the one thing the two scripts do differently, and it is the
// variable each one exists to measure.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createQueryEmbedder,
  defaultEmbedderLoader,
  generateEmbeddings,
} from '../../packages/analyzer/src/index.js';
import { InMemoryGraphStore } from '../../packages/infra/src/index.js';
import { CrossRepoIndexer, RepoGroupManager } from '../../packages/intelligence/src/index.js';
import {
  foundWithin,
  reciprocalRank,
  type RankList,
} from '../../packages/intelligence/src/search/paired-stats.js';

import type {
  EmbeddingBackendName,
  EmbeddingTextOptions,
  NamedEmbedder,
} from '../../packages/analyzer/src/index.js';

/** Where the questions are answered from. **Ten, and stated once**, because a hit beyond it is a hit a reader cannot see. */
export const CUT = 10;

/** One repository of the corpus, pinned to a commit rather than to a branch. */
export interface CorpusRepository {
  id: string;
  sha: string;
  language: string;
  role: string;
}

export interface Corpus {
  repositories: CorpusRepository[];
}

/** One question, and the symbol that answers it. */
export interface Question {
  key: string;
  repo: string;
  symbol: string;
  filePath: string;
  label: string;
  text: string;
  /** Does the question's own text spell the symbol's name? If so it is a name lookup, not a description lookup. */
  namesItsAnswer: boolean;
  /** How many of the corpus' repositories define a symbol with this name. */
  sameNameElsewhere: number;
}

/** What a run measured, and over how much. */
export interface Score {
  n: number;
  found: number;
  r1: number;
  mrr: number;
}

export function readCorpus(path = 'benchmarks/multirepo-qa-corpus.json'): Corpus {
  return JSON.parse(readFileSync(path, 'utf8')) as Corpus;
}

/** `owner/name` → `name`, which is what the tar layout strips to and what a caller types as a filter. */
export function repoName(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

/**
 * Download and unpack one pinned commit, once. **The commit is the pin**: a branch would make two runs two corpora.
 *
 * **The cache is keyed by the commit, not by the directory's existence.** It used to be `existsSync(marker)`, which
 * answers "a checkout was unpacked here once" - so changing a pin in the corpus file left the previous commit's files in
 * place and the next run measured a corpus that no longer matched the one the artifact names. The marker is read and
 * compared instead, and a mismatch unpacks over the top.
 *
 * A caller may pass a cache that is shared between concurrent jobs on one machine; the unpack is therefore done into a
 * directory named after the commit and moved into place, so two runs of two different pins cannot interleave inside one
 * tree.
 */
export function materialise(repo: CorpusRepository, cache: string): string {
  const name = repoName(repo.id);
  const dir = join(cache, name);
  const marker = join(dir, '.complete');

  if (cachedCommit(marker) === repo.sha) return dir;

  mkdirSync(cache, { recursive: true });
  const tarball = join(cache, `${name}-${repo.sha}.tar.gz`);
  execFileSync('curl', [
    '-sSL',
    '--max-time',
    '300',
    '-o',
    tarball,
    `https://codeload.github.com/${repo.id}/tar.gz/${repo.sha}`,
  ]);

  // **Unpack beside the target and rename into place.** A half-written tree under the final name would be read as a
  // complete checkout by the next caller, and `rename` is the one step that cannot be observed half-done.
  const staging = `${dir}.${repo.sha}.unpacking`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', staging, '--strip-components=1']);
  writeFileSync(join(staging, '.complete'), repo.sha, 'utf8');

  rmSync(dir, { recursive: true, force: true });
  renameSync(staging, dir);
  return dir;
}

/** The commit a cache directory was unpacked from, or `null` when there is no readable marker. */
function cachedCommit(marker: string): string | null {
  try {
    return readFileSync(marker, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * The doc comment as a question: markers stripped, tags dropped, whitespace collapsed, first sentence kept.
 *
 * **Tags are dropped because they are not prose.** `@param {string} name The name` is three tokens of syntax and one of
 * English, and a question made of it would measure the index's tolerance for punctuation.
 */
export function toQuestion(doc: string): string | null {
  const prose = doc
    .replace(/\/\*\*?|\*\//g, ' ')
    .replace(/^\s*(\*|\/\/\/?)\s?/gm, ' ')
    .replace(/@[a-zA-Z]+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (prose.length < 20) return null;
  const sentence = prose.match(/^(.{20,240}?[.!?])(\s|$)/);
  const text = (sentence ? sentence[1]! : prose.slice(0, 200)).trim();
  return text.length >= 20 ? text : null;
}

/** The rank of the intended answer in a result list, or `null` when it is not there. */
export function rankOf(
  results: ReadonlyArray<{ repo: string; symbol: string; filePath: string }>,
  question: Pick<Question, 'repo' | 'symbol' | 'filePath'>,
): number | null {
  for (let index = 0; index < results.length; index++) {
    const hit = results[index]!;
    if (hit.repo !== question.repo || hit.symbol !== question.symbol) continue;
    const a = hit.filePath.replace(/\\/g, '/');
    const b = question.filePath.replace(/\\/g, '/');
    // **The file is part of the answer**, because a symbol name that exists in two files of one repository is two
    // different functions, and returning the wrong one is not finding the answer.
    if (a === b || a.endsWith(b) || b.endsWith(a)) return index + 1;
  }
  return null;
}

/** Found@10, recall@1 and MRR@10 over one column. **The arithmetic the published tables use.** */
export function score(ranks: RankList): Score {
  const found = ranks.filter((rank) => foundWithin(rank, CUT)).length;
  const r1 = ranks.filter((rank) => foundWithin(rank, 1)).length;
  const mrr = ranks.reduce<number>((sum, rank) => sum + reciprocalRank(rank, CUT), 0);
  return {
    n: ranks.length,
    found,
    r1: Number((r1 / ranks.length).toFixed(4)),
    mrr: Number((mrr / ranks.length).toFixed(4)),
  };
}

/**
 * **The rows that count, when the quota is a promise about scored rows rather than about questions asked.**
 *
 * A rejected rewrite is a question that was never scored, so a sample of sixty-seven questions per repository can
 * produce fifty-nine scored rows for the repository whose rewrites were rejected twice - which is what the first
 * six-repository run did, and what its own gate refused. **The band was not the defect and widening it would have been
 * the cover-up**: the quota belongs to the accepted set.
 *
 * This takes the rows that were accepted, computes the same water-filled share over *them*, and keeps an evenly spread
 * subset of each repository. Nothing is invented, nothing is asked twice, and the trim only decides which of the rows
 * that were already generated and already measured are counted.
 */
export function trimToQuota<T>(rows: readonly T[], of: (row: T) => string, target: number): T[] {
  if (target >= rows.length) return [...rows];

  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const name = of(row);
    const group = groups.get(name);
    if (group === undefined) groups.set(name, [row]);
    else group.push(row);
  }

  const quota = allocateQuota(
    new Map([...groups.entries()].map(([name, group]) => [name, group.length])),
    target,
  );

  const kept = new Set<T>();
  for (const [name, group] of groups) {
    const take = Math.min(quota.get(name) ?? 0, group.length);
    for (let at = 0; at < take; at++) kept.add(group[Math.floor((at * group.length) / take)]!);
  }
  // **In the order they arrived**, because the per-question columns are zipped against the row order and a reordered
  // trim would silently misalign every later answer with the previous question.
  return rows.filter((row) => kept.has(row));
}

/**
 * The same arithmetic, per group of questions. **The aggregate is the whole and these are the parts**, and the reason
 * they exist is that "four repositories" was a claim in a corpus file that no number in the artifact could contradict.
 *
 * **A group the key function cannot name is called `unknown` rather than dropped**: a dropped row is a smaller
 * denominator reported under the same heading, and the case that produces one - a pin added to the corpus and not to the
 * language map - is exactly the case worth seeing.
 *
 * **A column whose length is not the question count throws**, because every rank column here is one off-by-one away from
 * aligning every question after the missing row with the previous answer, and the figure that produces looks like a
 * result.
 */
export function scoreBy(
  questions: readonly Question[],
  ranks: RankList,
  of: (question: Question) => string,
): Record<string, Score> {
  if (ranks.length !== questions.length) {
    throw new Error(
      `a column of length ${ranks.length} cannot describe ${questions.length} questions: the rows are misaligned`,
    );
  }

  const groups = new Map<string, Array<number | null>>();
  questions.forEach((question, at) => {
    const name = of(question) || 'unknown';
    const group = groups.get(name);
    if (group === undefined) groups.set(name, [ranks[at] ?? null]);
    else group.push(ranks[at] ?? null);
  });
  return Object.fromEntries([...groups.entries()].map(([name, group]) => [name, score(group)]));
}

/** What indexing four repositories produced, in the terms the artifact reports. */
export interface Workspace {
  store: InMemoryGraphStore;
  manager: RepoGroupManager;
  index: {
    reposIndexed: number;
    totalNodes: number;
    totalEdges: number;
    crossRepoEdges: number;
    errors: string[];
  };
  indexMs: number;
}

/** Materialise every repository and index them as one group. **The group is what makes it cross-repository.** */
export async function buildWorkspace(corpus: Corpus, cache: string): Promise<Workspace> {
  mkdirSync(cache, { recursive: true });

  const store = new InMemoryGraphStore();
  const manager = new RepoGroupManager();
  // **The count is read from the corpus rather than written down**, because "four" was true when it was typed
  // and stayed in the group's description after the corpus grew.
  manager.createGroup(
    'multirepo-qa',
    'multirepo-qa',
    `${corpus.repositories.length} released repositories`,
  );

  for (const repo of corpus.repositories) {
    const owner = repo.id.slice(0, repo.id.indexOf('/'));
    const dir = materialise(repo, cache);
    manager.addRepo('multirepo-qa', owner, repoName(repo.id), '', dir);
  }

  const indexer = new CrossRepoIndexer(store, manager);
  const indexStarted = Date.now();
  const index = (await indexer.indexGroup('multirepo-qa', {
    concurrency: 4,
  })) as Workspace['index'];
  return { store, manager, index, indexMs: Date.now() - indexStarted };
}

/**
 * Every symbol a question could be asked about, in a **stable** order.
 *
 * The sample is the first of every *k*, so an order that depended on insertion order would make two runs two corpora.
 * `project:qualifiedName` is the order, and it is the same order the published artifact was sampled in.
 */
export function deriveQuestions(store: InMemoryGraphStore): Question[] {
  const nodes = store.getAllNodes();
  const symbolLabels = new Set(['Function', 'Method', 'Class']);

  const nameToRepos = new Map<string, Set<string>>();
  for (const node of nodes) {
    if (!symbolLabels.has(node.label) || !node.projectId) continue;
    const set = nameToRepos.get(node.name) ?? new Set<string>();
    set.add(node.projectId);
    nameToRepos.set(node.name, set);
  }

  const candidates = nodes
    .filter(
      (node) =>
        symbolLabels.has(node.label) &&
        typeof node.docstring === 'string' &&
        node.docstring.length > 30 &&
        typeof node.projectId === 'string' &&
        node.projectId !== '',
    )
    .sort((a, b) =>
      `${a.projectId}:${a.qualifiedName}`.localeCompare(`${b.projectId}:${b.qualifiedName}`),
    );

  const questions: Question[] = [];
  for (const node of candidates) {
    const text = toQuestion(node.docstring!);
    if (text === null) continue;
    questions.push({
      key: `${node.projectId}#${node.qualifiedName}`,
      repo: node.projectId,
      symbol: node.name,
      filePath: node.filePath ?? '',
      label: node.label,
      text,
      namesItsAnswer: text.toLowerCase().includes(node.name.toLowerCase()),
      sameNameElsewhere: (nameToRepos.get(node.name) ?? new Set([node.projectId])).size,
    });
  }
  return questions;
}

/**
 * **How many rows each group keeps, when the total is `target` and a group cannot fill its share.**
 *
 * The rule is water filling: every group is offered `floor(remaining / still-in-play)` and a group with fewer rows than
 * that keeps all of them and leaves its surplus to the others. It is one function because it is one rule - the sample
 * and the trim are the same arithmetic applied to two different pools (the questions a repository has, and the
 * questions that survived a rejected rewrite), and two copies of it would be two definitions of "equal share".
 *
 * **Sorted by name**, because a share that depended on the order an index happened to return groups in would make two
 * runs two corpora, and the groups here are repositories.
 */
function allocateQuota(sizes: ReadonlyMap<string, number>, target: number): Map<string, number> {
  const names = [...sizes.keys()].sort();
  const quota = new Map<string, number>();
  let remaining = Math.max(0, target);
  let active = names.length;

  let changed = true;
  while (changed && active > 0) {
    changed = false;
    for (const name of names) {
      if (quota.has(name)) continue;
      const share = Math.floor(remaining / active);
      const size = sizes.get(name)!;
      if (size <= share) {
        quota.set(name, size);
        remaining -= size;
        active -= 1;
        changed = true;
      }
    }
  }

  const open = names.filter((name) => !quota.has(name));
  const share = open.length === 0 ? 0 : Math.floor(remaining / open.length);
  const leftover = open.length === 0 ? 0 : remaining - share * open.length;
  open.forEach((name, at) => {
    // The remainder is one row each, in name order: which groups take it is fixed by the sort rather than by anything
    // about the group.
    quota.set(name, share + (at < leftover ? 1 : 0));
  });
  return quota;
}

/**
 * The sampled question set, **and the rule written down**: every repository contributes an equal number of questions.
 *
 * Four hundred because that is a denominator an effect of three questions can be stated against, and because every
 * question is a paid call in the paraphrase generation rather than a free one.
 *
 * **A quota rather than a stride, because a stride lets documentation length decide the denominator.** The sample used
 * to be the first of every *k* over the whole pool, so a repository that documents itself thoroughly contributed more
 * questions than one that does not - and on the published corpus that was `google/gson` at 332 of 494, which makes a
 * per-repository figure a description of the sample rather than of the repository, and makes "four repositories" one
 * repository and three guests. **The quota is the smallest rule that makes the word "four" mean four**, and it costs
 * nothing: the same number of questions is asked either way.
 *
 * Within a repository the questions are still spread evenly by position rather than taken from the front, because the
 * pool is sorted by symbol name and a prefix of a sorted list is an alphabet rather than a sample.
 *
 * **A repository smaller than its share gives what it has and the remainder is redistributed**, since the alternative
 * is a sample that silently shrinks while the artifact's own denominator stays the same.
 */
export function sampleQuestions(questions: Question[], target = 400): Question[] {
  if (target <= 0) return [];

  const pools = new Map<string, Question[]>();
  for (const question of questions) {
    const pool = pools.get(question.repo);
    if (pool === undefined) pools.set(question.repo, [question]);
    else pool.push(question);
  }

  const quota = allocateQuota(
    new Map([...pools.entries()].map(([repo, pool]) => [repo, pool.length])),
    target,
  );

  const sample: Question[] = [];
  for (const repo of [...pools.keys()].sort()) {
    const pool = pools.get(repo)!;
    const take = Math.min(quota.get(repo) ?? 0, pool.length);
    for (let at = 0; at < take; at++) {
      // `floor(at * length / take)` spreads `take` questions over the whole pool rather than over its first `take`.
      sample.push(pool[Math.floor((at * pool.length) / take)]!);
    }
  }
  return sample;
}

/**
 * Vectors for the indexed declarations, and the query embedder that lives in the same space.
 *
 * **This is the half of the measurement the cross-repository corpus never had.** Both scripts measured the lexical
 * channel alone, so `0.8010` on four hundred and forty-seven rewritten questions was a *floor* - the questions that
 * share no word with their answer's name or doc comment cannot be reached by any lexical channel, and this repository
 * had no figure for whether a vector channel reaches them.
 *
 * **The two sides are built together on purpose.** A cosine between an index embedded by one model and a query embedded
 * by another is a comparison between two unrelated spaces, and this project has already published one figure (0.638
 * against a 1.000 lexical baseline) that was exactly that defect. `createQueryEmbedder` refuses to hand back a query
 * embedder for a space the index does not hold, so the failure is a `null` here rather than a number later.
 *
 * **The cost is the index, not the questions.** One vector per declaration is `nodes` calls however many questions are
 * asked, and the queries are cached by text: a question asked of four repositories open and then of one is one
 * embedding, not two. The whole run is ~13k short embeddings, which is a fractions-of-a-cent operation and the reason
 * this could be measured at all.
 */
export interface SemanticChannel {
  /** The space the index's vectors live in. `deterministic` means no model ran and no semantic claim can be made. */
  index: EmbeddingBackendName;
  /** The space the questions are embedded into. Always equal to `index`, or this channel does not exist. */
  query: EmbeddingBackendName;
  model: string | null;
  reason: string | null;
  /** Declarations a vector was produced for. */
  vectors: number;
  embedMs: number;
  lookup: (nodeId: number) => Float32Array | null;
  embed: (text: string) => Promise<Float32Array>;
}

export async function embedWorkspace(
  workspace: Workspace,
  options: {
    /** The model's name as the vendor spells it, or `null` when no model ran. Recorded, never inferred. */
    model?: string | null;
    loader?: () => Promise<NamedEmbedder | null>;
    textOptions?: EmbeddingTextOptions;
  } = {},
): Promise<SemanticChannel | null> {
  const nodes = new Map(workspace.store.getAllNodes().map((node) => [node.id, node]));

  const started = Date.now();
  const { results, backend, reason } = await generateEmbeddings(
    nodes,
    options.loader ?? defaultEmbedderLoader,
    options.textOptions ?? {},
  );

  const byNode = new Map<number, Float32Array>();
  for (const result of results) byNode.set(result.nodeId, Float32Array.from(result.embedding));

  const queryEmbedder = await createQueryEmbedder(
    backend,
    // **The same loader on both sides**, which is what makes the two spaces the same space rather than two spaces that
    // happen to agree on the model's name.
    options.loader ?? defaultEmbedderLoader,
  );
  if (queryEmbedder === null) return null;

  const cache = new Map<string, Float32Array>();
  const embed = async (text: string): Promise<Float32Array> => {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    const vector = await queryEmbedder.embed(text);
    cache.set(text, vector);
    return vector;
  };

  return {
    index: backend,
    query: queryEmbedder.backend,
    model: options.model ?? null,
    reason: reason ?? null,
    vectors: byNode.size,
    embedMs: Date.now() - started,
    lookup: (nodeId) => byNode.get(nodeId) ?? null,
    embed,
  };
}
