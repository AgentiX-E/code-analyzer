// @code-analyzer/intelligence — Community Rule Registry Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { CommunityRuleRegistry } from '../rules/community-registry.js';
import type { CommunityRuleTemplate } from '../rules/community-registry.js';

function makeTemplate(overrides: Partial<CommunityRuleTemplate> = {}): CommunityRuleTemplate {
  return {
    id: 'std-001',
    name: 'TypeScript Best Practices',
    description: 'Standard TypeScript coding conventions and best practices',
    category: 'code-quality',
    author: 'community',
    version: '1.0.0',
    tags: ['typescript', 'best-practices'],
    language: 'typescript',
    standards: [{
      id: 'ts-naming',
      name: 'TS Naming Convention',
      category: 'naming',
      description: 'Use camelCase for variables',
      severity: 'medium',
      rules: [{
        id: 'ts-naming-01',
        description: 'Variables must use camelCase',
        severity: 'medium',
        patterns: ['^[a-z][a-zA-Z0-9]*$'],
        checkConfig: { pattern: '^[a-z][a-zA-Z0-9]*$' },
      }],
    } as any],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    downloads: 0,
    ...overrides,
  };
}

describe('CommunityRuleRegistry', () => {
  let registry: CommunityRuleRegistry;

  beforeEach(() => {
    registry = new CommunityRuleRegistry();
  });

  describe('register', () => {
    it('should register a valid template', () => {
      const template = makeTemplate();
      registry.register(template);
      expect(registry.size).toBe(1);
    });

    it('should return the registered template', () => {
      const template = makeTemplate();
      const result = registry.register(template);
      expect(result.id).toBe('std-001');
    });

    it('should throw if id is missing', () => {
      expect(() => registry.register(makeTemplate({ id: '' }))).toThrow('id and name');
    });

    it('should throw if name is missing', () => {
      expect(() => registry.register(makeTemplate({ name: '' }))).toThrow('id and name');
    });

    it('should throw if no standards are provided', () => {
      expect(() => registry.register(makeTemplate({ standards: [] }))).toThrow('at least one standard');
    });
  });

  describe('unregister', () => {
    it('should remove a registered template', () => {
      registry.register(makeTemplate());
      expect(registry.unregister('std-001')).toBe(true);
      expect(registry.size).toBe(0);
    });

    it('should return false for non-existent template', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('get', () => {
    it('should return a registered template by id', () => {
      registry.register(makeTemplate());
      const result = registry.get('std-001');
      expect(result).toBeDefined();
      expect(result!.name).toBe('TypeScript Best Practices');
    });

    it('should return undefined for unknown id', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should return all registered templates', () => {
      registry.register(makeTemplate({ id: 'a' }));
      registry.register(makeTemplate({ id: 'b', name: 'Second' }));
      expect(registry.list()).toHaveLength(2);
    });

    it('should return empty array for empty registry', () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      registry.register(makeTemplate({
        id: 'ts-quality',
        name: 'TypeScript Quality',
        category: 'code-quality',
        tags: ['typescript'],
      }));
      registry.register(makeTemplate({
        id: 'sec-rules',
        name: 'Security Rules',
        category: 'security',
        tags: ['security', 'owasp'],
      }));
      registry.register(makeTemplate({
        id: 'py-style',
        name: 'Python Style Guide',
        category: 'code-quality',
        tags: ['python', 'style'],
        language: 'python',
      }));
    });

    it('should search by query keyword', () => {
      const results = registry.search({ query: 'security' });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('sec-rules');
    });

    it('should search by multiple keywords (AND)', () => {
      const results = registry.search({ query: 'python style' });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('py-style');
    });

    it('should filter by category', () => {
      const results = registry.search({ category: 'security' });
      expect(results).toHaveLength(1);
    });

    it('should filter by tag', () => {
      const results = registry.search({ tag: 'owasp' });
      expect(results).toHaveLength(1);
    });

    it('should filter by language', () => {
      const results = registry.search({ language: 'python' });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('py-style');
    });

    it('should return empty for no-match query', () => {
      const results = registry.search({ query: 'zzzzzznomatch' });
      expect(results).toEqual([]);
    });

    it('should combine filters', () => {
      const results = registry.search({ category: 'code-quality', tag: 'typescript' });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('ts-quality');
    });
  });

  describe('export / import', () => {
    it('should export a template as JSON', () => {
      registry.register(makeTemplate());
      const exported = registry.exportTemplate('std-001');
      expect(exported).toBeDefined();
      expect(exported!.id).toBe('std-001');
      expect(exported!.exportedAt).toBeDefined();
    });

    it('should return null for unknown template', () => {
      expect(registry.exportTemplate('unknown')).toBeNull();
    });

    it('should import a single template', () => {
      const result = registry.importTemplates({
        id: 'imported-01',
        name: 'Imported Standard',
        category: 'code-quality',
        standards: [{ id: 'r1', name: 'R1', category: 'a', description: 'd', severity: 'low', rules: [] }],
      });
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(registry.size).toBe(1);
    });

    it('should import an array of templates', () => {
      const result = registry.importTemplates([
        { id: 'a', name: 'A', category: 'cat', standards: [{ id: 'r1', name: 'R1', category: 'c', description: 'd', severity: 'low', rules: [] }] },
        { id: 'b', name: 'B', category: 'cat', standards: [{ id: 'r2', name: 'R2', category: 'c', description: 'd', severity: 'low', rules: [] }] },
      ]);
      expect(result.imported).toBe(2);
    });

    it('should skip duplicate versions', () => {
      const payload = { id: 'dup', name: 'Dup', version: '1.0.0', standards: [{ id: 'r1', name: 'R1', category: 'c', description: 'd', severity: 'low', rules: [] }] };
      registry.importTemplates(payload);
      const result = registry.importTemplates(payload);
      expect(result.skipped).toBe(1);
      expect(result.imported).toBe(0);
    });

    it('should report errors for invalid templates', () => {
      const result = registry.importTemplates({ invalid: true } as any);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('popularity', () => {
    it('should return templates sorted by downloads', () => {
      registry.register(makeTemplate({ id: 'low', downloads: 5 }));
      registry.register(makeTemplate({ id: 'high', downloads: 100 }));
      registry.register(makeTemplate({ id: 'mid', downloads: 50 }));

      const popular = registry.getPopular();
      expect(popular[0]!.id).toBe('high');
      expect(popular[1]!.id).toBe('mid');
      expect(popular[2]!.id).toBe('low');
    });

    it('should respect limit', () => {
      registry.register(makeTemplate({ id: 'a', downloads: 1 }));
      registry.register(makeTemplate({ id: 'b', downloads: 2 }));
      registry.register(makeTemplate({ id: 'c', downloads: 3 }));

      expect(registry.getPopular(2)).toHaveLength(2);
    });
  });

  describe('getByCategory', () => {
    it('should filter by exact category', () => {
      registry.register(makeTemplate({ id: 'a', category: 'security' }));
      registry.register(makeTemplate({ id: 'b', category: 'code-quality' }));
      expect(registry.getByCategory('security')).toHaveLength(1);
    });

    it('should return empty for unmatched category', () => {
      expect(registry.getByCategory('nonexistent')).toEqual([]);
    });
  });

  describe('incrementDownloads', () => {
    it('should increment download count', () => {
      registry.register(makeTemplate({ downloads: 10 }));
      registry.incrementDownloads('std-001');
      expect(registry.get('std-001')!.downloads).toBe(11);
    });

    it('should return false for unknown template', () => {
      expect(registry.incrementDownloads('unknown')).toBe(false);
    });
  });
});
