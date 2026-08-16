// @code-analyzer/intelligence — GraphQL/tRPC Linking Tests
import { describe, it, expect } from 'vitest';
import {
  GRAPHQL_LIBRARIES,
  TRPC_LIBRARIES,
  classifyGraphQLCall,
  detectChannel,
  getChannelRules,
} from '../cross-service/graphql-linking.js';

describe('graphql-linking', () => {
  describe('GRAPHQL_LIBRARIES', () => {
    it('contains known GraphQL client libraries', () => {
      const ids = GRAPHQL_LIBRARIES.map((l) => l.libraryId);
      expect(ids).toContain('graphql-request');
      expect(ids).toContain('@apollo/client');
      expect(ids).toContain('gql');
    });

    it('all entries are GRAPHQL_CALLS kind', () => {
      for (const lib of GRAPHQL_LIBRARIES) {
        expect(lib.kind).toBe('GRAPHQL_CALLS');
      }
    });
  });

  describe('TRPC_LIBRARIES', () => {
    it('contains known tRPC libraries', () => {
      const ids = TRPC_LIBRARIES.map((l) => l.libraryId);
      expect(ids).toContain('@trpc/server');
      expect(ids).toContain('@trpc/client');
    });

    it('all entries are TRPC_CALLS kind', () => {
      for (const lib of TRPC_LIBRARIES) {
        expect(lib.kind).toBe('TRPC_CALLS');
      }
    });
  });

  describe('classifyGraphQLCall', () => {
    it('classifies query methods as QUERY', () => {
      expect(classifyGraphQLCall('query')).toBe('QUERY');
      expect(classifyGraphQLCall('client.query')).toBe('QUERY');
      expect(classifyGraphQLCall('readQuery')).toBe('QUERY');
      expect(classifyGraphQLCall('watchQuery')).toBe('QUERY');
    });

    it('classifies mutation methods as MUTATION', () => {
      expect(classifyGraphQLCall('mutate')).toBe('MUTATION');
      expect(classifyGraphQLCall('client.mutate')).toBe('MUTATION');
      expect(classifyGraphQLCall('writeQuery')).toBe('MUTATION');
    });

    it('classifies subscription methods as SUBSCRIPTION', () => {
      expect(classifyGraphQLCall('subscribe')).toBe('SUBSCRIPTION');
      expect(classifyGraphQLCall('subscribeToMore')).toBe('SUBSCRIPTION');
    });

    it('returns null for unknown methods', () => {
      expect(classifyGraphQLCall('unknown')).toBeNull();
      expect(classifyGraphQLCall('')).toBeNull();
      expect(classifyGraphQLCall('foo.bar')).toBeNull();
    });
  });

  describe('detectChannel', () => {
    it('detects socket.io emit', () => {
      const result = detectChannel('js', 'socket', 'emit', 'event');
      expect(result).not.toBeNull();
      expect(result!.transport).toBe('socketio');
      expect(result!.direction).toBe('emit');
      expect(result!.channelName).toBe('event');
    });

    it('detects socket.io listen', () => {
      const result = detectChannel('js', 'io', 'on', 'msg');
      expect(result!.transport).toBe('socketio');
      expect(result!.direction).toBe('listen');
    });

    it('detects EventEmitter emit', () => {
      const result = detectChannel('js', 'eventEmitter', 'emit');
      expect(result!.transport).toBe('event_emitter');
    });

    it('detects Kafka producer send', () => {
      const result = detectChannel('js', 'producer', 'send', 'topic');
      expect(result!.transport).toBe('kafka');
      expect(result!.direction).toBe('emit');
    });

    it('detects RabbitMQ publish', () => {
      const result = detectChannel('js', 'channel', 'publish');
      expect(result!.transport).toBe('rabbitmq');
    });

    it('detects Python websocket send', () => {
      const result = detectChannel('py', 'websocket', 'send_text');
      expect(result!.transport).toBe('websocket');
    });

    it('detects Go websocket WriteMessage', () => {
      const result = detectChannel('go', 'conn', 'WriteMessage');
      expect(result!.transport).toBe('websocket');
    });

    it('detects Java Spring STOMP', () => {
      const result = detectChannel('java', 'template', 'convertAndSend');
      expect(result!.transport).toBe('spring_websocket');
    });

    it('detects C# SignalR', () => {
      const result = detectChannel('csharp', 'Clients', 'SendAsync');
      expect(result!.transport).toBe('signalr');
    });

    it('detects Ruby ActionCable', () => {
      const result = detectChannel('ruby', 'server', 'broadcast');
      expect(result!.transport).toBe('actioncable');
    });

    it('detects Rust tokio-tungstenite', () => {
      const result = detectChannel('rust', 'sink', 'send');
      expect(result!.transport).toBe('websocket');
    });

    it('uses fallback channel name when firstArg absent', () => {
      const result = detectChannel('js', 'socket', 'emit');
      expect(result!.channelName).toBe('(socketio)');
    });

    it('matches receiver by tail segment after dot', () => {
      const result = detectChannel('js', 'myApp.socket', 'emit', 'evt');
      expect(result).not.toBeNull();
      expect(result!.transport).toBe('socketio');
    });

    it('returns null for unknown language/method combo', () => {
      expect(detectChannel('unknown', 'socket', 'emit')).toBeNull();
      expect(detectChannel('js', 'socket', 'unknownMethod')).toBeNull();
    });
  });

  describe('getChannelRules', () => {
    it('returns rules filtered by language', () => {
      const jsRules = getChannelRules('js');
      expect(jsRules.length).toBeGreaterThan(0);
      for (const r of jsRules) {
        expect(r.language).toBe('js');
      }
    });

    it('returns empty array for unknown language', () => {
      expect(getChannelRules('unknown')).toEqual([]);
    });
  });
});
