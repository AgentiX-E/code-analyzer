/**
 * Tests for the `locate` command.
 *
 * **The command exists for the checkout the rest of the CLI cannot enter**, so its tests are built on a real directory
 * tree rather than on a store: a ranking produced from a graph would prove nothing about the case where there is no
 * graph. The formatter is tested separately, because a figure a reader cannot see is a figure that does not exist.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RRF_K } from '@code-analyzer/intelligence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatLocateOutput, locateRepository, readDeclarations } from '../commands/locate.js';

describe('locateRepository', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'locate-cli-'));
    mkdirSync(join(root, 'src', 'main', 'kotlin'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'main', 'kotlin', 'RetryInterceptor.kt'),
      'package a\nimport okhttp3.Interceptor\n',
    );
    writeFileSync(join(root, 'src', 'main', 'kotlin', 'Cache.kt'), 'package a\nclass Cache\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('ranks the file the question names, and reports the universe beside it', () => {
    const output = locateRepository({ question: 'retry interceptor timeout', directory: root });
    expect(output.success).toBe(true);
    expect(output.files[0]).toBe('src/main/kotlin/RetryInterceptor.kt');
    expect(output.answerSpace).toBe(2);
    expect(output.truncated).toBe(false);
    expect(output.importLines).toBe(1);
  });

  it('honours the limit rather than printing the whole checkout', () => {
    const output = locateRepository({ question: 'kt', directory: root, limit: 1 });
    expect(output.files).toHaveLength(1);
  });

  it('restricts to the extensions the reader named', () => {
    writeFileSync(join(root, 'notes.md'), 'retry interceptor');
    // **The universe, not the ranking, is what an extension filter promises.** The ranking changed in iteration 81 -
    // a markdown file now matches a question written in its own words, because the body arm reads it and the
    // path-and-imports arm never could - so the assertion is that the two Kotlin files left the answer space rather
    // than that nothing matched. **An assertion on the old emptiness would now be an assertion that the product cannot
    // read prose, which is the defect the third arm was added to remove.**
    const markdownOnly = locateRepository({
      question: 'retry interceptor',
      directory: root,
      extensions: ['.md'],
    });
    expect(markdownOnly.answerSpace).toBe(1);
    expect(markdownOnly.files).toEqual(['notes.md']);
    // And with the Kotlin extension the markdown file is out of the universe instead.
    const kotlinOnly = locateRepository({
      question: 'retry interceptor',
      directory: root,
      extensions: ['.kt'],
    });
    expect(kotlinOnly.answerSpace).toBe(2);
    expect(kotlinOnly.files).not.toContain('notes.md');
  });

  it('**reports a failure instead of throwing**, because a CLI that crashes has told the reader nothing', () => {
    const output = locateRepository({ question: 'anything', directory: join(root, 'absent') });
    expect(output.success).toBe(false);
    expect(output.error).toBeDefined();
    expect(output.files).toEqual([]);
  });

  it('survives a caller that throws something that is not an Error', () => {
    // **A `catch` has to render whatever arrived at it.** A thrown string is legal JavaScript and a library boundary is
    // exactly where it turns up; a handler that assumed `Error` would replace the message with `undefined` and the
    // command would exit with a failure nobody can act on. The getter is the fixture: reading `limit` throws.
    const output = locateRepository({
      question: 'anything',
      directory: root,
      get limit(): number {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the fixture *is* the non-Error throw.
        throw 'a plain string, not an Error';
      },
    });
    expect(output.success).toBe(false);
    expect(output.error).toBe('a plain string, not an Error');
  });
});

describe('formatLocateOutput', () => {
  it('prints the answer space before the ranking, so a short list cannot be mistaken for a large one', () => {
    const output = locateRepository({ question: 'cache', directory: process.cwd() });
    const text = formatLocateOutput(output, 'text');
    expect(text).toContain('Answer space:');
    expect(text).toContain('1.');
  });

  it('says a truncated walk is a lower bound', () => {
    const text = formatLocateOutput(
      {
        success: true,
        question: 'q',
        directory: '/tmp',
        files: ['a.java'],
        answerSpace: 2,
        truncated: true,
        importLines: 0,
        bodyRanked: [],
        fused: false,
        k: null,
        unreadableFiles: 0,
        durationMs: 1,
      },
      'text',
    );
    expect(text).toContain('lower bound');
  });

  it('says plainly that nothing matched', () => {
    const text = formatLocateOutput(
      {
        success: true,
        question: 'q',
        directory: '/tmp',
        files: [],
        answerSpace: 3,
        truncated: false,
        importLines: 0,
        bodyRanked: [],
        fused: false,
        k: null,
        unreadableFiles: 0,
        durationMs: 1,
      },
      'text',
    );
    expect(text).toContain('No file matched');
  });

  it('renders the failure, and only the failure', () => {
    const text = formatLocateOutput(
      {
        success: false,
        question: 'q',
        directory: '/tmp',
        files: [],
        answerSpace: 0,
        truncated: false,
        importLines: 0,
        bodyRanked: [],
        fused: false,
        k: null,
        unreadableFiles: 0,
        durationMs: 1,
        error: 'ENOENT',
      },
      'text',
    );
    expect(text).toContain('Locate failed: ENOENT');
  });

  it('renders a failure that carries no message as a failure, rather than as `undefined`', () => {
    // The field is optional, so this is a legal value and not a malformed one.
    const text = formatLocateOutput(
      {
        success: false,
        question: 'q',
        directory: '/tmp',
        files: [],
        answerSpace: 0,
        truncated: false,
        importLines: 0,
        bodyRanked: [],
        fused: false,
        k: null,
        unreadableFiles: 0,
        durationMs: 1,
      },
      'text',
    );
    expect(text).toContain('Locate failed: unknown error');
  });

  it('emits JSON that a program can read', () => {
    const output = locateRepository({ question: 'cache', directory: process.cwd() });
    const parsed: unknown = JSON.parse(formatLocateOutput(output, 'json'));
    expect(parsed).toMatchObject({ success: true, question: 'cache' });
  });
});

// ---------------------------------------------------------------------------
// The arm the caller already holds
// ---------------------------------------------------------------------------

describe('readDeclarations', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'locate-decl-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('**reads a JSON array**, which is what a program writes', () => {
    const file = join(root, 'arms.json');
    writeFileSync(file, '["a/A.java", "b/B.java"]\n');
    expect(readDeclarations(file)).toEqual(['a/A.java', 'b/B.java']);
  });

  it('**reads one path per line**, which is what a shell pipeline writes', () => {
    const file = join(root, 'arms.txt');
    writeFileSync(file, '# the pool, best first\na/A.java\n\n  b/B.java  \n');
    expect(readDeclarations(file)).toEqual(['a/A.java', 'b/B.java']);
  });

  it('**an empty file is an empty arm, not an error**', () => {
    const file = join(root, 'empty.txt');
    writeFileSync(file, '   \n\n');
    expect(readDeclarations(file)).toEqual([]);
  });

  it('**a JSON array of something else is refused by name**, because it would fuse paths that do not exist', () => {
    const file = join(root, 'numbers.json');
    writeFileSync(file, '[1, 2, 3]');
    expect(() => readDeclarations(file)).toThrow(/not an array of strings/u);
  });
});

describe('locateRepository with a declaration arm', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'locate-fuse-cli-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'Retry.java'), 'import a.core.Clock;\nclass Retry {}\n');
    writeFileSync(join(root, 'src', 'Cache.java'), 'class Cache {}\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('**fuses the two arms, reports the file-level one, and says the order is fused**', () => {
    const output = locateRepository({
      question: 'retry clock',
      directory: root,
      declarations: ['src/Cache.java'],
    });
    expect(output.fused).toBe(true);
    expect(output.k).toBe(RRF_K);
    expect(output.fileLevel?.[0]).toBe('src/Retry.java');
    expect(output.files).toContain('src/Cache.java');
    // **The constant is printed from the value, not typed into the sentence**: a header that says 60 while the ranking
    // used another constant is a report about a different run.
    expect(formatLocateOutput(output, 'text')).toContain(
      `fused with the declaration arm (k = ${String(RRF_K)})`,
    );
  });

  it('**reads the arm from a file as well as from a value**', () => {
    const file = mkdtempSync(join(tmpdir(), 'locate-arms-'));
    const armFile = join(file, 'arm.txt');
    writeFileSync(armFile, 'src/Cache.java\n');
    const output = locateRepository({
      question: 'retry clock',
      directory: root,
      declarationsFile: armFile,
    });
    expect(output.fused).toBe(true);
    expect(output.files).toContain('src/Cache.java');
    rmSync(file, { recursive: true, force: true });
  });

  it('**an explicitly passed list wins over the file**, because a caller that passed both has one list', () => {
    const armFile = join(root, 'arm.txt');
    writeFileSync(armFile, 'src/Cache.java\n');
    const output = locateRepository({
      question: 'retry clock',
      directory: root,
      declarations: ['src/Nowhere.java'],
      declarationsFile: armFile,
    });
    expect(output.files).toContain('src/Nowhere.java');
    expect(output.files).not.toContain('src/Cache.java');
  });

  it('**a file that cannot be read is a stated failure**, not a ranking with a silent empty arm', () => {
    const output = locateRepository({
      question: 'retry',
      directory: root,
      declarationsFile: join(root, 'does-not-exist.txt'),
    });
    expect(output.success).toBe(false);
    expect(output.error).toContain('does-not-exist.txt');
    expect(output.fused).toBe(false);
    expect(output.k).toBeNull();
  });

  it('**no arm means no fusion claim at all** in the text output', () => {
    const output = locateRepository({ question: 'retry', directory: root });
    expect(output.fused).toBe(false);
    expect(output.fileLevel).toBeUndefined();
    expect(formatLocateOutput(output, 'text')).not.toContain('fused with');
  });
});
