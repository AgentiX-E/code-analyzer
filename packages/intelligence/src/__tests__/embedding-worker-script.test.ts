// @code-analyzer/intelligence — Embedding Worker Script Tests
// 1. Unit-tests buildEmbedReply in-process (v8 coverage does not cross
//    worker_thread boundaries, so the reply logic is exercised directly).
// 2. Spawns the production embedding-worker.ts as a real worker_thread (via the
//    tsx loader) to verify the end-to-end message contract and the guard.

import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

import { describe, expect, it } from 'vitest';

import { buildEmbedReply } from '../embeddings/embedding-worker.js';

const WORKER_SCRIPT = resolve(__dirname, '../embeddings/embedding-worker.ts');

function spawnWorker(): Worker {
  return new Worker(WORKER_SCRIPT, { execArgv: ['-r', 'tsx/cjs'] });
}

function waitForReply(worker: Worker, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker reply timed out')), timeoutMs);
    worker.on('message', (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

describe('buildEmbedReply (in-process)', () => {
  it('returns a result with a 768-dim embedding', async () => {
    const reply = await buildEmbedReply({ type: 'embed', taskId: 't1', content: 'hello world' });
    expect(reply.type).toBe('result');
    expect(reply.taskId).toBe('t1');
    if (reply.type === 'result') {
      expect(reply.embedding).toHaveLength(768);
      expect(reply.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces a non-zero embedding for non-empty content', async () => {
    const reply = await buildEmbedReply({
      type: 'embed',
      taskId: 't2',
      content: 'function foo() { return 1; }',
    });
    expect(reply.type).toBe('result');
    if (reply.type === 'result') {
      const sumOfSquares = reply.embedding.reduce((acc, v) => acc + v * v, 0);
      expect(sumOfSquares).toBeGreaterThan(0);
    }
  });

  it('maps a backend failure to an error reply', async () => {
    const throwing = {
      embedCode: async (): Promise<Float32Array> => {
        throw new Error('backend exploded');
      },
    };
    const reply = await buildEmbedReply({ type: 'embed', taskId: 'bad', content: 'x' }, throwing);
    expect(reply.type).toBe('error');
    if (reply.type === 'error') {
      expect(reply.taskId).toBe('bad');
      expect(reply.error).toBe('backend exploded');
      expect(reply.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('stringifies a non-Error backend failure', async () => {
    const throwing = {
      embedCode: async (): Promise<Float32Array> => {
        // eslint-disable-next-line no-throw-literal
        throw 'raw string failure';
      },
    };
    const reply = await buildEmbedReply({ type: 'embed', taskId: 'raw', content: 'x' }, throwing);
    expect(reply.type).toBe('error');
    if (reply.type === 'error') {
      expect(reply.error).toBe('raw string failure');
    }
  });
});

describe('embedding-worker (production script)', () => {
  it('responds with a result for an embed message', async () => {
    const worker = spawnWorker();
    const replyPromise = waitForReply(worker);
    worker.postMessage({ type: 'embed', taskId: 't1', content: 'hello world' });

    const reply = (await replyPromise) as {
      type: string;
      taskId: string;
      embedding: number[];
      durationMs: number;
    };
    expect(reply.type).toBe('result');
    expect(reply.taskId).toBe('t1');
    expect(Array.isArray(reply.embedding)).toBe(true);
    expect(reply.embedding.length).toBe(768);
    expect(reply.durationMs).toBeGreaterThanOrEqual(0);

    await worker.terminate();
  });

  it('produces a non-zero embedding for non-empty content', async () => {
    const worker = spawnWorker();
    const replyPromise = waitForReply(worker);
    worker.postMessage({ type: 'embed', taskId: 't2', content: 'function foo() { return 1; }' });

    const reply = (await replyPromise) as { embedding: number[] };
    const sumOfSquares = reply.embedding.reduce((acc, v) => acc + v * v, 0);
    expect(sumOfSquares).toBeGreaterThan(0);

    await worker.terminate();
  });

  it('ignores non-embed messages and null messages', async () => {
    const worker = spawnWorker();
    const replies: Array<{ taskId?: string }> = [];
    worker.on('message', (msg) => replies.push(msg as { taskId?: string }));

    // Both of these hit the guard and must produce no reply.
    worker.postMessage({ type: 'ping', taskId: 'ignored' });
    worker.postMessage(null);
    // A real embed should still be answered.
    worker.postMessage({ type: 'embed', taskId: 'real', content: 'x' });

    await new Promise((r) => setTimeout(r, 250));
    await worker.terminate();

    expect(replies).toHaveLength(1);
    expect(replies[0]!.taskId).toBe('real');
  });
});
