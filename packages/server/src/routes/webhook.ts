// @code-analyzer/server — GitHub Webhook Routes
// Accept GitHub webhook events and route them through the cross-repo review pipeline.
// Verifies HMAC signatures and responds within GitHub's 10-second requirement.

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ServerConfig } from '../server-config.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookHandler {
  /** Process a webhook payload. Called asynchronously after 200 response. */
  process(payload: unknown): Promise<void>;
}

export interface WebhookConfig {
  /** Shared secret for HMAC-SHA256 signature verification */
  secret?: string;
  /** Webhook event handler */
  handler: WebhookHandler;
  /**
   * How many invalid signatures one source may present before it is refused without an HMAC being
   * computed, and for how long that refusal lasts.
   *
   * **The server's rate limiter is off by default** (`rateLimit.enabled` is `false` in
   * `DEFAULT_CONFIG`), so before this budget existed an unauthenticated endpoint that performs an
   * HMAC check answered an unlimited number of guesses - and every guess cost a SHA-256 over the
   * whole payload plus a `timingSafeEqual`. A failure budget is not a traffic limit: it is the
   * bound that makes "verify a signature" a question with a cost.
   */
  signatureFailureLimit?: SignatureFailureLimit;
}

/** A failure budget: `maxFailures` rejections per `windowMs`, counted per source. */
export interface SignatureFailureLimit {
  windowMs: number;
  maxFailures: number;
}

/**
 * Ten rejections a minute is generous for a misconfigured sender - GitHub retries a delivery with
 * backoff - and small enough that guessing a 256-bit HMAC is not a strategy.
 */
const DEFAULT_SIGNATURE_FAILURE_LIMIT: SignatureFailureLimit = {
  windowMs: 60_000,
  maxFailures: 10,
};

/**
 * How many sources the budget remembers.
 *
 * **A map keyed by something a stranger chooses is a map a stranger grows.** The route reads
 * `request.ip`, which behind no proxy is the peer address and behind one is header-controlled, so
 * the table is capped and evicts expired entries before live ones. Four thousand entries is a few
 * hundred kilobytes and covers the concurrent senders a single server sees.
 */
const MAX_TRACKED_SOURCES = 4_096;

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

/**
 * Register GitHub webhook receiver endpoint.
 *
 * POST {prefix}/webhook/github — Receive GitHub webhook events.
 *
 * Responds with 200 immediately to satisfy GitHub's 10-second timeout,
 * then processes the payload asynchronously.
 */
export function registerWebhookRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  webhookConfig: WebhookConfig,
): void {
  const prefix = config.apiPrefix;
  const failures = new SignatureFailureBudget(
    webhookConfig.signatureFailureLimit ?? DEFAULT_SIGNATURE_FAILURE_LIMIT,
  );

  app.post(
    `${prefix}/webhook/github`,
    {
      config: { skipAuth: true }, // Webhook has its own signature verification
    },
    async (request: FastifyRequest, reply) => {
      // 0. A source that has spent its failure budget is refused before any HMAC is computed.
      const blockedForSeconds = failures.retryAfterSeconds(request.ip);
      if (blockedForSeconds !== null) {
        void reply.header('Retry-After', blockedForSeconds);
        return reply.status(429).send({
          error: 'TOO_MANY_INVALID_SIGNATURES',
          message: `Too many invalid signatures. Try again in ${blockedForSeconds} seconds.`,
          statusCode: 429,
          retryAfter: blockedForSeconds,
        });
      }

      // 1. Verify webhook signature
      if (webhookConfig.secret) {
        const signature = request.headers['x-hub-signature-256'] as string | undefined;
        if (!verifySignature(webhookConfig.secret, signature, JSON.stringify(request.body))) {
          failures.record(request.ip);
          return reply.status(401).send({
            error: 'INVALID_SIGNATURE',
            message: 'Webhook signature verification failed.',
            statusCode: 401,
          });
        }
        // **A correct signature clears the budget**, because the budget is about guesses and this
        // was not one: a sender that recovers from a rotated secret should not be punished for the
        // window in which it had the old one.
        failures.clear(request.ip);
      }

      // 2. Validate event type header
      const eventType = request.headers['x-github-event'] as string | undefined;
      if (!eventType) {
        return reply.status(400).send({
          error: 'MISSING_EVENT_TYPE',
          message: 'X-GitHub-Event header is required.',
          statusCode: 400,
        });
      }

      // 3. Respond immediately (GitHub timeout: 10 seconds)
      void reply.status(200).send({
        received: true,
        event: eventType,
        deliveryId: request.headers['x-github-delivery'] ?? 'unknown',
        timestamp: new Date().toISOString(),
      });

      // 4. Process payload asynchronously
      try {
        await webhookConfig.handler.process(request.body);
      } catch (err) {
        // Log but don't fail — response already sent
        if (config.logging.enabled) {
          console.error(
            `[code-analyzer] Webhook processing error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    },
  );

  // Health endpoint for webhook status
  app.get(
    `${prefix}/webhook/github/status`,
    {
      config: { skipAuth: true },
    },
    async (_req, reply) => {
      return reply.status(200).send({
        configured: webhookConfig.secret !== undefined,
        eventTypes: ['pull_request'],
        contentType: 'application/json',
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verify HMAC-SHA256 webhook signature.
 * Uses timing-safe comparison to prevent timing attacks.
 */
function verifySignature(
  secret: string,
  signatureHeader: string | undefined,
  payload: string,
): boolean {
  if (!signatureHeader) return false;

  const expectedPrefix = 'sha256=';
  if (!signatureHeader.startsWith(expectedPrefix)) return false;

  const expectedSignature = signatureHeader.slice(expectedPrefix.length);
  const hmac = createHmac('sha256', secret);
  hmac.update(payload, 'utf-8');
  const computedSignature = hmac.digest('hex');

  try {
    return timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(computedSignature, 'hex'),
    );
  } catch {
    return false;
  }
}

/** Exported for testing */
export { verifySignature };

// ---------------------------------------------------------------------------
// Signature failure budget
// ---------------------------------------------------------------------------

/**
 * A sliding count of rejected signatures, per source, with the refusal it earns.
 *
 * **Why a class and not a counter in the route.** The route is registered once and its handler runs
 * for every delivery, so the count has to live outside the handler; and the window has to be read
 * from the same clock for every source, which is what makes two sources' budgets comparable.
 *
 * **Three behaviours are deliberate:**
 *
 * - **Expiry is lazy and per source.** A global timer would keep a process alive and would sweep
 *   sources that stopped sending, which is most of them.
 * - **The first rejection inside a window starts the window**, so a source that fails once an hour
 *   is never refused and a source that fails ten times a minute is.
 * - **`retryAfterSeconds` is computed from the window's end rather than from "now plus a window"**,
 *   because a client that obeys `Retry-After` should arrive after the window it was refused inside.
 */
export class SignatureFailureBudget {
  private readonly bySource = new Map<string, { failures: number; windowEndsAt: number }>();

  constructor(private readonly limit: SignatureFailureLimit) {}

  /** Seconds until `source` may try again, or `null` when it is not over its budget. */
  retryAfterSeconds(source: string, now = Date.now()): number | null {
    const entry = this.bySource.get(source);
    if (!entry) return null;
    if (now >= entry.windowEndsAt) {
      this.bySource.delete(source);
      return null;
    }
    if (entry.failures < this.limit.maxFailures) return null;
    return Math.max(1, Math.ceil((entry.windowEndsAt - now) / 1000));
  }

  /** Count one rejection, starting the window when this is the first one inside it. */
  record(source: string, now = Date.now()): void {
    const entry = this.bySource.get(source);

    if (!entry || now >= entry.windowEndsAt) {
      this.evictIfFull(now);
      this.bySource.set(source, { failures: 1, windowEndsAt: now + this.limit.windowMs });
      return;
    }

    entry.failures += 1;
  }

  /** Forget a source, because it presented a signature that verified. */
  clear(source: string): void {
    this.bySource.delete(source);
  }

  /** How many sources are tracked. Read by the tests that assert the table is bounded. */
  get trackedSources(): number {
    return this.bySource.size;
  }

  /**
   * Make room for one more source.
   *
   * **Expired entries first, then the entry closest to expiring**, because the ordering inside a
   * window carries no information the budget uses - only whether a source is over its limit does.
   */
  private evictIfFull(now: number): void {
    if (this.bySource.size < MAX_TRACKED_SOURCES) return;

    for (const [source, entry] of this.bySource) {
      if (now >= entry.windowEndsAt) this.bySource.delete(source);
    }
    if (this.bySource.size < MAX_TRACKED_SOURCES) return;

    let soonestSource: string | null = null;
    let soonestEnd = Number.POSITIVE_INFINITY;
    for (const [source, entry] of this.bySource) {
      if (entry.windowEndsAt < soonestEnd) {
        soonestEnd = entry.windowEndsAt;
        soonestSource = source;
      }
    }
    if (soonestSource !== null) this.bySource.delete(soonestSource);
  }
}
