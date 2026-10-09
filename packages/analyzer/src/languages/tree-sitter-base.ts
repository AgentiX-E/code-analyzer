// @code-analyzer/analyzer — Tree-sitter Base Provider
// AST-based parsing using tree-sitter for production-grade accuracy.
// Falls back to regex-based parsing if tree-sitter packages are not available.

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { childrenOf, namedChildrenOf } from './syntax-children.js';

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture, CaptureTag, ImportSemantics } from '@code-analyzer/shared';

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
  /** Return the named child that carries the given grammar field, or null. */
  childForFieldName(fieldName: string): TreeSitterSyntaxNode | null;
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

function getTreeSitter(): TreeSitterParserClass {
  if (treeSitterParserClass) return treeSitterParserClass;
  // tree-sitter is a direct dependency of the analyzer, so this require never
  // throws in the bundled runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Parser = require('tree-sitter') as TreeSitterParserClass & {
    Query: new (language: TreeSitterLanguage, query: string) => TreeSitterQuery;
  };
  treeSitterParserClass = Parser;
  return Parser;
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

  /**
   * The doc comment most recently passed, waiting for the declaration it describes.
   *
   * **A walk sees a comment immediately before the declaration it belongs to**, because the two are siblings in the
   * tree and the walk is depth-first in source order. That is the whole association: no parent lookup, no range
   * arithmetic. **And it is cleared the moment a declaration consumes it**, which is what stops a comment ending up on
   * the symbol *after* the one it describes.
   *
   * `GraphNode.docstring` was `null` on every node in every language before this - the field, the tag and the reader
   * all existed, and no provider ever emitted anything to go in them.
   */
  protected pendingDocComment: string | null = null;

  /**
   * Whether the last `parse` gave up on the grammar and used the regex reader instead.
   *
   * **A fallback nobody reports is a different extraction wearing the same name.** When a grammar cannot read a file,
   * the provider quietly switches to a regex reader that finds a smaller and differently-shaped set of symbols - no
   * comments, no imports, no annotations. **The caller sees a successful parse and a shorter list**, and there has
   * been no way to tell the two apart.
   *
   * **It was found by asking groovy a question**: `def name(a) { ... }` reports a parse error, the fallback runs, and
   * every groovy line in a twenty-language scan differed from every other line for that reason rather than for a
   * reason about doc comments. **A fact that changes what the symbols are belongs where a caller can read it.**
   */
  protected parseFellBack = false;

  /** Whether the last `parse` used the regex reader rather than the grammar. */
  get lastParseWasARegularExpressionFallback(): boolean {
    return this.parseFellBack;
  }
  protected filePath: string = '';

  abstract readonly language: string;
  abstract readonly displayName: string;
  abstract readonly extensions: string[];
  abstract readonly globs: string[];
  abstract readonly importSemantics: ImportSemantics;

  constructor() {
    const ParserClass = getTreeSitter();
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
    // **Per file**, so the last comment of one file cannot land on the first symbol of the next.
    this.pendingDocComment = null;
    this.parseFellBack = false;
    // Strip BOM (Byte Order Mark) and zero-width characters before parsing.
    const sanitized = this.sanitizeSource(source);
    this.filePath = filePath;

    if (!this.parser || !this.languageGrammar) {
      this.parseFellBack = true;
      return this.finishCaptures(this.fallbackParse(sanitized, filePath));
    }

    const captures: UnifiedCapture[] = [];

    const tree = this.parser.parse(sanitized);
    const rootNode = tree.rootNode;

    if (rootNode.hasError) {
      // If the AST has parse errors, fall back to regex
      this.parseFellBack = true;
      return this.finishCaptures(this.fallbackParse(sanitized, filePath));
    }

    this.walkAndCapture(rootNode, captures);

    return this.finishCaptures(captures);
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
    // **Written here, read by providers.** `rust.ts` and `python.ts` slice `this.source` to decide publicness and to
    // read the text either side of a node, so **this assignment is live even though nothing in this file reads it** -
    // and an attempt to remove it as a dead field broke those two providers. **A field with a different audience is
    // not a dead field.**
    this.source = source;
    this.source = source;

    if (!this.parser || !this.languageGrammar) {
      return this.fallbackExtractImports(source);
    }

    const tree = this.parser.parse(source);
    const rootNode = tree.rootNode;
    const imports: ParsedImport[] = [];

    this.walkForImports(rootNode, imports);

    return imports;
  }

  // -----------------------------------------------------------------------
  // Export detection — walks the AST for export/visibility nodes
  // -----------------------------------------------------------------------

  /** **The tree for `parsedFor`**, so repeated questions about one file parse it once. */
  protected parsedTree: TreeSitterTree | null = null;
  /** The source the cached tree describes, compared by reference and length. */
  protected parsedFor: string | null = null;

  isExported(source: string, symbolName: string): boolean {

    this.source = source;

    if (!this.parser || !this.languageGrammar) {
      return this.fallbackIsExported(source, symbolName);
    }

    // **Reuse the tree when the same source is asked about again, and this is the difference between a linear and a
    // quadratic index.** The `parse` phase calls `isExported` **once per capture**, and the implementation below used
    // to call `this.parser.parse(source)` **every time** - so a 217-line test file with **776 captures parsed the
    // same text 776 times**, measured at **3,852ms** where a single parse is **37ms**. **A 1,237-line file with 138
    // captures took 411ms**, and the cost grows in both directions: more content means more captures *and* a dearer
    // parse. **A real repository at 142 files did not finish in ten minutes on a CI runner.**
    //
    // **Keyed on the source string rather than invalidated explicitly**, because `isExported` receives the source and
    // has no other reason to know when it changed - and **a stale tree would be a wrong answer, while a repeated
    // parse is only a slow one.** The comparison is a reference check first and a length check second, so the common
    // case costs nothing: the `parse` phase passes **the same string object** it just parsed.
    const cached =
      this.parsedFor === source ||
      (this.parsedFor !== null && this.parsedFor.length === source.length && this.parsedFor === source);
    const tree = cached && this.parsedTree ? this.parsedTree : this.parser.parse(source);
    if (!cached) {
      this.parsedFor = source;
      this.parsedTree = tree;
    }
    const rootNode = tree.rootNode;
    return this.checkExported(rootNode, symbolName);
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
    for (const child of childrenOf(node)) {
      this.walkAndCapture(child, captures);
    }
  }

  /** Emit a UnifiedCapture for a matched AST node */
  /**
   * Attach the pending doc comment to a capture, or take the capture as the next pending comment.
   *
   * **This exists because a base-class change does not reach a subclass that replaced the method it lives in.** The
   * consumption used to sit inside `emitCapture`, and **typescript and javascript override `walkAndCapture` and build
   * their captures elsewhere** - so the mechanism reached no language at all. A method on the base can be called from
   * any walk, which is what lets it reach them.
   *
   * **A comment capture is the source and not a consumer.** A grammar that maps its comment nodes to the `docstring`
   * tag sends them down the same path as declarations, and the first version of this let a comment consume the pending
   * comment - **it consumed itself**.
   */
  /**
   * Give each declaration the comment above it, over a file's captures in source order.
   *
   * **This is the pass that makes the mechanism reach a language that replaced its walk.** `attachDocComment` is a
   * method a walk *can* call, and a walk that was written before it and builds captures inline will not. **A pass over
   * the finished list cannot be skipped by a walk**, because the walk does not own it.
   *
   * **Comments are not symbols and are dropped here**, which is also what keeps them out of the graph: they were
   * emitted as captures by grammars that map their comment nodes, and nothing downstream wants them as declarations.
   */
  private attachDocCommentsInOrder(captures: UnifiedCapture[]): void {
    let pending: string | null = null;
    const kept: UnifiedCapture[] = [];
    for (const capture of captures) {
      if (capture.tag === CAPTURE_TAGS.DOCSTRING || capture.tag === CAPTURE_TAGS.COMMENT) {
        const text = stripCommentSyntax(capture.text);
        if (text.length > 0) pending = text;
        continue;
      }
      if (pending !== null) {
        (capture.properties as Record<string, unknown>)['docstring'] = pending;
        pending = null;
      }
      kept.push(capture);
    }
    captures.length = 0;
    captures.push(...kept);
  }

  /**
   * The last stage of a parse, whichever way the parse went.
   *
   * **Two exits and one stage.** A file that parses and a file that falls back to regex both leave through here, and
   * the first version of this ran the doc-comment pass on one of them - so a file the grammar could not read got no
   * docstrings, and the guard caught it **by being written for two languages, where the second one exercises the
   * fallback.**
   *
   * **And it is the place a subclass cannot skip.** `attachDocComment` is a method a walk *may* call; a walk written
   * before it and building captures inline will not. **A stage in `parse` belongs to no provider** - bar `php`, which
   * replaces `parse` itself and is named as excluded.
   */
  private finishCaptures(captures: UnifiedCapture[]): UnifiedCapture[] {
    const ordered = captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
    this.attachDocCommentsInOrder(ordered);
    return ordered;
  }

  protected attachDocComment(capture: UnifiedCapture): UnifiedCapture {
    if (capture.tag === CAPTURE_TAGS.DOCSTRING || capture.tag === CAPTURE_TAGS.COMMENT) {
      const text = stripCommentSyntax(capture.text);
      if (text.length > 0) this.pendingDocComment = text;
      return capture;
    }
    if (this.pendingDocComment !== null) {
      (capture.properties as Record<string, unknown>)['docstring'] = this.pendingDocComment;
      this.pendingDocComment = null;
    }
    return capture;
  }

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
      for (const child of namedChildrenOf(node)) {
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
        properties['baseClasses'] = baseClasses;
      }
      const interfaces = this.extractInterfaces(node);
      if (interfaces) {
        properties['interfaces'] = interfaces;
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

    // **Both paths call the same step**, so the base and a subclass that replaced the walk cannot drift apart. A
    // comment is not collected as a capture - it is the docstring of whatever comes next.
    if (capture.tag === CAPTURE_TAGS.DOCSTRING || capture.tag === CAPTURE_TAGS.COMMENT) {
      this.attachDocComment(capture);
      return;
    }
    captures.push(this.attachDocComment(capture));
  }

  /** Walk the AST to find import statements */
  protected walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    // Base default: no import detection. 19 of 21 subclasses override this with
    // a language-specific import walk. The two providers that inherit this
    // default (html, json) have no import syntax, so the walk only recurses.
    for (const child of childrenOf(node)) {
      this.walkForImports(child, imports);
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
    for (const child of childrenOf(node)) {
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
    for (const child of childrenOf(node)) {
      // TypeScript/JavaScript: class_heritage → extends_clause → identifier
      // Java/Kotlin: superclass → type_identifier
      if (
        child.type === 'class_heritage' ||
        child.type === 'superclass' ||
        child.type === 'extends_clause'
      ) {
        const parts: string[] = [];
        this.collectIdentifiers(child, parts);
        // A heritage clause always carries at least one identifier, so `parts`
        // is never empty here.
        return parts.join(',');
      }
    }
    return undefined;
  }

  /** Extract implemented interfaces from a class node */
  protected extractInterfaces(node: TreeSitterSyntaxNode): string | undefined {
    for (const child of childrenOf(node)) {
      if (child.type === 'class_heritage') {
        for (let j = 0; j < child.childCount; j++) {
          const clause = child.child(j);
          if (clause.type === 'implements_clause') {
            const parts: string[] = [];
            this.collectIdentifiers(clause, parts);
            // An implements_clause always carries at least one identifier, so
            // `parts` is never empty here.
            return parts.join(',');
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
    for (const child of childrenOf(node)) {
      this.collectIdentifiers(child, parts);
    }
  }

  // -----------------------------------------------------------------------
  // Utility helpers
  // -----------------------------------------------------------------------

  /** Run a tree-sitter query against the source */
  public queryTree(source: string, queryStr: string): TreeSitterQueryMatch[] {
    if (!this.parser || !this.languageGrammar) return [];

    // this.parser is only set after getTreeSitter() succeeds in the constructor,
    // so the module-level parser class is cached and guaranteed non-null here.
    const ParserClass = getTreeSitter();
    const tree = this.parser.parse(source);
    const query = new ParserClass.Query(this.languageGrammar, queryStr);
    return query.matches(tree.rootNode);
  }

  /** Walk the AST with a visitor callback */
  public walkTree(
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
    for (const child of childrenOf(node)) {
      this.walkNode(child, depth + 1, visitor);
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
    for (const child of childrenOf(node)) {
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
    for (const child of childrenOf(node)) {
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
    for (const child of childrenOf(node)) {
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
    // **No parse for a capability the language has not claimed.** The walk this would use is the base's,
    // which collects nothing, so the answer is known before the file is read.
    if (!claimsTaintExtraction(this)) return [];

    if (!this.parser || !this.languageGrammar) {
      return this.fallbackExtractTaintSources(source);
    }

    const tree = this.parser.parse(source);
    const sources: TaintSource[] = [];
    this.walkForTaintSources(tree.rootNode, sources);
    return sources;
  }

  /** Walk the AST to find taint sources */
  protected walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    // Base default: no taint sources are recognized. Subclasses override this
    // method to detect language-specific taint sources.
    for (const child of childrenOf(node)) {
      this.walkForTaintSources(child, sources);
    }
  }

  /** Extract taint sinks from source code using AST walking */
  extractTaintSinks(source: string): TaintSink[] {
    // **No parse for a capability the language has not claimed.** The walk this would use is the base's,
    // which collects nothing, so the answer is known before the file is read.
    if (!claimsTaintExtraction(this)) return [];

    if (!this.parser || !this.languageGrammar) {
      return this.fallbackExtractTaintSinks(source);
    }

    const tree = this.parser.parse(source);
    const sinks: TaintSink[] = [];
    this.walkForTaintSinks(tree.rootNode, sinks);
    return sinks;
  }

  /** Walk the AST to find taint sinks */
  protected walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    // Base default: no taint sinks are recognized. Subclasses override this
    // method to detect language-specific taint sinks.
    for (const child of childrenOf(node)) {
      this.walkForTaintSinks(child, sinks);
    }
  }

  /** Extract taint sanitizers from source code using AST walking */
  extractSanitizers(source: string): TaintSanitizer[] {
    // **No parse for a capability the language has not claimed.** The walk this would use is the base's,
    // which collects nothing, so the answer is known before the file is read.
    if (!claimsTaintExtraction(this)) return [];

    if (!this.parser || !this.languageGrammar) {
      return this.fallbackExtractSanitizers(source);
    }

    const tree = this.parser.parse(source);
    const sanitizers: TaintSanitizer[] = [];
    this.walkForSanitizers(tree.rootNode, sanitizers);
    return sanitizers;
  }

  /** Walk the AST to find taint sanitizers */
  protected walkForSanitizers(node: TreeSitterSyntaxNode, sanitizers: TaintSanitizer[]): void {
    // Base default: no sanitizers are recognized. Subclasses override this
    // method to detect language-specific sanitizers.
    for (const child of childrenOf(node)) {
      this.walkForSanitizers(child, sanitizers);
    }
  }

  // -----------------------------------------------------------------------
  // Fallback taint methods
  // -----------------------------------------------------------------------

  /** Regex-based fallback for taint source extraction */
  public fallbackExtractTaintSources(_source: string): TaintSource[] {
    return [];
  }

  /** Regex-based fallback for taint sink extraction */
  public fallbackExtractTaintSinks(_source: string): TaintSink[] {
    return [];
  }

  /** Regex-based fallback for sanitizer extraction */
  public fallbackExtractSanitizers(_source: string): TaintSanitizer[] {
    return [];
  }

  // -----------------------------------------------------------------------
  // Fallback methods — subclasses must override to provide regex fallbacks
  // -----------------------------------------------------------------------

  public abstract fallbackParse(source: string, filePath: string): UnifiedCapture[];

  public abstract fallbackExtractImports(source: string): ParsedImport[];

  public abstract fallbackIsExported(source: string, symbolName: string): boolean;
}

/**
 * Whether a provider has claimed taint extraction for its language.
 *
 * **Read from the prototype, because that is where a claim lives.** The base class implements all three `extract*`
 * methods for every language and its walks recognise nothing, so a language with no taint vocabulary still paid a
 * full parse and a full tree walk, **three times per file**. Measured on TypeScript: 14 + 13 + 17 ms per file for
 * three empty arrays - eighteen seconds over a corpus of 389 files, computing nothing - and the parse phase had
 * already parsed the same content once.
 *
 * A provider that has not overridden a walk has not claimed the capability, and this answers that without parsing to
 * find out.
 */
export function claimsTaintExtraction(provider: unknown): boolean {
  const base = TreeSitterBaseProvider.prototype as unknown as Record<string, unknown>;
  // Walk the prototype chain to the class that DECLARED the walk - not an instance, and not a subclass that only
  // inherits it, which would make every language look as though it had claimed the capability.
  let proto = Object.getPrototypeOf(provider) as Record<string, unknown> | null;
  while (proto && proto !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(proto, 'walkForTaintSources')) {
      return proto['walkForTaintSources'] !== base['walkForTaintSources'];
    }
    proto = Object.getPrototypeOf(proto) as Record<string, unknown> | null;
  }
  return false;
}

/**
 * A comment's text without its markers, so a docstring reads as prose rather than as syntax.
 *
 * **Deliberately not comment-type aware.** Block, line and hash comments all reduce
 * to their lines, and the languages that use a form this does not know still get their text - **just with its markers
 * left on**, which is a worse docstring than a clean one and a better one than none.
 */
function stripCommentSyntax(text: string): string {
  return text
    .replace(/^\s*\/\*\*?/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').replace(/^\s*(\/\/|#|--|<!--|-->)\s?/, '').trimEnd())
    .join('\n')
    .trim();
}
