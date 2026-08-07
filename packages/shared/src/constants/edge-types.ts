// @code-analyzer/shared — Edge Type Constants
// Centralized string constants for all 43 relationship types in the knowledge graph.
// Use these constants instead of raw string literals to prevent typos and enable
// IDE autocompletion / refactoring.

// ---------------------------------------------------------------------------
// Structural Edge Types
// ---------------------------------------------------------------------------

export const EDGE_CONTAINS = 'CONTAINS' as const;
export const EDGE_DEFINES = 'DEFINES' as const;
export const EDGE_HAS_METHOD = 'HAS_METHOD' as const;
export const EDGE_HAS_PROPERTY = 'HAS_PROPERTY' as const;
export const EDGE_MEMBER_OF = 'MEMBER_OF' as const;
export const EDGE_BELONGS_TO = 'BELONGS_TO' as const;

// ---------------------------------------------------------------------------
// Inheritance & Implementation Edge Types
// ---------------------------------------------------------------------------

export const EDGE_EXTENDS = 'EXTENDS' as const;
export const EDGE_IMPLEMENTS = 'IMPLEMENTS' as const;
export const EDGE_METHOD_OVERRIDES = 'METHOD_OVERRIDES' as const;
export const EDGE_METHOD_IMPLEMENTS = 'METHOD_IMPLEMENTS' as const;

// ---------------------------------------------------------------------------
// Data & Control Flow Edge Types
// ---------------------------------------------------------------------------

export const EDGE_CALLS = 'CALLS' as const;
export const EDGE_IMPORTS = 'IMPORTS' as const;
export const EDGE_ACCESSES = 'ACCESSES' as const;
export const EDGE_INSTANTIATES = 'INSTANTIATES' as const;
export const EDGE_USES_TYPE = 'USES_TYPE' as const;

// ---------------------------------------------------------------------------
// Architectural Edge Types
// ---------------------------------------------------------------------------

export const EDGE_HANDLES = 'HANDLES' as const;
export const EDGE_HANDLES_ROUTE = 'HANDLES_ROUTE' as const;
export const EDGE_HANDLES_TOOL = 'HANDLES_TOOL' as const;
export const EDGE_EXPOSES = 'EXPOSES' as const;
export const EDGE_INJECTS = 'INJECTS' as const;

// ---------------------------------------------------------------------------
// Analytical Edge Types
// ---------------------------------------------------------------------------

export const EDGE_SIMILAR_TO = 'SIMILAR_TO' as const;
export const EDGE_SEMANTICALLY_RELATED = 'SEMANTICALLY_RELATED' as const;
export const EDGE_TESTS = 'TESTS' as const;
export const EDGE_CHANGES_WITH = 'CHANGES_WITH' as const;
export const EDGE_DATA_FLOWS = 'DATA_FLOWS' as const;
export const EDGE_STEP_IN_PROCESS = 'STEP_IN_PROCESS' as const;

// ---------------------------------------------------------------------------
// Program Dependence Graph (PDG) Edge Types
// ---------------------------------------------------------------------------

export const EDGE_CFG = 'CFG' as const;
export const EDGE_REACHING_DEF = 'REACHING_DEF' as const;
export const EDGE_TAINTED = 'TAINTED' as const;
export const EDGE_SANITIZES = 'SANITIZES' as const;
export const EDGE_TAINT_PATH = 'TAINT_PATH' as const;

// ---------------------------------------------------------------------------
// Event Edge Types
// ---------------------------------------------------------------------------

export const EDGE_EMITS = 'EMITS' as const;
export const EDGE_LISTENS_ON = 'LISTENS_ON' as const;

// ---------------------------------------------------------------------------
// Config Edge Types
// ---------------------------------------------------------------------------

export const EDGE_CONFIGURES = 'CONFIGURES' as const;

// ---------------------------------------------------------------------------
// Cross-Repository Edge Types
// ---------------------------------------------------------------------------

export const EDGE_CROSS_REPO_DEPENDS = 'CROSS_REPO_DEPENDS' as const;
export const EDGE_CROSS_REPO_CALLS = 'CROSS_REPO_CALLS' as const;
export const EDGE_CROSS_REPO_IMPLEMENTS = 'CROSS_REPO_IMPLEMENTS' as const;
export const EDGE_CROSS_REPO_IMPORTS = 'CROSS_REPO_IMPORTS' as const;
export const EDGE_CROSS_REPO_EXPOSES = 'CROSS_REPO_EXPOSES' as const;
export const EDGE_CROSS_REPO_CONTRACT = 'CROSS_REPO_CONTRACT' as const;

// ---------------------------------------------------------------------------
// Infrastructure-as-Code (IaC) Edge Types
// ---------------------------------------------------------------------------

export const EDGE_BUILDS_FROM = 'BUILDS_FROM' as const;
export const EDGE_DEPLOYS_TO = 'DEPLOYS_TO' as const;
export const EDGE_PROVISIONS = 'PROVISIONS' as const;

// ---------------------------------------------------------------------------
// Aggregated collections for iteration / validation
// ---------------------------------------------------------------------------

/** All edge type constants in declaration order */
export const ALL_EDGE_TYPES = [
  // Structural
  EDGE_CONTAINS,
  EDGE_DEFINES,
  EDGE_HAS_METHOD,
  EDGE_HAS_PROPERTY,
  EDGE_MEMBER_OF,
  EDGE_BELONGS_TO,
  // Inheritance & Implementation
  EDGE_EXTENDS,
  EDGE_IMPLEMENTS,
  EDGE_METHOD_OVERRIDES,
  EDGE_METHOD_IMPLEMENTS,
  // Data & Control Flow
  EDGE_CALLS,
  EDGE_IMPORTS,
  EDGE_ACCESSES,
  EDGE_INSTANTIATES,
  EDGE_USES_TYPE,
  // Architectural
  EDGE_HANDLES,
  EDGE_HANDLES_ROUTE,
  EDGE_HANDLES_TOOL,
  EDGE_EXPOSES,
  EDGE_INJECTS,
  // Analytical
  EDGE_SIMILAR_TO,
  EDGE_SEMANTICALLY_RELATED,
  EDGE_TESTS,
  EDGE_CHANGES_WITH,
  EDGE_DATA_FLOWS,
  EDGE_STEP_IN_PROCESS,
  // PDG
  EDGE_CFG,
  EDGE_REACHING_DEF,
  EDGE_TAINTED,
  EDGE_SANITIZES,
  EDGE_TAINT_PATH,
  // Event
  EDGE_EMITS,
  EDGE_LISTENS_ON,
  // Config
  EDGE_CONFIGURES,
  // Cross-Repo
  EDGE_CROSS_REPO_DEPENDS,
  EDGE_CROSS_REPO_CALLS,
  EDGE_CROSS_REPO_IMPLEMENTS,
  EDGE_CROSS_REPO_IMPORTS,
  EDGE_CROSS_REPO_EXPOSES,
  EDGE_CROSS_REPO_CONTRACT,
  // IaC
  EDGE_BUILDS_FROM,
  EDGE_DEPLOYS_TO,
  EDGE_PROVISIONS,
] as const;
