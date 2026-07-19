// @code-analyzer/intelligence — Session Store
// JSONL-based review session persistence with SHA-256 fingerprinting.

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ReviewComment, ReviewSession } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMetadata {
  repository: string;
  branch: string;
  model?: string;
  mode: 'diff' | 'scan';
  fromRef?: string;
  toRef?: string;
}

export interface ReviewItemResult {
  filePath: string;
  fingerprint: string;
  comments: ReviewComment[];
  duration: number;
}

export interface ReviewItemError {
  filePath: string;
  fingerprint: string;
  error: string;
  duration: number;
}

export interface ResumeState {
  completedFiles: Set<string>;
  reusedComments: ReviewComment[];
}

export interface SessionSummary {
  sessionId: string;
  projectId: string;
  mode: string;
  status: string;
  filesReviewed: number;
  commentsGenerated: number;
  createdAt: string;
}

interface SessionRecord {
  type: 'start' | 'item_done' | 'item_failed';
  sessionId: string;
  projectId: string;
  timestamp: string;
  metadata?: SessionMetadata;
  item?: ReviewItemResult;
  error?: ReviewItemError;
}

// ---------------------------------------------------------------------------
// SHA-256 Fingerprint
// ---------------------------------------------------------------------------

/**
 * Generate a SHA-256 fingerprint for a file in a review session.
 * Format: SHA256(mode + '\x00' + filePath + '\x00' + diffContent)
 */
export function computeFileFingerprint(
  mode: 'diff' | 'scan',
  filePath: string,
  content: string,
): string {
  const input = `${mode}\x00${filePath}\x00${content}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate a unique session ID.
 */
export function generateSessionId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `session-${now}-${rand}`;
}

// ---------------------------------------------------------------------------
// Session Store
// ---------------------------------------------------------------------------

export class SessionStore {
  private readonly sessionsDir: string;
  private activeSessions: Map<string, SessionRecord[]>;

  constructor(baseDir?: string) {
    const root = baseDir ?? path.join(os.homedir(), '.code-analyzer', 'sessions');
    this.sessionsDir = root;
    this.activeSessions = new Map();
    this.ensureDirectory();
  }

  /** Get the sessions directory path */
  get directory(): string {
    return this.sessionsDir;
  }

  /**
   * Start a new review session.
   * Creates a new session with a unique ID and persists the start record as JSONL.
   */
  startSession(projectId: string, meta: SessionMetadata): ReviewSession {
    const sessionId = generateSessionId();
    const now = new Date().toISOString();

    const record: SessionRecord = {
      type: 'start',
      sessionId,
      projectId,
      timestamp: now,
      metadata: meta,
    };

    this.activeSessions.set(sessionId, [record]);
    this.appendRecord(sessionId, record);

    return {
      id: sessionId,
      projectId,
      mode: meta.mode,
      fromRef: meta.fromRef,
      toRef: meta.toRef,
      status: 'running',
      createdAt: now,
      filesReviewed: 0,
      commentsGenerated: 0,
    };
  }

  /**
   * Record a successfully completed review item.
   */
  recordItemDone(sessionId: string, item: ReviewItemResult): void {
    const records = this.activeSessions.get(sessionId) ?? [];
    const record: SessionRecord = {
      type: 'item_done',
      sessionId,
      projectId: '',
      timestamp: new Date().toISOString(),
      item,
    };
    records.push(record);
    this.activeSessions.set(sessionId, records);
    this.appendRecord(sessionId, record);
  }

  /**
   * Record a failed review item.
   */
  recordItemFailed(sessionId: string, error: ReviewItemError): void {
    const records = this.activeSessions.get(sessionId) ?? [];
    const record: SessionRecord = {
      type: 'item_failed',
      sessionId,
      projectId: '',
      timestamp: new Date().toISOString(),
      error,
    };
    records.push(record);
    this.activeSessions.set(sessionId, records);
    this.appendRecord(sessionId, record);
  }

  /**
   * Build resume state from a prior session.
   * Returns fingerprints of completed files and their review comments.
   */
  buildResumeState(sessionId: string): ResumeState {
    const records = this.loadRecords(sessionId);
    const completedFiles = new Set<string>();
    const reusedComments: ReviewComment[] = [];

    for (const record of records) {
      if (record.type === 'item_done' && record.item) {
        completedFiles.add(record.item.fingerprint);
        for (const comment of record.item.comments) {
          reusedComments.push(comment);
        }
      }
    }

    return { completedFiles, reusedComments };
  }

  /**
   * List all sessions for a project.
   * Scans the sessions directory for JSONL files matching the project.
   */
  listSessions(projectId: string): SessionSummary[] {
    const summaries: SessionSummary[] = [];

    if (!fs.existsSync(this.sessionsDir)) {
      return summaries;
    }

    const files = fs.readdirSync(this.sessionsDir);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;

      const sessionId = file.replace('.jsonl', '');
      const records = this.loadRecords(sessionId);
      const startRecord = records.find((r) => r.type === 'start');

      if (!startRecord || startRecord.projectId !== projectId) continue;

      const doneCount = records.filter((r) => r.type === 'item_done').length;
      let totalComments = 0;
      for (const r of records) {
        if (r.type === 'item_done' && r.item) {
          totalComments += r.item.comments.length;
        }
      }

      summaries.push({
        sessionId,
        projectId,
        mode: startRecord.metadata?.mode ?? 'unknown',
        status: startRecord.metadata ? 'completed' : 'running',
        filesReviewed: doneCount,
        commentsGenerated: totalComments,
        createdAt: startRecord.timestamp,
      });
    }

    // Sort by creation time, newest first
    summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return summaries;
  }

  /**
   * Get all records for a session as JSON strings.
   */
  getRecords(sessionId: string): string[] {
    const filePath = this.getSessionPath(sessionId);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0);
  }

  /**
   * Delete a session's records from disk and memory.
   */
  deleteSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    const filePath = this.getSessionPath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * Mark a session as completed.
   */
  completeSession(sessionId: string): void {
    const records = this.activeSessions.get(sessionId);
    if (records && records.length > 0 && records[0]) {
      const startRecord = records[0];
      // Completion is tracked via the session status — the last record timestamp marks it
      this.ensureDirectory();
      const filePath = this.getSessionPath(sessionId);
      const completionEntry = JSON.stringify({
        type: 'complete',
        sessionId,
        projectId: startRecord.projectId,
        timestamp: new Date().toISOString(),
      }) + '\n';
      fs.appendFileSync(filePath, completionEntry, 'utf-8');
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private ensureDirectory(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  private getSessionPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  private appendRecord(sessionId: string, record: SessionRecord): void {
    this.ensureDirectory();
    const filePath = this.getSessionPath(sessionId);
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  }

  private loadRecords(sessionId: string): SessionRecord[] {
    const lines = this.getRecords(sessionId);
    const records: SessionRecord[] = [];

    for (const line of lines) {
      try {
        const record = JSON.parse(line) as SessionRecord;
        records.push(record);
      } catch {
        // Skip malformed lines
      }
    }

    return records;
  }
}
