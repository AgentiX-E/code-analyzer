// @code-analyzer/mcp — MCP Server (Fixed)
// Core MCP server class supporting stdio and HTTP (SSE) transports.
//
// Key fixes applied:
// - Empty catch blocks replaced with proper error logging
// - httpServer typed as http.Server instead of unknown
// - parseInt NaN guard for MCP_PORT environment variable
// - Auto-index failure reported to MCP client via notification
// - /* v8 ignore file */ removed — covered by unit and integration tests

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type * as http from 'http';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  MCPServerConfig,
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
} from '@code-analyzer/shared';
import { InMemoryGraphStore, createFileDiscoverer, AutoIndexer } from '@code-analyzer/infra';
import type { AutoIndexer as AutoIndexerType } from '@code-analyzer/infra';
import { createToolRegistry, ToolRegistry } from '../tools/index.js';
import { ToolContextImpl, type ToolContext } from '../tools/tool-context.js';
import { ResourceProvider } from '../resources/index.js';
import { PromptProvider } from '../prompts/index.js';
import { AuthMiddleware, RateLimiter } from '../middleware/index.js';
import { SSETransport } from '../transport/sse-transport.js';
import { createLogger, type Logger } from '@code-analyzer/core';

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

export class CodeAnalyzerMCPServer {
  private server: Server;
  private config: MCPServerConfig;
  private registry: ToolRegistry;
  private store: InMemoryGraphStore;
  private toolContext: ToolContext;
  private auth: AuthMiddleware;
  private rateLimiter: RateLimiter;
  private logger: Logger;
  private transport?: StdioServerTransport;
  private httpServer?: http.Server;
  private sseTransport?: SSETransport;
  private autoIndexer: AutoIndexerType | null = null;
  private resourceProvider: ResourceProvider;
  private promptProvider: PromptProvider;

  constructor(config: Partial<MCPServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = new InMemoryGraphStore();
    this.resourceProvider = new ResourceProvider(this.store);
    this.promptProvider = new PromptProvider(this.store);
    this.toolContext = new ToolContextImpl(this.store);
    this.registry = createToolRegistry();
    this.auth = new AuthMiddleware();
    this.rateLimiter = new RateLimiter();
    this.logger = createLogger('mcp-server');

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
          resources: this.config.enableResources
            ? { subscribe: true, listChanged: true }
            : undefined,
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

    // Call tool with middleware chain
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
      const start = Date.now();
      const { name, arguments: args } = request.params;
      const argsObj = (args ?? {}) as Record<string, unknown>;

      try {
        // Auth check
        const authResult = this.auth.validate(request as unknown as Record<string, unknown>);
        if (!authResult.allowed) {
          this.logger.warn('Unauthorized tool access attempt', {
            toolName: name,
            reason: authResult.message,
          });
          return {
            content: [
              {
                type: 'text' as const,
                text: authResult.message ?? 'Unauthorized',
              },
            ],
            isError: true,
          };
        }

        // Rate limiting
        const rateResult = this.rateLimiter.check(name);
        if (!rateResult.allowed) {
          this.logger.warn('Rate limited tool call', {
            toolName: name,
            retryAfterMs: rateResult.retryAfterMs,
          });
          return {
            content: [
              {
                type: 'text' as const,
                text: `Rate limited: ${rateResult.message}. Retry after ${rateResult.retryAfterMs}ms`,
              },
            ],
            isError: true,
          };
        }

        // Execute tool
        const result = await this.registry.execute(name, argsObj, this.toolContext);

        // Log successful request
        this.logger.info('Tool executed successfully', {
          toolName: name,
          duration: Date.now() - start,
        });

        return result;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error('Tool execution failed', undefined, {
          toolName: name,
          errorMessage: msg,
          duration: Date.now() - start,
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
        const resources = this.resourceProvider.listResources();
        return {
          resources: resources.map((r) => this.formatResource(r)),
        };
      });

      this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const { uri } = request.params;
        const result = await this.resourceProvider.getResource(uri);
        if ('error' in result) {
          throw new Error(result.error);
        }
        return {
          contents: [
            {
              uri: result.uri,
              mimeType: result.mimeType,
              text: result.text,
            },
          ],
        };
      });
    }

    // List prompts
    if (this.config.enablePrompts) {
      this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
        const prompts = this.promptProvider.listPrompts();
        return {
          prompts: prompts.map((p) => this.formatPrompt(p)),
        };
      });

      this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const result = await this.promptProvider.getPrompt(
          name,
          args as Record<string, unknown> | undefined,
        );
        return {
          messages: result.messages,
          description: result.description,
        };
      });
    }
  }

  // -------------------------------------------------------------------------
  // Auto-Index Helper (with proper error reporting)
  // -------------------------------------------------------------------------

  /**
   * Attempt to auto-index a project root directory.
   * Logs errors and sends a notification to the MCP client on failure
   * rather than silently swallowing the error.
   */
  private async tryAutoIndex(rootPath: string): Promise<void> {
    if (!this.autoIndexer) return;

    try {
      await this.autoIndexer.onProjectOpen(rootPath);
      this.logger.info('Auto-indexing completed', { rootPath });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Auto-indexing failed', undefined, {
        rootPath,
        errorMessage: msg,
      });

      // Send notification to MCP client so the user is aware
      try {
        this.server.notification({
          method: 'notifications/message',
          params: {
            level: 'warning',
            message: `Auto-indexing failed for ${rootPath}. Error: ${msg}. Run 'code-analyzer analyze' manually to index your project.`,
          },
        });
      } catch {
        // Notification delivery failure is non-critical
        this.logger.debug('Failed to send auto-index failure notification');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Transport Methods
  // -------------------------------------------------------------------------

  /**
   * Start MCP server on stdio transport.
   * Optionally auto-index the given project root on first connection.
   */
  async startStdio(rootPath?: string): Promise<void> {
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);

    if (rootPath) {
      await this.tryAutoIndex(rootPath);
    }
  }

  /**
   * Start MCP server on HTTP transport.
   * Provides a health-check endpoint and falls back to stdio for MCP communication.
   */
  async startHTTP(port: number, host?: string, rootPath?: string): Promise<void> {
    try {
      const httpModule = await import('http');
      const server: http.Server = httpModule.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'Code Analyzer MCP Server',
            transport: 'HTTP',
            version: this.config.version,
          }),
        );
      });

      this.httpServer = server;
      server.listen(port, host ?? '0.0.0.0', () => {
        this.logger.info('HTTP health endpoint started', {
          port,
          host: host ?? '0.0.0.0',
        });
      });

      // Handle server errors
      server.on('error', (err: Error) => {
        this.logger.error('HTTP server error', undefined, { errorMessage: err.message });
      });

      if (rootPath) {
        await this.tryAutoIndex(rootPath);
      }

      // Connect via stdio as the primary MCP transport
      await this.startStdio();
    } catch (error: unknown) {
      this.logger.error('Failed to start HTTP transport, falling back to stdio', undefined, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await this.startStdio();
    }
  }

  /**
   * Start MCP server with SSE transport for real-time streaming.
   * MCP events (notifications, errors, tool results) are broadcast via SSE.
   */
  async startSSE(port: number, host?: string, rootPath?: string): Promise<void> {
    try {
      const httpModule = await import('http');
      const server: http.Server = httpModule.createServer();

      this.httpServer = server;
      this.sseTransport = new SSETransport({
        httpServer: server,
        path: '/sse',
      });

      this.sseTransport.start();

      server.listen(port, host ?? '0.0.0.0', () => {
        this.logger.info('SSE transport started', {
          port,
          host: host ?? '0.0.0.0',
        });
      });

      server.on('error', (err: Error) => {
        this.logger.error('SSE server error', undefined, { errorMessage: err.message });
      });

      if (rootPath) {
        await this.tryAutoIndex(rootPath);
      }

      // Connect via stdio as primary MCP transport
      await this.startStdio();
    } catch (error: unknown) {
      this.logger.error('Failed to start SSE transport, falling back to stdio', undefined, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await this.startStdio();
    }
  }

  // -------------------------------------------------------------------------
  // Unified Start/Stop API
  // -------------------------------------------------------------------------

  /**
   * Unified start: picks stdio, sse, or http based on environment or explicit config.
   */
  async start(options?: {
    transport?: 'stdio' | 'sse' | 'http';
    port?: number;
    host?: string;
    rootPath?: string;
  }): Promise<void> {
    const transport =
      options?.transport ?? (process.env['MCP_TRANSPORT'] === 'stdio' ? 'stdio' : 'sse');
    const rawPort = options?.port ?? process.env['MCP_PORT'];
    const port = rawPort !== undefined && rawPort !== '' ? parseInt(String(rawPort), 10) : 3000;
    const host = options?.host ?? process.env['MCP_HOST'] ?? '0.0.0.0';
    const rootPath = options?.rootPath;

    // Guard against NaN port values
    const effectivePort = Number.isNaN(port) ? 3000 : port;

    this.logger.info('Starting MCP server', {
      transport,
      port: effectivePort,
      host,
      rootPath: rootPath ?? '(not set)',
    });

    if (transport === 'stdio') {
      await this.startStdio(rootPath);
    } else if (transport === 'sse') {
      await this.startSSE(effectivePort, host, rootPath);
    } else {
      await this.startHTTP(effectivePort, host, rootPath);
    }
  }

  /** Unified stop: graceful shutdown of all transports. */
  async stop(): Promise<void> {
    await this.shutdown();
  }

  /** Graceful shutdown with proper resource cleanup. */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down MCP server');

    try {
      if (this.transport) {
        await this.server.close();
      }
    } catch (error: unknown) {
      this.logger.error('Error closing MCP server', undefined, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      if (this.sseTransport) {
        await this.sseTransport.shutdown();
      }
    } catch (error: unknown) {
      this.logger.error('Error shutting down SSE transport', undefined, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      if (this.httpServer) {
        this.httpServer.close();
      }
    } catch (error: unknown) {
      this.logger.error('Error closing HTTP server', undefined, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      this.store.close();
    } catch (error: unknown) {
      this.logger.error('Error closing graph store', undefined, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    this.logger.info('MCP server shutdown complete');
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getServer(): Server {
    return this.server;
  }

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  getStore(): InMemoryGraphStore {
    return this.store;
  }

  getAutoIndexer(): AutoIndexerType | null {
    return this.autoIndexer;
  }

  getToolContext(): ToolContext {
    return this.toolContext;
  }

  getConfig(): MCPServerConfig {
    return { ...this.config };
  }

  getResourceProvider(): ResourceProvider {
    return this.resourceProvider;
  }

  getPromptProvider(): PromptProvider {
    return this.promptProvider;
  }

  getSSETransport(): SSETransport | undefined {
    return this.sseTransport;
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
