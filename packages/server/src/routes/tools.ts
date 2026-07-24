// @code-analyzer/server — Tools Routes
// MCP tool listing and invocation via REST API.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../server-config.js';
import type { ToolRegistry } from '@code-analyzer/mcp';

/** Schema for tool call request body. */
interface ToolCallBody {
  tool: string;
  args?: Record<string, unknown>;
  store?: unknown;
}

/** Schema for tool list response item. */
interface ToolListItem {
  name: string;
  description: string;
  category: string;
}

/**
 * Register tool-related API routes.
 * GET  {prefix}/tools/list  — list all registered tools
 * POST {prefix}/tools/call  — invoke a specific tool
 */
export function registerToolRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  getRegistry: () => ToolRegistry,
): void {
  const prefix = config.apiPrefix;

  // GET /tools/list — list all available tools with metadata
  app.get(`${prefix}/tools/list`, async (_req, reply) => {
    const registry = getRegistry();
    const tools = registry.list();
    const items: ToolListItem[] = tools.map((t: { name: string; description: string; profile: string }) => ({
      name: t.name,
      description: t.description,
      category: t.profile,
    }));

    return reply.status(200).send({
      total: items.length,
      tools: items,
    });
  });

  // POST /tools/call — invoke a named tool with arguments
  app.post(`${prefix}/tools/call`, async (request: FastifyRequest, reply) => {
    const body = request.body as ToolCallBody;

    if (!body || typeof body.tool !== 'string' || body.tool.length === 0) {
      return reply.status(400).send({
        error: 'INVALID_REQUEST',
        message: 'Request body must include a "tool" field with the tool name.',
        statusCode: 400,
      });
    }

    const registry = getRegistry();
    const tool = registry.list().find((t: { name: string }) => t.name === body.tool);
    if (!tool) {
      return reply.status(404).send({
        error: 'TOOL_NOT_FOUND',
        message: `Tool "${body.tool}" not found. Use GET ${prefix}/tools/list to see available tools.`,
        statusCode: 404,
      });
    }

    try {
      const result = await registry.execute(body.tool, body.args ?? {}, body.store);
      return reply.status(200).send({
        tool: body.tool,
        success: !result.isError,
        isError: result.isError ?? false,
        content: result.content,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({
        error: 'TOOL_EXECUTION_FAILED',
        message,
        tool: body.tool,
        statusCode: 500,
      });
    }
  });
}
