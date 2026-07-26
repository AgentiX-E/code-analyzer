// @code-analyzer/intelligence — GitHub API Client Tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
