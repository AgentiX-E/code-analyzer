// @code-analyzer/intelligence — Embedding Worker
// Executes inside a worker_thread spawned by EmbeddingWorkerPool. Each incoming
// message carries a single embedding task; the worker computes a deterministic
// n-gram embedding and posts the result back to the main thread.
//
// The ONNX backend is deliberately NOT loaded here. It requires a ~137MB model
// plus a native runtime and is only ever exercised on the main thread (see
// EmbeddingEngine in embedder.ts). The pool's parallel path therefore uses the
// same deterministic n-gram backend as the mock fallback, keeping worker
// throughput fully reproducible and CI-friendly.

import { parentPort } from 'node:worker_threads';

import { MockEmbeddingBackend } from './embedder.js';
import type { EmbeddingBackend } from './embedder.js';

export interface EmbedMessage {
  type: 'embed';
  taskId: string;
  content: string;
}

export type EmbedReply =
  | { type: 'result'; taskId: string; embedding: number[]; durationMs: number }
  | { type: 'error'; taskId: string; error: string; durationMs: number };

/**
 * Compute the reply for an embed message. Extracted from the parentPort wiring
 * so the worker logic is directly unit-testable in-process (v8 coverage does
 * not cross worker_thread boundaries).
 */
export async function buildEmbedReply(
  msg: EmbedMessage,
  backend: Pick<EmbeddingBackend, 'embedCode'> = new MockEmbeddingBackend(),
): Promise<EmbedReply> {
  const start = Date.now();
  try {
    const embedding = await backend.embedCode(msg.content);
    return {
      type: 'result',
      taskId: msg.taskId,
      embedding: Array.from(embedding),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      type: 'error',
      taskId: msg.taskId,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

const backend = new MockEmbeddingBackend();

// The parentPort wiring only executes inside a spawned worker thread, and v8
// coverage does not cross worker_thread boundaries. It is exercised end-to-end
// by embedding-worker-script.test.ts, which spawns this file as a real worker.
/* v8 ignore start -- @preserve */
parentPort?.on('message', async (msg: EmbedMessage) => {
  if (!msg || msg.type !== 'embed') {
    return;
  }
  parentPort?.postMessage(await buildEmbedReply(msg, backend));
});
/* v8 ignore stop -- @preserve */
