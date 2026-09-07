// @code-analyzer/intelligence — GitHub PR Webhook Handler Tests

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { GitHubPRWebhook } from '../review/github-webhook.js';
import { PRReviewEngine, type PRReviewResult, type PRReviewSummary } from '../review/pr-review.js';
import { CodeReviewEngine } from '../review/review-engine.js';
import type { GitHubPREvent, InlineComment, PRFile } from '../review/github-webhook.js';
import type { ReviewComment } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStore(): InMemoryGraphStore {
  return new InMemoryGraphStore();
}

function makeEngine(): { store: InMemoryGraphStore; prEngine: PRReviewEngine } {
  const store = makeStore();
  const reviewEngine = new CodeReviewEngine(store, { allowMetadataFallback: true });
  const prEngine = new PRReviewEngine(reviewEngine, store);
  return { store, prEngine };
}

function makeHandler(secret?: string): {
  handler: GitHubPRWebhook;
  store: InMemoryGraphStore;
  prEngine: PRReviewEngine;
} {
  const { store, prEngine } = makeEngine();
  const handler = new GitHubPRWebhook('token', prEngine, secret);
  return { handler, store, prEngine };
}

function makePREvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
  return {
    action: 'opened',
    pull_request: {
      number: 1,
      title: 'Test PR',
      body: null,
      head: { sha: 'abc123', ref: 'feature/test' },
      base: { sha: 'def456', ref: 'main', repo: { full_name: 'test/repo' } },
    },
    repository: { full_name: 'test/repo' },
    ...overrides,
  };
}

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    path: 'src/a.ts',
    content: 'Prefer const over let',
    suggestionCode: 'const x = 1;',
    existingCode: 'let x = 1;',
    startLine: 10,
    endLine: 10,
    category: 'style',
    severity: 'low',
    filtered: false,
    id: 'c1',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSummary(overrides: Partial<PRReviewSummary> = {}): PRReviewSummary {
  return {
    totalComments: 1,
    byCategory: {
      bug: 0,
      security: 0,
      performance: 0,
      maintainability: 0,
      test: 0,
      style: 1,
      documentation: 0,
      architecture: 0,
      api: 0,
      other: 0,
    },
    bySeverity: { critical: 0, high: 0, medium: 0, low: 1, info: 0 },
    riskLevel: 'low',
    mergeRecommendation: 'request-changes',
    ...overrides,
  };
}

function makeResult(overrides: Partial<PRReviewResult> = {}): PRReviewResult {
  return {
    sessionId: 'sess-1',
    comments: [makeComment()],
    standardsResults: [],
    impactResult: {
      changedFiles: [],
      changedSymbols: [],
      impactTree: [],
      riskLevel: 'low',
      processesAffected: [],
      estimatedEffort: 'low',
    },
    summary: makeSummary(),
    ...overrides,
  };
}

/** Stub global `fetch` to resolve a single response. */
function mockFetchOnce(response: Response): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

/** Spy on the private `delay` method so retry paths resolve instantly. */
function spyDelay(handler: GitHubPRWebhook): void {
  vi.spyOn(
    handler as unknown as { delay: (ms: number) => Promise<void> },
    'delay',
  ).mockResolvedValue(undefined);
}

function rateLimitResponse(resetInSeconds = 3600): Response {
  return new Response('', {
    status: 200,
    headers: {
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + resetInSeconds),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Signature Verification
// ---------------------------------------------------------------------------

describe('GitHubPRWebhook — signature verification', () => {
  it('accepts a valid HMAC-SHA256 signature', () => {
    const { handler } = makeHandler('secret');
    const payload = JSON.stringify({ a: 1 });
    const signature = `sha256=${createHmac('sha256', 'secret').update(payload).digest('hex')}`;
    expect(handler.verifySignature(payload, signature)).toBe(true);
  });

  it('rejects a signature computed with a different secret', () => {
    const { handler } = makeHandler('secret');
    const payload = JSON.stringify({ a: 1 });
    const signature = `sha256=${createHmac('sha256', 'wrong').update(payload).digest('hex')}`;
    expect(handler.verifySignature(payload, signature)).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const { handler } = makeHandler('secret');
    const original = JSON.stringify({ a: 'original' });
    const signature = `sha256=${createHmac('sha256', 'secret').update(original).digest('hex')}`;
    expect(handler.verifySignature(JSON.stringify({ a: 'tampered' }), signature)).toBe(false);
  });

  it('accepts everything when no secret is configured', () => {
    const { handler } = makeHandler();
    expect(handler.verifySignature('anything', 'sha256=invalid')).toBe(true);
  });

  it('rejects a malformed signature whose buffer length differs', () => {
    const { handler } = makeHandler('secret');
    const payload = JSON.stringify({ a: 1 });
    // A short signature makes timingSafeEqual throw (different buffer lengths).
    expect(handler.verifySignature(payload, 'sha256=short')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Event Handling
// ---------------------------------------------------------------------------

describe('GitHubPRWebhook — event handling', () => {
  it('skips unsupported event types', async () => {
    const { handler } = makeHandler();
    const result = await handler.handlePullRequestEvent('push', makePREvent());
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('Unsupported event');
  });

  it('skips closed PR actions', async () => {
    const { handler } = makeHandler();
    const result = await handler.handlePullRequestEvent(
      'pull_request',
      makePREvent({ action: 'closed' }),
    );
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('Skipping action');
  });

  it('returns an error for an invalid repository full_name', async () => {
    const { handler } = makeHandler();
    const result = await handler.handlePullRequestEvent(
      'pull_request',
      makePREvent({ repository: { full_name: '' } }),
    );
    expect(result.status).toBe('error');
    expect(result.message).toBe('Invalid repository full_name');
  });

  it('processes a PR and submits a REQUEST_CHANGES review for a block recommendation', async () => {
    const { handler, prEngine } = makeHandler();
    mockFetchOnce(new Response('', { status: 200 }));
    vi.spyOn(prEngine, 'reviewPR').mockResolvedValue(
      makeResult({
        comments: [
          makeComment(),
          makeComment({ id: 'c2', path: 'src/b.ts', suggestionCode: undefined }),
        ],
        summary: makeSummary({ mergeRecommendation: 'block' }),
      }),
    );
    const submitSpy = vi.spyOn(handler, 'submitReview').mockResolvedValue(undefined);

    const result = await handler.handlePullRequestEvent('pull_request', makePREvent());

    expect(result.status).toBe('processed');
    expect(result.commentsCount).toBe(2);
    expect(result.sessionId).toBe('sess-1');
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy.mock.calls[0]![5]).toBe('REQUEST_CHANGES');
  });

  it('submits an APPROVE review for an approve recommendation', async () => {
    const { handler, prEngine } = makeHandler();
    mockFetchOnce(new Response('', { status: 200 }));
    vi.spyOn(prEngine, 'reviewPR').mockResolvedValue(
      makeResult({ summary: makeSummary({ mergeRecommendation: 'approve' }) }),
    );
    const submitSpy = vi.spyOn(handler, 'submitReview').mockResolvedValue(undefined);

    await handler.handlePullRequestEvent('pull_request', makePREvent());
    expect(submitSpy.mock.calls[0]![5]).toBe('APPROVE');
  });

  it('submits a COMMENT review for a request-changes recommendation', async () => {
    const { handler, prEngine } = makeHandler();
    mockFetchOnce(new Response('', { status: 200 }));
    vi.spyOn(prEngine, 'reviewPR').mockResolvedValue(
      makeResult({ summary: makeSummary({ mergeRecommendation: 'request-changes' }) }),
    );
    const submitSpy = vi.spyOn(handler, 'submitReview').mockResolvedValue(undefined);

    await handler.handlePullRequestEvent('pull_request', makePREvent());
    expect(submitSpy.mock.calls[0]![5]).toBe('COMMENT');
  });

  it('does not submit a review when there are no comments', async () => {
    const { handler, prEngine } = makeHandler();
    mockFetchOnce(new Response('', { status: 200 }));
    vi.spyOn(prEngine, 'reviewPR').mockResolvedValue(makeResult({ comments: [] }));
    const submitSpy = vi.spyOn(handler, 'submitReview').mockResolvedValue(undefined);

    const result = await handler.handlePullRequestEvent('pull_request', makePREvent());
    expect(result.status).toBe('processed');
    expect(result.commentsCount).toBe(0);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('returns an error when the network request fails', async () => {
    const { handler } = makeHandler();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    spyDelay(handler);

    const result = await handler.handlePullRequestEvent('pull_request', makePREvent());
    expect(result.status).toBe('error');
    expect(result.message).toBe('network down');
  });

  it('stringifies a non-Error thrown during review', async () => {
    const { handler, prEngine } = makeHandler();
    mockFetchOnce(new Response('', { status: 200 }));
    vi.spyOn(prEngine, 'reviewPR').mockRejectedValue('plain failure');

    const result = await handler.handlePullRequestEvent('pull_request', makePREvent());
    expect(result.status).toBe('error');
    expect(result.message).toBe('plain failure');
  });
});

// ---------------------------------------------------------------------------
// GitHub API Methods
// ---------------------------------------------------------------------------

describe('GitHubPRWebhook — fetchPRDiff / fetchPRFiles', () => {
  it('fetches a diff with the raw diff media type', async () => {
    const { handler } = makeHandler();
    const fetchSpy = vi.fn().mockResolvedValue(new Response('diff content', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await handler.fetchPRDiff('o', 'r', 7);
    expect(result).toBe('diff content');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/o/r/pulls/7');
    expect((init?.headers as Record<string, string>)['Accept']).toBe(
      'application/vnd.github.v3.diff',
    );
  });

  it('parses a JSON array of PR files', async () => {
    const { handler } = makeHandler();
    mockFetchOnce(
      new Response(
        JSON.stringify([
          { filename: 'a.ts', status: 'modified', additions: 3, deletions: 1, changes: 4 },
        ]),
        { status: 200 },
      ),
    );

    const files: PRFile[] = await handler.fetchPRFiles('o', 'r', 1);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ filename: 'a.ts', additions: 3 });
  });

  it('returns an empty list for malformed JSON', async () => {
    const { handler } = makeHandler();
    mockFetchOnce(new Response('not-json', { status: 200 }));

    const files = await handler.fetchPRFiles('o', 'r', 1);
    expect(files).toEqual([]);
  });

  it('returns an empty list for a non-array JSON payload', async () => {
    const { handler } = makeHandler();
    mockFetchOnce(new Response('{"message":"unexpected"}', { status: 200 }));

    const files = await handler.fetchPRFiles('o', 'r', 1);
    expect(files).toEqual([]);
  });
});

describe('GitHubPRWebhook — postReviewComment / submitReview', () => {
  it('posts a single review comment with the right body', async () => {
    const { handler } = makeHandler();
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);

    await handler.postReviewComment('o', 'r', 1, 'sha', 'body', 'path.ts', 5);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain('/pulls/1/comments');
    expect(JSON.parse((init?.body as string) ?? '{}')).toMatchObject({
      body: 'body',
      commit_id: 'sha',
      path: 'path.ts',
      line: 5,
      side: 'RIGHT',
    });
  });

  it('submits a review with comments and a default RIGHT side', async () => {
    const { handler } = makeHandler();
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const comments: InlineComment[] = [
      { path: 'a.ts', line: 1, body: 'x', side: 'RIGHT' },
      { path: 'b.ts', line: 2, body: 'y' },
    ];
    await handler.submitReview('o', 'r', 1, 'sha', 'summary', 'REQUEST_CHANGES', comments);

    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? '{}');
    expect(body.event).toBe('request_changes');
    expect(body.comments).toHaveLength(2);
    expect(body.comments[1].side).toBe('RIGHT');
  });

  it('omits the comments key when there are no comments', async () => {
    const { handler } = makeHandler();
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await handler.submitReview('o', 'r', 1, 'sha', 'summary', 'COMMENT', []);
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? '{}');
    expect(body.event).toBe('comment');
    expect(body.comments).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// githubRequest retry / rate-limit logic (exercised through fetchPRDiff)
// ---------------------------------------------------------------------------

describe('GitHubPRWebhook — request retry and rate-limit handling', () => {
  it('returns the body on a successful response', async () => {
    const { handler } = makeHandler();
    mockFetchOnce(new Response('ok body', { status: 200 }));
    expect(await handler.fetchPRDiff('o', 'r', 1)).toBe('ok body');
  });

  it('ignores a non-zero rate-limit remaining header', async () => {
    const { handler } = makeHandler();
    mockFetchOnce(new Response('ok', { status: 200, headers: { 'X-RateLimit-Remaining': '5' } }));
    expect(await handler.fetchPRDiff('o', 'r', 1)).toBe('ok');
  });

  it('retries after a rate-limit response and then succeeds', async () => {
    const { handler } = makeHandler();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    spyDelay(handler);

    expect(await handler.fetchPRDiff('o', 'r', 1)).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to a 60s wait when no reset time is provided', async () => {
    const { handler } = makeHandler();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', { status: 200, headers: { 'X-RateLimit-Remaining': '0' } }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    spyDelay(handler);

    expect(await handler.fetchPRDiff('o', 'r', 1)).toBe('ok');
  });

  it('throws a rate-limit error after exhausting all retries', async () => {
    const { handler } = makeHandler();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rateLimitResponse()));
    spyDelay(handler);

    await expect(handler.fetchPRDiff('o', 'r', 1)).rejects.toThrow(/rate limit/i);
  });

  it('retries on a 429 with a Retry-After header', async () => {
    const { handler } = makeHandler();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '5' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    spyDelay(handler);

    expect(await handler.fetchPRDiff('o', 'r', 1)).toBe('ok');
  });

  it('uses exponential backoff on a 429 without Retry-After', async () => {
    const { handler } = makeHandler();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    spyDelay(handler);

    expect(await handler.fetchPRDiff('o', 'r', 1)).toBe('ok');
  });

  it('fails with a generic error when every attempt is rate-limited', async () => {
    const { handler } = makeHandler();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    spyDelay(handler);

    await expect(handler.fetchPRDiff('o', 'r', 1)).rejects.toThrow('GitHub API request failed');
  });

  it('throws a GitHub API error for a non-ok response', async () => {
    const { handler } = makeHandler();
    // A fresh Response per attempt — a Response body can only be consumed once.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('server error', { status: 500 }))),
    );
    spyDelay(handler);

    await expect(handler.fetchPRDiff('o', 'r', 1)).rejects.toThrow(
      'GitHub API error (500): server error',
    );
  });

  it('logs and swallows a failure to read the error body', async () => {
    const { handler } = makeHandler();
    const failingResponse = {
      status: 500,
      ok: false,
      headers: { get: () => null },
      text: () => Promise.reject(new Error('stream error')),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failingResponse));
    spyDelay(handler);

    await expect(handler.fetchPRDiff('o', 'r', 1)).rejects.toThrow('GitHub API error (500): ');
  });

  it('stringifies a non-Error thrown while reading the error body', async () => {
    const { handler } = makeHandler();
    const failingResponse = {
      status: 500,
      ok: false,
      headers: { get: () => null },
      text: () => Promise.reject('plain failure'),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failingResponse));
    spyDelay(handler);

    await expect(handler.fetchPRDiff('o', 'r', 1)).rejects.toThrow('GitHub API error (500): ');
  });

  it('retries on a transient network failure and then succeeds', async () => {
    const { handler } = makeHandler();
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    spyDelay(handler);

    expect(await handler.fetchPRDiff('o', 'r', 1)).toBe('ok');
  });

  it('propagates the last network error after exhausting retries', async () => {
    const { handler } = makeHandler();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    spyDelay(handler);

    await expect(handler.fetchPRDiff('o', 'r', 1)).rejects.toThrow('network down');
  });

  it('wraps a non-Error network rejection into an Error', async () => {
    const { handler } = makeHandler();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('plain failure'));
    spyDelay(handler);

    await expect(handler.fetchPRDiff('o', 'r', 1)).rejects.toThrow('plain failure');
  });
});

// ---------------------------------------------------------------------------
// buildReviewSummaryBody
// ---------------------------------------------------------------------------

describe('GitHubPRWebhook — review summary body', () => {
  const buildSummary = (handler: GitHubPRWebhook, summary: PRReviewSummary): string =>
    (
      handler as unknown as { buildReviewSummaryBody(s: PRReviewSummary): string }
    ).buildReviewSummaryBody(summary);

  it('includes only non-zero severity and category counts', () => {
    const { handler } = makeHandler();
    const body = buildSummary(
      handler,
      makeSummary({
        totalComments: 2,
        riskLevel: 'high',
        mergeRecommendation: 'block',
        bySeverity: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
        byCategory: {
          bug: 1,
          security: 1,
          performance: 0,
          maintainability: 0,
          test: 0,
          style: 0,
          documentation: 0,
          architecture: 0,
          api: 0,
          other: 0,
        },
      }),
    );

    expect(body).toContain('**Risk Level:** high');
    expect(body).toContain('**Recommendation:** block');
    expect(body).toContain('**Total Comments:** 2');
    expect(body).toContain('- critical: 1');
    expect(body).toContain('- high: 1');
    expect(body).not.toContain('- medium: 0');
    expect(body).toContain('- bug: 1');
    expect(body).not.toContain('- style: 0');
  });
});

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

describe('GitHubPRWebhook — delay', () => {
  it('resolves after the configured timeout', async () => {
    const { handler } = makeHandler();
    const delay = (handler as unknown as { delay(ms: number): Promise<void> }).delay.bind(handler);
    await expect(delay(0)).resolves.toBeUndefined();
  });
});
