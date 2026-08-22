// @code-analyzer/intelligence — gRPC Linking Tests
import { describe, it, expect } from 'vitest';
import { GRPC_LIBRARIES, extractGrpcServiceMethod } from '../cross-service/grpc-linking.js';

describe('grpc-linking', () => {
  describe('GRPC_LIBRARIES', () => {
    it('contains known gRPC libraries', () => {
      const ids = GRPC_LIBRARIES.map((l) => l.libraryId);
      expect(ids).toContain('google.golang.org/grpc');
      expect(ids).toContain('grpc.insecure_channel');
      expect(ids).toContain('@grpc/grpc-js');
      expect(ids).toContain('tonic');
    });

    it('all entries are GRPC_CALLS kind', () => {
      for (const lib of GRPC_LIBRARIES) {
        expect(lib.kind).toBe('GRPC_CALLS');
      }
    });
  });

  describe('extractGrpcServiceMethod', () => {
    it('extracts simple Stub.getMethod pattern', () => {
      const result = extractGrpcServiceMethod('FooStub.getBar');
      expect(result).toEqual({ service: 'Foo', method: 'getBar' });
    });

    // NOTE: the docstring claims patterns like `pb.NewCartServiceClient(conn).GetCart`
    // are handled, but the current implementation uses a naive `lastIndexOf('.')`
    // and suffix-stripping that only works on simple `XxxStub.method` names.
    // Argument-bearing call chains (with `(conn)`) return null — a documented
    // limitation (doc-vs-code mismatch to reconcile in Iteration 6).
    it('returns null for argument-bearing call chains (documented limitation)', () => {
      expect(extractGrpcServiceMethod('pb.NewCartServiceClient(conn).GetCart')).toBeNull();
      expect(extractGrpcServiceMethod('NewOrderServiceClient(conn).CreateOrder')).toBeNull();
    });

    it('uses resolvedQn when it contains "Service"', () => {
      const result = extractGrpcServiceMethod(
        'client.getCart',
        'CartServiceGrpc.CartServiceBlockingStub',
      );
      expect(result).toEqual({ service: 'CartService', method: 'CartServiceBlockingStub' });
    });

    it('strips Stub/Client/Servicer suffixes', () => {
      expect(extractGrpcServiceMethod('FooClient.getBar')).toEqual({
        service: 'Foo',
        method: 'getBar',
      });
      expect(extractGrpcServiceMethod('FooServicer.getBar')).toEqual({
        service: 'Foo',
        method: 'getBar',
      });
      expect(extractGrpcServiceMethod('FooAsyncStub.getBar')).toEqual({
        service: 'Foo',
        method: 'getBar',
      });
      expect(extractGrpcServiceMethod('FooFutureStub.getBar')).toEqual({
        service: 'Foo',
        method: 'getBar',
      });
      expect(extractGrpcServiceMethod('FooGrpc.getBar')).toEqual({
        service: 'Foo',
        method: 'getBar',
      });
    });

    it('returns null for names without a dot', () => {
      expect(extractGrpcServiceMethod('noDot')).toBeNull();
    });

    it('returns null for trailing dot', () => {
      expect(extractGrpcServiceMethod('foo.')).toBeNull();
    });

    it('returns null when no suffix is stripped', () => {
      expect(extractGrpcServiceMethod('JustService.someMethod')).toBeNull();
    });

    it('returns null when service would be empty', () => {
      expect(extractGrpcServiceMethod('Client.getBar')).toBeNull();
    });
  });
});
