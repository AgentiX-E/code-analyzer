'use strict';
// Test fixture worker for EmbeddingWorkerPool.
//
// Mirrors the production embedding-worker.js message contract:
//   in : { type: 'embed', taskId, content }
//   out: { type: 'result', taskId, embedding: number[], durationMs }
//      | { type: 'error',  taskId, error, durationMs }
//
// Magic content values drive error/exit branches for coverage:
//   '__THROW__' -> throws synchronously (emits the worker 'error' event)
//   '__EXIT__'  -> process.exit(1) (emits the worker 'exit' event, code !== 0)
//   '__ERROR__' -> posts an { type: 'error' } message

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
  parentPort.postMessage({
    type: 'result',
    taskId: msg.taskId,
    embedding,
    durationMs: Date.now() - start,
  });
});
