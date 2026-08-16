import { describe, it, expect } from 'vitest';
import {
  matchCrossProjectRoutes,
  matchCrossProjectChannels,
  matchCrossProjectGrpc,
} from '../cross-service/cross-project.js';
import { GRPC_PREFIX } from '../cross-service/types.js';

describe('matchCrossProjectRoutes', () => {
  it('matches routes by stripped URL path (full URL vs bare path)', () => {
    const matches = matchCrossProjectRoutes(
      [{ qn: 'r1', urlPath: 'https://api.example.com/users', sourceQn: 'caller.main' }],
      [{ qn: 'user-handler', urlPath: '/users' }],
      'proj-a',
      'proj-b',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      sourceProject: 'proj-a',
      targetProject: 'proj-b',
      edgeType: 'CROSS_HTTP_CALLS',
      sourceQn: 'caller.main',
      targetQn: 'user-handler',
      routePath: '/users',
    });
  });

  it('matches routes when source path is already bare', () => {
    const matches = matchCrossProjectRoutes(
      [{ qn: 'r1', urlPath: '/orders', sourceQn: 'caller.order' }],
      [{ qn: 'order-handler', urlPath: '/orders' }],
      'a', 'b',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.targetQn).toBe('order-handler');
  });

  it('returns empty when no path matches', () => {
    const matches = matchCrossProjectRoutes(
      [{ qn: 'r1', urlPath: '/nope', sourceQn: 'caller.x' }],
      [{ qn: 'h', urlPath: '/yes' }],
      'a', 'b',
    );
    expect(matches).toHaveLength(0);
  });

  it('returns empty for empty source or target routes', () => {
    expect(matchCrossProjectRoutes([], [{ qn: 'h', urlPath: '/x' }], 'a', 'b')).toHaveLength(0);
    expect(matchCrossProjectRoutes([{ qn: 'r', urlPath: '/x', sourceQn: 'c' }], [], 'a', 'b')).toHaveLength(0);
  });

  it('deduplicates target routes by first urlPath occurrence', () => {
    const matches = matchCrossProjectRoutes(
      [{ qn: 'r1', urlPath: '/dup', sourceQn: 'c1' }],
      [
        { qn: 'first', urlPath: '/dup' },
        { qn: 'second', urlPath: '/dup' },
      ],
      'a', 'b',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.targetQn).toBe('first');
  });
});

describe('matchCrossProjectChannels', () => {
  it('matches emit → listen direction', () => {
    const matches = matchCrossProjectChannels(
      [{ channelName: 'orders', funcQn: 'emit.main', direction: 'emit' }],
      [{ channelName: 'orders', direction: 'listen' }],
      'a', 'b',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      sourceProject: 'a',
      targetProject: 'b',
      edgeType: 'CROSS_CHANNEL',
      sourceQn: 'emit.main',
      targetQn: '__channel__orders',
      routePath: 'orders',
    });
  });

  it('matches listen → emit direction', () => {
    const matches = matchCrossProjectChannels(
      [{ channelName: 'events', funcQn: 'listen.main', direction: 'listen' }],
      [{ channelName: 'events', direction: 'emit' }],
      'a', 'b',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sourceQn).toBe('listen.main');
  });

  it('does not match same direction (emit → emit)', () => {
    const matches = matchCrossProjectChannels(
      [{ channelName: 'x', funcQn: 'e1', direction: 'emit' }],
      [{ channelName: 'x', direction: 'emit' }],
      'a', 'b',
    );
    expect(matches).toHaveLength(0);
  });

  it('does not match different channel names', () => {
    const matches = matchCrossProjectChannels(
      [{ channelName: 'foo', funcQn: 'e1', direction: 'emit' }],
      [{ channelName: 'bar', direction: 'listen' }],
      'a', 'b',
    );
    expect(matches).toHaveLength(0);
  });

  it('returns empty for empty inputs', () => {
    expect(matchCrossProjectChannels([], [{ channelName: 'x', direction: 'listen' }], 'a', 'b')).toHaveLength(0);
    expect(matchCrossProjectChannels([{ channelName: 'x', funcQn: 'e', direction: 'emit' }], [], 'a', 'b')).toHaveLength(0);
  });
});

describe('matchCrossProjectGrpc', () => {
  it('matches service/method pairs', () => {
    const matches = matchCrossProjectGrpc(
      [{ service: 'cart.CartService', method: 'GetCart', sourceQn: 'caller.main' }],
      [{ service: 'cart.CartService', method: 'GetCart' }],
      'a', 'b',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      sourceProject: 'a',
      targetProject: 'b',
      edgeType: 'CROSS_GRPC_CALLS',
      sourceQn: 'caller.main',
      targetQn: `${GRPC_PREFIX}cart.CartService/GetCart`,
      routePath: 'cart.CartService/GetCart',
    });
  });

  it('does not match mismatched methods', () => {
    const matches = matchCrossProjectGrpc(
      [{ service: 'S', method: 'M1', sourceQn: 'c' }],
      [{ service: 'S', method: 'M2' }],
      'a', 'b',
    );
    expect(matches).toHaveLength(0);
  });

  it('returns empty for empty inputs', () => {
    expect(matchCrossProjectGrpc([], [{ service: 'S', method: 'M' }], 'a', 'b')).toHaveLength(0);
    expect(matchCrossProjectGrpc([{ service: 'S', method: 'M', sourceQn: 'c' }], [], 'a', 'b')).toHaveLength(0);
  });
});
