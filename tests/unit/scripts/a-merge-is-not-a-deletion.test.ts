// **A write to a file somebody else owns is a merge or it is a deletion.**
//
// The Martian harness writes into the field's own `results/benchmark_data.json`, which ships with **every tool's reviews
// for all fifty pull requests**. The first version of the harness wrote that file whole and **destroyed the field** - the
// comparison job downstream then saw one tool and published a table with one row, which looked like a run and measured
// nothing.
//
// **That rule is now load-bearing twice**: the competitor arm writes to the same file under a different tool name, so a
// merge that dropped a shipped row would not merely lose a number, it would lose the arm this iteration exists to add.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mergeCandidates, mergeReviews, pullOf } from '../../../scripts/lib/martian-harness.mjs';
import type { ReviewRows } from '../../../scripts/lib/martian-harness.mjs';

const URL = 'https://github.com/calcom/cal.com/pull/8087';

const shippedFile = (): ReviewRows => ({
  [URL]: {
    pr_title: 'Async import of the appStore packages',
    golden_comments: [{ comment: 'Consider adding try-catch around the await' }],
    reviews: [
      { tool: 'greptile', review_comments: [] },
      { tool: 'cubic', review_comments: [] },
    ],
  },
});

const ourRow = (tool: string, body: string): ReviewRows => ({
  [URL]: {
    reviews: [{ tool, review_comments: [{ path: 'a.ts', line: 1, body }] }],
  },
});

describe('the field’s file survives every arm that writes it', () => {
  it('adds our row and keeps both shipped tools', () => {
    const existing = shippedFile();
    // **The merge mutates the object it is given**, which is what the harness and the competitor arm both pass - the
    // file they read. A version that returned a new object would leave the caller's copy un-updated and the write
    // below it would publish the old file with a green log line.
    const outcome = mergeReviews(existing, ourRow('agentix-e', 'ours'), 'agentix-e');
    const tools = (existing[URL]?.reviews ?? []).map((review) => review.tool);
    expect(tools).toEqual(['greptile', 'cubic', 'agentix-e']);
    expect(outcome.toolsBefore).toBe(2);
    expect(outcome.toolsAfter).toBe(3);
  });

  it('is idempotent, so a rerun does not double the row', () => {
    const existing = shippedFile();
    mergeReviews(existing, ourRow('agentix-e', 'ours'), 'agentix-e');
    const again = mergeReviews(existing, ourRow('agentix-e', 'ours'), 'agentix-e');
    expect(again.toolsAfter).toBe(3);
    expect(
      (existing[URL]?.reviews ?? []).filter((review) => review.tool === 'agentix-e'),
    ).toHaveLength(1);
  });

  it('replaces only the tool it was given, leaving a competitor row beside it', () => {
    const existing = shippedFile();
    mergeReviews(
      existing,
      ourRow('open-code-review-deepseek', 'theirs'),
      'open-code-review-deepseek',
    );
    mergeReviews(existing, ourRow('agentix-e', 'ours'), 'agentix-e');
    const bodies = (existing[URL]?.reviews ?? []).map(
      (review) => review.review_comments?.[0]?.body,
    );
    expect(bodies).toContain('theirs');
    expect(bodies).toContain('ours');
  });

  it('never rewrites the golden comments the file shipped with', () => {
    const existing = shippedFile();
    mergeReviews(existing, ourRow('agentix-e', 'ours'), 'agentix-e');
    expect(existing[URL]?.golden_comments).toHaveLength(1);
  });

  it('merges candidates per tool rather than replacing the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'martian-candidates-'));
    const path = join(dir, 'candidates.json');
    writeFileSync(path, JSON.stringify({ [URL]: { cubic: [{ text: 'a cubic statement' }] } }));
    mergeCandidates(path, { [URL]: [{ text: 'ours' }] }, 'agentix-e');
    mergeCandidates(path, { [URL]: [{ text: 'theirs' }] }, 'open-code-review-deepseek');
    const merged = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      Record<string, unknown[]>
    >;
    expect(Object.keys(merged[URL] ?? {}).sort()).toEqual([
      'agentix-e',
      'cubic',
      'open-code-review-deepseek',
    ]);
  });

  it('reads the pull request a URL names, and refuses one that names none', () => {
    expect(pullOf(URL)).toEqual({ owner: 'calcom', repo: 'cal.com', number: '8087' });
    expect(pullOf('https://github.com/calcom/cal.com/tree/main')).toBeNull();
  });
});
