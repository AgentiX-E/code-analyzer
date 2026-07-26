// @code-analyzer/server — Package Entry
// HTTP REST API + SSE MCP server for remote code analysis.

export { createServer } from './http-server.js';
export type { ServerOptions, ServerInstance } from './http-server.js';
export { resolveConfig, DEFAULT_CONFIG } from './server-config.js';
export type {
  ServerConfig,
  CorsConfig,
  AuthConfig,
  LoggingConfig,
  ServerMetadata,
} from './server-config.js';
export type { ErrorResponse } from './middleware/error-handler.js';
export { registerRateLimit } from './middleware/rate-limit.js';
export type { RateLimitConfig } from './middleware/rate-limit.js';
export { registerWebhookRoutes, verifySignature } from './routes/webhook.js';
export type { WebhookHandler, WebhookConfig } from './routes/webhook.js';
