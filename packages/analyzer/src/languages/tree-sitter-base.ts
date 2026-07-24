// @code-analyzer/analyzer — Tree-sitter Base Provider
// AST-based parsing using tree-sitter for production-grade accuracy.
// Falls back to regex-based parsing if tree-sitter packages are not available.

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture, CaptureTag, ImportSemantics } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Tree-sitter type definitions (avoiding direct import for fallback)
// ---------------------------------------------------------------------------

export interface TreeSitterSyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly childCount: number;
  readonly namedChildCount: number;
  readonly hasError: boolean;
  child(index: number): TreeSitterSyntaxNode;
  namedChild(index: number): TreeSitterSyntaxNode;
  parent: TreeSitterSyntaxNode | null;
  walk(): TreeSitterTreeCursor;
}

interface TreeSitterTreeCursor {
  readonly nodeType: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  gotoFirstChild(): boolean;
  gotoNextSibling(): boolean;
  gotoParent(): boolean;
}

interface TreeSitterTree {
  readonly rootNode: TreeSitterSyntaxNode;
}

interface TreeSitterQueryMatch {
  readonly pattern: number;
  readonly captures: Array<{ readonly name: string; readonly node: TreeSitterSyntaxNode }>;
}

interface TreeSitterQuery {
  matches(node: TreeSitterSyntaxNode): TreeSitterQueryMatch[];
  captures(node: TreeSitterSyntaxNode): TreeSitterQueryMatch[];
}

export interface TreeSitterLanguage {
  readonly name: string;
  readonly language: unknown;
}

interface TreeSitterParser {
  setLanguage(language: TreeSitterLanguage): void;
  parse(source: string): TreeSitterTree;
  getLanguage(): TreeSitterLanguage | null;
}

interface TreeSitterParserClass {
  new (): TreeSitterParser;
  Query: new (language: TreeSitterLanguage, query: string) => TreeSitterQuery;
}

// ---------------------------------------------------------------------------
// Dynamic import helpers with graceful fallback
// ---------------------------------------------------------------------------

let treeSitterParserClass: TreeSitterParserClass | null = null;

function getTreeSitter(): TreeSitterParserClass | null {
  if (treeSitterParserClass) return treeSitterParserClass;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Parser = require('tree-sitter') as TreeSitterParserClass & { Query: new (language: TreeSitterLanguage, query: string) => TreeSitterQuery };
    treeSitterParserClass = Parser;
    return Parser;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Node type → Capture tag mappings
// ---------------------------------------------------------------------------

export interface NodeTypeMapping {
  /** The tree-sitter node type to match */
  nodeType: string;
  /** The capture tag to emit */
  captureTag: CaptureTag;
  /** Property key pointing to the name child node type */
  nameChildType?: string;
  /** Whether to extract the text from the node's first named child */
  useFirstNamedChild?: boolean;
}

// ---------------------------------------------------------------------------
// Abstract Tree-sitter Base Provider
// ---------------------------------------------------------------------------

export abstract class TreeSitterBaseProvider implements LanguageProvider {
  protected parser: TreeSitterParser | null = null;
  protected languageGrammar: TreeSitterLanguage | null = null;
  protected source: string = '';
  protected filePath: string = '';

  abstract readonly language: string;
  abstract readonly displayName: string;
  abstract readonly extensions: string[];
  abstract readonly globs: string[];
  abstract readonly importSemantics: ImportSemantics;

  constructor() {
    const ParserClass = getTreeSitter();
    if (ParserClass) {
      this.parser = new ParserClass();
      const grammar = this.loadGrammar();
      if (grammar) {
        this.languageGrammar = grammar;
        try {
          this.parser.setLanguage(grammar);
        } catch {
          // Grammar failed to load — fall back to regex
          this.parser = null;
          this.languageGrammar = null;
        }
      } else {
        this.parser = null;
      }
    }
  }

  /** Load the language-specific grammar. Subclasses must implement. */
  protected abstract loadGrammar(): TreeSitterLanguage | null;

  /** Get node type → capture tag mappings. Subclasses must implement. */
  protected abstract getNodeMappings(): NodeTypeMapping[];

  // -----------------------------------------------------------------------
  // Primary parse method — walks the AST and emits UnifiedCapture
  // -----------------------------------------------------------------------

  parse(source: string, filePath: string): UnifiedCapture[] {
    this.source = source;
    this.filePath = filePath;

    if (!this.parser || !this.languageGrammar) {
      return this.fallbackParse(source, filePath);
    }

    try {
      const captures: UnifiedCapture[] = [];

      const tree = this.parser.parse(source);
      const rootNode = tree.rootNode;

      if (rootNode.hasError) {
        // If the AST has parse errors, fall back to regex
        return this.fallbackParse(source, filePath);
      }

      this.walkAndCapture(rootNode, captures);

      return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
    } catch {
      return this.fallbackParse(source, filePath);
    }
  }

  // -----------------------------------------------------------------------
  // Import extraction — walks the AST for import nodes
  // -----------------------------------------------------------------------

  extractImports(source: string): ParsedImport[] {
    this.source = source;

    if (!this.parser || !this.languageGrammar) {
      return this.fallbackExtractImports(source);
    }

    try {
      const tree = this.parser.parse(source);
      const rootNode = tree.rootNode;
      const imports: ParsedImport[] = [];

      this.walkForImports(rootNode, imports);

      return imports;
    } catch {
      return this.fallbackExtractImports(source);
    }
  }

  // -----------------------------------------------------------------------
  // Export detection — walks the AST for export/visibility nodes
  // -----------------------------------------------------------------------

  isExported(source: string, symbolName: string): boolean {
    this.source = source;

    if (!this.parser || !this.languageGrammar) {
      return this.fallbackIsExported(source, symbolName);
    }

    try {
      const tree = this.parser.parse(source);
      const rootNode = tree.rootNode;
      return this.checkExported(rootNode, symbolName);
    } catch {
      return this.fallbackIsExported(source, symbolName);
    }
  }

  // -----------------------------------------------------------------------
  // AST walking helpers
  // -----------------------------------------------------------------------

  /** Walk the AST and emit captures based on node type mappings */
  protected walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const mappings = this.getNodeMappings();
    const nodeType = node.type;

    for (const mapping of mappings) {
      if (nodeType === mapping.nodeType) {
        this.emitCapture(node, mapping, captures);
        break;
      }
    }

    // Recurse into children
    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  /** Emit a UnifiedCapture for a matched AST node */
  protected emitCapture(
    node: TreeSitterSyntaxNode,
    mapping: NodeTypeMapping,
    captures: UnifiedCapture[],
  ): void {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // Find the name node
    let name: string | undefined;
    let nameNode: TreeSitterSyntaxNode | undefined;

    if (mapping.nameChildType) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === mapping.nameChildType) {
          nameNode = child;
          name = child.text;
          break;
        }
      }
    }

    if (!name && mapping.useFirstNamedChild && node.namedChildCount > 0) {
      const firstNamed = node.namedChild(0);
      nameNode = firstNamed;
      name = firstNamed.text;
    }

    if (!name) {
      name = node.text;
    }

    // Build properties
    const properties: Record<string, string> = {
      filePath: this.filePath,
    };

    // Find container (parent class/interface/etc.)
    let containerName: string | undefined;
    const parent = this.findContainerNode(node);
    if (parent) {
      containerName = this.extractContainerName(parent);
    }

    // Extract base classes for class-like nodes (extends/implements)
    if (
      node.type === 'class_declaration' ||
      node.type === 'class_definition'
    ) {
      const baseClasses = this.extractBaseClasses(node);
      if (baseClasses) {
        properties.baseClasses = baseClasses;
      }
      const interfaces = this.extractInterfaces(node);
      if (interfaces) {
        properties.interfaces = interfaces;
      }
    }

    const capture: UnifiedCapture = {
      tag: mapping.captureTag,
      text: node.text,
      startLine,
      endLine,
      startByte: nameNode ? nameNode.startIndex : node.startIndex,
      endByte: nameNode ? nameNode.endIndex : node.endIndex,
      name,
      containerName,
      properties,
    };

    captures.push(capture);
  }

  /** Walk the AST to find import statements */
  protected walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    const importNodeTypes = this.getImportNodeTypes();
    const nodeType = node.type;

    if (importNodeTypes.includes(nodeType)) {
      this.emitImport(node, imports);
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  /** Extract import info from an import AST node */
  protected emitImport(_node: TreeSitterSyntaxNode, _imports: ParsedImport[]): void {
    // Default implementation — subclasses should override for language-specific import parsing
  }

  /** Walk the AST to check if a symbol is exported */
  protected checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    // Check for export modifiers or statements
    const nodeType = node.type;
    const isExportRelated =
      nodeType.includes('export') ||
      this.isExportStatement(node);

    if (isExportRelated) {
      const name = this.extractNameFromNode(node);
      if (name === symbolName) return true;

      // Check children for the symbol name
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'identifier' || child.type === 'type_identifier' || child.type === 'property_identifier') {
          if (child.text === symbolName) return true;
        }
      }
    }

    // Recurse
    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }

    return false;
  }

  /** Subclasses can override to define import-related node types */
  protected getImportNodeTypes(): string[] {
    return [
      'import_statement',
      'import_declaration',
      'import_from_statement',
      'import_call',
      'lexical_declaration', // for require() calls
    ];
  }

  /** Subclasses can override for language-specific export node detection */
  protected isExportStatement(node: TreeSitterSyntaxNode): boolean {
    return node.type === 'export_statement' || node.type === 'export_default';
  }

  /** Extract the name identifier from a node */
  protected extractNameFromNode(node: TreeSitterSyntaxNode): string | undefined {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (
        child.type === 'identifier' ||
        child.type === 'type_identifier' ||
        child.type === 'property_identifier'
      ) {
        return child.text;
      }
    }
    return undefined;
  }

  /** Find the container (class/interface/enum) that encloses this node */
  protected findContainerNode(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode | null {
    let parent = node.parent;
    while (parent) {
      const ptype = parent.type;
      if (
        ptype === 'class_declaration' ||
        ptype === 'interface_declaration' ||
        ptype === 'enum_declaration' ||
        ptype === 'object_type' ||
        ptype === 'class_definition' ||
        ptype === 'struct_declaration' ||
        ptype === 'impl_declaration' ||
        ptype === 'record_declaration'
      ) {
        return parent;
      }
      parent = parent.parent;
    }
    return null;
  }

  /** Extract the name from a container node */
  protected extractContainerName(node: TreeSitterSyntaxNode): string | undefined {
    return this.extractNameFromNode(node);
  }

  /** Extract base class names from a class_declaration node */
  protected extractBaseClasses(node: TreeSitterSyntaxNode): string | undefined {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      // TypeScript/JavaScript: class_heritage → extends_clause → identifier
      // Python: argument_list → identifier
      // Java: superclass → type_identifier
      if (
        child.type === 'class_heritage' ||
        child.type === 'superclass' ||
        child.type === 'extends_clause'
      ) {
        const parts: string[] = [];
        this.collectIdentifiers(child, parts);
        if (parts.length > 0) return parts.join(',');
      }
      // Python-style class Foo(Bar): argument_list
      if (child.type === 'argument_list') {
        const parts: string[] = [];
        for (let j = 0; j < child.childCount; j++) {
          const arg = child.child(j);
          if (
            arg.type === 'identifier' ||
            arg.type === 'type_identifier' ||
            arg.type === 'attribute'
          ) {
            parts.push(arg.text);
          }
        }
        if (parts.length > 0) return parts.join(',');
      }
    }
    return undefined;
  }

  /** Extract implemented interfaces from a class node */
  protected extractInterfaces(node: TreeSitterSyntaxNode): string | undefined {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'class_heritage') {
        for (let j = 0; j < child.childCount; j++) {
          const clause = child.child(j);
          if (clause.type === 'implements_clause') {
            const parts: string[] = [];
            this.collectIdentifiers(clause, parts);
            if (parts.length > 0) return parts.join(',');
          }
        }
      }
    }
    return undefined;
  }

  /** Recursively collect identifier/type_identifier texts from a node */
  private collectIdentifiers(node: TreeSitterSyntaxNode, parts: string[]): void {
    if (
      node.type === 'identifier' ||
      node.type === 'type_identifier' ||
      node.type === 'property_identifier'
    ) {
      parts.push(node.text);
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.collectIdentifiers(node.child(i), parts);
    }
  }

  // -----------------------------------------------------------------------
  // Utility helpers
  // -----------------------------------------------------------------------

  /** Run a tree-sitter query against the source */
  protected queryTree(source: string, queryStr: string): TreeSitterQueryMatch[] {
    if (!this.parser || !this.languageGrammar) return [];

    const ParserClass = getTreeSitter();
    if (!ParserClass) return [];

    const tree = this.parser.parse(source);
    const query = new ParserClass.Query(this.languageGrammar, queryStr);
    return query.matches(tree.rootNode);
  }

  /** Walk the AST with a visitor callback */
  protected walkTree(
    source: string,
    visitor: (node: TreeSitterSyntaxNode, depth: number) => void,
  ): void {
    if (!this.parser) return;

    const tree = this.parser.parse(source);
    this.walkNode(tree.rootNode, 0, visitor);
  }

  private walkNode(
    node: TreeSitterSyntaxNode,
    depth: number,
    visitor: (node: TreeSitterSyntaxNode, depth: number) => void,
  ): void {
    visitor(node, depth);
    for (let i = 0; i < node.childCount; i++) {
      this.walkNode(node.child(i), depth + 1, visitor);
    }
  }

  /** Get source text for a node range */
  protected nodeText(source: string, node: TreeSitterSyntaxNode): string {
    return source.slice(node.startIndex, node.endIndex);
  }

  /** Get line number (1-based) for a node */
  protected nodeLine(_source: string, node: TreeSitterSyntaxNode): number {
    return node.startPosition.row + 1;
  }

  // -----------------------------------------------------------------------
  // Fallback methods — subclasses must override to provide regex fallbacks
  // -----------------------------------------------------------------------

  protected abstract fallbackParse(source: string, filePath: string): UnifiedCapture[];

  protected abstract fallbackExtractImports(source: string): ParsedImport[];

  protected abstract fallbackIsExported(source: string, symbolName: string): boolean;
}
