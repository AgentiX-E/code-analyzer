// @code-analyzer/benchmarks — the harvest covers the corpus it claims, and the digest is the proof
//
// **What this file guards.** `benchmarks/martian/changed-lines.json` is an *input*: `bench:symbol-adjacency` reads every
// golden's symbol set out of it, so a record that had drifted from the corpus would move §169's numbers without moving
// anything a reader could see. The digest is the one field that makes the drift detectable, and it is checked here rather
// than trusted:
//
//   - **the digest is the corpus's bytes**, so extending `positive_samples.json` without re-running `bench:changed-lines`
//     fails this test instead of silently pricing the prize on the old names;
//   - **every pull request in the corpus is in the record**, and there is no failure list pretending to be coverage;
//   - **every name is a name**: identifier-shaped, not a keyword, sorted, unique - the four properties the extractor
//     promises and the instrument's arithmetic assumes.
//
// **Why this is a test and not a comment.** The record is 200 KB of one string array per pull request; a reader cannot
// review it, and a diff of it is unreadable by construction. Its contract has to be executable or it is not a contract.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { KEYWORDS } from '../../../scripts/lib/code-names.mjs';

const CORPUS = 'benchmarks/martian/positive_samples.json';
const HARVEST = 'benchmarks/martian/changed-lines.json';

const corpusBytes = readFileSync(CORPUS);
const corpus = JSON.parse(corpusBytes.toString('utf8')) as { githubPrUrl?: string }[];
const harvest = JSON.parse(readFileSync(HARVEST, 'utf8')) as {
  version: string;
  corpus: string;
  corpusDigest: string;
  rule: Record<string, string>;
  summary: { pullRequests: number; harvested: number; failed: number; names: number };
  pulls: Record<string, { files: number; added: number; names: string[] }>;
  failures: { pullRequest: string; reason: string }[];
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{3,}$/u;

describe('the changed-line harvest', () => {
  it('is the corpus it says it is, by digest', () => {
    const digest = `sha256-${createHash('sha256').update(corpusBytes).digest('hex')}`;
    expect(harvest.corpus).toBe(CORPUS);
    // **The one line that fails when the corpus moves without the harvest.** Nothing else in this file would notice.
    expect(harvest.corpusDigest).toBe(digest);
  });

  it('covers every pull request in the corpus, and does not count a failure as coverage', () => {
    const inCorpus = [...new Set(corpus.map((row) => String(row.githubPrUrl ?? '')))].filter(
      (url) => url !== '',
    );
    expect(harvest.version).toBe('changed-lines-v1');
    expect(harvest.failures).toEqual([]);
    expect(Object.keys(harvest.pulls).sort()).toEqual([...inCorpus].sort());
    expect(harvest.summary).toMatchObject({
      pullRequests: inCorpus.length,
      harvested: inCorpus.length,
      failed: 0,
    });
  });

  it('summarises the names it holds, rather than a number nobody recomputed', () => {
    const names = Object.values(harvest.pulls).reduce(
      (total, pull) => total + pull.names.length,
      0,
    );
    expect(harvest.summary.names).toBe(names);
    for (const pull of Object.values(harvest.pulls)) {
      // A pull request with no files is a request that was not answered; the harvest refuses those, and this says so.
      expect(pull.files).toBeGreaterThan(0);
      expect(pull.names.length).toBeGreaterThan(0);
    }
  });

  it('holds names and not words: identifier-shaped, unkeyworded, sorted and unique', () => {
    for (const [pullRequest, pull] of Object.entries(harvest.pulls)) {
      for (const name of pull.names) {
        // The failure message names the pull request, because a 200 KB record gives a reader nothing to grep.
        expect(IDENTIFIER.test(name), `${pullRequest}: ${name}`).toBe(true);
        expect(KEYWORDS.has(name), `${pullRequest}: ${name}`).toBe(false);
      }
      expect(pull.names, pullRequest).toEqual([...pull.names].sort());
      expect(new Set(pull.names).size, pullRequest).toBe(pull.names.length);
    }
  });

  it('states the rule it was taken under, so a reader can disagree with it', () => {
    expect(harvest.rule).toMatchObject({
      lines: 'the added (+) side of each pull request’s own diff',
      comments: 'stripped before identifiers are read, because a comment is not code',
      keywords: 'excluded, because a keyword is not a name',
    });
  });
});
