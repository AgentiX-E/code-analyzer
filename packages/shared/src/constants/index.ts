// @code-analyzer/shared — Constants & Lookup Tables
// Pre-computed mappings used by all packages in the monorepo.

import type {
  NodeLabel,
  RelationshipType,
  SupportedLanguage,
} from '../types/graph.js';

// ---------------------------------------------------------------------------
// NODE_TABLES — SQL table name per node label
// ---------------------------------------------------------------------------

export const NODE_TABLES: Map<NodeLabel, string> = new Map([
  ['Project', 'projects'],
  ['Package', 'packages'],
  ['Folder', 'folders'],
  ['File', 'files'],
  ['Module', 'modules'],
  ['Class', 'classes'],
  ['Interface', 'interfaces'],
  ['Function', 'functions'],
  ['Method', 'methods'],
  ['Constructor', 'constructors'],
  ['Property', 'properties'],
  ['Enum', 'enums'],
  ['TypeAlias', 'type_aliases'],
  ['Struct', 'structs'],
  ['Trait', 'traits'],
  ['Variable', 'variables'],
  ['Route', 'routes'],
  ['Tool', 'tools'],
  ['Component', 'components'],
  ['Test', 'tests'],
  ['Community', 'communities'],
  ['Process', 'processes'],
  ['Config', 'configs'],
  ['ADR', 'adrs'],
  ['BasicBlock', 'basic_blocks'],
]);

// ---------------------------------------------------------------------------
// REL_INVERSES — inverse relationship type for each relationship type
// ---------------------------------------------------------------------------

export const REL_INVERSES: Map<RelationshipType, RelationshipType> = new Map([
  // Structural — directional inverses
  ['CONTAINS', 'BELONGS_TO'],
  ['BELONGS_TO', 'CONTAINS'],
  ['DEFINES', 'MEMBER_OF'],
  ['MEMBER_OF', 'DEFINES'],
  ['HAS_METHOD', 'BELONGS_TO'],
  ['HAS_PROPERTY', 'BELONGS_TO'],

  // Inheritance — same type, direction reversed
  ['EXTENDS', 'EXTENDS'],
  ['IMPLEMENTS', 'IMPLEMENTS'],
  ['METHOD_OVERRIDES', 'METHOD_OVERRIDES'],
  ['METHOD_IMPLEMENTS', 'METHOD_IMPLEMENTS'],

  // Data & Control Flow — same type, direction reversed
  ['CALLS', 'CALLS'],
  ['IMPORTS', 'IMPORTS'],
  ['ACCESSES', 'ACCESSES'],
  ['INSTANTIATES', 'INSTANTIATES'],
  ['USES_TYPE', 'USES_TYPE'],

  // Architectural — same type, direction reversed
  ['HANDLES_ROUTE', 'HANDLES_ROUTE'],
  ['HANDLES_TOOL', 'HANDLES_TOOL'],
  ['EXPOSES', 'EXPOSES'],
  ['INJECTS', 'INJECTS'],

  // Analytical — same type, direction reversed
  ['SIMILAR_TO', 'SIMILAR_TO'],
  ['SEMANTICALLY_RELATED', 'SEMANTICALLY_RELATED'],
  ['TESTS', 'TESTS'],
  ['CHANGES_WITH', 'CHANGES_WITH'],
  ['DATA_FLOWS', 'DATA_FLOWS'],
  ['STEP_IN_PROCESS', 'STEP_IN_PROCESS'],
]);

// ---------------------------------------------------------------------------
// LANGUAGE_EXTENSIONS — file extensions per supported language
// ---------------------------------------------------------------------------

export const LANGUAGE_EXTENSIONS: Record<SupportedLanguage, string[]> = {
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py', '.pyi', '.pyx', '.pxd'],
  go: ['.go'],
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  csharp: ['.cs', '.csx'],
  rust: ['.rs'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.c++', '.h++'],
  php: ['.php', '.phtml', '.php3', '.php4', '.php5', '.phps'],
  ruby: ['.rb', '.rake', '.gemspec'],
  swift: ['.swift'],
  dart: ['.dart'],
  lua: ['.lua'],
  scala: ['.scala', '.sc'],
  zig: ['.zig'],
  elixir: ['.ex', '.exs'],
};

// ---------------------------------------------------------------------------
// EXTENSION_TO_LANGUAGE — map a single extension to its language
// ---------------------------------------------------------------------------

export const EXTENSION_TO_LANGUAGE: Map<string, SupportedLanguage> = new Map(
  Object.entries(LANGUAGE_EXTENSIONS).flatMap(([lang, exts]) =>
    exts.map((ext): [string, SupportedLanguage] => [ext, lang as SupportedLanguage])
  )
);

// ext → language helpers for extensions missing from LANGUAGE_EXTENSIONS
// but needed for getLanguageFromFilename round-tripping
EXTENSION_TO_LANGUAGE.set('.mjs', 'javascript');
EXTENSION_TO_LANGUAGE.set('.cjs', 'javascript');

// ---------------------------------------------------------------------------
// COMPATIBLE_EDGES — which (sourceLabel, targetLabel) pairs are valid per edge
// ---------------------------------------------------------------------------

export const COMPATIBLE_EDGES: Map<RelationshipType, [NodeLabel, NodeLabel][]> = new Map();

// Structural
COMPATIBLE_EDGES.set('CONTAINS', [
  ['Project', 'Package'],
  ['Package', 'Folder'],
  ['Package', 'Module'],
  ['Folder', 'Folder'],
  ['Folder', 'File'],
  ['Module', 'File'],
  ['Module', 'Class'],
  ['Module', 'Function'],
]);

COMPATIBLE_EDGES.set('DEFINES', [
  ['File', 'Class'],
  ['File', 'Function'],
  ['File', 'Interface'],
  ['File', 'Enum'],
  ['File', 'TypeAlias'],
  ['File', 'Variable'],
  ['File', 'Struct'],
  ['File', 'Trait'],
  ['Class', 'Method'],
  ['Class', 'Property'],
  ['Class', 'Constructor'],
  ['Interface', 'Method'],
  ['Interface', 'Property'],
  ['Enum', 'Property'],
  ['Struct', 'Method'],
  ['Struct', 'Property'],
  ['Trait', 'Method'],
  ['Trait', 'Property'],
  ['Module', 'Class'],
  ['Module', 'Function'],
  ['Module', 'Interface'],
  ['Module', 'Enum'],
  ['Module', 'TypeAlias'],
  ['Module', 'Variable'],
]);

COMPATIBLE_EDGES.set('HAS_METHOD', [
  ['Class', 'Method'],
  ['Interface', 'Method'],
  ['Struct', 'Method'],
  ['Trait', 'Method'],
]);

COMPATIBLE_EDGES.set('HAS_PROPERTY', [
  ['Class', 'Property'],
  ['Interface', 'Property'],
  ['Enum', 'Property'],
  ['Struct', 'Property'],
  ['Trait', 'Property'],
]);

COMPATIBLE_EDGES.set('MEMBER_OF', [
  ['Method', 'Class'],
  ['Property', 'Class'],
  ['Constructor', 'Class'],
  ['Method', 'Interface'],
  ['Method', 'Struct'],
  ['Method', 'Trait'],
  ['Function', 'File'],
  ['Function', 'Module'],
  ['Variable', 'Module'],
  ['Variable', 'File'],
  ['Class', 'File'],
  ['Class', 'Module'],
  ['Interface', 'File'],
  ['Interface', 'Module'],
  ['Enum', 'File'],
  ['TypeAlias', 'File'],
]);

COMPATIBLE_EDGES.set('BELONGS_TO', [
  ['File', 'Folder'],
  ['File', 'Package'],
  ['Module', 'Package'],
  ['Folder', 'Package'],
  ['Method', 'Class'],
  ['Property', 'Class'],
  ['Constructor', 'Class'],
  ['Method', 'Interface'],
  ['Class', 'Module'],
  ['Function', 'Module'],
  ['Variable', 'Module'],
]);

// Inheritance & Implementation
COMPATIBLE_EDGES.set('EXTENDS', [
  ['Class', 'Class'],
  ['Interface', 'Interface'],
  ['Struct', 'Struct'],
]);

COMPATIBLE_EDGES.set('IMPLEMENTS', [
  ['Class', 'Interface'],
  ['Trait', 'Interface'],
]);

COMPATIBLE_EDGES.set('METHOD_OVERRIDES', [
  ['Method', 'Method'],
]);

COMPATIBLE_EDGES.set('METHOD_IMPLEMENTS', [
  ['Method', 'Method'],
]);

// Data & Control Flow
COMPATIBLE_EDGES.set('CALLS', [
  ['Function', 'Function'],
  ['Method', 'Method'],
  ['Method', 'Function'],
  ['Function', 'Method'],
  ['Constructor', 'Constructor'],
  ['Method', 'Constructor'],
]);

COMPATIBLE_EDGES.set('IMPORTS', [
  ['File', 'Module'],
  ['File', 'File'],
  ['Module', 'Module'],
  ['File', 'Package'],
]);

COMPATIBLE_EDGES.set('ACCESSES', [
  ['Function', 'Variable'],
  ['Method', 'Property'],
  ['Function', 'Property'],
  ['Method', 'Variable'],
  ['Function', 'Function'],
  ['Method', 'Method'],
]);

COMPATIBLE_EDGES.set('INSTANTIATES', [
  ['Function', 'Class'],
  ['Method', 'Class'],
  ['Constructor', 'Class'],
]);

COMPATIBLE_EDGES.set('USES_TYPE', [
  ['Function', 'TypeAlias'],
  ['Function', 'Interface'],
  ['Function', 'Enum'],
  ['Class', 'TypeAlias'],
  ['Class', 'Interface'],
  ['Variable', 'TypeAlias'],
  ['Variable', 'Interface'],
  ['Method', 'TypeAlias'],
  ['Method', 'Interface'],
  ['Property', 'TypeAlias'],
]);

// Architectural
COMPATIBLE_EDGES.set('HANDLES_ROUTE', [
  ['File', 'Route'],
  ['Class', 'Route'],
  ['Method', 'Route'],
  ['Function', 'Route'],
]);

COMPATIBLE_EDGES.set('HANDLES_TOOL', [
  ['File', 'Tool'],
  ['Class', 'Tool'],
  ['Function', 'Tool'],
]);

COMPATIBLE_EDGES.set('EXPOSES', [
  ['Package', 'Module'],
  ['Module', 'Class'],
  ['Module', 'Function'],
  ['Module', 'Interface'],
  ['Module', 'Enum'],
  ['Module', 'TypeAlias'],
]);

COMPATIBLE_EDGES.set('INJECTS', [
  ['Constructor', 'Class'],
  ['Class', 'Interface'],
  ['Function', 'Class'],
]);

// Analytical
COMPATIBLE_EDGES.set('SIMILAR_TO', [
  ['Class', 'Class'],
  ['Function', 'Function'],
  ['Method', 'Method'],
  ['Module', 'Module'],
  ['File', 'File'],
]);

COMPATIBLE_EDGES.set('SEMANTICALLY_RELATED', [
  ['Class', 'Class'],
  ['Function', 'Function'],
  ['Module', 'Module'],
  ['File', 'File'],
  ['Property', 'Property'],
  ['Method', 'Method'],
]);

COMPATIBLE_EDGES.set('TESTS', [
  ['Test', 'Function'],
  ['Test', 'Class'],
  ['Test', 'Module'],
  ['Test', 'Method'],
  ['File', 'File'],
  ['Module', 'Module'],
]);

COMPATIBLE_EDGES.set('CHANGES_WITH', [
  ['File', 'File'],
  ['Class', 'Class'],
  ['Function', 'Function'],
  ['Method', 'Method'],
]);

COMPATIBLE_EDGES.set('DATA_FLOWS', [
  ['Function', 'Function'],
  ['Function', 'Variable'],
  ['Method', 'Variable'],
  ['Method', 'Method'],
  ['Variable', 'Variable'],
]);

COMPATIBLE_EDGES.set('STEP_IN_PROCESS', [
  ['Function', 'Process'],
  ['Method', 'Process'],
  ['Class', 'Process'],
  ['File', 'Process'],
]);
