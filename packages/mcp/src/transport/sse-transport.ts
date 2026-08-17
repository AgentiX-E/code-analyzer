// @code-analyzer/mcp — SSE Transport
// Server-Sent Events transport implementation for MCP protocol.
// Supports multiple concurrent clients, keepalive heartbeats, reconnection,
// and graceful shutdown.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

export interface SSEEvent {
  /** Event type (defaults to 'message') */
  event?: string;
  /** Event data (serialized to JSON) */
  data: unknown;
  /** Event ID for reconnection support */
  id?: string;
  /** Retry interval in milliseconds for client reconnection */
  retry?: number;
}

export interface SSEClient {
  /** Unique client ID */
  id: string;
  /** HTTP response stream */
  response: ServerResponse;
  /** Last event ID sent for `Last-Event-Id` tracking */
  lastEventId: string | null;
  /** Timestamp of client connection */
  connectedAt: number;
  /** Whether the client is still connected */
  connected: boolean;
}

export interface SSETransportOptions {
  /** HTTP server instance to attach to */
  httpServer?: HttpServer;
  /** Keepalive heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Client reconnection interval in ms (default: 3000) */
  retryInterval?: number;
  /** Maximum number of concurrent clients (default: 100) */
  maxClients?: number;
  /** Path for SSE endpoint (default: '/sse') */
  path?: string;
}

// ---------------------------------------------------------------------------
// SSETransport
// ---------------------------------------------------------------------------

export class SSETransport extends EventEmitter {
  private clients: Map<string, SSEClient>;
  private httpServer: HttpServer | null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: number;
  private retryInterval: number;
  private maxClients: number;
  private path: string;
  private nextClientId: number;
  private started: boolean;
  private shuttingDown: boolean;

  constructor(options: SSETransportOptions = {}) {
    super();
    this.clients = new Map();
    this.httpServer = options.httpServer ?? null;
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
    this.retryInterval = options.retryInterval ?? 3000;
    this.maxClients = options.maxClients ?? 100;
    this.path = options.path ?? '/sse';
    this.nextClientId = 1;
    this.started = false;
    this.shuttingDown = false;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Start the SSE transport and attach to the HTTP server. */
  start(httpServer?: HttpServer): void {
    if (this.started) return;

    if (httpServer) {
      this.httpServer = httpServer;
    }

    if (this.httpServer) {
      this.attachToServer(this.httpServer);
    }

    this.startHeartbeat();
    this.started = true;
    this.shuttingDown = false;

    this.emit('started');
  }

  /** Graceful shutdown: disconnect all clients and stop heartbeats. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.stopHeartbeat();

    // Disconnect all active clients
    const clientIds = Array.from(this.clients.keys());
    for (const id of clientIds) {
      this.disconnectClient(id, 'Server shutting down');
    }

    this.started = false;
    this.emit('shutdown');
  }

  /** Whether the transport has started and not shutting down. */
  isRunning(): boolean {
    return this.started && !this.shuttingDown;
  }

  /** Current number of connected clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Get all connected client IDs. */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  // -------------------------------------------------------------------------
  // Event Broadcasting
  // -------------------------------------------------------------------------

  /** Send an SSE event to all connected clients. */
  broadcast(event: SSEEvent): void {
    if (this.shuttingDown) return;

    for (const client of this.clients.values()) {
      if (client.connected) {
        this.sendToClient(client, event);
      }
    }
  }

  /** Send an SSE event to a specific client by ID. */
  send(clientId: string, event: SSEEvent): boolean {
    if (this.shuttingDown) return false;

    const client = this.clients.get(clientId);
    if (!client || !client.connected) return false;

    this.sendToClient(client, event);
    return true;
  }

  // -------------------------------------------------------------------------
  // Client Management
  // -------------------------------------------------------------------------

  /** Disconnect a specific client. */
  disconnectClient(clientId: string, reason?: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.connected = false;

    try {
      if (reason) {
        client.response.write(`event: error\ndata: ${JSON.stringify({ reason })}\n\n`);
      }
      client.response.end();
    } catch {
      // Client may already be disconnected
    }

    this.clients.delete(clientId);
    this.emit('client-disconnected', clientId);
  }

  // -------------------------------------------------------------------------
  // Private: Server Attachment
  // -------------------------------------------------------------------------

  private attachToServer(httpServer: HttpServer): void {
    httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
      // Only handle SSE requests to our configured path
      const url = req.url ?? '/';
      if (!url.startsWith(this.path)) return;

      if (req.method === 'GET') {
        this.handleSSEConnection(req, res);
      } else if (req.method === 'POST') {
        this.handleSSEMessage(req, res);
      } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
      }
    });
  }

  // -------------------------------------------------------------------------
  // Private: SSE Connection Handling
  // -------------------------------------------------------------------------

  private handleSSEConnection(req: IncomingMessage, res: ServerResponse): void {
    if (this.shuttingDown) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server is shutting down' }));
      return;
    }

    if (this.clients.size >= this.maxClients) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Maximum client connections reached' }));
      return;
    }

    const clientId = `sse-${this.nextClientId++}`;

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
      'Access-Control-Allow-Origin': '*',
    });

    const client: SSEClient = {
      id: clientId,
      response: res,
      lastEventId: req.headers['last-event-id'] as string ?? null,
      connectedAt: Date.now(),
      connected: true,
    };

    this.clients.set(clientId, client);

    // Send retry interval on connect
    this.writeSSE(res, { event: 'retry', data: `${this.retryInterval}` });
    // Send initial connection event
    this.writeSSE(res, { event: 'connected', data: JSON.stringify({ clientId }) });

    // Handle client disconnect
    req.on('close', () => {
      client.connected = false;
      this.clients.delete(clientId);
      this.emit('client-disconnected', clientId);
    });

    req.on('error', () => {
      client.connected = false;
      this.clients.delete(clientId);
      this.emit('client-disconnected', clientId);
    });

    // Flush headers immediately
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    this.emit('client-connected', clientId);
  }

  // -------------------------------------------------------------------------
  // Private: SSE Message Handling
  // -------------------------------------------------------------------------

  private handleSSEMessage(req: IncomingMessage, res: ServerResponse): void {
    if (this.shuttingDown) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server is shutting down' }));
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      // Limit body size to 1MB
      if (body.length > 1_048_576) {
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as { clientId?: string; event?: string; data?: unknown };
        if (parsed.clientId && this.clients.has(parsed.clientId)) {
          this.emit('client-message', parsed.clientId, parsed);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });

    req.on('error', () => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad request' }));
    });
  }

  // -------------------------------------------------------------------------
  // Private: Heartbeat
  // -------------------------------------------------------------------------

  private startHeartbeat(): void {
    if (this.heartbeatInterval <= 0) return;

    this.heartbeatTimer = setInterval(() => {
      if (this.shuttingDown || this.clients.size === 0) return;

      // Send heartbeat as SSE comment (ignored by clients, keeps connection alive)
      for (const client of this.clients.values()) {
        if (client.connected) {
          try {
            client.response.write(`: heartbeat ${new Date().toISOString()}\n\n`);
          } catch {
            // Client may be disconnected
            client.connected = false;
            this.clients.delete(client.id);
          }
        }
      }
    }, this.heartbeatInterval);

    // Allow the event loop to exit if no other references exist
    if (this.heartbeatTimer && typeof this.heartbeatTimer === 'object') {
      (this.heartbeatTimer as NodeJS.Timeout).unref?.();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Send & Write
  // -------------------------------------------------------------------------

  private sendToClient(client: SSEClient, event: SSEEvent): void {
    try {
      const eventStr = event.event ?? 'message';
      const dataStr = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
      if (event.id) {
        client.lastEventId = event.id;
      }
      this.writeSSE(client.response, { event: eventStr, data: dataStr, id: event.id });
    } catch {
      client.connected = false;
      this.clients.delete(client.id);
    }
  }

  private writeSSE(res: ServerResponse, fields: { event?: string; data: string; id?: string }): void {
    const lines: string[] = [];
    if (fields.event && fields.event !== 'message') {
      lines.push(`event: ${fields.event}`);
    }
    if (fields.id) {
      lines.push(`id: ${fields.id}`);
    }
    // Split multi-line data
    const dataLines = fields.data.split('\n');
    for (const line of dataLines) {
      lines.push(`data: ${line}`);
    }
    lines.push(''); // Empty line terminates the event
    res.write(lines.join('\n') + '\n');
  }
}
