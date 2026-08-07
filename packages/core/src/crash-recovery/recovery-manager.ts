// @code-analyzer/core — Crash Recovery Manager
// Orchestrates checkpoint saving, quarantine management, and recovery
// state loading to enable seamless pipeline resumption after crashes.
//
// The recovery manager is the main entry point for crash recovery:
//   - Saves checkpoints at safe points during pipeline execution
//   - Quarantines files that cause crashes
//   - Provides recovery state for resuming after a crash

import type { Checkpoint, CheckpointStore } from './checkpoint-store.js';
import type { QuarantinedFile, QuarantineManager } from './quarantine.js';

/**
 * Describes the recovery state after a crash.
 * Used to determine whether and how to resume the pipeline.
 */
export interface RecoveryState {
  /** The most recent checkpoint, or null if none exists. */
  lastCheckpoint: Checkpoint | null;
  /** Files that were quarantined during the crashed run. */
  quarantinedFiles: QuarantinedFile[];
  /** Whether this is a recovery run (i.e., a checkpoint exists). */
  isRecovery: boolean;
}

/**
 * Options for the RecoveryManager.
 */
export interface RecoveryOptions {
  /** Directory for checkpoint and quarantine files (default: .code-analyzer-cache). */
  cacheDir?: string;
  /** Whether to automatically save checkpoints (default: true). */
  autoSave?: boolean;
  /** Minimum interval between checkpoints in milliseconds (default: 30 seconds). */
  minCheckpointInterval?: number;
}

/**
 * Orchestrates crash recovery by combining checkpoint persistence
 * and file quarantine management.
 *
 * During normal execution:
 *   - Call `saveCheckpoint()` at safe boundaries (after each phase completes)
 *   - Call `quarantineFile()` when a file causes an error
 *
 * After a crash:
 *   - Call `loadRecoveryState()` to get the last checkpoint and quarantined files
 *   - Use `isInRecovery()` to check if a recovery is needed
 */
export class RecoveryManager {
  private readonly checkpointStore: CheckpointStore;
  private readonly quarantineManager: QuarantineManager;
  private readonly autoSave: boolean;
  private readonly minCheckpointInterval: number;
  private lastCheckpointTime: number;

  /**
   * @param checkpointStore - Store for persisting pipeline checkpoints
   * @param quarantineManager - Manager for tracking quarantined files
   * @param options - Configuration options
   */
  constructor(
    checkpointStore: CheckpointStore,
    quarantineManager: QuarantineManager,
    options: RecoveryOptions = {},
  ) {
    this.checkpointStore = checkpointStore;
    this.quarantineManager = quarantineManager;
    this.autoSave = options.autoSave ?? true;
    this.minCheckpointInterval = options.minCheckpointInterval ?? 30000;
    this.lastCheckpointTime = 0;
  }

  /**
   * Save a checkpoint for the current phase.
   * Skips saving if auto-save is disabled or if the minimum interval
   * hasn't elapsed since the last checkpoint.
   *
   * @param phaseId - Current pipeline phase ID
   * @param processedFiles - File paths processed so far
   * @param nodeCount - Number of graph nodes created
   * @param edgeCount - Number of graph edges created
   */
  saveCheckpoint(
    phaseId: string,
    processedFiles: string[],
    nodeCount: number,
    edgeCount: number,
  ): void {
    if (!this.autoSave) return;

    const now = Date.now();
    if (now - this.lastCheckpointTime < this.minCheckpointInterval) {
      return;
    }

    const checkpoint: Checkpoint = {
      phaseId,
      processedFiles,
      nodeCount,
      edgeCount,
      timestamp: now,
      metadata: {},
    };

    this.checkpointStore.save(checkpoint);
    this.lastCheckpointTime = now;
  }

  /**
   * Save a checkpoint with additional metadata.
   *
   * @param phaseId - Current pipeline phase ID
   * @param processedFiles - File paths processed so far
   * @param nodeCount - Number of graph nodes created
   * @param edgeCount - Number of graph edges created
   * @param metadata - Additional recovery metadata
   */
  saveCheckpointWithMetadata(
    phaseId: string,
    processedFiles: string[],
    nodeCount: number,
    edgeCount: number,
    metadata: Record<string, unknown>,
  ): void {
    const checkpoint: Checkpoint = {
      phaseId,
      processedFiles,
      nodeCount,
      edgeCount,
      timestamp: Date.now(),
      metadata,
    };

    this.checkpointStore.save(checkpoint);
    this.lastCheckpointTime = Date.now();
  }

  /**
   * Load the recovery state, including the last checkpoint and
   * all quarantined files.
   *
   * @returns Recovery state with checkpoint and quarantine info
   */
  loadRecoveryState(): RecoveryState {
    const lastCheckpoint = this.checkpointStore.load();
    const quarantinedFiles = this.quarantineManager.getQuarantined();

    return {
      lastCheckpoint,
      quarantinedFiles,
      isRecovery: lastCheckpoint !== null,
    };
  }

  /**
   * Quarantine a file that caused an error during processing.
   *
   * @param filePath - Path to the problematic file
   * @param error - The error that occurred
   * @param phaseId - Phase where the error occurred
   */
  quarantineFile(filePath: string, error: Error, phaseId: string): void {
    this.quarantineManager.quarantine({
      filePath,
      error: error.message,
      phaseId,
      retryCount: 1,
    });
  }

  /**
   * Check whether we are in recovery mode (a previous checkpoint exists).
   */
  isInRecovery(): boolean {
    return this.checkpointStore.exists();
  }

  /**
   * Clear all recovery state — remove checkpoint and quarantine data.
   * Call this after a successful pipeline completion.
   */
  clearAll(): void {
    this.checkpointStore.clear();
    this.quarantineManager.clearAll();
    this.lastCheckpointTime = 0;
  }

  /**
   * Get the set of quarantined file paths for quick lookup.
   * Useful for skipping files during processing.
   */
  getQuarantinedPaths(): Set<string> {
    return this.quarantineManager.getQuarantinedPaths();
  }

  /**
   * Check if a specific file is quarantined.
   */
  isFileQuarantined(filePath: string): boolean {
    return this.quarantineManager.isQuarantined(filePath);
  }

  /**
   * Get the age of the last checkpoint in milliseconds.
   * Returns Infinity if no checkpoint exists.
   */
  getCheckpointAge(): number {
    return this.checkpointStore.getAge();
  }

  /**
   * Get the number of quarantined files.
   */
  getQuarantinedCount(): number {
    return this.quarantineManager.getCount();
  }

  /**
   * Clear a specific file from quarantine (e.g., after it was fixed).
   */
  clearQuarantineFile(filePath: string): void {
    this.quarantineManager.clear(filePath);
  }
}
