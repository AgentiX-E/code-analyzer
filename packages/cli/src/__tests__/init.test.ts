/**
 * Tests for the init command.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { initProject } from '../commands/init.js';

describe('initProject', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = resolve(tmpdir(), `code-analyzer-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* cleanup */ }
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
    try { rmSync(resolve(process.cwd(), '.code-analyzer'), { recursive: true, force: true }); } catch { /* */ }
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
});
