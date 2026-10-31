// @code-analyzer/analyzer — Java Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import {
  collectCLikeTaintSanitizers,
  collectCLikeTaintSinks,
  collectCLikeTaintSources,
} from './base-c-like.js';
import {
  JAVA_TAINT_VOCABULARY,
  declaredConstructedTypes,
  writesToResponseBody,
} from './java-taint.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type {
  TaintSanitizer,
  TaintSink,
  TaintSource,
  TreeSitterLanguage,
  TreeSitterSyntaxNode,
} from './tree-sitter-base.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

const JAVA_EXTENSIONS = ['.java'];
const JAVA_GLOBS = ['**/*.java'];

/** java's names for the three node kinds the collectors need. */
const JAVA_TAINT_NODES = {
  member: ['field_access', 'method_invocation'],
  call: ['method_invocation', 'object_creation_expression'],
  argumentContainer: ['argument_list'],
};

export class JavaProvider extends TreeSitterBaseProvider {
  readonly language = 'java';
  readonly displayName = 'Java';
  readonly extensions = JAVA_EXTENSIONS;
  readonly globs = JAVA_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-java is a direct dependency of the analyzer, so this
    // require never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('tree-sitter-java') as TreeSitterLanguage;
  }

  /** Every identifier under `node`, in document order, without descending again where the walk will arrive. */
  private namesUnder(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode[] {
    const out: TreeSitterSyntaxNode[] = [];
    const visit = (current: TreeSitterSyntaxNode): void => {
      if (current.type === 'identifier') {
        out.push(current);
        return;
      }
      for (const child of namedChildrenOf(current)) visit(child);
    };
    visit(node);
    return out;
  }

  /**
   * Record every name under `node` as a use, on the line the statement begins.
   *
   * **`anchorLine` is the statement's line, not the identifier's.** A statement is a line: `prepareStatement(` on one
   * line and its arguments wrapped one per line below it is a single statement, and the CFG keys facts by line. When
   * each name carried its own line, the sink was filed under the line the callee starts on and the value it consumes
   * under a later one, so a taint wave and the sink it should have reached never occupied the same statement.
   *
   * Measured on OWASP Benchmark: 409 of the corpus's misses had a source and a sink in the same function and no flow
   * between them, and the corpus is formatted by a tool that wraps long argument lists. The two cases in
   * `java-assignment-flow.test.ts` are this shape reduced to one function.
   */
  private captureAccesses(
    node: TreeSitterSyntaxNode,
    captures: UnifiedCapture[],
    anchorLine: number,
  ): void {
    for (const name of this.namesUnder(node)) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_ACCESS,
        text: name.text,
        startLine: anchorLine,
        endLine: anchorLine,
        startByte: name.startIndex,
        endByte: name.endIndex,
        name: name.text,
        properties: { filePath: this.filePath },
      });
    }
  }

  /**
   * Record a def for each parameter of a function, which is what makes a parameter a binding.
   *
   * `attachArgumentBindings` resolves a call's arguments against the function's bindings, so without this a parameter
   * passed to a callee is recorded as `-1` and the taint the interprocedural wave carries - "parameter 0 of this
   * function" - can never be matched to the sink that receives it.
   *
   * **The name is a `name:` field, not the first identifier found**: `void m(Widget w)` is
   * `formal_parameter type: (type_identifier) name: (identifier)`, so **a search for the first identifier bound the
   * type**. A Java parameter always carries a name, and `method_declaration`/`constructor_declaration` always carry
   * their `formal_parameters`, so neither needs a guard.
   *
   * **`String... parts` is the one parameter that does not carry the field**: it is a `spread_parameter` wrapping a
   * `variable_declarator name: (identifier)`, so the name is read from the declarator there - **and `variableNameNode`
   * rather than a search, because that is the function that knows what a declarator's name looks like.**
   */
  private emitParameterDefs(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const list = namedChildrenOf(node).find((c) => c.type === 'formal_parameters')!;
    const names = namedChildrenOf(list).flatMap((parameter) => {
      const own = parameter.childForFieldName('name');
      return own
        ? [own]
        : namedChildrenOf(parameter)
            .filter((c) => c.type === 'variable_declarator')
            .map((declarator) => this.variableNameNode(declarator));
    });
    for (const name of names) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: name.text,
        startLine: name.startPosition.row + 1,
        endLine: name.endPosition.row + 1,
        startByte: name.startIndex,
        endByte: name.endIndex,
        name: name.text,
        properties: { filePath: this.filePath },
      });
    }
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;
    // The statement's first line, which is the key its facts are filed under. Every name this node reads is recorded
    // there rather than on the line the name happens to sit on; see `captureAccesses`.
    const line = node.startPosition.row + 1;

    if (nodeType === 'method_declaration' || nodeType === 'constructor_declaration') {
      this.emitParameterDefs(node, captures);
    }

    // **Java's statements, which it recorded none of.** It captured a class and a method and nothing inside either,
    // so the pipeline had neither a definition nor a use to work from.
    // **`field_declaration` is NOT handled here, and that is the fix.**
    //
    // **This branch used to name both node types**, and **a later `else if (nodeType === 'field_declaration')` held the
    // correct implementation** - **a loop over every declarator, using `variableNameNode`, which knows about
    // `underscore_pattern`.** **Because this branch matched first, that one was unreachable**, and **two tests failed on
    // exactly the two things the unreachable branch got right**: **`int a, b;` produced only `a`** (this branch used
    // `.find`, which takes the first), and **`int _;` produced nothing** (this branch looked only for `identifier`).
    //
    // **A duplicated branch is not merely dead code**: **it shadows the live one**, and **the tests that would have
    // caught the difference were asking the live one's questions.** **So the local case stays here and the field case
    // goes back to where the loop already is.**
    if (nodeType === 'local_variable_declaration') {
      // **The same loop the field case uses**, because **a local declaration has the same shape**
      // (`local_variable_declaration > variable_declarator`) and **the local copy was the one that had drifted**:
      // it took the first declarator with `.find`, so `int a, b;` produced only `a`, and it looked for an `identifier`
      // where `variableNameNode` knows about `underscore_pattern`.
      for (const declarator of namedChildrenOf(node).filter(
        (c) => c.type === 'variable_declarator',
      )) {
        const nameNode = this.variableNameNode(declarator);
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: nameNode.text,
          startLine: nameNode.startPosition.row + 1,
          endLine: nameNode.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
        // `int x;` declares without assigning, so the absent initialiser is ordinary.
        const value = namedChildrenOf(declarator)[1];
        if (value) this.captureAccesses(value, captures, line);
      }
    } else if (nodeType === 'method_invocation') {
      // **`name:` and `arguments:` are fields of the production**: `method_invocation object:? name: (identifier)
      // arguments: (argument_list)` - so the name is not something to search for, and **the argument list exists even
      // when the call takes nothing**.
      const nameNode = node.childForFieldName('name')!;
      const receiver = node.childForFieldName('object');
      captures.push({
        tag: receiver ? CAPTURE_TAGS.METHOD_CALL : CAPTURE_TAGS.FUNCTION_CALL,
        text: receiver ? `${receiver.text}.${nameNode.text}` : nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { filePath: this.filePath },
      });
      this.captureAccesses(node.childForFieldName('arguments')!, captures, line);
    } else if (nodeType === 'enhanced_for_statement') {
      // **`for (Cookie theCookie : theCookies)` binds a name that every iteration writes**, and nothing recorded it.
      // The consequence was concrete: on OWASP Benchmark's cookie vector the chain from the request to the sink runs
      // `request.getCookies()` → `theCookies` → `theCookie` → `theCookie.getValue()` → `param`, and the second arrow
      // was invisible, so a quarter of the corpus's request surface produced no flow at all.
      //
      // The loop variable is a def and the iterable is a use, at the same line: what the loop reads is what the body
      // is about to hold.
      const name = node.childForFieldName('name');
      if (name !== null) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: name.text,
          startLine: name.startPosition.row + 1,
          endLine: name.endPosition.row + 1,
          startByte: name.startIndex,
          endByte: name.endIndex,
          name: name.text,
          properties: { filePath: this.filePath },
        });
      }
      const value = node.childForFieldName('value');
      if (value !== null) this.captureAccesses(value, captures, line);
    } else if (nodeType === 'catch_formal_parameter') {
      // A caught exception is a binding a handler reads, and `e.getMessage()` is how its text reaches a response.
      const name = node.childForFieldName('name');
      if (name !== null) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: name.text,
          startLine: name.startPosition.row + 1,
          endLine: name.endPosition.row + 1,
          startByte: name.startIndex,
          endByte: name.endIndex,
          name: name.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'assignment_expression') {
      // **The statement Java writes most, and the one this recorded nothing for.**
      //
      // `fileName = Utils.testfileDir + param;` parses as
      // `expression_statement > assignment_expression left: (identifier) right: (binary_expression)`, and every branch
      // above asked for its own node type: a declaration captured its initialiser, a call captured its arguments, and
      // **an assignment captured neither the def it writes nor the uses it reads**. Measured on OWASP Benchmark, the
      // consequence was that taint could only ever reach a sink when the value was declared and passed on one line —
      // 142 of 1 415 real vulnerabilities — because the two shapes the corpus is built from are
      // `bar = request.getParameter("x")` and `param = bar`.
      //
      // The left side is a def when it names a binding, and a use when it names a field: `this.value = x` reads the
      // receiver even though it writes the field, and dropping that read would hide a flow through a field.
      // **Both fields are required by the grammar**, and this is the same convention the `method_invocation` case
      // below uses for `name:` and `arguments:`: `assignment_expression` is `left: right:`, and a file whose parse
      // loses one of them does not produce the node at all — `x = ;` collapses to nothing rather than to an
      // assignment. A guard here would be a branch no input can take.
      const left = node.childForFieldName('left')!;
      if (left.type === 'identifier') {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: left.text,
          startLine: left.startPosition.row + 1,
          endLine: left.endPosition.row + 1,
          startByte: left.startIndex,
          endByte: left.endIndex,
          name: left.text,
          properties: { filePath: this.filePath },
        });
      } else {
        this.captureAccesses(left, captures, line);
      }
      this.captureAccesses(node.childForFieldName('right')!, captures, line);
    } else if (nodeType === 'object_creation_expression') {
      // **`new File(fileName)` is where a path sink's argument is read**, and a constructor is not a
      // `method_invocation`, so nothing recorded the value being passed to it. The creation is recorded as a call as
      // well, because `new ProcessBuilder(cmd)` is how a Java program starts a process and a call graph that omits it
      // cannot see the flow that ends in `start()`.
      const type = node.childForFieldName('type')!;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_CALL,
        text: type.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: type.text,
        properties: { filePath: this.filePath },
      });
      // `new Foo()` always carries an `argument_list`, empty when the call passes nothing — the grammar requires it.
      this.captureAccesses(node.childForFieldName('arguments')!, captures, line);
    } else if (nodeType === 'expression_statement') {
      // **A bare name used as a statement**, which Java only permits as an assignment, an increment or a call - but
      // **a file being edited parses into shapes the language would reject**, and `x.y;` is a `field_access` rather
      // than an `identifier`, so both forms are recorded.
      const inner = node.child(0);
      if (inner.type === 'identifier' || inner.type === 'field_access') {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_ACCESS,
          text: inner.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: inner.startIndex,
          endByte: inner.endIndex,
          name: inner.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'class_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      let baseClasses = '';
      let interfaces = '';
      for (const child of namedChildrenOf(node)) {
        if (child.type === 'superclass') {
          baseClasses = this.typeBaseName(child.namedChild(0));
        } else if (child.type === 'super_interfaces') {
          interfaces = this.interfaceNames(child);
        }
      }
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { baseClasses, interfaces, filePath: this.filePath },
      });
    } else if (nodeType === 'interface_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `interface ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'enum_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'method_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      // A method_declaration is always a method, never a constructor — Java
      // constructors are parsed as constructor_declaration (no return type).
      const container = this.findContainerNode(node)!;
      const cn = this.findChild(container, 'identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.METHOD_DEF,
        text: nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        containerName: cn.text,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'constructor_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      // A constructor is always nested inside a class or enum declaration.
      const container = this.findContainerNode(node)!;
      const cn = this.findChild(container, 'identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.CONSTRUCTOR_DEF,
        text: nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        containerName: cn.text,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'field_declaration') {
      // A field_declaration can declare multiple variables (e.g. `int a, b;`),
      // each emitted as its own VARIABLE_DEF capture.
      for (const declarator of namedChildrenOf(node)) {
        if (declarator.type !== 'variable_declarator') continue;
        const nameNode = this.variableNameNode(declarator);
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'import_declaration') {
      const parts: string[] = [];
      for (const child of namedChildrenOf(node)) {
        if (child.type === 'scoped_identifier') {
          this._collectIdentifiers(child, parts);
        } else if (child.type === 'identifier') {
          parts.push(child.text);
        }
      }
      // An import_declaration always carries an identifier or scoped_identifier.
      const path = parts.join('.');
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: path,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: path,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'annotation' || nodeType === 'marker_annotation') {
      const nameNode =
        this.findChild(node, 'identifier') ?? this.findChild(node, 'scoped_identifier');
      // An annotation's name field is always an identifier or scoped_identifier.
      const name = nameNode!.text;
      captures.push({
        tag: CAPTURE_TAGS.DECORATOR,
        text: node.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name,
        properties: { decorator: name, filePath: this.filePath },
      });
    }

    for (const child of childrenOf(node)) {
      this.walkAndCapture(child, captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_declaration') {
      const line = node.startPosition.row + 1;
      let isWildcard = false;
      const parts: string[] = [];

      for (const child of childrenOf(node)) {
        if (child.text === '*') isWildcard = true;
      }
      for (const child of namedChildrenOf(node)) {
        if (child.type === 'scoped_identifier') {
          this._collectIdentifiers(child, parts);
        } else if (child.type === 'identifier') {
          parts.push(child.text);
        }
      }

      // An import_declaration always carries an identifier or scoped_identifier.
      const path = parts.join('.');
      imports.push({
        source: path,
        names: isWildcard ? [] : [parts[parts.length - 1]!],
        type: isWildcard ? 'wildcard' : 'named',
        lineNumber: line,
      });
      return;
    }

    for (const child of childrenOf(node)) {
      this.walkForImports(child, imports);
    }
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    const nodeType = node.type;

    if (
      nodeType === 'class_declaration' ||
      nodeType === 'interface_declaration' ||
      nodeType === 'enum_declaration' ||
      nodeType === 'method_declaration' ||
      nodeType === 'constructor_declaration'
    ) {
      if (this.hasPublicModifier(node)) {
        const nameNode = this.findChild(node, 'identifier')!;
        if (nameNode.text === symbolName) return true;
      }
    } else if (nodeType === 'field_declaration') {
      if (this.hasPublicModifier(node)) {
        for (const declarator of namedChildrenOf(node)) {
          if (declarator.type !== 'variable_declarator') continue;
          if (this.variableNameNode(declarator).text === symbolName) return true;
        }
      }
    }

    for (const child of childrenOf(node)) {
      if (this.checkExported(child, symbolName)) return true;
    }
    return false;
  }

  // Fallbacks
  public override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;
    const clRegex = /(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/g;
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
    const ifRegex = /(?:public\s+)?interface\s+(\w+)/g;
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
    const enumRegex = /(?:public\s+)?enum\s+(\w+)/g;
    while ((m = enumRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
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

  public override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const regex = /import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;/g;
    while ((m = regex.exec(source)) !== null) {
      const parts = m[1]!.split('.');
      imports.push({
        source: m[1]!,
        names: [parts[parts.length - 1]!],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  public override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `public\\s+(?:class|interface|enum)\\s+${s}\\b|public\\s+(?:static\\s+)?\\w+\\s+${s}\\b|public\\s+\\w+\\s+${s}\\s*\\(`,
    ).test(source);
  }

  // Helpers
  private findChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (const child of namedChildrenOf(node)) {
      if (child.type === type) return child;
    }
    return null;
  }

  /**
   * Extract the leaf name of a class/interface type. Unwraps generic types,
   * scoped (dotted) types, and type-use annotations to the base identifier,
   * e.g. `java.util.AbstractList<String>` -> `AbstractList`.
   */
  private typeBaseName(type: TreeSitterSyntaxNode): string {
    if (
      type.type === 'generic_type' ||
      type.type === 'scoped_type_identifier' ||
      type.type === 'annotated_type'
    ) {
      for (let i = type.namedChildCount - 1; i >= 0; i--) {
        const child = type.namedChild(i);
        if (child.type === 'type_identifier') return child.text;
        if (
          child.type === 'generic_type' ||
          child.type === 'scoped_type_identifier' ||
          child.type === 'annotated_type'
        ) {
          return this.typeBaseName(child);
        }
      }
    }
    return type.text;
  }

  /** Join the comma-separated interface names of a super_interfaces clause. */
  private interfaceNames(superInterfaces: TreeSitterSyntaxNode): string {
    const typeList = superInterfaces.namedChild(0);
    const names: string[] = [];
    for (const child of namedChildrenOf(typeList)) {
      names.push(this.typeBaseName(child));
    }
    return names.join(',');
  }

  /** Whether a declaration carries a `public` visibility modifier. */
  private hasPublicModifier(node: TreeSitterSyntaxNode): boolean {
    for (const child of namedChildrenOf(node)) {
      if (child.type === 'modifiers') {
        return /\bpublic\b/.test(child.text);
      }
    }
    return false;
  }

  /** The name node of a variable_declarator (an identifier or `_` pattern). */
  private variableNameNode(declarator: TreeSitterSyntaxNode): TreeSitterSyntaxNode {
    const nameNode =
      this.findChild(declarator, 'identifier') ?? this.findChild(declarator, 'underscore_pattern');
    // A variable_declarator always carries an identifier or underscore_pattern name.
    return nameNode!;
  }

  private _collectIdentifiers(node: TreeSitterSyntaxNode, result: string[]): void {
    if (node.type === 'identifier') {
      result.push(node.text);
      return;
    }
    for (const child of namedChildrenOf(node)) {
      this._collectIdentifiers(child, result);
    }
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
  // Taint sources and sinks. The base class parses and recurses but recognises nothing, and only five providers
  // override it — none of them a language where a web application's untrusted input arrives.
  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    collectCLikeTaintSources(node, sources, JAVA_TAINT_NODES, JAVA_TAINT_VOCABULARY);
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    collectCLikeTaintSinks(node, sinks, JAVA_TAINT_NODES, JAVA_TAINT_VOCABULARY);
  }

  /**
   * The sinks the vocabulary matched, minus the ones whose destination is not the response.
   *
   * **The vocabulary matches a method name, and a method name does not name a destination.** `write` is a response
   * body, a file, or a string builder depending on the receiver's declared type, and the receiver's type is in the
   * file this walk just read. Filtering here rather than in the walk keeps the shared collector free of a notion only
   * Java has, and keeps the filter testable against one file of source.
   */
  override extractTaintSinks(source: string): TaintSink[] {
    const sinks = super.extractTaintSinks(source);
    const declaredTypes = declaredConstructedTypes(source);
    return sinks.filter((sink) => writesToResponseBody(sink, declaredTypes));
  }

  // Sanitizers. Nothing in this family recognised one before, so every finding was reported unsanitized.
  protected override walkForSanitizers(
    node: TreeSitterSyntaxNode,
    sanitizers: TaintSanitizer[],
  ): void {
    collectCLikeTaintSanitizers(node, sanitizers, JAVA_TAINT_NODES, JAVA_TAINT_VOCABULARY);
  }
}
