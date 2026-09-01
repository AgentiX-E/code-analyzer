// @code-analyzer/vscode — Configuration Service
// Manages VS Code extension configuration with typed defaults and profiles.

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
  profile: 'strict' | 'balanced' | 'relaxed';
}

const DEFAULT_CONFIG: CodeAnalyzerConfig = {
  autoIndex: true,
  indexMode: 'full',
  maxFileSize: 10485760, // 10 MB
  excludePatterns: ['node_modules/**', 'dist/**', '.git/**', 'build/**'],
  reviewOnSave: false,
  showInlineDecorations: true,
  maxSearchResults: 20,
  profile: 'balanced',
};

// ---------------------------------------------------------------------------
// Configuration Profiles
//
// Pre-built configurations that set multiple settings at once:
//   - strict:   maximum depth, all review lenses, critical feedback
//   - balanced: standard depth, key lenses (recommended default)
//   - relaxed:  fast analysis, minimal feedback, focus on critical issues
// ---------------------------------------------------------------------------

export interface ProfileDefinition {
  label: string;
  description: string;
  overrides: Partial<CodeAnalyzerConfig>;
}

export const PROFILES: Record<CodeAnalyzerConfig['profile'], ProfileDefinition> = {
  strict: {
    label: 'Strict',
    description:
      'Maximum analysis depth, all review lenses, warn on everything. Best for mission-critical codebases.',
    overrides: {
      autoIndex: true,
      indexMode: 'full',
      maxFileSize: 52428800, // 50 MB
      reviewOnSave: true,
      showInlineDecorations: true,
      maxSearchResults: 100,
    },
  },
  balanced: {
    label: 'Balanced',
    description: 'Standard analysis depth, key review lenses. Recommended for most projects.',
    overrides: {
      autoIndex: true,
      indexMode: 'full',
      maxFileSize: 10485760, // 10 MB
      reviewOnSave: false,
      showInlineDecorations: true,
      maxSearchResults: 20,
    },
  },
  relaxed: {
    label: 'Relaxed',
    description: 'Fast analysis, minimal review comments. Focus on critical issues only.',
    overrides: {
      autoIndex: false,
      indexMode: 'fast',
      maxFileSize: 1048576, // 1 MB
      reviewOnSave: false,
      showInlineDecorations: false,
      maxSearchResults: 10,
    },
  },
};

// ---------------------------------------------------------------------------
// ConfigService
// ---------------------------------------------------------------------------

export class ConfigService {
  constructor(
    private vsConfig: WorkspaceConfiguration,
    private defaults: CodeAnalyzerConfig = DEFAULT_CONFIG,
  ) {}

  /**
   * Get a single configuration value with type safety.
   *
   * Resolution order (highest priority first):
   *   1. Explicit user configuration — a value the user set directly always
   *      wins over any profile preset.
   *   2. Active profile override — applied only when the key was NOT
   *      explicitly configured.
   *   3. Built-in defaults — lowest priority.
   */
  get<K extends keyof CodeAnalyzerConfig>(key: K): CodeAnalyzerConfig[K] {
    // 1. Explicit user configuration always wins
    const explicit = this.vsConfig.get<CodeAnalyzerConfig[K]>(key);
    if (explicit !== undefined) {
      return explicit;
    }

    // 2. Fall back to the active profile's override (key not explicitly set)
    const currentProfile =
      this.vsConfig.get<CodeAnalyzerConfig['profile']>('profile') ?? this.defaults.profile;
    const profileDef = PROFILES[currentProfile];
    if (profileDef && key in profileDef.overrides) {
      return profileDef.overrides[
        key as keyof typeof profileDef.overrides
      ] as CodeAnalyzerConfig[K];
    }

    // 3. Fall back to built-in defaults
    return this.defaults[key];
  }

  /** Get the current active profile definition. */
  getCurrentProfile(): ProfileDefinition {
    const profileKey =
      this.vsConfig.get<CodeAnalyzerConfig['profile']>('profile') ?? this.defaults.profile;
    return PROFILES[profileKey] ?? PROFILES['balanced'];
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
      profile: this.get('profile'),
    };
  }

  /** Get all available profiles. */
  static getProfiles(): Record<string, ProfileDefinition> {
    return { ...PROFILES };
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
        errors.push(`maxFileSize must be positive, got ${config.maxFileSize}`);
      }
      if (config.maxFileSize > 1073741824) {
        errors.push(`maxFileSize cannot exceed 1 GB`);
      }
    }

    if (config.maxSearchResults !== undefined) {
      if (config.maxSearchResults <= 0) {
        errors.push(`maxSearchResults must be positive, got ${config.maxSearchResults}`);
      }
      if (config.maxSearchResults > 100) {
        errors.push(`maxSearchResults cannot exceed 100`);
      }
    }

    if (config.profile !== undefined) {
      if (!['strict', 'balanced', 'relaxed'].includes(config.profile)) {
        errors.push(
          `Invalid profile: "${config.profile}". Must be "strict", "balanced", or "relaxed".`,
        );
      }
    }

    return errors;
  }

  /** Apply a partial configuration over the defaults. */
  static withDefaults(partial: Partial<CodeAnalyzerConfig>): CodeAnalyzerConfig {
    return { ...DEFAULT_CONFIG, ...partial };
  }
}
