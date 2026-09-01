'use strict';
// Test fixture worker for EmbeddingWorkerPool.
//
// Mirrors the production embedding-worker.js message contract:
//   in : { type: 'embed', taskId, content }
//   out: { type: 'result', taskId, embedding: number[], durationMs }
//      | { type: 'error',  taskId, error, durationMs }
//
// Magic content values drive error/exit branches for coverage:
//   '__THROW__'       -> throws synchronously (emits the worker 'error' event)
//   '__EXIT__'        -> process.exit(1) (emits the worker 'exit' event, code !== 0)
//   '__ERROR__'       -> posts an { type: 'error' } message
//   '__NO_DURATION__' -> posts a result without the durationMs field
//   '__NO_ERROR__'    -> posts an error message without the error field
//   '__STRAY__'       -> posts the real reply plus a stray reply for an
//                        unknown taskId (exercises the pool's orphan guard)

const { parentPort } = require('node:worker_threads');

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'embed') {
    return;
  }

  if (msg.content === '__THROW__') {
    throw new Error('injected worker crash');
  }
  if (msg.content === '__EXIT__') {
    process.exit(1);
  }

  const start = Date.now();
  if (msg.content === '__ERROR__') {
    parentPort.postMessage({
      type: 'error',
      taskId: msg.taskId,
      error: 'injected worker error',
      durationMs: Date.now() - start,
    });
    return;
  }

  // Deterministic 16-dim embedding: dimension i depends on content length.
  const embedding = [];
  for (let i = 0; i < 16; i++) {
    embedding.push(((msg.content.length * (i + 1)) % 1000) / 1000);
  }

  if (msg.content === '__NO_DURATION__') {
    parentPort.postMessage({ type: 'result', taskId: msg.taskId, embedding });
    return;
  }

  if (msg.content === '__NO_ERROR__') {
    parentPort.postMessage({ type: 'error', taskId: msg.taskId });
    return;
  }

  if (msg.content === '__STRAY__') {
    parentPort.postMessage({
      type: 'result',
      taskId: msg.taskId,
      embedding,
      durationMs: Date.now() - start,
    });
    // Stray reply for a taskId the pool never queued.
    parentPort.postMessage({
      type: 'result',
      taskId: 'ghost-task-id',
      embedding,
      durationMs: Date.now() - start,
    });
    return;
  }

  parentPort.postMessage({
    type: 'result',
    taskId: msg.taskId,
    embedding,
    durationMs: Date.now() - start,
  });
});
