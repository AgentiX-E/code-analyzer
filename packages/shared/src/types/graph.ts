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

/** Paginated result wrapper */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
