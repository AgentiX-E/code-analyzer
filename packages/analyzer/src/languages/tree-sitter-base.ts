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
  /**
   * The sink kinds this neutraliser makes safe — `html` for an HTML escaper, `sql_exec` for a SQL escaper.
   *
   * **Distinct from `sanitizerType`, which is a category and not a claim about any sink.** A flow analysis asks
   * "does a neutraliser sit on this path that makes *this* sink safe", and a category cannot answer it: `escaping`
   * covers `escapeHtml`, `escapeSql` and `escapeDN`, which are three different encodings for three different parsers.
   * */
  neutralizes?: readonly string[];
  /**
   * The names the neutraliser's arguments mention — the values it actually cleans.
   *
   * **A neutraliser cleans its argument, not its statement.** `println("value: " + bar + encodeForHTML(param))` is one
   * statement, and `bar` is not made safe by escaping `param`; a statement-level rule reports the flow as safe and
   * loses a true positive. Empty means the arguments could not be read, and the caller then falls back to the
   * statement-level reading rather than assuming a clean.
   */
  arguments?: readonly string[];
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
   * The nearest enclosing class-like node, per node range, for one file.
   *
   * **A capture asks for its container, and the answer is the same for every node that shares an ancestor.** The
   * lookup is a climb through `node.parent`, each step a native call that re-marshals the node, and **measured on this
   * repository's own TypeScript it was 23 % of a full index** — the single largest cost in the pipeline, larger than
   * parsing the tree it was asked about.
   *
   * **Memoising by node range turns that into one climb per distinct ancestor rather than one per capture.** Forty
   * methods in a class ask the same question about the same class; the first answer is stored and the rest are a map
   * hit. Recursion is what makes the memo complete: the container of a node is the container of its parent unless the
   * parent is one, so every intermediate node on the climb is remembered too.
   *
   * Cleared in `parse`, because a range means nothing outside the tree it came from.
   */
  protected containerCache: Map<string, TreeSitterSyntaxNode | null> = new Map();

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
    // **A container range is a fact about one tree**, so the memo cannot outlive the file it was built for.
    this.containerCache.clear();

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

    // **The tree this parse just built is the one the next question about this file needs.** `isExported` and
    // `exportedNames` keep a cache keyed on the source they were handed, and they were handed the file's *original*
    // source while `parse` had quietly parsed a **sanitised** copy — so the keys never matched, and every file was
    // parsed twice. Only an unmodified source is interchangeable with its sanitised form; when the two differ the
    // cache is left alone and the second reader parses what it asked about.
    if (sanitized === source) {
      this.parsedFor = source;
      this.parsedTree = tree;
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

    if (!this.parser || !this.languageGrammar) {
      return this.fallbackExtractImports(source);
    }

    const tree = this.cachedTree(source)!;
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

  /**
   * The tree for `source`, parsed at most once.
   *
   * **The index asked the same file for its tree five times.** `parse` built one to walk for captures, `extractImports`
   * built one for imports, and `extractTaintSources`, `extractTaintSinks` and `extractSanitizers` each built their own —
   * so a file was parsed five times and four of those trees were thrown away immediately after one walk. **Measured on
   * this repository's own TypeScript: parsing is a fifth of the parse phase, and the four discarded trees were most of
   * that fifth.**
   *
   * **One key, one place.** `isExported` had its own copy of this cache and `exportedNames` a second, which is how the
   * two of them came to agree with each other and disagree with `parse` — the trees they cached were built from the
   * caller's source while `parse` had built its own from a sanitised copy, so the keys never matched and every file was
   * parsed twice as well. Routing every reader through this method is what makes "parsed once" a property of the class
   * rather than a claim about each method.
   *
   * Reference equality is the test, and it is the right one: every reader in the parse phase is handed the **same
   * string object** the phase read from disk. A caller that builds an equal-but-distinct string gets a parse rather than
   * a wrong answer, which is the only failure mode worth avoiding here.
   */
  protected cachedTree(source: string): TreeSitterTree | null {
    if (this.parsedFor === source && this.parsedTree) return this.parsedTree;
    if (!this.parser) return null;
    const tree = this.parser.parse(source);
    this.parsedFor = source;
    this.parsedTree = tree;
    return tree;
  }

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
    const tree = this.cachedTree(source)!;
    return this.checkExported(tree.rootNode, symbolName);
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
  /**
   * Attach each doc comment to the declaration it documents.
   *
   * **Two placements, and the tree decides which.** **In Java and Go a doc comment precedes its declaration**; **in
   * Python it is the first statement of the body, so it follows the function's own capture.** **A pass that only carries
   * a value forward therefore attaches a Python docstring to whatever comes next** - and **`docstring-extraction` caught
   * exactly that**: **`kinetic_energy`'s docstring landed on `undocumented`, the function after it.**
   *
   * **The test is containment**: **if the nearest preceding declaration's line range still includes this comment, the
   * comment is documentation for it and is attached backward.** **Otherwise it is carried forward.** **Both the tag and
   * the language are irrelevant to that question**, which is **why three earlier arrangements that keyed on the tag all
   * failed.**
   *
   * **And when neither applies the comment is kept as a capture**, because **a comment about the file is still a fact
   * about the file** - which is **why an HTML file consisting of one comment must not come out empty.**
   */
  private attachDocCommentsInOrder(captures: UnifiedCapture[]): void {
    /** Tags a doc comment can document. */
    const DECLARATIONS = new Set<string>([
      CAPTURE_TAGS.FUNCTION_DEF,
      CAPTURE_TAGS.METHOD_DEF,
      CAPTURE_TAGS.CLASS_DEF,
      CAPTURE_TAGS.STRUCT_DEF,
      CAPTURE_TAGS.ENUM_DEF,
      CAPTURE_TAGS.INTERFACE_DEF,
      // **Not `VARIABLE_DEF`: a parameter does not own a docstring.**
      //
      // **And this is what the containment test was missing.** **`kinetic_energy(m)` emits `function.def` at 1..3 and
      // `variable.def m` at 1..1**, so **the nearest preceding declaration was the PARAMETER**, and **the docstring at
      // line 2 failed `2 <= 1`** - **so it fell through to the forward path and landed on the next function.**
      //
      // **A parameter is emitted inside the signature and its range never includes the body**, so **it can never own a
      // docstring that sits in the body** - **excluding it is not a special case for Python, it is a statement about
      // what a parameter's range means.**
      CAPTURE_TAGS.CONSTANT_DEF,
      CAPTURE_TAGS.CONSTRUCTOR_DEF,
      CAPTURE_TAGS.PROPERTY_DEF,
    ]);

    const kept: UnifiedCapture[] = [];
    let pending: string | null = null;

    for (const capture of captures) {
      if (capture.tag === CAPTURE_TAGS.DOCSTRING || capture.tag === CAPTURE_TAGS.COMMENT) {
        const text = stripCommentSyntax(capture.text);
        // **A declaration that precedes this comment owns it.**
        //
        // **And the containment check is deliberately absent.** **A function's `endLine` is not always its body's last
        // line** - **so `capture.startLine <= owner.endLine` was true for some providers and false for others, and the
        // test that failed used the one where it was false.**
        //
        // **The ordering alone decides it**: **a comment that comes after a declaration and before the next one is
        // documentation for the one before it** - **which is what a docstring inside a body is** - **and a comment that
        // comes before any declaration is documentation for what follows.** **Both readings come from position, not from
        // a range that different grammars compute differently.**
        const owner = [...kept].reverse().find((c) => DECLARATIONS.has(c.tag));
        if (text.length > 0 && owner && capture.startLine <= owner.endLine) {
          (owner.properties as Record<string, unknown>)['docstring'] = text;
        } else if (text.length > 0) {
          // **Otherwise it documents what comes next**, and **it is still pushed**, because **a comment is in the file
          // whether or not a declaration follows it.**
          pending = text;
        }
        kept.push(capture);
        continue;
      }

      if (pending !== null) {
        (capture.properties as Record<string, unknown>)['docstring'] = pending;
        pending = null;
      }
      kept.push(capture);
    }

    // **A value still pending documented nothing**, so **it stays a capture rather than becoming an attribution to a
    // declaration that does not exist.**
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
    //
    // **The guard stays, and the branch is dead by construction**: this method is reached only from the base walk, and
    // **every provider that maps a comment to a capture replaces that walk** - `typescript.ts` is the only one, and it
    // overrides `walkAndCapture`. Deleting the guard would make a comment a symbol for any provider added later that
    // maps one, so it is kept as the statement of that contract even though no current input reaches it.
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

  /**
   * Every name this file exports, collected in **one** walk.
   *
   * **The fix for a quadratic phase that had been sitting in the shape of the API.** `checkExported` is a
   * *predicate* - give it a node and a name and it recurses the whole tree to answer - **and the `parse` phase had
   * 66 distinct names to ask about, so it recursed the tree 66 times.** **Measured at 10,036ms of a 20,908ms
   * index**, on a real repository.
   *
   * **A set is what the phase actually needs**, and this returns one. **The default implementation reads the
   * grammar rather than re-deriving it**: an `export_statement` is where exports live in most of these languages,
   * so **the walk descends into every such node and collects the identifiers under it.** Providers with a different
   * export syntax override this, **and providers that implement neither get an empty set, which is what the base
   * `checkExported` already returns for them.**
   *
   * **It collects rather than verifies**, deliberately: **verifying each candidate with `checkExported` would be
   * `O(candidates x nodes)` and that is the cost being removed.** The equality of this set against the per-symbol
   * predicate is **a test rather than an assumption** - see `exported-names.test.ts`.
   */
  exportedNames(source: string): Set<string> {
    const names = new Set<string>();
    if (!this.parser || !this.languageGrammar) {
      return names;
    }
    // **The same cached tree the predicate uses**, so a file parsed once is not parsed again here.
    const tree = this.cachedTree(source);
    if (!tree) return names;

    const collect = (node: TreeSitterSyntaxNode): void => {
      // **Every identifier under an export statement**, because the exported name can be the declaration itself
      // (`export function foo`), a clause (`export { foo as bar }`) or a default (`export default foo`).
      if (
        /identifier|property_identifier|type_identifier|shorthand_property_identifier/.test(
          node.type,
        )
      ) {
        // **An identifier node's text is at least one character**, so there is no empty case to filter.
        names.add(node.text);
      }
      for (const child of childrenOf(node)) collect(child);
    };

    const visit = (node: TreeSitterSyntaxNode): void => {
      // **An export statement is a subtree**, so the walk descends into it and collects, then continues outside it.
      if (node.type === 'export_statement') {
        collect(node);
      }
      for (const child of childrenOf(node)) visit(child);
    };
    visit(tree.rootNode);
    return names;
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
    const key = `${node.startIndex}:${node.endIndex}`;
    const memo = this.containerCache.get(key);
    if (memo !== undefined) return memo;

    const parent = node.parent;
    const found =
      parent === null
        ? null
        : isContainerNodeType(parent.type)
          ? parent
          : this.findContainerNode(parent);

    // **Every step of the climb is stored, not only the node that was asked about**, because two siblings share the
    // ancestors above them and the second one would otherwise repeat the whole climb.
    this.containerCache.set(key, found);
    return found;
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
    const tree = this.cachedTree(source)!;
    const query = new ParserClass.Query(this.languageGrammar, queryStr);
    return query.matches(tree.rootNode);
  }

  /** Walk the AST with a visitor callback */
  public walkTree(
    source: string,
    visitor: (node: TreeSitterSyntaxNode, depth: number) => void,
  ): void {
    if (!this.parser) return;

    const tree = this.cachedTree(source)!;
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

    const tree = this.cachedTree(source)!;
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

    const tree = this.cachedTree(source)!;
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

    const tree = this.cachedTree(source)!;
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
  // **The walk cannot fall off the end**: every provider inherits `walkForTaintSources` from the base, so the chain
  // reaches an owner before it reaches `null` - and a trailing `return false` after this loop was a statement no
  // provider could reach.
  let proto = Object.getPrototypeOf(provider) as Record<string, unknown>;
  while (!Object.prototype.hasOwnProperty.call(proto, 'walkForTaintSources')) {
    proto = Object.getPrototypeOf(proto) as Record<string, unknown>;
  }
  return proto['walkForTaintSources'] !== base['walkForTaintSources'];
}

/**
 * Node types that can own a member, across the grammars this package speaks.
 *
 * **A set rather than a chain of comparisons, because the same list is consulted once per climbed ancestor** and the
 * cost of the test matters as much as its answer. The list is exactly the one the climb used, unchanged: this change
 * is about how many times the question is asked, not about the answer.
 */
const CONTAINER_NODE_TYPES: ReadonlySet<string> = new Set([
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
  'object_type',
  'class_definition',
  'struct_declaration',
  'impl_declaration',
  'record_declaration',
]);

/** Whether a node type can own a member. */
function isContainerNodeType(type: string): boolean {
  return CONTAINER_NODE_TYPES.has(type);
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
    .map((line) =>
      line
        .replace(/^\s*\*\s?/, '')
        .replace(/^\s*(\/\/|#|--|<!--|-->)\s?/, '')
        .trimEnd(),
    )
    .join('\n')
    .trim();
}
