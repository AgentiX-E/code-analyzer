// @code-analyzer/intelligence — Session Manager Tests
// Tests for PR review session checkpoint/resume workflow.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ReviewSessionManager } from '../session-manager.js';
import type { ReviewComment } from '@code-analyzer/shared';

describe('ReviewSessionManager', () => {
  let testDir: string;
  let manager: ReviewSessionManager;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `ca-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(testDir, { recursive: true });
    manager = new ReviewSessionManager(testDir);
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  // ---------------------------------------------------------------------------
  // Session Creation
  // ---------------------------------------------------------------------------

  it('should create a new review session', () => {
    const session = manager.createSession(
      'https://github.com/org/repo/pull/42',
      testDir,
      { repository: 'org/repo', branch: 'main', mode: 'diff', fromRef: 'main', toRef: 'feature' },
    );

    expect(session.sessionId).toBeTruthy();
    expect(session.prUrl).toBe('https://github.com/org/repo/pull/42');
    expect(session.filesReviewed).toEqual([]);
    expect(session.findings).toEqual([]);
    expect(session.createdAt).toBeTruthy();
  });

  it('should generate unique session IDs', () => {
    const s1 = manager.createSession('https://github.com/a/b/pull/1', testDir, { repository: 'a/b', branch: 'main', mode: 'diff' });
    const s2 = manager.createSession('https://github.com/a/b/pull/2', testDir, { repository: 'a/b', branch: 'main', mode: 'diff' });

    expect(s1.sessionId).not.toBe(s2.sessionId);
  });

  // ---------------------------------------------------------------------------
  // Checkpoint
  // ---------------------------------------------------------------------------

  it('should save a checkpoint with findings and files reviewed', () => {
    const session = manager.createSession(
      'https://github.com/org/repo/pull/1',
      testDir,
      { repository: 'org/repo', branch: 'main', mode: 'diff' },
    );

    const findings: ReviewComment[] = [
      {
        id: 'c1',
        path: 'src/index.ts',
        content: 'Missing error handling',
        existingCode: 'fetch(url)',
        startLine: 10,
        endLine: 10,
        category: 'security',
        severity: 'high',
        filtered: false,
        createdAt: new Date().toISOString(),
      },
    ];

    manager.setRemainingFiles(session.sessionId, ['src/index.ts', 'src/utils.ts']);
    manager.checkpoint(session.sessionId, findings, ['src/index.ts']);

    const resumed = manager.resume(session.sessionId);
    expect(resumed).not.toBeNull();
    expect(resumed!.completedFiles.has('src/index.ts')).toBe(true);
    expect(resumed!.priorFindings).toHaveLength(1);
    expect(resumed!.priorFindings[0]!.id).toBe('c1');
  });

  it('should not duplicate findings on repeated checkpoints', () => {
    const session = manager.createSession(
      'https://github.com/org/repo/pull/1',
      testDir,
      { repository: 'org/repo', branch: 'main', mode: 'diff' },
    );

    const findings: ReviewComment[] = [
      {
        id: 'c1', path: 'src/a.ts', content: 'Issue 1',
        existingCode: 'code', startLine: 1, endLine: 1,
        category: 'style', severity: 'low', filtered: false,
        createdAt: new Date().toISOString(),
      },
    ];

    manager.checkpoint(session.sessionId, findings, ['src/a.ts']);
    manager.checkpoint(session.sessionId, findings, ['src/b.ts']);

    const resumed = manager.resume(session.sessionId);
    expect(resumed!.priorFindings).toHaveLength(1); // Not duplicated
  });

  it('should accumulate files reviewed across checkpoints', () => {
    const session = manager.createSession(
      'https://github.com/org/repo/pull/1',
      testDir,
      { repository: 'org/repo', branch: 'main', mode: 'diff' },
    );

    manager.checkpoint(session.sessionId, [], ['src/a.ts']);
    manager.checkpoint(session.sessionId, [], ['src/b.ts', 'src/c.ts']);

    const resumed = manager.resume(session.sessionId);
    expect(resumed!.completedFiles.size).toBe(3);
    expect(resumed!.completedFiles.has('src/a.ts')).toBe(true);
    expect(resumed!.completedFiles.has('src/b.ts')).toBe(true);
    expect(resumed!.completedFiles.has('src/c.ts')).toBe(true);
  });

  it('should remove checked off files from remaining', () => {
    const session = manager.createSession(
      'https://github.com/org/repo/pull/1',
      testDir,
      { repository: 'org/repo', branch: 'main', mode: 'diff' },
    );

    manager.setRemainingFiles(session.sessionId, ['f1.ts', 'f2.ts', 'f3.ts']);
    manager.checkpoint(session.sessionId, [], ['f1.ts']);

    const resumed = manager.resume(session.sessionId);
    expect(resumed!.session.filesRemaining).not.toContain('f1.ts');
    expect(resumed!.session.filesRemaining).toContain('f2.ts');
    expect(resumed!.session.filesRemaining).toContain('f3.ts');
  });

  // ---------------------------------------------------------------------------
  // Resume
  // ---------------------------------------------------------------------------

  it('should return null when resuming a non-existent session', () => {
    const result = manager.resume('nonexistent-id');
    expect(result).toBeNull();
  });

  it('should resume a session with its complete state', () => {
    const session = manager.createSession(
      'https://github.com/org/repo/pull/1',
      testDir,
      { repository: 'org/repo', branch: 'main', mode: 'diff' },
    );

    const resumed = manager.resume(session.sessionId);
    expect(resumed).not.toBeNull();
    expect(resumed!.session.prUrl).toBe('https://github.com/org/repo/pull/1');
  });

  // ---------------------------------------------------------------------------
  // List Sessions
  // ---------------------------------------------------------------------------

  it('should list all sessions for a repo', () => {
    manager.createSession('https://github.com/org/repo/pull/1', testDir, { repository: 'org/repo', branch: 'main', mode: 'diff' });
    manager.createSession('https://github.com/org/repo/pull/2', testDir, { repository: 'org/repo', branch: 'main', mode: 'diff' });

    const sessions = manager.listSessions(testDir);
    expect(sessions).toHaveLength(2);
  });

  it('should return empty list when no sessions exist', () => {
    const sessions = manager.listSessions(testDir);
    expect(sessions).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Delete Session
  // ---------------------------------------------------------------------------

  it('should delete a session', () => {
    const session = manager.createSession(
      'https://github.com/org/repo/pull/1',
      testDir,
      { repository: 'org/repo', branch: 'main', mode: 'diff' },
    );

    const deleted = manager.deleteSession(session.sessionId);
    expect(deleted).toBe(true);
    expect(manager.resume(session.sessionId)).toBeNull();
  });

  it('should return false when deleting non-existent session', () => {
    const deleted = manager.deleteSession('nonexistent');
    expect(deleted).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Progress
  // ---------------------------------------------------------------------------

  it('should report progress correctly', () => {
    const session = manager.createSession(
      'https://github.com/org/repo/pull/1',
      testDir,
      { repository: 'org/repo', branch: 'main', mode: 'diff' },
    );

    manager.setRemainingFiles(session.sessionId, ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    manager.checkpoint(session.sessionId, [], ['a.ts', 'b.ts']);

    const progress = manager.getProgress(session.sessionId);
    expect(progress).not.toBeNull();
    expect(progress!.done).toBe(2);
    expect(progress!.total).toBe(4);
    expect(progress!.percent).toBe(50);
  });

  it('should report 100% when all files reviewed', () => {
    const session = manager.createSession(
      'https://github.com/org/repo/pull/1',
      testDir,
      { repository: 'org/repo', branch: 'main', mode: 'diff' },
    );

    manager.setRemainingFiles(session.sessionId, ['a.ts']);
    manager.checkpoint(session.sessionId, [], ['a.ts']);

    const progress = manager.getProgress(session.sessionId);
    expect(progress!.percent).toBe(100);
  });

  it('should return null progress for non-existent session', () => {
    const progress = manager.getProgress('nonexistent');
    expect(progress).toBeNull();
  });
});
