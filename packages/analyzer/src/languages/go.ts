// @code-analyzer/analyzer — Go Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import {
  collectCLikeTaintSanitizers,
  collectCLikeTaintSinks,
  collectCLikeTaintSources,
} from './base-c-like.js';
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

const goExtensions = ['.go'];
const goGlobs = ['**/*.go'];

/** go's names for the three node kinds the collectors need. */
const GO_TAINT_NODES = {
  member: ['selector_expression'],
  call: ['call_expression'],
  argumentContainer: ['argument_list'],
};

export class GoProvider extends TreeSitterBaseProvider {
  readonly language = 'go';
  readonly displayName = 'Go';
  readonly extensions = goExtensions;
  readonly globs = goGlobs;
  readonly importSemantics = 'wildcard-leaf' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-go is a direct dependency of the analyzer, so this
    // require never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('tree-sitter-go') as TreeSitterLanguage;
  }

  /** Every identifier under `node`, in document order, without descending again where the walk will arrive. */
  private namesUnder(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode[] {
    const out: TreeSitterSyntaxNode[] = [];
    const visit = (current: TreeSitterSyntaxNode): void => {
      if (current.type === 'identifier' || current.type === 'field_identifier') {
        out.push(current);
        return;
      }
      for (const child of namedChildrenOf(current)) visit(child);
    };
    visit(node);
    return out;
  }

  /** Record every name under `node` as a use. */
  private captureAccesses(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    for (const name of this.namesUnder(node)) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_ACCESS,
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

  /** Record a `variable.def` for every name under `node`. */
  private captureDefs(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    for (const name of this.namesUnder(node)) {
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

  /**
   * Record a def for each parameter of a function, which is what makes a parameter a binding.
   *
   * `attachArgumentBindings` resolves a call's arguments against the function's bindings, so without this a parameter
   * passed to a callee is recorded as `-1` and the taint the interprocedural wave carries - "parameter 0 of this
   * function" - can never be matched to the sink that receives it.
   *
   * **A method has two parameter lists, not one**: `func (s *Server) Handle(id string)` is
   * `method_declaration receiver: (parameter_list …) name: (field_identifier) parameters: (parameter_list …)`, and
   * **the first one is the receiver**. Taking the first with `.find` therefore bound the receiver and **dropped every
   * parameter of every method** - the ones the argument positions actually map onto - while looking like it worked,
   * because it did emit one def. Both lists are bindings, so both are walked.
   *
   * **An unnamed parameter declares a type and no binding** (`func f(int)`, and the `void` of `func f(void)` does not
   * exist in Go but the same shape does through embedded types), so an absent `name:` field is the one real absence
   * here.
   */
  private emitParameterDefs(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    for (const list of namedChildrenOf(node).filter((c) => c.type === 'parameter_list')) {
      for (const parameter of namedChildrenOf(list)) {
        const name = parameter.childForFieldName('name');
        if (!name) continue;
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
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_declaration' || nodeType === 'method_declaration') {
      this.emitParameterDefs(node, captures);
    }

    // **Go's statements, which it recorded none of.** `variable.def` and `function.def` alone give the pipeline a
    // definition and no use, so the propagator has nothing that carries taint from a source to a sink - the same
    // shape as Python's gap and found by the same table.
    if (nodeType === 'short_var_declaration') {
      // `short_var_declaration` is `expression_list ':=' expression_list` - **three children, always** - so `child(0)`
      // and `child(2)` need no guard; an `if` around them would describe a production that does not exist.
      this.captureDefs(node.child(0), captures);
      this.captureAccesses(node.child(2), captures);
      // **And Go has THREE ways to bind a name**, of which only `:=` had a branch.
      //
      // **A probe of the three forms showed what that cost**:
      //
      // ```
      // x := y     -> variable.def:x, variable.access:y      handled
      // x =  y     -> (nothing)                              no branch at all
      // var x = y  -> variable.def:x, and NOT y              the value was dropped
      // ```
      //
      // **`x = y` is the ordinary re-assignment and it produced no capture**, so **a taint that moved through an
      // assignment disappeared**; and **`var x = y` recorded the name but not the use**, so **the right-hand side was
      // invisible**. **Both are statements about the assignment, and both were missing.**
    } else if (nodeType === 'assignment_statement') {
      // `assignment_statement` is `expression_list '=' expression_list` (the operator is an unnamed token, so the
      // right list is `child(2)` for `=`, `+=` and the rest alike), and both lists exist by production.
      this.captureAccesses(node.child(0), captures);
      this.captureAccesses(node.child(2), captures);
    } else if (nodeType === 'var_declaration' || nodeType === 'const_declaration') {
      // **`var` and `const` declare the same two shapes**, and both were half-handled:
      //
      // ```
      // var x = y          -> var_declaration > var_spec
      // var ( a = 1; b )   -> var_declaration > var_spec_LIST > var_spec x N
      // ```
      //
      // **A branch for the single form once took the node away from the generic walk** - because **a branch consumes
      // the node and the walk below it does not run for that node** - so this collects the specs into a list and
      // treats both shapes alike. **`const` shares the branch because its two shapes are the same two shapes**: the
      // only difference is the tag, and **`const` had a branch of its own that was shadowed by an earlier
      // `var_declaration` arm**, which is why its spec list was unreachable.
      const tag =
        nodeType === 'const_declaration' ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;
      const specs = namedChildrenOf(node).flatMap((child) =>
        child.type === 'var_spec_list' || child.type === 'const_spec_list'
          ? namedChildrenOf(child)
          : [child],
      );
      for (const spec of specs) this.emitSpecCapture(spec, tag, captures);
    } else if (nodeType === 'call_expression') {
      // `call_expression` is `function arguments` - **the callee is `child(0)` and the argument list is `child(1)`,
      // and the list is present even when empty**: `g()` has one.
      const callee = node.child(0);
      const isMethod = callee.type === 'selector_expression';
      captures.push({
        tag: isMethod ? CAPTURE_TAGS.METHOD_CALL : CAPTURE_TAGS.FUNCTION_CALL,
        text: callee.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: callee.startIndex,
        endByte: callee.endIndex,
        name: isMethod ? callee.text.split('.').pop() : callee.text,
        properties: { filePath: this.filePath },
      });
      // **A method call reads its receiver**, so `s.Flush()` is a use of `s`: without this a value that reaches a
      // sink only through a receiver's method had no edge to travel along.
      if (isMethod) this.captureAccesses(callee.childForFieldName('operand')!, captures);
      this.captureAccesses(node.child(1), captures);
    } else if (nodeType === 'expression_statement') {
      const inner = node.child(0);
      if (inner && (inner.type === 'identifier' || inner.type === 'selector_expression')) {
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
    } else if (nodeType === 'function_declaration') {
      // function_declaration = `func identifier ...` — the name is a mandatory identifier.
      const nameNode = this.findChildType(node, 'identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: {
          exported: String(this.isExportedName(nameNode.text)),
          filePath: this.filePath,
        },
      });
    } else if (nodeType === 'type_declaration') {
      for (const child of childrenOf(node)) {
        if (child.type === 'type_spec') {
          // type_spec = `type_identifier type` — the name is a mandatory type_identifier.
          const nameNode = this.findChildType(child, 'type_identifier')!;
          const structType = this.findChildType(child, 'struct_type');
          const ifaceType = this.findChildType(child, 'interface_type');

          if (structType) {
            captures.push({
              tag: CAPTURE_TAGS.STRUCT_DEF,
              text: `struct ${nameNode.text}`,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: nameNode.startIndex,
              endByte: nameNode.endIndex,
              name: nameNode.text,
              properties: { filePath: this.filePath },
            });
          } else if (ifaceType) {
            captures.push({
              tag: CAPTURE_TAGS.INTERFACE_DEF,
              text: `interface ${nameNode.text}`,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: nameNode.startIndex,
              endByte: nameNode.endIndex,
              name: nameNode.text,
              properties: { filePath: this.filePath },
            });
          } else {
            captures.push({
              tag: CAPTURE_TAGS.TYPE_DEF,
              text: `type ${nameNode.text}`,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: nameNode.startIndex,
              endByte: nameNode.endIndex,
              name: nameNode.text,
              properties: { filePath: this.filePath },
            });
          }
        }
      }
    } else if (nodeType === 'method_declaration') {
      // method_declaration = `func receiver name ...` — the name is a mandatory
      // field_identifier and the receiver is the first parameter_list.
      const nameNode = this.findChildType(node, 'field_identifier')!;
      const receiverType = this.extractReceiverType(node);
      captures.push({
        tag: CAPTURE_TAGS.METHOD_DEF,
        text: nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        containerName: receiverType,
        properties: { receiverType, filePath: this.filePath },
      });
    } else if (nodeType === 'import_declaration') {
      // import_declaration has a single named child: import_spec (single import) or
      // import_spec_list (grouped import).
      const child = node.namedChild(0);
      if (child.type === 'import_spec') {
        this.emitImportCapture(node, child, captures);
      } else {
        for (let j = 0; j < child.namedChildCount; j++) {
          this.emitImportCapture(node, child.namedChild(j), captures);
        }
      }
    } else if (nodeType === 'package_clause') {
      // package_clause = `package identifier` — the name is a mandatory package_identifier.
      const nameNode = this.findChildType(node, 'package_identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `package ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { filePath: this.filePath },
      });
    }

    for (const child of childrenOf(node)) {
      this.walkAndCapture(child, captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_spec') {
      const { path, alias } = this.extractImportSpec(node);
      if (path) {
        const names = alias ? [alias] : [this.importLeaf(path)];
        imports.push({
          source: path,
          names,
          type: alias ? 'namespace' : 'named',
          lineNumber: node.startPosition.row + 1,
        });
      }
      return;
    }

    for (const child of childrenOf(node)) {
      this.walkForImports(child, imports);
    }
  }

  protected override checkExported(_node: TreeSitterSyntaxNode, symbolName: string): boolean {
    return this.isExportedName(symbolName);
  }

  public override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;
    const funcRegex = /func\s+(\w+)\s*\(/g;
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
    const methRegex = /func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(/g;
    while ((m = methRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.METHOD_DEF,
        text: m[3]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[3]!,
        containerName: m[2]!,
        properties: { receiver: m[1]!, receiverType: m[2]!, filePath },
      });
    }
    const structRegex = /type\s+(\w+)\s+struct/g;
    while ((m = structRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.STRUCT_DEF,
        text: `struct ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const ifaceRegex = /type\s+(\w+)\s+interface/g;
    while ((m = ifaceRegex.exec(source)) !== null) {
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
    const pkgRegex = /^package\s+(\w+)/m;
    m = pkgRegex.exec(source);
    if (m)
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `package ${m[1]!}`,
        startLine: 1,
        endLine: 1,
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
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
    const singleRegex = /import\s+"([^"]+)"/g;
    while ((m = singleRegex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [this.importLeaf(m[1]!)],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    const namedRegex = /import\s+(\w+)\s+"([^"]+)"/g;
    while ((m = namedRegex.exec(source)) !== null) {
      imports.push({
        source: m[2]!,
        names: [m[1]!],
        type: 'namespace',
        lineNumber: this.ln(source, m.index),
      });
    }
    const multiRegex = /import\s*\(([\s\S]*?)\)/g;
    while ((m = multiRegex.exec(source)) !== null) {
      const lineRegex = /(?:(\w+)\s+)?"([^"]+)"/g;
      let inner: RegExpExecArray | null;
      while ((inner = lineRegex.exec(m[1]!))) {
        imports.push({
          source: inner[2]!,
          names: [inner[1] ?? this.importLeaf(inner[2]!)],
          type: inner[1] ? 'namespace' : 'named',
          lineNumber: this.ln(source, m.index),
        });
      }
    }
    return imports;
  }

  public override fallbackIsExported(_source: string, symbolName: string): boolean {
    return this.isExportedName(symbolName);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Extract the receiver type name, stripping pointer/package/argument wrappers. */
  private extractReceiverType(methodNode: TreeSitterSyntaxNode): string {
    let receiverType = '';
    for (const child of childrenOf(methodNode)) {
      if (child.type === 'parameter_list') {
        for (let j = 0; j < child.childCount; j++) {
          const p = child.child(j);
          if (p.type === 'parameter_declaration') {
            // The receiver parameter's type is its last named child (the name, if
            // present, precedes the type).
            receiverType = this.extractTypeName(p.namedChild(p.namedChildCount - 1));
            break;
          }
        }
        break;
      }
    }
    return receiverType;
  }

  /**
   * Recursively unwrap transparent type wrappers — pointer_type (`*T`),
   * qualified_type (`pkg.T`), generic_type (`T[args]`) — to the base named type.
   */
  private extractTypeName(node: TreeSitterSyntaxNode): string {
    if (
      node.type === 'pointer_type' ||
      node.type === 'qualified_type' ||
      node.type === 'generic_type'
    ) {
      for (const child of namedChildrenOf(node)) {
        if (child.type === 'type_identifier') return child.text;
        if (
          child.type === 'pointer_type' ||
          child.type === 'qualified_type' ||
          child.type === 'generic_type'
        ) {
          return this.extractTypeName(child);
        }
      }
    }
    return node.text;
  }

  /** Extract the path and optional alias from an import_spec node. */
  private extractImportSpec(spec: TreeSitterSyntaxNode): {
    path: string;
    alias: string | undefined;
  } {
    let path = '';
    let alias: string | undefined;
    for (const child of childrenOf(spec)) {
      if (child.type === 'interpreted_string_literal' || child.type === 'raw_string_literal') {
        path = child.text.slice(1, -1);
      } else if (child.type === 'package_identifier') {
        alias = child.text;
      }
    }
    return { path, alias };
  }

  /** Emit an IMPORT capture for a single import_spec. */
  private emitImportCapture(
    node: TreeSitterSyntaxNode,
    spec: TreeSitterSyntaxNode,
    captures: UnifiedCapture[],
  ): void {
    const { path, alias } = this.extractImportSpec(spec);
    // An import path is always present in valid Go; guard against empty paths.
    if (path) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: path,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: path,
        properties: { alias: alias ?? '', filePath: this.filePath },
      });
    }
  }

  /**
   * Emit a VARIABLE_DEF or CONSTANT_DEF capture for every name a `var_spec`/`const_spec` declares, plus a use for
   * every name on its right-hand side.
   *
   * **A spec can declare more than one name**, and **the grammar repeats the `name:` field rather than wrapping the
   * list**: `var a, b int = 1, 2` is `var_spec name: (identifier) name: (identifier) type: … value: (expression_list
   * (int_literal) (int_literal))`. **A `.find` for the first identifier therefore recorded `a` and dropped `b`**, so
   * **a multi-name declaration lost every name but the first** - the same class of defect the Java provider records
   * in its own `int a, b;` test.
   */
  private emitSpecCapture(
    spec: TreeSitterSyntaxNode,
    tag: UnifiedCapture['tag'],
    captures: UnifiedCapture[],
  ): void {
    for (const name of namedChildrenOf(spec).filter((c) => c.type === 'identifier')) {
      captures.push({
        tag,
        text: name.text,
        startLine: spec.startPosition.row + 1,
        endLine: spec.endPosition.row + 1,
        startByte: name.startIndex,
        endByte: name.endIndex,
        name: name.text,
        properties: { filePath: this.filePath },
      });
    }
    // A spec with no `value:` (`var x int`) declares without assigning, so the absent case is ordinary.
    const value = namedChildrenOf(spec).find((c) => c.type === 'expression_list');
    if (value) this.captureAccesses(value, captures);
  }

  /** The leaf (basename) of an import path, e.g. `os/exec` → `exec`. */
  private importLeaf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  /** Whether a Go identifier is exported (starts with a Unicode uppercase letter). */
  private isExportedName(symbolName: string): boolean {
    if (!symbolName) return false;
    const first = symbolName.charAt(0);
    return first === first.toUpperCase() && first !== first.toLowerCase();
  }

  private findChildType(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (const child of namedChildrenOf(node)) {
      if (child.type === type) return child;
    }
    return null;
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
  // Taint sources and sinks. The base class parses and recurses but recognises nothing, and only five providers
  // override it — none of them a language where a web application's untrusted input arrives.
  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    collectCLikeTaintSources(node, sources, GO_TAINT_NODES);
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    collectCLikeTaintSinks(node, sinks, GO_TAINT_NODES);
  }

  // Sanitizers. Nothing in this family recognised one before, so every finding was reported unsanitized.
  protected override walkForSanitizers(
    node: TreeSitterSyntaxNode,
    sanitizers: TaintSanitizer[],
  ): void {
    collectCLikeTaintSanitizers(node, sanitizers, GO_TAINT_NODES);
  }
}
