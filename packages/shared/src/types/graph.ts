// @code-analyzer/shared — Core Graph Types
// These types form the foundation of the entire platform.
// All other packages depend on these type definitions.

// ---------------------------------------------------------------------------
// Node Labels — Every entity in the knowledge graph has exactly one label
// ---------------------------------------------------------------------------

/**
 * All valid node labels in the knowledge graph.
 * Each label represents a distinct type of code entity.
 */
export const NODE_LABELS = [
  'Project',
  'Package',
  'Folder',
  'File',
  'Module',
  'Class',
  'Interface',
  'Function',
  'Method',
  'Constructor',
  'Property',
  'Enum',
  'TypeAlias',
  'Struct',
  'Trait',
  'Variable',
  'Route',
  'Tool',
  'Component',
  'Test',
  'Community',
  'Process',
  'Config',
  'ADR',
  'BasicBlock',
  'InfraResource',
  'CrossRepoFunction',
  'CrossRepoInterface',
  'CrossRepoModule',
  'Contract',
  'Event',
  'DataSource',
  'Sink',
] as const;

/** A node label — determines the type of code entity */
export type NodeLabel = (typeof NODE_LABELS)[number];

// ---------------------------------------------------------------------------
// Relationship Types — Every edge has exactly one type defining its semantics
// ---------------------------------------------------------------------------

export const RELATIONSHIP_TYPES = [
  // Structural
  'CONTAINS',
  'DEFINES',
  'HAS_METHOD',
  'HAS_PROPERTY',
  'MEMBER_OF',
  'BELONGS_TO',
  // Inheritance & Implementation
  'EXTENDS',
  'IMPLEMENTS',
  'METHOD_OVERRIDES',
  'METHOD_IMPLEMENTS',
  // Data & Control Flow
  'CALLS',
  'IMPORTS',
  'ACCESSES',
  'INSTANTIATES',
  'USES_TYPE',
  // Architectural
  'HANDLES_ROUTE',
  'HANDLES_TOOL',
  'EXPOSES',
  'INJECTS',
  // Analytical
  'SIMILAR_TO',
  'SEMANTICALLY_RELATED',
  'TESTS',
  'CHANGES_WITH',
  'DATA_FLOWS',
  'STEP_IN_PROCESS',
  // PDG
  'CFG',
  'REACHING_DEF',
  'TAINTED',
  'SANITIZES',
  'TAINT_PATH',
  // Event
  'EMITS',
  'LISTENS_ON',
  // Config
  'CONFIGURES',
  // Cross-Repo
  'CROSS_REPO_DEPENDS',
  'CROSS_REPO_CALLS',
  'CROSS_REPO_IMPLEMENTS',
  'CROSS_REPO_IMPORTS',
  'CROSS_REPO_EXPOSES',
  'CROSS_REPO_CONTRACT',
] as const;

/** A relationship type — defines the semantic meaning of an edge in the graph */
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

// ---------------------------------------------------------------------------
// Graph Primitives
// ---------------------------------------------------------------------------

/** Properties attached to a graph node — varies by node label */
export interface NodeProperties {
  name: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  language?: string;
  isExported?: boolean;
  signature?: string;
  returnType?: string;
  docstring?: string;
  complexity?: number;
  cognitiveComplexity?: number;
  parameterCount?: number;
  isAsync?: boolean;
  visibility?: 'public' | 'private' | 'protected';
  isAbstract?: boolean;
  isStatic?: boolean;
  isConst?: boolean;
  routePath?: string;
  routeMethod?: string;
  decorators?: string[];
  baseClasses?: string[];
  implementedInterfaces?: string[];
  [key: string]: unknown; // Allow language-specific extensions
}

/** A node in the knowledge graph */
export interface GraphNode {
  id: number;
  projectId: string;
  label: NodeLabel;
  name: string;
  qualifiedName: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  properties: NodeProperties;
  signature: string | null;
  docstring: string | null;
  complexity: number | null;
  isExported: boolean;
  fingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Properties attached to a graph edge */
export interface EdgeProperties {
  lineNumber?: number;
  calleeName?: string;
  args?: string[];
  isAsync?: boolean;
  isConditional?: boolean;
  confidence?: number;
  [key: string]: unknown;
}

/** An edge in the knowledge graph */
export interface GraphEdge {
  id: number;
  projectId: string;
  sourceId: number;
  targetId: number;
  type: RelationshipType;
  properties: EdgeProperties;
  weight: number;
  createdAt: string;
}

/** The complete knowledge graph for a project */
export interface KnowledgeGraph {
  projectId: string;
  nodes: Map<number, GraphNode>;
  edges: Map<number, GraphEdge>;
  /** Qualified name → node ID index */
  qnameIndex: Map<string, number>;
  /** File path → node ID index (for File nodes) */
  fileIndex: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Pipeline Types
// ---------------------------------------------------------------------------

/** Identifiers for all pipeline phases */
export const PIPELINE_PHASE_IDS = [
  'scan',
  'structure',
  'parse',
  'markdown',
  'config',
  'crossFile',
  'scopeResolution',
  'routes',
  'tools',
  'di',
  'pruneLocalSymbols',
  'communities',
  'processes',
  'tests',
  'dump',
  'similarity',
  'semantic',
  'embed',
] as const;

export type PipelinePhaseId = (typeof PIPELINE_PHASE_IDS)[number];

/** A pipeline phase — a unit of work in the indexing pipeline */
export interface PipelinePhase {
  id: PipelinePhaseId;
  dependencies: PipelinePhaseId[];
  description: string;
  parallelizable: boolean;
}

/** Project metadata tracked during indexing */
export interface ProjectMetadata {
  id: string;
  rootPath: string;
  name: string;
  language: string | null;
  indexedAt: string | null;
  lastCommit: string | null;
  nodeCount: number;
  edgeCount: number;
  status: 'idle' | 'indexing' | 'ready' | 'error';
  config: Record<string, unknown>;
}

/** Shared context object threaded through pipeline phases */
export interface PipelineContext {
  projectId: string;
  rootPath: string;
  phaseData: Map<string, unknown>;
  config: CodeAnalyzerConfig;
  graph?: KnowledgeGraph;
  metadata?: ProjectMetadata;
}

// ---------------------------------------------------------------------------
// File Discovery & Parsing Types
// ---------------------------------------------------------------------------

/** A file discovered during the scan phase */
export interface DiscoveredFile {
  filePath: string;
  language: SupportedLanguage | null;
  content: string;
  hash: string;
  size: number;
}

/** A file after parsing — holds extracted symbols and scopes */
export interface ParsedFile {
  filePath: string;
  language: SupportedLanguage;
  symbols: SymbolDefinition[];
  references: ReferenceSite[];
  scopeTree: ScopeTree;
  ast: unknown;
}

/** A symbol definition extracted during parsing */
export interface SymbolDefinition {
  name: string;
  kind: NodeLabel;
  qualifiedName: string;
  startLine: number;
  endLine: number;
  signature?: string;
  returnType?: string;
  docstring?: string;
  containerName?: string;
  isExported: boolean;
  visibility?: 'public' | 'private' | 'protected';
  properties: Record<string, unknown>;
}

/** A reference site — where a symbol is referenced in source code */
export interface ReferenceSite {
  sourceFile: string;
  sourceLine: number;
  sourceColumn: number;
  targetName: string;
  targetQname?: string;
  referenceKind: 'call' | 'import' | 'access' | 'type' | 'inherit';
}

/** A hierarchical scope tree for a parsed file */
export interface ScopeTree {
  name: string;
  kind: NodeLabel;
  startLine: number;
  endLine: number;
  parent?: ScopeTree;
  children: ScopeTree[];
  symbols: string[];
}

/** The full semantic model for a project */
export interface SemanticModel {
  projectId: string;
  files: Map<string, ParsedFile>;
  symbolTable: Map<string, GraphNode>;
  symbolToDefinitions: Map<string, SymbolDefinition[]>;
  unresolvedReferences: ReferenceSite[];
}

/** A resolved cross-file reference */
export interface ResolvedReference {
  reference: ReferenceSite;
  targetNodeId: number;
  targetLabel: NodeLabel;
  targetQname: string;
  confidence: number;
}

/** A resolved function or method call */
export interface ResolvedCall {
  callerQname: string;
  calleeQname: string;
  calleeNodeId: number;
  lineNumber: number;
  isAsync: boolean;
  args: string[];
  confidence: number;
}

/** A resolved import statement */
export interface ResolvedImport {
  sourceFile: string;
  importPath: string;
  importedSymbols: string[];
  resolvedFiles: string[];
  semantics: ImportSemantics;
}

// ---------------------------------------------------------------------------
// Language Types
// ---------------------------------------------------------------------------

/** Import resolution strategies per language */
export type ImportSemantics = 'named' | 'wildcard-leaf' | 'wildcard-transitive' | 'namespace';

/** Method resolution order strategy */
export type MroStrategy = 'c3-linearization' | 'ruby-mixin' | 'first-wins';

/** Supported languages (ordered by implementation priority) */
export const SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'go',
  'java',
  'kotlin',
  'csharp',
  'rust',
  'c',
  'cpp',
  'php',
  'ruby',
  'swift',
  'dart',
  'lua',
  'scala',
  'zig',
  'elixir',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// ---------------------------------------------------------------------------
// Review Types
// ---------------------------------------------------------------------------

/** Categories for review comments */
export const REVIEW_CATEGORIES = [
  'bug',
  'security',
  'performance',
  'maintainability',
  'test',
  'style',
  'documentation',
  'architecture',
  'other',
] as const;

export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

/** Severity levels for review comments */
export const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low', 'info'] as const;

export type Severity = (typeof SEVERITY_LEVELS)[number];

/** Risk levels for change impact */
export const RISK_LEVELS = ['critical', 'high', 'medium', 'low'] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

/** A review comment produced by the code review engine */
export interface ReviewComment {
  path: string;
  content: string;
  suggestionCode?: string;
  existingCode: string;
  startLine: number;
  endLine: number;
  thinking?: string;
  category: ReviewCategory;
  severity: Severity;
  filtered: boolean;
  id: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

/** Categories for typed errors */
export const ERROR_CATEGORIES = [
  'CONFIG',
  'IO',
  'PARSE',
  'RESOLVE',
  'GRAPH',
  'EMBED',
  'LLM',
  'MCP',
  'RATE_LIMIT',
  'INTERNAL',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// MCP Types
// ---------------------------------------------------------------------------

/** Tool profiles for MCP server — controls which tools are exposed */
export type ToolProfile = 'all' | 'analysis' | 'scout';

/** MCP tool definition */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP resource definition */
export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

/** MCP prompt definition */
export interface PromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}

// ---------------------------------------------------------------------------
// Search Types
// ---------------------------------------------------------------------------

/** Options for searching the knowledge graph */
export interface SearchOptions {
  query: string;
  labels?: NodeLabel[];
  projectId?: string;
  filePath?: string;
  limit?: number;
  offset?: number;
}

/** A single search result from the knowledge graph */
export interface SearchResult {
  node: GraphNode;
  score: number;
  matchedField: string;
  matchedValue: string;
}

// ---------------------------------------------------------------------------
// Impact Analysis Types
// ---------------------------------------------------------------------------

/** Result of an impact analysis over a set of changes */
export interface ImpactResult {
  changedFiles: string[];
  changedSymbols: ChangedSymbol[];
  impactTree: ImpactNode[];
  riskLevel: RiskLevel;
  processesAffected: ProcessImpact[];
  estimatedEffort: 'low' | 'medium' | 'high';
}

/** A symbol that has changed between revisions */
export interface ChangedSymbol {
  symbolQname: string;
  filePath: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  oldSignature?: string;
  newSignature?: string;
  startLine: number;
  endLine: number;
}

/** A node in the impact analysis dependency tree */
export interface ImpactNode {
  symbolQname: string;
  label: NodeLabel;
  filePath: string;
  impactType: 'direct' | 'indirect' | 'transitive';
  depth: number;
  children: ImpactNode[];
}

/** The impact of a code change on a business process */
export interface ProcessImpact {
  processName: string;
  processId: number;
  severity: RiskLevel;
  affectedSteps: number[];
  description: string;
}

// ---------------------------------------------------------------------------
// Git Integration Types
// ---------------------------------------------------------------------------

/** A git diff for a single file */
export interface GitDiff {
  filePath: string;
  oldHash: string;
  newHash: string;
  ranges: DiffRange[];
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
}

/** Result of checking whether a graph node is stale */
export interface StalenessResult {
  nodeId: number;
  nodeQname: string;
  isStale: boolean;
  reason?: string;
  diff?: GitDiff;
}

/** A line range in a git diff */
export interface DiffRange {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  changeType: 'added' | 'removed' | 'modified';
}

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

/** Configuration for the MCP server instance */
export interface MCPServerConfig {
  name: string;
  version: string;
  toolProfile: ToolProfile;
  maxResults: number;
  enableStreaming: boolean;
  enableResources: boolean;
  enablePrompts: boolean;
}

/** Full configuration schema for Code Analyzer */
export interface CodeAnalyzerConfig {
  projectId: string;
  rootPath: string;
  language?: SupportedLanguage;
  excludePatterns: string[];
  includePatterns: string[];
  maxFileSize: number;
  maxFiles: number;
  parseWorkers: number;
  cacheDir?: string;
  ignorePaths: string[];
  mcp?: MCPServerConfig;
  review?: {
    enabled: boolean;
    maxComments: number;
    severityFilter: Severity[];
    categoryFilter: ReviewCategory[];
  };
  embed?: {
    enabled: boolean;
    model: string;
    batchSize: number;
    dimensions: number;
  };
  pruner?: {
    enabled: boolean;
    keepTests: boolean;
    keepInternal: boolean;
  };
}

// ---------------------------------------------------------------------------
// Utility Helpers
// ---------------------------------------------------------------------------

/** Validate that a string is a valid NodeLabel */
export function isNodeLabel(value: string): value is NodeLabel {
  return (NODE_LABELS as readonly string[]).includes(value);
}

/** Validate that a string is a valid RelationshipType */
export function isRelationshipType(value: string): value is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

/** Map a file extension or filename to a SupportedLanguage */
export function getLanguageFromFilename(filePath: string): SupportedLanguage | null {
  const base = filePath.split('/').pop() ?? filePath;
  const dotIndex = base.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const ext = base.slice(dotIndex).toLowerCase();

  // Special: dot-notated prefixes like .d.ts
  if (ext === '.d.ts') return 'typescript';
  if (ext === '.tsx') return 'typescript';
  if (ext === '.jsx') return 'javascript';

  const secondaryExt = base.slice(0, dotIndex).lastIndexOf('.');
  if (secondaryExt >= 0) {
    const secondPart = base.slice(secondaryExt).toLowerCase();
    if (secondPart === '.d.ts') return 'typescript';
  }

  const EXT_MAP: Record<string, SupportedLanguage> = {
    '.ts': 'typescript',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.pyi': 'python',
    '.go': 'go',
    '.java': 'java',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.cs': 'csharp',
    '.rs': 'rust',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.hh': 'cpp',
    '.php': 'php',
    '.phtml': 'php',
    '.rb': 'ruby',
    '.swift': 'swift',
    '.dart': 'dart',
    '.lua': 'lua',
    '.scala': 'scala',
    '.zig': 'zig',
    '.ex': 'elixir',
    '.exs': 'elixir',
  };

  return EXT_MAP[ext] ?? null;
}

/** Paginated result wrapper */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// PDG Types — Program Dependence Graph
// ---------------------------------------------------------------------------

export interface BasicBlockNode {
  functionId: number;
  blockIndex: number;
  instructions: string[];
  isEntry: boolean;
  isExit: boolean;
}

export interface TaintSource {
  kind: 'user_input' | 'network' | 'file_system' | 'database' | 'environment';
  location: { filePath: string; lineNumber: number };
  variable: string;
}

export interface TaintSink {
  kind: 'sql_query' | 'command_exec' | 'file_write' | 'network_send' | 'eval' | 'dom_write';
  location: { filePath: string; lineNumber: number };
  function: string;
}

export interface TaintSanitizer {
  kind: 'validation' | 'escaping' | 'encoding' | 'authentication' | 'authorization';
  location: { filePath: string; lineNumber: number };
  function: string;
}

export interface TaintPath {
  source: TaintSource;
  sinks: TaintSink[];
  sanitizers: TaintSanitizer[];
  path: Array<{ filePath: string; lineNumber: number }>;
  isVulnerable: boolean;
  severity: Severity;
  cweId?: string;
}

// ---------------------------------------------------------------------------
// Standards Types
// ---------------------------------------------------------------------------

export type StandardCategory =
  | 'code-style'
  | 'architecture'
  | 'security'
  | 'performance'
  | 'testing'
  | 'api-design'
  | 'error-handling'
  | 'documentation'
  | 'dependency'
  | 'custom';

export interface ProjectStandard {
  id: string;
  name: string;
  version: string;
  category: StandardCategory;
  description: string;
  rules: StandardRule[];
  examples: StandardExample[];
  config?: StandardConfig;
}

export interface StandardRule {
  id: string;
  description: string;
  checkType: 'ast-pattern' | 'regex' | 'graph-query' | 'llm-check' | 'metric';
  checkConfig: Record<string, unknown>;
  severity: Severity;
  autoFixable: boolean;
  fixSuggestion?: string;
}

export interface StandardConfig {
  includePaths: string[];
  excludePaths: string[];
  severityOverrides: Record<string, Severity>;
  disabledRules: string[];
  ruleParams: Record<string, Record<string, unknown>>;
}

export interface StandardExample {
  description: string;
  compliant: boolean;
  code: string;
  explanation?: string;
}

export interface ComplianceResult {
  standardId: string;
  ruleId: string;
  filePath: string;
  lineNumber?: number;
  compliant: boolean;
  severity: Severity;
  message: string;
  suggestion?: string;
  autoFix?: string;
}

export interface StandardsCheckResult {
  standardId: string;
  ruleResults: RuleCheckResult[];
  complianceScore: number;
  filesChecked: number;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    passed: number;
  };
  duration: number;
}

export interface RuleCheckResult {
  ruleId: string;
  ruleDescription: string;
  passed: boolean;
  severity: Severity;
  violations: Violation[];
  autoFixable: boolean;
}

export interface Violation {
  filePath: string;
  lineNumber: number;
  columnNumber?: number;
  message: string;
  codeSnippet: string;
  suggestion?: string;
  autoFix?: string;
  standardRef: string;
}

// ---------------------------------------------------------------------------
// Report Types
// ---------------------------------------------------------------------------

export interface AnalysisReport {
  id: string;
  type: 'pr-review' | 'codebase-audit' | 'impact-analysis' | 'architecture-review' | 'standards-compliance';
  title: string;
  createdAt: string;
  scope: ReportScope;
  summary: ReportSummary;
  findings: Finding[];
  recommendations: Recommendation[];
  metrics: ReportMetrics;
  metadata: ReportMetadata;
}

export interface ReportScope {
  type: 'project' | 'repo-group' | 'pr';
  projectId?: string;
  groupId?: string;
  prNumber?: number;
  baseRef?: string;
  headRef?: string;
}

export interface ReportSummary {
  overallScore: number;
  riskLevel: RiskLevel;
  totalFindings: number;
  criticalFindings: number;
  highFindings: number;
  mediumFindings: number;
  lowFindings: number;
  keyTakeaways: string[];
  mergeRecommendation: 'approve' | 'approve-with-comments' | 'request-changes' | 'block';
  mergeRationale: string;
}

export interface Finding {
  id: string;
  category: ReviewCategory;
  severity: Severity;
  title: string;
  description: string;
  filePath: string;
  lineRange: [number, number] | null;
  standardRef?: string;
  ruleRef?: string;
  evidence: string;
  relatedFindings: string[];
}

export interface Recommendation {
  id: string;
  priority: 1 | 2 | 3;
  title: string;
  description: string;
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large' | 'xlarge';
  affectedFiles: string[];
  actionItems: ActionItem[];
  risksAddressed: string[];
  references: Reference[];
  beforeCode?: string;
  afterCode?: string;
}

export interface ActionItem {
  description: string;
  file?: string;
  lineRange?: [number, number];
  command?: string;
  verifiedBy?: string;
}

export interface Reference {
  type: 'url' | 'file' | 'symbol' | 'standard';
  label: string;
  value: string;
}

export interface ReportMetrics {
  linesChanged: number;
  filesChanged: number;
  symbolsAffected: number;
  routesAffected: number;
  testsImpacted: number;
  complexityDelta: number;
  coverageDelta: number;
  complianceScore: number;
  reviewDuration: number;
  tokenUsage: number;
}

export interface ReportMetadata {
  repository: string;
  branch: string;
  baseBranch: string;
  commitSha: string;
  author: string;
  reviewer: string;
  standardsApplied: string[];
  rulesApplied: string[];
  generatorVersion: string;
}

// ---------------------------------------------------------------------------
// Cross-Repo Types
// ---------------------------------------------------------------------------

export interface CrossRepoCallEdge {
  sourceRepo: string;
  sourceSymbol: string;
  targetRepo: string;
  targetSymbol: string;
  resolutionType: 'function_call' | 'interface_impl' | 'module_import' | 'api_consumer';
  confidence: number;
}

export interface Contract {
  id: string;
  name: string;
  description: string;
  uri: string;
  version: string;
  definition: Record<string, unknown>;
  dependencies: string[];
}

export interface RepoGroup {
  id: string;
  name: string;
  description: string;
  repos: GroupRepo[];
  contracts: Contract[];
  indexedAt: string | null;
}

export interface GroupRepo {
  owner: string;
  repo: string;
  fullName: string;
  localPath: string;
  projectId: string | null;
  role: 'primary' | 'dependency' | 'consumer';
  autoIndex: boolean;
}

export interface GitHubRepo {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string;
  language: string | null;
  topics: string[];
  isPrivate: boolean;
  description: string | null;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  base: { ref: string; sha: string; repo: GitHubRepo };
  head: { ref: string; sha: string; repo: GitHubRepo };
  user: { login: string };
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Cypher Types
// ---------------------------------------------------------------------------

export interface CypherToken {
  type: 'KEYWORD' | 'IDENTIFIER' | 'STRING' | 'NUMBER' | 'OPERATOR' | 'PUNCTUATION';
  value: string;
  position: number;
}

export type CypherAST = MatchClause | ReturnClause | WhereClause;

export interface MatchClause {
  type: 'match';
  patterns: NodePattern[];
}

export interface NodePattern {
  variable: string;
  labels: string[];
  properties: Record<string, unknown>;
  relationships?: RelationshipPattern[];
}

export interface RelationshipPattern {
  variable?: string;
  types: string[];
  direction: 'left' | 'right' | 'both';
  minHops?: number;
  maxHops?: number;
  target: NodePattern;
}

export interface WhereClause {
  type: 'where';
  condition: CypherExpression;
}

export interface ReturnClause {
  type: 'return';
  items: ReturnItem[];
  distinct: boolean;
  orderBy?: OrderByItem[];
  limit?: number;
  skip?: number;
}

export interface ReturnItem {
  expression: CypherExpression;
  alias?: string;
}

export interface OrderByItem {
  expression: CypherExpression;
  direction: 'asc' | 'desc';
}

export type CypherExpression =
  | { type: 'property'; object: string; property: string }
  | { type: 'variable'; name: string }
  | { type: 'literal'; value: string | number | boolean }
  | { type: 'function'; name: string; args: CypherExpression[] }
  | { type: 'binary'; operator: string; left: CypherExpression; right: CypherExpression }
  | { type: 'unary'; operator: string; operand: CypherExpression };

// ---------------------------------------------------------------------------
// Session Types
// ---------------------------------------------------------------------------

export interface ReviewSession {
  id: string;
  projectId: string;
  mode: 'diff' | 'scan';
  fromRef?: string;
  toRef?: string;
  status: 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  filesReviewed: number;
  commentsGenerated: number;
}

// ---------------------------------------------------------------------------
// Agent Skill Types
// ---------------------------------------------------------------------------

export interface AgentSkill {
  name: string;
  description: string;
  category:
    | 'exploration'
    | 'debugging'
    | 'review'
    | 'refactoring'
    | 'impact'
    | 'architecture'
    | 'security'
    | 'reference';
  content: string;
  tools: string[];
}

export interface DetectedAgent {
  name: string;
  type:
    | 'claude-code'
    | 'cursor'
    | 'codex'
    | 'windsurf'
    | 'codebuddy'
    | 'aider'
    | 'continue'
    | 'custom';
  installPath: string;
  skillFormat: 'markdown' | 'yaml';
}

// ---------------------------------------------------------------------------
// Supervisor Types
// ---------------------------------------------------------------------------

export interface SupervisorResult {
  status: 'complete' | 'partial' | 'crashed' | 'timeout';
  filesProcessed: number;
  filesFailed: number;
  quarantinedFiles: QuarantinedFile[];
  crashReports: CrashReport[];
  duration: number;
  peakMemory: number;
}

export interface QuarantinedFile {
  filePath: string;
  error: string;
  quarantinedAt: string;
}

export interface CrashReport {
  filePath: string;
  error: string;
  signal?: string;
  stackTrace?: string;
  attemptNumber: number;
}
