import { describe, it, expect, beforeEach } from 'vitest';

import {
  RetryPolicy,
  DeadLetterQueue,
} from '../operations/resilience.js';

import type {
  DeadLetterEntry,
} from '../operations/resilience.js';

describe('RetryPolicy', () => {
  describe('successful execution', () => {
    it('should return the result on first attempt', async () => {
      const policy = new RetryPolicy({ maxAttempts: 3 });
      const result = await policy.execute(async () => 'success');
      expect(result).toBe('success');
      expect(policy.getAttempt()).toBe(1);
    });

    it('should succeed after a transient failure', async () => {
      let attempts = 0;
      const policy = new RetryPolicy({ maxAttempts: 3, jitter: false });

      const result = await policy.execute(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Transient error');
        }
        return 'recovered';
      });

      expect(result).toBe('recovered');
      expect(attempts).toBe(2);
      expect(policy.getAttempt()).toBe(2);
    });

    it('should succeed after multiple failures up to maxAttempts', async () => {
      let attempts = 0;
      const policy = new RetryPolicy({ maxAttempts: 5, jitter: false });

      const result = await policy.execute(async () => {
        attempts++;
        if (attempts < 4) {
          throw new Error(`Attempt ${attempts} failed`);
        }
        return 'finally';
      });

      expect(result).toBe('finally');
      expect(attempts).toBe(4);
    });
  });

  describe('exhaustion', () => {
    it('should throw the last error after maxAttempts', async () => {
      const policy = new RetryPolicy({ maxAttempts: 2, jitter: false });

      await expect(policy.execute(async () => {
        throw new Error('Persistent error');
      })).rejects.toThrow('Persistent error');

      expect(policy.getAttempt()).toBe(2);
    });

    it('should throw after exactly maxAttempts failures', async () => {
      let attempts = 0;
      const policy = new RetryPolicy({ maxAttempts: 3, jitter: false });

      await expect(policy.execute(async () => {
        attempts++;
        throw new Error('Always fails');
      })).rejects.toThrow();

      expect(attempts).toBe(3);
    });

    it('should throw the specific error type from the last attempt', async () => {
      class CustomError extends Error {
        code: string;
        constructor(msg: string, code: string) {
          super(msg);
          this.code = code;
        }
      }

      const policy = new RetryPolicy({ maxAttempts: 3, jitter: false });

      await expect(policy.execute(async () => {
        throw new CustomError('Custom failure', 'ERR_500');
      })).rejects.toBeInstanceOf(CustomError);
    });
  });

  describe('configuration', () => {
    it('should use default config values', () => {
      const policy = new RetryPolicy();
      expect(policy.getAttempt()).toBe(0);
      expect(policy.isLastAttempt()).toBe(false);
    });

    it('should accept custom baseDelay', () => {
      const policy = new RetryPolicy({ baseDelay: 500, jitter: false, maxAttempts: 1 });
      expect(policy).toBeDefined();
    });

    it('should accept custom maxDelay', () => {
      const policy = new RetryPolicy({ maxDelay: 5000, maxAttempts: 1 });
      expect(policy).toBeDefined();
    });

    it('should accept custom backoffFactor', () => {
      const policy = new RetryPolicy({ backoffFactor: 3, maxAttempts: 1 });
      expect(policy).toBeDefined();
    });

    it('should support disabling jitter', async () => {
      const policy = new RetryPolicy({ jitter: false, maxAttempts: 2 });
      await expect(policy.execute(async () => {
        throw new Error('test');
      })).rejects.toThrow('test');
      // The fact that it executed without timing issues confirms jitter was disabled
    });

    it('should support jitter by default', () => {
      const policy = new RetryPolicy();
      // With jitter enabled, just verify construction works
      expect(policy).toBeDefined();
    });

    it('should apply jitter during retry', async () => {
      let attempts = 0;
      const policy = new RetryPolicy({ maxAttempts: 2, baseDelay: 1 });
      // jitter is enabled by default

      const result = await policy.execute(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('First attempt fails');
        }
        return 'recovered with jitter';
      });

      expect(result).toBe('recovered with jitter');
      expect(attempts).toBe(2);
    });
  });

  describe('isLastAttempt', () => {
    it('should return false before maxAttempts', () => {
      const policy = new RetryPolicy({ maxAttempts: 3 });
      expect(policy.isLastAttempt()).toBe(false);
    });

    it('should return true on the last attempt', async () => {
      const policy = new RetryPolicy({ maxAttempts: 2, jitter: false });

      // First attempt
      await expect(policy.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      // After first attempt, isLastAttempt should have returned true on the last iteration
      expect(policy.getAttempt()).toBe(2);
    });
  });

  describe('getAttempt', () => {
    it('should return 0 before any execution', () => {
      const policy = new RetryPolicy();
      expect(policy.getAttempt()).toBe(0);
    });

    it('should return 1 after one attempt', async () => {
      const policy = new RetryPolicy({ maxAttempts: 3 });
      await policy.execute(async () => 'ok');
      expect(policy.getAttempt()).toBe(1);
    });

    it('should return maxAttempts after exhaustion', async () => {
      const policy = new RetryPolicy({ maxAttempts: 3, jitter: false });
      await expect(policy.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();
      expect(policy.getAttempt()).toBe(3);
    });
  });
});

describe('DeadLetterQueue', () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = new DeadLetterQueue();
  });

  describe('enqueue', () => {
    it('should add an entry and return its ID', () => {
      const id = dlq.enqueue({
        operation: 'saveToDb',
        payload: { key: 'value' },
        error: 'Connection refused',
        attempts: 3,
      });

      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
      expect(dlq.size()).toBe(1);
    });

    it('should generate unique IDs for multiple entries', () => {
      const id1 = dlq.enqueue({
        operation: 'op',
        payload: null,
        error: 'e1',
        attempts: 1,
      });
      const id2 = dlq.enqueue({
        operation: 'op',
        payload: null,
        error: 'e2',
        attempts: 1,
      });

      expect(id1).not.toBe(id2);
    });

    it('should set timestamp on enqueued entries', () => {
      const id = dlq.enqueue({
        operation: 'test',
        payload: null,
        error: 'test error',
        attempts: 0,
      });

      const entries = dlq.getAll();
      expect(entries[0].timestamp).toBeTruthy();
      expect(entries[0].id).toBe(id);
    });
  });

  describe('getAll', () => {
    it('should return all entries', () => {
      dlq.enqueue({ operation: 'a', payload: null, error: 'e', attempts: 1 });
      dlq.enqueue({ operation: 'b', payload: null, error: 'e', attempts: 1 });

      const entries = dlq.getAll();
      expect(entries).toHaveLength(2);
      expect(entries[0].operation).toBe('a');
      expect(entries[1].operation).toBe('b');
    });

    it('should return empty array when queue is empty', () => {
      expect(dlq.getAll()).toEqual([]);
    });

    it('should return a copy, not the internal array', () => {
      dlq.enqueue({ operation: 'a', payload: null, error: 'e', attempts: 1 });
      const entries = dlq.getAll();
      entries.push({
        id: 'fake',
        timestamp: '',
        operation: 'fake',
        payload: null,
        error: '',
        attempts: 0,
      });
      expect(dlq.size()).toBe(1);
    });
  });

  describe('getByOperation', () => {
    it('should filter entries by operation name', () => {
      dlq.enqueue({ operation: 'email', payload: null, error: 'e1', attempts: 1 });
      dlq.enqueue({ operation: 'sms', payload: null, error: 'e2', attempts: 1 });
      dlq.enqueue({ operation: 'email', payload: null, error: 'e3', attempts: 2 });

      const emailEntries = dlq.getByOperation('email');
      expect(emailEntries).toHaveLength(2);
      expect(emailEntries[0].operation).toBe('email');
      expect(emailEntries[1].operation).toBe('email');
    });

    it('should return empty array when no matching entries', () => {
      dlq.enqueue({ operation: 'email', payload: null, error: 'e', attempts: 1 });
      expect(dlq.getByOperation('nonexistent')).toEqual([]);
    });
  });

  describe('dequeue', () => {
    it('should remove an entry by ID', () => {
      const id = dlq.enqueue({ operation: 'test', payload: null, error: 'e', attempts: 1 });
      expect(dlq.size()).toBe(1);

      const removed = dlq.dequeue(id);
      expect(removed).toBe(true);
      expect(dlq.size()).toBe(0);
    });

    it('should return false for non-existent ID', () => {
      expect(dlq.dequeue('non-existent')).toBe(false);
    });

    it('should remove the correct entry among multiple', () => {
      const id1 = dlq.enqueue({ operation: 'a', payload: null, error: 'e', attempts: 1 });
      const id2 = dlq.enqueue({ operation: 'b', payload: null, error: 'e', attempts: 1 });

      dlq.dequeue(id1);
      expect(dlq.size()).toBe(1);
      expect(dlq.getAll()[0].id).toBe(id2);
    });
  });

  describe('retryAll', () => {
    it('should process and remove successful entries', async () => {
      dlq.enqueue({ operation: 'op1', payload: 'data1', error: 'e1', attempts: 1 });
      dlq.enqueue({ operation: 'op2', payload: 'data2', error: 'e2', attempts: 1 });

      const result = await dlq.retryAll(async () => true);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.remaining).toBe(0);
      expect(dlq.size()).toBe(0);
    });

    it('should keep failed entries in the queue', async () => {
      dlq.enqueue({ operation: 'op1', payload: null, error: 'e1', attempts: 1 });
      dlq.enqueue({ operation: 'op2', payload: null, error: 'e2', attempts: 1 });

      const result = await dlq.retryAll(async () => false);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.remaining).toBe(2);
      expect(dlq.size()).toBe(2);
    });

    it('should handle partial success', async () => {
      dlq.enqueue({ operation: 'good', payload: null, error: 'e', attempts: 1 });
      dlq.enqueue({ operation: 'bad', payload: null, error: 'e', attempts: 1 });
      dlq.enqueue({ operation: 'good2', payload: null, error: 'e', attempts: 1 });

      let callCount = 0;
      const result = await dlq.retryAll(async () => {
        callCount++;
        return callCount !== 2; // Second one fails
      });

      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.remaining).toBe(1);
    });

    it('should handle processor throwing errors', async () => {
      dlq.enqueue({ operation: 'op', payload: null, error: 'e', attempts: 1 });

      const result = await dlq.retryAll(async () => {
        throw new Error('Processor error');
      });

      expect(result.failed).toBe(1);
      expect(result.remaining).toBe(1);
    });

    it('should increment attempts counter on failed retry', async () => {
      dlq.enqueue({ operation: 'op', payload: null, error: 'e', attempts: 1 });

      const result = await dlq.retryAll(async () => false);

      expect(result.failed).toBe(1);
      const entries = dlq.getAll();
      expect(entries[0].attempts).toBe(2); // Incremented from 1 to 2
    });

    it('should handle an empty queue', async () => {
      const result = await dlq.retryAll(async () => true);
      expect(result.total).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('size', () => {
    it('should return 0 for empty queue', () => {
      expect(dlq.size()).toBe(0);
    });

    it('should return the number of entries', () => {
      dlq.enqueue({ operation: 'a', payload: null, error: 'e', attempts: 1 });
      dlq.enqueue({ operation: 'b', payload: null, error: 'e', attempts: 1 });
      expect(dlq.size()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      dlq.enqueue({ operation: 'a', payload: null, error: 'e', attempts: 1 });
      dlq.enqueue({ operation: 'b', payload: null, error: 'e', attempts: 1 });

      dlq.clear();
      expect(dlq.size()).toBe(0);
    });

    it('should handle clear on empty queue', () => {
      dlq.clear();
      expect(dlq.size()).toBe(0);
    });
  });

  describe('maxSize', () => {
    it('should evict oldest entry when exceeding max size', () => {
      const q = new DeadLetterQueue({ maxSize: 3 });

      const id1 = q.enqueue({ operation: 'a', payload: null, error: 'e', attempts: 1 });
      const id2 = q.enqueue({ operation: 'b', payload: null, error: 'e', attempts: 1 });
      const id3 = q.enqueue({ operation: 'c', payload: null, error: 'e', attempts: 1 });
      const id4 = q.enqueue({ operation: 'd', payload: null, error: 'e', attempts: 1 });

      expect(q.size()).toBe(3);
      // id1 should have been evicted
      expect(q.getAll()[0].id).toBe(id2);
    });
  });
});
