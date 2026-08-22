// @code-analyzer/core — Plugin Interface
// Type definitions for the code-analyzer plugin system.
// Plugins can contribute analysis rules, review lenses, project standards,
// and MCP tools without modifying core code.

import type { ReviewCategory, Severity } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Plugin Rule Types
// ---------------------------------------------------------------------------

export interface PluginRuleResult {
  passed: boolean;
  message: string;
  lineNumber?: number;
  filePath?: string;
  suggestion?: string;
}

export interface PluginRuleContext {
  nodeName: string;
  nodeType: string;
  filePath: string;
  language: string;
  sourceCode: string;
  lineNumber: number;
  projectId: string;
}

export interface PluginRule {
  id: string;
  name: string;
  category: ReviewCategory;
  severity: Severity;
  description: string;
  check(context: PluginRuleContext): PluginRuleResult | null;
}

// ---------------------------------------------------------------------------
// Plugin Lens Types
// ---------------------------------------------------------------------------

export interface PluginLensFinding {
  filePath: string;
  startLine: number;
  endLine: number;
  message: string;
  severity: Severity;
  category: ReviewCategory;
  suggestion?: string;
}

export interface PluginLensContext {
  diff: {
    filePath: string;
    beforeContent: string;
    afterContent: string;
    language: string;
  };
  projectId: string;
}

export interface PluginLens {
  id: string;
  name: string;
  description: string;
  scan(context: PluginLensContext): PluginLensFinding[];
}

// ---------------------------------------------------------------------------
// Plugin Standard Types
// ---------------------------------------------------------------------------

export interface PluginStandard {
  id: string;
  name: string;
  category: string;
  rules: PluginRule[];
}

// ---------------------------------------------------------------------------
// Plugin MCP Tool Types
// ---------------------------------------------------------------------------

export interface PluginMCPTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler(
    args: Record<string, unknown>,
    store?: unknown,
  ): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Plugin Lifecycle
// ---------------------------------------------------------------------------

export interface CodeAnalyzerPlugin {
  /** Unique plugin identifier (npm-style: @scope/name) */
  readonly name: string;
  /** Semantic version */
  readonly version: string;
  /** Human-readable description */
  readonly description: string;
  /** Author information */
  readonly author?: string;
  /** Minimum code-analyzer version required */
  readonly engineVersion?: string;

  /** Called when plugin is loaded */
  onLoad?(): void | Promise<void>;
  /** Called when plugin is unloaded */
  onUnload?(): void | Promise<void>;

  /** Custom analysis rules contributed by this plugin */
  rules?: PluginRule[];
  /** Custom review lenses contributed by this plugin */
  lenses?: PluginLens[];
  /** Custom project standards contributed by this plugin */
  standards?: PluginStandard[];
  /** Custom MCP tools contributed by this plugin */
  mcpTools?: PluginMCPTool[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const REQUIRED_PLUGIN_FIELDS = ['name', 'version', 'description'] as const;

export function isValidPlugin(obj: unknown): obj is CodeAnalyzerPlugin {
  if (!obj || typeof obj !== 'object') return false;
  const plugin = obj as Record<string, unknown>;
  return REQUIRED_PLUGIN_FIELDS.every(
    (field) => typeof plugin[field] === 'string' && (plugin[field] as string).length > 0,
  );
}

export function getValidationErrors(obj: unknown): string[] {
  const errors: string[] = [];
  if (!obj || typeof obj !== 'object') {
    errors.push('Plugin must be a non-null object');
    return errors;
  }
  const plugin = obj as Record<string, unknown>;
  for (const field of REQUIRED_PLUGIN_FIELDS) {
    if (typeof plugin[field] !== 'string' || (plugin[field] as string).length === 0) {
      errors.push(`Missing required field: "${field}"`);
    }
  }
  return errors;
}
