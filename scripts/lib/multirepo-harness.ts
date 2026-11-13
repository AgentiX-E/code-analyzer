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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { InMemoryGraphStore } from '../../packages/infra/src/index.js';
import { CrossRepoIndexer, RepoGroupManager } from '../../packages/intelligence/src/index.js';
import {
  foundWithin,
  reciprocalRank,
  type RankList,
} from '../../packages/intelligence/src/search/paired-stats.js';

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
  /** How many of the four repositories define a symbol with this name. */
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

/** Download and unpack one pinned commit, once. **The commit is the pin**: a branch would make two runs two corpora. */
export function materialise(repo: CorpusRepository, cache: string): string {
  const dir = join(cache, repoName(repo.id));
  const marker = join(dir, '.complete');
  if (existsSync(marker)) return dir;

  mkdirSync(dir, { recursive: true });
  const tarball = join(cache, `${repoName(repo.id)}.tar.gz`);
  execFileSync('curl', [
    '-sSL',
    '--max-time',
    '300',
    '-o',
    tarball,
    `https://codeload.github.com/${repo.id}/tar.gz/${repo.sha}`,
  ]);
  execFileSync('tar', ['-xzf', tarball, '-C', dir, '--strip-components=1']);
  writeFileSync(marker, repo.sha, 'utf8');
  return dir;
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
  manager.createGroup('multirepo-qa', 'multirepo-qa', 'four released repositories');

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
 * The sampled question set, **and the rule written down**: the first of every *k* where *k* makes about four hundred.
 *
 * Four hundred because that is a denominator an effect of three questions can be stated against, and because every
 * question is a paid call in the paraphrase generation rather than a free one.
 */
export function sampleQuestions(questions: Question[], target = 400): Question[] {
  const step = Math.max(1, Math.floor(questions.length / target));
  return questions.filter((_, position) => position % step === 0);
}
