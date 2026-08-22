// @code-analyzer/server — GitHub Webhook Routes
// Accept GitHub webhook events and route them through the cross-repo review pipeline.
// Verifies HMAC signatures and responds within GitHub's 10-second requirement.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../server-config.js';

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
}

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

  app.post(
    `${prefix}/webhook/github`,
    {
      config: { skipAuth: true }, // Webhook has its own signature verification
    },
    async (request: FastifyRequest, reply) => {
      // 1. Verify webhook signature
      if (webhookConfig.secret) {
        const signature = request.headers['x-hub-signature-256'] as string | undefined;
        if (!verifySignature(webhookConfig.secret, signature, JSON.stringify(request.body))) {
          return reply.status(401).send({
            error: 'INVALID_SIGNATURE',
            message: 'Webhook signature verification failed.',
            statusCode: 401,
          });
        }
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
            `[code-analyzer] Webhook processing error: ${err instanceof Error ? err.message : /* v8 ignore next */ String(err)}`,
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
