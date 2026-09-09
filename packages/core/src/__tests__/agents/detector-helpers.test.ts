/**
 * Unit tests for the AI Agent Auto-Detector's exported signal helpers.
 *
 * These cover the environment- and filesystem-sensitive branches that the
 * end-to-end detector tests cannot reach deterministically (empty env vars,
 * ~-prefixed paths, PATH binaries, /proc process scanning, VS Code extension
 * directories, and the high-confidence aggregation branch).
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  hasEnv,
  hasPath,
  hasBinary,
  aggregateConfidence,
  checkProcess,
  getVSCodeExtDirs,
  checkVSCodeExtension,
  detectAgent,
  detectAllAgents,
  getAgentRegistry,
} from '../../agents/detector.js';
import type { AgentMetadata, DetectionSignal } from '../../agents/types.js';

// ── Helpers ──────────────────────────────────────────────────────

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  }
});

function makeMeta(overrides: Partial<AgentMetadata> = {}): AgentMetadata {
  return {
    id: 'cline',
    name: 'Cline',
    homepage: 'https://example.com',
    envSignals: [],
    configSignals: [],
    binarySignals: [],
    extensionSignals: [],
    processSignals: [],
    preferredTransport: 'stdio',
    ...overrides,
  };
}

function signal(
  type: DetectionSignal['type'],
  confidence: DetectionSignal['confidence'],
): DetectionSignal {
  return { type, detail: `test ${type}`, confidence };
}

// ── hasEnv ───────────────────────────────────────────────────────

describe('hasEnv', () => {
  it('returns true for a non-empty env var', () => {
    process.env['CODE_ANALYZER_TEST_ENV'] = 'value';
    expect(hasEnv('CODE_ANALYZER_TEST_ENV')).toBe(true);
    delete process.env['CODE_ANALYZER_TEST_ENV'];
  });

  it('returns false for an unset env var', () => {
    delete process.env['CODE_ANALYZER_TEST_MISSING'];
    expect(hasEnv('CODE_ANALYZER_TEST_MISSING')).toBe(false);
  });

  it('returns false for an empty-string env var', () => {
    process.env['CODE_ANALYZER_TEST_EMPTY'] = '';
    expect(hasEnv('CODE_ANALYZER_TEST_EMPTY')).toBe(false);
    delete process.env['CODE_ANALYZER_TEST_EMPTY'];
  });
});

// ── hasPath ──────────────────────────────────────────────────────

describe('hasPath', () => {
  it('returns true for an existing absolute path', () => {
    const dir = makeTempDir('path-');
    const file = path.join(dir, 'exists');
    fs.writeFileSync(file, '');
    expect(hasPath(file)).toBe(true);
  });

  it('returns false for a non-existent absolute path', () => {
    const dir = makeTempDir('path-');
    expect(hasPath(path.join(dir, 'missing'))).toBe(false);
  });

  it('resolves ~ against the injected home directory', () => {
    const home = makeTempDir('home-');
    fs.writeFileSync(path.join(home, 'real-file'), '');
    expect(hasPath('~/real-file', home)).toBe(true);
  });

  it('returns false for a non-existent ~-prefixed path', () => {
    const home = makeTempDir('home-');
    expect(hasPath('~/missing', home)).toBe(false);
  });
});

// ── hasBinary ────────────────────────────────────────────────────

describe('hasBinary', () => {
  it('returns true when an executable is in the injected PATH', () => {
    const binDir = makeTempDir('bin-');
    const bin = path.join(binDir, 'my-tool');
    fs.writeFileSync(bin, '#!/bin/sh\n');
    fs.chmodSync(bin, 0o755);
    expect(hasBinary('my-tool', binDir)).toBe(true);
  });

  it('returns false when the binary is not in the injected PATH', () => {
    const binDir = makeTempDir('bin-');
    expect(hasBinary('does-not-exist', binDir)).toBe(false);
  });

  it('falls back to /usr/bin when PATH is unset', () => {
    const saved = process.env['PATH'];
    delete process.env['PATH'];
    try {
      expect(typeof hasBinary('node')).toBe('boolean');
    } finally {
      if (saved !== undefined) process.env['PATH'] = saved;
      else delete process.env['PATH'];
    }
  });
});

// ── aggregateConfidence ──────────────────────────────────────────

describe('aggregateConfidence', () => {
  it('returns low for no signals', () => {
    expect(aggregateConfidence([])).toBe('low');
  });

  it('returns low for a single medium signal', () => {
    expect(aggregateConfidence([signal('env', 'medium')])).toBe('low');
  });

  it('returns medium for a single high signal', () => {
    expect(aggregateConfidence([signal('config', 'high')])).toBe('medium');
  });

  it('returns medium for two medium signals', () => {
    expect(aggregateConfidence([signal('env', 'medium'), signal('env', 'medium')])).toBe('medium');
  });

  it('returns medium for one high and one medium signal', () => {
    expect(aggregateConfidence([signal('config', 'high'), signal('env', 'medium')])).toBe('medium');
  });

  it('returns high for two high signals', () => {
    expect(aggregateConfidence([signal('config', 'high'), signal('config', 'high')])).toBe('high');
  });

  it('returns high for one high and two medium signals', () => {
    expect(
      aggregateConfidence([
        signal('config', 'high'),
        signal('env', 'medium'),
        signal('env', 'medium'),
      ]),
    ).toBe('high');
  });
});

// ── checkProcess ─────────────────────────────────────────────────

describe('checkProcess', () => {
  function makeProcRoot(commName?: string): string {
    const procRoot = makeTempDir('proc-');
    // A non-numeric entry must be filtered out by the pid regex.
    fs.writeFileSync(path.join(procRoot, 'version'), '');
    const pidDir = path.join(procRoot, '123');
    fs.mkdirSync(pidDir);
    if (commName !== undefined) {
      fs.writeFileSync(path.join(pidDir, 'comm'), `${commName}\n`);
    }
    return procRoot;
  }

  it('returns true when a matching process is found (case-insensitive)', () => {
    const procRoot = makeProcRoot('TestProc');
    expect(checkProcess('testproc', 'linux', procRoot)).toBe(true);
  });

  it('returns false when no process matches', () => {
    const procRoot = makeProcRoot('something-else');
    expect(checkProcess('testproc', 'linux', procRoot)).toBe(false);
  });

  it('returns false on non-Linux platforms', () => {
    expect(checkProcess('testproc', 'darwin', makeTempDir('proc-'))).toBe(false);
  });

  it('returns false when the proc root is unreadable', () => {
    expect(checkProcess('testproc', 'linux', '/definitely/not/a/proc')).toBe(false);
  });

  it('skips pids whose comm file is unreadable', () => {
    const procRoot = makeProcRoot(); // 123/ dir exists but has no comm file
    expect(checkProcess('testproc', 'linux', procRoot)).toBe(false);
  });
});

// ── getVSCodeExtDirs ─────────────────────────────────────────────

describe('getVSCodeExtDirs', () => {
  it('returns a single directory on non-macOS platforms', () => {
    const dirs = getVSCodeExtDirs('linux');
    expect(dirs).toHaveLength(1);
    expect(dirs[0]!.endsWith(path.join('.vscode', 'extensions'))).toBe(true);
  });

  it('adds the Code user directory on macOS', () => {
    const dirs = getVSCodeExtDirs('darwin');
    expect(dirs).toHaveLength(2);
    expect(dirs[1]!.endsWith(path.join('Application Support', 'Code', 'User'))).toBe(true);
  });
});

// ── checkVSCodeExtension ─────────────────────────────────────────

describe('checkVSCodeExtension', () => {
  it('returns true when a matching extension directory exists', () => {
    const extDir = makeTempDir('ext-');
    fs.mkdirSync(path.join(extDir, 'github.copilot-1.0.0'));
    expect(checkVSCodeExtension('GitHub.copilot', [extDir])).toBe(true);
  });

  it('matches case-insensitively', () => {
    const extDir = makeTempDir('ext-');
    fs.mkdirSync(path.join(extDir, 'GITHUB.COPILOT-1.0.0'));
    expect(checkVSCodeExtension('github.copilot', [extDir])).toBe(true);
  });

  it('returns false when no extension directory matches', () => {
    const extDir = makeTempDir('ext-');
    fs.mkdirSync(path.join(extDir, 'ms-python.python-1.0.0'));
    expect(checkVSCodeExtension('GitHub.copilot', [extDir])).toBe(false);
  });

  it('returns false for a non-existent directory', () => {
    expect(
      checkVSCodeExtension('GitHub.copilot', [path.join(makeTempDir('ext-'), 'missing')]),
    ).toBe(false);
  });

  it('returns false for an empty extension directory', () => {
    const extDir = makeTempDir('ext-');
    expect(checkVSCodeExtension('GitHub.copilot', [extDir])).toBe(false);
  });
});

// ── detectAgent (injected environment) ───────────────────────────

describe('detectAgent', () => {
  it('detects via a config file in the injected cwd', () => {
    const cwd = makeTempDir('cwd-');
    fs.writeFileSync(path.join(cwd, '.test-agent.conf'), '');
    const result = detectAgent(makeMeta({ configSignals: ['.test-agent.conf'] }), { cwd });
    expect(result.detected).toBe(true);
    expect(result.signals.some((s) => s.type === 'config')).toBe(true);
  });

  it('detects via a binary in the injected PATH', () => {
    const binDir = makeTempDir('bin-');
    const bin = path.join(binDir, 'test-agent-bin');
    fs.writeFileSync(bin, '#!/bin/sh\n');
    fs.chmodSync(bin, 0o755);
    const result = detectAgent(makeMeta({ binarySignals: ['test-agent-bin'] }), {
      pathEnv: binDir,
    });
    expect(result.detected).toBe(true);
    expect(result.signals.some((s) => s.type === 'binary')).toBe(true);
  });

  it('detects via a process in the injected proc root', () => {
    const procRoot = makeTempDir('proc-');
    const pidDir = path.join(procRoot, '42');
    fs.mkdirSync(pidDir);
    fs.writeFileSync(path.join(pidDir, 'comm'), 'test-agent-proc\n');
    const result = detectAgent(makeMeta({ processSignals: ['test-agent-proc'] }), {
      platform: 'linux',
      procRoot,
    });
    expect(result.detected).toBe(true);
    expect(result.signals.some((s) => s.type === 'process')).toBe(true);
  });

  it('detects via a VS Code extension in the injected dirs', () => {
    const extDir = makeTempDir('ext-');
    fs.mkdirSync(path.join(extDir, 'test.publisher-1.0.0'));
    const result = detectAgent(makeMeta({ extensionSignals: ['Test.publisher'] }), {
      extDirs: [extDir],
    });
    expect(result.detected).toBe(true);
    expect(result.signals.some((s) => s.type === 'extension')).toBe(true);
  });

  it('reports not detected when no signals match', () => {
    const result = detectAgent(makeMeta());
    expect(result.detected).toBe(false);
    expect(result.signals).toHaveLength(0);
    expect(result.confidence).toBe('low');
  });
});

// ── detectAllAgents (injected environment) ───────────────────────

describe('detectAllAgents', () => {
  const allEnvSignals = getAgentRegistry().flatMap((a) => a.envSignals);

  function isolateEnv(): Record<string, string | undefined> {
    const saved: Record<string, string | undefined> = {};
    for (const key of allEnvSignals) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    return saved;
  }

  function restoreEnv(saved: Record<string, string | undefined>): void {
    for (const [key, val] of Object.entries(saved)) {
      if (val !== undefined) process.env[key] = val;
      else delete process.env[key];
    }
  }

  it('sets primary to null when no agents are detected', () => {
    const saved = isolateEnv();
    try {
      const empty = makeTempDir('empty-');
      const result = detectAllAgents({
        home: empty,
        cwd: empty,
        pathEnv: empty,
        platform: 'darwin',
        procRoot: '/definitely/not/a/proc',
        extDirs: [],
      });
      expect(result.detectedCount).toBe(0);
      expect(result.primary).toBeNull();
    } finally {
      restoreEnv(saved);
    }
  });
});
