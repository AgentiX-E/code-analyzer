// @code-analyzer/intelligence — Embedding Worker Script Tests
// Unit-tests buildEmbedReply in-process. v8 coverage does not cross
// worker_thread boundaries, so the reply logic is exercised directly rather
// than through a spawned worker. The parentPort wiring is covered end-to-end
// by embedding-worker-real.test.ts, which drives the full pool message
// contract against a real worker_thread fixture.

import { describe, expect, it } from 'vitest';

import { buildEmbedReply } from '../embeddings/embedding-worker.js';

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
