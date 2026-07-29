// @code-analyzer/core — Plugin Interface
// Community-contributed plugins can provide custom rules, review lenses,
// standards checks, and MCP tools.

// ---------------------------------------------------------------------------
// Plugin Standard
// ---------------------------------------------------------------------------

/** A community-contributed standard/check definition. */
export interface PluginStandard {
  id: string;
  name: string;
  description: string;
  /** Language(s) the standard applies to (empty = all). */
  languages?: string[];
  /** Severity of violations. */
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  /** Check function — return violations found. */
  check: (node: unknown, context: unknown) => PluginStandardViolation[];
}

/** A single violation from a standard check. */
export interface PluginStandardViolation {
  filePath: string;
  line: number;
  message: string;
  ruleId: string;
  suggestion?: string;
}

// ---------------------------------------------------------------------------
// Plugin Rule
// ---------------------------------------------------------------------------

/** Result of a custom plugin rule check. */
export interface PluginRuleResult {
  filePath: string;
  line: number;
  message: string;
  suggestion?: string;
}

/** A custom analysis rule contributed by a plugin. */
export interface PluginRule {
  id: string;
  name: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  check: (node: unknown, context: unknown) => PluginRuleResult | null;
}

// ---------------------------------------------------------------------------
// Plugin Lens Finding
// ---------------------------------------------------------------------------

/** Result of a plugin lens scan. */
export interface PluginLensFinding {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  suggestion?: string;
  codeSnippet?: string;
}

/** A custom review lens contributed by a plugin. */
export interface PluginLens {
  id: string;
  name: string;
  description: string;
  scan(diff: unknown, context: unknown): PluginLensFinding[];
}

// ---------------------------------------------------------------------------
// Plugin MCP Tool
// ---------------------------------------------------------------------------

/** An MCP tool contributed by a plugin. */
export interface PluginMCPTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, store?: unknown) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// CodeAnalyzerPlugin
// ---------------------------------------------------------------------------

/**
 * The main plugin interface.
 *
 * Community plugins implement this interface and export it as their default
 * export or as a named `plugin` export.
 */
export interface CodeAnalyzerPlugin {
  /** Unique plugin name (e.g. "@my-org/code-analyzer-plugin-security") */
  readonly name: string;
  /** Semver version string. */
  readonly version: string;
  /** Human-readable description. */
  readonly description: string;

  /** Called when the plugin is loaded. */
  onLoad?(): void | Promise<void>;

  /** Called when the plugin is unloaded. */
  onUnload?(): void | Promise<void>;

  /** Custom analysis rules. */
  rules?: PluginRule[];

  /** Custom review lenses. */
  lenses?: PluginLens[];

  /** Custom standards. */
  standards?: PluginStandard[];

  /** Custom MCP tools. */
  mcpTools?: PluginMCPTool[];
}
