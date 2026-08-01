// @code-analyzer/shared — Unified Capture Tag System
// Language-agnostic tags extracted from tree-sitter AST captures

/**
 * Unified capture tags that map language-specific AST nodes
 * to a language-agnostic representation. Each language provider
 * defines tree-sitter S-expression queries that target these tags.
 */
export const CAPTURE_TAGS = {
  // Definitions
  FUNCTION_DEF: 'function.def',
  METHOD_DEF: 'method.def',
  CLASS_DEF: 'class.def',
  INTERFACE_DEF: 'interface.def',
  ENUM_DEF: 'enum.def',
  TYPE_DEF: 'type.def',
  VARIABLE_DEF: 'variable.def',
  CONSTANT_DEF: 'constant.def',
  PROPERTY_DEF: 'property.def',
  CONSTRUCTOR_DEF: 'constructor.def',
  STRUCT_DEF: 'struct.def',
  TRAIT_DEF: 'trait.def',

  // References
  FUNCTION_CALL: 'function.call',
  METHOD_CALL: 'method.call',
  NEW_EXPRESSION: 'new.expression',
  TYPE_REFERENCE: 'type.reference',
  VARIABLE_ACCESS: 'variable.access',

  // Imports
  IMPORT: 'import',
  IMPORT_NAMED: 'import.named',
  IMPORT_WILDCARD: 'import.wildcard',
  IMPORT_DEFAULT: 'import.default',

  // Annotations & Metadata
  DECORATOR: 'decorator',
  ANNOTATION: 'annotation',

  // Documentation
  DOCSTRING: 'docstring',
  COMMENT: 'comment',

  // Framework-Specific
  ROUTE_PATH: 'route.path',
  ROUTE_METHOD: 'route.method',
  DI_INJECT: 'di.inject',
  DI_PROVIDE: 'di.provide',
  COMPONENT_PROPS: 'component.props',
  COMPONENT_EMITS: 'component.emits',
} as const;

export type CaptureTag = (typeof CAPTURE_TAGS)[keyof typeof CAPTURE_TAGS];

/**
 * A unified capture from tree-sitter — the fundamental unit
 * of code extraction that flows through the analysis pipeline.
 */
export interface UnifiedCapture {
  /** The capture tag identifying what this is */
  tag: CaptureTag;

  /** The matched text from source code */
  text: string;

  /** Line number (1-based) where the match starts */
  startLine: number;

  /** Line number (1-based) where the match ends */
  endLine: number;

  /** Start byte offset in the source */
  startByte: number;

  /** End byte offset in the source */
  endByte: number;

  /** For named captures: the identifier name */
  name?: string;

  /** For captures within a container: parent node text */
  containerName?: string;

  /** Additional properties depending on the capture tag */
  properties?: Record<string, string>;
}
