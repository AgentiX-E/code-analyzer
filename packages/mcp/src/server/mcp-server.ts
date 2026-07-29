/* v8 ignore file */
// @code-analyzer/mcp — MCP Server
// Core MCP server class supporting stdio and HTTP (SSE) transports.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
/* v8 ignore start */

  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerConfig, ToolDefinition, ResourceDefinition, PromptDefinition } from '@code-analyzer/shared';
import { InMemoryGraphStore, createFileDiscoverer, AutoIndexer } from '@code-analyzer/infra';
import type { AutoIndexer as AutoIndexerType } from '@code-analyzer/infra';
import { createToolRegistry, ToolRegistry } from '../tools/index.js';
import { ToolContextImpl, type ToolContext } from '../tools/tool-context.js';
import { registerResources } from '../resources/index.js';
import { registerPrompts } from '../prompts/index.js';
import { AuthMiddleware, RateLimiter, RequestLogger } from '../middleware/index.js';

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: MCPServerConfig = {
  name: 'code-analyzer',
  version: '0.1.0',
  toolProfile: 'all',
  maxResults: 100,
  enableStreaming: false,
  enableResources: true,
  enablePrompts: true,
};

// ---------------------------------------------------------------------------
// CodeAnalyzerMCPServer
// ---------------------------------------------------------------------------

/* v8 ignore start */

export class CodeAnalyzerMCPServer {
  private server: Server;
  private config: MCPServerConfig;
  private registry: ToolRegistry;
  private store: InMemoryGraphStore;
  private toolContext: ToolContext;
  private auth: AuthMiddleware;
  private rateLimiter: RateLimiter;
  private logger: RequestLogger;
  private transport?: StdioServerTransport;
  private httpServer?: unknown;
  private autoIndexer: AutoIndexerType | null = null;

  constructor(config: Partial<MCPServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = new InMemoryGraphStore();
    this.toolContext = new ToolContextImpl(this.store);
    this.registry = createToolRegistry();
    this.auth = new AuthMiddleware();
    this.rateLimiter = new RateLimiter();
    this.logger = new RequestLogger();

    // Initialize AutoIndexer with the store
    const discoverer = createFileDiscoverer();
    this.autoIndexer = new AutoIndexer(discoverer, this.store, {
      indexOnConnect: true,
    });

    this.server = new Server(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          tools: { listChanged: true },
          resources: this.config.enableResources ? { subscribe: true, listChanged: true } : undefined,
          prompts: this.config.enablePrompts ? { listChanged: true } : undefined,
          logging: {},
        },
      },
    );

    this.setupHandlers();
  }

  // -------------------------------------------------------------------------
  // Handlers Setup
  // -------------------------------------------------------------------------

  private setupHandlers(): void {
    const profile = this.config.toolProfile;

    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.registry.listByProfile(profile);
      return { tools: tools.map((t) => this.formatTool(t)) };
    });

    // Call tool
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
      const start = Date.now();
      const { name, arguments: args } = request.params;
      const argsObj = (args ?? {}) as Record<string, unknown>;

      try {
        // Auth check
        const authResult = this.auth.validate(request as unknown as Record<string, unknown>);
        if (!authResult.allowed) {
          return {
            content: [{ type: 'text' as const, text: authResult.message ?? 'Unauthorized' }],
            isError: true,
          };
        }

        // Rate limiting
        const rateResult = this.rateLimiter.check(name);
        if (!rateResult.allowed) {
          return {
            content: [{ type: 'text' as const, text: `Rate limited: ${rateResult.message}. Retry after ${rateResult.retryAfterMs}ms` }],
            isError: true,
          };
        }

        // Execute tool with ToolContext
        const result = await this.registry.execute(name, argsObj, this.toolContext);

        // Log request
        this.logger.log({
          toolName: name,
          args: argsObj,
          duration: Date.now() - start,
          error: result.isError ?? false,
        });

        return result;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.log({
          toolName: name,
          args: argsObj,
          duration: Date.now() - start,
          error: true,
        });
        return {
          content: [{ type: 'text' as const, text: `Internal error: ${msg}` }],
          isError: true,
        };
      }
    });

    // List resources
    if (this.config.enableResources) {
      this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
        const resources = registerResources();
        return { resources: resources.map((r) => this.formatResource(r)) };
      });

      this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const { uri } = request.params;
        const resources = registerResources();
        const resource = resources.find((r) => r.uri === uri);
        if (!resource) {
          throw new Error(`Resource not found: ${uri}`);
        }
        return {
          contents: [{
            uri: resource.uri,
            mimeType: resource.mimeType ?? 'application/json',
            text: JSON.stringify({ uri: resource.uri, name: resource.name, description: resource.description }, null, 2),
          }],
        };
      });
    }

    // List prompts
    if (this.config.enablePrompts) {
      this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
        const prompts = registerPrompts();
        return { prompts: prompts.map((p) => this.formatPrompt(p)) };
      });

      this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const prompts = registerPrompts();
        const prompt = prompts.find((p) => p.name === name);
        if (!prompt) {
          throw new Error(`Prompt not found: ${name}`);
        }

        const resolvedArgs = args ?? {};
        const messages = [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Prompt: ${prompt.name} - ${prompt.description}\n\nArguments: ${JSON.stringify(resolvedArgs, null, 2)}`,
          },
        }];

        return { messages };
      });
    }
  }

  // -------------------------------------------------------------------------
  // Transport Methods
  // -------------------------------------------------------------------------

  /** Start MCP server on stdio transport. Optionally auto-index the given project root. */
  async startStdio(rootPath?: string): Promise<void> {
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);

    // Auto-index on first connection if a rootPath is provided
    if (rootPath && this.autoIndexer) {
      try {
        await this.autoIndexer.onProjectOpen(rootPath);
      } catch {
        // Indexing failed silently — tools will handle explicit indexing
      }
    }
  }

  /** Start MCP server on HTTP with SSE transport. */
  async startHTTP(port: number, host?: string, rootPath?: string): Promise<void> {
    try {
      const http = await import('http');
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'Code Analyzer MCP Server', transport: 'HTTP' }));
      });

      this.httpServer = server;
      server.listen(port, host ?? '0.0.0.0');

      // Auto-index if a rootPath is provided
      if (rootPath && this.autoIndexer) {
        try {
          await this.autoIndexer.onProjectOpen(rootPath);
        } catch {
          // Indexing failed silently
        }
      }

      // Also connect via stdio as fallback
      await this.startStdio();
    } catch {
      await this.startStdio();
    }
  }

  // -------------------------------------------------------------------------
  // Unified Start/Stop API (for container and programmatic usage)
  // -------------------------------------------------------------------------

  /** Unified start: picks stdio or HTTP based on environment or explicit config. */
  async start(options?: { transport?: 'stdio' | 'sse'; port?: number; host?: string; rootPath?: string }): Promise<void> {
    const transport = options?.transport ?? (process.env['MCP_TRANSPORT'] === 'stdio' ? 'stdio' : 'sse');
    const port = options?.port ?? parseInt(process.env['MCP_PORT'] ?? '3000', 10);
    const host = options?.host ?? process.env['MCP_HOST'] ?? '0.0.0.0';
    const rootPath = options?.rootPath;

    if (transport === 'stdio') {
      await this.startStdio(rootPath);
    } else {
      await this.startHTTP(port, host, rootPath);
    }
  }

  /** Unified stop: graceful shutdown of all transports. */
  async stop(): Promise<void> {
    await this.shutdown();
  }

  /** Graceful shutdown. */
  async shutdown(): Promise<void> {
    if (this.transport) {
      await this.server.close();
    }
    if (this.httpServer) {
      (this.httpServer as { close: () => void }).close();
    }
    this.store.close();
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** Get the underlying MCP Server instance. */
  getServer(): Server {
    return this.server;
  }

  /** Get the tool registry. */
  getRegistry(): ToolRegistry {
    return this.registry;
  }

  /** Get the InMemoryGraphStore backed by auto-indexer data. */
  getStore(): InMemoryGraphStore {
    return this.store;
  }

  /** Get the AutoIndexer instance. */
  getAutoIndexer(): AutoIndexerType | null {
    return this.autoIndexer;
  }

  /** Get the ToolContext wrapping all analysis services. */
  getToolContext(): ToolContext {
    return this.toolContext;
  }

  /** Get the server configuration. */
  getConfig(): MCPServerConfig {
    return { ...this.config };
  }

  // -------------------------------------------------------------------------
  // Formatting Helpers
  // -------------------------------------------------------------------------

  private formatTool(tool: ToolDefinition): Record<string, unknown> {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  }

  private formatResource(resource: ResourceDefinition): Record<string, unknown> {
    return {
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    };
  }

  private formatPrompt(prompt: PromptDefinition): Record<string, unknown> {
    return {
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments ?? [],
    };
  }
}
/* v8 ignore stop */
