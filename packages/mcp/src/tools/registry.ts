// @code-analyzer/mcp — Tool Registry
// Central registry for MCP tools with profile-based filtering and execution.

import type { ToolDefinition, ToolEffect, ToolProfile } from '@code-analyzer/shared';

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
  /** Optional structured metadata about the tool result (e.g. projectId, counts). */
  metadata?: Record<string, unknown>;
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

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

export interface RegisteredTool extends ToolDefinition {
  handler: ToolHandler;
  profile: ToolProfile;
  effect: ToolEffect;
}

/**
 * The caller a decision is made for.
 *
 * Two fields because there are two independent questions: **which tools this client was offered** (`profile`) and
 * **whether it may change anything at all** (`readOnly`). Collapsing them into one enum would make "read-only analysis"
 * unrepresentable, which is precisely the role a review agent needs.
 */
export interface ToolCallActor {
  readonly profile: ToolProfile;
  /** When true, `write` and `destroy` tools are refused even if the profile advertises them. */
  readonly readOnly?: boolean;
}

/** The outcome of `authorize`, as data, so a refusal can be asserted rather than string-matched. */
export type ToolAuthorization =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: 'unknown-tool' | 'profile' | 'read-only' | 'unclassified';
      readonly message: string;
    };

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  /** Register a tool with its handler and profile. */
  register(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: ToolHandler,
    profile: ToolProfile = 'all',
    /**
     * What the call does to the world.
     *
     * Optional so that the forty-odd test registries that register a stub keep compiling; **the product catalog is
     * required to declare all fifty-one by `tool-effect-classification.test.ts`**, and a tool that declares nothing is
     * `unclassified`, which a read-only client refuses. The default is therefore fail-closed on the axis that matters
     * and open on the axis that does not.
     */
    effect?: ToolEffect,
  ): void {
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`);
    }
    this.tools.set(name, {
      name,
      description,
      inputSchema,
      handler,
      profile,
      effect: effect ?? 'unclassified',
    });
  }

  /** Get a tool by name. */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tool definitions (without handlers).
   *
   * `effect` is part of the answer because a caller that is deciding what to expose needs it: a gateway that offers a
   * read-only role has to know which of the fifty-one changes something, and re-deriving that from the descriptions is
   * how a tool gets mislabelled.
   */
  list(): Array<ToolDefinition & { profile: ToolProfile; effect: ToolEffect }> {
    return Array.from(this.tools.values()).map(
      ({ name, description, inputSchema, profile, effect }) => ({
        name,
        description,
        inputSchema,
        profile,
        effect,
      }),
    );
  }

  /** List tools filtered by profile ('all' returns everything). */
  listByProfile(
    profile: ToolProfile,
  ): Array<ToolDefinition & { profile: ToolProfile; effect: ToolEffect }> {
    return Array.from(this.tools.values())
      .filter((t) => profile === 'all' || t.profile === 'all' || t.profile === profile)
      .map(({ name, description, inputSchema, profile: p, effect }) => ({
        name,
        description,
        inputSchema,
        profile: p,
        effect,
      }));
  }

  /**
   * Whether `actor` may call `name`.
   *
   * **This is the same predicate `listByProfile` advertises with, applied to a name instead of to a list**, and the two
   * have to agree or the profile is decoration. Until this method existed, `listByProfile` filtered what a client was
   * *told about* and `execute` looked the name up in a map of all fifty-one tools, so a client configured as `scout`
   * saw ten tools and could call forty-one it had never been offered — with `delete_project` among them. A permission
   * boundary that only exists in the advertisement is not a boundary; it is a suggestion to a caller that has any
   * other way to learn a name, and tool names are in the public README.
   *
   * The reasons are separate because they are separate facts: `unknown-tool` is a name that does not exist, `profile`
   * is a name that exists and is not yours, `read-only` is a name that is yours and changes something, and
   * `unclassified` is a name whose registration forgot to say what it does.
   */
  authorize(actor: ToolCallActor, name: string): ToolAuthorization {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      return { allowed: false, reason: 'unknown-tool', message: `Tool "${name}" not found` };
    }
    if (actor.profile !== 'all' && tool.profile !== 'all' && tool.profile !== actor.profile) {
      return {
        allowed: false,
        reason: 'profile',
        message:
          `Tool "${name}" is not available to a client with the "${actor.profile}" profile. ` +
          `Call tools/list to see what this client may use.`,
      };
    }
    if (actor.readOnly === true && (tool.effect === 'write' || tool.effect === 'destroy')) {
      return {
        allowed: false,
        reason: 'read-only',
        message:
          `Tool "${name}" is ${tool.effect === 'destroy' ? 'destructive' : 'a write'}, and this client is ` +
          `configured read-only. Read tools are unaffected; drop the read-only flag to allow changes.`,
      };
    }
    if (actor.readOnly === true && tool.effect === 'unclassified') {
      return {
        allowed: false,
        reason: 'unclassified',
        message:
          `Tool "${name}" does not declare what it changes, so a read-only client will not run it. ` +
          `Its registration needs an effect.`,
      };
    }
    return { allowed: true };
  }

  /**
   * Execute a tool by name with the given arguments.
   *
   * **`actor` is optional, and its absence means unrestricted** — the in-process callers (the CLI, the benchmark
   * harness, the tests that drive a handler directly) are not clients and have no profile. The network boundary is
   * `CodeAnalyzerMCPServer`, which always passes one, and `profile-enforcement.test.ts` drives a real MCP client over a
   * linked transport to prove it does. **A default of "allowed" is only safe because the one place that faces a
   * stranger is the one place that never takes the default.**
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    store?: unknown,
    actor?: ToolCallActor,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Error: Tool "${name}" not found` }],
        isError: true,
      };
    }

    if (actor !== undefined) {
      const decision = this.authorize(actor, name);
      if (!decision.allowed) {
        return {
          content: [{ type: 'text', text: decision.message }],
          isError: true,
          metadata: {
            denied: decision.reason,
            tool: name,
            profile: actor.profile,
            readOnly: actor.readOnly === true,
          },
        };
      }
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

function validateArgs(
  args: Record<string, unknown>,
  schema: Record<string, unknown>,
): string | null {
  // Get required fields from the schema
  const schemaProperties = schema['properties'] as
    Record<string, { type?: string; description?: string }> | undefined;
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
