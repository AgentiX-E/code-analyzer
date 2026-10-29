// @code-analyzer/analyzer — C# Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { collectCLikeTaint } from './base-c-like.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { TaintCollections } from './taint-scan.js';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';
import type { UnifiedCapture, CaptureTag } from '@code-analyzer/shared';

const CSHARP_EXTENSIONS = ['.cs'];
const CSHARP_GLOBS = ['**/*.cs'];

/** csharp's names for the three node kinds the collectors need. */
const CSHARP_TAINT_NODES = {
  member: ['member_access_expression'],
  call: ['invocation_expression', 'object_creation_expression'],
  argumentContainer: ['argument_list'],
};

export class CSharpProvider extends TreeSitterBaseProvider {
  readonly language = 'csharp';
  readonly displayName = 'C#';
  readonly extensions = CSHARP_EXTENSIONS;
  readonly globs = CSHARP_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-c-sharp is a direct dependency of the analyzer, so this
    // require never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('tree-sitter-c-sharp') as TreeSitterLanguage;
  }

  /** Every identifier under `node`, in document order, without descending again where the walk will arrive. */
  private namesUnder(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode[] {
    const out: TreeSitterSyntaxNode[] = [];
    const visit = (current: TreeSitterSyntaxNode): void => {
      if (['identifier', 'member_access_expression'].includes(current.type)) {
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

  /**
   * Record a def for each parameter of a function, which is what makes a parameter a binding.
   *
   * `attachArgumentBindings` resolves a call's arguments against the function's bindings, so without this a parameter
   * passed to a callee is recorded as `-1` and the taint the interprocedural wave carries - "parameter 0 of this
   * function" - can never be matched to the sink that receives it.
   *
   * **The name is a `name:` field, and searching for the first identifier found the type instead**: a probe of
   * `void M(Widget w, List<int> xs)` gives `parameter type: (identifier) name: (identifier)` for the first and
   * `parameter type: (generic_name …) name: (identifier)` for the second - so **the search bound `Widget`, the type,
   * and skipped `xs` entirely** because a `generic_name` is not an identifier. **Both parameters were wrong, and both
   * looked like they had worked.** A C# parameter always carries a name, so the field is the whole story.
   */
  private emitParameterDefs(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const list = namedChildrenOf(node).find((c) => c.type === 'parameter_list')!;
    for (const parameter of namedChildrenOf(list)) {
      const name = parameter.childForFieldName('name')!;
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

    if (
      nodeType === 'method_declaration' ||
      nodeType === 'constructor_declaration' ||
      nodeType === 'local_function_statement'
    ) {
      this.emitParameterDefs(node, captures);
    }

    // **C#'s statements, which it recorded none of.**
    // **A field declaration has the same shape as a local one** - `field_declaration > variable_declaration >
    // variable_declarator` versus `local_declaration_statement > variable_declaration > variable_declarator` - so
    // **they share a branch**, and **a class's fields were the half of the pair that nobody had reached.**
    //
    // **And that was a product gap, not a coverage one**: **a probe of `class C { private int count; }` returned only
    // `class.def`**, so **every C# field was invisible to search and to impact analysis**, and **the honest coverage gate
    // named eleven branches in this file before the reason was visible.**
    if (nodeType === 'local_declaration_statement' || nodeType === 'field_declaration') {
      // **A declaration can name several variables** (`int a = 1, b;` is one `variable_declaration` with two
      // `variable_declarator` children), so every declarator is walked rather than the first one found.
      const declaration = namedChildrenOf(node).find((c) => c.type === 'variable_declaration')!;
      for (const declarator of namedChildrenOf(declaration).filter(
        (c) => c.type === 'variable_declarator',
      )) {
        const name = declarator.childForFieldName('name')!;
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
        // `int x;` declares without assigning, so the absent initialiser is ordinary.
        const value = namedChildrenOf(declarator)[1];
        if (value) this.captureAccesses(value, captures);
      }
    } else if (nodeType === 'assignment_expression') {
      // **C# makes assignment an EXPRESSION**, so it arrives under `expression_statement` and **had no branch at all** -
      // which is why **`x = y` produced a `method.def` and nothing else**: **the write was invisible.**
      const target = node.child(0);
      if (target.type === 'identifier') {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: target.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: target.startIndex,
          endByte: target.endIndex,
          name: target.text,
          properties: { filePath: this.filePath },
        });
      }
      this.captureAccesses(node.child(2), captures);
    } else if (nodeType === 'invocation_expression') {
      // `invocation_expression` is `callee(argument_list)` - both children always exist, and **the argument list is
      // present even when the call takes nothing**.
      const callee = node.child(0);
      const isMethod = callee.type === 'member_access_expression';
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
      this.captureAccesses(node.child(1), captures);
    }

    if (node.type === 'class_declaration') {
      this.emitTypeDeclaration(node, captures, CAPTURE_TAGS.CLASS_DEF, 'class');
    } else if (node.type === 'interface_declaration') {
      this.emitTypeDeclaration(node, captures, CAPTURE_TAGS.INTERFACE_DEF, 'interface');
    } else if (node.type === 'struct_declaration') {
      this.emitTypeDeclaration(node, captures, CAPTURE_TAGS.STRUCT_DEF, 'struct');
    } else if (node.type === 'enum_declaration') {
      this.emitTypeDeclaration(node, captures, CAPTURE_TAGS.ENUM_DEF, 'enum');
    } else if (node.type === 'method_declaration') {
      this.emitMethodLike(node, captures, CAPTURE_TAGS.METHOD_DEF);
    } else if (node.type === 'constructor_declaration') {
      this.emitMethodLike(node, captures, CAPTURE_TAGS.CONSTRUCTOR_DEF);
    } else if (node.type === 'property_declaration') {
      this.emitProperty(node, captures);
    } else if (node.type === 'using_directive') {
      this.emitImport(node, captures);
    } else if (node.type === 'attribute') {
      this.emitAttribute(node, captures);
    }

    for (const child of childrenOf(node)) {
      this.walkAndCapture(child, captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'using_directive') {
      const path = this.extractImportPath(node);
      imports.push({
        source: path,
        names: [path],
        type: 'named',
        lineNumber: node.startPosition.row + 1,
      });
      return;
    }

    for (const child of childrenOf(node)) {
      this.walkForImports(child, imports);
    }
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    if (this.isExportableDeclaration(node.type)) {
      // The `name` field is required on every exportable declaration type.
      const nameNode = node.childForFieldName('name')!;
      if (nameNode.text === symbolName && this.hasModifier(node, 'public')) {
        return true;
      }
    }

    for (const child of childrenOf(node)) {
      if (this.checkExported(child, symbolName)) return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Fallbacks — regex extraction used when the grammar is unavailable
  // -----------------------------------------------------------------------

  public override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    const classRegex =
      /(?:public\s+)?(?:static\s+)?(?:abstract\s+)?(?:sealed\s+)?(?:partial\s+)?class\s+(\w+)/g;
    while ((m = classRegex.exec(source)) !== null) {
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

    const interfaceRegex = /(?:public\s+)?interface\s+(\w+)/g;
    while ((m = interfaceRegex.exec(source)) !== null) {
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

    for (const u of this.fallbackExtractImports(source)) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: u.source,
        startLine: u.lineNumber,
        endLine: u.lineNumber,
        startByte: 0,
        endByte: 0,
        name: u.source,
        properties: { names: u.names.join(','), importType: u.type, filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  public override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    // Matches `using X;`, `using static X;`, and `using Alias = X;` (the alias
    // form targets the name after `=`). The optional alias group is absent for
    // plain/static directives, where the first capture is already the target.
    const regex = /using\s+(?:static\s+)?([\w.]+)(?:\s*=\s*([\w.]+))?\s*;/g;
    while ((m = regex.exec(source)) !== null) {
      const target = m[2] ?? m[1]!;
      imports.push({
        source: target,
        names: [target],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  public override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `public\\s+(?:class|interface|struct|enum)\\s+${s}\\b|public\\s+(?:static\\s+)?\\w+\\s+${s}\\s*[({]`,
    ).test(source);
  }

  // -----------------------------------------------------------------------
  // Capture emitters
  // -----------------------------------------------------------------------

  private emitTypeDeclaration(
    node: TreeSitterSyntaxNode,
    captures: UnifiedCapture[],
    tag: CaptureTag,
    prefix: string,
  ): void {
    const nameNode = this.extractNameNode(node);
    captures.push({
      tag,
      text: `${prefix} ${nameNode.text}`,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: nameNode.startIndex,
      endByte: nameNode.endIndex,
      name: nameNode.text,
      properties: { filePath: this.filePath },
    });
  }

  private emitMethodLike(
    node: TreeSitterSyntaxNode,
    captures: UnifiedCapture[],
    tag: CaptureTag,
  ): void {
    const nameNode = this.extractNameNode(node);
    // A method/constructor is always nested inside a type declaration whose
    // grammar marks `name` as a required field, so both lookups never fail.
    const container = this.findContainerNode(node)!;
    const containerName = container.childForFieldName('name')!.text;
    captures.push({
      tag,
      text: nameNode.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: nameNode.startIndex,
      endByte: nameNode.endIndex,
      name: nameNode.text,
      containerName,
      properties: { filePath: this.filePath },
    });
  }

  private emitProperty(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nameNode = this.extractNameNode(node);
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

  private emitImport(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const path = this.extractImportPath(node);
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
  }

  private emitAttribute(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nameNode = this.extractNameNode(node);
    captures.push({
      tag: CAPTURE_TAGS.DECORATOR,
      text: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: node.startIndex,
      endByte: node.endIndex,
      name: nameNode.text,
      properties: { decorator: nameNode.text, filePath: this.filePath },
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Return a declaration's `name` field. The C# grammar marks `name` as a
   * required field on class/interface/struct/enum/method/constructor/property
   * and attribute nodes, so the lookup never yields null for those node types.
   * This is deliberately field-based rather than a positional `identifier` scan:
   * for `public T GetValue()`, the return type `T` is also an `identifier`, and
   * a positional scan would mistake it for the method name.
   */
  private extractNameNode(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode {
    return node.childForFieldName('name')!;
  }

  /**
   * Return the import target of a `using_directive`. It is always the final
   * named child: an alias directive `using Alias = X` lists the alias identifier
   * first and the target `X` last, while a plain/static directive carries only
   * the target itself.
   */
  private extractImportPath(node: TreeSitterSyntaxNode): string {
    return node.namedChild(node.namedChildCount - 1).text;
  }

  private hasModifier(node: TreeSitterSyntaxNode, modifier: string): boolean {
    for (const child of namedChildrenOf(node)) {
      if (child.type === 'modifier' && child.text === modifier) return true;
    }
    return false;
  }

  private isExportableDeclaration(type: string): boolean {
    return (
      type === 'class_declaration' ||
      type === 'interface_declaration' ||
      type === 'struct_declaration' ||
      type === 'enum_declaration' ||
      type === 'method_declaration' ||
      type === 'constructor_declaration' ||
      type === 'property_declaration'
    );
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
  /**
   * Taint, in one pass over the tree.
   *
   * **The three questions name the same two node shapes**, so the file is traversed once instead of three
   * times - see `collectCLikeTaint`. The collector is the shared one; only the node names are this language's.
   */
  protected override collectTaint(root: TreeSitterSyntaxNode): TaintCollections {
    return collectCLikeTaint(root, CSHARP_TAINT_NODES);
  }
}
