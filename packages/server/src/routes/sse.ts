// @code-analyzer/server — SSE Transport
// Server-Sent Events transport for MCP protocol and real-time streaming.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerConfig } from '../server-config.js';
import type { ToolRegistry } from '@code-analyzer/mcp';

/** Active SSE connections tracked for cleanup. */
interface SSEConnection {
  reply: FastifyReply;
  requestId: string;
  connectedAt: number;
}

/**
 * Register SSE endpoint for MCP streaming transport.
 * GET {prefix}/sse — open SSE connection
 * POST {prefix}/sse/event — send an event (tool call request)
 */
export function registerSSERoutes(
  app: FastifyInstance,
  config: ServerConfig,
  getRegistry: () => ToolRegistry,
): void {
  const prefix = config.apiPrefix;
  const connections = new Map<string, SSEConnection>();
  const heartbeatMs = config.sseHeartbeatMs;

  // SSE connection endpoint
  app.get(`${prefix}/sse`, async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection event
    sendSSEEvent(reply.raw, 'connected', {
      requestId,
      timestamp: new Date().toISOString(),
      message: 'SSE connection established. Send tool calls via POST /api/v1/sse/event',
    });

    // Register connection
    const connection: SSEConnection = {
      reply,
      requestId,
      connectedAt: Date.now(),
    };
    connections.set(requestId, connection);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        sendSSEEvent(reply.raw, 'ping', { timestamp: Date.now() });
      } catch {
        clearInterval(heartbeat);
        connections.delete(requestId);
      }
    }, heartbeatMs);

    // Clean up on connection close
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      connections.delete(requestId);
    });

    // Don't close the reply — keep the connection open
    return reply;
  });

  // Event posting endpoint — MCP clients POST tool calls here
  app.post(`${prefix}/sse/event`, async (request: FastifyRequest, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    const requestId = body?.['requestId'] as string | undefined;
    const toolName = body?.['tool'] as string | undefined;
    const args = (body?.['args'] ?? {}) as Record<string, unknown>;

    // Validate required fields
    if (!toolName || typeof toolName !== 'string') {
      return reply.status(400).send({
        error: 'INVALID_REQUEST',
        message: 'Event must include a "tool" field.',
        statusCode: 400,
      });
    }

    // Execute the tool
    const registry = getRegistry();
    let result;
    try {
      result = await registry.execute(toolName, args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = {
        content: [{ type: 'text', text: `Tool execution error: ${message}` }],
        isError: true,
      };
    }

    const eventData = {
      tool: toolName,
      success: !result.isError,
      content: result.content,
      timestamp: new Date().toISOString(),
    };

    // If a specific requestId is provided, send event to that SSE connection
    if (requestId && connections.has(requestId)) {
      const conn = connections.get(requestId)!;
      try {
        sendSSEEvent(conn.reply.raw, 'tool_result', eventData);
      } catch {
        connections.delete(requestId);
      }
    }

    // Also broadcast to all connected SSE clients
    for (const [id, conn] of connections) {
      if (id === requestId) continue; // already sent to specific connection
      try {
        sendSSEEvent(conn.reply.raw, 'tool_result', eventData);
      } catch {
        connections.delete(id);
      }
    }

    return reply.status(200).send({
      processed: true,
      broadcastTo: connections.size,
      result: eventData,
    });
  });

  // SSE connection count endpoint
  app.get(`${prefix}/sse/connections`, async (_req, reply) => {
    return reply.status(200).send({
      activeConnections: connections.size,
      connections: [...connections.entries()].map(([id, conn]) => ({
        requestId: id,
        connectedAt: new Date(conn.connectedAt).toISOString(),
        durationMs: Date.now() - conn.connectedAt,
      })),
    });
  });
}

/**
 * Send a Server-Sent Event to a raw response stream.
 */
function sendSSEEvent(
  res: NodeJS.WritableStream & { write: (chunk: string) => boolean },
  event: string,
  data: unknown,
): void {
  const lines = [
    `event: ${event}`,
    `data: ${JSON.stringify(data)}`,
    '', // Blank line signals end of event
    '', // Extra blank line for separation
  ];
  res.write(lines.join('\n'));
}

/** Exported for testing */
export { sendSSEEvent };
