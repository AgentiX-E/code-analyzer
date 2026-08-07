// @code-analyzer/intelligence — SCIP Protocol Exporter
// Converts Code Analyzer's knowledge graph into SCIP (Source Code
// Intelligence Protocol) format for Sourcegraph/Cody integration.
//
// SCIP spec: https://github.com/sourcegraph/scip
// JSON serialization (not Protobuf) per SCIP JSON-Line convention.

import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';
import { EDGE_CALLS, EDGE_DEFINES, EDGE_EXTENDS, EDGE_IMPLEMENTS, EDGE_IMPORTS, EDGE_METHOD_OVERRIDES } from '@code-analyzer/shared';

// ===========================================================================
// SCIP Data Types — TypeScript mirrors of the SCIP Protobuf schema
// ===========================================================================

/** Enumeration of symbol roles in occurrence context. */
export enum SymbolRole {
  Definition     = 1,
  Import         = 2,
  WriteAccess    = 4,
  ReadAccess     = 8,
  Generated      = 16,
  Test           = 32,
  ForwardDefinition = 64,
}

/** Syntax kind for occurrence classification. */
export enum SyntaxKind {
  Unspecified     = 0,
  Comment         = 1,
  Punctuation     = 2,
  StringLiteral   = 3,
  RegexpLiteral   = 4,
  Identifier      = 5,
  IdentifierKeyword = 6,
  IdentifierOperator = 7,
  IdentifierBuiltin = 8,
  IdentifierNull  = 9,
  IdentifierConstant = 10,
  IdentifierMutableGlobal = 11,
  IdentifierParameter = 12,
  IdentifierLocal = 13,
  IdentifierShadowed = 14,
  IdentifierNamespace = 15,
  IdentifierModule = 16,
  IdentifierFunction = 17,
  IdentifierFunctionDefinition = 18,
  IdentifierMacro = 19,
  IdentifierMethod = 20,
}

/** A symbol occurrence in a document. Maps to graph node references. */
export interface ScipOccurrence {
  /** Position range: [startLine, startCol, endLine, endCol] (0-indexed). */
  range: [number, number, number, number];
  /** Fully qualified SCIP symbol string, e.g. "ts . src/foo.ts/Foo#method().". */
  symbol: string;
  /** Bitmask of SymbolRole values. */
  symbolRoles: number;
  /** SyntaxKind classification. */
  syntaxKind: SyntaxKind;
  /** Optional override documentation. */
  overrideDocumentation?: string[];
}

/** A relationship edge between two SCIP symbols. */
export interface ScipRelationship {
  /** Target symbol string. */
  symbol: string;
  /** Whether this is a reference (usage) edge. */
  isReference: boolean;
  /** Whether this is an implementation edge. */
  isImplementation: boolean;
  /** Whether this is a type-definition edge. */
  isTypeDefinition: boolean;
  /** Whether this is a definition edge. */
  isDefinition: boolean;
}

/** Symbol information with documentation and relationships. */
export interface ScipSymbolInformation {
  /** The fully qualified SCIP symbol string. */
  symbol: string;
  /** Human-readable documentation. */
  documentation: string[];
  /** Edges to other symbols. */
  relationships: ScipRelationship[];
}

/** A document (source file) with occurrences and local symbols. */
export interface ScipDocument {
  /** Relative path within the project. */
  relativePath: string;
  /** Programming language identifier. */
  language: string;
  /** Symbol occurrences within this document. */
  occurrences: ScipOccurrence[];
  /** Symbols defined in this document. */
  symbols: ScipSymbolInformation[];
}

/** Top-level SCIP index (one per project). */
export interface ScipIndex {
  /** Tool metadata. */
  metadata: {
    /** Tool name. */
    toolName: string;
    /** Tool version. */
    toolVersion: string;
    /** Tool arguments (CLI flags). */
    toolArguments: string[];
    /** Protocol version (always 1). */
    protocolVersion: number;
  };
  /** All documents in the project. */
  documents: ScipDocument[];
  /** External symbols referenced but not defined in this project. */
  externalSymbols: ScipSymbolInformation[];
}

// ===========================================================================
// SCIP Symbol Formatter
// ===========================================================================

/** Descriptor kinds used in SCIP symbol strings. */
type ScipDescriptor =
  | { suffix: 'function' }
  | { suffix: 'method' }
  | { suffix: 'parameter' }
  | { suffix: 'local' }
  | { suffix: '' };

/** Format a Code Analyzer graph node into a SCIP symbol string.
 *
 *  SCIP symbol format: `scheme manager . package/ descriptor name .`
 *  Example: `ts . src/foo.ts/Foo#method().`  (TypeScript method)
 *           `py . pkg/mod.py/MyClass.mymethod().`  (Python method)
 *           `go . pkg/types.go/Struct.`  (Go struct)
 */
function formatScipSymbol(
  node: GraphNode,
  _language: string,
  scheme: string,
): string {
  const filePath = node.filePath ?? '';
  const name = sanitizeSymbolName(node.name);
  const pkg = extractPackage(filePath);

  const path = pkg ? `${pkg}/${filePath.replace(/^.*\//, '')}` : filePath;
  const descriptor = classifyDescriptor(node.label);

  // Build: `scheme . path/symbol#descriptor .`
  if (descriptor.suffix) {
    return `${scheme} . ${path}/${name}#${descriptor.suffix}().`;
  }
  return `${scheme} . ${path}/${name}.`;
}

/** Sanitize a symbol name for SCIP format. */
function sanitizeSymbolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_$@#().\[\]<>,:\-]/g, '_');
}

/** Extract package name from file path. */
function extractPackage(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length >= 2 && parts[0] === 'src') {
    return parts.slice(0, 2).join('/');
  }
  const pkgIdx = parts.indexOf('src');
  if (pkgIdx >= 0 && pkgIdx < parts.length - 1) {
    return parts[pkgIdx + 1] ?? '';
  }
  return parts[0] ?? '';
}

/** Format a SCIP symbol for an external (unresolved) reference. */
function formatExternalSymbol(_nodeId: number, _language: string, scheme: string): string {
  return `${scheme} . external/ref_${_nodeId}.`;
}
function classifyDescriptor(label: string): ScipDescriptor {
  switch (label) {
    case 'Function':
      return { suffix: 'function' };
    case 'Method':
    case 'Constructor':
      return { suffix: 'method' };
    case 'Variable':
    case 'Property':
      return { suffix: 'local' };
    case 'Parameter':
      return { suffix: 'parameter' };
    default:
      return { suffix: '' };
  }
}

// ===========================================================================
// Language → SCIP Scheme Mapping
// ===========================================================================

const SCHEME_MAP: Record<string, string> = {
  typescript: 'ts', tsx: 'tsx', javascript: 'ts', jsx: 'tsx',
  python: 'py', go: 'go', java: 'java', kotlin: 'kotlin',
  rust: 'rust', c: 'c', cpp: 'cpp', csharp: 'csharp',
  php: 'php', ruby: 'ruby', swift: 'swift', scala: 'scala',
  dart: 'dart', elixir: 'elixir', groovy: 'groovy',
  json: 'json', yaml: 'yaml', toml: 'toml', sql: 'sql',
  bash: 'bash', html: 'html', css: 'css',
};

function getScheme(language: string | null): string {
  return language ? (SCHEME_MAP[language.toLowerCase()] ?? language.toLowerCase()) : 'unknown';
}

/** Map graph relationship type to SCIP role bits. */
function mapEdgeToRoles(edge: GraphEdge): { role: number; isDef: boolean; isRef: boolean; isImpl: boolean } {
  switch (edge.type) {
    case EDGE_CALLS:
      return { role: SymbolRole.ReadAccess, isDef: false, isRef: true, isImpl: false };
    case EDGE_IMPLEMENTS:
      return { role: SymbolRole.Definition, isDef: true, isRef: false, isImpl: true };
    case EDGE_EXTENDS:
      return { role: SymbolRole.Definition, isDef: true, isRef: false, isImpl: false };
    case EDGE_IMPORTS:
      return { role: SymbolRole.Import, isDef: false, isRef: true, isImpl: false };
    case EDGE_DEFINES:
      return { role: SymbolRole.Definition, isDef: true, isRef: false, isImpl: false };
    case EDGE_METHOD_OVERRIDES:
      return { role: SymbolRole.WriteAccess, isDef: false, isRef: false, isImpl: true };
    default:
      return { role: SymbolRole.ReadAccess, isDef: false, isRef: true, isImpl: false };
  }
}

/** Map node label to SCIP SyntaxKind. */
function labelToSyntaxKind(label: string): SyntaxKind {
  switch (label) {
    case 'Function': case 'Method': case 'Constructor':
      return SyntaxKind.IdentifierFunctionDefinition;
    case 'Class': case 'Interface': case 'Trait': case 'Struct':
      return SyntaxKind.IdentifierNamespace;
    case 'Module':
      return SyntaxKind.IdentifierModule;
    case 'Variable': case 'Parameter': case 'Property':
      return SyntaxKind.IdentifierLocal;
    case 'Constant': case 'Enum':
      return SyntaxKind.IdentifierConstant;
    default:
      return SyntaxKind.Identifier;
  }
}

// ===========================================================================
// Document-Level Exporter
// ===========================================================================

/** Convert knowledge graph nodes for a single file into a SCIP Document. */
function exportDocument(
  store: InMemoryGraphStore,
  filePath: string,
  language: string,
  projectId: string,
): ScipDocument {
  const nodes = store.getAllNodes().filter(
    (n) => n.projectId === projectId && n.filePath === filePath,
  );

  const scheme = getScheme(language);
  const occurrences: ScipOccurrence[] = [];
  const symbols: ScipSymbolInformation[] = [];
  const symbolIndex = new Map<number, string>(); // nodeId → SCIP symbol string

  // Build SCIP symbols for all nodes
  for (const node of nodes) {
    const scipSym = formatScipSymbol(node, language, scheme);
    symbolIndex.set(node.id, scipSym);

    const relationships: ScipRelationship[] = [];
    const edges = store.getEdgesForNode(node.id, undefined, 'out');

    for (const edge of edges) {
      const targetNode = store.getNode(edge.targetId);
      const { isDef, isRef, isImpl } = mapEdgeToRoles(edge);

      // For targets not in the graph, create a synthetic external symbol
      const targetSym = targetNode
        ? formatScipSymbol(targetNode, targetNode.language ?? language, getScheme(targetNode.language))
        : formatExternalSymbol(edge.targetId, language, scheme);

      relationships.push({
        symbol: targetSym,
        isReference: isRef,
        isImplementation: isImpl,
        isTypeDefinition: edge.type === EDGE_EXTENDS || edge.type === EDGE_IMPLEMENTS,
        isDefinition: isDef,
      });
    }

    symbols.push({
      symbol: scipSym,
      documentation: node.docstring ? [node.docstring] : [],
      relationships,
    });

    // Create occurrence
    const roles = edges.length > 0
      ? edges.reduce((acc, e) => acc | mapEdgeToRoles(e).role, SymbolRole.Definition)
      : SymbolRole.Definition;

    occurrences.push({
      range: [
        (node.startLine ?? 0) - 1, 0,
        (node.endLine ?? node.startLine ?? 1) - 1, 0,
      ],
      symbol: scipSym,
      symbolRoles: roles,
      syntaxKind: labelToSyntaxKind(node.label),
    });
  }

  return {
    relativePath: filePath,
    language,
    occurrences,
    symbols,
  };
}

// ===========================================================================
// Index-Level Exporter
// ===========================================================================

/** Export the entire knowledge graph as a SCIP Index. */
export function exportScipIndex(
  store: InMemoryGraphStore,
  projectId: string,
  options?: {
    toolVersion?: string;
    toolArguments?: string[];
  },
): ScipIndex {
  // Group nodes by file
  const nodes = store.getAllNodes().filter((n) => n.projectId === projectId);
  const fileMap = new Map<string, GraphNode[]>();

  for (const node of nodes) {
    if (!node.filePath) continue;
    const existing = fileMap.get(node.filePath) ?? [];
    existing.push(node);
    fileMap.set(node.filePath, existing);
  }

  // Export each file as a SCIP Document
  const documents: ScipDocument[] = [];
  for (const [filePath, fileNodes] of fileMap) {
    const lang = fileNodes[0]?.language ?? detectLanguage(filePath);
    documents.push(exportDocument(store, filePath, lang, projectId));
  }

  // Collect external symbols (referenced but not defined)
  const definedSymbols = new Set<string>();
  for (const doc of documents) {
    for (const sym of doc.symbols) {
      definedSymbols.add(sym.symbol);
    }
  }

  const externalSymbols: ScipSymbolInformation[] = [];
  for (const doc of documents) {
    for (const sym of doc.symbols) {
      for (const rel of sym.relationships) {
        if (!definedSymbols.has(rel.symbol)) {
          externalSymbols.push({
            symbol: rel.symbol,
            documentation: [],
            relationships: [],
          });
        }
      }
    }
  }

  return {
    metadata: {
      toolName: 'code-analyzer',
      toolVersion: options?.toolVersion ?? '0.1.0',
      toolArguments: options?.toolArguments ?? [],
      protocolVersion: 1,
    },
    documents,
    externalSymbols,
  };
}

/** Detect language from file extension. */
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const extMap: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', go: 'go', java: 'java', kt: 'kotlin',
    rs: 'rust', c: 'c', cpp: 'cpp', cs: 'csharp',
    php: 'php', rb: 'ruby', swift: 'swift', scala: 'scala',
    dart: 'dart', ex: 'elixir', groovy: 'groovy',
    json: 'json', yaml: 'yaml', toml: 'toml', sql: 'sql',
    sh: 'bash', bash: 'bash', html: 'html', css: 'css',
    svelte: 'svelte', vue: 'vue',
  };
  return ext ? (extMap[ext] ?? ext) : 'unknown';
}

// ===========================================================================
// Serializer
// ===========================================================================

/** Serialize a SCIP Index to a compact JSON string.
 *  Excludes empty arrays and default values to minimize output size.
 */
export function serializeScipIndex(index: ScipIndex): string {
  return JSON.stringify(index);
}

/** Serialize a SCIP Index to JSON with indentation for debugging. */
export function serializeScipIndexPretty(index: ScipIndex): string {
  return JSON.stringify(index, null, 2);
}

/** Calculate statistics for a SCIP index. */
export function scipStats(index: ScipIndex): {
  documentCount: number;
  occurrenceCount: number;
  symbolCount: number;
  externalSymbolCount: number;
  relationshipCount: number;
} {
  let occurrenceCount = 0;
  let symbolCount = 0;
  let relationshipCount = 0;

  for (const doc of index.documents) {
    occurrenceCount += doc.occurrences.length;
    symbolCount += doc.symbols.length;
    for (const sym of doc.symbols) {
      relationshipCount += sym.relationships.length;
    }
  }

  return {
    documentCount: index.documents.length,
    occurrenceCount,
    symbolCount,
    externalSymbolCount: index.externalSymbols.length,
    relationshipCount,
  };
}