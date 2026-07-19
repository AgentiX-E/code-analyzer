import * as fs from 'node:fs/promises';
import os from 'node:os';
import * as path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getDefaultConfig, loadConfig, deepMerge, validateConfig } from '../config/index.js';

import type { CodeAnalyzerConfig } from '@code-analyzer/shared';


describe('getDefaultConfig', () => {
  it('should return a valid configuration object', () => {
    const config = getDefaultConfig();
    expect(config).toBeDefined();
    expect(typeof config.projectId).toBe('string');
    expect(typeof config.rootPath).toBe('string');
    expect(Array.isArray(config.excludePatterns)).toBe(true);
    expect(Array.isArray(config.includePatterns)).toBe(true);
    expect(typeof config.maxFileSize).toBe('number');
    expect(typeof config.maxFiles).toBe('number');
    expect(typeof config.parseWorkers).toBe('number');
    expect(Array.isArray(config.ignorePaths)).toBe(true);
  });

  it('should have positive integer values for numeric fields', () => {
    const config = getDefaultConfig();
    expect(config.maxFileSize).toBeGreaterThan(0);
    expect(config.maxFiles).toBeGreaterThan(0);
    expect(config.parseWorkers).toBeGreaterThan(0);
    expect(Number.isInteger(config.maxFileSize)).toBe(true);
    expect(Number.isInteger(config.maxFiles)).toBe(true);
    expect(Number.isInteger(config.parseWorkers)).toBe(true);
  });

  it('should use current working directory as rootPath', () => {
    const config = getDefaultConfig();
    expect(config.rootPath).toBe(process.cwd());
  });

  it('should include standard ignore patterns', () => {
    const config = getDefaultConfig();
    expect(config.excludePatterns).toContain('node_modules/**');
    expect(config.excludePatterns).toContain('.git/**');
    expect(config.ignorePaths).toContain('node_modules');
    expect(config.ignorePaths).toContain('.git');
  });

  it('should have empty projectId by default', () => {
    const config = getDefaultConfig();
    expect(config.projectId).toBe('');
  });
});

describe('deepMerge', () => {
  it('should merge flat objects', () => {
    const target = { a: 1, b: 2 };
    const source = { b: 3, c: 4 };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('should deep merge nested objects', () => {
    const target = { a: { x: 1, y: 2 } };
    const source = { a: { y: 3, z: 4 } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: { x: 1, y: 3, z: 4 } });
  });

  it('should replace arrays (not merge)', () => {
    const target = { arr: [1, 2, 3] };
    const source = { arr: [4, 5] };
    const result = deepMerge(target, source);
    expect(result).toEqual({ arr: [4, 5] });
  });

  it('should replace non-object values', () => {
    const target = { a: 'hello' };
    const source = { a: 'world' };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 'world' });
  });

  it('should not mutate source objects', () => {
    const target = { a: 1 };
    const source = { a: 2 };
    deepMerge(target, source);
    expect(source.a).toBe(2);
  });

  it('should handle null values in source', () => {
    const target = { a: { x: 1 } };
    const source = { a: null as unknown as Record<string, unknown> };
    const result = deepMerge(target, source);
    expect(result.a).toBeNull();
  });

  it('should handle new nested objects', () => {
    const target = {} as Record<string, unknown>;
    const source = { nested: { value: 42 } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ nested: { value: 42 } });
  });
});

describe('loadConfig', () => {
  const testDir = path.join(os.tmpdir(), 'ca-test-' + Date.now());
  const globalConfigDir = path.join(os.homedir(), '.code-analyzer');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
    // Clean up global config if created
    const globalConfigPath = path.join(globalConfigDir, 'config.json');
    try { await fs.unlink(globalConfigPath); } catch { /* ignore */ }
    try { await fs.rmdir(globalConfigDir); } catch { /* ignore */ }
  });

  it('should return defaults when no config files exist', async () => {
    const config = await loadConfig(testDir);
    const defaults = getDefaultConfig();
    expect(config.maxFileSize).toBe(defaults.maxFileSize);
    expect(config.maxFiles).toBe(defaults.maxFiles);
    expect(config.parseWorkers).toBe(defaults.parseWorkers);
    expect(config.projectId).toBe('');
  });

  it('should merge project config file', async () => {
    const projectConfigPath = path.join(testDir, '.code-analyzer.json');
    await fs.writeFile(
      projectConfigPath,
      JSON.stringify({ projectId: 'test-project', maxFileSize: 500 })
    );

    const config = await loadConfig(testDir);
    expect(config.projectId).toBe('test-project');
    expect(config.maxFileSize).toBe(500);
    // Defaults for non-overridden fields should remain
    const defaults = getDefaultConfig();
    expect(config.maxFiles).toBe(defaults.maxFiles);
  });

  it('should override with environment variables', async () => {
    process.env['CODE_ANALYZER_MAX_FILE_SIZE'] = '2048';
    process.env['CODE_ANALYZER_PARSE_WORKERS'] = '8';
    process.env['CODE_ANALYZER_PROJECT_ID'] = 'env-project';

    try {
      const config = await loadConfig(testDir);
      expect(config.maxFileSize).toBe(2048);
      expect(config.parseWorkers).toBe(8);
      expect(config.projectId).toBe('env-project');
    } finally {
      delete process.env['CODE_ANALYZER_MAX_FILE_SIZE'];
      delete process.env['CODE_ANALYZER_PARSE_WORKERS'];
      delete process.env['CODE_ANALYZER_PROJECT_ID'];
    }
  });

  it('should handle comma-separated env var for arrays', async () => {
    process.env['CODE_ANALYZER_EXCLUDE_PATTERNS'] = 'a,b,c';

    try {
      const config = await loadConfig(testDir);
      expect(config.excludePatterns).toEqual(['a', 'b', 'c']);
    } finally {
      delete process.env['CODE_ANALYZER_EXCLUDE_PATTERNS'];
    }
  });

  it('should coerce boolean env vars', async () => {
    process.env['CODE_ANALYZER_REVIEW_ENABLED'] = 'true';

    try {
      const config = await loadConfig(testDir);
      const review = config.review;
      expect(review).toBeDefined();
      expect(review!.enabled).toBe(true);
    } finally {
      delete process.env['CODE_ANALYZER_REVIEW_ENABLED'];
    }
  });

  it('should coerce numeric env vars', async () => {
    process.env['CODE_ANALYZER_EMBED_DIMENSIONS'] = '768';

    try {
      const config = await loadConfig(testDir);
      const embed = config.embed;
      expect(embed).toBeDefined();
      expect(embed!.dimensions).toBe(768);
    } finally {
      delete process.env['CODE_ANALYZER_EMBED_DIMENSIONS'];
    }
  });

  it('should set rootPath to the provided path', async () => {
    const projectConfigPath = path.join(testDir, '.code-analyzer.json');
    await fs.writeFile(
      projectConfigPath,
      JSON.stringify({ rootPath: '/custom/path' })
    );

    const config = await loadConfig(testDir);
    expect(config.rootPath).toBe('/custom/path');
  });
});

describe('validateConfig', () => {
  it('should return empty array for valid config', () => {
    const config: CodeAnalyzerConfig = {
      projectId: 'test',
      rootPath: '/tmp',
      maxFileSize: 1024,
      maxFiles: 1000,
      parseWorkers: 4,
      excludePatterns: [],
      includePatterns: [],
      ignorePaths: [],
    };
    const errors = validateConfig(config);
    expect(errors).toHaveLength(0);
  });

  it('should return error for null/undefined config', () => {
    expect(validateConfig(null)).toHaveLength(1);
    expect(validateConfig(undefined)).toHaveLength(1);
  });

  it('should return error for non-object config', () => {
    expect(validateConfig('string')).toHaveLength(1);
    expect(validateConfig(42)).toHaveLength(1);
    expect(validateConfig([])).toHaveLength(1);
  });

  it('should validate required fields', () => {
    const config = { projectId: '', rootPath: '' };
    const errors = validateConfig(config);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should return errors with path and message', () => {
    const config = {};
    const errors = validateConfig(config);
    for (const err of errors) {
      expect(typeof err.path).toBe('string');
      expect(typeof err.message).toBe('string');
      expect(err.message.length).toBeGreaterThan(0);
    }
  });
});
