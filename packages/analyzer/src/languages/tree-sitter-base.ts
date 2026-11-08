// @code-analyzer/analyzer — Tree-sitter Base Provider
// AST-based parsing using tree-sitter for production-grade accuracy.
// Falls back to regex-based parsing if tree-sitter packages are not available.

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { extractConstantFacts } from './constant-fold.js';
import { extractContainerCalls } from './container-calls.js';
import { OVERLONG_LINE_BUDGET, maskOverlongLines } from './line-index.js';
import { extractDiscardedValueRegions, regionsOfType } from './regions.js';
import { extractReturnLines } from './return-sites.js';
import { signatureOf } from './signatures.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { cursorNode, exportedNamesByCursor, walkPreOrder } from './syntax-cursor.js';

import type { ConstantDialect, ConstantFacts } from './constant-fold.js';
import type { ContainerCall, ContainerDialect } from './container-calls.js';
import type { LanguageProvider, ParsedImport } from './provider.js';
import type { SourceRegion } from './regions.js';
import type { TreeSitterTreeCursor } from './syntax-cursor.js';
import type { TaintCollections } from './taint-scan.js';
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
  /** **Recovery is not failure**: a node the parser inserted to finish a construct, absent from the text. */
  readonly isMissing?: boolean;
  /** The node an unreadable span became. **This one is a failure**, and the walk has nothing to say about the span. */
  readonly isError?: boolean;
  child(index: number): TreeSitterSyntaxNode;
  namedChild(index: number): TreeSitterSyntaxNode;
  /** Return the named child that carries the given grammar field, or null. */
  childForFieldName(fieldName: string): TreeSitterSyntaxNode | null;
  parent: TreeSitterSyntaxNode | null;
  walk(): TreeSitterTreeCursor;
}

/** Re-exported so a provider can name the type of the cursor its tree hands back. */
export type { TreeSitterTreeCursor };

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

/**
 * The answer a provider without a constant dialect gives.
 *
 * **A fresh value on every call, not a shared singleton**: `ConstantFacts` holds a `Map`, and a reader that mutated one
 * would silently change every other file's answer.
 */
function noConstantFacts(): ConstantFacts {
  return { constants: new Map(), constantReturns: new Map(), unreachableLines: new Set() };
}

/**
 * Node types that denote a call, across the grammars this package speaks.
 *
 * **A set, because the test is asked once per node by every walk that emits call sites**, and it is exported so a walk
 * that reads types from a cursor can ask the same question without materialising the node it is asking about.
 */
/**
 * The tags whose capture is a declaration with a header: a function, a method, a constructor, or a named type.
 *
 * **A variable and a constant are excluded**, because `const x = 5` has no header to speak of - the text before the body
 * is the initialiser, and a signature that carried it would be a second copy of the value.
 */
export const SIGNATURE_CAPTURE_TAGS: ReadonlySet<string> = new Set([
  CAPTURE_TAGS.FUNCTION_DEF,
  CAPTURE_TAGS.METHOD_DEF,
  CAPTURE_TAGS.CONSTRUCTOR_DEF,
  CAPTURE_TAGS.CLASS_DEF,
  CAPTURE_TAGS.INTERFACE_DEF,
  CAPTURE_TAGS.ENUM_DEF,
  CAPTURE_TAGS.STRUCT_DEF,
  CAPTURE_TAGS.TRAIT_DEF,
  CAPTURE_TAGS.TYPE_DEF,
]);

/**
 * The node types across the grammars this package speaks that can carry a header.
 *
 * **A type filter rather than a field probe, because the probe would run on every node of every tree**: the walk visits
 * millions of nodes on a large repository and materialising each one to ask whether it has a `body` field would cost
 * more than the field is worth. A type in this set is still only a candidate - `signatureOf` decides - so the list being
 * generous costs nothing but the materialisation of a declaration node, which a capture needs anyway.
 */
export const SIGNATURE_NODE_TYPES: ReadonlySet<string> = new Set([
  // Functions and methods.
  'function_declaration',
  'function_definition',
  'function_item',
  'function_signature',
  'method_definition',
  'method_declaration',
  'method',
  'singleton_method',
  'constructor_declaration',
  'constructor_definition',
  'abstract_method_declaration',
  'abstract_method_signature',
  'method_signature',
  // Named types.
  'class_declaration',
  'abstract_class_declaration',
  'class_definition',
  'class',
  'interface_declaration',
  'interface_definition',
  'struct_declaration',
  'struct_item',
  'struct_specifier',
  'trait_declaration',
  'trait_item',
  'enum_declaration',
  'enum_item',
  'enum_specifier',
  'protocol_declaration',
  'extension_declaration',
  'object_declaration',
  'companion_object',
  'annotation_type_declaration',
  // Aliases, which have a header and no body at all.
  'type_alias_declaration',
  'type_declaration',
  'type_definition',
]);

export const CALL_NODE_TYPES: ReadonlySet<string> = new Set([
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
]);

/**
 * The call node types of the C-family grammars this package reads as TypeScript and JavaScript.
 *
 * **A union loses the languages that did not contribute to it, and this set is the receipt.** `CALL_NODE_TYPES` was
 * assembled from eight grammars and then consulted by the two providers whose grammar contributes two names to it -
 * `call_expression` and `new_expression`. The other four C-family-looking entries are not calls in those grammars at
 * all, and asking the question of every node made **`a ?? b` a call site with `a` as its callee**: measured on
 * `this.store.get(k) ?? 0`, one call produced two references, one of them named after the whole expression, and any
 * `x + y` in a TypeScript file became a `FUNCTION_CALL` to `x` - a phantom call site that the resolver could then
 * resolve to a function that was never called.
 */
export const C_FAMILY_CALL_NODE_TYPES: ReadonlySet<string> = new Set([
  'call_expression',
  'new_expression',
]);

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
      return this.finishCaptures(this.fallbackParse(this.boundedSource(sanitized), filePath));
    }

    const captures: UnifiedCapture[] = [];

    const tree = this.parser.parse(sanitized);
    const rootNode = tree.rootNode;
    this.signatureRoot = rootNode;

    if (hasUnrecoverableError(rootNode)) {
      // **A tree the parser could not read at all goes to the reader; one it repaired does not.**
      this.parseFellBack = true;
      return this.finishCaptures(this.fallbackParse(this.boundedSource(sanitized), filePath));
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

    // **A walk that exhausts the stack degrades to the reader rather than failing the file.**
    //
    // Twenty providers override `walkAndCapture` with their own recursion, and an input's nesting depth is bounded by
    // nothing this program controls: a JSON array 20 000 deep and a JavaScript expression parenthesised 20 000 times
    // both raise `RangeError: Maximum call stack size exceeded`. In the pipeline that was worse than one unread file -
    // the phase failed and every other file's captures went with it. The fallback path already exists for a grammar
    // that cannot read a file; this is the same answer for a grammar that cannot finish reading it, and
    // `lastParseWasARegularExpressionFallback` reports it, so the index says how much of itself came from the reader.
    try {
      this.walkAndCapture(rootNode, captures);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      this.parseFellBack = true;
      return this.finishCaptures(this.fallbackParse(this.boundedSource(sanitized), filePath));
    }

    return this.finishCaptures(captures);
  }

  /**
   * The source a text reader is given: blanked lines longer than the budget.
   *
   * **The AST walk never sees this** - a minified bundle is exactly what a grammar is good at - and every path that
   * hands a file to a regular expression does. A declaration pattern costs its worst case on a line of data, and the
   * worst case is cubic in the line length; `maskOverlongLines` states the fill and the reason it is not a space.
   */
  protected boundedSource(sanitized: string): string {
    return maskOverlongLines(sanitized, OVERLONG_LINE_BUDGET).text;
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

  /**
   * The tree **this** parse built, for the one pass that runs after the walk.
   *
   * **`parsedTree` cannot serve**: it is a cache keyed on the source it was handed, and it is deliberately left alone
   * when the source needed sanitising - so a pass reading it would attach one file's headers to another file's
   * declarations the first time a file with a BOM was parsed.
   */
  private signatureRoot: TreeSitterSyntaxNode | null = null;
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

    if (DECLARATION_FACT_NODES.has(nodeType)) {
      this.recordDeclaredReturn(node);
      this.recordDeclaredArity(node);
    }

    for (const mapping of mappings) {
      if (nodeType === mapping.nodeType) {
        this.emitCapture(node, mapping, captures);
        break;
      }
    }

    // Recurse into children
    //
    // **The recursion stays, and an iterative rewrite was measured and refused.** Twenty providers override this method
    // and several of them - `php`, `ruby` - handle the nodes they care about and then call `super.walkAndCapture(node)`
    // to descend, which works only because the base's own recursion dispatches through `this.walkAndCapture`. A stack
    // that called `emitCapture` for each node instead stopped at the first overridden node type: **22 tests across
    // `php-*` and `ruby-*` lost their captures.** What the depth needs is not a different traversal but a bound on the
    // damage, and `parse` supplies one: a walk that exhausts the stack falls back to the reader and says so.
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
    /**
     * The documentation waiting for the declaration below it, and the line its last piece ended on.
     *
     * **A doc comment is a block, and a line comment is one line of it.** Go documents a function with three `//` lines
     * and Godoc renders all three; Java does the same with `//` runs. **A pass that kept only the last line would hand
     * the graph the third of three sentences**, so a line comment directly under a pending one joins it. The second field
     * is what makes "directly under" a fact about the file rather than about the order captures were emitted in.
     */
    let pending: string | null = null;
    let pendingEndLine = -1;
    /**
     * The last declaration seen, which is the only candidate a comment can belong to.
     *
     * **The scan this replaces was quadratic and it is what crashed on a real file.** `[...kept].reverse().find(…)`
     * copied the whole list for every comment, so a generated API page - `docs/classes/Cluster.html` in
     * `redis/ioredis@5.4.2`, 5.8 MB and ~100 000 captures - spent 10¹⁰ element visits on one file. **A pointer is
     * exactly equivalent** because the list only grows and the rule reads the *last* declaration in it; the comment's
     * own `endLine` test is unchanged.
     */
    let lastDeclaration: UnifiedCapture | undefined;

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
        const owner = lastDeclaration;
        if (text.length > 0 && owner && capture.startLine <= owner.endLine) {
          // **The first documentation wins.** A body's own docstring is at the top of the body, so in Python and Ruby
          // the docstring capture arrives before any comment inside the body; **without this the last `# note` in a
          // function would replace the paragraph that describes it**, and nothing downstream could tell the two apart.
          const properties = owner.properties as Record<string, unknown>;
          if (properties['docstring'] === undefined) properties['docstring'] = text;
        } else if (text.length > 0) {
          // **Otherwise it documents what comes next**, and **it is still pushed**, because **a comment is in the file
          // whether or not a declaration follows it.**
          pending =
            pending !== null && capture.startLine === pendingEndLine + 1
              ? `${pending}\n${text}`
              : text;
          pendingEndLine = capture.endLine;
        }
        kept.push(capture);
        continue;
      }

      if (pending !== null) {
        const properties = capture.properties as Record<string, unknown>;
        // **A declaration that already carries documentation keeps it.** Go writes the doc comment above a method and
        // Kotlin writes `@param` lines above the same declaration through a grammar that emits them as comments; the
        // more specific producer is the one that spoke first.
        if (properties['docstring'] === undefined) properties['docstring'] = pending;
        pending = null;
        pendingEndLine = -1;
      }
      kept.push(capture);
      if (DECLARATIONS.has(capture.tag)) lastDeclaration = capture;
    }

    // **A value still pending documented nothing**, so **it stays a capture rather than becoming an attribution to a
    // declaration that does not exist.**
    //
    // **Copied element by element, because `push(...kept)` is an argument list.** V8 raises
    // `RangeError: Maximum call stack size exceeded` when that list is long enough - a hundred thousand captures is
    // long enough - and the failure surfaced as the *whole parse phase* failing, so a documentation page in a real
    // repository cost the index its entire call graph. An argument list is not a container.
    captures.length = 0;
    for (const capture of kept) captures.push(capture);
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
    this.collectDocCommentCaptures(ordered);
    this.attachDocCommentsInOrder(ordered);
    this.attachSignatures(ordered);
    return this.decorateCaptures(ordered);
  }

  /**
   * Collect the comments a grammar writes and the walk never looked at.
   *
   * **`Docstrings/JSDoc` was `✅` for seventeen languages and three of them emitted one.** TypeScript, JavaScript and
   * Python each map their own comment nodes, and the other fourteen walks were written for declarations — a comment
   * reaches no branch, so a Javadoc block above a class was parsed and dropped, and the base class's own
   * `attachDocCommentsInOrder` had nothing to attach. The row was a capability of the language read as a capability of
   * the product, which is the defect iteration 85 found in `Function Calls` and this is its widest instance.
   *
   * **A stage in `parse` and not a branch in each walk**, for the reason `attachSignatures` is one: twenty providers
   * replace `walkAndCapture` with their own recursion, so a branch reaches the two that use the base walk and no
   * others. **A pass over the finished list cannot be skipped by a walk**, because the walk does not own it.
   *
   * **A comment node is recognised by its name.** Every grammar in this class spells it `…comment` — `block_comment`,
   * `line_comment`, `multiline_comment`, `doc_comment`, `comment` — so the test is the suffix rather than a table of
   * seventeen sets, and `outer_doc_comment_marker` is excluded because the marker of a doc comment is not one.
   *
   * **A capture already there is not collected again.** TypeScript, JavaScript and Python emit their own, and a second
   * copy of every docstring would double the text the embedding index sees; the byte offset is the identity of a node,
   * so a capture that starts where the comment starts is the same comment.
   */
  /**
   * The markers that open a comment this language reads as documentation, or `null` when every comment is one.
   *
   * **The distinction is real and it is per language.** In Java, Go and Kotlin a `//` line above a declaration *is* the
   * documentation — `javadoc` renders it, `godoc` attaches it — so the base's answer of "every comment" is right for
   * them. In JavaScript and TypeScript it is not: `JSDoc` is introduced by `/**`, and a `// TODO: rename` above a
   * function is a note to the next reader, not a description of the function. **Attaching it would put the note in the
   * embedding index as the function's prose**, which is why `javascript-provider` has asserted since before this pass
   * existed that a plain `//` produces no docstring.
   *
   * **`null` rather than a shared default list**, because a wrong default would be silent: a language that gained a
   * marker nobody listed would lose documentation the product already had, and no test would name the language.
   */
  protected docCommentMarkers(): readonly string[] | null {
    return null;
  }

  private collectDocCommentCaptures(captures: UnifiedCapture[]): void {
    const root = this.signatureRoot;
    // **A fallback parse has no tree of its own.** The reader returns captures without a root, and `signatureRoot`
    // still holds the last file the grammar managed to read - walking it here would attach another file's comments.
    if (root === null || this.parseFellBack) return;

    const known = new Set<number>();
    for (const capture of captures) {
      if (capture.tag === CAPTURE_TAGS.DOCSTRING) known.add(capture.startByte);
    }

    const markers = this.docCommentMarkers();
    const collected: UnifiedCapture[] = [];
    walkPreOrder(root, (type, _depth, cursor) => {
      if (!isCommentNodeType(type)) return;
      const node = cursorNode<TreeSitterSyntaxNode>(cursor);
      if (known.has(node.startIndex)) return;
      // **A comment that says nothing documents nothing.** `<!---->` and `/** */` are empty strings once the markers
      // come off, and a capture whose text is empty is a docstring the graph would index as a blank paragraph.
      if (stripCommentSyntax(node.text).length === 0) return;
      // **And a comment the language does not read as documentation is not one.** See `docCommentMarkers`.
      if (markers !== null && !markers.some((marker) => node.text.startsWith(marker))) return;
      collected.push({
        tag: CAPTURE_TAGS.DOCSTRING,
        text: node.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        properties: { filePath: this.filePath },
      });
    });

    if (collected.length === 0) return;
    // **Copied element by element**, because an argument list of a hundred thousand captures is a stack overflow.
    for (const capture of collected) captures.push(capture);
    captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  /**
   * Give each declaration the header it was written with.
   *
   * **`GraphNode.signature` is a column in both stores, a term of the full-text index, an input to the embedding text and
   * a field of the lexical ranking - and no provider ever filled it.** Every one of those readers therefore answered
   * `null` for every node of every language, and nothing said so: an absent fact and an empty one are the same value.
   * Measured on the pinned retrieval corpus, **5 735 nodes and 0 signatures**.
   *
   * **A stage in `parse`, and not a call inside a walk**, for the reason the doc-comment pass learned one iteration
   * earlier: twenty providers build their captures inline and replace `walkAndCapture`, so a hook in the walk reaches
   * the two providers that use the base one and no others. Java is one of the twenty, which is why the first version of
   * this - written into `emitCapture` - produced signatures for TypeScript alone.
   *
   * **The innermost declaration containing a capture's name is that capture's declaration**, which needs no
   * node-type-to-tag table: a class and a method both contain the method's name, and the method is the smaller one.
   */
  private attachSignatures(captures: UnifiedCapture[]): void {
    const root = this.signatureRoot;
    if (root === null) return;

    /** Every declaration-shaped node, in source order - pre-order is ascending `startIndex`, so no sort is needed. */
    const declarations: Array<{ start: number; end: number; signature: string }> = [];
    walkPreOrder(root, (type, _depth, cursor) => {
      if (!SIGNATURE_NODE_TYPES.has(type)) return;
      const signature = signatureOf(cursorNode<TreeSitterSyntaxNode>(cursor));
      if (signature !== undefined) {
        declarations.push({ start: cursor.startIndex, end: cursor.endIndex, signature });
      }
    });
    if (declarations.length === 0) return;

    // **A sweep rather than a search per capture.** Declarations are properly nested and arrive sorted by start, so one
    // stack serves every capture in the file: push what starts before the name, pop what ends before it, and the top is
    // the innermost declaration that can contain it. Asking each capture independently would be `O(captures x
    // declarations)` on a file with a thousand of each.
    const ordered = [...captures]
      .filter((capture) => SIGNATURE_CAPTURE_TAGS.has(capture.tag))
      .sort((a, b) => a.startByte - b.startByte);
    const open: Array<{ start: number; end: number; signature: string }> = [];
    let next = 0;
    for (const capture of ordered) {
      while (next < declarations.length && declarations[next]!.start <= capture.startByte) {
        const candidate = declarations[next]!;
        while (open.length > 0 && open[open.length - 1]!.end <= candidate.start) open.pop();
        open.push(candidate);
        next += 1;
      }
      while (open.length > 0 && open[open.length - 1]!.end < capture.endByte) open.pop();
      const enclosing = open[open.length - 1];
      // **A capture the headers do not reach keeps `null`**, which is the honest answer for a declaration whose node this
      // pass never saw - a capture built from a node above its own declaration, such as an arrow bound to a `const`.
      if (enclosing !== undefined) {
        capture.properties = { ...capture.properties, signature: enclosing.signature };
      }
    }
  }

  /**
   * A provider's last chance to file a fact that belongs to more than the node it was read from.
   *
   * **A field's declared type is a fact about its class, not a symbol of its own.** Recording it by emitting a
   * `Property` capture cost this repository 0.0146 of MRR on its own docstring-search benchmark - the field's name
   * competed with the function it belongs to for the query - and put 13 891 nodes in the graph that nothing resolves
   * through. A provider that reads such a fact during the walk hands it back here, and the capture it belongs to
   * carries it out of `parse`.
   */
  protected decorateCaptures(captures: UnifiedCapture[]): UnifiedCapture[] {
    return this.attachDeclaredFacts(captures);
  }

  /**
   * The type each callable declares it returns, keyed by `line` and name.
   *
   * **A line alone is not an identity.** `class Holder { Builder builder() {…} void run() {…} }` writes two
   * declarations on one line, which is what a test fixture and a minified file both look like - and keyed by line the
   * second one's type answered for the first. The name and the line together are the declaration, and no source can
   * write two declarations of one name on one line.
   */
  protected readonly declaredReturns = new Map<string, string>();

  /**
   * Read what this declaration says it returns, from the field the grammar writes it in.
   *
   * **A grammar that spells the field differently records it itself** - `java.ts` writes the return type in `type:` -
   * and shares the map, which is why this takes the field name rather than assuming one. The name comes from the
   * caller for the same reason: every grammar spells a declaration's name differently.
   */
  protected recordDeclaredReturn(
    node: TreeSitterSyntaxNode,
    field = 'return_type',
    name = this.extractNameFromNode(node),
  ): void {
    // **A declaration this walk cannot name is not recorded**, because the key a capture is matched by is the name
    // and the line: a fact filed under `undefined` is a fact nothing can ever read.
    if (name === undefined) return;
    const written = node.childForFieldName(field)?.text;
    if (typeof written !== 'string' || written.length === 0) return;
    this.declaredReturns.set(`${node.startPosition.row + 1}\u0000${name}`, written);
  }

  /**
   * How many arguments each callable takes, keyed the same way a return type is.
   *
   * **A name is not a signature.** `format(x)` written in a class that declares `format(Object, StringBuffer,
   * FieldPosition)` names the base class's one-parameter method, and a resolver that answers by name alone hands back
   * the three-parameter declaration — which is what `apache/commons-lang`'s `CompositeFormat.reformat` does, and what
   * `apache/commons-io`'s `AbstractFileFilter.preVisitDirectory` does with a two-argument `accept`. Java decides an
   * overload by arity before it looks at a type, so the count is the one part of a signature that needs no type
   * system, and it is a fact of the declaration exactly as the return type is.
   *
   * **Three numbers, because a language can make an argument optional.** `parameters` is how many are written,
   * `required` how many a call must pass, and `variadic` whether a call may pass more. A parameter with a default, a
   * TypeScript `?`, and a rest parameter are three different statements and none of them is "unknown".
   */
  protected recordDeclaredArity(
    node: TreeSitterSyntaxNode,
    name = this.extractNameFromNode(node),
    receiverIsImplicit = false,
  ): void {
    if (name === undefined) return;
    const list = node.childForFieldName('parameters');
    if (list === null) return;
    const declared = namedChildrenOf(list)
      .filter((parameter) => !SEPARATOR_PARAMETERS.has(parameter.type))
      // **A comment in a parameter list is not a parameter**, the same fact the argument count reads one screen up.
      .filter((parameter) => !COMMENT_NODES.has(parameter.type))
      // **And a parameter that names the receiver is not one a call passes.** Java's `void run(Inner this)` writes the
      // enclosing instance in the parameter list, where it takes a position no caller fills - the same fact Python's
      // `self` states below, in a grammar that spells it as a parameter node rather than a name.
      .filter((parameter) => !NON_ARGUMENT_PARAMETERS.has(parameter.type));
    // **A method's receiver is written in the declaration and not at the call site.** Python states it as a first
    // parameter named `self` or `cls`, and counting it would make every method call look one argument short. The
    // provider says whether the declaration is a method; the name says whether the receiver is in the list, because a
    // free function may take a parameter called `self` and pass it explicitly.
    const first = declared[0];
    const offset =
      receiverIsImplicit &&
      first !== undefined &&
      RECEIVER_PARAMETER_NAMES.has(this.parameterNameOf(first) ?? '')
        ? 1
        : 0;
    const written = declared.slice(offset);
    const variadic = written.some((parameter) => VARIADIC_PARAMETERS.has(parameter.type));
    const required =
      written.filter(
        (parameter) =>
          !OPTIONAL_PARAMETERS.has(parameter.type) && parameter.childForFieldName('value') === null,
      ).length -
      // **A variadic parameter may receive nothing at all.** `notExists(final Path path, final LinkOption... options)`
      // is called as `notExists(path)` throughout `apache/commons-io`, and counting the spread as required refused
      // **17 calls the file itself declares** - every one of them a bare call to a method three lines above it.
      (variadic ? 1 : 0);
    this.declaredArities.set(`${node.startPosition.row + 1}\u0000${name}`, {
      parameters: written.length,
      required,
      variadic,
      types: written.map((parameter) => this.parameterTypeOf(parameter)),
    });
  }

  /** A parameter's name, from the field the grammar writes it in. */
  private parameterNameOf(parameter: TreeSitterSyntaxNode): string | undefined {
    // **A plain parameter is a name and nothing else.** `def run(self, other)` writes `self` as an `identifier` node
    // with no children of its own, so a search for a *child* identifier found nothing - and the receiver it names was
    // then counted as an argument the caller passes, which made every Python method look one argument longer than it
    // is. `def run(self)` states no argument at all, and a `holder.run()` call is the shape that said so.
    if (IDENTIFIER_NODES.has(parameter.type)) return parameter.text;
    return (
      parameter.childForFieldName('name')?.text ??
      namedChildrenOf(parameter).find((child) => IDENTIFIER_NODES.has(child.type))?.text
    );
  }

  /**
   * The type a parameter declares, from the field the grammar writes it in.
   *
   * **A count decides how many arguments a call passes and nothing about what they are.** `accept(File, String)` and
   * `accept(Path, BasicFileAttributes)` are two parameters each, and a call that passes two arguments is answered by
   * whichever one the walk reaches first unless the types are read. The field is the whole rule for every grammar this
   * base serves: TypeScript writes `param: Type`, and Python writes no type at all, which is the empty string rather
   * than an invented one.
   */
  protected parameterTypeOf(parameter: TreeSitterSyntaxNode): string {
    return parameter.childForFieldName('type')?.text ?? '';
  }

  /** The arities this walk read, keyed by `line` and name - the key a capture is matched by. */
  protected readonly declaredArities = new Map<
    string,
    {
      parameters: number;
      required: number;
      variadic: boolean;
      types: readonly string[];
    }
  >();

  /**
   * Attach each collected fact to the declaration it belongs to.
   *
   * **A property rather than a symbol**, for the reason a field's type is one: the fact is about a declaration the
   * graph already holds, and a second node for it would compete with the function for a search query and give the
   * resolver nothing new to point at.
   */
  protected attachDeclaredFacts(captures: UnifiedCapture[]): UnifiedCapture[] {
    if (this.declaredReturns.size === 0 && this.declaredArities.size === 0) return captures;
    for (const capture of captures) {
      if (
        capture.tag !== CAPTURE_TAGS.FUNCTION_DEF &&
        capture.tag !== CAPTURE_TAGS.METHOD_DEF &&
        capture.tag !== CAPTURE_TAGS.CONSTRUCTOR_DEF
      ) {
        continue;
      }
      const key = `${capture.startLine}\u0000${String(capture.name)}`;
      const declared = this.declaredReturns.get(key);
      if (declared !== undefined) {
        capture.properties = { ...capture.properties, returnType: declared };
      }
      const arity = this.declaredArities.get(key);
      if (arity !== undefined) {
        // **A declaration that writes no type writes no list at all.** `run()` states nothing about its arguments, and
        // an empty array would read as "stated, and matched nothing" - the one reading a resolver must not make.
        const stated = arity.types.some((type) => type.length > 0);
        capture.properties = {
          ...capture.properties,
          parameterCount: String(arity.parameters),
          requiredParameters: String(arity.required),
          ...(arity.variadic ? { variadic: 'true' } : {}),
          ...(stated ? { parameterTypes: JSON.stringify(arity.types) } : {}),
        };
      }
    }
    this.declaredReturns.clear();
    this.declaredArities.clear();
    return captures;
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

    // **A declaration the mapping names a child for, holding no such child, is a fragment of an error recovery.**
    // The `class` keyword is a node of its own in tree-sitter-ruby, so a Ruby file produced a second `class.def`
    // called `class` beside the real one - a node named after a keyword, in every file, for every class. The fallback
    // below is what produced it, and a name taken from the whole node's text is not a name.
    if (!name && mapping.nameChildType !== undefined) {
      return;
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

    // **A declaration either writes a body or it does not, and the difference is what runs.** An interface's `void
    // run();` is a signature a call is checked against, while the class that implements it holds the code; reading the
    // signature as the callee answered `this.reject(err)` with the contract's abstract declaration on
    // `redis/ioredis@5.4.2` where a field of the class holds the function - measured at **seven wrong edges** when
    // contracts were first added to the chain. The property is written only where a body exists, so an absent fact and
    // an unimplemented declaration are the same fact.
    if (
      (mapping.captureTag === CAPTURE_TAGS.METHOD_DEF ||
        mapping.captureTag === CAPTURE_TAGS.FUNCTION_DEF ||
        mapping.captureTag === CAPTURE_TAGS.CONSTRUCTOR_DEF) &&
      node.childForFieldName('body') !== null
    ) {
      properties['hasBody'] = 'true';
    }

    // Find container (parent class/interface/etc.)
    let containerName: string | undefined;
    const parent = this.findContainerNode(node);
    if (parent) {
      containerName = this.extractContainerName(parent);
    }

    // Extract base classes for class-like nodes (extends/implements)
    if (isClassNodeType(node.type)) {
      const baseClasses = this.extractBaseClasses(node);
      if (baseClasses) {
        properties['baseClasses'] = baseClasses;
      }
      const interfaces = this.extractInterfaces(node);
      if (interfaces) {
        properties['interfaces'] = interfaces;
      }
    }

    // **A contract has bases too, and TypeScript merges them into a class.** `interface Commander<Context> extends
    // RedisCommander<Context> {}` beside `class Commander` is how `redis/ioredis@5.4.2` builds its entire command
    // table: the class declares the behaviour and the merged interface declares the four hundred names, so `this.info()`
    // written inside the class has a declaration that no `extends` clause of the class mentions. Reading the clause
    // here is what lets one base list serve both halves of a declaration - they are the same key, because they are the
    // same name.
    //
    // **The arm is keyed on the node a TypeScript grammar produces** (`extends_type_clause`), so a language whose
    // contracts are spelled otherwise - Java's `extends_interfaces` - is untouched by it.
    if (node.type === 'interface_declaration') {
      const bases = this.extractExtendsClause(node);
      if (bases) {
        properties['baseClasses'] = bases;
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
    if (!this.parser || !this.languageGrammar) {
      return new Set<string>();
    }
    // **The same cached tree the predicate uses**, so a file parsed once is not parsed again here.
    const tree = this.cachedTree(source);
    if (!tree) return new Set<string>();

    // **One pass, over the cursor, reading types and text and building nothing.** The walk this replaced descended
    // the whole tree to find export statements and then descended each one again to collect the identifiers under it -
    // two recursions over materialised nodes, measured at **15.4 % of a full index** on this repository's own
    // TypeScript. See `syntax-cursor.ts` for why the cursor is the cheaper instrument.
    return exportedNamesByCursor(tree.rootNode);
  }

  /**
   * The values this file's names can only ever hold, and the lines a constant condition closes.
   *
   * **Read through the same cached tree as every other reader**, so asking this question costs one walk and no parse.
   * A provider that declares no dialect answers nothing, and answering nothing is neutral: the analysis then keeps
   * every assignment as a may-definition, which is what it did before this existed.
   */
  extractConstantFacts(source: string): ConstantFacts {
    const dialect = this.constantDialect();
    if (!dialect || !this.parser || !this.languageGrammar) return noConstantFacts();
    const tree = this.cachedTree(source);
    if (!tree) return noConstantFacts();
    return extractConstantFacts(tree.rootNode, dialect);
  }

  /**
   * The lines this file returns from, or `null` when the grammar's returns cannot be read.
   *
   * **Read through the same cached tree**, so asking costs one walk and no parse. A provider with no dialect answers
   * `null` rather than an empty list: "this grammar has no returns I can see" and "this file has no returns" are the
   * same sentence only to a reader who is not going to claim a function returns nothing.
   */
  extractReturnLines(source: string): readonly number[] | null {
    const dialect = this.constantDialect();
    if (!dialect || !this.parser || !this.languageGrammar) return null;
    const tree = this.cachedTree(source);
    if (!tree) return null;
    return extractReturnLines(tree.rootNode, dialect);
  }

  /**
   * The calls this file makes on a container it owns, or `null` when the grammar's calls cannot be read.
   *
   * **Read through the same cached tree**, so asking costs one walk and no parse. A provider with no container dialect
   * answers `null` rather than an empty list: "this grammar has no calls I can see" and "this file touches no
   * collection" are the same sentence only to a reader who is not going to claim a value cannot come back out.
   */
  extractContainerCalls(source: string): readonly ContainerCall[] | null {
    const dialect = this.containerDialect();
    if (!dialect || !this.parser || !this.languageGrammar) return null;
    const tree = this.cachedTree(source);
    if (!tree) return null;
    return extractContainerCalls(tree.rootNode, dialect);
  }

  /**
   * The line ranges this file's statements may not run in, or `null` when the grammar's branches cannot be read.
   *
   * **This is the fact that turns a may-definition into a kill**, and it is read from the same dialect that answers
   * what a constant condition closes - both are questions about which statements run, so a language that answers one
   * answers the other, and a language that answers neither keeps every definition a may-definition.
   */
  extractConditionalRegions(source: string): readonly SourceRegion[] | null {
    const dialect = this.constantDialect();
    if (!dialect || !this.parser || !this.languageGrammar) return null;
    const tree = this.cachedTree(source);
    if (!tree) return null;
    return regionsOfType(tree.rootNode, dialect.conditionalTypes);
  }

  /**
   * The line ranges of this file's statements that compute a value and keep none of it, or `null` when it cannot be
   * read.
   *
   * **The same cached tree and the same dialect as the branches**, because both are questions about a statement's shape
   * rather than about its contents: a language that can say whether a statement sits inside an `if` can say whether it
   * is an assignment. Answering `null` is not the same as answering `[]` — the first leaves every vanishing value a
   * "cannot say", and the second says no statement in this file throws a value away.
   */
  extractDiscardedValueRegions(source: string): readonly SourceRegion[] | null {
    const dialect = this.constantDialect();
    if (!dialect || !this.parser || !this.languageGrammar) return null;
    // **The assertion is sound rather than convenient**: `cachedTree` answers `null` only when there is no parser, and
    // the guard above has excluded exactly that — the same reasoning `isExported` states. Writing it as a second
    // `if` would add a branch no test can reach, and a branch nobody can reach is a branch nobody can believe.
    const tree = this.cachedTree(source)!;
    return extractDiscardedValueRegions(tree.rootNode, dialect);
  }

  /**
   * The line ranges of this file's name scopes, or `null` when the grammar cannot say.
   *
   * **The same cached tree and the same dialect again**, and the third question asked of it: a grammar that can say a
   * statement sits inside an `if` can say a declaration sits inside a block. A grammar whose declarations are not all
   * block-scoped returns `[]` from its dialect, which reads as "the function body is the scope" — the answer that
   * existed before this question was asked, and the only one JavaScript can honestly give while `var` is in it.
   */
  extractScopeRegions(source: string): readonly SourceRegion[] | null {
    const dialect = this.constantDialect();
    if (!dialect || !this.parser || !this.languageGrammar) return null;
    // The same soundness argument as the method above: `cachedTree` answers `null` only when there is no parser, and
    // that is exactly what the guard excluded.
    const tree = this.cachedTree(source)!;
    return regionsOfType(tree.rootNode, dialect.scopeTypes);
  }

  /**
   * The node and field names this grammar uses for a call on a container.
   *
   * Null means the grammar's calls are not described here, which is true of every language this project reads but
   * Java, JavaScript, TypeScript and Python. Their containers are not modelled, and the analysis keeps the
   * conservative answer for them rather than a guess.
   */
  protected containerDialect(): ContainerDialect | null {
    return null;
  }

  /**
   * The node and field names this grammar uses for declarations, assignments and conditions.
   *
   * **Null means the grammar has no such productions**, which is true of JSON and YAML and is why the base declares
   * nothing rather than guessing at a C-family vocabulary that would fold a name in a format that has none.
   */
  protected constantDialect(): ConstantDialect | null {
    return null;
  }

  /** Walk the AST to check if a symbol is exported */
  protected checkExported(_node: TreeSitterSyntaxNode, _symbolName: string): boolean {
    // Base default: no export detection. 19 of 21 subclasses override this with
    // a language-specific export check. The two providers that inherit this
    // default (html, json) have no export syntax, so no symbol is ever exported.
    return false;
  }

  /**
   * Record the names a `return` reads, **anchored at the return's own line**.
   *
   * A return is one statement, and the question a summary asks of it is "does this parameter reach this line". The
   * names inside a multi-line expression therefore all belong to the line the `return` keyword is on, which is the
   * identity of the fact rather than the position of the text — the same statement-anchoring rule the Java provider
   * applies to a wrapped argument list.
   */
  protected captureReturnAccesses(
    returnNode: TreeSitterSyntaxNode,
    names: readonly TreeSitterSyntaxNode[],
    captures: UnifiedCapture[],
  ): void {
    const line = returnNode.startPosition.row + 1;
    for (const name of names) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_ACCESS,
        text: name.text,
        startLine: line,
        endLine: line,
        startByte: name.startIndex,
        endByte: name.endIndex,
        name: name.text,
        properties: { filePath: this.filePath },
      });
    }
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

  /**
   * The names an `interface ... extends A<B>, C` clause carries, comma-joined and in declaration order.
   *
   * **Each name is written as the source wrote it**, generic arguments included, because the reader of this property
   * already reduces a name to its head - and doing the reduction once, there, keeps one rule instead of two.
   */
  protected extractExtendsClause(node: TreeSitterSyntaxNode): string | undefined {
    for (const child of childrenOf(node)) {
      if (child.type !== 'extends_type_clause') continue;
      const names = namedChildrenOf(child).map((entry) => entry.text.trim());
      return names.length === 0 ? undefined : names.join(',');
    }
    return undefined;
  }

  /** Extract base class names from a class_declaration node */
  protected extractBaseClasses(node: TreeSitterSyntaxNode): string | undefined {
    for (const child of childrenOf(node)) {
      // **`class_heritage` is the only clause this method reads, and the two arms beside it were removed by
      // measurement.** The `superclass` / `extends_clause` case was here for Java and Kotlin, and neither reaches it:
      // `JavaProvider` and `GroovyProvider` read `superclass` in their own walk, `KotlinProvider` reads
      // `delegation_specifier` (a colon-separated list where the argument list decides which entry is a class), and a
      // class node with a bare `extends_clause` child - Scala's shape - never arrives here either, because
      // `ScalaProvider` overrides the walk as well. Coverage read 0 executions of the arm across the whole suite, and
      // dead arms are what `coverage-exclusions-gate` exists to refuse.
      //
      // **TypeScript, JavaScript and ArkTS put `extends` and `implements` in one node**, and collecting every
      // identifier under `class_heritage` returned both: `class Child extends Base implements Thing` recorded
      // `baseClasses: "Base,Thing"`. An implemented interface declares signatures and no bodies, so treating one as a
      // base class answers a call with a declaration that has nothing behind it - and the resolver now walks bases to
      // find a member, which is what made the defect visible. The extends clause alone is the base, and the base is
      // its first type: `extends Base<T>` names `Base` and `T` is an argument.
      if (child.type === 'class_heritage') {
        const clause = this.firstChildOfType(child, 'extends_clause');
        // `class Foo implements Bar` is a heritage clause with no extends in it, and conforming to an interface is
        // not extending a class.
        if (clause === null) continue;
        const parts: string[] = [];
        this.collectIdentifiers(clause, parts);
        return parts[0];
      }
    }
    return undefined;
  }

  /** The first direct child of a node with a given type, or `null`. */
  protected firstChildOfType(
    node: TreeSitterSyntaxNode,
    type: string,
  ): TreeSitterSyntaxNode | null {
    for (const child of childrenOf(node)) {
      if (child.type === type) return child;
    }
    return null;
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

  /**
   * The call node types of this provider's grammar.
   *
   * **A provider declares its own**, because a set that answers for eight grammars at once answers wrongly for most of
   * them: the question is asked once per node by the walk that emits call sites, and a node this returns `true` for
   * becomes a call whether or not it is one.
   */
  protected callNodeTypes(): ReadonlySet<string> {
    return CALL_NODE_TYPES;
  }

  /** Check if a node type represents a call expression */
  protected isCallNodeType(nodeType: string): boolean {
    return this.callNodeTypes().has(nodeType);
  }

  /**
   * Emit a UnifiedCapture for a call site node.
   *
   * **The one producer of a call site, and `text` is the callee rather than the whole expression.** Both halves of
   * that sentence were defects:
   *
   * 1. `TypeScriptProvider` emitted its own call capture for `call_expression` *and* called this, so **every
   *    TypeScript call site was recorded twice** - two identical `CALLS` edges for one `helper()`, and a fan-in
   *    that read two callers where there was one. Measured on a two-file fixture: 2 edges, 1 reference target.
   * 2. `text` held `helper()` and `request.args.get(key)`, from which a receiver cannot be read without parsing the
   *    argument list; `receiverOf` therefore reported none, and **JavaScript lost the receiver for every call it
   *    ever resolved** - where TypeScript, which passed the callee node, did not. The callee's own text
   *    (`helper`, `request.args.get`) is the form the resolver wants, and it is what this now stores.
   */
  protected emitCallCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    // **A call site whose callee has no name is still a call site.** `arr[0]()` and `(f)()` call something the name
    // extractor cannot spell, and dropping them made the taint analysis quieter rather than more correct: a call is
    // a sink whether or not the resolver can follow it. The callee's own text is the honest name when nothing better
    // exists, and a name like `arr[0]` resolves to nothing, which is the correct outcome rather than a missing edge.
    //
    // **The recovered text is the last resort, and it is what a malformed file leaves behind.** A call node from
    // error recovery may carry no named child at all; its text is still the fragment the parser read, and recording
    // the call site with that fragment keeps a sink where dropping it would have lost one. A node with neither a
    // child nor a text says nothing about any call, and that is the one case that returns.
    const calleeText = this.extractCalleeText(node) ?? node.text;
    const name = this.extractCallName(node) ?? calleeText;
    if (!name) return;

    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // Find containing function/method
    let containerName: string | undefined;
    const parent = this.findContainerNode(node);
    if (parent) {
      containerName = this.extractContainerName(parent);
    }

    const tag = this.getCallTagForNodeType(node);
    const argumentCount = this.argumentCountOf(node);

    captures.push({
      tag,
      text: calleeText,
      startLine,
      endLine,
      startByte: node.startIndex,
      endByte: node.endIndex,
      name,
      containerName,
      properties: {
        filePath: this.filePath,
        callType: this.isMethodCall(node) ? 'method' : 'function',
        ...this.arityProperty(argumentCount),
      },
    });
  }

  /**
   * The argument count as the property a capture carries — **absent when the grammar does not say how many.**
   *
   * **One place, because four call sites asked the same question and each wrote its own answer.** A Java construction,
   * a Java `super(…)`, a Java call and every base-class call each spelled out `count === undefined ? {} : {…}`, so the
   * three Java branches were arms no Java source can take - the production always writes an argument list - and they
   * were the only reason `java.ts` sat under the per-file floor. The shape that *does* leave the count unknown is
   * `f(*args)`, whose list length is a runtime fact, and that one is a splat in Python and TypeScript.
   */
  protected arityProperty(argumentCount: number | undefined): Record<string, string> {
    return argumentCount === undefined ? {} : { argumentCount: String(argumentCount) };
  }

  /**
   * The names a call passes, in the order it passes them — **the one fact a count cannot carry.**
   *
   * `accept(dir, attributes)` and `accept(file, name)` are both two arguments, and the declaration each one runs is
   * decided by what the names hold rather than by how many there are. The resolver reads a name's type off the
   * declarations of the file the call sits in, so the name is the handle; an argument that is an expression, a
   * literal or a construction is written as an empty string, because there is no name to look up and inventing one is
   * the guess this product does not make. A call that passes no name at all writes no property.
   */
  protected argumentNamesProperty(list: TreeSitterSyntaxNode | null): Record<string, string> {
    if (list === null) return {};
    const names = namedChildrenOf(list).map((argument) =>
      IDENTIFIER_NODES.has(argument.type) ? argument.text : '',
    );
    return names.some((name) => name.length > 0) ? { argumentNames: JSON.stringify(names) } : {};
  }

  /**
   * How many arguments this call node passes, or `undefined` when the grammar does not say.
   *
   * **The count is the argument list's own, read from the field every grammar writes it in** — `arguments:` in
   * TypeScript, JavaScript, Python, Java, Go and Kotlin alike. A splat stands for a list whose length is a runtime
   * fact, so a call that passes one has no count rather than a count that is wrong; the same is true of a node whose
   * argument list is missing because the file is being edited.
   */
  protected argumentCountOf(node: TreeSitterSyntaxNode): number | undefined {
    const list = node.childForFieldName('arguments');
    if (list === null) return undefined;
    // **A comment is a named node and is not an argument.** `addSub(fraction, true /* add */)` passes two arguments
    // and the grammar reports three, which is the difference between a call the declaration admits and one it does not.
    const passed = namedChildrenOf(list).filter((argument) => !COMMENT_NODES.has(argument.type));
    return passed.some((argument) => SPLAT_ARGUMENTS.has(argument.type))
      ? undefined
      : passed.length;
  }

  /**
   * The capture tag for a call node.
   *
   * **`METHOD_CALL` when the callee is written as a member, because the tag is what carries the receiver.** It used
   * to be decided by node type alone, so every JavaScript method call was a `FUNCTION_CALL` with a `callType` string
   * saying otherwise - and `receiverOf` reads the tag, so the fact was recorded in a property nothing in the resolver
   * reads. A `new_expression` stays its own tag: constructing a type is not calling a method.
   */
  protected getCallTagForNodeType(node: TreeSitterSyntaxNode): CaptureTag {
    if (node.type === 'new_expression') return CAPTURE_TAGS.NEW_EXPRESSION;
    return this.isMethodCall(node) ? CAPTURE_TAGS.METHOD_CALL : CAPTURE_TAGS.FUNCTION_CALL;
  }

  /**
   * The text of the callee - `helper` in `helper()`, `request.args.get` in `request.args.get(key)`, `arr[0]` in
   * `arr[0]()`.
   *
   * **The first named child of a call expression is its callee**, in every grammar this class serves, and the
   * argument list is the second - so the shape is read once rather than matched against a list of node types. An
   * earlier version whitelisted `identifier`, `member_expression` and four relatives, which meant a subscript or a
   * parenthesised callee fell back to the whole expression and lost the receiver the text exists to carry.
   * `undefined` is reserved for a node with no named children at all, which is what an `ERROR` node looks like.
   */
  protected extractCalleeText(node: TreeSitterSyntaxNode): string | undefined {
    const callee = namedChildrenOf(node)[0];
    return callee?.text;
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

  /**
   * The three taint answers for one tree, computed once.
   *
   * **Three public questions, one traversal.** `extractTaintSources`, `extractTaintSinks` and `extractSanitizers` are
   * called for the same file one after another, and each of them used to walk the tree from the root - three
   * traversals, each materialising every node, **measured at 23 % of a full index**. They ask the same two node shapes
   * about the same tree, so the answers are produced together and this holds them.
   *
   * **Keyed on the tree, because the tree is what the answers describe.** A provider instance serves one file at a
   * time and `cachedTree` hands back the same tree for the same text, so a different file is a different key and the
   * memo cannot outlive what it is about.
   */
  private taintCache: {
    readonly for: TreeSitterTree;
    readonly collections: TaintCollections;
  } | null = null;

  /** Extract taint sources from source code using AST walking */
  extractTaintSources(source: string): TaintSource[] {
    // **No parse for a capability the language has not claimed.** The walk this would use is the base's,
    // which collects nothing, so the answer is known before the file is read.
    if (!claimsTaintExtraction(this)) return [];

    if (!this.parser || !this.languageGrammar) {
      return this.fallbackExtractTaintSources(source);
    }

    return this.taintCollections(source).sources;
  }

  /**
   * Every taint fact in `source`, in one traversal.
   *
   * **The arrays are copied on the way out**, so a caller that sorts or filters what it was given cannot change the
   * answer the next caller receives.
   */
  private taintCollections(source: string): TaintCollections {
    const tree = this.cachedTree(source)!;
    if (this.taintCache?.for === tree) return this.taintCache.collections;

    const collected = this.collectTaint(tree.rootNode);
    const collections: TaintCollections = {
      sources: [...collected.sources],
      sinks: [...collected.sinks],
      sanitizers: [...collected.sanitizers],
    };
    this.taintCache = { for: tree, collections };
    return collections;
  }

  /**
   * Collect every taint fact under `root`.
   *
   * **The default runs the three walks, which is what every provider did before the fusion existed.** A provider whose
   * three walks are the shared C-like collectors overrides this with the single-pass version; a provider with a walk
   * of its own keeps it, and nothing about it changes.
   */
  protected collectTaint(root: TreeSitterSyntaxNode): TaintCollections {
    const sources: TaintSource[] = [];
    const sinks: TaintSink[] = [];
    const sanitizers: TaintSanitizer[] = [];
    this.walkForTaintSources(root, sources);
    this.walkForTaintSinks(root, sinks);
    this.walkForSanitizers(root, sanitizers);
    return { sources, sinks, sanitizers };
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

    return this.taintCollections(source).sinks;
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

    return this.taintCollections(source).sanitizers;
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
  // **Two ways to claim it, because there are two ways to answer the question.** A provider either walks the tree
  // itself - `walkForTaintSources` - or hands the whole job to the shared single-pass collector, which is declared by
  // overriding `collectTaint`. A provider that does neither is not asked, so its file is never parsed for this.
  //
  // **The walk cannot fall off the end**: every provider inherits both from the base, so the chain reaches an owner
  // before it reaches `null` - and a trailing `return false` after this loop was a statement no provider could reach.
  const declaresOwn = (name: string): boolean => {
    let proto = Object.getPrototypeOf(provider) as Record<string, unknown>;
    while (!Object.prototype.hasOwnProperty.call(proto, name)) {
      proto = Object.getPrototypeOf(proto) as Record<string, unknown>;
    }
    return proto[name] !== base[name];
  };

  return declaresOwn('walkForTaintSources') || declaresOwn('collectTaint');
}

/**
 * Node types that can own a member, across the grammars this package speaks.
 *
 * **A set rather than a chain of comparisons, because the same list is consulted once per climbed ancestor** and the
 * cost of the test matters as much as its answer. The list is exactly the one the climb used, unchanged: this change
 * is about how many times the question is asked, not about the answer.
 */
/**
 * The node types whose declaration states what it returns in a `return_type` field.
 *
 * **A return type is a fact about a declaration and nothing recorded it**, so `QueueInputStream.builder().get()`
 * ended at the first call: the resolver knew what a field, a parameter and a local hold, and not what an expression
 * does. The field name is the grammars' own - TypeScript's `method_definition`, Python's `function_definition` - and
 * a grammar that spells it differently (`java.ts` writes `type:`) records it in its own walk.
 */
const DECLARATION_FACT_NODES: ReadonlySet<string> = new Set([
  'function_declaration',
  'method_definition',
  'function_definition',
]);

/** The node types a parameter list is written as, in the grammars whose declaration states one. */
const SEPARATOR_PARAMETERS: ReadonlySet<string> = new Set([
  'positional_separator',
  'keyword_separator',
]);

/** The names a language gives its receiver, which a call site never passes. */
const RECEIVER_PARAMETER_NAMES: ReadonlySet<string> = new Set(['self', 'cls']);

/**
 * Parameter nodes that name the receiver rather than an argument.
 *
 * **Java writes its receiver in the parameter list.** `void run(Inner this, int size)` is an inner class's method
 * naming the enclosing instance, and the grammar files it as a `receiver_parameter` beside the real one: a call passes
 * one argument, and counting the receiver declared two.
 */
const NON_ARGUMENT_PARAMETERS: ReadonlySet<string> = new Set(['receiver_parameter']);

/** Parameters a call may pass more of than are written: `String... parts`, `...rest`, `*args`, `**kwargs`. */
const VARIADIC_PARAMETERS: ReadonlySet<string> = new Set([
  'spread_parameter',
  'rest_pattern',
  'rest_parameter',
  'list_splat_pattern',
  'dictionary_splat_pattern',
  'variadic_parameter',
]);

/** Parameters a call may leave out: a default value, or TypeScript's `?`. */
const OPTIONAL_PARAMETERS: ReadonlySet<string> = new Set([
  'default_parameter',
  'typed_default_parameter',
  'optional_parameter',
]);

/** Argument or parameter nodes whose text is a name, when a grammar writes the name outside a field. */
const IDENTIFIER_NODES: ReadonlySet<string> = new Set([
  'identifier',
  'type_identifier',
  'variable_name',
]);

/** Argument nodes that stand for a list whose length is only known at runtime — `f(*args)`. */
const SPLAT_ARGUMENTS: ReadonlySet<string> = new Set([
  'spread_element',
  'list_splat',
  'dictionary_splat',
  'spread_parameter',
]);

/** The node types a grammar reports as named content, and that state nothing about a signature. */
const COMMENT_NODES: ReadonlySet<string> = new Set(['comment', 'line_comment', 'block_comment']);

const CONTAINER_NODE_TYPES: ReadonlySet<string> = new Set([
  'class_declaration',
  'abstract_class_declaration',
  'class',
  'interface_declaration',
  'enum_declaration',
  'object_type',
  'class_definition',
  'struct_declaration',
  'impl_declaration',
  'record_declaration',
]);

/**
 * The node types that declare a class, which is more than one per grammar.
 *
 * **`abstract class` is a class**, and tree-sitter-typescript spells it `abstract_class_declaration` rather than
 * `class_declaration`. Every member of one was therefore a member of nothing: `colinhacks/zod@3.23.8` declares its
 * entire type system on `export abstract class ZodType<…>`, so `this.nullable()` and the forty methods beside it in the
 * one class every other class extends resolved to no class at all, and `redis/ioredis@v5.4.2` declares
 * `AbstractConnector` the same way. Read off the grammar rather than assumed: the same node is `class_definition` in
 * Python, `record_declaration` in Java and C#, and `class_specifier` in C++ - so the list is per node type and not
 * per keyword.
 */
const CLASS_NODE_TYPES: ReadonlySet<string> = new Set([
  'class_declaration',
  'abstract_class_declaration',
  // **A class expression is a class**, and this grammar gives it a node type of its own. `this.Command = class
  // CustomScriptCommand extends Command {…}` is how `redis/ioredis@v5.4.2` writes `Script`, and its members were being
  // attributed to whichever class lexically contained the expression.
  'class',
  'class_definition',
]);

/** Whether a node type declares a class. */
function isClassNodeType(type: string): boolean {
  return CLASS_NODE_TYPES.has(type);
}

/** Whether a node type can own a member. */
function isContainerNodeType(type: string): boolean {
  return CONTAINER_NODE_TYPES.has(type);
}

/**
 * Whether a tree holds an error a walk cannot work around.
 *
 * **`hasError` is true for two different things, and the difference is the whole product for one language.**
 * A node with `type: 'ERROR'` is the parser saying it could not read a span — there is no structure there. A node with
 * `isMissing` is the parser saying it *did* read the construct and inserted a token the grammar required — the
 * structure is intact and the token is absent from the text.
 *
 * **Groovy is where this matters.** Its grammar requires a semicolon after a statement; real Groovy omits it; so every
 * ordinary Groovy file parses with `(MISSING ";")` and `hasError` is true at the root. The base class read that as
 * "the grammar cannot read this file", fell back to the regular-expression reader, and **the five-hundred-line AST
 * walker in `groovy.ts` never ran on a single real file** — which is why that language claimed four rows of the
 * capability matrix and produced classes and functions named by a line-oriented guessing game.
 *
 * **The traversal only happens on a tree that reported an error**, so a clean parse of any language pays `hasError`
 * and nothing else.
 */
function hasUnrecoverableError(node: TreeSitterSyntaxNode): boolean {
  if (!node.hasError) return false;
  if (node.isError === true || node.type === 'ERROR') return true;
  for (let index = 0; index < node.childCount; index++) {
    if (hasUnrecoverableError(node.child(index))) return true;
  }
  return false;
}

/**
 * Whether a node type names a comment.
 *
 * **Every grammar in this class ends the name with `comment`**, which is why one suffix serves seventeen of them
 * rather than a table per language. `outer_doc_comment_marker` is the `///` that introduces a Rust doc comment and is
 * not itself the comment, so the marker suffix is excluded.
 */
function isCommentNodeType(type: string): boolean {
  return type.endsWith('comment') && !type.endsWith('_marker');
}

/**
 * A comment's text without its markers, so a docstring reads as prose rather than as syntax.
 *
 * **Deliberately not comment-type aware.** Block, line and hash comments all reduce
 * to their lines, and the languages that use a form this does not know still get their text - **just with its markers
 * left on**, which is a worse docstring than a clean one and a better one than none.
 */
function stripCommentSyntax(text: string): string {
  return (
    text
      .replace(/^\s*\/\*\*?/, '')
      .replace(/\*\/\s*$/, '')
      // **An HTML comment closes with `-->` and opens with `<!--`, and neither is a line prefix.** Removing the pair
      // before the split is what makes `<!---->` strip to the empty string: without it the line rule takes `<!--` off
      // and leaves `-->` behind, so an empty comment reads as documentation that says `-->`.
      .replace(/<!--/g, '')
      .replace(/-->/g, '')
      .split('\n')
      .map((line) =>
        line
          .replace(/^\s*\*\s?/, '')
          // **A run and not a pair.** `///` is one comment marker written three slashes wide, and a rule that consumed two
          // of them left `/ A widget.` as a C# docstring - a leading slash in the text of every documented member.
          .replace(/^\s*(\/\/+|#+|--+)\s?/, '')
          .trimEnd(),
      )
      .join('\n')
      .trim()
  );
}
