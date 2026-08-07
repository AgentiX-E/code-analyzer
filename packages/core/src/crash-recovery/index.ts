// @code-analyzer/core — Crash Recovery Module
// Public API for checkpoint-based crash recovery and file quarantine.

export { CheckpointStore } from './checkpoint-store.js';
export type { Checkpoint } from './checkpoint-store.js';

export { QuarantineManager } from './quarantine.js';
export type { QuarantinedFile } from './quarantine.js';

export { RecoveryManager } from './recovery-manager.js';
export type { RecoveryState, RecoveryOptions } from './recovery-manager.js';
