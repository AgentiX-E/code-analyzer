// @code-analyzer/intelligence — PR Review Session Manager
// Checkpoint/resume workflow for long-running PR reviews, building on SessionStore.

import * as fs from 'fs';
import { randomUUID } from 'node:crypto';
import * as path from 'path';

import { type SessionMetadata } from './session-store.js';

import type { ReviewComment } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewCheckpoint {
  sessionId: string;
  repoPath: string;
  prUrl: string;
  metadata: SessionMetadata;
  filesReviewed: string[];
  filesRemaining: string[];
  findings: ReviewComment[];
  createdAt: string;
  lastCheckpointAt: string;
}

export interface SessionResumeResult {
  session: ReviewCheckpoint;
  completedFiles: Set<string>;
  priorFindings: ReviewComment[];
}

// ---------------------------------------------------------------------------
// ReviewSessionManager
// ---------------------------------------------------------------------------

export class ReviewSessionManager {
  private sessionsDir: string;

  constructor(repoPath: string) {
    this.sessionsDir = path.join(repoPath, '.code-analyzer', 'sessions');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Create a new review session for a PR. */
  createSession(prUrl: string, repoPath: string, metadata: SessionMetadata): ReviewCheckpoint {
    const sessionId = this.generateSessionId(prUrl);
    const session: ReviewCheckpoint = {
      sessionId,
      repoPath,
      prUrl,
      metadata,
      filesReviewed: [],
      filesRemaining: [],
      findings: [],
      createdAt: new Date().toISOString(),
      lastCheckpointAt: new Date().toISOString(),
    };

    this.persistSession(session);
    return session;
  }

  /** Save a checkpoint — records progress and findings. */
  checkpoint(sessionId: string, findings: ReviewComment[], filesReviewed: string[]): void {
    const session = this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Merge findings, avoiding duplicates by comment ID
    const existingIds = new Set(session.findings.map((f) => f.id));
    for (const finding of findings) {
      if (!existingIds.has(finding.id)) {
        session.findings.push(finding);
      }
    }

    // Update files reviewed
    for (const file of filesReviewed) {
      if (!session.filesReviewed.includes(file)) {
        session.filesReviewed.push(file);
      }
    }

    // Remove from remaining
    session.filesRemaining = session.filesRemaining.filter((f) => !filesReviewed.includes(f));

    session.lastCheckpointAt = new Date().toISOString();
    this.persistSession(session);
  }

  /** Resume a paused/failed review session. */
  resume(sessionId: string): SessionResumeResult | null {
    const session = this.loadSession(sessionId);
    if (!session) return null;

    return {
      session,
      completedFiles: new Set(session.filesReviewed),
      priorFindings: [...session.findings],
    };
  }

  /** List all sessions for a repository. */
  listSessions(_repoPath: string): ReviewCheckpoint[] {
    if (!fs.existsSync(this.sessionsDir)) return [];

    const sessions: ReviewCheckpoint[] = [];
    try {
      const files = fs.readdirSync(this.sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const sessionPath = path.join(this.sessionsDir, file);
        try {
          const raw = fs.readFileSync(sessionPath, 'utf-8');
          const session = JSON.parse(raw) as ReviewCheckpoint;
          sessions.push(session);
        } catch {
          // Skip corrupted session files
        }
      }
    } catch {
      // Directory read error — return empty
    }

    return sessions;
  }

  /** Delete a session. */
  deleteSession(sessionId: string): boolean {
    const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(sessionFile)) return false;

    fs.unlinkSync(sessionFile);
    return true;
  }

  /** Set the remaining files for a session (called before processing begins). */
  setRemainingFiles(sessionId: string, files: string[]): void {
    const session = this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.filesRemaining = files.filter((f) => !session.filesReviewed.includes(f));
    this.persistSession(session);
  }

  /** Get review progress as a fraction. */
  getProgress(sessionId: string): { done: number; total: number; percent: number } | null {
    const session = this.loadSession(sessionId);
    if (!session) return null;

    const total = session.filesReviewed.length + session.filesRemaining.length;
    const done = session.filesReviewed.length;
    return {
      done,
      total: total || 1,
      percent: total === 0 ? 100 : Math.round((done / total) * 100),
    };
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private generateSessionId(prUrl: string): string {
    const timestamp = Date.now().toString(36);
    const urlHash = prUrl.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40);
    return `review-${urlHash}-${timestamp}`;
  }

  private persistSession(session: ReviewCheckpoint): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }

    const sessionFile = path.join(this.sessionsDir, `${session.sessionId}.json`);
    // **A unique name created exclusively, and the reason is the two letters this used to be.**
    //
    // The temporary file was `${sessionFile}.tmp` - one fixed name per session, chosen before it was written. Two
    // checkpoints of the same session that overlap (two reviewers, or a retry that starts before the first attempt has
    // finished) write into the same file and one of them renames the other's half-written JSON into place. And because
    // the name is predictable, anything already sitting at it is followed rather than replaced: `writeFileSync` opens
    // the path, so a symlink planted there turns a checkpoint into a write somewhere else.
    //
    // `flag: 'wx'` is the other half of the fix. A unique name removes the collision; exclusive creation removes the
    // reuse, and a file that is already at the chosen name is an error rather than a target.
    const tempFile = `${sessionFile}.${String(process.pid)}.${randomUUID().slice(0, 8)}.tmp`;

    fs.writeFileSync(tempFile, JSON.stringify(session, null, 2), { encoding: 'utf-8', flag: 'wx' });
    fs.renameSync(tempFile, sessionFile);
  }

  private loadSession(sessionId: string): ReviewCheckpoint | null {
    const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(sessionFile)) return null;

    try {
      const raw = fs.readFileSync(sessionFile, 'utf-8');
      return JSON.parse(raw) as ReviewCheckpoint;
    } catch {
      return null;
    }
  }
}
