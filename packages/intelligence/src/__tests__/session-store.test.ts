// @code-analyzer/intelligence — Session Store Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SessionStore,
  computeFileFingerprint,
  generateSessionId,
} from '../review/session-store.js';
import type { SessionMetadata, ReviewItemResult, ReviewItemError } from '../review/session-store.js';
import type { ReviewComment } from '@code-analyzer/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTempDir(): string {
  const dir = path.join(os.tmpdir(), `session-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'comment-1',
    path: '/src/test.ts',
    content: 'Test issue',
    thinking: 'Test description',
    existingCode: 'function test() {}',
    suggestionCode: '// fix',
    startLine: 1,
    endLine: 10,
    category: 'maintainability',
    severity: 'medium',
    filtered: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SHA-256 Fingerprint Tests
// ---------------------------------------------------------------------------

describe('SHA-256 Fingerprints', () => {
  it('should produce a consistent fingerprint', () => {
    const fp1 = computeFileFingerprint('diff', '/src/test.ts', 'content');
    const fp2 = computeFileFingerprint('diff', '/src/test.ts', 'content');

    expect(fp1).toBe(fp2);
    expect(fp1.length).toBe(64); // SHA-256 hex is 64 chars
  });

  it('should produce different fingerprints for different content', () => {
    const fp1 = computeFileFingerprint('diff', '/src/test.ts', 'content1');
    const fp2 = computeFileFingerprint('diff', '/src/test.ts', 'content2');

    expect(fp1).not.toBe(fp2);
  });

  it('should produce different fingerprints for different modes', () => {
    const fp1 = computeFileFingerprint('diff', '/src/test.ts', 'content');
    const fp2 = computeFileFingerprint('scan', '/src/test.ts', 'content');

    expect(fp1).not.toBe(fp2);
  });

  it('should produce different fingerprints for different file paths', () => {
    const fp1 = computeFileFingerprint('diff', '/src/a.ts', 'content');
    const fp2 = computeFileFingerprint('diff', '/src/b.ts', 'content');

    expect(fp1).not.toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// Session ID Generation
// ---------------------------------------------------------------------------

describe('Session ID Generation', () => {
  it('should generate unique session IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateSessionId());
    }
    expect(ids.size).toBe(100);
  });

  it('should generate IDs with session prefix', () => {
    const id = generateSessionId();
    expect(id.startsWith('session-')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session Store Tests
// ---------------------------------------------------------------------------

describe('Session Store', () => {
  let store: SessionStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = getTempDir();
    store = new SessionStore(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // cleanup
    }
  });

  describe('startSession()', () => {
    it('should start a new session and return a ReviewSession', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };

      const session = store.startSession('project-1', meta);

      expect(session.id).toBeTruthy();
      expect(session.projectId).toBe('project-1');
      expect(session.status).toBe('running');
      expect(session.mode).toBe('diff');
      expect(session.createdAt).toBeTruthy();
      expect(session.filesReviewed).toBe(0);
      expect(session.commentsGenerated).toBe(0);
    });

    it('should create a JSONL file on disk', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };

      const session = store.startSession('project-1', meta);
      const filePath = path.join(tempDir, `${session.id}.jsonl`);

      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('recordItemDone()', () => {
    it('should record a completed review item', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      const session = store.startSession('project-1', meta);

      const item: ReviewItemResult = {
        filePath: '/src/test.ts',
        fingerprint: 'abc123',
        comments: [createComment()],
        duration: 150,
      };

      expect(() => store.recordItemDone(session.id, item)).not.toThrow();
    });

    it('should persist item record to JSONL', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      const session = store.startSession('project-1', meta);

      const item: ReviewItemResult = {
        filePath: '/src/test.ts',
        fingerprint: 'abc123',
        comments: [createComment()],
        duration: 150,
      };

      store.recordItemDone(session.id, item);

      const records = store.getRecords(session.id);
      expect(records.length).toBeGreaterThanOrEqual(2); // start + done
    });

    it('should record multiple items', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      const session = store.startSession('project-1', meta);

      for (let i = 0; i < 5; i++) {
        const item: ReviewItemResult = {
          filePath: `/src/file${i}.ts`,
          fingerprint: `fp${i}`,
          comments: [createComment()],
          duration: 100,
        };
        store.recordItemDone(session.id, item);
      }

      const records = store.getRecords(session.id);
      expect(records.length).toBe(6); // 1 start + 5 done
    });
  });

  describe('recordItemFailed()', () => {
    it('should record a failed review item', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      const session = store.startSession('project-1', meta);

      const error: ReviewItemError = {
        filePath: '/src/broken.ts',
        fingerprint: 'bad-fp',
        error: 'Parse error',
        duration: 50,
      };

      expect(() => store.recordItemFailed(session.id, error)).not.toThrow();

      const records = store.getRecords(session.id);
      expect(records.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('buildResumeState()', () => {
    it('should return completed files and reused comments', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      const session = store.startSession('project-1', meta);

      const comment = createComment();
      const item: ReviewItemResult = {
        filePath: '/src/test.ts',
        fingerprint: 'fp-1',
        comments: [comment],
        duration: 100,
      };

      store.recordItemDone(session.id, item);

      const resumeState = store.buildResumeState(session.id);

      expect(resumeState.completedFiles.has('fp-1')).toBe(true);
      expect(resumeState.reusedComments.length).toBe(1);
      expect(resumeState.reusedComments[0]!.id).toBe(comment.id);
    });

    it('should handle sessions with no completed files', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      const session = store.startSession('project-1', meta);

      const resumeState = store.buildResumeState(session.id);

      expect(resumeState.completedFiles.size).toBe(0);
      expect(resumeState.reusedComments.length).toBe(0);
    });
  });

  describe('listSessions()', () => {
    it('should list sessions for a project', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      store.startSession('project-1', meta);
      store.startSession('project-1', meta);

      const sessions = store.listSessions('project-1');
      expect(sessions.length).toBe(2);
    });

    it('should only list sessions for matching project', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      store.startSession('project-1', meta);
      store.startSession('project-2', meta);

      const sessions = store.listSessions('project-1');
      expect(sessions.length).toBe(1);
    });

    it('should include session metadata in listings', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      store.startSession('project-1', meta);

      const sessions = store.listSessions('project-1');
      expect(sessions[0]!.projectId).toBe('project-1');
      expect(sessions[0]!.mode).toBe('diff');
      expect(sessions[0]!.createdAt).toBeTruthy();
    });
  });

  describe('getRecords()', () => {
    it('should return all records as JSON strings', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      const session = store.startSession('project-1', meta);

      const records = store.getRecords(session.id);
      expect(records.length).toBe(1);
      expect(() => JSON.parse(records[0]!)).not.toThrow();
    });

    it('should return empty array for non-existent session', () => {
      const records = store.getRecords('nonexistent');
      expect(records).toEqual([]);
    });
  });

  describe('completeSession()', () => {
    it('should mark a session as completed', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      const session = store.startSession('project-1', meta);

      expect(() => store.completeSession(session.id)).not.toThrow();
    });

    it('should handle completing unknown session', () => {
      expect(() => store.completeSession('nonexistent')).not.toThrow();
    });
  });

  describe('deleteSession()', () => {
    it('should delete a session from disk', () => {
      const meta: SessionMetadata = {
        repository: 'test/repo',
        branch: 'main',
        mode: 'diff',
      };
      const session = store.startSession('project-1', meta);
      const filePath = path.join(tempDir, `${session.id}.jsonl`);

      expect(fs.existsSync(filePath)).toBe(true);

      store.deleteSession(session.id);

      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe('directory property', () => {
    it('should return the sessions directory path', () => {
      expect(store.directory).toBe(tempDir);
    });
  });
});
