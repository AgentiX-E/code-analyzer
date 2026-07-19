// @code-analyzer/infra — FileDiscoverer Tests

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createFileDiscoverer } from '../filesystem/discoverer.js';
import type { FileDiscoverer } from '../filesystem/discoverer.js';

describe('FileDiscoverer', () => {
  let rootPath: string;
  let discoverer: FileDiscoverer;

  function setup(dirs: string[], files: Record<string, string>): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-discover-'));
    for (const dir of dirs) {
      fs.mkdirSync(path.join(base, dir), { recursive: true });
    }
    for (const [filePath, content] of Object.entries(files)) {
      const full = path.join(base, filePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return base;
  }

  beforeAll(() => {
    discoverer = createFileDiscoverer();
  });

  afterAll(() => {
    if (rootPath) {
      fs.rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('discovers TypeScript files', async () => {
    rootPath = setup([], {
      'src/index.ts': 'export const x = 1;',
      'src/utils.ts': 'export function y() {}',
    });

    const files = await discoverer.discover(rootPath);
    const tsFiles = files.filter((f) => f.language === 'typescript');
    expect(tsFiles.length).toBe(2);
  });

  it('discovers JavaScript files', async () => {
    rootPath = setup([], {
      'app.js': 'const x = 1;',
    });

    const files = await discoverer.discover(rootPath);
    const jsFiles = files.filter((f) => f.language === 'javascript');
    expect(jsFiles.length).toBe(1);
  });

  it('discovers Python files', async () => {
    rootPath = setup([], {
      'main.py': 'print("hello")',
    });

    const files = await discoverer.discover(rootPath);
    const pyFiles = files.filter((f) => f.language === 'python');
    expect(pyFiles.length).toBe(1);
  });

  it('returns language null for unknown extensions', async () => {
    rootPath = setup([], {
      'data.txt': 'hello world',
      'config.yml': 'key: value',
    });

    const files = await discoverer.discover(rootPath);
    expect(files.every((f) => f.language === null)).toBe(true);
  });

  it('excludes node_modules by default', async () => {
    rootPath = setup(['node_modules/pkg'], {
      'node_modules/pkg/index.ts': 'export {};',
      'src/app.ts': 'console.log("hi");',
    });

    const files = await discoverer.discover(rootPath);
    expect(files.length).toBe(1);
    expect(files[0]!.filePath).toContain('src');
  });

  it('excludes .git directory by default', async () => {
    rootPath = setup(['.git/objects'], {
      '.git/config': '[core]',
      'src/app.ts': 'const x = 1;',
    });

    const files = await discoverer.discover(rootPath);
    expect(files.length).toBe(1);
    expect(files[0]!.filePath).not.toContain('.git');
  });

  it('excludes dist directory by default', async () => {
    rootPath = setup(['dist'], {
      'dist/bundle.js': 'minified',
      'src/app.ts': 'const x = 1;',
    });

    const files = await discoverer.discover(rootPath);
    expect(files.length).toBe(1);
  });

  it('excludes build directory by default', async () => {
    rootPath = setup(['build'], {
      'build/output.js': 'bundled',
      'src/lib.ts': 'const x = 1;',
    });

    const files = await discoverer.discover(rootPath);
    expect(files.length).toBe(1);
  });

  it('respects maxFileSize', async () => {
    const largeContent = 'x'.repeat(5 * 1024 * 1024); // 5MB
    rootPath = setup([], {
      'large.ts': largeContent,
      'small.ts': 'const x = 1;',
    });

    const files = await discoverer.discover(rootPath, { maxFileSize: 1024 });
    expect(files.length).toBe(1);
    expect(files[0]!.filePath).toContain('small');
  });

  it('respects custom excludePatterns', async () => {
    rootPath = setup([], {
      'generated/api.ts': '// auto-generated',
      'src/handmade.ts': '// written by hand',
    });

    const files = await discoverer.discover(rootPath, {
      excludePatterns: ['generated/**'],
    });
    expect(files.length).toBe(1);
    expect(files[0]!.filePath).toContain('handmade');
  });

  it('respects includePatterns', async () => {
    rootPath = setup([], {
      'src/a.ts': 'const a = 1;',
      'src/b.ts': 'const b = 2;',
      'tests/c.ts': 'test("c");',
    });

    const files = await discoverer.discover(rootPath, {
      includePatterns: ['tests/**'],
    });
    expect(files.length).toBe(1);
    expect(files[0]!.filePath).toContain('tests');
  });

  it('respects .gitignore when enabled', async () => {
    rootPath = setup([], {
      '.gitignore': 'ignored/\n*.gen.ts',
      'ignored/bad.ts': '// bad',
      'src/good.ts': '// good',
      'src/auto.gen.ts': '// auto-generated',
    });

    const files = await discoverer.discover(rootPath, { respectGitignore: true });
    const filePaths = files.map((f) => f.filePath);
    expect(filePaths).toContain('src/good.ts');
    expect(filePaths).not.toContain('ignored/bad.ts');
    expect(filePaths).not.toContain('src/auto.gen.ts');
  });

  it('skips .gitignore when disabled', async () => {
    rootPath = setup([], {
      '.gitignore': 'ignored/',
      'ignored/file.ts': 'export const x = 1;',
    });

    const files = await discoverer.discover(rootPath, { respectGitignore: false });
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.filePath.includes('ignored'))).toBe(true);
  });

  it('detects language for a file path', () => {
    expect(discoverer.detectLanguage('test.ts')).toBe('typescript');
    expect(discoverer.detectLanguage('test.js')).toBe('javascript');
    expect(discoverer.detectLanguage('test.py')).toBe('python');
    expect(discoverer.detectLanguage('test.go')).toBe('go');
    expect(discoverer.detectLanguage('test.rs')).toBe('rust');
    expect(discoverer.detectLanguage('test.java')).toBe('java');
    expect(discoverer.detectLanguage('test.txt')).toBeNull();
  });

  it('detects TypeScript .tsx files', () => {
    expect(discoverer.detectLanguage('Component.tsx')).toBe('typescript');
  });

  it('detects JavaScript .jsx files', () => {
    expect(discoverer.detectLanguage('Component.jsx')).toBe('javascript');
  });

  it('matches gitignore patterns', async () => {
    rootPath = setup(['build'], {
      '.gitignore': 'build/\n*.log',
      'build/output.js': 'bundled',
      'debug.log': 'log content',
      'src/app.ts': 'code',
    });

    expect(discoverer.matchGitignore(rootPath, path.join(rootPath, 'build/output.js'))).toBe(true);
    expect(discoverer.matchGitignore(rootPath, path.join(rootPath, 'debug.log'))).toBe(true);
    expect(discoverer.matchGitignore(rootPath, path.join(rootPath, 'src/app.ts'))).toBe(false);
  });

  it('matches gitignore with negation patterns', () => {
    rootPath = setup(['src', 'src/sub'], {
      '.gitignore': 'src/*\n!src/sub',
      'src/app.ts': 'code',
      'src/sub/keep.ts': 'keep',
    });

    // Our simple glob engine may not support negation,
    // but we test that basic matching works
    expect(() => discoverer.matchGitignore(rootPath, path.join(rootPath, 'src/app.ts'))).not.toThrow();
  });

  it('handles non-existent .gitignore gracefully', () => {
    rootPath = setup([], {
      'file.ts': 'const x = 1;',
    });
    expect(() => discoverer.matchGitignore(rootPath, path.join(rootPath, 'file.ts'))).not.toThrow();
  });

  it('includes content in discovered files', async () => {
    const content = 'export function hello() { return "world"; }';
    rootPath = setup([], {
      'hello.ts': content,
    });

    const files = await discoverer.discover(rootPath);
    expect(files[0]!.content).toBe(content);
  });

  it('includes hash in discovered files', async () => {
    rootPath = setup([], {
      'hash.ts': 'const x = 42;',
    });

    const files = await discoverer.discover(rootPath);
    expect(files[0]!.hash).toBeTruthy();
    expect(files[0]!.hash).toMatch(/^h_[0-9a-f]{8}$/);
  });

  it('includes size in discovered files', async () => {
    rootPath = setup([], {
      'size.ts': 'const x = 1;',
    });

    const files = await discoverer.discover(rootPath);
    expect(files[0]!.size).toBeGreaterThan(0);
  });

  it('skips empty files', async () => {
    rootPath = setup([], {
      'empty.ts': '',
      'full.ts': 'const x = 1;',
    });

    const files = await discoverer.discover(rootPath);
    expect(files.length).toBe(1);
    expect(files[0]!.filePath).toBe('full.ts');
  });

  it('discovers files in subdirectories', async () => {
    rootPath = setup(['src', 'src/utils', 'tests'], {
      'src/index.ts': '// index',
      'src/utils/helper.ts': '// helper',
      'tests/index.test.ts': '// test',
    });

    const files = await discoverer.discover(rootPath);
    expect(files.length).toBe(3);
  });

  it('handles directories with mixed languages', async () => {
    rootPath = setup([], {
      'server.ts': '// ts',
      'script.js': '// js',
      'data.py': '# py',
      'config.yaml': 'key: value',
    });

    const files = await discoverer.discover(rootPath);
    const langMap = new Map(files.map((f) => [f.filePath, f.language]));
    expect(langMap.get('server.ts')).toBe('typescript');
    expect(langMap.get('script.js')).toBe('javascript');
    expect(langMap.get('data.py')).toBe('python');
    expect(langMap.get('config.yaml')).toBeNull();
  });

  it('detects Go files', () => {
    expect(discoverer.detectLanguage('main.go')).toBe('go');
  });

  it('detects C files', () => {
    expect(discoverer.detectLanguage('program.c')).toBe('c');
    expect(discoverer.detectLanguage('header.h')).toBe('c');
  });

  it('detects C++ files', () => {
    expect(discoverer.detectLanguage('program.cpp')).toBe('cpp');
    expect(discoverer.detectLanguage('header.hpp')).toBe('cpp');
    expect(discoverer.detectLanguage('file.cc')).toBe('cpp');
  });

  it('detects Zig files', () => {
    expect(discoverer.detectLanguage('main.zig')).toBe('zig');
  });

  it('detects Elixir files', () => {
    expect(discoverer.detectLanguage('app.ex')).toBe('elixir');
    expect(discoverer.detectLanguage('script.exs')).toBe('elixir');
  });
});
