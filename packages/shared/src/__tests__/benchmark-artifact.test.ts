// The gate on recording: a figure reaches `benchmarks/` only when the run says it means to publish one.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ARTIFACT_WRITE_ENV,
  artifactRecordingEnabled,
  recordArtifact,
} from '../benchmark/artifact.js';

describe('recording a benchmark figure', () => {
  let cwd: string;
  let original: string;

  beforeEach(() => {
    original = process.cwd();
    cwd = mkdtempSync(join(tmpdir(), 'artifact-'));
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(original);
    rmSync(cwd, { recursive: true, force: true });
  });

  it('is off when the variable is absent, and says how to turn it on', () => {
    const record = recordArtifact('benchmarks/example.json', { value: 1 }, {});
    expect(record.written).toBe(false);
    expect(record.because).toContain(ARTIFACT_WRITE_ENV);
    expect(record.because).toContain('off');
    expect(existsSync(join(cwd, 'benchmarks/example.json'))).toBe(false);
  });

  it('treats anything other than 1 as off, so a typo cannot half-enable it', () => {
    for (const value of ['true', 'yes', '0', '', ' 1']) {
      expect(artifactRecordingEnabled({ [ARTIFACT_WRITE_ENV]: value })).toBe(false);
      expect(
        recordArtifact('benchmarks/example.json', {}, { [ARTIFACT_WRITE_ENV]: value }).written,
      ).toBe(false);
    }
    expect(existsSync(join(cwd, 'benchmarks/example.json'))).toBe(false);
  });

  it('writes two-space JSON with a trailing newline, which is what the formatter reads', () => {
    const record = recordArtifact(
      'benchmarks/example.json',
      { a: 1, b: [2] },
      { [ARTIFACT_WRITE_ENV]: '1' },
    );
    expect(record.written).toBe(true);
    expect(record.path).toBe('benchmarks/example.json');
    const text = readFileSync(join(cwd, 'benchmarks/example.json'), 'utf8');
    expect(text).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n');
    expect(JSON.parse(text)).toEqual({ a: 1, b: [2] });
  });

  it('creates the directory a first figure needs', () => {
    const record = recordArtifact(
      'benchmarks/nested/deep.json',
      { ok: true },
      { [ARTIFACT_WRITE_ENV]: '1' },
    );
    expect(record.written).toBe(true);
    expect(JSON.parse(readFileSync(join(cwd, 'benchmarks/nested/deep.json'), 'utf8'))).toEqual({
      ok: true,
    });
  });

  it('refuses a path outside benchmarks/, because no gate would read it', () => {
    expect(() => recordArtifact('docs/example.json', {}, { [ARTIFACT_WRITE_ENV]: '1' })).toThrow(
      /artifacts live under benchmarks\//,
    );
    expect(() => recordArtifact('benchmarks/../docs/example.json', {}, {})).toThrow();
    expect(existsSync(join(cwd, 'docs/example.json'))).toBe(false);
  });

  it('leaves an existing artifact untouched when recording is off', () => {
    recordArtifact('benchmarks/example.json', { kept: true }, { [ARTIFACT_WRITE_ENV]: '1' });
    const before = readFileSync(join(cwd, 'benchmarks/example.json'), 'utf8');
    const record = recordArtifact('benchmarks/example.json', { kept: false }, {});
    expect(record.written).toBe(false);
    expect(readFileSync(join(cwd, 'benchmarks/example.json'), 'utf8')).toBe(before);
  });
});
