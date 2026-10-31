// The gate on recording: a figure reaches `benchmarks/` only when the run says it means to publish one.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// **A fallback run is a different measurement, not a newer one.** The docstring artifact in this repository was replaced
// by a local run with no `ZHIPU_API_KEY`: the file kept its name and its schema, and the figure underneath it changed
// from a semantic one to a lexical one. `space.semantic` is what makes that visible, and this is the rule that stops it.
describe('a figure that recorded a semantic half', () => {
  let cwd: string;
  let original: string;

  beforeEach(() => {
    original = process.cwd();
    cwd = mkdtempSync(join(tmpdir(), 'artifact-space-'));
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(original);
    rmSync(cwd, { recursive: true, force: true });
  });

  const publish = (value: unknown): { written: boolean; because: string } => {
    const record = recordArtifact('benchmarks/retrieval.json', value, {
      [ARTIFACT_WRITE_ENV]: '1',
    });
    return { written: record.written, because: record.because };
  };
  const onDisk = (): unknown =>
    JSON.parse(readFileSync(join(cwd, 'benchmarks/retrieval.json'), 'utf8'));

  it('may not be overwritten by a run whose semantic half did not run', () => {
    expect(
      publish({ space: { index: 'api', query: 'api', semantic: true }, mrr: 0.25 }).written,
    ).toBe(true);
    const refused = publish({
      space: { index: 'deterministic', query: 'none', semantic: false },
      mrr: 0.1,
    });
    expect(refused.written).toBe(false);
    // **The reason names the file and the way out**, because the person reading it set the variable themselves.
    expect(refused.because).toContain('benchmarks/retrieval.json');
    expect(refused.because).toContain('semantic half');
    expect(refused.because).toContain('delete the file');
    expect(onDisk()).toMatchObject({ space: { semantic: true }, mrr: 0.25 });
  });

  it('may be replaced by another run that ran it, which is the whole point of the artifact', () => {
    publish({ space: { semantic: true }, mrr: 0.25 });
    expect(publish({ space: { semantic: true }, mrr: 0.31 }).written).toBe(true);
    expect(onDisk()).toMatchObject({ mrr: 0.31 });
  });

  it('is replaced by a fallback figure only when it is deleted first, which is a statement', () => {
    publish({ space: { semantic: true } });
    rmSync(join(cwd, 'benchmarks/retrieval.json'));
    expect(publish({ space: { semantic: false } }).written).toBe(true);
    expect(onDisk()).toMatchObject({ space: { semantic: false } });
  });

  it('does not block an artifact that makes no space claim at all', () => {
    publish({ space: { semantic: true } });
    // A schema change is not a downgrade: the incoming body says nothing about a measurement space.
    expect(publish({ columns: ['a'] }).written).toBe(true);
    expect(onDisk()).toEqual({ columns: ['a'] });
  });

  it('reads a body whose space is malformed as making no claim', () => {
    publish({ space: { semantic: true } });
    for (const body of [
      { space: null },
      { space: 'api' },
      { space: { semantic: 'yes' } },
      { space: {} },
      'not an object',
      // **`null` is the one value `typeof` reads as an object**, so it is the case a shape check forgets.
      null,
    ]) {
      expect(publish(body).written).toBe(true);
    }
  });

  it('unblocks when the figure on disk is not readable JSON, since nothing is being replaced', () => {
    publish({ space: { semantic: true } });
    writeFileSync(join(cwd, 'benchmarks/retrieval.json'), '{ truncated', 'utf8');
    expect(publish({ space: { semantic: false } }).written).toBe(true);
  });
});
