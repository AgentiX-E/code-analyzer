/**
 * Tests for the init command.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { initProject } from '../commands/init.js';

describe('initProject', () => {
  let testDir: string;

  beforeEach(() => {
    // **`mkdtempSync`, not a name built from a timestamp.** The platform creates the directory atomically with a
    // name nobody can predict, which is what makes it a temporary directory rather than a shareable one — and it is
    // also the difference CodeQL's `js/insecure-temporary-file` is describing when it follows `tmpdir()` into a write.
    testDir = mkdtempSync(join(tmpdir(), 'code-analyzer-init-test-'));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  it('should create .code-analyzer directory', () => {
    const result = initProject({ directory: testDir });
    expect(result.success).toBe(true);
    expect(existsSync(join(testDir, '.code-analyzer'))).toBe(true);
  });

  it('should create standards.json', () => {
    const result = initProject({ directory: testDir });
    expect(result.filesCreated).toContain('standards.json');
    const content = readFileSync(join(testDir, '.code-analyzer', 'standards.json'), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.name).toBe('Project Standards');
    expect(parsed.rules).toBeInstanceOf(Array);
    expect(parsed.rules.length).toBeGreaterThan(0);
  });

  it('should create config.json', () => {
    const result = initProject({ directory: testDir });
    expect(result.filesCreated).toContain('config.json');
    const content = readFileSync(join(testDir, '.code-analyzer', 'config.json'), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.index).toBeDefined();
    expect(parsed.review).toBeDefined();
    expect(parsed.search).toBeDefined();
  });

  it('should create data directory', () => {
    initProject({ directory: testDir });
    expect(existsSync(join(testDir, '.code-analyzer', 'data'))).toBe(true);
  });

  it('should append to .gitignore', () => {
    writeFileSync(join(testDir, '.gitignore'), 'node_modules/\n');
    initProject({ directory: testDir });
    const gitignore = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.code-analyzer/data/');
    expect(gitignore).toContain('node_modules/');
  });

  it('should preserve existing .gitignore entries', () => {
    writeFileSync(join(testDir, '.gitignore'), 'node_modules/\ndist/\n');
    initProject({ directory: testDir });
    const gitignore = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');
  });

  it('should create .gitignore if it does not exist', () => {
    initProject({ directory: testDir });
    expect(existsSync(join(testDir, '.gitignore'))).toBe(true);
  });

  it('should report existing files on second init', () => {
    initProject({ directory: testDir });
    const result = initProject({ directory: testDir });
    expect(result.filesExisting).toContain('standards.json');
    expect(result.filesExisting).toContain('config.json');
  });

  it('should overwrite with force flag', () => {
    initProject({ directory: testDir });
    // Modify standards.json
    writeFileSync(
      join(testDir, '.code-analyzer', 'standards.json'),
      JSON.stringify({ name: 'Modified' }),
    );
    const result = initProject({ directory: testDir, force: true });
    expect(result.filesCreated).toContain('standards.json');
    const content = readFileSync(join(testDir, '.code-analyzer', 'standards.json'), 'utf-8');
    expect(JSON.parse(content).name).toBe('Project Standards');
  });

  it('should default to current working directory', () => {
    const result = initProject();
    expect(result.success).toBe(true);
    expect(result.configDir).toBe(resolve(process.cwd(), '.code-analyzer'));
    // Clean up
    try {
      rmSync(resolve(process.cwd(), '.code-analyzer'), { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('should return correct configDir', () => {
    const result = initProject({ directory: testDir });
    expect(result.configDir).toBe(resolve(testDir, '.code-analyzer'));
  });

  it('should handle directories with spaces', () => {
    const spacedDir = join(testDir, 'my project');
    mkdirSync(spacedDir, { recursive: true });
    const result = initProject({ directory: spacedDir });
    expect(result.success).toBe(true);
    expect(existsSync(join(spacedDir, '.code-analyzer'))).toBe(true);
  });

  it('should skip gitignore when .code-analyzer/data/ already present', () => {
    writeFileSync(join(testDir, '.gitignore'), '.code-analyzer/data/\nnode_modules/\n');
    void initProject({ directory: testDir });
    const gitignore = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    // Should not duplicate the entry
    const matches = (gitignore.match(/\.code-analyzer\/data\//g) || []).length;
    expect(matches).toBe(1);
  });
});

describe('initProject — .gitignore write failure', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'code-analyzer-init-gitignore-'));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  it('should still succeed when .gitignore cannot be written', () => {
    // A directory named .gitignore makes readFileSync throw EISDIR, which
    // drives the non-critical catch around the .gitignore update.
    mkdirSync(join(testDir, '.gitignore'));
    const result = initProject({ directory: testDir });
    expect(result.success).toBe(true);
    expect(result.filesCreated).toContain('standards.json');
    expect(result.filesCreated).toContain('config.json');
    expect(result.filesCreated).not.toContain('.gitignore (updated)');
  });
});

describe('initProject — a config path that exists but is not writable as a file', () => {
  it('surfaces the failure instead of calling the path existing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-analyzer-init-dir-'));
    try {
      // A directory where `standards.json` should be: `O_CREAT|O_EXCL` reports EEXIST, and what is there is not a file.
      mkdirSync(join(dir, '.code-analyzer', 'standards.json'), { recursive: true });

      // **Reported, not swallowed.** The previous implementation asked `existsSync` first and then wrote, so a path that
      // existed as a directory was reported as an existing standards file — an init claiming to have found
      // configuration nobody could read. `wx` makes the write the check; `EEXIST` alone cannot tell a file from a
      // directory, so the branch that recovers from it asks what is actually there.
      expect(() => initProject({ directory: dir })).toThrow(/exists and is not a regular file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
