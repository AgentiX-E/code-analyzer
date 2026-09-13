// @code-analyzer/mcp — SSE Transport Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SSETransport } from '../transport/sse-transport.js';
import type { SSEEvent } from '../transport/sse-transport.js';
import * as http from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// Helper to create an HTTP server that auto-assigns a port
function createTestServer(): Promise<{ server: HttpServer; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port });
    });
    server.on('error', reject);
  });
}

// Helper to wait a tick
function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SSETransport', () => {
  let transport: SSETransport;
  let httpServer: HttpServer | null = null;

  afterEach(async () => {
    // Close HTTP server first to release any client connections
    if (httpServer) {
      httpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => {
        httpServer!.close(() => resolve());
        // Force close after 2s
        setTimeout(() => resolve(), 2000);
      });
      httpServer = null;
    }
    if (transport && transport.isRunning()) {
      await transport.shutdown();
    }
  });

  describe('construction', () => {
    it('should create with default options', () => {
      transport = new SSETransport();
      expect(transport).toBeDefined();
      expect(transport.isRunning()).toBe(false);
      expect(transport.clientCount).toBe(0);
    });

    it('should accept custom heartbeat interval', () => {
      transport = new SSETransport({ heartbeatInterval: 15000 });
      expect(transport).toBeDefined();
    });

    it('should accept custom maxClients', () => {
      transport = new SSETransport({ maxClients: 50 });
      expect(transport).toBeDefined();
    });

    it('should accept custom path', () => {
      transport = new SSETransport({ path: '/events' });
      expect(transport).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('should start and stop without HTTP server', async () => {
      transport = new SSETransport();
      transport.start();
      expect(transport.isRunning()).toBe(true);
      await transport.shutdown();
      expect(transport.isRunning()).toBe(false);
    });

    it('should be idempotent on start', () => {
      transport = new SSETransport();
      transport.start();
      expect(transport.isRunning()).toBe(true);
      transport.start(); // second call should be no-op
      expect(transport.isRunning()).toBe(true);
    });

    it('should be idempotent on shutdown', async () => {
      transport = new SSETransport();
      transport.start();
      await transport.shutdown();
      await transport.shutdown(); // second call should not throw
      expect(transport.isRunning()).toBe(false);
    });

    it('should emit started and shutdown events', async () => {
      transport = new SSETransport();
      const events: string[] = [];
      transport.on('started', () => events.push('started'));
      transport.on('shutdown', () => events.push('shutdown'));

      transport.start();
      await tick();
      await transport.shutdown();
      await tick();

      expect(events).toContain('started');
      expect(events).toContain('shutdown');
    });
  });

  describe('client management', () => {
    it('should track client count', async () => {
      transport = new SSETransport();
      expect(transport.clientCount).toBe(0);
    });

    it('should list client IDs', () => {
      transport = new SSETransport();
      expect(transport.getClientIds()).toEqual([]);
    });
  });

  describe('broadcast and send', () => {
    it('should not throw when broadcasting with no clients', () => {
      transport = new SSETransport();
      transport.start();
      expect(() => transport.broadcast({ data: 'test' })).not.toThrow();
    });

    it('should return false when sending to non-existent client', () => {
      transport = new SSETransport();
      transport.start();
      expect(transport.send('nonexistent', { data: 'test' })).toBe(false);
    });

    it('should not broadcast after shutdown', async () => {
      transport = new SSETransport();
      transport.start();
      await transport.shutdown();
      // Should not throw
      transport.broadcast({ data: 'test' });
    });
  });

  describe('SSE event formatting', () => {
    it('should format events with data as JSON string', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      transport = new SSETransport({ httpServer: server, heartbeatInterval: 0 });
      transport.start();

      // Make a connection request and read the response
      const response = await fetch(`http://127.0.0.1:${port}/sse`, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-cache');

      // Read the initial events
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let buffer = '';

        // Read for a short time to collect initial events
        const timeout = setTimeout(() => reader.cancel(), 500);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Look for the connected event
            if (buffer.includes('event: connected')) {
              break;
            }
            if (buffer.length > 5000) break; // Safety
          }
        } finally {
          clearTimeout(timeout);
          reader.cancel();
        }

        expect(buffer).toContain('retry');
        expect(buffer).toContain('event: connected');
        expect(buffer).toContain('clientId');
      }

      await transport.shutdown();
    });

    it('should reject POST with invalid JSON', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      transport = new SSETransport({ httpServer: server });
      transport.start();

      const response = await fetch(`http://127.0.0.1:${port}/sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      expect(response.status).toBe(400);

      await transport.shutdown();
    });

    it('should accept valid JSON POST', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      transport = new SSETransport({ httpServer: server });
      transport.start();

      const response = await fetch(`http://127.0.0.1:${port}/sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'sse-test', event: 'ping' }),
      });

      expect(response.status).toBe(200);

      await transport.shutdown();
    });

    it('should reject non-GET/POST methods', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      transport = new SSETransport({ httpServer: server });
      transport.start();

      const response = await fetch(`http://127.0.0.1:${port}/sse`, { method: 'PUT' });
      expect(response.status).toBe(405);

      await transport.shutdown();
    });

    it('should return 503 for GET when shutting down', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      transport = new SSETransport({ httpServer: server, heartbeatInterval: 0 });
      transport.start();

      // Connect a client first
      const res1 = await fetch(`http://127.0.0.1:${port}/sse`);
      expect(res1.status).toBe(200);

      // Shutdown the transport while client is connected
      await transport.shutdown();

      // After shutdown, new GET requests to SSE path should return 503
      await tick(100);
      const res2 = await fetch(`http://127.0.0.1:${port}/sse`);
      expect(res2.status).toBe(503);
      const body = await res2.json();
      expect(body.error).toContain('shutting down');

      // Clean up the first client
      res1.body?.cancel();
    });
  });

  describe('max clients', () => {
    it('should reject connections when at max capacity', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      // Create transport with max 1 client
      transport = new SSETransport({ httpServer: server, maxClients: 1, heartbeatInterval: 0 });
      transport.start();

      // First client should connect
      const res1 = await fetch(`http://127.0.0.1:${port}/sse`);
      expect(res1.status).toBe(200);

      // Second client should be rejected
      const res2 = await fetch(`http://127.0.0.1:${port}/sse`);
      expect(res2.status).toBe(503);

      await transport.shutdown();
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeat comments to keep connection alive', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      // Short heartbeat for testing
      transport = new SSETransport({ httpServer: server, heartbeatInterval: 200 });
      transport.start();

      const response = await fetch(`http://127.0.0.1:${port}/sse`);
      expect(response.status).toBe(200);

      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let buffer = '';

        const timeout = setTimeout(() => reader.cancel(), 1000);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (buffer.includes(': heartbeat')) break;
            if (buffer.length > 5000) break;
          }
        } finally {
          clearTimeout(timeout);
          reader.cancel();
        }

        expect(buffer).toContain(': heartbeat');
      }

      await transport.shutdown();
    });

    it('sends nothing when the heartbeat interval is disabled', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      // Zero disables the timer. 700ms is far longer than six beats at the 100ms
      // interval the positive case above uses, so an interval of `0` and a merely
      // long one are distinguishable: only the former stays silent.
      transport = new SSETransport({ httpServer: server, heartbeatInterval: 0 });
      transport.start();

      const response = await fetch(`http://127.0.0.1:${port}/sse`);
      expect(response.status).toBe(200);

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      const timeout = setTimeout(() => reader.cancel(), 700);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
      } finally {
        clearTimeout(timeout);
        reader.cancel();
      }

      expect(buffer).toContain('event: connected');
      expect(buffer).not.toContain(': heartbeat');
    });
  });

  describe('server supplied to start()', () => {
    it('attaches to an HTTP server handed to start()', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      // Built with no server, so `start()` is the only thing that can wire one up —
      // the branch the `httpServer` constructor option never reaches.
      transport = new SSETransport();
      transport.start(server);

      const response = await fetch(`http://127.0.0.1:${port}/sse`);
      expect(response.status).toBe(200);
      expect(transport.clientCount).toBe(1);

      await response.body?.cancel();
      await transport.shutdown();
    });
  });

  describe('broadcasting to a live client', () => {
    it('delivers an event to a connected client', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      transport = new SSETransport({ httpServer: server, heartbeatInterval: 0 });
      transport.start();

      const response = await fetch(`http://127.0.0.1:${port}/sse`);
      expect(response.status).toBe(200);

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      const timeout = setTimeout(() => reader.cancel(), 2500);
      try {
        // Wait for the handshake first: only then is the client registered, and
        // every existing broadcast test runs with zero clients.
        while (!buffer.includes('event: connected')) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
        expect(buffer).toContain('event: connected');

        transport.broadcast({ event: 'greeting', data: 'hello' });

        while (!buffer.includes('greeting')) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
      } finally {
        clearTimeout(timeout);
        reader.cancel();
      }

      expect(buffer).toContain('event: greeting');
      expect(buffer).toContain('hello');
    });
  });

  describe('sending to a live client', () => {
    it('delivers a targeted event and reports success', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      transport = new SSETransport({ httpServer: server, heartbeatInterval: 0 });
      transport.start();

      const response = await fetch(`http://127.0.0.1:${port}/sse`);
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      const timeout = setTimeout(() => reader.cancel(), 2500);
      try {
        while (!buffer.includes('event: connected')) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }

        const clientId = transport.getClientIds()[0];
        expect(clientId).toBeDefined();

        // Every other `send()` case in this suite targets a client that is absent,
        // disconnected or behind a shutting-down transport — so the success path,
        // and `sendToClient` underneath it, had never executed at all.
        expect(transport.send(clientId!, { event: 'targeted', data: { n: 1 } })).toBe(true);

        while (!buffer.includes('targeted')) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
      } finally {
        clearTimeout(timeout);
        reader.cancel();
      }

      expect(buffer).toContain('event: targeted');
      expect(buffer).toContain('{"n":1}');
    });
  });

  describe('client messages', () => {
    it('emits client-message for a POST naming a connected client', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      transport = new SSETransport({ httpServer: server, heartbeatInterval: 0 });
      transport.start();

      const received: string[] = [];
      transport.on('client-message', (id: string) => received.push(id));

      const stream = await fetch(`http://127.0.0.1:${port}/sse`);
      const reader = stream.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      let clientId = '';
      const timeout = setTimeout(() => reader.cancel(), 2500);
      try {
        while (!buffer.includes('event: connected')) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
        clientId = transport.getClientIds()[0] ?? '';

        const response = await fetch(`http://127.0.0.1:${port}/sse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, event: 'ping' }),
        });
        expect(response.status).toBe(200);
      } finally {
        clearTimeout(timeout);
        reader.cancel();
      }

      // A POST that names a client the transport knows is forwarded as an event;
      // one that names a stranger is accepted and dropped.
      expect(received).toEqual([clientId]);
    });
  });

  describe('heartbeat without clients', () => {
    it('ticks with nothing attached and keeps running', async () => {
      const { server } = await createTestServer();
      httpServer = server;

      // A short interval with no client ever attaching: the tick fires and returns
      // at its guard. The existing heartbeat case connects a client first, so the
      // empty-tick path had never run.
      transport = new SSETransport({ httpServer: server, heartbeatInterval: 30 });
      transport.start();

      await tick(150);

      expect(transport.clientCount).toBe(0);
      expect(transport.isRunning()).toBe(true);
    });
  });

  describe('message handling edge cases', () => {
    it('refuses POST with 503 once shutdown has begun', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      transport = new SSETransport({ httpServer: server, heartbeatInterval: 0 });
      transport.start();
      await transport.shutdown();

      // The request listener stays attached after shutdown, so a late POST still
      // reaches the transport and has to be answered rather than left hanging.
      const response = await fetch(`http://127.0.0.1:${port}/sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'sse-1' }),
      });

      expect(response.status).toBe(503);
      await response.body?.cancel();
    });

    it('destroys a request whose body exceeds the 1MB limit', async () => {
      const { server, port } = await createTestServer();
      httpServer = server;

      transport = new SSETransport({ httpServer: server, heartbeatInterval: 0 });
      transport.start();

      // One byte past the limit: the transport destroys the request mid-stream to
      // bound how much a single client can buffer, so the upload cannot complete.
      const oversized = 'x'.repeat(1_048_577);
      let settled: 'resolved' | 'rejected' = 'resolved';
      try {
        const response = await fetch(`http://127.0.0.1:${port}/sse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: oversized,
        });
        await response.body?.cancel();
      } catch {
        settled = 'rejected';
      }

      expect(settled).toBe('rejected');

      await transport.shutdown();
    });
  });
});
