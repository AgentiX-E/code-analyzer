// @code-analyzer/analyzer — Kotlin Tree-sitter Provider (with regex fallback)

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { lineOf } from './line-index.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import { ownerKeyOf } from '../resolution/receiver-types.js';

import type { ParsedImport } from './provider.js';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

const KOTLIN_EXTENSIONS = ['.kt', '.kts'];
const KOTLIN_GLOBS = ['**/*.kt', '**/*.kts'];

/** The node types a Kotlin declaration writes a type into, which is what its signature is made of. */
const WRITTEN_TYPE_NODES: ReadonlySet<string> = new Set([
  'user_type',
  'nullable_type',
  'function_type',
]);

/** Kotlin spells a call - of a function, a method or a constructor - with one node type. */
const KOTLIN_CALL_NODE_TYPES: ReadonlySet<string> = new Set(['call_expression']);

export class KotlinProvider extends TreeSitterBaseProvider {
  readonly language = 'kotlin';
  readonly displayName = 'Kotlin';
  readonly extensions = KOTLIN_EXTENSIONS;
  readonly globs = KOTLIN_GLOBS;
  readonly importSemantics = 'named' as const;

  /**
   * The type parameters this file declares, by name.
   *
   * **`fun <R : Outcome> map(f: (T) -> R): Map<String, R>` declares `R` once and writes it twice**, and each of those
   * writes sits inside a `user_type` exactly like a real type does - they are `type_identifier` nodes of the same shape,
   * so position cannot tell them apart. The name is what suppresses them, and a file that also declares `class R`
   * would otherwise answer every mention of the type parameter with that class.
   */
  private readonly typeParameterNames = new Set<string>();

  /**
   * `Class` → the declared type of each property, attached to the class capture afterwards.
   *
   * **A field's type is a fact about its class and not a symbol of its own**, which is the measurement iteration 45
   * recorded on TypeScript: a `Property` node per field cost this product's own docstring search 0.0145 MRR, for a fact
   * the resolver reads off the class anyway. Kotlin published **none** of them - `val cache: Map<String, Widget>` was a
   * string in a `signature` property and nothing else.
   */
  private readonly classFieldTypes = new Map<string | undefined, Map<string, string>>();

  /**
   * The parse, with the type parameters of the previous file forgotten.
   *
   * **Per file, and stated here rather than in `decorateCaptures`** because a name declared in one file would otherwise
   * suppress a genuine type reference in the next, and the file the walk runs on is the only thing that decides which
   * names are bound. **The field types are cleared for the same reason**: a class called `Service` in two files would
   * otherwise inherit the second file's properties in the first one's capture.
   */
  override parse(source: string, filePath: string): UnifiedCapture[] {
    this.typeParameterNames.clear();
    this.classFieldTypes.clear();
    return super.parse(source, filePath);
  }

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-kotlin is a direct dependency of the analyzer, so this require
    // never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('tree-sitter-kotlin') as TreeSitterLanguage;
  }

  /** One node type spells every call: `p.refresh()`, `refresh()` and `Builder()` are all `call_expression`. */
  protected override callNodeTypes(): ReadonlySet<string> {
    return KOTLIN_CALL_NODE_TYPES;
  }

  /**
   * The name a call is filed under: the last segment of its callee.
   *
   * **`p.refresh()` names `refresh`**, and `service.policy.refresh()` too. The receiver is the *text* of the callee,
   * which the base implementation already takes from the first named child; the name is what a lookup is keyed by, and
   * a dotted name resolves to nothing.
   */
  protected override extractCallName(node: TreeSitterSyntaxNode): string | undefined {
    // **A `call_expression` always writes its callee** - the grammar is `(expression) call_suffix` - so the first named
    // child exists and the `!` states the production rather than a hope.
    const text = namedChildrenOf(node)[0]!.text;
    const lastDot = text.lastIndexOf('.');
    return lastDot < 0 ? text : text.slice(lastDot + 1);
  }

  /**
   * Whether the callee is written as a member, which is what selects `METHOD_CALL` over `FUNCTION_CALL`.
   *
   * **The tag is what carries the receiver** - `receiverOf` reads it - so this is not a label. A callee that is itself
   * a call (`Builder().build()`) is a member of what that call returned.
   */
  protected override isMethodCall(node: TreeSitterSyntaxNode): boolean {
    const callee = namedChildrenOf(node)[0];
    return callee?.type === 'navigation_expression' || callee?.type === 'call_expression';
  }

  /**
   * How many arguments a call passes.
   *
   * **Kotlin writes the list inside `call_suffix`, not in an `arguments` field**, so the base implementation's field
   * lookup answers nothing here. A spread (`*array`) stands for a list whose length is a runtime fact, and a call that
   * passes one has no count rather than a count that is wrong.
   */
  protected override argumentCountOf(node: TreeSitterSyntaxNode): number | undefined {
    // **A `call_expression` always carries a `call_suffix`** - it is what makes it a call rather than a reference to a
    // function - so this lookup cannot come back empty.
    const suffix = namedChildrenOf(node).find((child) => child.type === 'call_suffix')!;
    // **A trailing lambda passes no list at all.** `list.forEach { … }` is a call whose suffix holds only the lambda,
    // and a count of zero would say it takes no arguments when it takes one.
    const list = namedChildrenOf(suffix).find((child) => child.type === 'value_arguments');
    if (list === undefined) return undefined;
    const passed = namedChildrenOf(list).filter((child) => child.type === 'value_argument');
    return passed.some((argument) => argument.text.startsWith('*')) ? undefined : passed.length;
  }

  // When tree-sitter grammar is available, use AST walking
  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    // Only used when grammar is loaded — fallback handles otherwise
    const nodeType = node.type;

    // **A name a type position writes is a name the code depends on, and Kotlin produced none of them.**
    //
    // `val policy: RetryPolicy` and `fun send(p: RetryPolicy): Outcome` name `RetryPolicy` twice and `Outcome` once,
    // and nothing else in such a file mentions either: the body calls `policy.refresh()`, which the resolver answers
    // from the declared type without naming the class. So a reachability pass reading calls and value mentions reports
    // both dead - on a language where constructor injection is the idiom.
    //
    // **The grammar draws the boundary, and it draws it cleanly.** Every type a declaration writes is inside a
    // `user_type` - a property, a parameter, a return, a type argument, a type alias's right-hand side, a delegation
    // specifier - and every `type_identifier` outside one is a name being declared (`class Widget`, `typealias Alias`,
    // `<T : Widget>`). So this walk reads `user_type` and nothing else, which is why it needs no binder set for the
    // declarations themselves.
    if (nodeType === 'user_type') {
      this.captureUserType(node, captures);
      return;
    }
    if (nodeType === 'type_parameter') {
      // **A `type_parameter` always writes its name** - `type_parameter_modifiers? type_identifier (':' user_type)?` -
      // so the lookup cannot come back empty and the `!` states the production rather than a hope.
      const written = namedChildrenOf(node).find((child) => child.type === 'type_identifier')!;
      this.typeParameterNames.add(written.text);
    }

    // **Kotlin recorded no call sites at all, and the matrix said it did.** `walkAndCapture` overrode the base walk and
    // handled classes, functions and imports; `p.refresh()` was parsed, was never emitted, and the graph held **zero**
    // `CALLS` edges for a Kotlin checkout - which is why this language reads 0.3934 on the Long Code Arena sample while
    // Python reads 0.5405 and Java 0.5156. A provider that emits no call has no call graph, and retrieval over it can
    // only match names.
    //
    // **No early return**: the callee of `Builder().build()` is itself a call, and the arguments of a call contain
    // calls. The walk continues into both, which is what makes the inner sites reachable at all.
    if (this.isCallNodeType(nodeType)) {
      this.emitCallCapture(node, captures);
    }

    if (nodeType === 'class_declaration' || nodeType === 'object_declaration') {
      // A class/object declaration always carries its name as a direct
      // `type_identifier` child (grammar: alias(simple_identifier, type_identifier)), so the lookup cannot come back
      // empty - measured against every malformed class the grammar accepts, each of which becomes an ERROR node
      // rather than a nameless `class_declaration`. The `!` is that statement, and the guard it replaces was a branch
      // no input takes.
      const nameNode = this.findChild(node, 'type_identifier')!;
      // Check if this is an enum class (has enum_class_body child)
      let isEnum = false;
      for (let c = 0; c < node.namedChildCount; c++) {
        if (node.namedChild(c).type === 'enum_class_body') {
          isEnum = true;
          break;
        }
      }
      // tree-sitter-kotlin represents interfaces as class_declaration with an
      // 'interface' keyword; distinguish them so they are not mislabeled CLASS_DEF
      let isInterface = false;
      for (let c = 0; c < node.childCount; c++) {
        if (node.child(c).type === 'interface') {
          isInterface = true;
          break;
        }
      }
      const isObject = nodeType === 'object_declaration';
      const tag = isEnum
        ? CAPTURE_TAGS.ENUM_DEF
        : isInterface
          ? CAPTURE_TAGS.INTERFACE_DEF
          : CAPTURE_TAGS.CLASS_DEF;
      // **Kotlin writes both a superclass and an interface after one colon**, so the syntax alone does not say
      // which is which: `class Foo : Base(), Runnable` and `class Foo : Runnable` are the same shape. What does
      // say it is the argument list - a Kotlin interface has no constructor, so a delegation specifier carrying a
      // `constructor_invocation` names a class and one without names an interface. The first invokable specifier
      // is therefore the base class, which is the only reading of this syntax the language allows.
      const heritage = this.heritageOf(node);
      captures.push({
        tag,
        text: isEnum
          ? `enum class ${nameNode.text}`
          : `${isInterface ? 'interface' : isObject ? 'object' : 'class'} ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: {
          filePath: this.filePath,
          ...heritage,
          ...(isObject ? { isObject: 'true' } : {}),
        },
      });
    } else if (nodeType === 'function_declaration') {
      // A function declaration always carries its name as a direct
      // `simple_identifier` child, for the same reason and by the same measurement: `fun () {}` is an
      // `anonymous_function` and never reaches this branch.
      const nameNode = this.findChild(node, 'simple_identifier')!;
      // **The class a method is declared in, which the graph did not record for Kotlin.** `nameByContainment` files a
      // member under the class that encloses it, and this provider emitted no container at all, so a Kotlin method's
      // qualified name was `file:<path>:<name>` and a parameter could not be keyed by `Service.send`.
      const enclosingClass = this.enclosingClassNameOf(node);
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: {
          filePath: this.filePath,
          ...(enclosingClass === undefined ? {} : { enclosingClass }),
          // **`suspend` is Kotlin's word for a function that may be awaited**, and it is one word in a `modifiers`
          // child. Nothing in the graph said it, so a coroutine call read as an ordinary one.
          ...(childrenOf(node).some(
            (child) => child.type === 'modifiers' && /\bsuspend\b/.test(child.text),
          )
            ? { async: 'true' }
            : {}),
        },
      });
      // **What the declaration says it returns and how many arguments it takes.** Both were written in the source and
      // neither reached the graph: the `signature` property carried `fun send(p: RetryPolicy): Outcome` as text, and a
      // resolver reading it would be parsing the source again one layer up.
      this.recordSignature(node, nameNode.text);
      this.emitParameterDefs(node, nameNode.text, enclosingClass, captures);
    } else if (nodeType === 'property_declaration') {
      this.recordPropertyType(node);
      this.emitLocalDeclaration(node, captures);
    } else if (nodeType === 'class_parameter') {
      this.recordConstructorPropertyType(node);
    } else if (nodeType === 'annotation') {
      // **An annotation is a decorator with a different name**, and this provider recorded only the type it names.
      // `@Component class Service` and `@Component()` differ only in parentheses, so the name is the annotation's
      // first identifier and the rest of the node is its arguments.
      // **The annotation's own text starts with `@` by definition of the node**, so the name is the qualified run
      // after it: `@Deprecated("old")` and `@Component` differ in their arguments, not in how they name themselves.
      const written = /^@([\w.]+)/.exec(node.text)?.[1];
      if (written !== undefined) {
        captures.push({
          tag: CAPTURE_TAGS.DECORATOR,
          text: node.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: written,
          properties: { decorator: written, filePath: this.filePath },
        });
      }
    }

    // Capture import statements in the unified capture stream
    if (nodeType === 'import_header') {
      const parts = this.collectImportPathParts(node);
      const sourcePath = parts.join('.');
      // An import_header always carries an identifier path, so the joined
      // source path is never empty.
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: sourcePath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: sourcePath,
        properties: { filePath: this.filePath },
      });
    }

    for (const child of childrenOf(node)) {
      this.walkAndCapture(child, captures);
    }
  }

  /**
   * File the facts that belong to more than the node they were read from.
   *
   * **A property's type is a fact about its class, and the graph stores it there** - one property, no node per property,
   * for the reason recorded on `classFieldTypes`. The declared returns and arities the walk collected are attached here
   * too, by the base implementation, which is the only place that can see both the fact and the capture it belongs to.
   */
  protected override decorateCaptures(captures: UnifiedCapture[]): UnifiedCapture[] {
    const decorated = captures.map((capture) => {
      if (capture.tag !== CAPTURE_TAGS.CLASS_DEF) return capture;
      // **The map is keyed by `string` and read with whatever the capture carries.** A capture with no name is a class
      // this parse could not identify, and asking the map for `undefined` is a miss - which is the answer.
      const fields = this.classFieldTypes.get(capture.name);
      if (fields === undefined || fields.size === 0) return capture;
      return {
        ...capture,
        properties: {
          ...capture.properties,
          fieldTypes: JSON.stringify(Object.fromEntries(fields)),
        },
      };
    });
    this.classFieldTypes.clear();
    return this.attachDeclaredFacts(decorated);
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    const nodeType = node.type;
    if (
      nodeType === 'class_declaration' ||
      nodeType === 'object_declaration' ||
      nodeType === 'function_declaration' ||
      nodeType === 'property_declaration'
    ) {
      const nameNode =
        this.findChild(node, 'type_identifier') ??
        this.findChild(node, 'simple_identifier') ??
        this.findChild(node, 'identifier');
      if (nameNode && nameNode.text === symbolName) return true;
    }
    // Also check children for other exportable nodes
    for (const child of childrenOf(node)) {
      if (this.checkExported(child, symbolName)) return true;
    }
    return false;
  }

  /** Public wrapper for checkExported used by direct tests. */
  kotlinCheckExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    return this.checkExported(node, symbolName);
  }

  // Fallbacks
  public override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Classes
    const clRegex = /(?:data\s+|sealed\s+|abstract\s+|open\s+|inner\s+)*class\s+(\w+)/g;
    while ((m = clRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Interfaces
    const ifRegex = /interface\s+(\w+)/g;
    while ((m = ifRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `interface ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Objects
    const objRegex = /(?:companion\s+)?object\s+(\w+)/g;
    while ((m = objRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `object ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isObject: 'true', filePath },
      });
    }

    // Enum classes
    const enumRegex = /enum\s+class\s+(\w+)/g;
    while ((m = enumRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum class ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Functions (including extension functions: fun Type.name)
    const funcRegex =
      /(?:(?:private|internal|protected|public|override|open|abstract|suspend|inline|operator|infix|tailrec|external)\s+)*fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Properties (val/var)
    const propRegex =
      /(?:const\s+)?(?:lateinit\s+)?(?:private\s+|internal\s+|protected\s+)?(?:override\s+)?(?:open\s+)?(?:abstract\s+)?(val|var)\s+(\w+)/g;
    while ((m = propRegex.exec(source)) !== null) {
      const tag = m[1] === 'val' ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;
      captures.push({
        tag,
        text: m[2]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[2]!,
        properties: { filePath },
      });
    }

    // Annotations
    const annRegex = /@(\w+)(?:\([\s\S]*?\))?/g;
    while ((m = annRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.DECORATOR,
        text: m[0],
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { decorator: m[1]!, filePath },
      });
    }

    // Imports
    const imps = this.fallbackExtractImports(source);
    for (const imp of imps) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: imp.source,
        startLine: imp.lineNumber,
        endLine: imp.lineNumber,
        startByte: 0,
        endByte: 0,
        name: imp.source,
        properties: { names: imp.names.join(','), importType: imp.type, filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  /**
   * Kotlin's imports, read from Kotlin's own nodes.
   *
   * **Without this override the base class walked JavaScript's import shapes** over a Kotlin file and found nothing, so
   * `kotlinx.coroutines` - 1 152 files - indexed with **zero `IMPORTS` edges** and change-impact had no graph to walk.
   * The grammar is flat and easy: `(import_header (identifier) [(wildcard_import)] [(import_alias)])`.
   */
  override extractImports(source: string): ParsedImport[] {
    if (!this.parser) return this.fallbackExtractImports(source);

    const imports: ParsedImport[] = [];
    const visit = (node: TreeSitterSyntaxNode): void => {
      if (node.type !== 'import_header') {
        for (const child of namedChildrenOf(node)) visit(child);
        return;
      }
      // **The dotted path is one `identifier` node**, not a chain of segments, and the two optional children are what
      // distinguish `a.b.*` from `a.b.C` and `a.b.C as D` from `a.b.C`. **The grammar requires it** - an `import_header`
      // is `'import' (identifier) [(wildcard_import)] [(import_alias)]` - so there is no shape to guard against.
      const path = this.findChild(node, 'identifier')!;
      const wildcard = this.findChild(node, 'wildcard_import') !== null;
      const aliasNode = this.findChild(node, 'import_alias');
      const segments = path.text.split('.');
      // **`split` always yields one segment**, so the last one exists; only the alias can override it.
      const boundName = aliasNode
        ? aliasNode.text.replace(/^as\s+/, '').trim()
        : segments[segments.length - 1]!;

      imports.push({
        source: path.text,
        // **A wildcard import binds nothing by name** - `import a.b.*` makes the package's members visible, and there is
        // no single symbol to record.
        names: wildcard ? [] : [boundName],
        type: wildcard ? 'wildcard' : 'named',
        ...(aliasNode ? { alias: boundName } : {}),
        lineNumber: node.startPosition.row + 1,
      });
    };
    visit(this.parser.parse(source).rootNode);
    return imports;
  }

  public override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    // Matches:
    //   import kotlin.collections.List           -> named
    //   import kotlin.collections.*               -> wildcard
    //   import kotlin.collections.List as MyList  -> aliased (named, using alias)
    const regex = /import\s+([\w.*]+)(?:\s+as\s+(\w+))?/g;
    while ((m = regex.exec(source)) !== null) {
      const fullPath = m[1]!;
      const alias = m[2];
      const isWildcard = fullPath.endsWith('.*');
      const parts = fullPath.split('.');

      imports.push({
        source: fullPath,
        names: alias ? [alias] : isWildcard ? [] : [parts[parts.length - 1]!],
        type: isWildcard ? 'wildcard' : 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  public override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:class|interface|object|fun|val|var)\\s+${s}\\b`).test(source);
  }

  // ---- Utility helpers ----

  /**
   * The class or object a declaration is written in, or `undefined` when it is in no container.
   *
   * **A declaration inside a function body is a local and not a field**, and the walk upward stops there: filing
   * `fun run() { val x: Widget = … }` under the class would answer `this.x` with a type it never had. **An `object` is
   * a container** for the same reason a class is - `object Registry { val cache: Cache }` declares one instance of a
   * type and its members belong to it.
   */
  private enclosingClassNameOf(node: TreeSitterSyntaxNode): string | undefined {
    let current = node.parent;
    while (current !== null) {
      if (
        current.type === 'function_declaration' ||
        current.type === 'anonymous_function' ||
        current.type === 'lambda_literal'
      ) {
        return undefined;
      }
      if (current.type === 'class_declaration' || current.type === 'object_declaration') {
        return this.findChild(current, 'type_identifier')?.text;
      }
      current = current.parent;
    }
    return undefined;
  }

  /** The type a node writes directly, whether plain, nullable or a function type. */
  private writtenTypeOf(node: TreeSitterSyntaxNode): string | undefined {
    return namedChildrenOf(node).find((child) => WRITTEN_TYPE_NODES.has(child.type))?.text;
  }

  /**
   * The parameters a declaration writes, in the order a caller passes them.
   *
   * **A `parameter` is not the whole of one.** Kotlin writes a default value and a `vararg` modifier as **siblings** of
   * the `parameter` inside `function_value_parameters`:
   *
   * ```
   * function_value_parameters
   *   parameter            (p: RetryPolicy)
   *   "="                  ← the default, one sibling to the right
   *   call_expression      (TODO())
   *   parameter_modifiers  (vararg)   ← the modifier, one sibling to the left
   *   parameter            (rest: Widget)
   * ```
   *
   * So a walk that read a `parameter` node and nothing else saw neither, and reported `fun send(p: X = …)` as requiring
   * `p` — which is a call the type checker refuses and the resolver would then answer.
   */
  private parametersOf(node: TreeSitterSyntaxNode): Array<{
    nameNode: TreeSitterSyntaxNode;
    type: string;
    optional: boolean;
    variadic: boolean;
  }> {
    // **A Kotlin function always writes its parameter list** - the grammar is
    // `fun type_parameters? (receiver_type '.')? simple_identifier function_value_parameters (':' type)? body?` - so the
    // lookup cannot come back empty.
    const list = namedChildrenOf(node).find((child) => child.type === 'function_value_parameters')!;
    const parameters: Array<{
      nameNode: TreeSitterSyntaxNode;
      type: string;
      optional: boolean;
      variadic: boolean;
    }> = [];
    let modifiers = '';
    for (const child of childrenOf(list)) {
      if (child.type === 'parameter_modifiers') {
        modifiers = child.text;
        continue;
      }
      if (child.type !== 'parameter') {
        // **`=` is the default marker and it is one sibling to the right of the parameter it defaults.** It is a token
        // of the list and not of the declaration, so this is the only place the fact exists.
        if (child.type === '=' && parameters.length > 0)
          parameters[parameters.length - 1]!.optional = true;
        continue;
      }
      // **A `parameter` always writes its name and its type** - `simple_identifier ':' user_type` - so both lookups
      // state the production rather than guard against a shape the parser cannot produce. A lambda's parameters are
      // written without either and are not `parameter` nodes.
      const nameNode = namedChildrenOf(child).find(
        (grandchild) => grandchild.type === 'simple_identifier',
      )!;
      parameters.push({
        nameNode,
        type: this.writtenTypeOf(child)!,
        optional: false,
        variadic: /\bvararg\b/.test(modifiers),
      });
      modifiers = '';
    }
    return parameters;
  }

  /**
   * What a declaration says it returns, from the type written after its parameter list.
   *
   * **Kotlin writes no `return_type` field**, unlike every other grammar this base serves: the return type is a
   * `user_type` (or a `nullable_type`, or a `function_type`) sitting between `function_value_parameters` and
   * `function_body`. So the position in the child list is the fact, and the body is where the search stops - a
   * `user_type` inside the body is a local's type and not this declaration's return.
   */
  private returnTypeOf(node: TreeSitterSyntaxNode): string | undefined {
    const children = namedChildrenOf(node);
    // **A Kotlin function always writes its parameter list** - the grammar is
    // `fun type_parameters? (receiver_type '.')? simple_identifier function_value_parameters (':' type)? body?` - so the
    // lookup cannot come back empty and the `!` states the production rather than a hope.
    const parameters = children.find((child) => child.type === 'function_value_parameters')!;
    const body = children.findIndex((child) => child.type === 'function_body');
    const end = body < 0 ? children.length : body;
    for (let index = children.indexOf(parameters) + 1; index < end; index++) {
      const child = children[index]!;
      if (WRITTEN_TYPE_NODES.has(child.type)) return child.text;
    }
    return undefined;
  }

  /** File what a declaration says it returns and how many arguments it takes, keyed the way a capture is. */
  private recordSignature(node: TreeSitterSyntaxNode, name: string): void {
    const key = `${node.startPosition.row + 1}\u0000${name}`;
    const written = this.returnTypeOf(node);
    if (written !== undefined) this.declaredReturns.set(key, written);
    const parameters = this.parametersOf(node);
    this.declaredArities.set(key, {
      parameters: parameters.length,
      // **A variadic parameter may receive nothing at all**, so it is never required - the rule the base provider states
      // for `String... parts` and `*args`.
      required: parameters.filter((parameter) => !parameter.optional && !parameter.variadic).length,
      variadic: parameters.some((parameter) => parameter.variadic),
      types: parameters.map((parameter) => parameter.type),
    });
  }

  /**
   * File each parameter as a declaration a call site can name.
   *
   * **The position is the only handle a call site has on a parameter.** A caller passes argument 1 and the callee's
   * argument 1 is whatever it declared first; without the ordinal the two cannot be matched. **The owner is the class
   * and the function** - `Service.send` - because the call site knows the class and not the file the declaration lives
   * in, which is the key `ownerKeyOf` builds and `containerOf` reads back.
   */
  private emitParameterDefs(
    node: TreeSitterSyntaxNode,
    name: string,
    enclosingClass: string | undefined,
    captures: UnifiedCapture[],
  ): void {
    const owner = ownerKeyOf(enclosingClass, name);
    for (const [parameterIndex, parameter] of this.parametersOf(node).entries()) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: parameter.nameNode.text,
        startLine: parameter.nameNode.startPosition.row + 1,
        endLine: parameter.nameNode.endPosition.row + 1,
        startByte: parameter.nameNode.startIndex,
        endByte: parameter.nameNode.endIndex,
        name: parameter.nameNode.text,
        properties: {
          filePath: this.filePath,
          parameterIndex: String(parameterIndex),
          // **A parameter at the top level of a `.kt` file has no class to be keyed by**, and the property is then
          // absent rather than empty - a key built from nothing answers nothing.
          ...(enclosingClass === undefined ? {} : { parameterOwner: owner }),
          parameterType: parameter.type,
        },
      });
    }
  }

  /** File a property's declared type under its class. */
  private recordPropertyType(node: TreeSitterSyntaxNode): void {
    const className = this.enclosingClassNameOf(node);
    if (className === undefined) return;
    const declaration = namedChildrenOf(node).find(
      (child) => child.type === 'variable_declaration',
    );
    if (declaration === undefined) return;
    const field = namedChildrenOf(declaration).find((child) => child.type === 'simple_identifier');
    const type = this.writtenTypeOf(declaration);
    if (field === undefined || type === undefined) return;
    this.fileFieldType(className, field.text, type);
  }

  /**
   * A `val` or `var` written **inside a function body is a local**, and it was invisible.
   *
   * `val local = helper(name)` is how every Kotlin body names an intermediate value, and the only branch that looked at
   * a `property_declaration` was the field-type recorder — which returns early when there is no enclosing class. So a
   * local reached the graph as nothing at all: not a symbol, not a name the resolver could type, and `variable.def` was
   * a row this language claimed and did not emit.
   *
   * **The declared type travels the way a field's does**, as the `declaredType` property a name's own declaration can
   * be asked for, because `val policy: RetryPolicy = …` states it in the same position.
   */
  private emitLocalDeclaration(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    if (this.enclosingClassNameOf(node) !== undefined) return;
    const declaration = namedChildrenOf(node).find(
      (child) => child.type === 'variable_declaration',
    );
    if (declaration === undefined) return;
    const nameNode = namedChildrenOf(declaration).find(
      (child) => child.type === 'simple_identifier',
    );
    if (nameNode === undefined) return;
    const type = this.writtenTypeOf(declaration);
    captures.push({
      tag: CAPTURE_TAGS.VARIABLE_DEF,
      text: `${nameNode.text}${type === undefined ? '' : `: ${type}`}`,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: nameNode.startIndex,
      endByte: nameNode.endIndex,
      name: nameNode.text,
      properties: {
        filePath: this.filePath,
        ...(type === undefined ? {} : { declaredType: type }),
      },
    });
  }

  /**
   * File a constructor parameter that also declares a property under its class.
   *
   * **A `class_parameter` is a field only when it says `val` or `var`.** `class Service(registry: Registry)` receives an
   * argument and declares nothing; `class Service(val policy: RetryPolicy)` declares both, which is the Kotlin idiom for
   * constructor injection - the same position this iteration's type reference was added for.
   */
  private recordConstructorPropertyType(node: TreeSitterSyntaxNode): void {
    if (namedChildrenOf(node).every((child) => child.type !== 'binding_pattern_kind')) return;
    const className = this.enclosingClassNameOf(node);
    if (className === undefined) return;
    const field = namedChildrenOf(node).find((child) => child.type === 'simple_identifier');
    const type = this.writtenTypeOf(node);
    if (field === undefined || type === undefined) return;
    this.fileFieldType(className, field.text, type);
  }

  /** One field, on its class. **A name two declarations disagree about has no type**, the resolver's own rule. */
  private fileFieldType(className: string, field: string, type: string): void {
    let fields = this.classFieldTypes.get(className);
    if (fields === undefined) {
      fields = new Map();
      this.classFieldTypes.set(className, fields);
    }
    if (fields.has(field) && fields.get(field) !== type) {
      fields.delete(field);
      return;
    }
    fields.set(field, type);
  }

  /**
   * One reference for a type a Kotlin declaration writes.
   *
   * **A qualified type is several `type_identifier` siblings joined by dots** - `kotlinx.coroutines.Flow` parses as
   * three nodes, not one token - so the member is the last node in that run and the packages in front of it name no
   * declaration. A package is not a symbol in any graph, and filing it would make every `kotlinx` token in a checkout a
   * mention of anything called `kotlinx`.
   *
   * **The run ends at the first child that is not a segment, which is the type-argument list.** `List<Widget>` writes
   * `List` here and `Widget` one level down, and recursing from where the run stopped is what keeps the argument - the
   * half that carries the information.
   */
  private captureUserType(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const children = namedChildrenOf(node);
    // **A `user_type` always begins with a `type_identifier`** - the grammar is
    // `type_identifier ('.' type_identifier)* type_arguments?` - so the run below is never empty and `member` is always
    // assigned. The definite-assignment assertion states the production rather than a hope, and it keeps the loop
    // honest: if the grammar ever changed, the compiler would not let this compile.
    let member!: TreeSitterSyntaxNode;
    let index = 0;
    while (index < children.length && children[index]!.type === 'type_identifier') {
      member = children[index]!;
      index++;
    }
    this.emitTypeReference(member, captures);
    for (; index < children.length; index++) this.walkAndCapture(children[index]!, captures);
  }

  /** One name, as the reference the kind `type` was declared for. */
  private emitTypeReference(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const name = node.text;
    if (this.typeParameterNames.has(name)) return;
    captures.push({
      tag: CAPTURE_TAGS.TYPE_REFERENCE,
      text: name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: node.startIndex,
      endByte: node.endIndex,
      name,
      properties: { filePath: this.filePath },
    });
  }

  /**
   * The superclass and the interfaces a Kotlin declaration names - the properties the resolver's class chain reads.
   *
   * **A Kotlin class has no `extends` keyword.** `class Foo : Base(), Runnable` puts both the superclass and the
   * interfaces in one colon-separated list of `delegation_specifier` nodes, and the resolver needs the base class
   * separately because only a class has a body to inherit: an interface declares signatures and no bodies, so an
   * edge to one answers a call with a declaration that has nothing behind it.
   *
   * **The discriminator is the argument list, and it is decisive here.** A Kotlin interface cannot be constructed,
   * so `Base()` can only name a class and a bare `Runnable` can only name an interface. The first invokable
   * specifier is the base class; everything else is a conformed interface. A declaration whose specifiers are all
   * bare names has no base class at all, which is what `class Foo : Runnable` is.
   */
  private heritageOf(node: TreeSitterSyntaxNode): {
    baseClasses?: string;
    interfaces?: string;
  } {
    const bases: string[] = [];
    const interfaces: string[] = [];
    for (const child of namedChildrenOf(node)) {
      if (child.type !== 'delegation_specifier') continue;
      // **The first type name is the specifier's own type**, and everything after it is an argument or a delegate:
      // `Base<Item>()` names `Base`, so descending the whole subtree would record `Item` as a base class too.
      const names: string[] = [];
      this.collectIdentifiers(child, names);
      const name = names[0];
      if (name === undefined) continue;
      if (this.findChild(child, 'constructor_invocation') === null) interfaces.push(name);
      else if (bases.length === 0) bases.push(name);
    }
    const heritage: { baseClasses?: string; interfaces?: string } = {};
    if (bases.length > 0) heritage.baseClasses = bases.join(',');
    if (interfaces.length > 0) heritage.interfaces = interfaces.join(',');
    return heritage;
  }

  private findChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (const child of namedChildrenOf(node)) {
      if (child.type === type) return child;
    }
    return null;
  }

  /**
   * Collect all identifier/namespace segments from an import node
   * into an ordered array of path parts.
   */
  private collectImportPathParts(node: TreeSitterSyntaxNode): string[] {
    const parts: string[] = [];
    for (const child of childrenOf(node)) {
      if (child.type === 'identifier') {
        parts.push(child.text);
      } else if (child.text === '*') {
        parts.push('*');
      }
    }
    return parts;
  }

  private ln(source: string, offset: number): number {
    return lineOf(source, offset);
  }
}
