// @code-analyzer/analyzer — Tests for Pipeline Phase Helpers
// Covers every exported helper in phase-helpers.ts: gitignore parsing/matching,
// file/directory skipping, hashing, directory walking, capture-to-symbol
// conversion, provider loading, simple hashing, and import-path resolution.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { UnifiedCapture, DiscoveredFile } from '@code-analyzer/shared';

import {
  SKIP_DIRECTORIES,
  SKIP_FILE_PATTERNS,
  parseGitignore,
  matchesGitignore,
  shouldSkipFile,
  shouldSkipDirectory,
  computeHash,
  walkDirectory,
  captureTagToNodeLabel,
  captureTagToReferenceKind,
  groupCaptures,
  getOrLoadProvider,
  providerLoaders,
  simpleHash,
  resolveImportPath,
} from '../pipeline/phase-helpers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'ca-phase-helpers-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeCapture(
  tag: UnifiedCapture['tag'],
  overrides: Partial<UnifiedCapture> = {},
): UnifiedCapture {
  return {
    tag,
    text: 'sample',
    startLine: 1,
    endLine: 1,
    startByte: 0,
    endByte: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Skip constants
// ---------------------------------------------------------------------------

describe('SKIP_DIRECTORIES', () => {
  it('contains every build/vcs/coverage directory', () => {
    for (const dir of [
      'node_modules',
      '.git',
      'dist',
      'build',
      '__pycache__',
      '.next',
      'target',
      '.cache',
      '.idea',
      '.vscode',
      'coverage',
      '.nyc_output',
    ]) {
      expect(SKIP_DIRECTORIES.has(dir)).toBe(true);
    }
  });

  it('does not contain ordinary source directories', () => {
    expect(SKIP_DIRECTORIES.has('src')).toBe(false);
    expect(SKIP_DIRECTORIES.has('lib')).toBe(false);
  });
});

describe('SKIP_FILE_PATTERNS', () => {
  it('skips dotfiles, minified bundles, and declaration files', () => {
    expect(SKIP_FILE_PATTERNS.some((p) => p.test('.env'))).toBe(true);
    expect(SKIP_FILE_PATTERNS.some((p) => p.test('lib.min.js'))).toBe(true);
    expect(SKIP_FILE_PATTERNS.some((p) => p.test('lib.min.css'))).toBe(true);
    expect(SKIP_FILE_PATTERNS.some((p) => p.test('types.d.ts'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseGitignore
// ---------------------------------------------------------------------------

describe('parseGitignore', () => {
  it('returns an empty list when no .gitignore exists', async () => {
    await withTempDir((dir) => {
      expect(parseGitignore(dir)).toEqual([]);
    });
  });

  it('strips comments and blank lines and trims whitespace', async () => {
    await withTempDir((dir) => {
      writeFileSync(join(dir, '.gitignore'), '# comment\nnode_modules/\n\n  dist  \n*.log\n');
      expect(parseGitignore(dir)).toEqual(['node_modules/', 'dist', '*.log']);
    });
  });
});

// ---------------------------------------------------------------------------
// matchesGitignore
// ---------------------------------------------------------------------------

describe('matchesGitignore', () => {
  it('matches a directory pattern against itself and its children', () => {
    expect(matchesGitignore('build', ['build/'])).toBe(true);
    expect(matchesGitignore('build/out.js', ['build/'])).toBe(true);
    expect(matchesGitignore('other/out.js', ['build/'])).toBe(false);
  });

  it('matches a glob pattern against path and basename', () => {
    expect(matchesGitignore('src/a.log', ['*.log'])).toBe(true);
    expect(matchesGitignore('a.log', ['*.log'])).toBe(true);
    expect(matchesGitignore('src/a.txt', ['*.log'])).toBe(false);
  });

  it('matches an exact pattern against path or basename', () => {
    expect(matchesGitignore('secret.ts', ['secret.ts'])).toBe(true);
    expect(matchesGitignore('src/secret.ts', ['secret.ts'])).toBe(true);
    expect(matchesGitignore('src/other.ts', ['secret.ts'])).toBe(false);
  });

  it('returns false for an empty pattern list', () => {
    expect(matchesGitignore('anything.ts', [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldSkipFile / shouldSkipDirectory
// ---------------------------------------------------------------------------

describe('shouldSkipFile', () => {
  it('skips dotfiles, minified bundles, and declaration files', () => {
    expect(shouldSkipFile('/a/.env', '.env')).toBe(true);
    expect(shouldSkipFile('/a/x.min.js', 'x.min.js')).toBe(true);
    expect(shouldSkipFile('/a/x.d.ts', 'x.d.ts')).toBe(true);
  });

  it('keeps ordinary source files', () => {
    expect(shouldSkipFile('/a/app.ts', 'app.ts')).toBe(false);
    expect(shouldSkipFile('/a/util.js', 'util.js')).toBe(false);
  });
});

describe('shouldSkipDirectory', () => {
  it('skips known generated directories', () => {
    expect(shouldSkipDirectory('node_modules')).toBe(true);
    expect(shouldSkipDirectory('.git')).toBe(true);
  });

  it('keeps ordinary directories', () => {
    expect(shouldSkipDirectory('src')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeHash
// ---------------------------------------------------------------------------

describe('computeHash', () => {
  it('returns the SHA-256 hex digest', () => {
    // Known SHA-256 vector for "abc".
    expect(computeHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic and differs across inputs', () => {
    expect(computeHash('a')).toBe(computeHash('a'));
    expect(computeHash('a')).not.toBe(computeHash('b'));
  });
});

// ---------------------------------------------------------------------------
// walkDirectory
// ---------------------------------------------------------------------------

describe('walkDirectory', () => {
  it('discovers files recursively with language detection and hashing', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, 'src'));
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'src', 'app.ts'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'sub', 'nested.py'), 'def f():\n  pass\n');
      writeFileSync(join(dir, 'note.txt'), 'plain text\n');

      const results: DiscoveredFile[] = [];
      await walkDirectory(dir, dir, results, [], 1024 * 1024, 1000);
      const names = results.map((f) => f.filePath.split('/').slice(-2).join('/')).sort();
      expect(names).toEqual(['src/app.ts', 'sub/nested.py']);
      expect(results.every((f) => f.hash === computeHash(f.content))).toBe(true);
    });
  });

  it('skips generated directories (node_modules)', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, 'node_modules'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'pkg.ts'), 'export {};\n');
      writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');

      const results: DiscoveredFile[] = [];
      await walkDirectory(dir, dir, results, [], 1024 * 1024, 1000);
      expect(results.map((f) => f.filePath.split('/').pop())).toEqual(['app.ts']);
    });
  });

  it('honors gitignore directory and file patterns', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, 'ignored-dir'));
      writeFileSync(join(dir, '.gitignore'), 'ignored-dir/\nignored.ts\n');
      writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'ignored.ts'), 'export const b = 2;\n');
      writeFileSync(join(dir, 'ignored-dir', 'deep.ts'), 'export const c = 3;\n');

      const results: DiscoveredFile[] = [];
      const patterns = parseGitignore(dir);
      await walkDirectory(dir, dir, results, patterns, 1024 * 1024, 1000);
      expect(results.map((f) => f.filePath.split('/').pop())).toEqual(['app.ts']);
    });
  });

  it('skips dotfiles, minified bundles, and declaration files', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, '.secret.ts'), 'export {};\n');
      writeFileSync(join(dir, 'lib.min.js'), 'minified\n');
      writeFileSync(join(dir, 'types.d.ts'), 'declare const x: number;\n');
      writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');

      const results: DiscoveredFile[] = [];
      await walkDirectory(dir, dir, results, [], 1024 * 1024, 1000);
      expect(results.map((f) => f.filePath.split('/').pop())).toEqual(['app.ts']);
    });
  });

  it('skips files with an unrecognized extension', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'data.bin'), 'binary-looking\n');
      writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');

      const results: DiscoveredFile[] = [];
      await walkDirectory(dir, dir, results, [], 1024 * 1024, 1000);
      expect(results.map((f) => f.filePath.split('/').pop())).toEqual(['app.ts']);
    });
  });

  it('respects the maxFileSize limit', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'small.ts'), 'x\n');
      writeFileSync(join(dir, 'big.ts'), 'export const veryLong = "0123456789".repeat(10);\n');

      const results: DiscoveredFile[] = [];
      // small.ts is 2 bytes; big.ts is much larger.
      await walkDirectory(dir, dir, results, [], 10, 1000);
      expect(results.map((f) => f.filePath.split('/').pop())).toEqual(['small.ts']);
    });
  });

  it('respects the maxFiles limit', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'a.ts'), 'export {};\n');
      writeFileSync(join(dir, 'b.ts'), 'export {};\n');
      writeFileSync(join(dir, 'c.ts'), 'export {};\n');

      const results: DiscoveredFile[] = [];
      await walkDirectory(dir, dir, results, [], 1024 * 1024, 1);
      expect(results.length).toBe(1);
    });
  });

  it('skips files that cannot be read', async () => {
    await withTempDir(async (dir) => {
      const unreadable = join(dir, 'locked.ts');
      writeFileSync(unreadable, 'export const secret = 1;\n');
      chmodSync(unreadable, 0o000);
      writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');

      const results: DiscoveredFile[] = [];
      await walkDirectory(dir, dir, results, [], 1024 * 1024, 1000);
      // The unreadable file is skipped by the catch; the readable one remains.
      expect(results.map((f) => f.filePath.split('/').pop())).toEqual(['app.ts']);
      chmodSync(unreadable, 0o644); // restore before cleanup
    });
  });

  it('returns immediately when the result set is already full', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');

      const preloaded: DiscoveredFile = {
        filePath: join(dir, 'preloaded.ts'),
        language: 'typescript',
        content: 'export {};\n',
        hash: 'x',
        size: 1,
      };
      const results: DiscoveredFile[] = [preloaded];
      await walkDirectory(dir, dir, results, [], 1024 * 1024, 1);
      // The top-level maxFiles guard returns before scanning anything.
      expect(results).toEqual([preloaded]);
    });
  });

  it('skips symlinks (entries that are neither files nor directories)', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');
      symlinkSync(join(dir, 'app.ts'), join(dir, 'link.ts'));

      const results: DiscoveredFile[] = [];
      await walkDirectory(dir, dir, results, [], 1024 * 1024, 1000);
      expect(results.map((f) => f.filePath.split('/').pop())).toEqual(['app.ts']);
    });
  });
});

// ---------------------------------------------------------------------------
// captureTagToNodeLabel
// ---------------------------------------------------------------------------

describe('captureTagToNodeLabel', () => {
  const cases: Array<[string, string]> = [
    [CAPTURE_TAGS.FUNCTION_DEF, 'Function'],
    [CAPTURE_TAGS.FUNCTION_CALL, 'Function'],
    [CAPTURE_TAGS.METHOD_DEF, 'Method'],
    [CAPTURE_TAGS.METHOD_CALL, 'Method'],
    [CAPTURE_TAGS.CLASS_DEF, 'Class'],
    [CAPTURE_TAGS.INTERFACE_DEF, 'Interface'],
    [CAPTURE_TAGS.ENUM_DEF, 'Enum'],
    [CAPTURE_TAGS.TYPE_DEF, 'TypeAlias'],
    [CAPTURE_TAGS.VARIABLE_DEF, 'Variable'],
    [CAPTURE_TAGS.VARIABLE_ACCESS, 'Variable'],
    [CAPTURE_TAGS.CONSTANT_DEF, 'Variable'],
    [CAPTURE_TAGS.CONSTRUCTOR_DEF, 'Constructor'],
    [CAPTURE_TAGS.PROPERTY_DEF, 'Property'],
    [CAPTURE_TAGS.STRUCT_DEF, 'Struct'],
    [CAPTURE_TAGS.TRAIT_DEF, 'Trait'],
    [CAPTURE_TAGS.ROUTE_PATH, 'Route'],
    [CAPTURE_TAGS.ROUTE_METHOD, 'Route'],
    [CAPTURE_TAGS.COMPONENT_PROPS, 'Component'],
  ];

  it.each(cases)('maps %s to %s', (tag, label) => {
    expect(captureTagToNodeLabel(tag)).toBe(label);
  });

  it('falls back to Variable for an unmapped tag', () => {
    expect(captureTagToNodeLabel(CAPTURE_TAGS.DECORATOR)).toBe('Variable');
    expect(captureTagToNodeLabel('unknown.tag')).toBe('Variable');
  });
});

// ---------------------------------------------------------------------------
// captureTagToReferenceKind
// ---------------------------------------------------------------------------

describe('captureTagToReferenceKind', () => {
  const cases: Array<[string, string]> = [
    [CAPTURE_TAGS.FUNCTION_CALL, 'call'],
    [CAPTURE_TAGS.METHOD_CALL, 'call'],
    [CAPTURE_TAGS.IMPORT, 'import'],
    [CAPTURE_TAGS.IMPORT_NAMED, 'import'],
    [CAPTURE_TAGS.IMPORT_DEFAULT, 'import'],
    [CAPTURE_TAGS.IMPORT_WILDCARD, 'import'],
    [CAPTURE_TAGS.TYPE_REFERENCE, 'type'],
    [CAPTURE_TAGS.VARIABLE_ACCESS, 'access'],
  ];

  it.each(cases)('maps %s to %s', (tag, kind) => {
    expect(captureTagToReferenceKind(tag)).toBe(kind);
  });

  it('falls back to call for an unmapped tag', () => {
    expect(captureTagToReferenceKind(CAPTURE_TAGS.NEW_EXPRESSION)).toBe('call');
    expect(captureTagToReferenceKind('unknown.tag')).toBe('call');
  });
});

// ---------------------------------------------------------------------------
// groupCaptures
// ---------------------------------------------------------------------------

describe('groupCaptures', () => {
  it('returns empty collections for no captures', () => {
    const { symbols, references, scopeTree } = groupCaptures([], '/app/src/a.ts');
    expect(symbols).toEqual([]);
    expect(references).toEqual([]);
    expect(scopeTree.name).toBe('a.ts');
    expect(scopeTree.kind).toBe('File');
    expect(scopeTree.endLine).toBe(1);
  });

  it('converts a definition capture into a symbol', () => {
    const { symbols, references } = groupCaptures(
      [
        makeCapture(CAPTURE_TAGS.FUNCTION_DEF, {
          name: 'doWork',
          startLine: 10,
          endLine: 30,
          properties: { signature: 'doWork(x)', returnType: 'Result', docstring: 'Docs' },
        }),
      ],
      '/app/src/a.ts',
    );
    expect(references).toEqual([]);
    expect(symbols).toHaveLength(1);
    const s = symbols[0]!;
    expect(s.name).toBe('doWork');
    expect(s.kind).toBe('Function');
    expect(s.qualifiedName).toBe('file:/app/src/a.ts:doWork');
    expect(s.signature).toBe('doWork(x)');
    expect(s.returnType).toBe('Result');
    expect(s.docstring).toBe('Docs');
    expect(s.properties).toEqual({
      signature: 'doWork(x)',
      returnType: 'Result',
      docstring: 'Docs',
    });
  });

  it('falls back to capture.text when name is absent', () => {
    const { symbols } = groupCaptures(
      [makeCapture(CAPTURE_TAGS.CLASS_DEF, { text: 'MyClass', endLine: 5 })],
      '/app/src/a.ts',
    );
    expect(symbols[0]!.name).toBe('MyClass');
    expect(symbols[0]!.qualifiedName).toBe('file:/app/src/a.ts:MyClass');
  });

  it('prefixes the qualified name with containerName', () => {
    const { symbols } = groupCaptures(
      [makeCapture(CAPTURE_TAGS.METHOD_DEF, { name: 'run', containerName: 'MyClass', endLine: 3 })],
      '/app/src/a.ts',
    );
    expect(symbols[0]!.qualifiedName).toBe('MyClass.run');
    expect(symbols[0]!.containerName).toBe('MyClass');
  });

  it('converts reference captures into reference sites', () => {
    const { symbols, references } = groupCaptures(
      [
        makeCapture(CAPTURE_TAGS.FUNCTION_CALL, { name: 'target', startLine: 7 }),
        makeCapture(CAPTURE_TAGS.TYPE_REFERENCE, { text: 'Foo' }),
      ],
      '/app/src/a.ts',
    );
    expect(symbols).toEqual([]);
    expect(references).toHaveLength(2);
    expect(references[0]).toEqual({
      sourceFile: '/app/src/a.ts',
      sourceLine: 7,
      sourceColumn: 0,
      targetName: 'target',
      referenceKind: 'call',
    });
    expect(references[1]!.targetName).toBe('Foo');
    expect(references[1]!.referenceKind).toBe('type');
  });

  it('ignores captures that are neither definitions nor references', () => {
    const { symbols, references } = groupCaptures(
      [makeCapture(CAPTURE_TAGS.DECORATOR, { name: 'inject' })],
      '/app/src/a.ts',
    );
    expect(symbols).toEqual([]);
    expect(references).toEqual([]);
  });

  it('builds a scope tree reflecting discovered symbols', () => {
    const { scopeTree } = groupCaptures(
      [makeCapture(CAPTURE_TAGS.FUNCTION_DEF, { name: 'doWork', endLine: 30 })],
      '/app/src/a.ts',
    );
    expect(scopeTree.endLine).toBe(30);
    expect(scopeTree.children).toHaveLength(1);
    expect(scopeTree.symbols).toEqual(['file:/app/src/a.ts:doWork']);
  });
});

// ---------------------------------------------------------------------------
// providerLoaders / getOrLoadProvider
// ---------------------------------------------------------------------------

describe('getOrLoadProvider', () => {
  it('registers a loader for every supported language', () => {
    const languages = [
      'typescript',
      'javascript',
      'python',
      'go',
      'java',
      'kotlin',
      'csharp',
      'rust',
      'c',
      'cpp',
      'php',
      'ruby',
      'swift',
      'dart',
      'lua',
      'scala',
      'zig',
      'elixir',
      'hcl',
      'dockerfile',
      'yaml',
      'json',
      'sql',
      'bash',
      'toml',
      'markdown',
      'html',
      'css',
      'r',
      'groovy',
      'svelte',
    ];
    expect(Object.keys(providerLoaders).sort()).toEqual([...languages].sort());
  });

  it('loads a provider for every supported language', async () => {
    const languages = Object.keys(providerLoaders);
    for (const language of languages) {
      const provider = await getOrLoadProvider(language);
      expect(provider, `provider for ${language}`).not.toBeNull();
      expect(typeof provider!.parse).toBe('function');
    }
  }, 120_000);

  it('returns the same cached instance on a second load', async () => {
    const first = await getOrLoadProvider('typescript');
    const second = await getOrLoadProvider('typescript');
    expect(second).toBe(first);
  });

  it('returns null for an unknown language', async () => {
    expect(await getOrLoadProvider('nosuch-language')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// simpleHash
// ---------------------------------------------------------------------------

describe('simpleHash', () => {
  it('is deterministic and non-negative', () => {
    expect(simpleHash('abc', 0)).toBe(simpleHash('abc', 0));
    expect(simpleHash('abc', 0)).toBeGreaterThanOrEqual(0);
  });

  it('is sensitive to the seed', () => {
    expect(simpleHash('abc', 0)).not.toBe(simpleHash('abc', 5381));
  });
});

// ---------------------------------------------------------------------------
// resolveImportPath
// ---------------------------------------------------------------------------

describe('resolveImportPath', () => {
  it('resolves a relative import to an existing file', async () => {
    await withTempDir((dir) => {
      mkdirSync(join(dir, 'src'));
      writeFileSync(join(dir, 'src', 'app.ts'), 'export {};\n');
      const source = join(dir, 'src', 'index.ts');
      expect(resolveImportPath('./app', source, dir)).toBe(join(dir, 'src', 'app.ts'));
    });
  });

  it('resolves a relative import to an index file', async () => {
    await withTempDir((dir) => {
      mkdirSync(join(dir, 'src', 'mod'), { recursive: true });
      writeFileSync(join(dir, 'src', 'mod', 'index.ts'), 'export {};\n');
      const source = join(dir, 'src', 'index.ts');
      expect(resolveImportPath('./mod', source, dir)).toBe(join(dir, 'src', 'mod', 'index.ts'));
    });
  });

  it('returns null for a relative import with no matching file', async () => {
    await withTempDir((dir) => {
      const source = join(dir, 'index.ts');
      expect(resolveImportPath('./missing', source, dir)).toBeNull();
    });
  });

  it('resolves a package import via its package.json main entry', async () => {
    await withTempDir((dir) => {
      mkdirSync(join(dir, 'node_modules', 'mypkg', 'lib'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'mypkg', 'package.json'), '{"main":"lib/index.js"}');
      writeFileSync(join(dir, 'node_modules', 'mypkg', 'lib', 'index.js'), 'module.exports={};\n');
      expect(resolveImportPath('mypkg', join(dir, 'index.ts'), dir)).toBe(
        join(dir, 'node_modules', 'mypkg', 'lib', 'index.js'),
      );
    });
  });

  it('falls back to an index file when a package lacks package.json', async () => {
    await withTempDir((dir) => {
      mkdirSync(join(dir, 'node_modules', 'otherpkg'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'otherpkg', 'index.js'), 'module.exports={};\n');
      expect(resolveImportPath('otherpkg', join(dir, 'index.ts'), dir)).toBe(
        join(dir, 'node_modules', 'otherpkg', 'index.js'),
      );
    });
  });

  it('resolves a package import via its exports map', async () => {
    await withTempDir((dir) => {
      mkdirSync(join(dir, 'node_modules', 'exppkg', 'lib'), { recursive: true });
      writeFileSync(
        join(dir, 'node_modules', 'exppkg', 'package.json'),
        '{"exports":{".":{"import":"lib/index.js"}}}',
      );
      writeFileSync(join(dir, 'node_modules', 'exppkg', 'lib', 'index.js'), 'module.exports={};\n');
      expect(resolveImportPath('exppkg', join(dir, 'index.ts'), dir)).toBe(
        join(dir, 'node_modules', 'exppkg', 'lib', 'index.js'),
      );
    });
  });

  it('falls back to index.js when package.json has no main or exports', async () => {
    await withTempDir((dir) => {
      mkdirSync(join(dir, 'node_modules', 'nomain'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'nomain', 'package.json'), '{}');
      writeFileSync(join(dir, 'node_modules', 'nomain', 'index.js'), 'module.exports={};\n');
      expect(resolveImportPath('nomain', join(dir, 'index.ts'), dir)).toBe(
        join(dir, 'node_modules', 'nomain', 'index.js'),
      );
    });
  });

  it('falls through to index files when package.json main is missing', async () => {
    await withTempDir((dir) => {
      mkdirSync(join(dir, 'node_modules', 'badmain'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'badmain', 'package.json'), '{"main":"missing.js"}');
      writeFileSync(join(dir, 'node_modules', 'badmain', 'index.ts'), 'export {};\n');
      expect(resolveImportPath('badmain', join(dir, 'index.ts'), dir)).toBe(
        join(dir, 'node_modules', 'badmain', 'index.ts'),
      );
    });
  });

  it('ignores a malformed package.json and falls back to index files', async () => {
    await withTempDir((dir) => {
      mkdirSync(join(dir, 'node_modules', 'badjson'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'badjson', 'package.json'), '{ not valid json');
      writeFileSync(join(dir, 'node_modules', 'badjson', 'index.js'), 'module.exports={};\n');
      expect(resolveImportPath('badjson', join(dir, 'index.ts'), dir)).toBe(
        join(dir, 'node_modules', 'badjson', 'index.js'),
      );
    });
  });

  it('returns null for a package with a directory but no resolvable files', async () => {
    await withTempDir((dir) => {
      mkdirSync(join(dir, 'node_modules', 'emptypkg'), { recursive: true });
      expect(resolveImportPath('emptypkg', join(dir, 'index.ts'), dir)).toBeNull();
    });
  });

  it('returns null for a package import with no resolvable entry', async () => {
    await withTempDir((dir) => {
      expect(resolveImportPath('missingpkg', join(dir, 'index.ts'), dir)).toBeNull();
    });
  });
});
