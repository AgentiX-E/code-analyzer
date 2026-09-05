// @code-analyzer/analyzer — Tree-sitter Base Provider
// AST-based parsing using tree-sitter for production-grade accuracy.
// Falls back to regex-based parsing if tree-sitter packages are not available.

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture, CaptureTag, ImportSemantics } from '@code-analyzer/shared';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Taint analysis types
// ---------------------------------------------------------------------------

/** A taint source — where untrusted/external data enters the program */
export interface TaintSource {
  /** The variable/parameter name that receives tainted data */
  name: string;
  /** The source type (e.g., user_input, file_read, network, env_var) */
  sourceType: string;
  /** Line number (1-based) */
  line: number;
  /** The full source text of the taint source expression */
  text: string;
  /** Additional metadata */
  properties?: Record<string, string>;
}

/** A taint sink — a dangerous operation that should not receive tainted data */
export interface TaintSink {
  /** The function/method name that is dangerous */
  name: string;
  /** The sink type (e.g., sql_exec, os_command, file_write, eval) */
  sinkType: string;
  /** Line number (1-based) */
  line: number;
  /** The full source text of the taint sink expression */
  text: string;
  /** Additional metadata */
  properties?: Record<string, string>;
}

/** A taint sanitizer — an operation that cleans/validates tainted data */
export interface TaintSanitizer {
  /** The sanitizer function/variable name */
  name: string;
  /** The sanitizer type (e.g., validation, encoding, escaping, whitelist) */
  sanitizerType: string;
  /** Line number (1-based) */
  line: number;
  /** The full source text of the sanitizer expression */
  text: string;
  /** Additional metadata */
  properties?: Record<string, string>;
}

/**
 * A language provider that additionally exposes taint analysis (source / sink /
 * sanitizer extraction). Both TreeSitterBaseProvider and the pure-regex config
 * providers implement this, so callers can uniformly query taint metadata.
 */
export interface TaintProvider extends LanguageProvider {
  extractTaintSources(source: string): TaintSource[];
  extractTaintSinks(source: string): TaintSink[];
  extractSanitizers(source: string): TaintSanitizer[];
}

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
    const Parser = require('tree-sitter') as TreeSitterParserClass & {
      Query: new (language: TreeSitterLanguage, query: string) => TreeSitterQuery;
    };
    treeSitterParserClass = Parser;
    return Parser;
  } catch {
    /* v8 ignore start -- @preserve -- require('tree-sitter') never throws in the bundled runtime */
    return null;
  }
  /* v8 ignore stop */
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
    /* v8 ignore next -- @preserve -- getTreeSitter always returns a parser in the bundled runtime */
    if (ParserClass) {
      this.parser = new ParserClass();
      const grammar = this.loadGrammar();
      if (grammar) {
        this.languageGrammar = grammar;
        try {
          this.parser.setLanguage(grammar);
          /* v8 ignore start -- @preserve -- bundled grammar never fails setLanguage */
        } catch {
          // Grammar failed to load — fall back to regex
          this.parser = null;
          this.languageGrammar = null;
        }
        /* v8 ignore stop */
      } else {
        this.parser = null;
      }
    }
  }

  /** Load the language-specific grammar. Subclasses must implement. */
  protected abstract loadGrammar(): TreeSitterLanguage | null;

  /**
   * Get node type → capture tag mappings. Override to drive the default
   * {@link walkAndCapture} implementation. Providers that override
   * walkAndCapture directly do not need to provide mappings.
   */
  protected getNodeMappings(): NodeTypeMapping[] {
    return [];
  }

  // -----------------------------------------------------------------------
  // Primary parse method — walks the AST and emits UnifiedCapture
  // -----------------------------------------------------------------------

  parse(source: string, filePath: string): UnifiedCapture[] {
    // Strip BOM (Byte Order Mark) and zero-width characters before parsing.
    const sanitized = this.sanitizeSource(source);
    this.source = sanitized;
    this.filePath = filePath;

    if (!this.parser || !this.languageGrammar) {
      return this.fallbackParse(sanitized, filePath);
    }

    try {
      const captures: UnifiedCapture[] = [];

      const tree = this.parser.parse(sanitized);
      const rootNode = tree.rootNode;

      if (rootNode.hasError) {
        // If the AST has parse errors, fall back to regex
        return this.fallbackParse(sanitized, filePath);
      }

      this.walkAndCapture(rootNode, captures);

      return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
    } catch {
      /* v8 ignore start -- @preserve -- parser.parse never throws for a valid grammar */
      return this.fallbackParse(sanitized, filePath);
    }
    /* v8 ignore stop */
  }

  /**
   * Sanitize source text before parsing:
   * 1. Strip BOM (Byte Order Mark) — \uFEFF at file start
   * 2. Strip zero-width characters (\u200B, \u200C, \u200D, \uFEFF anywhere)
   * 3. Normalize line endings to LF
   * This prevents tree-sitter parse failures on files with invisible characters.
   */
  protected sanitizeSource(source: string): string {
    return source
      .replace(/^\uFEFF/, '') // BOM at start
      .replace(/[\u200B\u200C\u200D]/g, '') // zero-width spaces/joiners
      .replace(/\uFEFF/g, '') // BOM anywhere
      .replace(/\r\n/g, '\n') // CRLF → LF
      .replace(/\r/g, '\n'); // CR → LF
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
      /* v8 ignore start -- @preserve -- parser.parse never throws for a valid grammar */
      return this.fallbackExtractImports(source);
    }
    /* v8 ignore stop */
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
      /* v8 ignore start -- @preserve -- parser.parse never throws for a valid grammar */
      return this.fallbackIsExported(source, symbolName);
    }
    /* v8 ignore stop */
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
    if (node.type === 'class_declaration' || node.type === 'class_definition') {
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
    // Base default: no import detection. 19 of 21 subclasses override this with
    // a language-specific import walk. The two providers that inherit this
    // default (html, json) have no import syntax, so the walk only recurses.
    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  /** Walk the AST to check if a symbol is exported */
  protected checkExported(_node: TreeSitterSyntaxNode, _symbolName: string): boolean {
    // Base default: no export detection. 19 of 21 subclasses override this with
    // a language-specific export check. The two providers that inherit this
    // default (html, json) have no export syntax, so no symbol is ever exported.
    return false;
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
      // Java/Kotlin: superclass → type_identifier
      if (
        child.type === 'class_heritage' ||
        child.type === 'superclass' ||
        child.type === 'extends_clause'
      ) {
        const parts: string[] = [];
        this.collectIdentifiers(child, parts);
        /* v8 ignore next -- @preserve -- a heritage clause always contains at least one identifier */
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
            /* v8 ignore next -- @preserve -- an implements_clause always contains at least one identifier */
            if (parts.length > 0) return parts.join(',');
          }
        }
      }
    }
    return undefined;
  }

  /** Recursively collect identifier/type_identifier texts from a node */
  protected collectIdentifiers(node: TreeSitterSyntaxNode, parts: string[]): void {
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

    // this.parser is only set after getTreeSitter() succeeds in the constructor,
    // so the module-level parser class is cached and guaranteed non-null here.
    const ParserClass = getTreeSitter();
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

  // -----------------------------------------------------------------------
  // Call site capture — AST-based function/method call extraction
  // -----------------------------------------------------------------------

  /** Check if a node type represents a call expression */
  protected isCallNodeType(nodeType: string): boolean {
    return [
      'call_expression',
      'method_invocation',
      'new_expression',
      'function_call',
      'member_call',
      'call',
      'invocation_expression',
      'member_access_expression',
      'postfix_unary_expression',
      'binary_expression',
      'method_call',
      'explicit_constructor_invocation',
      'prefix_expression',
      'selector_expression',
      'send',
      'fcall',
      'command',
    ].includes(nodeType);
  }

  /** Emit a UnifiedCapture for a call site node */
  protected emitCallCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const name = this.extractCallName(node);
    if (!name) return;

    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // Find containing function/method
    let containerName: string | undefined;
    const parent = this.findContainerNode(node);
    if (parent) {
      containerName = this.extractContainerName(parent);
    }

    const tag = this.getCallTagForNodeType(node.type);

    captures.push({
      tag,
      text: node.text,
      startLine,
      endLine,
      startByte: node.startIndex,
      endByte: node.endIndex,
      name,
      containerName,
      properties: {
        filePath: this.filePath,
        callType: this.isMethodCall(node) ? 'method' : 'function',
      },
    });
  }

  /** Determine the capture tag for a call node type */
  protected getCallTagForNodeType(nodeType: string): CaptureTag {
    // The only callers (js/ts) emit either call_expression or new_expression;
    // no other node type reaches this method.
    return nodeType === 'new_expression' ? CAPTURE_TAGS.NEW_EXPRESSION : CAPTURE_TAGS.FUNCTION_CALL;
  }

  /** Check if a call node is a method call (has a receiver/object) */
  protected isMethodCall(node: TreeSitterSyntaxNode): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (
        child.type === 'member_expression' ||
        child.type === 'dot' ||
        child.type === 'selector' ||
        child.type === 'field_access' ||
        child.type === 'scope_resolution'
      ) {
        return true;
      }
    }
    return false;
  }

  /** Extract the called function/method name from a call expression */
  protected extractCallName(node: TreeSitterSyntaxNode): string | undefined {
    // A plain call (foo()) or constructor (new Foo()) carries the name as a
    // direct function/identifier/type_identifier child.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (
        child.type === 'function' ||
        child.type === 'identifier' ||
        child.type === 'type_identifier'
      ) {
        return child.text;
      }
    }

    // A method call (obj.method()) carries the name in a member_expression's
    // property_identifier child.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'member_expression') {
        for (let j = 0; j < child.childCount; j++) {
          const prop = child.child(j);
          if (prop.type === 'property_identifier') return prop.text;
        }
      }
    }

    return undefined;
  }

  // -----------------------------------------------------------------------
  // Taint analysis — source / sink / sanitizer extraction
  // -----------------------------------------------------------------------

  /** Extract taint sources from source code using AST walking */
  extractTaintSources(source: string): TaintSource[] {
    if (!this.parser || !this.languageGrammar) {
      return this.fallbackExtractTaintSources(source);
    }

    try {
      const tree = this.parser.parse(source);
      const sources: TaintSource[] = [];
      this.walkForTaintSources(tree.rootNode, sources);
      return sources;
    } catch {
      /* v8 ignore start -- @preserve -- parser.parse never throws for a valid grammar */
      return this.fallbackExtractTaintSources(source);
    }
    /* v8 ignore stop */
  }

  /** Walk the AST to find taint sources */
  protected walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    // Base default: no taint sources are recognized. Subclasses override this
    // method to detect language-specific taint sources.
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  /** Extract taint sinks from source code using AST walking */
  extractTaintSinks(source: string): TaintSink[] {
    if (!this.parser || !this.languageGrammar) {
      return this.fallbackExtractTaintSinks(source);
    }

    try {
      const tree = this.parser.parse(source);
      const sinks: TaintSink[] = [];
      this.walkForTaintSinks(tree.rootNode, sinks);
      return sinks;
    } catch {
      /* v8 ignore start -- @preserve -- parser.parse never throws for a valid grammar */
      return this.fallbackExtractTaintSinks(source);
    }
    /* v8 ignore stop */
  }

  /** Walk the AST to find taint sinks */
  protected walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    // Base default: no taint sinks are recognized. Subclasses override this
    // method to detect language-specific taint sinks.
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSinks(node.child(i), sinks);
    }
  }

  /** Extract taint sanitizers from source code using AST walking */
  extractSanitizers(source: string): TaintSanitizer[] {
    if (!this.parser || !this.languageGrammar) {
      return this.fallbackExtractSanitizers(source);
    }

    try {
      const tree = this.parser.parse(source);
      const sanitizers: TaintSanitizer[] = [];
      this.walkForSanitizers(tree.rootNode, sanitizers);
      return sanitizers;
    } catch {
      /* v8 ignore start -- @preserve -- parser.parse never throws for a valid grammar */
      return this.fallbackExtractSanitizers(source);
    }
    /* v8 ignore stop */
  }

  /** Walk the AST to find taint sanitizers */
  protected walkForSanitizers(node: TreeSitterSyntaxNode, sanitizers: TaintSanitizer[]): void {
    // Base default: no sanitizers are recognized. Subclasses override this
    // method to detect language-specific sanitizers.
    for (let i = 0; i < node.childCount; i++) {
      this.walkForSanitizers(node.child(i), sanitizers);
    }
  }

  // -----------------------------------------------------------------------
  // Fallback taint methods
  // -----------------------------------------------------------------------

  /** Regex-based fallback for taint source extraction */
  protected fallbackExtractTaintSources(_source: string): TaintSource[] {
    return [];
  }

  /** Regex-based fallback for taint sink extraction */
  protected fallbackExtractTaintSinks(_source: string): TaintSink[] {
    return [];
  }

  /** Regex-based fallback for sanitizer extraction */
  protected fallbackExtractSanitizers(_source: string): TaintSanitizer[] {
    return [];
  }

  // -----------------------------------------------------------------------
  // Fallback methods — subclasses must override to provide regex fallbacks
  // -----------------------------------------------------------------------

  protected abstract fallbackParse(source: string, filePath: string): UnifiedCapture[];

  protected abstract fallbackExtractImports(source: string): ParsedImport[];

  protected abstract fallbackIsExported(source: string, symbolName: string): boolean;
}
