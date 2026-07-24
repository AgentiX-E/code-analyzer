// @code-analyzer/server — Error Handler Middleware
// Global error handler that serializes errors consistently.

import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/** Standard error response shape. */
export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  requestId?: string;
  details?: unknown;
}

/**
 * Register global error handler on a Fastify instance.
 * Catches all unhandled errors and returns a consistent JSON response.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      const statusCode = error.statusCode ?? 500;
      const requestId = request.id;

      // Log the error internally
      if (statusCode >= 500) {
        app.log.error(
          { err: error, requestId, url: request.url, method: request.method },
          'Unhandled server error',
        );
      }

      const response: ErrorResponse = {
        error: error.code ?? 'INTERNAL_ERROR',
        message: statusCode >= 500
          ? 'Internal server error'
          : error.message,
        statusCode,
        ...(requestId ? { requestId } : {}),
      };

      // In debug mode, include validation details
      if (error.validation && process.env['NODE_ENV'] === 'development') {
        response.details = error.validation;
      }

      return reply.status(statusCode).send(response);
    },
  );

  // 404 handler
  app.setNotFoundHandler(
    (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `Route ${_request.method} ${_request.url} not found`,
        statusCode: 404,
      } satisfies ErrorResponse);
    },
  );
}
