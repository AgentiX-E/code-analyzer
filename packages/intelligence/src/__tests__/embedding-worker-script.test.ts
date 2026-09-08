// @code-analyzer/intelligence — Embedding Worker Script Tests
// Unit-tests buildEmbedReply, handleWorkerMessage, and registerWorkerHandlers
// in-process. v8 coverage does not cross worker_thread boundaries, so the reply
// and routing logic are exercised directly (with an in-memory port) rather than
// through a spawned worker.

import { describe, expect, it } from 'vitest';

import {
  buildEmbedReply,
  handleWorkerMessage,
  registerWorkerHandlers,
} from '../embeddings/embedding-worker.js';
import type { EmbedMessage, EmbedReply, WorkerPort } from '../embeddings/embedding-worker.js';

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

// ---------------------------------------------------------------------------
// In-memory port + message routing
// ---------------------------------------------------------------------------

interface FakePortState {
  listener: ((msg: EmbedMessage) => void) | null;
  replies: EmbedReply[];
}

function makeFakePort(): { port: WorkerPort; state: FakePortState } {
  const state: FakePortState = { listener: null, replies: [] };
  const port: WorkerPort = {
    on: (_event, listener) => {
      state.listener = listener;
    },
    postMessage: (reply) => {
      state.replies.push(reply);
    },
  };
  return { port, state };
}

const fakeBackend = {
  embedCode: async (content: string): Promise<Float32Array> => new Float32Array(content.length),
};

describe('handleWorkerMessage (in-process)', () => {
  it('ignores a null or undefined message', async () => {
    const { port, state } = makeFakePort();
    await handleWorkerMessage(null, port, fakeBackend);
    await handleWorkerMessage(undefined, port, fakeBackend);
    expect(state.replies).toHaveLength(0);
  });

  it('ignores a message whose type is not "embed"', async () => {
    const { port, state } = makeFakePort();
    await handleWorkerMessage({ type: 'other' } as unknown as EmbedMessage, port, fakeBackend);
    expect(state.replies).toHaveLength(0);
  });

  it('is a no-op for a valid message when the port is null', async () => {
    await expect(
      handleWorkerMessage({ type: 'embed', taskId: 't', content: 'x' }, null, fakeBackend),
    ).resolves.toBeUndefined();
  });

  it('posts a result reply for a valid message', async () => {
    const { port, state } = makeFakePort();
    await handleWorkerMessage({ type: 'embed', taskId: 't1', content: 'hello' }, port, fakeBackend);
    expect(state.replies).toHaveLength(1);
    const reply = state.replies[0]!;
    expect(reply.type).toBe('result');
    if (reply.type === 'result') {
      expect(reply.taskId).toBe('t1');
      expect(reply.embedding).toHaveLength('hello'.length);
    }
  });

  it('posts an error reply when the backend throws', async () => {
    const { port, state } = makeFakePort();
    const throwing = {
      embedCode: async (): Promise<Float32Array> => {
        throw new Error('backend exploded');
      },
    };
    await handleWorkerMessage({ type: 'embed', taskId: 'bad', content: 'x' }, port, throwing);
    expect(state.replies).toHaveLength(1);
    expect(state.replies[0]!.type).toBe('error');
  });
});

describe('registerWorkerHandlers (in-process)', () => {
  it('is a no-op when the port is null', () => {
    expect(() => registerWorkerHandlers(null)).not.toThrow();
  });

  it('registers a listener and routes a valid message to the backend', async () => {
    const { port, state } = makeFakePort();
    registerWorkerHandlers(port, fakeBackend);
    expect(state.listener).not.toBeNull();

    state.listener!({ type: 'embed', taskId: 't2', content: 'hi' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.replies).toHaveLength(1);
    expect(state.replies[0]!.type).toBe('result');
  });

  it('ignores a non-embed message via the registered listener', async () => {
    const { port, state } = makeFakePort();
    registerWorkerHandlers(port, fakeBackend);

    state.listener!({ type: 'nope' } as unknown as EmbedMessage);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.replies).toHaveLength(0);
  });
});
