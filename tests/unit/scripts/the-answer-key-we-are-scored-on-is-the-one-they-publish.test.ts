import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROFILES, martianRows, profileCount } from '../../../scripts/build-martian-corpus.mjs';

const CORPUS = join(process.cwd(), 'benchmarks', 'martian');
const RAW = join(CORPUS, 'golden_comments');

function rawFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(RAW)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    files.set(name, readFileSync(join(RAW, name), 'utf8'));
  }
  return files;
}

/**
 * **The number we are about to compare ourselves with is produced by someone else's answer key, so the key has to be
 * theirs and not ours.**
 *
 * Martian's Code Review Bench publishes 50 pull requests, 173 golden comments and three scoring profiles with stated
 * counts (139 / 158 / 173). This repository now carries a converted copy of that key so a run is a checkout rather than
 * a fetch - **and a converted copy is exactly the kind of artefact that drifts**: a category renamed in the converter, a
 * row dropped by a filter, a `[].join` that quietly eats the last element, and the figure that comes out is still a
 * number between 0 and 1 with a corpus name next to it.
 *
 * **These tests are the two ends: the raw files are upstream's and unmodified, and the derived file is a pure function
 * of them.** The profile counts are the third check, and it is the strong one - **they are upstream's published
 * arithmetic, reproduced by our conversion**, so a defect in the mapping would have to cancel out to three exact counts
 * to survive it.
 */
describe('the answer key we are scored on is the one they publish', () => {
  it('carries fifty pull requests and a unique URL for each', () => {
    const rows = martianRows(rawFiles());
    expect(rows).toHaveLength(50);
    const urls = rows.map((row) => row.githubPrUrl);
    expect(new Set(urls).size).toBe(50);
    // **And every one of them is a pull request rather than a repository**, because the harness fetches a diff by URL
    // and a bare repo would make it fetch a file listing.
    for (const url of urls)
      expect(url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/u);
  });

  it('reproduces the three profile counts upstream publishes', () => {
    const rows = martianRows(rawFiles());
    expect(profileCount(rows, 'strict')).toBe(139);
    expect(profileCount(rows, 'core')).toBe(158);
    expect(profileCount(rows, 'all')).toBe(173);
    // **The profiles are nested**, which is the property that makes a profile a cut of one corpus rather than three
    // corpora: `strict ⊆ core ⊆ all`, and a count that broke the containment would be a category listed in the wrong
    // set.
    const core = PROFILES.core ?? [];
    for (const category of PROFILES.strict ?? []) expect(core).toContain(category);
    // **And the two categories `Core` drops are exactly the ones it is documented to drop**, so a profile that grew a
    // category cannot look like a corpus that lost goldens.
    expect(core).not.toContain('style');
    expect(core).not.toContain('speculative');
  });

  it('gives every golden a sentence, because an empty one can never be matched', () => {
    const rows = martianRows(rawFiles());
    const comments = rows.flatMap((row) => row.comments);
    expect(comments).toHaveLength(173);
    // **The ten categories upstream uses, and no others.** A category none of the three profiles names would be a
    // golden every profile silently ignores - a denominator error that looks like a data error.
    const known = new Set([...(PROFILES.core ?? []), 'style', 'speculative']);
    for (const comment of comments) {
      expect(comment.note.trim().length).toBeGreaterThan(10);
      expect(known.has(comment.category), comment.category).toBe(true);
    }
  });

  it('keeps the coordinates absent rather than zero, so attribution can say it does not know', () => {
    const rows = martianRows(rawFiles());
    for (const comment of rows.flatMap((row) => row.comments)) {
      expect(comment.path).toBeNull();
      expect(comment.from_line).toBeNull();
    }
  });

  it('is exactly what the builder produces from the committed raw files', () => {
    const rows = martianRows(rawFiles());
    expect(`${JSON.stringify(rows, null, 2)}\n`).toBe(
      readFileSync(join(CORPUS, 'positive_samples.json'), 'utf8'),
    );
  });
});
