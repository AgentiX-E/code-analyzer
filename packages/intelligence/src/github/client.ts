// @code-analyzer/intelligence — GitHub API Client
// Full-featured GitHub REST + GraphQL client with authentication,
// rate-limit awareness, exponential backoff retry, and comprehensive type safety.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubAuth {
  /** Personal access token (PAT) or OAuth token */
  token: string;
  /** GitHub App installation ID for JWT-based auth */
  installationId?: number;
  /** GitHub App ID for JWT generation */
  appId?: number;
  /** GitHub App private key (PEM) for JWT signing */
  appPrivateKey?: string;
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  language: string | null;
  topics: string[];
  stargazers_count: number;
  open_issues_count: number;
  updated_at: string;
  clone_url: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  head: { sha: string; ref: string; repo: { full_name: string } };
  base: { sha: string; ref: string; repo: { full_name: string } };
  created_at: string;
  updated_at: string;
  user: { login: string };
}

export interface GitHubPRFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  head_sha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  output?: {
    title: string;
    summary: string;
    text?: string;
    annotations?: GitHubAnnotation[];
  };
}

export interface GitHubAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  message: string;
  title?: string;
  raw_details?: string;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export interface GitHubWebhook {
  id: number;
  url: string;
  active: boolean;
  events: string[];
  config: {
    url: string;
    content_type: string;
    insecure_ssl: string;
    secret?: string;
  };
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
  used: number;
}

export interface GraphQLResponse<T> {
  data: T | null;
  errors?: Array<{ message: string; path?: string[] }>;
}

export interface RepoSearchResult {
  total_count: number;
  items: GitHubRepo[];
}

export interface CreateCheckRunParams {
  name: string;
  head_sha: string;
  status?: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  output?: {
    title: string;
    summary: string;
    text?: string;
    annotations?: GitHubAnnotation[];
  };
  started_at?: string;
  completed_at?: string;
}

export interface UpdateCheckRunParams extends Partial<CreateCheckRunParams> {
  name?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** Default GitHub API base URL. */
const API_BASE = 'https://api.github.com';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const BACKOFF_FACTOR = 2;

export class GitHubApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(`GitHub API error ${status}: ${message}`);
    this.name = 'GitHubApiError';
  }
}

export class GitHubRateLimitError extends GitHubApiError {
  constructor(
    public retryAfter: number,
    rateLimit: RateLimitInfo,
  ) {
    super(
      429,
      `Rate limit exceeded. Reset at ${new Date(rateLimit.reset * 1000).toISOString()}`,
    );
    this.name = 'GitHubRateLimitError';
  }
}

/**
 * Full-featured GitHub API client supporting REST and GraphQL.
 * Handles authentication, rate limiting, and retries.
 *
 * @example
 * ```ts
 * const client = new GitHubApiClient({ token: 'ghp_xxx' });
 * const repo = await client.getRepo('owner', 'repo');
 * const prs = await client.listPRs('owner', 'repo', { state: 'open' });
 * ```
 */
export class GitHubApiClient {
  private readonly auth: GitHubAuth;
  private rateLimit: RateLimitInfo = { limit: 5000, remaining: 5000, reset: 0, used: 0 };
  private appToken: { token: string; expiresAt: number } | null = null;

  constructor(auth: GitHubAuth) {
    this.auth = { ...auth };
  }

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  /**
   * Get the authorization header value.
   * For GitHub App installations, generates/exchanges JWT for an installation token.
   */
  async getAuthHeader(): Promise<string> {
    // GitHub App JWT flow
    if (this.auth.installationId && this.auth.appPrivateKey) {
      const token = await this.getInstallationToken();
      return `token ${token}`;
    }

    // Standard PAT / OAuth token
    return `Bearer ${this.auth.token}`;
  }

  /**
   * Generate a GitHub App installation access token via JWT exchange.
   */
  private async getInstallationToken(): Promise<string> {
    if (this.appToken && this.appToken.expiresAt > Date.now() + 60_000) {
      return this.appToken.token;
    }

    if (!this.auth.appPrivateKey || !this.auth.appId || !this.auth.installationId) {
      throw new Error('Incomplete GitHub App credentials');
    }

    // Generate JWT (simplified — in production use @octokit/auth-app)
    const jwt = await this.generateAppJwt(
      this.auth.appId,
      this.auth.appPrivateKey,
    );

    const res = await this.rawFetch(
      `${API_BASE}/app/installations/${this.auth.installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github.v3+json',
        },
      },
    );

    const data = await res.json() as { token: string; expires_at: string };
    this.appToken = {
      token: data.token,
      expiresAt: new Date(data.expires_at).getTime(),
    };

    return data.token;
  }

  /**
   * Generate a JWT for GitHub App authentication.
   * Uses the private key to sign a JWT with app_id as issuer.
   */
  private async generateAppJwt(appId: number, privateKeyPem: string): Promise<string> {
    // Note: JWT signing requires a crypto library. For production use,
    // leverage @octokit/auth-app. Here we implement a minimal version.
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60,
      exp: now + 600,
      iss: appId,
    };

    const headerB64 = base64UrlEncode(JSON.stringify(header));
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;

    // Sign with the private key using Node.js crypto
    /* v8 ignore start */
    const { subtle: _unused } = await import('node:crypto').then(() => (
      globalThis.crypto?.subtle
        ? { subtle: globalThis.crypto.subtle }
        : import('node:crypto').then(c => (
            c.webcrypto?.subtle
              ? { subtle: c.webcrypto.subtle }
              : { subtle: null as null }
          ))
    )) as Promise<{ subtle: unknown }>;
    /* v8 ignore stop */

    const sig = await signWithNode(signingInput, privateKeyPem);

    return `${headerB64}.${payloadB64}.${sig}`;
  }

  // -----------------------------------------------------------------------
  // Rate Limit
  // -----------------------------------------------------------------------

  /** Get current rate limit info from the last API call. */
  getRateLimit(): RateLimitInfo {
    return { ...this.rateLimit };
  }

  // -----------------------------------------------------------------------
  // Repository Methods
  // -----------------------------------------------------------------------

  /** Get repository metadata. */
  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.request<GitHubRepo>(`/repos/${owner}/${repo}`);
  }

  /** List repositories for an organization or user. */
  async listRepos(owner: string, options?: { type?: string; sort?: string; per_page?: number }): Promise<GitHubRepo[]> {
    const params = new URLSearchParams();
    if (options?.type) params.set('type', options.type);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.per_page) params.set('per_page', String(options.per_page));
    const qs = params.toString();
    return this.request<GitHubRepo[]>(`/orgs/${owner}/repos${qs ? `?${qs}` : ''}`);
  }

  /** Search repositories by query. */
  async searchRepos(query: string): Promise<RepoSearchResult> {
    return this.request<RepoSearchResult>(`/search/repositories?q=${encodeURIComponent(query)}`);
  }

  // -----------------------------------------------------------------------
  // PR Methods
  // -----------------------------------------------------------------------

  /** Get a single pull request. */
  async getPR(owner: string, repo: string, number: number): Promise<GitHubPR> {
    return this.request<GitHubPR>(`/repos/${owner}/${repo}/pulls/${number}`);
  }

  /** List pull requests for a repository. */
  async listPRs(
    owner: string,
    repo: string,
    options?: { state?: string; head?: string; base?: string; per_page?: number },
  ): Promise<GitHubPR[]> {
    const params = new URLSearchParams();
    if (options?.state) params.set('state', options.state);
    if (options?.head) params.set('head', options.head);
    if (options?.base) params.set('base', options.base);
    if (options?.per_page) params.set('per_page', String(options.per_page));
    const qs = params.toString();
    return this.request<GitHubPR[]>(`/repos/${owner}/${repo}/pulls${qs ? `?${qs}` : ''}`);
  }

  /** Get the raw unified diff for a PR. */
  async getPRDiff(owner: string, repo: string, number: number): Promise<string> {
    return this.requestText(`/repos/${owner}/${repo}/pulls/${number}`, {
      Accept: 'application/vnd.github.v3.diff',
    });
  }

  /** Get the list of files changed in a PR. */
  async getPRFiles(owner: string, repo: string, number: number): Promise<GitHubPRFile[]> {
    return this.request<GitHubPRFile[]>(`/repos/${owner}/${repo}/pulls/${number}/files`);
  }

  // -----------------------------------------------------------------------
  // Check Runs
  // -----------------------------------------------------------------------

  /** Create a check run on a commit. */
  async createCheckRun(
    owner: string,
    repo: string,
    params: CreateCheckRunParams,
  ): Promise<GitHubCheckRun> {
    return this.request<GitHubCheckRun>(
      `/repos/${owner}/${repo}/check-runs`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: params.name,
          head_sha: params.head_sha,
          status: params.status ?? 'in_progress',
          conclusion: params.conclusion,
          output: params.output,
          started_at: params.started_at ?? new Date().toISOString(),
          completed_at: params.completed_at,
        }),
      },
    );
  }

  /** Update an existing check run. */
  async updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    params: UpdateCheckRunParams,
  ): Promise<GitHubCheckRun> {
    return this.request<GitHubCheckRun>(
      `/repos/${owner}/${repo}/check-runs/${checkRunId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: params.name,
          status: params.status,
          conclusion: params.conclusion,
          output: params.output,
          completed_at: params.completed_at,
        }),
      },
    );
  }

  /** List check runs for a commit ref. */
  async listCheckRuns(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<{ total_count: number; check_runs: GitHubCheckRun[] }> {
    return this.request(`/repos/${owner}/${repo}/commits/${ref}/check-runs`);
  }

  // -----------------------------------------------------------------------
  // Branch Methods
  // -----------------------------------------------------------------------

  /** List branches for a repository. */
  async listBranches(owner: string, repo: string): Promise<GitHubBranch[]> {
    return this.request<GitHubBranch[]>(`/repos/${owner}/${repo}/branches`);
  }

  /** Get a specific branch. */
  async getBranch(owner: string, repo: string, branch: string): Promise<GitHubBranch> {
    return this.request<GitHubBranch>(`/repos/${owner}/${repo}/branches/${branch}`);
  }

  // -----------------------------------------------------------------------
  // Webhook Methods
  // -----------------------------------------------------------------------

  /** List webhooks for a repository. */
  async listWebhooks(owner: string, repo: string): Promise<GitHubWebhook[]> {
    return this.request<GitHubWebhook[]>(`/repos/${owner}/${repo}/hooks`);
  }

  /** Create a webhook for a repository. */
  async createWebhook(
    owner: string,
    repo: string,
    config: { url: string; secret?: string; events?: string[] },
  ): Promise<GitHubWebhook> {
    return this.request<GitHubWebhook>(
      `/repos/${owner}/${repo}/hooks`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'web',
          active: true,
          events: config.events ?? ['pull_request', 'push'],
          config: {
            url: config.url,
            content_type: 'json',
            secret: config.secret,
            insecure_ssl: '0',
          },
        }),
      },
    );
  }

  /** Delete a webhook. */
  async deleteWebhook(owner: string, repo: string, hookId: number): Promise<void> {
    await this.request(`/repos/${owner}/${repo}/hooks/${hookId}`, { method: 'DELETE' });
  }

  // -----------------------------------------------------------------------
  // GraphQL Methods
  // -----------------------------------------------------------------------

  /** Execute a GraphQL query. */
  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<GraphQLResponse<T>> {
    const res = await this.authFetch(`${API_BASE}/graphql`, {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
    return res.json() as Promise<GraphQLResponse<T>>;
  }

  // -----------------------------------------------------------------------
  // Content Methods
  // -----------------------------------------------------------------------

  /** Get the contents of a file or directory. */
  async getContents(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<{ content?: string; encoding?: string; type: string; name: string }> {
    const url = `/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ''}`;
    return this.request(url);
  }

  // -----------------------------------------------------------------------
  // Core HTTP Methods
  // -----------------------------------------------------------------------

  /**
   * Make an authenticated request to the GitHub REST API.
   * Handles rate limiting, retries, and error parsing.
   */
  private async request<T>(
    path: string,
    options?: { method?: string; body?: string; Accept?: string },
  ): Promise<T> {
    const url = `${API_BASE}${path}`;

    const res = await this.authFetch(url, {
      method: options?.method ?? 'GET',
      body: options?.body,
      acceptHeader: options?.Accept ?? 'application/vnd.github.v3+json',
    });

    // Handle 204 No Content
    if (res.status === 204) return undefined as unknown as T;

    const body = await res.json();

    if (!res.ok) {
      throw new GitHubApiError(res.status, (body as { message?: string })?.message ?? 'Unknown error', body);
    }

    return body as T;
  }

  /**
   * Make an authenticated request returning raw text.
   */
  private async requestText(
    path: string,
    options?: { Accept?: string },
  ): Promise<string> {
    const url = `${API_BASE}${path}`;

    const res = await this.authFetch(url, {
      /* v8 ignore next */
      acceptHeader: options?.Accept ?? 'application/vnd.github.v3.diff',
    });

    return res.text();
  }

  /**
   * Fetch with authentication header, retry, and rate-limit tracking.
   */
  private async authFetch(
    url: string,
    options: { method?: string; body?: string; acceptHeader?: string; headers?: Record<string, string> },
    retryCount = 0,
  ): Promise<Response> {
    const authHeader = await this.getAuthHeader();

    const headers: Record<string, string> = {
      Authorization: authHeader,
      Accept: options.acceptHeader ?? 'application/vnd.github.v3+json',
      'User-Agent': 'code-analyzer',
      ...options.headers,
    };

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await this.rawFetch(url, { method: options.method, body: options.body, headers });

    // Track rate limit
    this.rateLimit = {
      limit: parseInt(res.headers.get('x-ratelimit-limit') ?? '0', 10) || this.rateLimit.limit,
      remaining: parseInt(res.headers.get('x-ratelimit-remaining') ?? '0', 10),
      reset: parseInt(res.headers.get('x-ratelimit-reset') ?? '0', 10),
      used: parseInt(res.headers.get('x-ratelimit-used') ?? '0', 10),
    };

    // Handle rate limiting
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10);
      if (retryCount < MAX_RETRIES) {
        await sleep(retryAfter * 1000);
        return this.authFetch(url, options, retryCount + 1);
      }
      throw new GitHubRateLimitError(retryAfter, this.rateLimit);
    }

    // Retry on server errors
    if (res.status >= 500 && retryCount < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, retryCount);
      await sleep(delay);
      return this.authFetch(url, options, retryCount + 1);
    }

    return res;
  }

  /**
   * Raw fetch without any auth or retry logic.
   */
  private async rawFetch(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<Response> {
    return fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString('base64url');
}

async function signWithNode(signingInput: string, privateKeyPem: string): Promise<string> {
  const crypto = await import('node:crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  sign.end();
  return sign.sign(privateKeyPem, 'base64url');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
