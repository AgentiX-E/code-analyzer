// The middleware chain every MCP tool call passes through, including the part nothing had ever executed.
//
// **`CircuitBreaker` was 64 statements and seven functions with no test at all** — the one component in this file that
// decides *whether a tool runs at all*, and the one a refusal is blamed on when an agent reports "the server stopped
// answering". The rest of the file had cases that touched its happy path; the breaker had none, in any state.
//
// **The states are the test.** A breaker is a small machine — closed, open, half-open — and every defect it can have
// is a transition that does not happen: it never opens (so a failing tool is called forever), it never closes (so a
// recovered one is never called again), or half-open admits more probes than it promised.

import { describe, expect, it } from 'vitest';

import {
  AuthMiddleware,
  CircuitBreaker,
  RateLimiter,
  RequestLogger,
  ToolPolicy,
} from '../middleware/index.js';

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

describe('the circuit breaker', () => {
  it('passes a successful call straight through and stays closed', async () => {
    const breaker = new CircuitBreaker();

    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(0);
  });

  it('opens after the failure threshold, and refuses without calling the function', async () => {
    // **The refusal is the point**: once open, the wrapped call must not run at all - otherwise the breaker is a
    // counter rather than a guard.
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    let calls = 0;
    const failing = async (): Promise<void> => {
      calls += 1;
      throw new Error('down');
    };

    for (let i = 0; i < 3; i += 1) await expect(breaker.execute(failing)).rejects.toThrow('down');
    expect(breaker.getState()).toBe('open');
    expect(breaker.getFailureCount()).toBe(3);

    await expect(breaker.execute(failing)).rejects.toThrow('Circuit breaker is open');
    expect(calls).toBe(3);
  });

  it('resets the failure count on a success, so a flapping tool does not accumulate', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    const failing = async (): Promise<void> => {
      throw new Error('down');
    };

    await expect(breaker.execute(failing)).rejects.toThrow();
    await expect(breaker.execute(failing)).rejects.toThrow();
    await breaker.execute(async () => 'ok');

    expect(breaker.getFailureCount()).toBe(0);
    expect(breaker.getState()).toBe('closed');
  });

  it('half-opens once the reset timeout has passed, and closes on the first success', async () => {
    // **`resetTimeoutMs: 0` makes the transition immediate**, so the case tests the machine rather than a clock.
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 });
    const failing = async (): Promise<void> => {
      throw new Error('down');
    };
    await expect(breaker.execute(failing)).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    await expect(breaker.execute(async () => 'recovered')).resolves.toBe('recovered');
    expect(breaker.getState()).toBe('closed');
  });

  it('admits only the promised number of probes while half-open', async () => {
    // **A half-open breaker that admits everything is an open one that has stopped working.** The limit is what keeps
    // a recovering backend from receiving the full load again on the first tick.
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 0,
      halfOpenMaxRequests: 1,
    });
    const failing = async (): Promise<void> => {
      throw new Error('down');
    };
    await expect(breaker.execute(failing)).rejects.toThrow();

    // The first call moves the breaker to half-open and uses the single probe, which fails.
    await expect(breaker.execute(failing)).rejects.toThrow('down');
    expect(breaker.getState()).toBe('open');

    // The next call half-opens again; a probe that fails again must not be admitted twice in the same window.
    const first = breaker.execute(failing);
    await expect(first).rejects.toThrow('down');
  });

  it('refuses a second concurrent probe while half-open', async () => {
    // **The limit only means anything while a probe is in flight**: two calls that arrive together must not both be
    // admitted, or the recovering backend receives the load that opened the breaker.
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 0,
      halfOpenMaxRequests: 1,
    });
    await expect(
      breaker.execute(async () => {
        throw new Error('down');
      }),
    ).rejects.toThrow();

    const slow = async (): Promise<string> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'ok';
    };
    const first = breaker.execute(slow);

    await expect(breaker.execute(slow)).rejects.toThrow(
      'Circuit breaker half-open request limit reached',
    );
    await expect(first).resolves.toBe('ok');
  });

  it('returns to closed on demand', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    await expect(
      breaker.execute(async () => {
        throw new Error('down');
      }),
    ).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    breaker.reset();

    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(0);
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe('authentication', () => {
  const request = (headers: Record<string, string>): Record<string, unknown> => ({ headers });

  it('allows every request when no key is configured', () => {
    expect(new AuthMiddleware().validate(request({}))).toEqual({ allowed: true });
  });

  it('accepts the key from either header', () => {
    const auth = new AuthMiddleware(['secret']);
    expect(auth.validate(request({ 'x-api-key': 'secret' }))).toEqual({ allowed: true });
    expect(auth.validate(request({ authorization: 'Bearer secret' }))).toEqual({ allowed: true });
  });

  it('rejects a missing key and a wrong key with different messages', () => {
    // **The two messages are the product**: "missing" tells an operator to configure a client, "invalid" tells them to
    // rotate a key, and a single "unauthorised" leaves them guessing which.
    const auth = new AuthMiddleware(['secret']);
    expect(auth.validate(request({}))).toEqual({ allowed: false, message: 'Missing API key' });
    expect(auth.validate(request({ 'x-api-key': 'wrong' }))).toEqual({
      allowed: false,
      message: 'Invalid API key',
    });
  });

  it('accepts a key added after construction and rejects one removed', () => {
    const auth = new AuthMiddleware(['a']);
    auth.addKey('b');
    expect(auth.validate(request({ 'x-api-key': 'b' }))).toEqual({ allowed: true });

    auth.removeKey('b');
    expect(auth.validate(request({ 'x-api-key': 'b' })).allowed).toBe(false);
  });

  it('reports each OAuth2 outcome separately', async () => {
    await expect(AuthMiddleware.authenticateOAuth2('', async () => true)).resolves.toEqual({
      allowed: false,
      message: 'Missing OAuth2 token',
    });
    await expect(AuthMiddleware.authenticateOAuth2('t', async () => true)).resolves.toEqual({
      allowed: true,
    });
    await expect(AuthMiddleware.authenticateOAuth2('t', async () => false)).resolves.toEqual({
      allowed: false,
      message: 'Invalid or expired OAuth2 token',
    });
    // **A validator that throws is a failure of the check, not of the request**, so it reads as a refusal.
    await expect(
      AuthMiddleware.authenticateOAuth2('t', async () => {
        throw new Error('idp unreachable');
      }),
    ).resolves.toEqual({ allowed: false, message: 'OAuth2 token validation failed' });
  });

  it('validates an HS256 JWT and carries its payload', async () => {
    const { createHmac } = await import('node:crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'user', exp: 9999999999 })).toString(
      'base64url',
    );
    const signature = createHmac('sha256', 'secret')
      .update(`${header}.${payload}`)
      .digest('base64url');

    const result = await AuthMiddleware.authenticateJWT(
      `${header}.${payload}.${signature}`,
      'secret',
    );

    expect(result.allowed).toBe(true);
    expect(result.payload).toEqual({ sub: 'user', exp: 9999999999 });
  });

  it('refuses a JWT for each reason a JWT can be refused', async () => {
    const { createHmac } = await import('node:crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url');
    const signature = createHmac('sha256', 'secret')
      .update(`${header}.${payload}`)
      .digest('base64url');
    const otherAlg = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');

    const message = async (token: string, secret = 'secret'): Promise<string | undefined> =>
      (await AuthMiddleware.authenticateJWT(token, secret)).message;

    expect(await message('')).toBe('Missing JWT token');
    expect(await message('only.two')).toBe('Invalid JWT format');
    expect(await message(`${otherAlg}.${payload}.${signature}`)).toBe('Unsupported JWT algorithm');
    expect(await message(`${header}.${payload}.${signature}`, 'other-secret')).toBe(
      'Invalid JWT signature',
    );
    // `exp: 1` is 1970, so this token is valid-signed and expired - the case a signature check alone lets through.
    expect(await message(`${header}.${payload}.${signature}`)).toBe('JWT token expired');
    expect(await message('not.base64!.json')).toBe('JWT token validation failed');
  });
});

// ---------------------------------------------------------------------------
// Rate limiting, policy and logging
// ---------------------------------------------------------------------------

describe('rate limiting', () => {
  it('allows up to the capacity and then refuses with a retry hint', () => {
    const limiter = new RateLimiter(2, 0.001);

    expect(limiter.check('search').allowed).toBe(true);
    expect(limiter.check('search').allowed).toBe(true);
    const refused = limiter.check('search');

    expect(refused.allowed).toBe(false);
    expect(refused.message).toContain('search');
    expect(refused.retryAfterMs).toBeGreaterThan(0);
  });

  it('keeps a bucket per tool, so one noisy tool does not silence the rest', () => {
    const limiter = new RateLimiter(1, 0.001);
    limiter.check('search');

    expect(limiter.check('search').allowed).toBe(false);
    expect(limiter.check('impact').allowed).toBe(true);
  });

  it('reports the capacity for a tool that has never been called, and clears on reset', () => {
    const limiter = new RateLimiter(5);
    expect(limiter.getTokens('unused')).toBe(5);

    limiter.check('unused');
    limiter.reset();
    expect(limiter.getTokens('unused')).toBe(5);
  });
});

describe('tool policy', () => {
  it('allows everything under the `all` profile and under an `all` tool', () => {
    const policy = new ToolPolicy('all');
    expect(policy.isAllowed('anything', 'analysis')).toBe(true);

    const narrow = new ToolPolicy('analysis');
    expect(narrow.isAllowed('anything', 'all')).toBe(true);
    expect(narrow.isAllowed('anything', 'analysis')).toBe(true);
    expect(narrow.isAllowed('anything', 'scout')).toBe(false);
  });

  it('reports and changes the profile', () => {
    const policy = new ToolPolicy();
    expect(policy.getProfile()).toBe('all');

    policy.setProfile('scout');
    expect(policy.getProfile()).toBe('scout');
    expect(policy.isAllowed('anything', 'analysis')).toBe(false);
  });
});

describe('the request log', () => {
  it('records the time of each entry rather than the caller’s', () => {
    const logger = new RequestLogger();
    logger.log({ toolName: 'search', args: {}, duration: 5, error: false });

    const [entry] = logger.getLogs();
    expect(entry!.toolName).toBe('search');
    expect(Date.parse(entry!.timestamp)).toBeGreaterThan(0);
  });

  it('keeps only the most recent entries when it is full', () => {
    const logger = new RequestLogger(2);
    for (const name of ['a', 'b', 'c']) {
      logger.log({ toolName: name, args: {}, duration: 1, error: false });
    }

    expect(logger.getLogs().map((l) => l.toolName)).toEqual(['b', 'c']);
    expect(logger.getStats().total).toBe(2);
  });

  it('summarises errors and the average duration, and reports zero rather than NaN when empty', () => {
    const logger = new RequestLogger();
    expect(logger.getStats()).toEqual({ total: 0, errors: 0, avgDuration: 0 });

    logger.log({ toolName: 'a', args: {}, duration: 10, error: true });
    logger.log({ toolName: 'b', args: {}, duration: 30, error: false });

    expect(logger.getStats()).toEqual({ total: 2, errors: 1, avgDuration: 20 });
  });

  it('returns the last N entries and clears on demand', () => {
    const logger = new RequestLogger();
    for (const name of ['a', 'b', 'c']) {
      logger.log({ toolName: name, args: {}, duration: 1, error: false });
    }

    expect(logger.getLogs(2).map((l) => l.toolName)).toEqual(['b', 'c']);

    logger.clear();
    expect(logger.getLogs()).toEqual([]);
  });
});
