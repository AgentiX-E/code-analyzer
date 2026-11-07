// Corpus-provenance gate — the test that proves a figure can be caught lying about its corpus.
//
// `benchmarks/docstring-search.json` named `benchmarks/retrieval-corpus` and reported 5 735 nodes. That directory
// measured 3 257 nodes on the same 52 files, in CI and locally alike. Nothing compared them: a path is not a
// version, and the artifact never claimed to name one. These cases pin the three states a corpus can be in and
// assert that the gate separates them — and that it fails, rather than shrugs, when an artifact says nothing.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { corpusDigest } from '../../../packages/intelligence/src/benchmark/corpus-digest.js';

const GATE = 'scripts/corpus-provenance-gate.js';

interface SpawnFailure {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
}

interface Fixture {
  /** Files of the corpus, relative to its directory. */
  corpus?: Record<string, string>;
  /** Artifact name -> its JSON object. */
  artifacts: Record<string, unknown>;
}

function build(fixture: Fixture): string {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-provenance-'));
  mkdirSync(join(dir, 'benchmarks', 'corpus'), { recursive: true });
  for (const [name, body] of Object.entries(fixture.corpus ?? {})) {
    writeFileSync(join(dir, 'benchmarks', 'corpus', name), body, 'utf-8');
  }
  for (const [name, body] of Object.entries(fixture.artifacts)) {
    writeFileSync(join(dir, 'benchmarks', name), JSON.stringify(body, null, 2), 'utf-8');
  }
  return dir;
}

function runGate(fixture: Fixture): { ok: boolean; stdout: string; stderr: string } {
  const dir = build(fixture);
  try {
    return {
      ok: true,
      stdout: execFileSync(process.execPath, [GATE, '--repo', dir], { encoding: 'utf-8' }),
      stderr: '',
    };
  } catch (err) {
    const failure = err as SpawnFailure;
    return {
      ok: false,
      stdout: (failure.stdout ?? '').toString(),
      stderr: (failure.stderr ?? '').toString(),
    };
  }
}

const CORPUS = 'benchmarks/corpus';
const corpus = { 'a.ts': 'export const a = 1;\n', 'b.ts': 'export const b = 2;\n' };
const digestOf = (fixture: Fixture): string => {
  const dir = build(fixture);
  return corpusDigest(join(dir, CORPUS));
};

describe('corpus-provenance-gate', () => {
  it('agrees with the TypeScript digest, which is the only reason two implementations are allowed', () => {
    const dir = build({ corpus, artifacts: {} });
    writeFileSync(
      join(dir, 'benchmarks', 'figure.json'),
      JSON.stringify({
        corpus: { path: CORPUS, snapshot: 'pinned', digest: corpusDigest(join(dir, CORPUS)) },
      }),
      'utf-8',
    );
    const output = execFileSync(process.execPath, [GATE, '--repo', dir, '--json'], {
      encoding: 'utf-8',
    });
    const parsed = JSON.parse(output) as { corpora: Record<string, { digest: string }> };

    expect(parsed.corpora[CORPUS].digest).toBe(corpusDigest(join(dir, CORPUS)));
  });

  it('passes a pinned artifact whose digest matches', () => {
    const fixture = {
      corpus,
      artifacts: {
        'figure.json': {
          corpus: { path: CORPUS, snapshot: 'pinned', digest: digestOf({ corpus, artifacts: {} }) },
        },
      },
    };

    const result = runGate(fixture);

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('1 pinned');
  });

  it('fails a pinned artifact whose digest does not match, and says both', () => {
    const result = runGate({
      corpus,
      artifacts: {
        'figure.json': { corpus: { path: CORPUS, snapshot: 'pinned', digest: 'a'.repeat(64) } },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('figure.json');
    expect(result.stderr).toContain('a'.repeat(64));
  });

  it('fails a pinned artifact with no digest at all', () => {
    const result = runGate({
      corpus,
      artifacts: { 'figure.json': { corpus: { path: CORPUS, snapshot: 'pinned' } } },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('digest');
  });

  it('passes a live artifact, which measures this repository and moves with it', () => {
    const result = runGate({
      corpus: { ...corpus, 'x.ts': 'export const x = 1;\n' },
      artifacts: { 'speed.json': { corpus: { path: CORPUS, snapshot: 'live' } } },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('1 live');
  });

  it('passes a superseded artifact and prints why it is not comparable', () => {
    const result = runGate({
      corpus,
      artifacts: {
        'old.json': {
          corpus: {
            path: CORPUS,
            snapshot: 'superseded',
            supersededReason: 'measured before the corpus shrank',
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('measured before the corpus shrank');
  });

  it('fails a superseded artifact that does not say why', () => {
    const result = runGate({
      corpus,
      artifacts: { 'old.json': { corpus: { path: CORPUS, snapshot: 'superseded' } } },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('supersededReason');
  });

  it('fails an artifact that names a corpus and not a snapshot state', () => {
    const result = runGate({
      corpus,
      artifacts: { 'figure.json': { corpus: { path: CORPUS } } },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('snapshot');
    expect(result.stderr).toContain('pinned');
    expect(result.stderr).toContain('live');
  });

  it('ignores an artifact with no corpus at all', () => {
    const result = runGate({ corpus, artifacts: { 'other.json': { total: 1 } } });

    expect(result.ok).toBe(true);
  });

  it('ignores an artifact whose corpus path no longer exists, and says which', () => {
    const result = runGate({
      corpus,
      artifacts: { 'gone.json': { corpus: { path: 'benchmarks/last-year', snapshot: 'live' } } },
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('benchmarks/last-year');
  });
});
