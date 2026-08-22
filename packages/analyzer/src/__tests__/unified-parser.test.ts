import { createWorkerPool } from '@code-analyzer/infra';
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, it, expect } from 'vitest';

import { GoProvider } from '../languages/go.js';
import { JavaProvider } from '../languages/java.js';
import { JavaScriptProvider } from '../languages/javascript.js';
import { PythonProvider } from '../languages/python.js';
import { RustProvider } from '../languages/rust.js';
import { TypeScriptProvider } from '../languages/typescript.js';
import { UnifiedParser } from '../parser/unified-parser.js';

import type { DiscoveredFile } from '@code-analyzer/shared';

describe('UnifiedParser', () => {
  const providers = [
    new TypeScriptProvider(),
    new PythonProvider(),
    new GoProvider(),
    new JavaScriptProvider(),
    new JavaProvider(),
    new RustProvider(),
  ];

  function createFile(filePath: string, content: string): DiscoveredFile {
    return {
      filePath,
      language: null,
      content,
      hash: 'test-hash',
      size: content.length,
    };
  }

  describe('constructor', () => {
    it('should register all provided language providers', () => {
      const parser = new UnifiedParser(providers);
      expect(parser.getProvider('typescript')).toBeDefined();
      expect(parser.getProvider('python')).toBeDefined();
      expect(parser.getProvider('go')).toBeDefined();
      expect(parser.getProvider('javascript')).toBeDefined();
    });

    it('should return undefined for unknown language', () => {
      const parser = new UnifiedParser(providers);
      expect(parser.getProvider('ruby')).toBeUndefined();
    });
  });

  describe('parseFile', () => {
    const parser = new UnifiedParser(providers);

    it('should parse TypeScript files', () => {
      const file = createFile('app.ts', 'function hello() { return "world"; }');
      const captures = parser.parseFile(file);
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.length).toBeGreaterThan(0);
    });

    it('should parse Python files', () => {
      const file = createFile('app.py', 'def hello():\n    return "world"');
      const captures = parser.parseFile(file);
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.length).toBeGreaterThan(0);
    });

    it('should parse Go files', () => {
      const file = createFile('main.go', 'package main\n\nfunc Hello() string { return "hi" }');
      const captures = parser.parseFile(file);
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.length).toBeGreaterThan(0);
    });

    it('should parse JavaScript files', () => {
      const file = createFile('app.js', 'function hello() { return "world"; }');
      const captures = parser.parseFile(file);
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.length).toBeGreaterThan(0);
    });

    it('should handle unsupported file types gracefully', () => {
      const file = createFile('style.css', '.button { color: red; }');
      const captures = parser.parseFile(file);
      expect(captures).toHaveLength(0);
    });

    it('should handle TypeScript React files (.tsx)', () => {
      const file = createFile(
        'Component.tsx',
        `
        export const Button = () => {
          return <button>Click</button>;
        };
      `,
      );
      const captures = parser.parseFile(file);
      expect(captures.length).toBeGreaterThan(0);
    });

    it('should use cache on subsequent parseFile calls (L48)', () => {
      const parser = new UnifiedParser(providers);
      const file = createFile('cache-test.ts', 'function cached() { return 42; }');

      // First call populates the cache
      const first = parser.parseFile(file);
      expect(first.length).toBeGreaterThan(0);

      // Second call with same content should hit the cache
      const second = parser.parseFile(file);
      expect(second).toEqual(first);
    });
  });

  describe('parseFiles (parallel)', () => {
    it('should parse multiple files in parallel', async () => {
      const parser = new UnifiedParser(providers);
      const pool = createWorkerPool(4);

      const files: DiscoveredFile[] = [
        createFile('a.ts', 'function a() {}'),
        createFile('b.ts', 'function b() {}'),
        createFile('c.ts', 'function c() {}'),
      ];

      const result = await parser.parseFiles(files, pool);
      expect(result.size).toBe(3);
      expect(result.get('a.ts')).toBeDefined();
      expect(result.get('b.ts')).toBeDefined();
      expect(result.get('c.ts')).toBeDefined();

      pool.shutdown();
    });

    it('should return empty map for no files', async () => {
      const parser = new UnifiedParser(providers);
      const pool = createWorkerPool(2);
      const result = await parser.parseFiles([], pool);
      expect(result.size).toBe(0);
      pool.shutdown();
    });

    it('should use cache hits in parseFiles (L77-78)', async () => {
      const parser = new UnifiedParser(providers);
      const pool = createWorkerPool(2);
      const file = createFile('cached.ts', 'function cached() {}');

      // First call populates the cache
      await parser.parseFiles([file], pool);

      // Second call should use the cache (same content)
      const result = await parser.parseFiles([file], pool);
      expect(result.size).toBe(1);
      expect(result.get('cached.ts')).toBeDefined();

      pool.shutdown();
    });

    it('should handle parseFiles with cache disabled (L84)', async () => {
      const parser = new UnifiedParser(providers, { cache: false });
      const pool = createWorkerPool(2);

      const files: DiscoveredFile[] = [createFile('nocache.ts', 'function nocache() {}')];

      const result = await parser.parseFiles(files, pool);
      expect(result.size).toBe(1);
      expect(result.get('nocache.ts')).toBeDefined();

      pool.shutdown();
    });
  });

  describe('cache management', () => {
    it('should have cache enabled by default (L122)', () => {
      const parser = new UnifiedParser(providers);
      expect(parser.isCacheEnabled).toBe(true);
    });

    it('should report cache disabled when configured (L122)', () => {
      const parser = new UnifiedParser(providers, { cache: false });
      expect(parser.isCacheEnabled).toBe(false);
    });

    it('should return cache stats when cache enabled (L112)', () => {
      const parser = new UnifiedParser(providers);
      const file = createFile('stats.ts', 'function stats() {}');
      parser.parseFile(file);

      const stats = parser.cacheStats;
      expect(stats).not.toBeNull();
      expect(stats!.hits).toBe(0);
      expect(stats!.misses).toBeGreaterThanOrEqual(1);
    });

    it('should return null cache stats when cache disabled (L112)', () => {
      const parser = new UnifiedParser(providers, { cache: false });
      expect(parser.cacheStats).toBeNull();
    });

    it('should clear cache (L117)', () => {
      const parser = new UnifiedParser(providers);
      const file = createFile('clear.ts', 'function clear() {}');

      // Populate cache
      parser.parseFile(file);
      expect(parser.cacheStats?.size).toBeGreaterThanOrEqual(1);

      // Clear cache
      parser.clearCache();
      expect(parser.cacheStats?.size).toBe(0);
    });
  });
});
