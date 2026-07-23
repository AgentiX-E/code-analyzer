import { describe, it, expect, beforeEach } from 'vitest';

import {
  DEFAULT_MESSAGES,
  DefaultTranslator,
  getTranslator,
  setTranslator,
  resetTranslator,
} from '../i18n/index.js';

import type { Translator } from '../i18n/index.js';

describe('DEFAULT_MESSAGES', () => {
  it('should contain config-related keys', () => {
    expect(DEFAULT_MESSAGES['config.loading']).toBeDefined();
    expect(DEFAULT_MESSAGES['config.loaded']).toBeDefined();
    expect(DEFAULT_MESSAGES['config.loadFailed']).toBeDefined();
    expect(DEFAULT_MESSAGES['config.invalid']).toBeDefined();
  });

  it('should contain lifecycle-related keys', () => {
    expect(DEFAULT_MESSAGES['lifecycle.init']).toBeDefined();
    expect(DEFAULT_MESSAGES['lifecycle.shutdown']).toBeDefined();
    expect(DEFAULT_MESSAGES['lifecycle.healthCheck']).toBeDefined();
    expect(DEFAULT_MESSAGES['lifecycle.shutdownTimeout']).toBeDefined();
    expect(DEFAULT_MESSAGES['lifecycle.circularDependency']).toBeDefined();
  });

  it('should contain logging-related keys', () => {
    expect(DEFAULT_MESSAGES['logging.initialized']).toBeDefined();
    expect(DEFAULT_MESSAGES['logging.fileTransport']).toBeDefined();
  });

  it('should contain error-related keys', () => {
    expect(DEFAULT_MESSAGES['errors.generic']).toBeDefined();
    expect(DEFAULT_MESSAGES['errors.configError']).toBeDefined();
    expect(DEFAULT_MESSAGES['errors.ioError']).toBeDefined();
    expect(DEFAULT_MESSAGES['errors.parseError']).toBeDefined();
    expect(DEFAULT_MESSAGES['errors.resolutionError']).toBeDefined();
    expect(DEFAULT_MESSAGES['errors.graphIntegrityError']).toBeDefined();
    expect(DEFAULT_MESSAGES['errors.embeddingError']).toBeDefined();
    expect(DEFAULT_MESSAGES['errors.llmProviderError']).toBeDefined();
    expect(DEFAULT_MESSAGES['errors.mcpProtocolError']).toBeDefined();
    expect(DEFAULT_MESSAGES['errors.rateLimitError']).toBeDefined();
  });

  it('should contain metrics-related keys', () => {
    expect(DEFAULT_MESSAGES['metrics.counter']).toBeDefined();
    expect(DEFAULT_MESSAGES['metrics.histogram']).toBeDefined();
    expect(DEFAULT_MESSAGES['metrics.gauge']).toBeDefined();
  });

  it('should contain defaults_maxFiles as number', () => {
    expect(typeof DEFAULT_MESSAGES['defaults_maxFiles']).toBe('number');
    expect(DEFAULT_MESSAGES['defaults_maxFiles']).toBe(50000);
  });
});

describe('DefaultTranslator', () => {
  let translator: DefaultTranslator;

  beforeEach(() => {
    translator = new DefaultTranslator('en');
  });

  it('should have locale "en"', () => {
    expect(translator.locale).toBe('en');
  });

  it('should translate a key without parameters', () => {
    const result = translator.t('config.loading');
    expect(result).toBe('Loading configuration...');
  });

  it('should interpolate template variables', () => {
    const result = translator.t('config.loadFailed', { error: 'ENOENT' });
    expect(result).toContain('ENOENT');
    expect(result).not.toContain('{error}');
  });

  it('should interpolate numeric parameters', () => {
    const result = translator.t('config.validationFailed', { count: 5 });
    expect(result).toContain('5');
  });

  it('should return key itself if no translation exists', () => {
    const result = translator.t('nonexistent.key');
    expect(result).toBe('nonexistent.key');
  });

  it('should check if key exists via hasKey', () => {
    expect(translator.hasKey('config.loading')).toBe(true);
    expect(translator.hasKey('nonexistent.key')).toBe(false);
  });

  it('should handle multiple interpolation parameters', () => {
    const result = translator.t('lifecycle.init', { component: 'InMemoryGraphStore' });
    expect(result).toContain('InMemoryGraphStore');
    expect(result).not.toContain('{component}');
  });

  it('should keep unresolved placeholders as-is', () => {
    const result = translator.t('config.loadFailed', {});
    expect(result).toContain('{error}');
  });

  it('should get all keys', () => {
    const keys = translator.getKeys();
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain('config.loading');
    expect(keys).toContain('lifecycle.init');
  });

  it('should default to "en" when no locale specified', () => {
    const t = new DefaultTranslator();
    expect(t.locale).toBe('en');
    expect(t.t('config.loading')).toBe('Loading configuration...');
  });

  it('should fallback to English for unsupported locales', () => {
    translator.loadLocale('fr');
    expect(translator.t('config.loading')).toBe('Loading configuration...');
  });
});

describe('Shared translator singleton', () => {
  beforeEach(() => {
    resetTranslator();
  });

  it('should create a translator on first call', () => {
    const t = getTranslator();
    expect(t).toBeDefined();
    expect(t.locale).toBe('en');
  });

  it('should return the same instance on subsequent calls', () => {
    const t1 = getTranslator();
    const t2 = getTranslator();
    expect(t1).toBe(t2);
  });

  it('should allow setting a custom translator', () => {
    const custom: Translator = {
      locale: 'custom',
      t(key: string, _params?: Record<string, string | number>): string {
        return `[${key}]`;
      },
      hasKey(): boolean {
        return true;
      },
    };
    setTranslator(custom);
    const t = getTranslator();
    expect(t.locale).toBe('custom');
    expect(t.t('hello')).toBe('[hello]');
  });

  it('should reset the translator', () => {
    const t1 = getTranslator();
    resetTranslator();
    const t2 = getTranslator();
    expect(t1).not.toBe(t2);
  });
});
