import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';

import { AuditLogger } from '../security/audit-logger.js';
import type { AuditSummary } from '../security/audit-logger.js';

const TEST_EXPORT_PATH = '/tmp/audit-export-test.jsonl';
const TEST_PERSIST_PATH = '/tmp/audit-persist-test.jsonl';

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  afterEach(() => {
    if (existsSync(TEST_EXPORT_PATH)) unlinkSync(TEST_EXPORT_PATH);
    if (existsSync(TEST_PERSIST_PATH)) unlinkSync(TEST_PERSIST_PATH);
  });

  // -----------------------------------------------------------------------
  // Event Logging
  // -----------------------------------------------------------------------

  describe('log', () => {
    it('should log an audit event and return an ID', () => {
      const id = logger.log({
        actor: 'alice',
        action: 'read',
        resource: 'project:my-project',
        outcome: 'success',
      });

      expect(id).toBeDefined();
      expect(id).toMatch(/^audit_/);
      expect(logger.getCount()).toBe(1);
    });

    it('should generate unique IDs for each event', () => {
      const id1 = logger.log({ actor: 'alice', action: 'read', resource: 'a', outcome: 'success' });
      const id2 = logger.log({ actor: 'bob', action: 'write', resource: 'b', outcome: 'success' });

      expect(id1).not.toBe(id2);
    });

    it('should set timestamp automatically', () => {
      logger.log({ actor: 'alice', action: 'read', resource: 'x', outcome: 'success' });
      const events = logger.query({});

      expect(events[0]).toBeDefined();
      expect(events[0]!.timestamp).toBeDefined();
      expect(new Date(events[0]!.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should include optional fields', () => {
      logger.log({
        actor: 'alice',
        action: 'read',
        resource: 'project:x',
        outcome: 'denied',
        details: { reason: 'insufficient permissions' },
        clientIp: '10.0.0.1',
        correlationId: 'corr-123',
      });

      const events = logger.query({});
      expect(events[0]!.details).toEqual({ reason: 'insufficient permissions' });
      expect(events[0]!.clientIp).toBe('10.0.0.1');
      expect(events[0]!.correlationId).toBe('corr-123');
    });
  });

  // -----------------------------------------------------------------------
  // Querying
  // -----------------------------------------------------------------------

  describe('query', () => {
    beforeEach(() => {
      logger.log({ actor: 'alice', action: 'read', resource: 'a', outcome: 'success' });
      logger.log({ actor: 'alice', action: 'write', resource: 'b', outcome: 'success' });
      logger.log({ actor: 'bob', action: 'read', resource: 'a', outcome: 'denied' });
      logger.log({ actor: 'bob', action: 'write', resource: 'c', outcome: 'failure' });
    });

    it('should return all events with empty query', () => {
      expect(logger.query({})).toHaveLength(4);
    });

    it('should filter by actor', () => {
      const results = logger.query({ actor: 'alice' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.actor === 'alice')).toBe(true);
    });

    it('should filter by action', () => {
      const results = logger.query({ action: 'read' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.action === 'read')).toBe(true);
    });

    it('should filter by resource', () => {
      const results = logger.query({ resource: 'a' });
      expect(results).toHaveLength(2);
    });

    it('should filter by outcome', () => {
      const results = logger.query({ outcome: 'denied' });
      expect(results).toHaveLength(1);
      expect(results[0]!.outcome).toBe('denied');
    });

    it('should filter by time range (from)', async () => {
      // Add a slight delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 5));

      const markerTime = new Date().toISOString();
      logger.log({ actor: 'charlie', action: 'read', resource: 'd', outcome: 'success' });

      const results = logger.query({ from: markerTime });
      expect(results).toHaveLength(1);
      expect(results[0]!.actor).toBe('charlie');
    });

    it('should filter by time range (to)', async () => {
      const markerTime = new Date().toISOString();

      // Small delay to ensure timestamp separation
      await new Promise((r) => setTimeout(r, 10));
      logger.log({ actor: 'charlie', action: 'read', resource: 'd', outcome: 'success' });

      const results = logger.query({ to: markerTime });
      expect(results.every((e) => e.actor !== 'charlie')).toBe(true);
    });

    it('should filter by time range (from and to)', () => {
      const results = logger.query({
        from: '2020-01-01T00:00:00.000Z',
        to: '2030-01-01T00:00:00.000Z',
      });
      expect(results).toHaveLength(4);
    });

    it('should apply limit', () => {
      const results = logger.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('should combine multiple filters', () => {
      const results = logger.query({ actor: 'alice', action: 'read', outcome: 'success' });
      expect(results).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------

  describe('getSummary', () => {
    beforeEach(() => {
      logger.log({ actor: 'alice', action: 'read', resource: 'a', outcome: 'success' });
      logger.log({ actor: 'alice', action: 'write', resource: 'b', outcome: 'success' });
      logger.log({ actor: 'bob', action: 'read', resource: 'a', outcome: 'denied' });
      logger.log({ actor: 'bob', action: 'write', resource: 'c', outcome: 'failure' });
    });

    it('should return correct total count', () => {
      const summary = logger.getSummary();
      expect(summary.totalEvents).toBe(4);
    });

    it('should count by action', () => {
      const summary = logger.getSummary();
      expect(summary.byAction['read']).toBe(2);
      expect(summary.byAction['write']).toBe(2);
    });

    it('should count by outcome', () => {
      const summary = logger.getSummary();
      expect(summary.byOutcome['success']).toBe(2);
      expect(summary.byOutcome['denied']).toBe(1);
      expect(summary.byOutcome['failure']).toBe(1);
    });

    it('should count by actor', () => {
      const summary = logger.getSummary();
      expect(summary.byActor['alice']).toBe(2);
      expect(summary.byActor['bob']).toBe(2);
    });

    it('should count failures', () => {
      const summary = logger.getSummary();
      expect(summary.failures).toBe(1);
    });

    it('should count denied', () => {
      const summary = logger.getSummary();
      expect(summary.denied).toBe(1);
    });

    it('should filter by time range', () => {
      const summary = logger.getSummary('2020-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z');
      expect(summary.totalEvents).toBe(4);
    });

    it('should return zeros for empty time range', () => {
      const summary = logger.getSummary('2030-01-01T00:00:00.000Z', '2030-01-02T00:00:00.000Z');
      expect(summary.totalEvents).toBe(0);
    });

    it('should have correct type structure', () => {
      const summary: AuditSummary = logger.getSummary();
      expect(typeof summary.totalEvents).toBe('number');
      expect(typeof summary.byAction).toBe('object');
      expect(typeof summary.byOutcome).toBe('object');
      expect(typeof summary.byActor).toBe('object');
      expect(typeof summary.failures).toBe('number');
      expect(typeof summary.denied).toBe('number');
    });
  });

  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------

  describe('export', () => {
    it('should export events to JSON Lines file', async () => {
      logger.log({ actor: 'alice', action: 'read', resource: 'a', outcome: 'success' });
      logger.log({ actor: 'bob', action: 'write', resource: 'b', outcome: 'failure' });

      await logger.export(TEST_EXPORT_PATH);

      expect(existsSync(TEST_EXPORT_PATH)).toBe(true);

      const content = await import('fs').then((fs) => fs.readFileSync(TEST_EXPORT_PATH, 'utf-8'));
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);

      const parsed = lines.map((l: string) => JSON.parse(l));
      expect(parsed[0].actor).toBe('alice');
      expect(parsed[1].actor).toBe('bob');
    });

    it('should export empty file when no events', async () => {
      await logger.export(TEST_EXPORT_PATH);

      expect(existsSync(TEST_EXPORT_PATH)).toBe(true);
      const content = await import('fs').then((fs) => fs.readFileSync(TEST_EXPORT_PATH, 'utf-8'));
      expect(content.trim()).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // Buffering
  // -----------------------------------------------------------------------

  describe('flush (buffer management)', () => {
    it('should track events in buffer', () => {
      const bufferedLogger = new AuditLogger({ bufferSize: 3 });
      bufferedLogger.log({ actor: 'a', action: 'x', resource: 'r', outcome: 'success' });
      bufferedLogger.log({ actor: 'b', action: 'x', resource: 'r', outcome: 'success' });

      expect(bufferedLogger.getCount()).toBe(2);
    });

    it('should auto-flush when buffer is full', () => {
      const bufferedLogger = new AuditLogger({ bufferSize: 3 });
      bufferedLogger.log({ actor: 'a', action: 'x', resource: 'r', outcome: 'success' });
      bufferedLogger.log({ actor: 'b', action: 'x', resource: 'r', outcome: 'success' });
      bufferedLogger.log({ actor: 'c', action: 'x', resource: 'r', outcome: 'success' });

      // All three should be in events array
      expect(bufferedLogger.getCount()).toBe(3);
    });

    it('should flush to file when persistToFile is set', () => {
      const persistLogger = new AuditLogger({
        persistToFile: TEST_PERSIST_PATH,
        bufferSize: 2,
      });

      persistLogger.log({ actor: 'a', action: 'x', resource: 'r', outcome: 'success' });
      persistLogger.log({ actor: 'b', action: 'x', resource: 'r', outcome: 'success' });

      persistLogger.flush();

      // Events should still be queryable
      expect(persistLogger.getCount()).toBe(2);
    });

    it('should handle flush with no buffered events', () => {
      expect(() => logger.flush()).not.toThrow();
    });

    it('should handle flush without persistToFile option', () => {
      logger.log({ actor: 'a', action: 'x', resource: 'r', outcome: 'success' });
      expect(() => logger.flush()).not.toThrow();
      expect(logger.getCount()).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Get Count
  // -----------------------------------------------------------------------

  describe('getCount', () => {
    it('should return 0 for empty logger', () => {
      expect(logger.getCount()).toBe(0);
    });

    it('should return correct count after logging', () => {
      logger.log({ actor: 'a', action: 'x', resource: 'r', outcome: 'success' });
      logger.log({ actor: 'b', action: 'y', resource: 'r', outcome: 'success' });
      logger.log({ actor: 'c', action: 'z', resource: 'r', outcome: 'success' });

      expect(logger.getCount()).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Buffer Size Options
  // -----------------------------------------------------------------------

  describe('constructor options', () => {
    it('should use custom buffer size', () => {
      const customLogger = new AuditLogger({ bufferSize: 5 });
      for (let i = 0; i < 5; i++) {
        customLogger.log({ actor: 'a', action: 'x', resource: `${i}`, outcome: 'success' });
      }
      expect(customLogger.getCount()).toBe(5);
    });

    it('should use default buffer size when not specified', () => {
      const defaultLogger = new AuditLogger();
      expect(defaultLogger.getCount()).toBe(0);
    });
  });
});
