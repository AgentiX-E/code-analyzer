// @code-analyzer/server — Server Config Tests

import { describe, it, expect } from 'vitest';
import { resolveConfig, DEFAULT_CONFIG } from '../server-config.js';
import type { ServerConfig } from '../server-config.js';

describe('resolveConfig', () => {
  it('should return defaults when no overrides provided', () => {
    const config = resolveConfig();
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(3000);
    expect(config.apiPrefix).toBe('/api/v1');
    expect(config.auth.enabled).toBe(false);
    expect(config.cors.origin).toBe('*');
  });

  it('should return defaults when undefined is provided', () => {
    const config = resolveConfig(undefined as unknown as Partial<ServerConfig>);
    expect(config.port).toBe(3000);
  });

  it('should override top-level fields', () => {
    const config = resolveConfig({ port: 8080, host: '127.0.0.1' });
    expect(config.port).toBe(8080);
    expect(config.host).toBe('127.0.0.1');
    expect(config.apiPrefix).toBe('/api/v1'); // unchanged
  });

  it('should deep-merge nested objects', () => {
    const config = resolveConfig({
      cors: { origin: 'https://example.com' },
    });
    expect(config.cors.origin).toBe('https://example.com');
    expect(config.cors.methods).toEqual(DEFAULT_CONFIG.cors.methods); // unchanged
    expect(config.cors.credentials).toBe(false);
  });

  it('should deep-merge auth config', () => {
    const config = resolveConfig({
      auth: { enabled: true, apiKeys: ['key1', 'key2'] },
    });
    expect(config.auth.enabled).toBe(true);
    expect(config.auth.apiKeys).toEqual(['key1', 'key2']);
    expect(config.auth.headerName).toBe('x-api-key'); // unchanged
  });

  it('should deep-merge logging config', () => {
    const config = resolveConfig({
      logging: { level: 'debug', pretty: true },
    });
    expect(config.logging.level).toBe('debug');
    expect(config.logging.pretty).toBe(true);
    expect(config.logging.enabled).toBe(true); // unchanged
  });

  it('should deep-merge metadata', () => {
    const config = resolveConfig({
      metadata: { name: 'custom-name', version: '2.0.0' },
    });
    expect(config.metadata.name).toBe('custom-name');
    expect(config.metadata.version).toBe('2.0.0');
    expect(config.metadata.environment).toBe('production'); // unchanged
  });

  it('should override maxBodySize and timeouts', () => {
    const config = resolveConfig({
      maxBodySize: 5000,
      keepAliveTimeout: 30000,
      sseHeartbeatMs: 5000,
    });
    expect(config.maxBodySize).toBe(5000);
    expect(config.keepAliveTimeout).toBe(30000);
    expect(config.sseHeartbeatMs).toBe(5000);
  });

  it('should not mutate the default config', () => {
    const originalPort = DEFAULT_CONFIG.port;
    resolveConfig({ port: 9999 });
    expect(DEFAULT_CONFIG.port).toBe(originalPort);
  });

  it('should return a new object each call', () => {
    const c1 = resolveConfig();
    const c2 = resolveConfig();
    expect(c1).not.toBe(c2);
    // cors is a plain spread clone, should be different reference
    expect(Object.is(c1.cors, c2.cors)).toBe(false);
  });

  it('should deep-merge rateLimit config', () => {
    const config = resolveConfig({
      rateLimit: { enabled: true, maxRequests: 50 },
    });
    expect(config.rateLimit.enabled).toBe(true);
    expect(config.rateLimit.maxRequests).toBe(50);
    expect(config.rateLimit.windowMs).toBe(60_000); // unchanged
    expect(config.rateLimit.addHeaders).toBe(true); // unchanged
  });

  it('should deep-merge mtls config', () => {
    const config = resolveConfig({
      mtls: { enabled: true, requireCert: true, failureMode: 'warn' },
    });
    expect(config.mtls.enabled).toBe(true);
    expect(config.mtls.requireCert).toBe(true);
    expect(config.mtls.failureMode).toBe('warn');
    expect(config.mtls.skipHealthEndpoints).toBe(true); // unchanged
  });

  it('should override maxConnections', () => {
    const config = resolveConfig({ maxConnections: 100 });
    expect(config.maxConnections).toBe(100);
  });

  it('should handle empty overrides object', () => {
    const config = resolveConfig({});
    expect(config.port).toBe(3000);
    expect(config.apiPrefix).toBe('/api/v1');
  });
});

describe('DEFAULT_CONFIG', () => {
  it('should have all required fields', () => {
    expect(DEFAULT_CONFIG.host).toBeDefined();
    expect(DEFAULT_CONFIG.port).toBeDefined();
    expect(DEFAULT_CONFIG.apiPrefix).toBeDefined();
    expect(DEFAULT_CONFIG.cors).toBeDefined();
    expect(DEFAULT_CONFIG.auth).toBeDefined();
    expect(DEFAULT_CONFIG.logging).toBeDefined();
    expect(DEFAULT_CONFIG.rateLimit).toBeDefined();
    expect(DEFAULT_CONFIG.metadata).toBeDefined();
    expect(DEFAULT_CONFIG.maxBodySize).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.maxConnections).toBe(0);
  });

  it('should have default auth disabled', () => {
    expect(DEFAULT_CONFIG.auth.enabled).toBe(false);
    expect(DEFAULT_CONFIG.auth.apiKeys).toEqual([]);
  });

  it('should have default cors set to open', () => {
    expect(DEFAULT_CONFIG.cors.origin).toBe('*');
    expect(DEFAULT_CONFIG.cors.methods).toContain('GET');
    expect(DEFAULT_CONFIG.cors.methods).toContain('POST');
  });

  it('should have correct host default', () => {
    expect(DEFAULT_CONFIG.host).toBe('0.0.0.0');
  });

  it('should have correct port default', () => {
    expect(DEFAULT_CONFIG.port).toBe(3000);
  });

  it('should have correct apiPrefix default', () => {
    expect(DEFAULT_CONFIG.apiPrefix).toBe('/api/v1');
  });

  it('should have correct cors sub-fields', () => {
    expect(DEFAULT_CONFIG.cors.allowedHeaders).toContain('Content-Type');
    expect(DEFAULT_CONFIG.cors.allowedHeaders).toContain('Authorization');
    expect(DEFAULT_CONFIG.cors.exposedHeaders).toContain('x-request-id');
    expect(DEFAULT_CONFIG.cors.credentials).toBe(false);
    expect(DEFAULT_CONFIG.cors.maxAge).toBe(86400);
  });

  it('should have correct auth sub-fields', () => {
    expect(DEFAULT_CONFIG.auth.headerName).toBe('x-api-key');
    expect(DEFAULT_CONFIG.auth.apiKeys).toEqual([]);
    expect(DEFAULT_CONFIG.auth.enabled).toBe(false);
  });

  it('should have correct logging sub-fields', () => {
    expect(DEFAULT_CONFIG.logging.enabled).toBe(true);
    expect(DEFAULT_CONFIG.logging.level).toBe('info');
    expect(DEFAULT_CONFIG.logging.includeBody).toBe(false);
    expect(DEFAULT_CONFIG.logging.pretty).toBe(false);
  });

  it('should have correct rateLimit sub-fields', () => {
    expect(DEFAULT_CONFIG.rateLimit.enabled).toBe(false);
    expect(DEFAULT_CONFIG.rateLimit.windowMs).toBe(60_000);
    expect(DEFAULT_CONFIG.rateLimit.maxRequests).toBe(100);
    expect(DEFAULT_CONFIG.rateLimit.addHeaders).toBe(true);
  });

  it('should have correct mtls sub-fields', () => {
    expect(DEFAULT_CONFIG.mtls.enabled).toBe(false);
    expect(DEFAULT_CONFIG.mtls.requireCert).toBe(false);
    expect(DEFAULT_CONFIG.mtls.skipHealthEndpoints).toBe(true);
    expect(DEFAULT_CONFIG.mtls.failureMode).toBe('reject');
  });

  it('should have correct metadata sub-fields', () => {
    expect(DEFAULT_CONFIG.metadata.name).toBe('code-analyzer');
    expect(DEFAULT_CONFIG.metadata.version).toBe('0.1.0');
    expect(DEFAULT_CONFIG.metadata.environment).toBe('production');
  });

  it('should have correct numeric defaults', () => {
    expect(DEFAULT_CONFIG.maxBodySize).toBe(1_048_576);
    expect(DEFAULT_CONFIG.keepAliveTimeout).toBe(61_000);
    expect(DEFAULT_CONFIG.sseHeartbeatMs).toBe(15_000);
    expect(DEFAULT_CONFIG.maxConnections).toBe(0);
  });
});
