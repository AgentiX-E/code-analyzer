// @code-analyzer/vscode — Configuration Service
// Manages VS Code extension configuration with typed defaults.

import type { WorkspaceConfiguration } from './vscode-api.js';

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

export interface CodeAnalyzerConfig {
  autoIndex: boolean;
  indexMode: 'full' | 'moderate' | 'fast';
  maxFileSize: number;
  excludePatterns: string[];
  reviewOnSave: boolean;
  showInlineDecorations: boolean;
  maxSearchResults: number;
}

const DEFAULT_CONFIG: CodeAnalyzerConfig = {
  autoIndex: true,
  indexMode: 'full',
  maxFileSize: 10485760, // 10 MB
  excludePatterns: ['node_modules/**', 'dist/**', '.git/**', 'build/**'],
  reviewOnSave: false,
  showInlineDecorations: true,
  maxSearchResults: 20,
};

// ---------------------------------------------------------------------------
// ConfigService
// ---------------------------------------------------------------------------

export class ConfigService {
  constructor(
    private vsConfig: WorkspaceConfiguration,
    private defaults: CodeAnalyzerConfig = DEFAULT_CONFIG,
  ) {}

  /** Get a single configuration value with type safety. */
  get<K extends keyof CodeAnalyzerConfig>(key: K): CodeAnalyzerConfig[K] {
    return this.vsConfig.get<CodeAnalyzerConfig[K]>(key) ?? this.defaults[key];
  }

  /** Get all configuration values. */
  getAll(): CodeAnalyzerConfig {
    return {
      autoIndex: this.get('autoIndex'),
      indexMode: this.get('indexMode'),
      maxFileSize: this.get('maxFileSize'),
      excludePatterns: this.get('excludePatterns'),
      reviewOnSave: this.get('reviewOnSave'),
      showInlineDecorations: this.get('showInlineDecorations'),
      maxSearchResults: this.get('maxSearchResults'),
    };
  }

  /** Get default configuration (useful for UI display). */
  static getDefaults(): CodeAnalyzerConfig {
    return { ...DEFAULT_CONFIG };
  }

  /** Validate configuration values. Returns list of error messages. */
  static validate(config: Partial<CodeAnalyzerConfig>): string[] {
    const errors: string[] = [];

    if (config.indexMode !== undefined) {
      if (!['full', 'moderate', 'fast'].includes(config.indexMode)) {
        errors.push(
          `Invalid indexMode: "${config.indexMode}". Must be "full", "moderate", or "fast".`,
        );
      }
    }

    if (config.maxFileSize !== undefined) {
      if (config.maxFileSize <= 0) {
        errors.push(
          `maxFileSize must be positive, got ${config.maxFileSize}`,
        );
      }
      if (config.maxFileSize > 1073741824) {
        // 1 GB
        errors.push(`maxFileSize cannot exceed 1 GB`);
      }
    }

    if (config.maxSearchResults !== undefined) {
      if (config.maxSearchResults <= 0) {
        errors.push(
          `maxSearchResults must be positive, got ${config.maxSearchResults}`,
        );
      }
      if (config.maxSearchResults > 100) {
        errors.push(`maxSearchResults cannot exceed 100`);
      }
    }

    return errors;
  }

  /** Apply a partial configuration over the defaults. */
  static withDefaults(partial: Partial<CodeAnalyzerConfig>): CodeAnalyzerConfig {
    return { ...DEFAULT_CONFIG, ...partial };
  }
}
