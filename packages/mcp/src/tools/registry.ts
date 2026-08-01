// @code-analyzer/mcp — Tool Registry
// Central registry for MCP tools with profile-based filtering and execution.

import type { ToolDefinition, ToolProfile } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Tool Result Types
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: Array<{
    type: 'text' | 'resource';
    text?: string;
    resource?: { uri: string; mimeType?: string; text: string };
  }>;
  isError?: boolean;
}

export interface PaginatedToolResult<T> {
  items: T[];
  total: number;
  returned: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Tool Handler
// ---------------------------------------------------------------------------

export type ToolHandler = (args: Record<string, unknown>, store?: unknown) => Promise<ToolResult>;

export interface RegisteredTool extends ToolDefinition {
  handler: ToolHandler;
  profile: ToolProfile;
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  /** Register a tool with its handler and profile. */
  register(name: string, description: string, inputSchema: Record<string, unknown>, handler: ToolHandler, profile: ToolProfile = 'all'): void {
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`);
    }
    this.tools.set(name, {
      name,
      description,
      inputSchema,
      handler,
      profile,
    });
  }

  /** Get a tool by name. */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /** List all registered tool definitions (without handlers). */
  list(): Array<ToolDefinition & { profile: ToolProfile }> {
    return Array.from(this.tools.values()).map(({ name, description, inputSchema, profile }) => ({
      name,
      description,
      inputSchema,
      profile,
    }));
  }

  /** List tools filtered by profile ('all' returns everything). */
  listByProfile(profile: ToolProfile): Array<ToolDefinition & { profile: ToolProfile }> {
    return Array.from(this.tools.values())
      .filter((t) => profile === 'all' || t.profile === 'all' || t.profile === profile)
      .map(({ name, description, inputSchema, profile: p }) => ({
        name,
        description,
        inputSchema,
        profile: p,
      }));
  }

  /** Execute a tool by name with the given arguments. */
  async execute(name: string, args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Error: Tool "${name}" not found` }],
        isError: true,
      };
    }

    try {
      // Validate required arguments
      const validationError = validateArgs(args, tool.inputSchema);
      if (validationError) {
        return {
          content: [{ type: 'text', text: validationError }],
          isError: true,
        };
      }

      return await tool.handler(args, store);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Tool execution error: ${message}` }],
        isError: true,
      };
    }
  }

  /** Remove a tool. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Get count of registered tools. */
  get size(): number {
    return this.tools.size;
  }
}

// ---------------------------------------------------------------------------
// Argument Validation
// ---------------------------------------------------------------------------

function validateArgs(args: Record<string, unknown>, schema: Record<string, unknown>): string | null {
  // Get required fields from the schema
  const schemaProperties = schema['properties'] as Record<string, { type?: string; description?: string }> | undefined;
  const requiredFields = (schema['required'] as string[]) ?? [];

  if (!schemaProperties) return null;

  for (const field of requiredFields) {
    if (args[field] === undefined || args[field] === null) {
      const fieldSchema = schemaProperties[field];
      const desc = fieldSchema?.description ?? field;
      return `Missing required parameter: "${field}" (${desc})`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// JSON Schema Helpers
// ---------------------------------------------------------------------------

/** Create a simple JSON Schema for a tool with required and optional properties. */
export function makeSchema(
  properties: Record<string, { type: string; description: string; enum?: string[] }>,
  required: string[] = [],
): Record<string, unknown> {
  const schemaProps: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(properties)) {
    const prop: Record<string, unknown> = {
      type: def.type,
      description: def.description,
    };
    if (def.enum) prop['enum'] = def.enum;
    schemaProps[key] = prop;
  }

  return {
    type: 'object',
    properties: schemaProps,
    required: required.length > 0 ? required : undefined,
  };
}
