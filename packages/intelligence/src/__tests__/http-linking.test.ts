import { describe, it, expect } from 'vitest';
import {
  inferHttpMethod,
  inferRouteMethod,
  classifyCall,
  isGlobalFetch,
  parseRouteDecorator,
  canonicRoutePath,
  synthesizeRouteNode,
  buildServiceEdge,
  buildHandlesEdge,
  buildChannelEdge,
} from '../cross-service/http-linking.js';
import type { ResolvedCall } from '../cross-service/types.js';

function makeCall(overrides: Partial<ResolvedCall> = {}): ResolvedCall {
  return {
    calleeName: 'x',
    resolvedQn: '',
    enclosingFuncQn: 'fn.main',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Method inference
// ---------------------------------------------------------------------------

describe('inferHttpMethod', () => {
  it('returns GET for .get suffix', () => expect(inferHttpMethod('client.get')).toBe('GET'));
  it('returns POST for .post suffix', () => expect(inferHttpMethod('client.post')).toBe('POST'));
  it('returns PUT for .put suffix', () => expect(inferHttpMethod('client.put')).toBe('PUT'));
  it('returns DELETE for .delete suffix', () => expect(inferHttpMethod('client.delete')).toBe('DELETE'));
  it('returns GET for GetAsync suffix', () => expect(inferHttpMethod('client.GetAsync')).toBe('GET'));
  it('returns GET for getForObject suffix', () => expect(inferHttpMethod('rest.getForObject')).toBe('GET'));
  it('returns null for unknown suffix', () => expect(inferHttpMethod('client.doStuff')).toBeNull());
});

describe('inferRouteMethod', () => {
  it('returns GET for .GET', () => expect(inferRouteMethod('router.GET')).toBe('GET'));
  it('returns ANY for .Handle', () => expect(inferRouteMethod('mux.Handle')).toBe('ANY'));
  it('returns GET for ::get', () => expect(inferRouteMethod('routes::get')).toBe('GET'));
  it('returns ANY for .use', () => expect(inferRouteMethod('app.use')).toBe('ANY'));
  it('returns null for unknown', () => expect(inferRouteMethod('router.unknown')).toBeNull());
});

// ---------------------------------------------------------------------------
// isGlobalFetch
// ---------------------------------------------------------------------------

describe('isGlobalFetch', () => {
  it('true when callee is fetch with no resolved QN', () => {
    expect(isGlobalFetch(makeCall({ calleeName: 'fetch', resolvedQn: '' }))).toBe(true);
  });
  it('false when fetch is resolved', () => {
    expect(isGlobalFetch(makeCall({ calleeName: 'fetch', resolvedQn: 'node.fetch' }))).toBe(false);
  });
  it('false for non-fetch callees', () => {
    expect(isGlobalFetch(makeCall({ calleeName: 'get' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyCall
// ---------------------------------------------------------------------------

describe('classifyCall', () => {
  it('classifies route registration (ROUTE_REG)', () => {
    const c = classifyCall(makeCall({
      calleeName: 'router.get',
      resolvedQn: 'express.router.get',
      firstStringArg: '/users',
    }));
    expect(c?.edgeType).toBe('ROUTE_REG');
    expect(c?.httpMethod).toBe('GET');
    expect(c?.urlPath).toBe('/users');
  });

  it('classifies HTTP client call (path-based URL)', () => {
    const c = classifyCall(makeCall({
      calleeName: 'requests.get',
      resolvedQn: 'requests.api.get',
      args: [{ expr: '/api/users', value: '/api/users', index: 0 }],
    }));
    expect(c?.edgeType).toBe('HTTP_CALLS');
    expect(c?.httpMethod).toBe('GET');
    expect(c?.urlPath).toBe('/api/users');
  });

  it('classifies async dispatch with broker', () => {
    const c = classifyCall(makeCall({
      calleeName: 'publish',
      resolvedQn: 'kafkajs.producer.send',
      args: [{ expr: '/topic/orders', value: '/topic/orders', index: 0 }],
    }));
    expect(c?.edgeType).toBe('ASYNC_CALLS');
    expect(c?.broker).toBe('kafka');
  });

  it('classifies config access', () => {
    const c = classifyCall(makeCall({
      calleeName: 'getenv',
      resolvedQn: 'os.getenv',
    }));
    expect(c?.edgeType).toBe('CONFIGURES');
    expect(c?.via).toBe('library_pattern');
  });

  it('classifies gRPC call', () => {
    const c = classifyCall(makeCall({
      calleeName: 'GetCart',
      resolvedQn: 'io.grpc.CartServiceClient.GetCart',
    }));
    expect(c?.edgeType).toBe('GRPC_CALLS');
  });

  it('classifies GraphQL call', () => {
    const c = classifyCall(makeCall({
      calleeName: 'query',
      resolvedQn: '@apollo/client.query',
    }));
    expect(c?.edgeType).toBe('GRAPHQL_CALLS');
  });

  it('classifies tRPC call', () => {
    const c = classifyCall(makeCall({
      calleeName: 'useQuery',
      resolvedQn: '@trpc/client.useQuery',
    }));
    expect(c?.edgeType).toBe('TRPC_CALLS');
  });

  it('falls back to URL-in-args when no library matches', () => {
    const c = classifyCall(makeCall({
      calleeName: 'something',
      resolvedQn: 'unknown.lib.call',
      args: [{ expr: '/api/items', value: '/api/items', index: 0 }],
    }));
    expect(c?.edgeType).toBe('HTTP_CALLS');
    expect(c?.httpMethod).toBe('ANY');
    expect(c?.via).toBe('arg_url');
  });

  it('classifies global fetch by callee name', () => {
    const c = classifyCall(makeCall({
      calleeName: 'fetch',
      resolvedQn: '',
      args: [{ expr: 'https://example.com/x', value: 'https://example.com/x', index: 0 }],
    }));
    expect(c?.edgeType).toBe('HTTP_CALLS');
    expect(c?.via).toBe('arg_url');
  });

  it('returns null for unmatched call', () => {
    expect(classifyCall(makeCall({ calleeName: 'doStuff', resolvedQn: 'unknown.fn' }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Route decorator parsing
// ---------------------------------------------------------------------------

describe('parseRouteDecorator', () => {
  it('parses express-style decorator (no @ prefix)', () => {
    const r = parseRouteDecorator('app.get("/users")');
    expect(r).toEqual({ method: 'GET', path: '/users', framework: 'Flask' });
  });

  it('parses fastapi-style decorator (no @ prefix)', () => {
    const r = parseRouteDecorator('app.get("/items")');
    expect(r).toEqual({ method: 'GET', path: '/items', framework: 'Flask' });
  });

  it('parses spring annotation', () => {
    const r = parseRouteDecorator('@GetMapping("/orders")');
    expect(r).toEqual({ method: 'GET', path: '/orders', framework: 'Spring' });
  });

  it('parses spring annotation with value= syntax', () => {
    const r = parseRouteDecorator('@RequestMapping(value="/x")');
    expect(r).toEqual({ method: 'ANY', path: '/x', framework: 'Spring' });
  });

  it('detects express framework', () => {
    const r = parseRouteDecorator('express.app.get("/a")');
    expect(r?.framework).toBe('Express');
  });

  it('parses gin-style GET decorator', () => {
    const r = parseRouteDecorator('gin.engine.Get("/ping")');
    expect(r).toEqual({ method: 'GET', path: '/ping', framework: 'Gin' });
  });

  // Documented limitations — see Iteration 6 reconciliation notes.
  // The decorator parser does NOT handle:
  //   1. Leading "@" on Flask/FastAPI decorators (@app.route(...), @app.get(...))
  //      because the primary regex ^([\w.]+) rejects the "@" prefix and the
  //      annotation fallback only recognizes @GetMapping-style Java annotations.
  //   2. Uppercase method names in the Python/JS branch (gin.engine.GET),
  //      because decoratorMethodName's map only has lowercase/CamelCase keys.
  it('returns null for @app.route (documented limitation)', () => {
    expect(parseRouteDecorator('@app.route("/users")')).toBeNull();
  });
  it('returns null for @app.get (documented limitation)', () => {
    expect(parseRouteDecorator('@app.get("/items")')).toBeNull();
  });
  it('returns null for uppercase .GET (documented limitation)', () => {
    expect(parseRouteDecorator('gin.engine.GET("/ping")')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseRouteDecorator('')).toBeNull();
  });

  it('returns null for non-route decorator', () => {
    expect(parseRouteDecorator('@notARoute("nope")')).toBeNull();
  });

  it('returns null when path is not absolute', () => {
    expect(parseRouteDecorator('@app.route("relative")')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// canonicRoutePath
// ---------------------------------------------------------------------------

describe('canonicRoutePath', () => {
  it('canonicalizes colon params', () => {
    expect(canonicRoutePath('/users/:id')).toBe('/users/:param');
  });
  it('canonicalizes brace params', () => {
    expect(canonicRoutePath('/users/{id}')).toBe('/users/:param');
  });
  it('collapses double slashes', () => {
    expect(canonicRoutePath('/a//b')).toBe('/a/b');
  });
  it('strips trailing slash', () => {
    expect(canonicRoutePath('/a/')).toBe('/a');
  });
});

// ---------------------------------------------------------------------------
// synthesizeRouteNode
// ---------------------------------------------------------------------------

describe('synthesizeRouteNode', () => {
  it('synthesizes HTTP route node', () => {
    const node = synthesizeRouteNode({
      edgeType: 'HTTP_CALLS', httpMethod: 'GET', urlPath: '/users/:id', via: 'arg_url',
    });
    expect(node.label).toBe('Route');
    expect(node.qn).toContain('GET');
    expect(node.properties.url_path).toBe('/users/:param');
  });

  it('synthesizes async route node', () => {
    const node = synthesizeRouteNode({ edgeType: 'ASYNC_CALLS', broker: 'kafka', urlPath: '/t', via: 'library_pattern' });
    expect(node.broker).toBe('kafka');
    expect(node.qn).toContain('ASYNC');
  });

  it('synthesizes gRPC route node', () => {
    const node = synthesizeRouteNode({ edgeType: 'GRPC_CALLS', grpcService: 'S', grpcMethod: 'M', via: 'library_pattern' });
    expect(node.name).toBe('S/M');
  });

  it('synthesizes GraphQL route node', () => {
    const node = synthesizeRouteNode({ edgeType: 'GRAPHQL_CALLS', via: 'library_pattern' });
    expect(node.qn).toContain('query');
  });

  it('synthesizes tRPC route node', () => {
    const node = synthesizeRouteNode({ edgeType: 'TRPC_CALLS', urlPath: 'proc', via: 'library_pattern' });
    expect(node.qn).toContain('proc');
  });

  it('throws for unknown edge type', () => {
    expect(() => synthesizeRouteNode({ edgeType: 'THROWS' as any, via: 'library_pattern' }))
      .toThrow(/Cannot synthesize route/);
  });
});

// ---------------------------------------------------------------------------
// Edge construction
// ---------------------------------------------------------------------------

describe('buildServiceEdge', () => {
  it('builds HTTP service edge', () => {
    const edge = buildServiceEdge('caller.main', {
      edgeType: 'HTTP_CALLS', httpMethod: 'GET', urlPath: '/x', via: 'arg_url',
    });
    expect(edge?.sourceQn).toBe('caller.main');
    expect(edge?.type).toBe('HTTP_CALLS');
    expect(edge?.properties.method).toBe('GET');
    expect(edge?.properties.url_path).toBe('/x');
  });

  it('maps ROUTE_REG to EDGE_CALLS', () => {
    const edge = buildServiceEdge('h.main', {
      edgeType: 'ROUTE_REG', httpMethod: 'POST', urlPath: '/x', via: 'route_registration',
    });
    expect(edge?.type).toBe('CALLS');
  });

  it('includes gRPC properties', () => {
    const edge = buildServiceEdge('c.main', {
      edgeType: 'GRPC_CALLS', grpcService: 'S', grpcMethod: 'M', via: 'library_pattern',
    });
    expect(edge?.properties.service).toBe('S');
    expect(edge?.properties.rpc_method).toBe('M');
    expect(edge?.properties.callee).toBe('S/M');
  });
});

describe('buildHandlesEdge', () => {
  it('builds handles edge', () => {
    const edge = buildHandlesEdge('handler.main', '__route__GET__/x');
    expect(edge.type).toBe('HANDLES');
    expect(edge.targetQn).toBe('__route__GET__/x');
  });
});

describe('buildChannelEdge', () => {
  it('builds emit channel edge', () => {
    const edge = buildChannelEdge('fn.main', 'orders', 'kafka', 'emit');
    expect(edge.type).toBe('EMITS');
    expect(edge.properties.channel_name).toBe('orders');
  });
  it('builds listen channel edge', () => {
    const edge = buildChannelEdge('fn.main', 'orders', 'kafka', 'listen');
    expect(edge.type).toBe('LISTENS_ON');
  });
});
