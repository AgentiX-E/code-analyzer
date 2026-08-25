// @ts-nocheck
// @code-analyzer/mcp — SSE transport branch coverage: send/broadcast/disconnect
// guards and event-formatting edge cases (id, custom event, non-string data,
// multi-line data).

import { describe, it, expect } from 'vitest';
import { SSETransport } from '../transport/sse-transport.js';

function makeClient(overrides: Record<string, unknown> = {}) {
  const writes: string[] = [];
  return {
    client: {
      id: 'sse-1',
      response: { write: (s: string) => writes.push(s), end: () => {} },
      lastEventId: null,
      connectedAt: 0,
      connected: true,
      ...overrides,
    },
    writes,
  };
}

describe('SSETransport — broadcast/send guards', () => {
  it('skips disconnected clients on broadcast', () => {
    const t = new SSETransport();
    (t as any).clients.set('offline', makeClient({ connected: false }).client);
    expect(() => t.broadcast({ data: 'x' })).not.toThrow();
  });

  it('returns false when sending to a disconnected client', () => {
    const t = new SSETransport();
    const { client } = makeClient({ connected: false });
    (t as any).clients.set('offline', client);
    expect(t.send('offline', { data: 'x' })).toBe(false);
  });

  it('returns false when sending while shutting down', () => {
    const t = new SSETransport();
    (t as any).shuttingDown = true;
    expect(t.send('sse-1', { data: 'x' })).toBe(false);
    expect(t.broadcast({ data: 'x' })).toBeUndefined();
  });

  it('no-ops when disconnecting an unknown client', () => {
    const t = new SSETransport();
    expect(() => t.disconnectClient('missing')).not.toThrow();
  });

  it('writes an error frame when disconnecting with a reason', () => {
    const t = new SSETransport();
    const { client, writes } = makeClient();
    (t as any).clients.set('sse-1', client);
    t.disconnectClient('sse-1', 'Server shutting down');
    expect(writes.join('')).toContain('event: error');
  });
});

describe('SSETransport — event formatting', () => {
  it('defaults the event name to message and serializes non-string data', () => {
    const t = new SSETransport();
    const { client, writes } = makeClient();
    (t as any).sendToClient(client, { data: { a: 1 } });
    expect(writes.join('')).toContain('data: {"a":1}');
    expect(writes.join('')).not.toContain('event:');
  });

  it('emits a custom event name and an id', () => {
    const t = new SSETransport();
    const { client, writes } = makeClient();
    (t as any).sendToClient(client, { event: 'connected', id: 'evt-1', data: 'hello' });
    const out = writes.join('');
    expect(out).toContain('event: connected');
    expect(out).toContain('id: evt-1');
    expect(client.lastEventId).toBe('evt-1');
  });

  it('splits multi-line data into separate data: lines', () => {
    const t = new SSETransport();
    const { client, writes } = makeClient();
    (t as any).sendToClient(client, { data: 'line1\nline2' });
    const out = writes.join('');
    expect(out).toContain('data: line1');
    expect(out).toContain('data: line2');
  });
});
