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
 * Minimal worker-port surface exercised by the handler. Declared as a
 * structural type (rather than importing `MessagePort`) so the routing
 * contract can be driven in-process with an in-memory port.
 */
export interface WorkerPort {
  on(event: 'message', listener: (msg: EmbedMessage) => void): unknown;
  postMessage(reply: EmbedReply): void;
}

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

/**
 * Handle a single worker message: ignore anything that is not an embed request
 * and post the computed reply back through the given port. Extracted from the
 * parentPort wiring so the routing contract is unit-testable in-process.
 */
export async function handleWorkerMessage(
  msg: EmbedMessage | null | undefined,
  port: WorkerPort | null | undefined,
  backend: Pick<EmbeddingBackend, 'embedCode'>,
): Promise<void> {
  if (!msg || msg.type !== 'embed') {
    return;
  }
  port?.postMessage(await buildEmbedReply(msg, backend));
}

/**
 * Register the worker message handler on a port. Kept separate from the
 * module-level parentPort wiring so the registration + routing contract is
 * unit-testable in-process (v8 coverage does not cross worker_thread
 * boundaries).
 */
export function registerWorkerHandlers(
  port: WorkerPort | null | undefined,
  backend: Pick<EmbeddingBackend, 'embedCode'> = new MockEmbeddingBackend(),
): void {
  port?.on('message', (msg: EmbedMessage) => {
    void handleWorkerMessage(msg, port, backend);
  });
}

const backend = new MockEmbeddingBackend();

// Register against the real parentPort when running inside a worker thread; in
// the main thread parentPort is null and this is a no-op.
registerWorkerHandlers(parentPort, backend);
