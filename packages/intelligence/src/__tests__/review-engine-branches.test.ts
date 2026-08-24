// @ts-nocheck
// @code-analyzer/intelligence — Review Engine private-method branch coverage.

import { describe, it, expect } from 'vitest';
import { CodeReviewEngine, ReviewEngineError } from '../review/review-engine.js';
import { SessionStore } from '../review/session-store.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function makeComment(overrides = {}) {
  return {
    path: '/src/a.ts',
    content: 'comment',
    existingCode: 'x = 1;',
    startLine: 1,
    endLine: 1,
    category: 'bug',
    severity: 'medium',
    filtered: false,
    id: 'c1',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function tempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `rev-branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEngine(dir: string): CodeReviewEngine {
  return new CodeReviewEngine(
    new InMemoryGraphStore(),
    { allowMetadataFallback: true },
    new SessionStore(dir),
  );
}

describe('mapLineThroughHunks (private)', () => {
  const engine = makeEngine(tempDir());

  it('maps a context line to the same relative position', () => {
    const hunks = [
      {
        oldStart: 1,
        oldCount: 4,
        newStart: 1,
        newCount: 4,
        header: '@@ -1,4 +1,4 @@',
        lines: [' ctx1', ' ctx2', ' ctx3', ' ctx4'],
        oldLines: [],
        newLines: [],
      },
    ];
    // oldLine 2 is a context line -> newLine 2
    expect((engine as any).mapLineThroughHunks(2, hunks)).toBe(2);
  });

  it('maps a removed line to the nearest new line', () => {
    const hunks = [
      {
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 2,
        header: '@@ -1,3 +1,2 @@',
        lines: [' ctx', '-removed', '+added'],
        oldLines: [],
        newLines: [],
      },
    ];
    // oldLine 2 is removed -> returns nearest new line
    const mapped = (engine as any).mapLineThroughHunks(2, hunks);
    expect(typeof mapped).toBe('number');
  });

  it('advances newLine for addition lines without touching the counter', () => {
    const hunks = [
      {
        oldStart: 1,
        oldCount: 2,
        newStart: 1,
        newCount: 4,
        header: '@@ -1,2 +1,4 @@',
        lines: ['+a', '+b', ' ctx1', ' ctx2'],
        oldLines: [],
        newLines: [],
      },
    ];
    // oldLine 1 is a context line after two additions -> newLine 3
    expect((engine as any).mapLineThroughHunks(1, hunks)).toBe(3);
  });

  it('breaks past the target when a context line follows the target removal', () => {
    const hunks = [
      {
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 3,
        header: '@@ -1,3 +1,3 @@',
        lines: ['-removed', ' ctx2', ' ctx3'],
        oldLines: [],
        newLines: [],
      },
    ];
    const mapped = (engine as any).mapLineThroughHunks(1, hunks);
    expect(typeof mapped).toBe('number');
  });
});

describe('applyCumulativeOffset (private)', () => {
  it('applies offset only for hunks fully before the line', () => {
    const engine = makeEngine(tempDir());
    const hunks = [
      {
        oldStart: 1,
        oldCount: 2,
        newStart: 1,
        newCount: 5,
        header: '',
        lines: [],
        oldLines: [],
        newLines: [],
      },
      {
        oldStart: 10,
        oldCount: 2,
        newStart: 13,
        newCount: 2,
        header: '',
        lines: [],
        oldLines: [],
        newLines: [],
      },
    ];
    // oldLine 20 is after both hunks: offset (5-2)+(2-2) = 3 -> 23
    expect((engine as any).applyCumulativeOffset(20, hunks)).toBe(23);
  });

  it('ignores hunks that contain the line', () => {
    const engine = makeEngine(tempDir());
    const hunks = [
      {
        oldStart: 1,
        oldCount: 10,
        newStart: 1,
        newCount: 20,
        header: '',
        lines: [],
        oldLines: [],
        newLines: [],
      },
    ];
    // oldLine 5 is inside the hunk (1..11) -> no offset
    expect((engine as any).applyCumulativeOffset(5, hunks)).toBe(5);
  });
});

describe('mergeAndDeduplicate (private)', () => {
  const engine = makeEngine(tempDir());

  it('returns heuristic comments unchanged when llm list is empty', () => {
    const heuristic = [makeComment()];
    expect((engine as any).mergeAndDeduplicate(heuristic, [])).toHaveLength(1);
  });

  it('returns llm comments when heuristic list is empty', () => {
    const llm = [makeComment({ id: 'llm1' })];
    expect((engine as any).mergeAndDeduplicate([], llm)).toHaveLength(1);
  });

  it('keeps an llm comment whose category differs from all heuristic comments', () => {
    const heuristic = [makeComment({ category: 'bug' })];
    const llm = [makeComment({ id: 'llm1', category: 'security' })];
    const merged = (engine as any).mergeAndDeduplicate(heuristic, llm);
    expect(merged).toHaveLength(2);
  });

  it('deduplicates an llm comment that overlaps a heuristic comment in the same category', () => {
    const heuristic = [makeComment({ category: 'bug', startLine: 1, endLine: 10 })];
    const llm = [makeComment({ id: 'llm1', category: 'bug', startLine: 8, endLine: 12 })];
    const merged = (engine as any).mergeAndDeduplicate(heuristic, llm);
    expect(merged).toHaveLength(1);
  });
});

describe('getDiffContentSync (private)', () => {
  it('includes old path and range annotations when present', () => {
    const engine = makeEngine(tempDir());
    const diff = {
      filePath: '/src/a.ts',
      oldPath: '/src/old.ts',
      changeType: 'modified',
      ranges: [{ oldStart: 1, oldEnd: 3, newStart: 1, newEnd: 5, changeType: 'modified' }],
    };
    const content = (engine as any).getDiffContentSync(diff);
    expect(content).toContain('Old path: /src/old.ts');
    expect(content).toContain('Range: L1-L3');
  });
});

describe('getDiffContent (private) error handling', () => {
  it('rethrows ReviewEngineError without wrapping', async () => {
    const engine = makeEngine(tempDir());
    const gitOps = {
      readFileContent: async () => '',
      readFileRange: async () => {
        throw new ReviewEngineError('boom', 'FILE_NOT_FOUND');
      },
      getFileDiff: async () => '',
      getDiffHunks: async () => [],
      fileExists: async () => true,
    };
    const diff = {
      filePath: '/src/a.ts',
      changeType: 'modified',
      ranges: [{ oldStart: 1, oldEnd: 3, newStart: 1, newEnd: 3, changeType: 'modified' }],
    };
    await expect((engine as any).getDiffContent(diff, gitOps)).rejects.toThrow(ReviewEngineError);
  });

  it('falls back to metadata when a range read fails and fallback is allowed', async () => {
    const engine = makeEngine(tempDir());
    const gitOps = {
      readFileContent: async () => '',
      readFileRange: async () => {
        throw new Error('io error');
      },
      getFileDiff: async () => '',
      getDiffHunks: async () => [],
      fileExists: async () => true,
    };
    const diff = {
      filePath: '/src/a.ts',
      changeType: 'modified',
      ranges: [{ oldStart: 1, oldEnd: 3, newStart: 1, newEnd: 3, changeType: 'modified' }],
    };
    const content = await (engine as any).getDiffContent(diff, gitOps);
    expect(content).toContain('Metadata-Only Review');
  });

  it('wraps a non-Error throw into ReviewEngineError when fallback is disabled', async () => {
    const engine = new CodeReviewEngine(
      new InMemoryGraphStore(),
      { allowMetadataFallback: false },
      new SessionStore(tempDir()),
    );
    const gitOps = {
      readFileContent: async () => '',
      readFileRange: async () => {
        throw 'plain string failure';
      },
      getFileDiff: async () => '',
      getDiffHunks: async () => [],
      fileExists: async () => true,
    };
    const diff = {
      filePath: '/src/a.ts',
      changeType: 'modified',
      ranges: [{ oldStart: 1, oldEnd: 3, newStart: 1, newEnd: 3, changeType: 'modified' }],
    };
    await expect((engine as any).getDiffContent(diff, gitOps)).rejects.toThrow(
      /plain string failure/,
    );
  });

  it('applies metadata fallback for an added file whose content read fails', async () => {
    // Regression: getDiffContent used `return` (not `await`) for the added
    // path, so a readFileContent rejection bypassed the catch block and the
    // metadata fallback silently never ran.
    const engine = makeEngine(tempDir());
    const gitOps = {
      readFileContent: async () => {
        throw new Error('io error on added file');
      },
      readFileRange: async () => '',
      getFileDiff: async () => '',
      getDiffHunks: async () => [],
      fileExists: async () => true,
    };
    const diff = { filePath: '/src/new.ts', changeType: 'added', ranges: [] };
    const content = await (engine as any).getDiffContent(diff, gitOps, undefined, 'target');
    expect(content).toContain('Metadata-Only Review');
  });

  it('falls through to range extraction when getFileDiff rejects', async () => {
    const engine = makeEngine(tempDir());
    const gitOps = {
      readFileContent: async () => 'full content',
      readFileRange: async (_p, start, end) => `range ${start}-${end}`,
      getFileDiff: async () => {
        throw new Error('diff unavailable');
      },
      getDiffHunks: async () => [],
      fileExists: async () => true,
    };
    const diff = {
      filePath: '/src/a.ts',
      changeType: 'modified',
      ranges: [{ oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 2, changeType: 'modified' }],
    };
    const content = await (engine as any).getDiffContent(diff, gitOps, 'base', 'target');
    expect(content).toContain('range 1-2');
  });
});

describe('resumeSession start-record parsing', () => {
  it('recovers projectId, createdAt, and mode from the start record', async () => {
    const dir = tempDir();
    try {
      const engine = makeEngine(dir);
      const diff = {
        filePath: '/src/a.ts',
        oldHash: 'a',
        newHash: 'b',
        changeType: 'modified',
        ranges: [],
      };
      const session = await engine.reviewDiff('test-project', [diff]);
      const resumed = await engine.resumeSession(session.id);
      expect(resumed.projectId).toBe('test-project');
      expect(resumed.createdAt).not.toBe('');
      expect(resumed.mode).toBe('diff');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
