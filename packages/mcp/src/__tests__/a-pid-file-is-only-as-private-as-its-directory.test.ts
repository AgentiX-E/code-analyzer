// A pid file is only as private as the directory it sits in, and the attack has to be replayed rather than described.
//
// **The finding.** `js/insecure-temporary-file` on `packages/mcp/src/daemon/daemon.ts`, from a default of
// `/tmp/code-analyzer.pid`. That is the shape of the whole class: a shared, world-writable directory and a name anyone
// can guess. Whoever creates the name first owns it, `writeFileSync` follows whatever it points at, and a symlink
// planted before the daemon starts turns the daemon's first write into a write somewhere else with the daemon's
// privileges. On a machine where several people are logged in, that is one user writing a file as another.
//
// **The name cannot be randomised**, and the reason is the feature: a pid file exists so that a second process can find
// the first, so both ends must agree on where it is. So the fix is the directory - `$XDG_RUNTIME_DIR` when the session
// gives one, otherwise a directory created 0700 and then *checked*, because "already there" is the case being defended
// against.
//
// **This file replays the attack.** Not a paragraph about the shape of it: a symlink where the daemon's directory should
// be, a daemon started with defaults, and an assertion that the victim directory gained nothing. That is what this
// repository means by closing an alert.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CodeAnalyzerDaemon,
  defaultPidDirectory,
  defaultPidFile,
  ensurePrivateDirectory,
  privateDirectoryProblem,
} from '../daemon/daemon.js';

const created: string[] = [];
const previousRuntimeDir = process.env['XDG_RUNTIME_DIR'];

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterEach(() => {
  if (previousRuntimeDir === undefined) delete process.env['XDG_RUNTIME_DIR'];
  else process.env['XDG_RUNTIME_DIR'] = previousRuntimeDir;
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('where the daemon puts its pid file', () => {
  it('is a per-user directory under the runtime directory when the session provides one', () => {
    process.env['XDG_RUNTIME_DIR'] = '/run/user/1234';
    expect(defaultPidDirectory()).toBe('/run/user/1234/code-analyzer');
    expect(defaultPidFile()).toBe('/run/user/1234/code-analyzer/daemon.pid');
  });

  it('is a per-user directory under the temporary directory when it does not', () => {
    delete process.env['XDG_RUNTIME_DIR'];
    const directory = defaultPidDirectory();
    expect(directory.startsWith(tmpdir())).toBe(true);
    // The name carries the uid, so two accounts on one machine do not share a pid file and cannot lock each other out.
    expect(directory).toMatch(/code-analyzer-(\d+|user)$/);
    expect(defaultPidFile()).toBe(join(directory, 'daemon.pid'));
  });

  it('is not the single shared name it used to be', () => {
    delete process.env['XDG_RUNTIME_DIR'];
    expect(defaultPidFile()).not.toBe('/tmp/code-analyzer.pid');
  });
});

describe('a directory the daemon will write a pid file into', () => {
  it('is created 0700, so the pid file is not readable by everyone on the machine', () => {
    const target = join(scratch('pid-dir-'), 'code-analyzer');
    ensurePrivateDirectory(target);

    expect(lstatSync(target).isDirectory()).toBe(true);
    expect(lstatSync(target).mode & 0o777).toBe(0o700);
  });

  it('is narrowed to 0700 when it already exists with a wider mode', () => {
    const target = join(scratch('pid-dir-wide-'), 'code-analyzer');
    mkdirSync(target, { recursive: true, mode: 0o755 });

    ensurePrivateDirectory(target);

    expect(lstatSync(target).mode & 0o777).toBe(0o700);
  });

  it('is refused when a component of the path is a file, which is the one create that throws', () => {
    // `mkdirSync(..., { recursive: true })` is silent about a directory that already exists, so the only path through its
    // `catch` is a parent that cannot be a directory. That is the arm this case exists to reach.
    const parent = scratch('pid-dir-enotdir-');
    const file = join(parent, 'blocker');
    writeFileSync(file, 'not a directory');

    expect(() => ensurePrivateDirectory(join(file, 'code-analyzer'))).toThrow(
      /cannot be created as a directory .* - refusing to write a pid file through it/,
    );
  });

  it('is refused when it is a regular file rather than a directory', () => {
    const parent = scratch('pid-dir-file-');
    const target = join(parent, 'code-analyzer');
    writeFileSync(target, 'not a directory');

    // The refusal reads the same whichever way the path is unusable, because a caller that has to pattern-match three
    // different messages is a caller that will match none of them.
    expect(() => ensurePrivateDirectory(target)).toThrow(/refusing to write a pid file through it/);
  });
});

describe('a symlink planted where the daemon directory should be', () => {
  it('is refused, and the victim directory gains no pid file', async () => {
    const victim = scratch('pid-victim-');
    const runtime = scratch('pid-runtime-');
    process.env['XDG_RUNTIME_DIR'] = runtime;
    symlinkSync(victim, join(runtime, 'code-analyzer'));

    const errors: string[] = [];
    const daemon = new CodeAnalyzerDaemon({ port: 0 });
    daemon.on('error', (error: Error) => errors.push(error.message));

    // **`start()` does not throw for this**: writing the pid file is best-effort and reports through the event, which is
    // why the assertion is on what the filesystem looks like afterwards as well as on the message. `stop()` is in a
    // `finally` because a daemon that has bound a port and registered three signal handlers is a handle a worker cannot
    // exit past - and an assertion that throws before the stop would leave exactly that behind for the next file.
    await daemon.start();
    try {
      expect(errors.join('\n')).toMatch(/not a directory/);
      expect(existsSync(join(victim, 'daemon.pid'))).toBe(false);
    } finally {
      await daemon.stop();
    }
  });
});

describe('a daemon started with the default pid file', () => {
  it('writes it inside its own directory, 0600, and removes it on stop', async () => {
    const runtime = scratch('pid-real-');
    process.env['XDG_RUNTIME_DIR'] = runtime;
    const pidFile = defaultPidFile();

    const daemon = new CodeAnalyzerDaemon({ port: 0 });
    const errors: string[] = [];
    daemon.on('error', (error: Error) => errors.push(error.message));

    await daemon.start();
    try {
      expect(errors).toEqual([]);
      expect(readFileSync(pidFile, 'utf-8').trim()).toBe(String(process.pid));
      expect(lstatSync(pidFile).mode & 0o777).toBe(0o600);
      expect(lstatSync(join(runtime, 'code-analyzer')).mode & 0o777).toBe(0o700);
    } finally {
      await daemon.stop();
    }
    expect(existsSync(pidFile)).toBe(false);
  });
});

describe('the judgment about a directory, as a value', () => {
  /** A directory owned by whoever is asking. */
  const ours = { isDirectory: () => true, isSymbolicLink: () => false, uid: 1000 };

  it('accepts a real directory owned by this user', () => {
    expect(privateDirectoryProblem('/run/user/1000/code-analyzer', ours, 1000)).toBeNull();
  });

  it('accepts it when the platform has no uid to compare', () => {
    // `process.getuid` is undefined on Windows, so the ownership check is the one thing that cannot run there. Saying so
    // is better than a check that silently passes for a different reason.
    expect(
      privateDirectoryProblem('/tmp/code-analyzer-user', { ...ours, uid: 0 }, null),
    ).toBeNull();
  });

  it('refuses a directory owned by somebody else, which is the case no test can stage', () => {
    expect(privateDirectoryProblem('/tmp/code-analyzer-1000', { ...ours, uid: 0 }, 1000)).toBe(
      '/tmp/code-analyzer-1000 belongs to uid 0, not to this user',
    );
  });

  it('refuses a symlink even when it resolves to a directory we own', () => {
    expect(
      privateDirectoryProblem('/tmp/link', { ...ours, isSymbolicLink: () => true }, 1000),
    ).toBe('/tmp/link is not a directory');
  });

  it('refuses something that is not a directory at all', () => {
    expect(privateDirectoryProblem('/tmp/file', { ...ours, isDirectory: () => false }, 1000)).toBe(
      '/tmp/file is not a directory',
    );
  });
});
