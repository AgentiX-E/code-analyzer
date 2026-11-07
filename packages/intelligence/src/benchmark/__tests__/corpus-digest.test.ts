// The corpus digest — a version number for a directory that nobody had to remember to bump.
//
// These cases are the properties a digest has to have before a benchmark may quote it: the same bytes give the same
// answer twice, a single changed byte gives a different one, and the file's **name** is part of what is hashed — a
// digest that ignored names would call two different corpora identical after a rename, which is precisely the
// mistake a path-based provenance check is meant to catch.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { corpusDigest } from '../corpus-digest.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'corpus-digest-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (relative: string, body: string): void => {
  const absolute = join(root, relative);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, body, 'utf-8');
};

describe('corpusDigest', () => {
  it('returns the same digest for the same bytes', () => {
    write('a.ts', 'export const a = 1;\n');
    const first = corpusDigest(root);
    const second = corpusDigest(root);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when one byte changes', () => {
    write('a.ts', 'export const a = 1;\n');
    const before = corpusDigest(root);
    write('a.ts', 'export const a = 2;\n');

    expect(corpusDigest(root)).not.toBe(before);
  });

  it('changes when a file is renamed and nothing else is', () => {
    write('a.ts', 'export const a = 1;\n');
    const before = corpusDigest(root);
    rmSync(join(root, 'a.ts'));
    write('b.ts', 'export const a = 1;\n');

    expect(corpusDigest(root)).not.toBe(before);
  });

  it('walks subdirectories, so a nested change is a change', () => {
    write('nested/deep/a.ts', 'export const a = 1;\n');
    const before = corpusDigest(root);
    write('nested/deep/a.ts', 'export const a = 2;\n');

    expect(corpusDigest(root)).not.toBe(before);
  });

  it('is order-independent on disk, because it sorts by path', () => {
    write('b.ts', 'b\n');
    write('a.ts', 'a\n');
    const first = corpusDigest(root);

    rmSync(join(root, 'a.ts'));
    rmSync(join(root, 'b.ts'));
    write('a.ts', 'a\n');
    write('b.ts', 'b\n');

    expect(corpusDigest(root)).toBe(first);
  });

  it('gives the empty directory the digest of no entries at all', () => {
    // sha256 of the empty input: an empty corpus is a corpus, and saying so is cheaper than a special case.
    expect(corpusDigest(root)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
