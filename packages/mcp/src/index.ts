// @code-analyzer/mcp — Public API
// MCP Server, Cypher Engine, and Agent Skills Installer

// MCP Server
export { CodeAnalyzerMCPServer } from './server/mcp-server.js';

// Tool Registry & Tools
export { ToolRegistry, createToolRegistry, ToolContextImpl } from './tools/index.js';
export type { ToolResult, ToolHandler, RegisteredTool, ToolContext, GraphStats, DependencyTreeNode } from './tools/index.js';
export { makeSchema } from './tools/registry.js';

// Cypher Engine
export {
  tokenize,
  parse,
  plan,
  execute,
  buildFilterPredicate,
  DEFAULT_SCHEMA,
} from './cypher/index.js';
export type {
  CypherQuery,
  WithClause,
  GraphSchema,
  QueryPlan,
  ColumnDef,
  PlanStep,
  StepKind,
  QueryResult,
} from './cypher/index.js';

// Resources
export { registerResources } from './resources/index.js';

// Prompts
export { registerPrompts } from './prompts/index.js';

// Middleware
export {
  AuthMiddleware,
  RateLimiter,
  ToolPolicy,
  RequestLogger,
} from './middleware/index.js';
export type {
  AuthResult,
  RateLimitResult,
  LogEntry,
} from './middleware/index.js';

// Agent Skills Installer
export { SkillInstaller } from './skills/installer.js';
export type { InstallResult } from './skills/installer.js';
