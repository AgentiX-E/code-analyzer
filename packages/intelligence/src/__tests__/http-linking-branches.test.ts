// @code-analyzer/intelligence — HTTP Linking Branch-Coverage Tests
// Exercises the remaining uncovered branches of the cross-service HTTP
// classification engine: callee-name fallback, route-decorator parsing
// (no-dot method, relative path, Java mapping), and URL extraction guards.

import { describe, it, expect } from 'vitest';
import { classifyCall, parseRouteDecorator } from '../cross-service/http-linking.js';
import type { ResolvedCall } from '../cross-service/types.js';

function makeCall(overrides: Partial<ResolvedCall> = {}): ResolvedCall {
  return {
    calleeName: 'x',
    resolvedQn: '',
    enclosingFuncQn: 'fn.main',
    ...overrides,
  };
}

describe('classifyCall — callee-name fallback', () => {
  it('classifies a non-fetch callee with a URL in args when the QN is empty', () => {
    const c = classifyCall(
      makeCall({
        calleeName: 'doStuff',
        resolvedQn: '',
        args: [{ expr: '/api/x', value: '/api/x', index: 0 }],
      }),
    );
    expect(c?.edgeType).toBe('HTTP_CALLS');
    expect(c?.via).toBe('arg_url');
    expect(c?.urlPath).toBe('/api/x');
  });

  it('returns null for a non-fetch callee with no URL and an empty QN', () => {
    expect(classifyCall(makeCall({ calleeName: 'doStuff', resolvedQn: '' }))).toBeNull();
  });
});

describe('parseRouteDecorator — call-style edge cases', () => {
  it('parses a bare (no-dot) method name into an HTTP method', () => {
    const r = parseRouteDecorator('get("/x")');
    expect(r?.method).toBe('GET');
    expect(r?.path).toBe('/x');
    expect(r?.framework).toBe('unknown');
  });

  it('parses a Java mapping name without the @ prefix', () => {
    const r = parseRouteDecorator('GetMapping("/x")');
    expect(r?.method).toBe('GET');
    expect(r?.framework).toBe('Spring');
  });

  it('rejects a call-style decorator whose path is not absolute', () => {
    expect(parseRouteDecorator('app.get("relative")')).toBeNull();
  });
});

describe('classifyCall — URL extraction guards', () => {
  it('drops an argument with an empty value and expression', () => {
    const c = classifyCall(
      makeCall({
        calleeName: 'requests.get',
        resolvedQn: 'requests.api.get',
        args: [{ expr: '', index: 0 }],
      }),
    );
    expect(c?.edgeType).toBe('HTTP_CALLS');
    expect(c?.urlPath).toBeUndefined();
  });

  it('rejects a hidden-directory path outside filesystem roots', () => {
    const c = classifyCall(
      makeCall({
        calleeName: 'something',
        resolvedQn: 'unknown.lib.call',
        args: [{ expr: '/app/.aws/credentials', value: '/app/.aws/credentials', index: 0 }],
      }),
    );
    expect(c).toBeNull();
  });

  it('rejects a single-segment path that normalizes to an empty URL', () => {
    const c = classifyCall(
      makeCall({
        calleeName: 'something',
        resolvedQn: 'unknown.lib.call',
        args: [{ expr: '/foo', value: '/foo', index: 0 }],
      }),
    );
    expect(c).toBeNull();
  });

  it('preserves an absolute https URL from a global fetch', () => {
    const c = classifyCall(
      makeCall({
        calleeName: 'fetch',
        resolvedQn: '',
        args: [{ expr: 'https://example.com/x', value: 'https://example.com/x', index: 0 }],
      }),
    );
    expect(c?.edgeType).toBe('HTTP_CALLS');
    expect(c?.via).toBe('arg_url');
    expect(c?.urlPath).toBe('https://example.com/x');
  });

  it('preserves an absolute http URL in the arg_url fallback', () => {
    const c = classifyCall(
      makeCall({
        calleeName: 'something',
        resolvedQn: 'unknown.lib.call',
        args: [
          { expr: 'http://api.example.com/users', value: 'http://api.example.com/users', index: 0 },
        ],
      }),
    );
    expect(c?.edgeType).toBe('HTTP_CALLS');
    expect(c?.via).toBe('arg_url');
    expect(c?.urlPath).toBe('http://api.example.com/users');
  });

  it('still rejects a protocol-relative URL', () => {
    const c = classifyCall(
      makeCall({
        calleeName: 'something',
        resolvedQn: 'unknown.lib.call',
        args: [{ expr: '//cdn.example.com/lib.js', value: '//cdn.example.com/lib.js', index: 0 }],
      }),
    );
    expect(c).toBeNull();
  });

  it('still rejects a non-http absolute URL scheme', () => {
    const c = classifyCall(
      makeCall({
        calleeName: 'something',
        resolvedQn: 'unknown.lib.call',
        args: [{ expr: 'ftp://example.com/file', value: 'ftp://example.com/file', index: 0 }],
      }),
    );
    expect(c).toBeNull();
  });
});
