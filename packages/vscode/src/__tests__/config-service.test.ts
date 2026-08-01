// @code-analyzer/vscode — Config Service Tests

import { describe, it, expect } from 'vitest';
import { ConfigService } from '../services/config-service.js';
import type { WorkspaceConfiguration } from '../services/vscode-api.js';

function createMockConfig(
  overrides?: Record<string, unknown>,
): WorkspaceConfiguration {
  return {
    get<T>(section: string): T | undefined {
      return overrides?.[section] as T | undefined;
    },
    getDefault<T>(_section: string, defaultValue: T): T {
      return defaultValue;
    },
  };
}

describe('ConfigService', () => {
  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('returns default autoIndex when not configured', () => {
      const svc = new ConfigService(createMockConfig());
      expect(svc.get('autoIndex')).toBe(true);
    });

    it('returns configured autoIndex when set', () => {
      const svc = new ConfigService(createMockConfig({ autoIndex: false }));
      expect(svc.get('autoIndex')).toBe(false);
    });

    it('returns default indexMode when not configured', () => {
      const svc = new ConfigService(createMockConfig());
      expect(svc.get('indexMode')).toBe('full');
    });

    it('returns configured indexMode', () => {
      const svc = new ConfigService(createMockConfig({ indexMode: 'fast' }));
      expect(svc.get('indexMode')).toBe('fast');
    });

    it('returns default maxFileSize (10 MB) when not configured', () => {
      const svc = new ConfigService(createMockConfig());
      expect(svc.get('maxFileSize')).toBe(10485760);
    });

    it('returns configured maxFileSize', () => {
      const svc = new ConfigService(createMockConfig({ maxFileSize: 5242880 }));
      expect(svc.get('maxFileSize')).toBe(5242880);
    });

    it('returns default excludePatterns when not configured', () => {
      const svc = new ConfigService(createMockConfig());
      const patterns = svc.get('excludePatterns');
      expect(patterns).toContain('node_modules/**');
      expect(patterns).toContain('dist/**');
    });

    it('returns configured excludePatterns', () => {
      const svc = new ConfigService(
        createMockConfig({ excludePatterns: ['src/**'] }),
      );
      expect(svc.get('excludePatterns')).toEqual(['src/**']);
    });

    it('returns default reviewOnSave', () => {
      const svc = new ConfigService(createMockConfig());
      expect(svc.get('reviewOnSave')).toBe(false);
    });

    it('returns configured reviewOnSave', () => {
      const svc = new ConfigService(createMockConfig({ reviewOnSave: true }));
      expect(svc.get('reviewOnSave')).toBe(true);
    });

    it('returns default showInlineDecorations', () => {
      const svc = new ConfigService(createMockConfig());
      expect(svc.get('showInlineDecorations')).toBe(true);
    });

    it('returns configured showInlineDecorations', () => {
      const svc = new ConfigService(
        createMockConfig({ showInlineDecorations: false }),
      );
      expect(svc.get('showInlineDecorations')).toBe(false);
    });

    it('returns default maxSearchResults', () => {
      const svc = new ConfigService(createMockConfig());
      expect(svc.get('maxSearchResults')).toBe(20);
    });

    it('returns configured maxSearchResults', () => {
      const svc = new ConfigService(
        createMockConfig({ maxSearchResults: 50 }),
      );
      expect(svc.get('maxSearchResults')).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // getAll
  // -------------------------------------------------------------------------

  describe('getAll', () => {
    it('returns all defaults when nothing configured', () => {
      const svc = new ConfigService(createMockConfig());
      const all = svc.getAll();
      expect(all.autoIndex).toBe(true);
      expect(all.indexMode).toBe('full');
      expect(all.maxFileSize).toBe(10485760);
      expect(all.reviewOnSave).toBe(false);
      expect(all.showInlineDecorations).toBe(true);
      expect(all.maxSearchResults).toBe(20);
    });

    it('merges configured values with defaults', () => {
      const svc = new ConfigService(
        createMockConfig({ indexMode: 'fast', maxSearchResults: 10 }),
      );
      const all = svc.getAll();
      expect(all.indexMode).toBe('fast');
      expect(all.maxSearchResults).toBe(10);
      expect(all.autoIndex).toBe(true); // default
    });
  });

  // -------------------------------------------------------------------------
  // getDefaults (static)
  // -------------------------------------------------------------------------

  describe('getDefaults', () => {
    it('returns default config', () => {
      const defaults = ConfigService.getDefaults();
      expect(defaults.autoIndex).toBe(true);
      expect(defaults.indexMode).toBe('full');
      expect(defaults.maxFileSize).toBe(10485760);
    });

    it('returns immutable copy', () => {
      const d1 = ConfigService.getDefaults();
      const d2 = ConfigService.getDefaults();
      d1.autoIndex = false;
      expect(d2.autoIndex).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // validate (static)
  // -------------------------------------------------------------------------

  describe('validate', () => {
    it('accepts a valid full config', () => {
      const errors = ConfigService.validate({
        indexMode: 'full',
        maxFileSize: 5242880,
        maxSearchResults: 10,
      });
      expect(errors).toEqual([]);
    });

    it('accepts a valid moderate config', () => {
      const errors = ConfigService.validate({ indexMode: 'moderate' });
      expect(errors).toEqual([]);
    });

    it('accepts a valid fast config', () => {
      const errors = ConfigService.validate({ indexMode: 'fast' });
      expect(errors).toEqual([]);
    });

    it('rejects invalid indexMode', () => {
      const errors = ConfigService.validate({ indexMode: 'invalid' as any });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('indexMode');
    });

    it('rejects negative maxFileSize', () => {
      const errors = ConfigService.validate({ maxFileSize: -1 });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('maxFileSize');
    });

    it('rejects zero maxFileSize', () => {
      const errors = ConfigService.validate({ maxFileSize: 0 });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects maxFileSize exceeding 1 GB', () => {
      const errors = ConfigService.validate({ maxFileSize: 1073741825 });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects negative maxSearchResults', () => {
      const errors = ConfigService.validate({ maxSearchResults: -5 });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects maxSearchResults exceeding 100', () => {
      const errors = ConfigService.validate({ maxSearchResults: 101 });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts empty partial config', () => {
      const errors = ConfigService.validate({});
      expect(errors).toEqual([]);
    });

    it('accepts maxFileSize exactly at 1 GB', () => {
      const errors = ConfigService.validate({ maxFileSize: 1073741824 });
      expect(errors).toEqual([]);
    });

    it('accepts maxSearchResults exactly at 100', () => {
      const errors = ConfigService.validate({ maxSearchResults: 100 });
      expect(errors).toEqual([]);
    });

    it('returns multiple errors for multiple invalid values', () => {
      const errors = ConfigService.validate({
        indexMode: 'invalid' as any,
        maxFileSize: -1,
        maxSearchResults: 999,
      });
      expect(errors.length).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // withDefaults (static)
  // -------------------------------------------------------------------------

  describe('withDefaults', () => {
    it('merges partial config with defaults', () => {
      const result = ConfigService.withDefaults({ maxSearchResults: 50 });
      expect(result.maxSearchResults).toBe(50);
      expect(result.autoIndex).toBe(true);
      expect(result.indexMode).toBe('full');
    });

    it('returns full defaults when empty partial', () => {
      const result = ConfigService.withDefaults({});
      expect(result).toEqual(ConfigService.getDefaults());
    });
  });

  // -------------------------------------------------------------------------
  // Custom defaults
  // -------------------------------------------------------------------------

  describe('custom defaults', () => {
    it('accepts custom default config', () => {
      const customDefaults = {
        autoIndex: false,
        indexMode: 'fast' as const,
        maxFileSize: 1000,
        excludePatterns: [],
        reviewOnSave: true,
        showInlineDecorations: false,
        maxSearchResults: 5,
      };
      const svc = new ConfigService(createMockConfig(), customDefaults);
      expect(svc.get('autoIndex')).toBe(false);
      expect(svc.get('indexMode')).toBe('fast');
      expect(svc.get('maxSearchResults')).toBe(5);
    });
  });
});
