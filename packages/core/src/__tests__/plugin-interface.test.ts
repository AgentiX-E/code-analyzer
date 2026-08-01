// @code-analyzer/core — Plugin Interface Tests

import { describe, it, expect } from 'vitest';
import { isValidPlugin, getValidationErrors } from '../plugins/plugin-interface.js';
import type { CodeAnalyzerPlugin } from '../plugins/plugin-interface.js';

// ---------------------------------------------------------------------------
// isValidPlugin
// ---------------------------------------------------------------------------

describe('isValidPlugin', () => {
  it('should return true for a valid plugin object', () => {
    const plugin: CodeAnalyzerPlugin = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
    };
    expect(isValidPlugin(plugin)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isValidPlugin(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isValidPlugin(undefined)).toBe(false);
  });

  it('should return false for non-object (number)', () => {
    expect(isValidPlugin(42)).toBe(false);
  });

  it('should return false for non-object (string)', () => {
    expect(isValidPlugin('not-a-plugin')).toBe(false);
  });

  it('should return false when name is missing', () => {
    expect(isValidPlugin({ version: '1.0.0', description: 'desc' })).toBe(false);
  });

  it('should return false when version is missing', () => {
    expect(isValidPlugin({ name: 'test', description: 'desc' })).toBe(false);
  });

  it('should return false when description is missing', () => {
    expect(isValidPlugin({ name: 'test', version: '1.0.0' })).toBe(false);
  });

  it('should return false when name is empty string', () => {
    expect(isValidPlugin({ name: '', version: '1.0.0', description: 'desc' })).toBe(false);
  });

  it('should return true when optional fields are present', () => {
    const plugin = {
      name: 'full-plugin',
      version: '2.0.0',
      description: 'Full plugin',
      author: 'Test Author',
      engineVersion: '1.0.0',
      rules: [],
      lenses: [],
      standards: [],
      mcpTools: [],
    };
    expect(isValidPlugin(plugin)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getValidationErrors
// ---------------------------------------------------------------------------

describe('getValidationErrors', () => {
  it('should return empty array for valid plugin', () => {
    const plugin = { name: 'p', version: '1.0.0', description: 'd' };
    expect(getValidationErrors(plugin)).toEqual([]);
  });

  it('should return error for null', () => {
    expect(getValidationErrors(null)[0]).toContain('non-null');
  });

  it('should return error for non-object', () => {
    expect(getValidationErrors('string')[0]).toContain('non-null');
  });

  it('should list all missing required fields', () => {
    const errors = getValidationErrors({});
    expect(errors).toHaveLength(3);
    expect(errors.some((e) => e.includes('name'))).toBe(true);
    expect(errors.some((e) => e.includes('version'))).toBe(true);
    expect(errors.some((e) => e.includes('description'))).toBe(true);
  });

  it('should flag empty string as missing', () => {
    const errors = getValidationErrors({ name: '', version: '1.0.0', description: 'd' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('name');
  });
});
