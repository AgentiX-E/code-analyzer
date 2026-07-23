// @code-analyzer/vscode — Config Provider Tests

import { describe, it, expect } from 'vitest';
import { ConfigLogic, generateConfigHtml } from '../providers/config-provider.js';
import { ConfigService } from '../services/config-service.js';
import type { WorkspaceConfiguration } from '../services/vscode-api.js';

function mockConfig(overrides?: Record<string, unknown>): WorkspaceConfiguration {
  return {
    get<T>(section: string): T | undefined {
      return overrides?.[section] as T | undefined;
    },
    getDefault<T>(_section: string, defaultValue: T): T {
      return defaultValue;
    },
  };
}

describe('ConfigLogic', () => {
  describe('getConfig', () => {
    it('returns default config', () => {
      const svc = new ConfigService(mockConfig());
      const logic = new ConfigLogic(svc);
      const config = logic.getConfig();
      expect(config.autoIndex).toBe(true);
      expect(config.indexMode).toBe('full');
    });

    it('returns configured values', () => {
      const svc = new ConfigService(mockConfig({ autoIndex: false, indexMode: 'fast' }));
      const logic = new ConfigLogic(svc);
      const config = logic.getConfig();
      expect(config.autoIndex).toBe(false);
      expect(config.indexMode).toBe('fast');
    });
  });

  describe('validate', () => {
    it('accepts valid config', () => {
      const svc = new ConfigService(mockConfig());
      const logic = new ConfigLogic(svc);
      const errors = logic.validate({ maxFileSize: 5242880 });
      expect(errors).toEqual([]);
    });

    it('rejects invalid config', () => {
      const svc = new ConfigService(mockConfig());
      const logic = new ConfigLogic(svc);
      const errors = logic.validate({ maxFileSize: -1 });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('getDefaults', () => {
    it('returns default config', () => {
      const svc = new ConfigService(mockConfig());
      const logic = new ConfigLogic(svc);
      const defaults = logic.getDefaults();
      expect(defaults.autoIndex).toBe(true);
    });
  });
});

describe('generateConfigHtml', () => {
  const config = ConfigService.getDefaults();

  it('returns a string', () => {
    const html = generateConfigHtml(config);
    expect(typeof html).toBe('string');
  });

  it('contains DOCTYPE', () => {
    const html = generateConfigHtml(config);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('contains config form', () => {
    const html = generateConfigHtml(config);
    expect(html).toContain('id="config-form"');
    expect(html).toContain('id="autoIndex"');
    expect(html).toContain('id="indexMode"');
    expect(html).toContain('id="maxFileSize"');
    expect(html).toContain('id="reviewOnSave"');
    expect(html).toContain('id="showInlineDecorations"');
    expect(html).toContain('id="maxSearchResults"');
  });

  it('contains save and reset buttons', () => {
    const html = generateConfigHtml(config);
    expect(html).toContain('saveConfig()');
    expect(html).toContain('resetConfig()');
  });

  it('contains acquireVsCodeApi', () => {
    const html = generateConfigHtml(config);
    expect(html).toContain('acquireVsCodeApi');
  });

  it('contains formatBytes helper', () => {
    const html = generateConfigHtml(config);
    expect(html).toContain('function formatBytes');
  });

  it('has closing tags', () => {
    const html = generateConfigHtml(config);
    expect(html).toContain('</html>');
    expect(html).toContain('</body>');
  });

  it('is consistent across calls', () => {
    const html1 = generateConfigHtml(config);
    const html2 = generateConfigHtml(config);
    expect(html1).toBe(html2);
  });

  it('renders with custom config values', () => {
    const custom = ConfigService.withDefaults({ indexMode: 'fast', maxSearchResults: 50 });
    const html = generateConfigHtml(custom);
    expect(html).toContain('value="fast"');
    expect(html).toContain('value="50"');
  });

  it('renders unchecked checkboxes correctly', () => {
    const custom = ConfigService.withDefaults({ autoIndex: false, reviewOnSave: false });
    const html = generateConfigHtml(custom);
    expect(html).not.toContain('autoIndex" checked');
  });

  it('renders moderate index mode selected correctly', () => {
    const custom = ConfigService.withDefaults({ indexMode: 'moderate' });
    const html = generateConfigHtml(custom);
    expect(html).toContain('value="moderate" selected');
  });

  it('renders fast index mode selected correctly', () => {
    const custom = ConfigService.withDefaults({ indexMode: 'fast' });
    const html = generateConfigHtml(custom);
    expect(html).toContain('value="fast" selected');
  });

  it('renders showInlineDecorations unchecked', () => {
    const custom = ConfigService.withDefaults({ showInlineDecorations: false });
    const html = generateConfigHtml(custom);
    expect(html).not.toContain('showInlineDecorations" checked');
  });

  it('renders maxSearchResults with correct value', () => {
    const custom = ConfigService.withDefaults({ maxSearchResults: 50 });
    const html = generateConfigHtml(custom);
    expect(html).toContain('value="50"');
  });

  it('handles maxFileSize of zero bytes', () => {
    const custom = ConfigService.withDefaults({ maxFileSize: 0 });
    const html = generateConfigHtml(custom);
    expect(html).toContain('value="0"');
    expect(html).toContain('0 Bytes');
  });
});
