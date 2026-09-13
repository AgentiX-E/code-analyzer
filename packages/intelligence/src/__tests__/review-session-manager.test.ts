// @code-analyzer/intelligence — ReviewSessionManager filesystem footprint

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ReviewSessionManager } from '../review/session-manager.js';

const roots: string[] = [];
function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsm-'));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length) {
    const dir = roots.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe('ReviewSessionManager — construction', () => {
  it('creates no filesystem entry until a session is saved', () => {
    const repo = tempRepo();

    new ReviewSessionManager(repo);

    // The constructor used to build a `SessionStore` it never read, and
    // `SessionStore`'s constructor calls `ensureDirectory()` — so every manager
    // created a directory named `sessions.db` next to the real `sessions/` tree,
    // for a store nothing consulted. Constructing must be side-effect free.
    expect(fs.existsSync(path.join(repo, '.code-analyzer', 'sessions.db'))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.code-analyzer'))).toBe(false);
  });

  it('writes sessions under .code-analyzer/sessions once one is checkpointed', () => {
    const repo = tempRepo();
    const manager = new ReviewSessionManager(repo);

    const session = manager.createSession('https://example.test/pr/1', repo, {
      repository: 'org/repo',
      branch: 'main',
      mode: 'diff',
    });
    manager.checkpoint(session.sessionId, [], ['src/a.ts']);

    expect(fs.existsSync(path.join(repo, '.code-analyzer', 'sessions'))).toBe(true);
    expect(fs.existsSync(path.join(repo, '.code-analyzer', 'sessions.db'))).toBe(false);
  });
});
