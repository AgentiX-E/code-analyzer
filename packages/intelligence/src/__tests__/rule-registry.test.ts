// @code-analyzer/intelligence — Rule Registry Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { RuleRegistry } from '../rules/rule-registry.js';
import type { RegistryTemplate } from '../rules/rule-registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTemplate(overrides: Partial<RegistryTemplate> = {}): RegistryTemplate {
  return {
    id: 'std-001',
    name: 'Security Baseline',
    description: 'Standard security rules',
    version: '1.0.0',
    tags: ['security', 'baseline'],
    rules: [{
      id: 'rule-001', name: 'No Hardcoded Secrets', description: 'Detect hardcoded credentials',
      category: 'security', severity: 'critical',
      pattern: '(password|secret|api[_-]?key)\\s*=\\s*[\'"][^\'"]+[\'"]',
      suggestion: 'Use environment variables or a secret manager',
      appliesTo: ['**/*.ts', '**/*.js', '**/*.py'],
    }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    checksum: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RuleRegistry', () => {
  let registry: RuleRegistry;

  beforeEach(() => {
    registry = new RuleRegistry();
  });

  describe('register', () => {
    it('should register a template', () => {
      registry.register(makeTemplate());
      expect(registry.size).toBe(1);
    });

    it('should auto-compute checksum when not provided', () => {
      const tpl = makeTemplate();
      registry.register(tpl);
      const stored = registry.get(tpl.id);
      expect(stored!.checksum).toBeTruthy();
      expect(stored!.checksum.length).toBe(16);
    });

    it('should overwrite existing template with same id', () => {
      registry.register(makeTemplate({ id: 'dup', name: 'First' }));
      registry.register(makeTemplate({ id: 'dup', name: 'Second' }));
      expect(registry.get('dup')!.name).toBe('Second');
    });
  });

  describe('get', () => {
    it('should return a registered template', () => {
      const tpl = makeTemplate();
      registry.register(tpl);
      expect(registry.get('std-001')).toEqual(tpl);
    });

    it('should return undefined for unknown id', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should return all templates', () => {
      registry.register(makeTemplate({ id: 'a' }));
      registry.register(makeTemplate({ id: 'b' }));
      expect(registry.list()).toHaveLength(2);
    });

    it('should return empty array with no templates', () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe('listByTags', () => {
    it('should filter by tags', () => {
      registry.register(makeTemplate({ id: 'a', tags: ['security'] }));
      registry.register(makeTemplate({ id: 'b', tags: ['performance'] }));
      expect(registry.listByTags(['security'])).toHaveLength(1);
    });

    it('should match any of the provided tags', () => {
      registry.register(makeTemplate({ id: 'a', tags: ['security', 'baseline'] }));
      expect(registry.listByTags(['baseline'])).toHaveLength(1);
    });
  });

  describe('search', () => {
    it('should search by name', () => {
      registry.register(makeTemplate({ id: 'a', name: 'Security Rules' }));
      expect(registry.search('security')).toHaveLength(1);
    });

    it('should search by description', () => {
      registry.register(makeTemplate({ id: 'a', description: 'Performance optimization rules' }));
      expect(registry.search('optimization')).toHaveLength(1);
    });

    it('should search by tags', () => {
      registry.register(makeTemplate({ id: 'a', tags: ['react', 'typescript'] }));
      expect(registry.search('react')).toHaveLength(1);
    });

    it('should be case-insensitive', () => {
      registry.register(makeTemplate({ id: 'a', name: 'SECURITY' }));
      expect(registry.search('security')).toHaveLength(1);
    });

    it('should return empty array for no match', () => {
      registry.register(makeTemplate());
      expect(registry.search('nonexistent')).toEqual([]);
    });
  });

  describe('remove', () => {
    it('should remove a template', () => {
      registry.register(makeTemplate({ id: 'rm-me' }));
      expect(registry.remove('rm-me')).toBe(true);
      expect(registry.size).toBe(0);
    });

    it('should return false for unknown id', () => {
      expect(registry.remove('nope')).toBe(false);
    });

    it('should decrement size after remove', () => {
      registry.register(makeTemplate({ id: 'a' }));
      registry.register(makeTemplate({ id: 'b' }));
      expect(registry.size).toBe(2);
      registry.remove('a');
      expect(registry.size).toBe(1);
    });
  });

  describe('toProjectStandard', () => {
    it('should convert template to project standard', () => {
      const tpl = makeTemplate();
      const std = registry.toProjectStandard(tpl);
      expect(std.id).toBe('std-001');
      expect(std.rules).toHaveLength(1);
      expect(std.rules[0]!.checkConfig['pattern']).toContain('password');
    });
  });

  describe('importTemplates', () => {
    it('should import a single template from JSON', () => {
      const json = JSON.stringify(makeTemplate({ id: 'imported' }));
      const result = registry.importTemplates(json);
      expect(result.imported).toBe(1);
      expect(registry.size).toBe(1);
    });

    it('should import an array of templates', () => {
      const json = JSON.stringify([
        makeTemplate({ id: 'a' }),
        makeTemplate({ id: 'b' }),
      ]);
      const result = registry.importTemplates(json);
      expect(result.imported).toBe(2);
    });

    it('should skip duplicates by checksum', () => {
      const tpl = makeTemplate({ id: 'dup-check' });
      registry.register(tpl);
      const json = JSON.stringify(tpl);
      const result = registry.importTemplates(json);
      expect(result.skipped).toBe(1);
    });

    it('should return errors for invalid JSON', () => {
      const result = registry.importTemplates('not json');
      expect(result.errors).toHaveLength(1);
    });

    it('should return errors for missing required fields', () => {
      const result = registry.importTemplates(JSON.stringify([{ name: 'incomplete' }]));
      expect(result.errors).toHaveLength(1);
    });

    it('should handle mixed valid/invalid items', () => {
      const json = JSON.stringify([
        makeTemplate({ id: 'valid' }),
        { name: 'invalid' },
        makeTemplate({ id: 'valid2' }),
      ]);
      const result = registry.importTemplates(json);
      expect(result.imported).toBe(2);
      expect(result.errors).toHaveLength(1);
    });

    // Cover the non-array single-object import path (line 154 in source)
    it('should import a single template (not wrapped in array)', () => {
      const tpl = makeTemplate({ id: 'single-obj', name: 'Solo', version: '1.0.0' });
      const json = JSON.stringify(tpl); // Not an array
      const result = registry.importTemplates(json);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
    });
  });

  describe('exportTemplates', () => {
    it('should export as JSON string', () => {
      registry.register(makeTemplate({ id: 'e' }));
      const exported = registry.exportTemplates();
      const parsed = JSON.parse(exported);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('e');
    });

    it('should export empty array when no templates', () => {
      const exported = registry.exportTemplates();
      expect(exported).toBe('[]');
    });
  });

  describe('verifyChecksum', () => {
    it('should return true for valid checksum', () => {
      const tpl = makeTemplate({ id: 'verify' });
      registry.register(tpl);
      const stored = registry.get('verify')!;
      expect(registry.verifyChecksum(stored)).toBe(true);
    });

    it('should return false for tampered template', () => {
      const tpl = makeTemplate({ id: 'tamper' });
      registry.register(tpl);
      const tampered = { ...tpl, name: 'Hacked' };
      expect(registry.verifyChecksum(tampered)).toBe(false);
    });
  });

  describe('getTags', () => {
    it('should return all unique tags', () => {
      registry.register(makeTemplate({ id: 'a', tags: ['security', 'typescript'] }));
      registry.register(makeTemplate({ id: 'b', tags: ['security', 'react'] }));
      const tags = registry.getTags();
      expect(tags).toContain('react');
      expect(tags).toContain('security');
      expect(tags).toContain('typescript');
      expect(tags).toHaveLength(3);
    });

    it('should return sorted tags', () => {
      registry.register(makeTemplate({ id: 'a', tags: ['z', 'a', 'm'] }));
      expect(registry.getTags()).toEqual(['a', 'm', 'z']);
    });

    it('should return empty array when no templates registered', () => {
      expect(registry.getTags()).toEqual([]);
    });
  });

  describe('listByTags — edge cases', () => {
    it('should return empty array when no tags match', () => {
      registry.register(makeTemplate({ id: 'a', tags: ['security'] }));
      expect(registry.listByTags(['nonexistent'])).toEqual([]);
    });

    it('should handle empty tags array', () => {
      registry.register(makeTemplate({ id: 'a', tags: ['security'] }));
      expect(registry.listByTags([])).toEqual([]);
    });

    it('should handle template with empty tags', () => {
      registry.register(makeTemplate({ id: 'a', tags: [] }));
      expect(registry.listByTags(['security'])).toEqual([]);
    });
  });

  describe('search — additional edge cases', () => {
    it('should match when query appears in middle of name', () => {
      registry.register(makeTemplate({ id: 'a', name: 'Advanced Security Rules' }));
      expect(registry.search('security')).toHaveLength(1);
    });

    it('should match when query appears in middle of tag', () => {
      registry.register(makeTemplate({ id: 'a', tags: ['typescript-eslint'] }));
      expect(registry.search('eslint')).toHaveLength(1);
    });

    it('should not return duplicates when query matches both name and tag', () => {
      registry.register(makeTemplate({ id: 'a', name: 'security', tags: ['security'] }));
      expect(registry.search('security')).toHaveLength(1);
    });
  });

  describe('register — version tracking', () => {
    it('should increment version when re-registering same id', () => {
      registry.register(makeTemplate({ id: 'v1', version: '1.0.0' }));
      registry.register(makeTemplate({ id: 'v1', version: '2.0.0' }));
      const stored = registry.get('v1');
      expect(stored).toBeDefined();
      expect(stored!.version).toBe('2.0.0');
    });

    it('should preserve provided checksum', () => {
      const tpl = makeTemplate({ id: 'chk', checksum: 'custom-checksum-1' });
      registry.register(tpl);
      const stored = registry.get('chk');
      expect(stored!.checksum).toBe('custom-checksum-1');
    });
  });

  describe('toProjectStandard — category fallback', () => {
    it('should use tags[0] as category', () => {
      const tpl = makeTemplate({ id: 'cat-test', tags: ['performance', 'optimization'] });
      const std = registry.toProjectStandard(tpl);
      expect(std.category).toBe('performance');
    });

    it('should default category to code-quality when tags are empty', () => {
      const tpl = makeTemplate({ id: 'no-tags', tags: [] });
      const std = registry.toProjectStandard(tpl);
      // tags[0] ?? 'code-quality' → 'code-quality' when tags is empty
      expect(std.category).toBe('code-quality');
    });

    it('should convert template with multiple rules to project standard', () => {
      const tpl = makeTemplate({
        id: 'multi-rule',
        rules: [
          { id: 'r1', name: 'Rule 1', description: 'D1', category: 'sec', severity: 'high', pattern: 'p1', suggestion: 's1', appliesTo: ['*.ts'] },
          { id: 'r2', name: 'Rule 2', description: 'D2', category: 'style', severity: 'low', pattern: 'p2', suggestion: 's2', appliesTo: ['*.js'] },
        ],
      });
      const std = registry.toProjectStandard(tpl);
      expect(std.rules).toHaveLength(2);
      expect(std.rules[0]!.id).toBe('r1');
      expect(std.rules[1]!.id).toBe('r2');
    });
  });

  describe('importTemplates — duplicate handling', () => {
    it('should import template with updated content when checksum differs', () => {
      const tpl1 = makeTemplate({ id: 'update-test', name: 'V1', checksum: 'aaa' });
      registry.register(tpl1);
      const tpl2 = makeTemplate({ id: 'update-test', name: 'V2', checksum: '' }); // Auto-compute different checksum
      const json = JSON.stringify(tpl2);
      const result = registry.importTemplates(json);
      expect(result.imported).toBe(1);
      expect(registry.get('update-test')!.name).toBe('V2');
    });

    it('should handle non-array item without required fields', () => {
      const result = registry.importTemplates(JSON.stringify({ id: 'bare' }));
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('importTemplates — existing template with different checksum', () => {
    it('should re-import when existing template has different checksum', () => {
      // Register a template with a known checksum
      const tpl1 = makeTemplate({ id: 'reimport', name: 'Original', checksum: 'old-checksum-here' });
      registry.register(tpl1);

      // Import a modified version (auto-computed checksum will differ)
      const tpl2 = makeTemplate({ id: 'reimport', name: 'Updated' });
      // Remove checksum so it gets auto-computed
      const result = registry.importTemplates(JSON.stringify(tpl2));

      expect(result.imported).toBe(1);
      expect(registry.get('reimport')!.name).toBe('Updated');
    });

    it('should handle import when checksum matches exactly', () => {
      const tpl = makeTemplate({ id: 'match', name: 'Same', checksum: '' });
      registry.register(tpl);
      const stored = registry.get('match')!;
      // Re-import with same checksum
      const result = registry.importTemplates(JSON.stringify({ ...tpl, checksum: stored.checksum }));
      expect(result.skipped).toBe(1);
    });
  });

  describe('search — comprehensive matching', () => {
    it('should match when query appears in description but not name or tags', () => {
      registry.register(makeTemplate({
        id: 'desc-only',
        name: 'Helper',
        description: 'Contains specificKeyword for testing purposes',
        tags: ['misc'],
      }));
      expect(registry.search('specificKeyword')).toHaveLength(1);
    });

    it('should match when query appears in tags but not name or description', () => {
      registry.register(makeTemplate({
        id: 'tag-only',
        name: 'Helper',
        description: 'Some description here',
        tags: ['uniqueTag123'],
      }));
      expect(registry.search('uniqueTag123')).toHaveLength(1);
    });

    it('should match when query appears only in name', () => {
      registry.register(makeTemplate({
        id: 'name-only',
        name: 'MyUniqueFunction',
        description: 'Some description',
        tags: ['misc'],
      }));
      expect(registry.search('MyUniqueFunction')).toHaveLength(1);
    });
  });
});
