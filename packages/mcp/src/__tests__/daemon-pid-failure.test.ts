// @code-analyzer/mcp — daemon PID-write failure with a non-Error throw
//
// `node:fs`'s exports are non-configurable, so `vi.spyOn(fs, 'writeFileSync')`
// throws "Cannot redefine property". Substituting the module is the remaining
// route, and a module substitution is per-file — hence a file of its own rather
// than a case inside the daemon suite.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';

const { writeFileSync } = vi.hoisted(() => ({
  writeFileSync: vi.fn(() => {
    throw 'disk full';
  }),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  // Only the write is replaced; everything else the daemon needs stays real.
  return { ...actual, writeFileSync };
});

import { CodeAnalyzerDaemon } from '../daemon/daemon.js';

describe('CodeAnalyzerDaemon — PID write failure', () => {
  let daemon: CodeAnalyzerDaemon | undefined;

  afterEach(async () => {
    try {
      await daemon?.stop();
    } catch {
      // Ignore teardown errors
    }
  });

  it('stringifies a PID write failure that is not an Error', async () => {
    const pidFile = path.join(os.tmpdir(), `ca-pid-failure-${Date.now()}.pid`);
    daemon = new CodeAnalyzerDaemon({ pidFile, port: 0 });

    const errors: string[] = [];
    daemon.on('error', (e: Error) => errors.push(e.message));

    await daemon.start();

    // Reading `.message` off a string would give `undefined`, so the emitted
    // message is only correct if the value went through `String(err)`.
    expect(writeFileSync).toHaveBeenCalled();
    expect(errors).toEqual(['Failed to write PID file: disk full']);
  });
});
