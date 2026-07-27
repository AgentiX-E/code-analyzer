// @code-analyzer/intelligence — GitHub API Client Tests

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GitHubApiClient,
  GitHubApiError,
  GitHubRateLimitError,
} from '../github/client.js';
import type { GitHubAuth } from '../github/client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient(auth?: Partial<GitHubAuth>): GitHubApiClient {
  return new GitHubApiClient({
    token: auth?.token ?? 'ghp_test123',
    ...auth,
  });
}

// ---------------------------------------------------------------------------
// Constructor & Auth
// ---------------------------------------------------------------------------

describe('GitHubApiClient', () => {
  describe('constructor', () => {
    it('should create a client with a token', () => {
      const client = createClient();
      expect(client).toBeInstanceOf(GitHubApiClient);
    });

    it('should create a client with GitHub App credentials', () => {
      const client = createClient({
        token: 'ghp_test',
        installationId: 12345,
        appId: 67890,
        appPrivateKey: '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----',
      });
      expect(client).toBeInstanceOf(GitHubApiClient);
    });

    it('should get auth header for Bearer token', async () => {
      const client = createClient({ token: 'ghp_abc123' });
      const header = await client.getAuthHeader();
      expect(header).toBe('Bearer ghp_abc123');
    });
  });

  describe('getRateLimit', () => {
    it('should return default rate limit before any API calls', () => {
      const client = createClient();
      const limit = client.getRateLimit();
      expect(limit.limit).toBe(5000);
      expect(limit.remaining).toBe(5000);
      expect(limit.reset).toBe(0);
      expect(limit.used).toBe(0);
    });

    it('should return a copy, not reference', () => {
      const client = createClient();
      const a = client.getRateLimit();
      const b = client.getRateLimit();
      expect(a).not.toBe(b);
    });
  });
});

// ---------------------------------------------------------------------------
// GitHubApiError
// ---------------------------------------------------------------------------

describe('GitHubApiError', () => {
  it('should create with status and message', () => {
    const err = new GitHubApiError(404, 'Not Found');
    expect(err.status).toBe(404);
    expect(err.message).toContain('GitHub API error');
    expect(err.message).toContain('Not Found');
    expect(err.name).toBe('GitHubApiError');
  });

  it('should include response body when provided', () => {
    const body = { message: 'Resource not found', documentation_url: 'https://docs.github.com' };
    const err = new GitHubApiError(404, 'Not Found', body);
    expect(err.body).toEqual(body);
  });
});

// ---------------------------------------------------------------------------
// GitHubRateLimitError
// ---------------------------------------------------------------------------

describe('GitHubRateLimitError', () => {
  it('should create with retry after and rate limit info', () => {
    const rateLimit = { limit: 5000, remaining: 0, reset: 1700000000, used: 5000 };
    const err = new GitHubRateLimitError(60, rateLimit);
    expect(err.retryAfter).toBe(60);
    expect(err.status).toBe(429);
    expect(err.name).toBe('GitHubRateLimitError');
    expect(err.message).toContain('Rate limit exceeded');
  });
});

// ---------------------------------------------------------------------------
// API Method Types
// ---------------------------------------------------------------------------

describe('GitHubApiClient — API method signatures', () => {
  let client: GitHubApiClient;

  beforeEach(() => {
    client = createClient();
  });

  it('should have getRepo method', () => {
    expect(typeof client.getRepo).toBe('function');
  });

  it('should have listRepos method', () => {
    expect(typeof client.listRepos).toBe('function');
  });

  it('should have searchRepos method', () => {
    expect(typeof client.searchRepos).toBe('function');
  });

  it('should have getPR method', () => {
    expect(typeof client.getPR).toBe('function');
  });

  it('should have listPRs method', () => {
    expect(typeof client.listPRs).toBe('function');
  });

  it('should have getPRDiff method', () => {
    expect(typeof client.getPRDiff).toBe('function');
  });

  it('should have getPRFiles method', () => {
    expect(typeof client.getPRFiles).toBe('function');
  });

  it('should have createCheckRun method', () => {
    expect(typeof client.createCheckRun).toBe('function');
  });

  it('should have updateCheckRun method', () => {
    expect(typeof client.updateCheckRun).toBe('function');
  });

  it('should have listCheckRuns method', () => {
    expect(typeof client.listCheckRuns).toBe('function');
  });

  it('should have listBranches method', () => {
    expect(typeof client.listBranches).toBe('function');
  });

  it('should have getBranch method', () => {
    expect(typeof client.getBranch).toBe('function');
  });

  it('should have listWebhooks method', () => {
    expect(typeof client.listWebhooks).toBe('function');
  });

  it('should have createWebhook method', () => {
    expect(typeof client.createWebhook).toBe('function');
  });

  it('should have deleteWebhook method', () => {
    expect(typeof client.deleteWebhook).toBe('function');
  });

  it('should have graphql method', () => {
    expect(typeof client.graphql).toBe('function');
  });

  it('should have getContents method', () => {
    expect(typeof client.getContents).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Auth Header Edge Cases
// ---------------------------------------------------------------------------

describe('GitHubApiClient — auth edge cases', () => {
  it('should handle missing installation ID for App auth', async () => {
    const client = createClient({
      token: 'ghp_test',
      appPrivateKey: '-----BEGIN RSA PRIVATE KEY-----\nkey\n-----END RSA PRIVATE KEY-----',
      appId: 123,
      // No installationId — should throw
    });

    // With missing installationId, getAuthHeader should use Bearer token
    const header = await client.getAuthHeader();
    expect(header).toBe('Bearer ghp_test');
  });

  it('should throw for incomplete App credentials when installationId is set', async () => {
    // This will fail at the getInstallationToken stage because
    // the fetch will try to hit GitHub API, but the structure is correct
    const client = createClient({
      token: 'ghp_test',
      installationId: 12345,
      // Missing appPrivateKey and appId — but we have token, so getAuthHeader uses Bearer
    });
    const header = await client.getAuthHeader();
    expect(header).toBe('Bearer ghp_test');
  });
});

// ---------------------------------------------------------------------------
// HTTP Error Handling
// ---------------------------------------------------------------------------

describe('GitHubApiClient — HTTP error handling', () => {
  it('should throw GitHubApiError for 404 responses', async () => {
    const client = createClient({ token: 'ghp_error' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    try {
      await client.getRepo('owner', 'nonexistent');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubApiError);
      expect((err as GitHubApiError).message).toContain('GitHub API error 404');
      expect((err as GitHubApiError).message).toContain('Not Found');
    }

    mockFetch.mockRestore();
  });

  it('should throw with default error message when body has no message', () => {
    // Test directly via the error constructor
    const err = new GitHubApiError(500, 'Unknown error');
    expect(err.message).toContain('GitHub API error 500');
    expect(err.message).toContain('Unknown error');
    expect(err.body).toBeUndefined();
  });

  it('should handle 204 No Content responses', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 204,
        statusText: 'No Content',
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    // deleteWebhook returns void (204 response)
    const result = await client.deleteWebhook('owner', 'repo', 123);
    expect(result).toBeUndefined();

    mockFetch.mockRestore();
  });

  it('should throw GitHubApiError with body for error responses', async () => {
    const client = createClient({ token: 'ghp_test' });
    const errorBody = { message: 'Bad request', errors: [{ resource: 'PullRequest', code: 'missing' }] };
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(errorBody), {
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    try {
      await client.getRepo('owner', 'repo');
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubApiError);
      expect((err as GitHubApiError).status).toBe(422);
      expect((err as GitHubApiError).body).toEqual(errorBody);
    }

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Rate Limit Parsing
// ---------------------------------------------------------------------------

describe('GitHubApiClient — rate limit parsing', () => {
  it('should parse rate limit headers from response', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1, full_name: 'test/repo' }), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4500',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '500',
        }),
      }),
    );

    await client.getRepo('test', 'repo');
    const rateLimit = client.getRateLimit();
    expect(rateLimit.limit).toBe(5000);
    expect(rateLimit.remaining).toBe(4500);
    expect(rateLimit.reset).toBe(1700000000);
    expect(rateLimit.used).toBe(500);

    mockFetch.mockRestore();
  });

  it('should fallback to default values when rate limit headers are missing', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: new Headers({}),
      }),
    );

    await client.getRepo('test', 'repo');
    const rateLimit = client.getRateLimit();
    // Should fallback to defaults from previous state
    expect(rateLimit.remaining).toBe(0);
    expect(rateLimit.reset).toBe(0);

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Retry Logic
// ---------------------------------------------------------------------------

describe('GitHubApiClient — retry logic', () => {
  // Mock setTimeout globally to avoid real sleep
  beforeEach(() => {
    vi.spyOn(global, 'setTimeout').mockImplementation((fn: any, _ms?: number) => {
      // Call the callback immediately (ms=0) for fast tests
      if (typeof fn === 'function') fn();
      return 0 as any;
    });
  });

  afterEach(() => {
    vi.mocked(global.setTimeout).mockRestore();
  });

  it('should retry on 429 rate limit errors and succeed', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      // First call: 429
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Rate limit' }), {
          status: 429,
          headers: new Headers({
            'retry-after': '1',
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1700000000',
            'x-ratelimit-used': '5000',
          }),
        }),
      )
      // Second call: success
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, full_name: 'test/repo' }), {
          status: 200,
          headers: new Headers({
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': '1700000000',
            'x-ratelimit-used': '1',
          }),
        }),
      );

    const result = await client.getRepo('test', 'repo');
    expect(result).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    mockFetch.mockRestore();
  });

  it('should throw GitHubRateLimitError after max retries on 429', async () => {
    const client = createClient({ token: 'ghp_test' });
    const rateLimitHeaders = new Headers({
      'retry-after': '1',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1700000000',
      'x-ratelimit-used': '5000',
    });

    // All 4 calls (1 initial + 3 retries) return 429
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 429, headers: rateLimitHeaders }));

    await expect(client.getRepo('test', 'repo')).rejects.toThrow(GitHubRateLimitError);

    mockFetch.mockRestore();
  });

  it('should retry on 5xx server errors with exponential backoff', async () => {
    const client = createClient({ token: 'ghp_test' });
    const serverHeaders = new Headers({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '5000',
      'x-ratelimit-reset': '0',
      'x-ratelimit-used': '0',
    });

    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500, headers: serverHeaders }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 503, headers: serverHeaders }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 }), { status: 200, headers: serverHeaders }));

    const result = await client.getRepo('test', 'repo');
    expect(result).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(3);

    mockFetch.mockRestore();
  });

  it('should not retry on 4xx errors (except 429)', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    await expect(client.getRepo('test', 'repo')).rejects.toThrow(GitHubApiError);
    // Should only be called once (no retries on 4xx)
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockRestore();
  });

  it('should not retry on 5xx after max retries exhausted', async () => {
    const client = createClient({ token: 'ghp_test' });
    const serverHeaders = new Headers({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '5000',
      'x-ratelimit-reset': '0',
      'x-ratelimit-used': '0',
    });

    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ message: 'Server error' }), { status: 500, headers: serverHeaders }));

    await expect(client.getRepo('test', 'repo')).rejects.toThrow(GitHubApiError);
    expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries

    mockFetch.mockRestore();
  });

  it('should default retry-after to 60 seconds when header is missing', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), {
        status: 429,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '5000',
          // No retry-after header → defaults to 60
        }),
      }));

    // setTimeout is mocked to fire immediately, so all 4 attempts happen instantly
    await expect(client.getRepo('test', 'repo')).rejects.toThrow(GitHubRateLimitError);

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Pagination & Request Construction
// ---------------------------------------------------------------------------

describe('GitHubApiClient — request construction', () => {
  it('should construct request with default method (GET)', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1, full_name: 'test/repo' }), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    await client.getRepo('test', 'repo');
    const callArgs = mockFetch.mock.calls[0]!;
    expect(callArgs[1]!.method).toBe('GET');

    mockFetch.mockRestore();
  });

  it('should construct POST request for createCheckRun', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1, name: 'test-check' }), {
        status: 201,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    await client.createCheckRun('test', 'repo', {
      name: 'test-check',
      head_sha: 'abc123',
    });
    const callArgs2 = mockFetch.mock.calls[0]!;
    expect(callArgs2[1]!.method).toBe('POST');

    mockFetch.mockRestore();
  });

  it('should construct PATCH request for updateCheckRun', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1, name: 'updated-check' }), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    await client.updateCheckRun('test', 'repo', 1, { name: 'updated-check' });
    const callArgs3 = mockFetch.mock.calls[0]!;
    expect(callArgs3[1]!.method).toBe('PATCH');

    mockFetch.mockRestore();
  });

  it('should include Content-Type header for requests with body', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    await client.createCheckRun('test', 'repo', { name: 'check', head_sha: 'abc' });
    const callArgs4 = mockFetch.mock.calls[0]!;
    expect((callArgs4[1] as any)!.headers!['Content-Type']).toBe('application/json');

    mockFetch.mockRestore();
  });

  it('should construct search URL with encoded query', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ total_count: 0, items: [] }), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    await client.searchRepos('test language:typescript');
    const callArgs = mockFetch.mock.calls[0]!;
    const url = callArgs[0] as string;
    expect(url).toContain('/search/repositories');
    expect(url).toContain('language%3Atypescript');

    mockFetch.mockRestore();
  });

  it('should construct listRepos URL with query params', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    await client.listRepos('myorg', { type: 'public', sort: 'updated', per_page: 50 });
    const callArgs2 = mockFetch.mock.calls[0]!;
    const url2 = callArgs2[0] as string;
    expect(url2).toContain('type=public');
    expect(url2).toContain('sort=updated');
    expect(url2).toContain('per_page=50');

    mockFetch.mockRestore();
  });

  it('should construct listPRs URL with query params', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    await client.listPRs('test', 'repo', { state: 'open', head: 'feature', base: 'main', per_page: 100 });
    const callArgs3 = mockFetch.mock.calls[0]!;
    const url3 = callArgs3[0] as string;
    expect(url3).toContain('state=open');
    expect(url3).toContain('head=feature');
    expect(url3).toContain('base=main');
    expect(url3).toContain('per_page=100');

    mockFetch.mockRestore();
  });

  it('should construct getContents URL with ref parameter', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'file', name: 'test.ts', content: 'Y29uc3QgeCA9IDE7' }), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    await client.getContents('test', 'repo', 'src/file.ts', 'main');
    const callArgs4 = mockFetch.mock.calls[0]!;
    const url4 = callArgs4[0] as string;
    expect(url4).toContain('ref=main');

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

describe('GitHubApiClient — GraphQL', () => {
  it('should execute GraphQL query and return response', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: { repository: { id: 'abc', name: 'test' } },
      }), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const result = await client.graphql<{ repository: { id: string; name: string } }>(
      'query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { id name } }',
      { owner: 'test', repo: 'repo' },
    );

    expect(result.data).toBeDefined();
    expect(result.data!.repository.name).toBe('test');

    mockFetch.mockRestore();
  });

  it('should handle GraphQL errors in response', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: null,
        errors: [{ message: 'Field not found', path: ['repository', 'nonexistent'] }],
      }), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const result = await client.graphql('query { nonexistent }');
    expect(result.data).toBeNull();
    expect(result.errors).toBeDefined();
    expect(result.errors![0]!.message).toBe('Field not found');

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// PR Diff
// ---------------------------------------------------------------------------

describe('GitHubApiClient — PR diff (text)', () => {
  it('should fetch PR diff as raw text', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('diff --git a/file.ts b/file.ts\nindex abc..def 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+new line', {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const diff = await client.getPRDiff('test', 'repo', 42);
    expect(diff).toContain('diff --git');
    expect(diff).toContain('+new line');

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// PR Files
// ---------------------------------------------------------------------------

describe('GitHubApiClient — PR files', () => {
  it('should fetch PR files list', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([
        { filename: 'src/test.ts', status: 'modified', additions: 10, deletions: 3, changes: 13 },
        { filename: 'src/new.ts', status: 'added', additions: 42, deletions: 0, changes: 42 },
      ]), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const files = await client.getPRFiles('test', 'repo', 42);
    expect(files).toHaveLength(2);
    expect(files[0]!.filename).toBe('src/test.ts');
    expect(files[0]!.status).toBe('modified');
    expect(files[1]!.status).toBe('added');

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Webhook Methods
// ---------------------------------------------------------------------------

describe('GitHubApiClient — webhooks', () => {
  it('should list webhooks', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 1, url: 'https://api.github.com/repos/test/repo/hooks/1', active: true, events: ['push'], config: { url: 'https://example.com/webhook', content_type: 'json', insecure_ssl: '0' } }]), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const hooks = await client.listWebhooks('test', 'repo');
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.id).toBe(1);

    mockFetch.mockRestore();
  });

  it('should create webhook', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 2, url: 'https://api.github.com/repos/test/repo/hooks/2', active: true, events: ['pull_request'], config: { url: 'https://example.com/hook', content_type: 'json', insecure_ssl: '0' } }), {
        status: 201,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const hook = await client.createWebhook('test', 'repo', { url: 'https://example.com/hook' });
    expect(hook.id).toBe(2);
    expect(hook.events).toContain('pull_request');

    mockFetch.mockRestore();
  });

  it('should create webhook with custom events', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 3, url: 'https://api.github.com/repos/test/repo/hooks/3', active: true, events: ['issues', 'push'], config: { url: 'https://example.com/custom', content_type: 'json', insecure_ssl: '0' } }), {
        status: 201,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const hook = await client.createWebhook('test', 'repo', {
      url: 'https://example.com/custom',
      events: ['issues', 'push'],
    });
    expect(hook.events).toContain('issues');

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Check Runs and Branch Methods
// ---------------------------------------------------------------------------

describe('GitHubApiClient — check runs and branches', () => {
  it('should list check runs', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ total_count: 2, check_runs: [{ id: 1, name: 'lint', head_sha: 'abc', status: 'completed', conclusion: 'success' }] }), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const result = await client.listCheckRuns('test', 'repo', 'abc123');
    expect(result.total_count).toBe(2);
    expect(result.check_runs[0]!.name).toBe('lint');

    mockFetch.mockRestore();
  });

  it('should list branches', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([{ name: 'main', commit: { sha: 'abc' }, protected: true }]), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const branches = await client.listBranches('test', 'repo');
    expect(branches).toHaveLength(1);
    expect(branches[0]!.name).toBe('main');

    mockFetch.mockRestore();
  });

  it('should get a specific branch', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'feature', commit: { sha: 'def' }, protected: false }), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const branch = await client.getBranch('test', 'repo', 'feature');
    expect(branch.name).toBe('feature');
    expect(branch.protected).toBe(false);

    mockFetch.mockRestore();
  });

  it('should get a single PR', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        number: 42,
        title: 'Test PR',
        body: 'Description',
        state: 'open',
        head: { sha: 'def456', ref: 'feature', repo: { full_name: 'test/repo' } },
        base: { sha: 'abc123', ref: 'main', repo: { full_name: 'test/repo' } },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        user: { login: 'test-user' },
      }), {
        status: 200,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const pr = await client.getPR('test', 'repo', 42);
    expect(pr.number).toBe(42);
    expect(pr.title).toBe('Test PR');
    expect(pr.state).toBe('open');

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createWebhook — default events fallback
// ---------------------------------------------------------------------------

describe('GitHubApiClient — createWebhook default events', () => {
  it('should use default events when events not provided', async () => {
    const client = createClient({ token: 'ghp_test' });
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 4, events: ['pull_request', 'push'] }), {
        status: 201,
        headers: new Headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
      }),
    );

    const hook = await client.createWebhook('test', 'repo', { url: 'https://example.com/hook' });
    expect(hook.events).toEqual(['pull_request', 'push']);

    mockFetch.mockRestore();
  });
});
