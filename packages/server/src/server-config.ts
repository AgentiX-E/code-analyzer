// @code-analyzer/server — Server Configuration
// Configuration types and defaults for the HTTP + SSE MCP server.

/** Full server configuration. All fields have sensible defaults. */
export interface ServerConfig {
  /** Host to bind to (default: '0.0.0.0') */
  host: string;
  /** Port to listen on (default: 3000) */
  port: number;
  /** API prefix for all routes (default: '/api/v1') */
  apiPrefix: string;
  /** CORS configuration */
  cors: CorsConfig;
  /** Authentication configuration */
  auth: AuthConfig;
  /** Logging configuration */
  logging: LoggingConfig;
  /** Server metadata returned by /health */
  metadata: ServerMetadata;
  /** Maximum request body size in bytes (default: 1MB) */
  maxBodySize: number;
  /** Connection keep-alive timeout in ms (default: 61000) */
  keepAliveTimeout: number;
  /** SSE heartbeat interval in ms (default: 15000) */
  sseHeartbeatMs: number;
}

export interface CorsConfig {
  /** Allowed origins. '*' means all. Use array for specific origins. */
  origin: string | string[];
  /** Allowed HTTP methods */
  methods: string[];
  /** Allowed request headers */
  allowedHeaders: string[];
  /** Whether to expose headers to the client */
  exposedHeaders: string[];
  /** Whether credentials are allowed */
  credentials: boolean;
  /** Preflight cache duration in seconds */
  maxAge: number;
}

export interface AuthConfig {
  /** Whether authentication is enabled */
  enabled: boolean;
  /** API keys that are allowed access (header: x-api-key) */
  apiKeys: string[];
  /** Header name for API key (default: 'x-api-key') */
  headerName: string;
}

export interface LoggingConfig {
  /** Whether request logging is enabled */
  enabled: boolean;
  /** Log level: 'silent' | 'error' | 'warn' | 'info' | 'debug' */
  level: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  /** Whether to include request body in logs */
  includeBody: boolean;
  /** Whether to pretty-print logs */
  pretty: boolean;
}

export interface ServerMetadata {
  /** Server name */
  name: string;
  /** Server version */
  version: string;
  /** Environment description */
  environment: string;
}

/** Default server configuration. Override via createServer() options. */
export const DEFAULT_CONFIG: ServerConfig = {
  host: '0.0.0.0',
  port: 3000,
  apiPrefix: '/api/v1',
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    exposedHeaders: ['x-request-id', 'x-response-time'],
    credentials: false,
    maxAge: 86400,
  },
  auth: {
    enabled: false,
    apiKeys: [],
    headerName: 'x-api-key',
  },
  logging: {
    enabled: true,
    level: 'info',
    includeBody: false,
    pretty: false,
  },
  metadata: {
    name: 'code-analyzer',
    version: '0.1.0',
    environment: 'production',
  },
  maxBodySize: 1_048_576,
  keepAliveTimeout: 61_000,
  sseHeartbeatMs: 15_000,
};

/**
 * Merge user-provided config with defaults. Deep merges nested objects.
 */
export function resolveConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  if (!overrides) {
    return {
      ...DEFAULT_CONFIG,
      cors: { ...DEFAULT_CONFIG.cors },
      auth: { ...DEFAULT_CONFIG.auth },
      logging: { ...DEFAULT_CONFIG.logging },
      metadata: { ...DEFAULT_CONFIG.metadata },
    };
  }

  return {
    host: overrides.host ?? DEFAULT_CONFIG.host,
    port: overrides.port ?? DEFAULT_CONFIG.port,
    apiPrefix: overrides.apiPrefix ?? DEFAULT_CONFIG.apiPrefix,
    cors: overrides.cors
      ? { ...DEFAULT_CONFIG.cors, ...overrides.cors }
      : { ...DEFAULT_CONFIG.cors },
    auth: overrides.auth
      ? { ...DEFAULT_CONFIG.auth, ...overrides.auth }
      : { ...DEFAULT_CONFIG.auth },
    logging: overrides.logging
      ? { ...DEFAULT_CONFIG.logging, ...overrides.logging }
      : { ...DEFAULT_CONFIG.logging },
    metadata: overrides.metadata
      ? { ...DEFAULT_CONFIG.metadata, ...overrides.metadata }
      : { ...DEFAULT_CONFIG.metadata },
    maxBodySize: overrides.maxBodySize ?? DEFAULT_CONFIG.maxBodySize,
    keepAliveTimeout: overrides.keepAliveTimeout ?? DEFAULT_CONFIG.keepAliveTimeout,
    sseHeartbeatMs: overrides.sseHeartbeatMs ?? DEFAULT_CONFIG.sseHeartbeatMs,
  };
}
