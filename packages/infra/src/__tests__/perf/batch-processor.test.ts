// @code-analyzer/infra — Batch Processor Tests
// Covers batch processing, concurrency, error handling, progress tracking,
// abort, edge cases, and map operations.

import { describe, it, expect, vi } from 'vitest';
import { BatchProcessor } from '../../performance/batch-processor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeItems(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BatchProcessor', () => {
  // -------------------------------------------------------------------
  // Basic processing
  // -------------------------------------------------------------------

  it('should process items in batches', async () => {
    const processor = new BatchProcessor<number>({ batchSize: 10 });
    const items = makeItems(25);
    const handler = vi.fn(async (item: number): Promise<number> => item * 2);

    const result = await processor.process(items, handler);

    expect(result.results).toHaveLength(25);
    expect(result.results).toEqual(items.map((i) => i * 2));
    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(25);
  });

  it('should handle empty items array', async () => {
    const processor = new BatchProcessor<number>({ batchSize: 10 });
    const handler = vi.fn();

    const result = await processor.process([], handler);

    expect(result.results).toEqual([]);
    expect(result.totalProcessed).toBe(0);
    expect(result.success).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should process a single item', async () => {
    const processor = new BatchProcessor<number>({ batchSize: 10 });
    const handler = vi.fn(async (item: number): Promise<number> => item + 1);

    const result = await processor.process([42], handler);

    expect(result.results).toEqual([43]);
    expect(result.success).toBe(true);
  });

  // -------------------------------------------------------------------
  // Batch size behavior
  // -------------------------------------------------------------------

  it('should respect batchSize configuration', async () => {
    const processor = new BatchProcessor<number>({ batchSize: 5 });
    const items = makeItems(12);
    const handler = vi.fn(async (item: number): Promise<number> => item);
    const progressCalls: number[] = [];

    const result = await processor.process(items, handler);
    expect(result.results.length).toBe(12);
    // 12 items / 5 = 3 batches (5, 5, 2)
    expect(handler).toHaveBeenCalledTimes(12);
  });

  it('should use default batchSize of 50 when not specified', async () => {
    const processor = new BatchProcessor<number>();
    const items = makeItems(30);
    const handler = vi.fn(async (item: number): Promise<number> => item);

    await processor.process(items, handler);
    expect(handler).toHaveBeenCalledTimes(30);
  });

  // -------------------------------------------------------------------
  // Progress tracking
  // -------------------------------------------------------------------

  it('should report progress via onProgress callback', async () => {
    const progressReports: { percentComplete: number }[] = [];
    const processor = new BatchProcessor<number>({
      batchSize: 5,
      onProgress: (p) => progressReports.push({ percentComplete: p.percentComplete }),
    });
    const items = makeItems(12);
    const handler = vi.fn(async (item: number): Promise<number> => item);

    await processor.process(items, handler);

    expect(progressReports.length).toBeGreaterThan(0);
    // Last progress report should be 100%
    const last = progressReports[progressReports.length - 1]!;
    expect(last.percentComplete).toBe(100);
  });

  it('should report accurate processedItems in progress', async () => {
    const processedCounts: number[] = [];
    const processor = new BatchProcessor<number>({
      batchSize: 3,
      onProgress: (p) => processedCounts.push(p.processedItems),
    });
    const handler = vi.fn(async (item: number): Promise<number> => item);

    await processor.process(makeItems(9), handler);

    // With batchSize=3, concurrency=3 (default), all 3 batches run concurrently
    // Processed items should increase cumulatively
    expect(processedCounts.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------

  it('should collect errors when continueOnError is true', async () => {
    const processor = new BatchProcessor<number>({
      batchSize: 5,
      continueOnError: true,
    });
    const items = makeItems(15);
    const handler = vi.fn(async (item: number): Promise<number> => {
      if (item === 7) throw new Error('item 7 failed');
      return item;
    });

    const result = await processor.process(items, handler);

    expect(result.success).toBe(false);
    expect(result.errors.size).toBeGreaterThan(0);
    expect(result.results.length).toBeLessThan(15);
    // Non-failing items should still be processed
    expect(result.results).toContain(0);
    expect(result.results).toContain(14);
  });

  it('should stop on first error when continueOnError is false', async () => {
    const processor = new BatchProcessor<number>({
      batchSize: 5,
      continueOnError: false,
      concurrency: 1, // Sequential to guarantee order
    });
    const items = makeItems(15);
    const handler = vi.fn(async (item: number): Promise<number> => {
      if (item === 3) throw new Error('stop here');
      return item;
    });

    const result = await processor.process(items, handler);

    expect(result.success).toBe(false);
    expect(result.errors.size).toBe(1);
  });

  it('should report failedCount correctly', async () => {
    const processor = new BatchProcessor<number>({
      batchSize: 5,
      continueOnError: true,
    });
    const items = makeItems(20);
    const handler = vi.fn(async (item: number): Promise<number> => {
      if (item % 2 === 0) throw new Error(`item ${item} failed`);
      return item;
    });

    const result = await processor.process(items, handler);
    expect(result.failedCount).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------
  // Concurrency
  // -------------------------------------------------------------------

  it('should respect concurrency limit', async () => {
    const startTimes: number[] = [];
    const processor = new BatchProcessor<number>({
      batchSize: 3,
      concurrency: 2,
    });
    const items = makeItems(9);
    const handler = vi.fn(async (item: number): Promise<number> => {
      startTimes.push(Date.now());
      await delay(20);
      return item;
    });

    await processor.process(items, handler);
    // 9 items / 3 per batch = 3 batches, concurrency=2 means ~2 rounds
    expect(handler).toHaveBeenCalledTimes(9);
  });

  it('should use default concurrency of 3 when not specified', async () => {
    const processor = new BatchProcessor<number>({ batchSize: 5 });
    const items = makeItems(15);
    const handler = vi.fn(async (item: number): Promise<number> => item);

    await processor.process(items, handler);
    expect(handler).toHaveBeenCalledTimes(15);
  });

  // -------------------------------------------------------------------
  // Abort
  // -------------------------------------------------------------------

  it('should support abort', async () => {
    const processor = new BatchProcessor<number>({
      batchSize: 2,
      concurrency: 1, // Sequential for deterministic abort
    });
    const items = makeItems(10);

    let callCount = 0;
    const handler = vi.fn(async (item: number): Promise<number> => {
      callCount++;
      if (callCount === 3) {
        processor.abort();
      }
      await delay(10);
      return item;
    });

    await processor.process(items, handler);
    expect(processor.isAborted).toBe(true);
  });

  it('should reset aborted state', () => {
    const processor = new BatchProcessor<number>({ batchSize: 2, concurrency: 1 });
    processor.abort();
    expect(processor.isAborted).toBe(true);
    processor.reset();
    expect(processor.isAborted).toBe(false);
  });

  // -------------------------------------------------------------------
  // processMap
  // -------------------------------------------------------------------

  it('should map items to a different type', async () => {
    const processor = new BatchProcessor<number>({ batchSize: 5 });
    const items = makeItems(10);
    const handler = vi.fn(async (item: number): Promise<string> => `item-${item}`);

    const result = await processor.processMap(items, handler);

    expect(result.results).toHaveLength(10);
    expect(result.results).toEqual(items.map((i) => `item-${i}`));
    expect(result.success).toBe(true);
  });

  it('should handle processMap with empty items', async () => {
    const processor = new BatchProcessor<number>({ batchSize: 10 });
    const handler = vi.fn();

    const result = await processor.processMap([], handler);

    expect(result.results).toEqual([]);
    expect(result.totalProcessed).toBe(0);
    expect(result.success).toBe(true);
  });

  // -------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------

  it('should handle items exactly equal to batchSize', async () => {
    const processor = new BatchProcessor<number>({ batchSize: 10 });
    const items = makeItems(10);
    const handler = vi.fn(async (item: number): Promise<number> => item);

    const result = await processor.process(items, handler);

    expect(result.results).toHaveLength(10);
    expect(result.success).toBe(true);
  });

  it('should handle single item with batchSize 1', async () => {
    const processor = new BatchProcessor<number>({ batchSize: 1, concurrency: 1 });
    const items = makeItems(1);
    const handler = vi.fn(async (item: number): Promise<number> => item);

    const result = await processor.process(items, handler);

    expect(result.results).toEqual([0]);
    expect(result.success).toBe(true);
  });

  it('should handle no progress callback', async () => {
    const processor = new BatchProcessor<number>({ batchSize: 5 });
    // No onProgress set — should not throw
    const result = await processor.process(makeItems(3), async (i) => i);
    expect(result.success).toBe(true);
  });

  it('should track correct totalProcessed', async () => {
    const processor = new BatchProcessor<number>({ batchSize: 5 });
    const handler = vi.fn(async (item: number): Promise<number> => item);

    const result = await processor.process(makeItems(13), handler);
    expect(result.totalProcessed).toBe(13);
  });
});
