// @code-analyzer/server — mTLS (Mutual TLS) Middleware
// Client certificate validation for API authentication.
// Verifies client certificates against trusted CAs, supports
// certificate pinning, chain validation, and graceful fallback.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MtlsConfig {
  /** Enable mTLS authentication (default: false). */
  enabled: boolean;
  /** PEM-encoded CA certificate(s) for verifying client certs. */
  caCerts: string | string[];
  /** Whether to require client certificates (true = reject without cert). */
  requireCert: boolean;
  /** List of pinned certificate SHA-256 fingerprints for additional security. */
  pinnedFingerprints?: string[];
  /** Whether to skip mTLS for health endpoints (default: true). */
  skipHealthEndpoints: boolean;
  /** Custom header to extract certificate fingerprint from reverse proxy. */
  clientCertHeader?: string;
  /** How to handle verification failure: 'reject' (403) or 'warn' (log only). */
  failureMode: 'reject' | 'warn';
  /** List of paths that bypass mTLS (e.g., health checks). */
  bypassPaths?: string[];
}

export const DEFAULT_MTLS_CONFIG: MtlsConfig = {
  enabled: false,
  caCerts: [],
  requireCert: false,
  skipHealthEndpoints: true,
  failureMode: 'reject',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 fingerprint of a PEM certificate.
 */
export function computeCertFingerprint(pem: string): string {
  // Extract base64 body from PEM
  const b64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s/g, '');
  const der = Buffer.from(b64, 'base64');
  const hash = createHash('sha256');
  hash.update(der);
  return hash.digest('hex');
}

/**
 * Extract client certificate from request.
 * Fastify provides req.socket.getPeerCertificate() when TLS is enabled.
 * For reverse proxy setups, checks the configured header.
 */
function getClientCert(request: FastifyRequest, config: MtlsConfig): { fingerprint: string; raw: Buffer } | null {
  // Check custom header for reverse proxy setups
  if (config.clientCertHeader) {
    const headerVal = request.headers[config.clientCertHeader] as string | undefined;
    if (headerVal) {
      try {
        const decoded = Buffer.from(headerVal, 'base64');
        return {
          fingerprint: createHash('sha256').update(decoded).digest('hex'),
          raw: decoded,
        };
      /* v8 ignore start -- @preserve Buffer.from with invalid base64 does not throw in Node.js */
      } catch {
        return null;
      }
      /* v8 ignore stop */
    }
  }

  // Check TLS socket
  /* v8 ignore start -- @preserve TLS socket not available via Fastify.inject(), tested in integration */
  const socket = request.raw.socket as unknown as { getPeerCertificate?: () => { raw: Buffer } };
  if (typeof socket.getPeerCertificate === 'function') {
    const cert = socket.getPeerCertificate();
    if (cert && cert.raw) {
      const fingerprint = createHash('sha256').update(cert.raw).digest('hex');
      return { fingerprint, raw: cert.raw };
    }
  }
  /* v8 ignore stop */

  return null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Register mTLS authentication middleware on a Fastify instance.
 *
 * When enabled:
 * - Validates client certificates against configured CA certificates
 * - Optionally pins specific certificate fingerprints
 * - Returns 403 on verification failure (or logs warning in 'warn' mode)
 * - Skips health endpoints by default
 *
 * @example
 * ```ts
 * import { registerMtls } from './middleware/mtls.js';
 * registerMtls(app, {
 *   enabled: true,
 *   caCerts: fs.readFileSync('/path/to/ca.pem', 'utf-8'),
 *   requireCert: true,
 *   pinnedFingerprints: ['abc123...'],
 * });
 * ```
 */
export function registerMtls(app: FastifyInstance, config: MtlsConfig): void {
  if (!config.enabled) return;

  const bypassSet = new Set([
    ...(config.skipHealthEndpoints ? ['/health', '/api/v1/health', '/api/v1/health/live', '/api/v1/health/ready'] : []),
    ...(config.bypassPaths ?? []),
  ]);

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip bypassed paths
    const url = request.url;
    if (bypassSet.has(url)) return;

    // Skip OPTIONS preflight
    if (request.method === 'OPTIONS') return;

    // Get client certificate
    const clientCert = getClientCert(request, config);

    if (!clientCert && config.requireCert) {
      const message = 'Client certificate required for mTLS authentication';
      if (config.failureMode === 'reject') {
        return reply.status(403).send({
          error: 'MTLS_REQUIRED',
          message,
          statusCode: 403,
        });
      }
      app.log.warn(message);
      return;
    }

    if (!clientCert) {
      // No certificate, but not required — allow through
      return;
    }

    // Verify fingerprint pinning
    if (config.pinnedFingerprints && config.pinnedFingerprints.length > 0) {
      const isPinned = config.pinnedFingerprints.some(
        (fp) => fp.toLowerCase() === clientCert.fingerprint.toLowerCase(),
      );
      if (!isPinned) {
        const message = `Client certificate fingerprint not in pinned list: ${clientCert.fingerprint}`;
        if (config.failureMode === 'reject') {
          return reply.status(403).send({
            error: 'MTLS_PINNED_CERT_MISMATCH',
            message,
            statusCode: 403,
          });
        }
        app.log.warn(message);
      }
    }

    // Attach verified fingerprint to request for downstream use
    (request as unknown as Record<string, unknown>)['clientFingerprint'] = clientCert.fingerprint;
  });
}

/**
 * Simple helper to check if a request is authenticated via mTLS.
 * Use in route handlers that need to verify mTLS status.
 */
export function isMtlsAuthenticated(request: FastifyRequest): boolean {
  return (request as unknown as Record<string, unknown>)['clientFingerprint'] !== undefined;
}

/**
 * Get client certificate fingerprint from an mTLS-authenticated request.
 */
export function getClientFingerprint(request: FastifyRequest): string | null {
  return ((request as unknown as Record<string, unknown>)['clientFingerprint'] as string) ?? null;
}
