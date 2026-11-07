// @code-analyzer/analyzer — Groovy Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: classes, methods, traits, closures, GStrings,
// metaprogramming injection sinks.

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type {
  TreeSitterLanguage,
  TreeSitterSyntaxNode,
  TaintSource,
  TaintSink,
  TaintSanitizer,
} from './tree-sitter-base.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

export class GroovyProvider extends TreeSitterBaseProvider {
  readonly language = 'groovy';
  readonly displayName = 'Groovy';
  readonly extensions = ['.groovy', '.gvy', '.gy', '.gsh'];
  readonly globs = ['**/*.groovy', '**/*.gvy', '**/*.gy', '**/*.gsh'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-groovy is a direct dependency of the analyzer, so this require
    // never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('tree-sitter-groovy') as TreeSitterLanguage;
    return m;
  }

  /**
   * The facts a declaration states about its own signature: what it returns and how many arguments it takes.
   *
   * **One reader for the two declarations that have a signature**, because a method and a constructor differ in whether
   * they have a return type and in nothing else the resolver asks about. `parameterTypes` is written in call order and
   * `requiredParameters` counts the ones without a default — Groovy's `String name = 'x'` is one parameter and zero
   * required ones.
   */
  private declarationFactsOf(node: TreeSitterSyntaxNode): Record<string, string> {
    const facts: Record<string, string> = {};
    const returnType = this.writtenTypeOf(node);
    // **`def` is not a type.** The grammar spells it `type_identifier "def"`, and the language means "whatever this
    // returns" - so the fact is absent rather than `def`, which is the difference between a name the resolver can look
    // up and one it cannot.
    if (returnType !== '' && returnType !== 'def') facts['returnType'] = returnType;
    const parameters = namedChildrenOf(node).find((child) => child.type === 'formal_parameters');
    if (parameters !== undefined) {
      const list = namedChildrenOf(parameters).filter((child) => child.type === 'formal_parameter');
      facts['parameterCount'] = String(list.length);
      facts['parameterTypes'] = JSON.stringify(
        list.map((each) => this.declaredParameterType(each)),
      );
      // **A default value is a sibling of the name, not a field of it.** `void draw(String name = 'x')` parses as
      // `formal_parameter type: (type_identifier) name: (identifier) (string_literal)`, so the question is whether any
      // named child starts after the name does.
      facts['requiredParameters'] = String(list.filter((each) => !this.hasDefault(each)).length);
    }
    return facts;
  }

  /**
   * Whether a `type_identifier` is the *name* of an untyped parameter rather than a type.
   *
   * **The grammar has no other way to spell `draw(labels)`** — see the `formal_parameter` branch — and the cost of
   * reading it as a type is an edge from the method to a class named after its own argument.
   */
  private isUntypedParameterName(node: TreeSitterSyntaxNode): boolean {
    const parent = node.parent;
    if (parent === null || parent.type !== 'formal_parameter') return false;
    const writtenName = parent.childForFieldName('name');
    return writtenName === null || writtenName.text.length === 0;
  }

  /**
   * The parts of a `formal_parameter` that were written, in the order the grammar reads them.
   *
   * **An untyped parameter is parsed as a type with the name inserted**, and the inserted token has no text:
   * `void draw(labels)` is `formal_parameter type: (type_identifier "labels") name: (MISSING identifier)`. So a
   * parameter that writes a type has **two** children with text and one that does not has **one** — which is the whole
   * test, and it is an index rather than a branch.
   */
  private writtenPartsOf(parameter: TreeSitterSyntaxNode): TreeSitterSyntaxNode[] {
    return namedChildrenOf(parameter).filter((child) => child.text.length > 0);
  }

  /** The name a `formal_parameter` binds: the second written part when there is one, the first when there is not. */
  private parameterNameIn(parameter: TreeSitterSyntaxNode): string {
    const parts = this.writtenPartsOf(parameter);
    return parts[Math.min(1, parts.length - 1)]!.text;
  }

  /** The type a `formal_parameter` declares, or the empty string when the author wrote none. */
  private declaredParameterType(parameter: TreeSitterSyntaxNode): string {
    const parts = this.writtenPartsOf(parameter);
    return parts.length < 2 ? '' : parts[0]!.text;
  }

  /** Whether a parameter writes a default value, which is a third written part after its name. */
  private hasDefault(parameter: TreeSitterSyntaxNode): boolean {
    return this.writtenPartsOf(parameter).length > 2;
  }

  /** The modifiers a declaration writes, as text — `public static final`, `abstract`, or nothing. */
  private modifiersOf(node: TreeSitterSyntaxNode): string {
    return namedChildrenOf(node).find((child) => child.type === 'modifiers')?.text ?? '';
  }

  /**
   * The type a declaration writes to the left of its name.
   *
   * **Groovy writes it the way Java does and spells it with the same node types** — `void_type`, `integral_type`,
   * `type_identifier`, or a `generic_type` that wraps both — so the field the grammar calls `type` is the one to read,
   * and the text is the type as the author wrote it.
   */
  private writtenTypeOf(node: TreeSitterSyntaxNode): string {
    // **A declaration without a `type` field answers the empty string**, which is a fact and not an absence: a
    // constructor writes no return type, and a caller that had to handle `undefined` would carry a branch for a shape
    // the grammar produces on every second declaration.
    const written = node.childForFieldName('type');
    return written === null ? '' : written.text;
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'class_declaration') {
      // A class_declaration always carries an `identifier` named child in a valid
      // parse; walkAndCapture only runs on error-free trees.
      const nameNode = this.findIdent(node);
      const baseClasses = this.extractGroovyBases(node);
      // **`abstract` is a modifier and not part of the name**, so a class the language lets you instantiate and one it
      // does not were the same capture. It travels as a property, which is the shape the matrix row reads and the shape
      // Java already writes.
      const isAbstract = /\babstract\b/.test(this.modifiersOf(node));
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF, nameNode.text, `class ${nameNode.text}`, {
          baseClasses,
          ...(isAbstract ? { abstract: 'true' } : {}),
        }),
      );
    } else if (nt === 'interface_declaration') {
      // **An interface was invisible**, so `implements Drawable` named nothing the resolver could look up and the
      // matrix row for it was `—`: the walk had branches for classes, traits and enums and none for the third of the
      // three declarations a JVM language writes at file scope.
      const nameNode = this.findIdent(node);
      captures.push(
        this.makeCapture(
          node,
          CAPTURE_TAGS.INTERFACE_DEF,
          nameNode.text,
          `interface ${nameNode.text}`,
        ),
      );
    } else if (nt === 'juxt_function_call' && this.findIdent(node).text === 'trait') {
      // tree-sitter-groovy parses `trait Name {}` as a juxt_function_call whose
      // first identifier is 'trait' and whose argument_list holds the trait name.
      const nameNode = this.findIdent(node.namedChild(1));
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.TRAIT_DEF, nameNode.text, `trait ${nameNode.text}`),
      );
    } else if (nt === 'enum_declaration') {
      const nameNode = this.findIdent(node);
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.ENUM_DEF, nameNode.text, `enum ${nameNode.text}`),
      );
    } else if (nt === 'method_declaration') {
      const nameNode = this.findIdent(node);
      let containerName: string | undefined;
      const container = this.findContainerNode(node);
      if (container) containerName = this.extractContainerName(container);
      const isConstructor = containerName === nameNode.text;
      captures.push(
        this.makeCapture(
          node,
          isConstructor ? CAPTURE_TAGS.CONSTRUCTOR_DEF : CAPTURE_TAGS.METHOD_DEF,
          nameNode.text,
          nameNode.text,
          {
            containerName: containerName ?? '',
            isConstructor: String(isConstructor),
            ...this.declarationFactsOf(node),
            ...(containerName === undefined ? {} : { enclosingClass: containerName }),
          },
        ),
      );
    } else if (nt === 'constructor_declaration') {
      const nameNode = this.findIdent(node);
      // **A constructor is inside a class by construction**, so the container exists and the `undefined` arm was a
      // branch no Groovy file can take.
      const containerName = this.extractContainerName(this.findContainerNode(node)!) ?? '';
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.CONSTRUCTOR_DEF, nameNode.text, nameNode.text, {
          ...this.declarationFactsOf(node),
          enclosingClass: containerName,
        }),
      );
    } else if (nt === 'formal_parameter') {
      // **A parameter is a name a call site can pass**, and the type it declares is what the resolver needs to match an
      // argument to it. The count alone was in the signature; the name was nowhere.
      //
      // **And an untyped parameter parses as a type with no name.** `void draw(labels)` is
      // `formal_parameter type: (type_identifier "labels") name: (MISSING identifier)`: the grammar reads the only
      // identifier it finds as the type and inserts the name it required. Taking `type` at face value would file the
      // parameter's *name* as its type and leave the parameter nameless.
      const name = this.parameterNameIn(node);
      const parameterType = this.declaredParameterType(node);
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF, name, name, {
          ...(parameterType === '' ? {} : { parameterType }),
        }),
      );
    } else if (nt === 'type_identifier' && !this.isUntypedParameterName(node)) {
      // **A name in a type position is a reference, and in Groovy it is the only one there is.** `List<String>
      // labels` names `List` and `String` and declares neither; without this capture a class named only in a field
      // type is reported dead. The node type is the whole test - the grammar spells a type position with
      // `type_identifier` and a declaration with `identifier` - so no parent test is needed.
      captures.push(this.makeCapture(node, CAPTURE_TAGS.TYPE_REFERENCE, node.text, node.text));
    } else if (nt === 'field_declaration' || nt === 'local_variable_declaration') {
      // **A local was invisible.** `List<String> local = helper(labels)` is how every Groovy method names an
      // intermediate value, and the only branch that looked at a declaration was the field's — so a local reached the
      // graph as nothing at all and the matrix row for variables was `—` in a language that declares them in every
      // method body. **The declared type travels with it**, because the resolver's question about a name is what it is.
      const declaredType = this.writtenTypeOf(node);
      for (const child of namedChildrenOf(node)) {
        if (child.type === 'variable_declarator') {
          const idNode = this.findIdent(child);
          captures.push(
            this.makeCapture(child, CAPTURE_TAGS.VARIABLE_DEF, idNode.text, idNode.text, {
              ...(declaredType === undefined ? {} : { declaredType }),
            }),
          );
        }
      }
    } else if (nt === 'import_declaration') {
      const importPath = node.text
        .replace(/^import\s+/i, '')
        .replace(/;?\s*$/, '')
        .trim();
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.IMPORT, importPath, importPath, {
          importType: 'named',
        }),
      );
    } else if (nt === 'method_invocation') {
      const callName = this.extractCallName(node);
      // Nothing to name the call by, so there is no capture to record.
      if (!callName) return;
      captures.push(this.makeCapture(node, CAPTURE_TAGS.METHOD_CALL, callName, callName));
    } else if (nt === 'closure') {
      captures.push(
        this.makeCapture(
          node,
          CAPTURE_TAGS.FUNCTION_DEF,
          `closure_${node.startPosition.row + 1}`,
          '{ ... }',
          { isClosure: 'true' },
        ),
      );
    } else if (nt === 'string_literal' && node.text.includes('${')) {
      // tree-sitter-groovy does not emit a dedicated GString node: `${name}` is
      // parsed as a literal string_fragment, so detect GStrings by scanning the
      // raw text for the interpolation marker.
      captures.push(
        this.makeCapture(
          node,
          CAPTURE_TAGS.VARIABLE_DEF,
          `gstring_${node.startPosition.row + 1}`,
          node.text,
          { isGString: 'true' },
        ),
      );
    } else if (nt === 'annotation' || nt === 'marker_annotation') {
      // **Both spellings.** `@Override` has no argument list and the grammar calls it `marker_annotation`; `@Throws(…)`
      // has one and it is `annotation`. The walk knew only the second, so the decorator row was `—` for a language whose
      // standard library ships a dozen marker annotations.
      const nameNode = this.findIdent(node);
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.ANNOTATION, nameNode.text, node.text, {
          isAnnotation: 'true',
        }),
      );
    } else if (nt === 'line_comment' || nt === 'block_comment') {
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.COMMENT, '[comment]', node.text.trim(), {
          isComment: 'true',
        }),
      );
    }

    for (const child of childrenOf(node)) {
      this.walkAndCapture(child, captures);
    }
  }

  // ---- Taint Analysis ----

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    if (node.type === 'method_invocation') {
      const name = this.extractCallName(node);
      // A source is reported under its name, so an anonymous invocation is not a
      // source. Narrowing here also makes `fullName` a string for the matches below.
      if (!name) return;
      const fullName = this.extractFullCallName(node) ?? name;
      const line = node.startPosition.row + 1;
      // Groovy-specific taint sources. `System.console` / `System.in` are nested
      // receivers (field_access), so they are matched via the full call name; the
      // remaining sources are leading identifiers exposed directly by
      // extractCallName.
      if (
        fullName.startsWith('System.console.') ||
        fullName.startsWith('System.in.') ||
        name === 'args' ||
        name === 'binding' ||
        name.includes('request') ||
        name.includes('params')
      ) {
        sources.push({
          name: fullName,
          sourceType: 'user_input',
          line,
          text: node.text,
          properties: {},
        });
        return;
      }
      if (fullName === 'Eval.me' || fullName === 'Eval.x') {
        sources.push({
          name: fullName,
          sourceType: 'code_injection',
          line,
          text: node.text,
          properties: {},
        });
        return;
      }
      return;
    }
    for (const child of childrenOf(node)) {
      this.walkForTaintSources(child, sources);
    }
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    if (node.type === 'method_invocation') {
      const name = this.extractCallName(node);
      // A source is reported under its name, so an anonymous invocation is not a
      // source. Narrowing here also makes `fullName` a string for the matches below.
      if (!name) return;
      const fullName = this.extractFullCallName(node) ?? name;
      const line = node.startPosition.row + 1;
      // Groovy metaprogramming sinks. GroovyShell / GroovyScriptEngine are object
      // receivers (object_creation_expression), so they are matched via the full
      // call name.
      if (
        fullName === 'Eval.me' ||
        fullName === 'Eval.x' ||
        fullName.includes('GroovyShell') ||
        fullName.includes('GroovyScriptEngine') ||
        name === 'evaluate'
      ) {
        sinks.push({
          name: fullName,
          sinkType: 'code_injection',
          line,
          text: node.text,
          properties: {},
        });
        return;
      }
      // SQL sinks in Groovy — match the full call name (receiver.method)
      if (fullName.includes('execute') || fullName.includes('Sql')) {
        sinks.push({ name: fullName, sinkType: 'sql_exec', line, text: node.text, properties: {} });
      }
      // File write sinks — match the full call name (receiver.method)
      if (
        fullName.includes('write') ||
        fullName.includes('withWriter') ||
        fullName.includes('withOutputStream')
      ) {
        sinks.push({
          name: fullName,
          sinkType: 'file_write',
          line,
          text: node.text,
          properties: {},
        });
      }
      return;
    }
    for (const child of childrenOf(node)) {
      this.walkForTaintSinks(child, sinks);
    }
  }

  protected override walkForSanitizers(
    node: TreeSitterSyntaxNode,
    sanitizers: TaintSanitizer[],
  ): void {
    if (node.type === 'method_invocation') {
      const name = this.extractCallName(node);
      // A source is reported under its name, so an anonymous invocation is not a
      // source. Narrowing here also makes `fullName` a string for the matches below.
      if (!name) return;
      const fullName = this.extractFullCallName(node) ?? name;
      const line = node.startPosition.row + 1;
      // Groovy sanitizers — the sanitizer is the trailing method name.
      const methodName = fullName.split('.').pop();
      if (
        methodName === 'encodeAsHTML' ||
        methodName === 'encodeAsJavaScript' ||
        methodName === 'encodeAsURL' ||
        methodName === 'escape' ||
        methodName === 'stripIndent' ||
        methodName === 'replaceAll'
      ) {
        sanitizers.push({
          name: fullName,
          sanitizerType: 'encoding',
          line,
          text: node.text,
          properties: {},
        });
        return;
      }
      return;
    }
    for (const child of childrenOf(node)) {
      this.walkForSanitizers(child, sanitizers);
    }
  }

  // ---- Helpers ----

  private extractFullCallName(node: TreeSitterSyntaxNode): string | null {
    // Reconstruct the full dotted call path. tree-sitter-groovy flattens a
    // two-part receiver into direct identifier children (Eval.me(script) →
    // "Eval" + "me") but nests deeper receivers: System.console.readLine() →
    // field_access "System.console" + identifier "readLine", and
    // new GroovyShell().evaluate() → object_creation_expression + identifier
    // "evaluate". Collect every identifier in document order and join with '.';
    // a bare call (foo()) has no receiver, so return null.
    const parts: string[] = [];
    const collect = (n: TreeSitterSyntaxNode): void => {
      for (const child of childrenOf(n)) {
        if (
          child.type === 'identifier' ||
          child.type === 'type_identifier' ||
          child.type === 'property_identifier'
        ) {
          parts.push(child.text);
        } else if (child.type === 'field_access' || child.type === 'object_creation_expression') {
          collect(child);
        }
      }
    };
    collect(node);
    return parts.length > 1 ? parts.join('.') : null;
  }

  private findIdent(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode {
    // The declared name is always an `identifier` named child. A method_declaration
    // also carries a leading type_identifier ("def"/return-type keyword), which is
    // skipped here. Every call site passes a declaration node that carries an
    // `identifier` in an error-free parse, so this loop always returns.
    for (const child of namedChildrenOf(node)) {
      if (child.type === 'identifier') return child;
    }
    throw new Error(`groovy: no identifier child on ${node.type}`);
  }

  private extractGroovyBases(node: TreeSitterSyntaxNode): string {
    const parts: string[] = [];
    for (const child of namedChildrenOf(node)) {
      if (child.type === 'superclass' || child.type === 'super_interfaces') {
        // super_interfaces wraps its types in a type_list node (implements A, B),
        // so collect identifiers recursively rather than only reading direct children.
        this.collectIdentifiers(child, parts);
      }
    }
    return parts.join(',');
  }

  private makeCapture(
    node: TreeSitterSyntaxNode,
    tag: (typeof CAPTURE_TAGS)[keyof typeof CAPTURE_TAGS],
    name: string,
    text: string,
    extra: Record<string, string> = {},
  ): UnifiedCapture {
    return {
      tag,
      text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: node.startIndex,
      endByte: node.endIndex,
      name,
      properties: { filePath: this.filePath, ...extra },
    };
  }

  // ---- Import Extraction ----

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_declaration') {
      const text = node.text
        .replace(/^import\s+/i, '')
        .replace(/;?\s*$/, '')
        .trim();
      const parts = text.split('.');
      imports.push({
        source: text,
        names: [parts[parts.length - 1]!],
        type: 'named',
        lineNumber: node.startPosition.row + 1,
      });
      return;
    }
    for (const child of childrenOf(node)) {
      this.walkForImports(child, imports);
    }
  }

  protected override checkExported(_node: TreeSitterSyntaxNode, _symbolName: string): boolean {
    return true; // Groovy defs are visible by default
  }

  // ---- Fallback ----

  public override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const classRx = /(?:abstract\s+)?class\s+(\w+)/g;
    while ((m = classRx.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${m[1]!}`,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const traitRx = /trait\s+(\w+)/g;
    while ((m = traitRx.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.TRAIT_DEF,
        text: `trait ${m[1]!}`,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const enumRx = /enum\s+(\w+)/g;
    while ((m = enumRx.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${m[1]!}`,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const funcRx = /(?:def\s+|(?:void|int|String|boolean|def|Object)\s+)(\w+)\s*\(/g;
    while ((m = funcRx.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const impRx = /import\s+(?:static\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = impRx.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { importType: 'named', filePath },
      });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  public override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const impRx = /import\s+(?:static\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = impRx.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!.split('.').pop()!],
        type: 'named',
        lineNumber: ln(m.index),
      });
    }
    return imports;
  }

  public override fallbackIsExported(_source: string, _symbolName: string): boolean {
    return true;
  }

  public override fallbackExtractTaintSources(source: string): TaintSource[] {
    const sources: TaintSource[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx = /\b(Eval\.me|Eval\.x|System\.console|request|params)\b/g;
    while ((m = rx.exec(source)) !== null) {
      const isCodeInjection = m[1] === 'Eval.me' || m[1] === 'Eval.x';
      sources.push({
        name: m[1]!,
        sourceType: isCodeInjection ? 'code_injection' : 'user_input',
        line: ln(m.index),
        text: m[0],
        properties: {},
      });
    }
    return sources;
  }

  public override fallbackExtractTaintSinks(source: string): TaintSink[] {
    const sinks: TaintSink[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx =
      /\b(Eval\.me|Eval\.x|GroovyShell|GroovyScriptEngine|evaluate|executeUpdate|\.execute\()\b/g;
    while ((m = rx.exec(source)) !== null) {
      const matched = m[1];
      if (!matched) continue;
      const isCodeInjection = matched.toLowerCase().includes('eval') || matched.includes('Groovy');
      sinks.push({
        name: matched,
        sinkType: isCodeInjection ? 'code_injection' : 'sql_exec',
        line: ln(m.index),
        text: m[0],
        properties: {},
      });
    }
    return sinks;
  }

  public override fallbackExtractSanitizers(_source: string): TaintSanitizer[] {
    return [];
  }
}
