// @ts-nocheck
// @code-analyzer/intelligence — Review Engine additional branch coverage.
// Covers the remaining reachable branches of mapLineThroughHunks (line before
// first hunk, empty hunk list, removal before target) and resumeSession's
// start-record fallback parsing.

import { describe, it, expect } from 'vitest';
import { CodeReviewEngine } from '../review/review-engine.js';
import { SessionStore } from '../review/session-store.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function tempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `rev-branch2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

describe('mapLineThroughHunks — remaining branches', () => {
  it('maps a removal line before the target without advancing newLine', () => {
    const engine = makeEngine(tempDir());
    const hunks = [
      {
        oldStart: 1,
        oldCount: 2,
        newStart: 1,
        newCount: 1,
        header: '@@ -1,2 +1,1 @@',
        lines: ['-old1', ' ctx2'],
        oldLines: [],
        newLines: [],
      },
    ];
    // oldLine 2 (ctx2): '-old1' is a removal before the target, so newLine
    // stays at 1 and the context line maps to newLine 1.
    expect((engine as any).mapLineThroughHunks(2, hunks)).toBe(1);
  });

  it('returns the line unchanged when it precedes the first hunk', () => {
    const engine = makeEngine(tempDir());
    const hunks = [
      {
        oldStart: 10,
        oldCount: 2,
        newStart: 10,
        newCount: 2,
        header: '',
        lines: [],
        oldLines: [],
        newLines: [],
      },
    ];
    expect((engine as any).mapLineThroughHunks(5, hunks)).toBe(5);
  });

  it('returns the line unchanged when the hunk list is empty', () => {
    const engine = makeEngine(tempDir());
    expect((engine as any).mapLineThroughHunks(5, [])).toBe(5);
  });
});

describe('resumeSession — partial start record', () => {
  it('falls back to empty/defaults for a start record missing optional fields', async () => {
    const dir = tempDir();
    try {
      const engine = makeEngine(dir);
      const store = new SessionStore(dir);
      // Write a start record with no projectId/timestamp/metadata.
      fs.writeFileSync(
        path.join(store.directory, 'partial-id.jsonl'),
        JSON.stringify({ type: 'start', sessionId: 'partial-id' }) + '\n',
      );

      const resumed = await engine.resumeSession('partial-id');
      expect(resumed.projectId).toBe('');
      expect(resumed.createdAt).toBe('');
      expect(resumed.mode).toBe('diff');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips non-start records before finding the start record', async () => {
    const dir = tempDir();
    try {
      const engine = makeEngine(dir);
      const store = new SessionStore(dir);
      const lines = [
        JSON.stringify({ type: 'item_done', sessionId: 'mixed-id' }),
        JSON.stringify({ type: 'start', sessionId: 'mixed-id', projectId: 'proj' }),
      ].join('\n');
      fs.writeFileSync(path.join(store.directory, 'mixed-id.jsonl'), lines + '\n');

      const resumed = await engine.resumeSession('mixed-id');
      expect(resumed.projectId).toBe('proj');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
