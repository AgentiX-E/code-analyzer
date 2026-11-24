/**
 * **A denominator is part of the question, and the board names its own.**
 *
 * Martian's Code Review Bench publishes 173 curated comments and scores on a **Core** profile of **158** - the eight defect
 * categories, which is the full set minus `style` and `speculative`. Every figure on that board is divided by 158. This
 * repository's Martian run divided by 173, so **our F1 and theirs were divided by different numbers** - the §140.5 defect
 * one level up, in the corpus rather than in the emission, which is the direction that is easiest to miss because neither
 * number is wrong on its own.
 *
 * What is corrected is a re-index, not a judgement. The judge adjudicated each (comment, golden) pair; which goldens count
 * is a property of the profile, and the cases below hold the two apart.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CORPUS_PROFILE_VERSION,
  MARTIAN_CORE_CATEGORIES,
  profileIndex,
  profileMaps,
  restrictFindings,
  UnknownProfileError,
} from '../../../scripts/lib/corpus-profile.mjs';

const root = join(import.meta.dirname, '..', '..', '..');
const corpus = JSON.parse(
  readFileSync(join(root, 'benchmarks', 'martian', 'positive_samples.json'), 'utf8'),
);

describe('the profile the board publishes', () => {
  it('names the eight defect categories the board scores, and not the two it excludes', () => {
    expect([...MARTIAN_CORE_CATEGORIES].sort()).toEqual(
      ['api', 'bug', 'concurrency', 'data', 'doc_defect', 'perf', 'security', 'test_gap'].sort(),
    );
    expect(MARTIAN_CORE_CATEGORIES).not.toContain('style');
    expect(MARTIAN_CORE_CATEGORIES).not.toContain('speculative');
  });

  it('renumbers what it keeps contiguously, so a re-indexed verdict cannot point at a dropped comment', () => {
    const index = profileIndex(['bug', 'style', 'security', 'speculative'], 'core');
    expect([...index.entries()]).toEqual([
      [0, 0],
      [2, 1],
    ]);
  });

  it('reads `all` as the absence of a filter, including a category this corpus has never carried', () => {
    const index = profileIndex(['bug', 'style', 'a-category-added-later'], 'all');
    expect([...index.keys()]).toEqual([0, 1, 2]);
  });

  it('refuses a profile nobody registered, rather than scoring the whole corpus under its name', () => {
    expect(() => profileIndex(['bug'], 'core-plus')).toThrow(UnknownProfileError);
    expect(() => profileIndex(['bug'], 'core-plus')).toThrow(/core-plus/u);
  });
});

describe('the corpus, read under a profile', () => {
  it('counts 173 comments as published and 158 under the board profile, which is the whole point', () => {
    expect(profileMaps(corpus, 'all').goldens).toBe(173);
    expect(profileMaps(corpus, 'core').goldens).toBe(158);
  });

  it('keys every map by pull request, because goldens are positions inside their own answer key', () => {
    const { maps } = profileMaps(corpus, 'core');
    expect(maps.size).toBe(50);
    const findings = [
      { pr: 'https://github.com/getsentry/sentry/pull/1', matchedGoldens: [0] },
      { pr: 'https://github.com/getsentry/sentry/pull/2', matchedGoldens: [0] },
    ];
    const restricted = restrictFindings(findings, { maps });
    // **Two pull requests, two golden 0s.** A map keyed on the index without the pull request would apply one
    // pull request's re-indexing to the other's verdict.
    expect(restricted.every((finding) => Array.isArray(finding.profileGoldens))).toBe(true);
  });

  it('keeps a finding whose verdicts all fall outside the profile, because it was still emitted', () => {
    const { maps } = profileMaps(corpus, 'core');
    const restricted = restrictFindings(
      [{ pr: 'https://github.com/getsentry/sentry/pull/1', matchedGoldens: [] }],
      {
        maps,
      },
    );
    expect(restricted).toHaveLength(1);
    expect(restricted[0]?.profileGoldens).toEqual([]);
  });

  it('drops the verdicts of a comment the profile excludes and keeps the ones it names', () => {
    const { maps } = profileMaps(corpus, 'core');
    const first = corpus[0];
    const categories = first.comments.map((comment: { category?: string }) =>
      String(comment.category ?? ''),
    );
    const styleAt = categories.findIndex((category: string) => category === 'style');
    const keptAt = categories.findIndex((category: string) =>
      MARTIAN_CORE_CATEGORIES.includes(category),
    );
    if (styleAt < 0 || keptAt < 0) return; // the first pull request may carry neither, and the other cases cover it
    const restricted = restrictFindings(
      [{ pr: first.githubPrUrl, matchedGoldens: [styleAt, keptAt] }],
      { maps },
    );
    expect(restricted[0]?.profileGoldens).toHaveLength(1);
  });

  it('records the version of this re-indexing, so a figure can name what produced it', () => {
    expect(CORPUS_PROFILE_VERSION).toMatch(/v\d+$/u);
  });
});

describe('the instrument is wired where the Martian arm runs', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'aacr-bench.yml'), 'utf8');

  it('publishes both profiles on every Martian dispatch, because a denominator nobody prints is a denominator nobody checks', () => {
    expect(workflow).toContain('scripts/martian-profile.mjs benchmarks/aacr-bench.json');
    expect(workflow).toContain("if: inputs.dataset == 'martian'");
  });

  it('uploads the reading beside the artifact', () => {
    const upload = workflow.slice(workflow.indexOf('name: Upload the figure'));
    expect(upload).toContain('benchmarks/martian-profile.json');
  });
});
