// @code-analyzer/server — mTLS Middleware Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  registerMtls,
  computeCertFingerprint,
  isMtlsAuthenticated,
  DEFAULT_MTLS_CONFIG,
} from '../middleware/mtls.js';
import type { MtlsConfig } from '../middleware/mtls.js';

// ---------------------------------------------------------------------------
// Self-signed cert for testing (generated with openssl)
// These are test-only certificates — not valid for any real purpose.
// ---------------------------------------------------------------------------

const TEST_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUZzH4sx8qJ0mYxXxPqA3lNVw7pH0wDQYJKoZIhvcNAQEL
BQAwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM
GEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0yNjA3MjYwODAwMDBaFw0yNzA3
MjYwODAwMDBaMEUxCzAJBgNVBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEw
HwYDVQQKDBhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQC7nPJK0xL8qR0Z0VwYOwITKmXPHRxrWQZoZIFPOJVT
qkQxNkORiLsB5Rg8EMtOkM9oFRLxPvxh0JLkhZKMIJaA2Q1mHlLYyEPWkRRZRIaa
KIBPWLmDzDNcKqJNVUcYFqLSdYLHKggWtJUbZBEewNWWAFVoXjHhoBDMrCCsMbrK
hYMVnIWNiykqESLOKPJPkJMrKoOsPlhzWXILzK2igxxgrQRlEEMnKAQmsGJVRQoA
uNRRNbKJglCSwPWSkSqNROHobTQjCFSAivzEmKlJFjQZGxKZXjqQECBjMBEPcIuw
nIaiiFQGKzADiDSSKKgdQjdKRXCeZHnBWoAFBIIMkDAgMBAAGjUzBRMB0GA1Ud
DgQWBBTnOTKLqGdENsUGGhLQqEgSaRRPajAfBgNVHSMEGDAWgBTnOTKLqGdENsUG
GhLQqEgSaRRPajAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBr
MTlMKjWxO3GRsEYJUqFQFQYNXpxCZKkNAmdFgDhMzVxEgKNOEwnkQxdhBYVHQMSm
kWFnBEBcTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBm
TXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBmTXBm
TXBmTXBmTXBmTXBmTXBmg==
-----END CERTIFICATE-----`;

// A valid SHA-256 fingerprint for testing
const TEST_FINGERPRINT = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

// ---------------------------------------------------------------------------
// computeCertFingerprint
// ---------------------------------------------------------------------------

describe('computeCertFingerprint', () => {
  it('should compute a 64-char hex fingerprint', () => {
    // Use a minimal self-signed cert
    const minimalPem = `-----BEGIN CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUZzH4sx8qJ0mYxXxPqA3lNVw7pH0wDQYJKoZIhvcNAQEL
BQAwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM
GEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0yNjA3MjYwODAwMDBaFw0yNzA3
MjYwODAwMDBaMEUxCzAJBgNVBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEw
HwYDVQQKDBhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQC7nPJK0xL8qR0Z0VwYOwITKmXPHRxrWQZoZIFPOJVT
qkQxNkORiLsB5Rg8EMtOkM9oFRLxPvxh0JLkhZKMIJaA2Q1mHlLYyEPWkRRZRIaa
KIBPWLmDzDNcKqJNVUcYFqLSdYLHKggWtJUbZBEewNWWAFVoXjHhoBDMrCCsMbrK
hYMVnIWNiykqESLOKPJPkJMrKoOsPlhzWXILzK2igxxgrQRlEEMnKAQmsGJVRQoA
uNRRNbKJglCSwPWSkSqNROHobTQjCFSAivzEmKlJFjQZGxKZXjqQECBjMBEPcIuw
nIaiiFQGKzADiDSSKKgdQjdKRXCeZHnBWoAFBIIMkDAgMBAAGjUzBRMB0GA1Ud
DgQWBBTnOTKLqGdENsUGGhLQqEgSaRRPajAfBgNVHSMEGDAWgBTnOTKLqGdENsUG
GhLQqEgSaRRPajAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBr
MTlMKjWxO3GRsEYJUqFQFQYNXpxCZKkNAmdFgDhMzVxEgKNOEwnkQxdhBYVHQMSm
kWFnBEA0DAQAB
-----END CERTIFICATE-----`;

    const fp = computeCertFingerprint(minimalPem);
    expect(fp.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(fp)).toBe(true);
  });

  it('should produce deterministic fingerprints', () => {
    const pem = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHf0VL0MhSLMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNVBAMMCWxv
Y2FsaG9zdDAeFw0yNDAxMDEwMDAwMDBaFw0yNTAxMDEwMDAwMDBaMBQxEjAQBgNV
BAMMCWxvY2FsaG9zdDCBnzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEA0UJieT8z
-----END CERTIFICATE-----`;
    expect(computeCertFingerprint(pem)).toBe(computeCertFingerprint(pem));
  });
});

// ---------------------------------------------------------------------------
// registerMtls — disabled by default
// ---------------------------------------------------------------------------

describe('registerMtls', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('should not enforce mTLS when disabled', async () => {
    app = Fastify({ logger: false });
    registerMtls(app, { ...DEFAULT_MTLS_CONFIG, enabled: false });
    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
  });

  it('should skip health endpoints by default', async () => {
    app = Fastify({ logger: false });
    registerMtls(app, {
      enabled: true,
      caCerts: TEST_CA_PEM,
      requireCert: true,
      failureMode: 'reject',
      skipHealthEndpoints: true,
    });
    app.get('/health', async (_req, reply) => reply.send({ status: 'ok' }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('should skip OPTIONS preflight', async () => {
    app = Fastify({ logger: false });
    registerMtls(app, {
      enabled: true,
      caCerts: TEST_CA_PEM,
      requireCert: true,
      failureMode: 'reject',
    });
    app.options('/test', async (_req, reply) => reply.status(204).send());
    await app.ready();

    const res = await app.inject({ method: 'OPTIONS', url: '/test' });
    expect(res.statusCode).toBe(204);
  });

  it('should allow traffic when requireCert is false and no cert present', async () => {
    app = Fastify({ logger: false });
    registerMtls(app, {
      enabled: true,
      caCerts: TEST_CA_PEM,
      requireCert: false,
      failureMode: 'reject',
    });
    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
  });

  it('should respect custom bypass paths', async () => {
    app = Fastify({ logger: false });
    registerMtls(app, {
      enabled: true,
      caCerts: TEST_CA_PEM,
      requireCert: true,
      failureMode: 'reject',
      bypassPaths: ['/public', '/api/v1/public'],
    });
    app.get('/public', async (_req, reply) => reply.send({ ok: true }));
    app.get('/api/v1/public', async (_req, reply) => reply.send({ ok: true }));
    app.get('/private', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    // Bypassed paths should work
    const res1 = await app.inject({ method: 'GET', url: '/public' });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({ method: 'GET', url: '/api/v1/public' });
    expect(res2.statusCode).toBe(200);

    // Non-bypassed should be rejected (no cert)
    const res3 = await app.inject({ method: 'GET', url: '/private' });
    expect(res3.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// registerMtls — warn mode
// ---------------------------------------------------------------------------

describe('registerMtls — warn mode', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('should allow traffic in warn mode without cert', async () => {
    app = Fastify({ logger: false });
    registerMtls(app, {
      enabled: true,
      caCerts: TEST_CA_PEM,
      requireCert: true,
      failureMode: 'warn',
    });
    app.get('/test', async (_req, reply) => reply.send({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    // In warn mode, traffic is allowed even without cert
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_MTLS_CONFIG
// ---------------------------------------------------------------------------

describe('DEFAULT_MTLS_CONFIG', () => {
  it('should have mTLS disabled by default', () => {
    expect(DEFAULT_MTLS_CONFIG.enabled).toBe(false);
  });

  it('should have requireCert disabled by default', () => {
    expect(DEFAULT_MTLS_CONFIG.requireCert).toBe(false);
  });

  it('should use reject as default failure mode', () => {
    expect(DEFAULT_MTLS_CONFIG.failureMode).toBe('reject');
  });

  it('should skip health endpoints by default', () => {
    expect(DEFAULT_MTLS_CONFIG.skipHealthEndpoints).toBe(true);
  });

  it('should have empty CA certs by default', () => {
    expect(DEFAULT_MTLS_CONFIG.caCerts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MtlsConfig type
// ---------------------------------------------------------------------------

describe('MtlsConfig', () => {
  it('should accept all optional fields', () => {
    const config: MtlsConfig = {
      enabled: true,
      caCerts: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
      requireCert: true,
      pinnedFingerprints: ['abc123', 'def456'],
      skipHealthEndpoints: false,
      clientCertHeader: 'x-client-cert',
      failureMode: 'warn',
      bypassPaths: ['/custom-path'],
    };
    expect(config.enabled).toBe(true);
    expect(config.pinnedFingerprints).toEqual(['abc123', 'def456']);
    expect(config.clientCertHeader).toBe('x-client-cert');
  });

  it('should accept array of CA certs', () => {
    const config: MtlsConfig = {
      enabled: true,
      caCerts: ['-----BEGIN CERTIFICATE-----\nca1\n-----END CERTIFICATE-----', '-----BEGIN CERTIFICATE-----\nca2\n-----END CERTIFICATE-----'],
      requireCert: false,
      failureMode: 'reject',
      skipHealthEndpoints: true,
    };
    expect(Array.isArray(config.caCerts)).toBe(true);
    expect(config.caCerts.length).toBe(2);
  });
});
