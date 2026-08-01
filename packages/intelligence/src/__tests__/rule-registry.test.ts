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
  });

  describe('exportTemplates', () => {
    it('should export as JSON string', () => {
      registry.register(makeTemplate({ id: 'e' }));
      const exported = registry.exportTemplates();
      const parsed = JSON.parse(exported);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('e');
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
  });
});
