// @code-analyzer/server — GitHub Webhook Handler
// Verifies webhook signatures, parses event types, routes events to handlers.
// Implements idempotency via X-GitHub-Delivery header.

import { createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookEvent {
  eventType: string;
  deliveryId: string;
  payload: Record<string, unknown>;
  signature: string;
  rawBody: string;
}

export interface WebhookHandlerConfig {
  /** Shared secret for HMAC-SHA256 verification */
  secret: string;
  /** Optional list of allowed event types. Empty means all allowed. */
  allowedEvents?: string[];
}

export interface EventHandler {
  /** Handle a specific webhook event type */
  handle(event: WebhookEvent): Promise<void>;
}

export interface WebhookProcessResult {
  deliveryId: string;
  eventType: string;
  success: boolean;
  error?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// GitHubWebhookHandler
// ---------------------------------------------------------------------------

export class GitHubWebhookHandler {
  private eventHandlers = new Map<string, EventHandler[]>();
  private processedDeliveries = new Set<string>();
  private config: WebhookHandlerConfig;

  constructor(config: WebhookHandlerConfig) {
    this.config = config;
  }

  /**
   * Register an event handler for a specific event type.
   * Multiple handlers can be registered for the same event.
   */
  on(eventType: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(eventType, handlers);
  }

  /**
   * Process an incoming webhook request.
   * Verifies signature, validates event type, checks idempotency,
   * and dispatches to registered handlers.
   */
  async process(
    eventType: string,
    deliveryId: string,
    signature: string,
    rawBody: string,
  ): Promise<WebhookProcessResult> {
    // 1. Verify signature
    if (!this.verifySignature(signature, rawBody)) {
      return {
        deliveryId,
        eventType,
        success: false,
        error: 'Invalid webhook signature',
        timestamp: new Date().toISOString(),
      };
    }

    // 2. Validate event type
    if (!eventType) {
      return {
        deliveryId,
        eventType: 'unknown',
        success: false,
        error: 'Missing event type header',
        timestamp: new Date().toISOString(),
      };
    }

    // 3. Check allowed events
    if (
      this.config.allowedEvents &&
      this.config.allowedEvents.length > 0 &&
      !this.config.allowedEvents.includes(eventType)
    ) {
      return {
        deliveryId,
        eventType,
        success: false,
        error: `Event type "${eventType}" is not in the allowed list`,
        timestamp: new Date().toISOString(),
      };
    }

    // 4. Idempotency check
    if (this.processedDeliveries.has(deliveryId)) {
      return {
        deliveryId,
        eventType,
        success: true, // Already processed successfully
        timestamp: new Date().toISOString(),
      };
    }

    // 5. Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return {
        deliveryId,
        eventType,
        success: false,
        error: 'Invalid JSON payload',
        timestamp: new Date().toISOString(),
      };
    }

    // 6. Build event
    const event: WebhookEvent = {
      eventType,
      deliveryId,
      payload,
      signature,
      rawBody,
    };

    // 7. Dispatch to handlers
    const handlers = this.eventHandlers.get(eventType) ?? [];
    let success = true;

    for (const handler of handlers) {
      try {
        await handler.handle(event);
      } catch (err) {
        success = false;
        // Continue processing other handlers even if one fails
      }
    }

    // 8. Mark as processed
    this.processedDeliveries.add(deliveryId);

    return {
      deliveryId,
      eventType,
      success,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Verify HMAC-SHA256 webhook signature.
   */
  verifySignature(signatureHeader: string, payload: string): boolean {
    if (!signatureHeader) return false;
    if (!this.config.secret) return true; // No secret configured = skip verification

    const expectedPrefix = 'sha256=';
    if (!signatureHeader.startsWith(expectedPrefix)) return false;

    const expectedSignature = signatureHeader.slice(expectedPrefix.length);
    const hmac = createHmac('sha256', this.config.secret);
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

  /**
   * Clear the processed deliveries cache (for testing).
   */
  clearCache(): void {
    this.processedDeliveries.clear();
  }

  /**
   * Get the number of cached deliveries.
   */
  get cacheSize(): number {
    return this.processedDeliveries.size;
  }

  /**
   * Get registered event types.
   */
  getRegisteredEvents(): string[] {
    return Array.from(this.eventHandlers.keys());
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub webhook event from request headers and body.
 */
export function parseWebhookEvent(
  headers: Record<string, string | string[] | undefined>,
  body: string,
): { eventType: string; deliveryId: string; signature: string } | null {
  const eventType = getHeader(headers, 'x-github-event');
  const deliveryId = getHeader(headers, 'x-github-delivery');
  const signature = getHeader(headers, 'x-hub-signature-256');

  if (!eventType) return null;

  return {
    eventType,
    deliveryId: deliveryId ?? 'unknown',
    signature: signature ?? '',
  };
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  // Try exact match first, then case-insensitive
  if (headers[name] !== undefined) {
    const val = headers[name];
    return Array.isArray(val) ? val[0] : val;
  }
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return Array.isArray(val) ? val[0] : val;
    }
  }
  return undefined;
}
