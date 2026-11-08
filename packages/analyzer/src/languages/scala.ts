// @code-analyzer/analyzer — Scala Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { lineOf } from './line-index.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

const SCALA_EXTENSIONS = ['.scala', '.sc'];
const SCALA_GLOBS = ['**/*.scala', '**/*.sc'];

export class ScalaProvider extends TreeSitterBaseProvider {
  readonly language = 'scala';
  readonly displayName = 'Scala';
  readonly extensions = SCALA_EXTENSIONS;
  readonly globs = SCALA_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-scala is a direct dependency of the analyzer, so this
    // require never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('tree-sitter-scala') as TreeSitterLanguage;
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'class_definition') {
      const nameNode = this.extractNameNode(node);
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'object_definition') {
      const nameNode = this.extractNameNode(node);
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `object ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { isObject: 'true', filePath: this.filePath },
      });
    } else if (nodeType === 'trait_definition') {
      const nameNode = this.extractNameNode(node);
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `trait ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'function_definition' || nodeType === 'function_declaration') {
      const nameNode = this.extractNameNode(node);
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'import_declaration') {
      const path = this.collectImportPath(node);
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
    } else if (nodeType === 'call_expression') {
      // **The third walk with no arm for a call.** `helper(name)` and `this.draw()` are both `call_expression`, and
      // this walk knew classes, objects, traits, functions and imports — every declaration, and no use.
      this.emitCallCapture(node, captures);
    }

    for (const child of childrenOf(node)) {
      this.walkAndCapture(child, captures);
    }
  }

  /**
   * The name a Scala call names: the **last** segment of the callee.
   *
   * `this.draw()` calls `draw` and `scala.collection.mutable.Map` calls `Map`; a name that keeps its path resolves to
   * nothing, which is the split Kotlin, Java and Rust all needed.
   */
  protected override extractCallName(node: TreeSitterSyntaxNode): string | undefined {
    // A `call_expression` always writes its callee as the first named child.
    const text = namedChildrenOf(node)[0]!.text;
    const dot = text.lastIndexOf('.');
    return dot < 0 ? text : text.slice(dot + 1);
  }

  /** **A method call is the one whose callee is a field access**, which is how Scala spells `this.draw`. */
  protected override isMethodCall(node: TreeSitterSyntaxNode): boolean {
    return namedChildrenOf(node)[0]?.type === 'field_expression';
  }
  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_declaration') {
      const path = this.collectImportPath(node);
      imports.push({
        source: path,
        names: [path.split('.').pop()!],
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
    if (
      node.type === 'class_definition' ||
      node.type === 'trait_definition' ||
      node.type === 'object_definition' ||
      node.type === 'function_definition' ||
      node.type === 'function_declaration'
    ) {
      const nameNode = this.extractNameNode(node);
      if (nameNode.text === symbolName) {
        return !this.hasAccessModifier(node);
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

    // Class definitions
    const classRegex = /(?:abstract\s+)?(?:case\s+)?class\s+(\w+)/g;
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

    // Object definitions
    const objectRegex = /object\s+(\w+)/g;
    while ((m = objectRegex.exec(source)) !== null) {
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

    // Trait definitions
    const traitRegex = /trait\s+(\w+)/g;
    while ((m = traitRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `trait ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Function definitions (def keyword). The name may be a plain identifier
    // or an operator (`def +`, `def ==`), captured by the alternation.
    const funcRegex = /def\s+(\w+|[^\w\s(]+)/g;
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

    // Import statements
    const importRegex = /import\s+([\w.]+(?:\.[\w{}]+)*)/g;
    while ((m = importRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
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
    let m: RegExpExecArray | null;
    const importRegex = /import\s+([\w.]+(?:\.[\w{}]+)*)/g;
    while ((m = importRegex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!.split('.').pop()!.replace(/[{}]/g, '')],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  public override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`private\\s+(?:class|object|trait|def|val|var)\\s+${s}\\b`).test(source))
      return false;
    if (new RegExp(`protected\\s+(?:class|object|trait|def|val|var)\\s+${s}\\b`).test(source))
      return false;
    return new RegExp(`\\b(?:class|object|trait|def)\\s+${s}\\b`).test(source);
  }

  // Helpers
  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (const child of namedChildrenOf(node)) {
      if (child.type === type) return child;
    }
    return null;
  }

  /**
   * Return the name node of a definition. The grammar always emits a required
   * `name` field of type `identifier` or `operator_identifier`. Operator names
   * are checked first: for `def +(x) = x`, a naive `identifier` lookup would
   * return the body expression `x` instead of the operator name `+`.
   */
  private extractNameNode(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode {
    return (this.findNamedChild(node, 'operator_identifier') ??
      this.findNamedChild(node, 'identifier'))!;
  }

  /**
   * True when the definition carries an access modifier. Scala's only access
   * modifiers are `private` and `protected` (public is the default), so the
   * presence of an `access_modifier` node is equivalent to "not exported".
   */
  private hasAccessModifier(node: TreeSitterSyntaxNode): boolean {
    const modifiers = this.findNamedChild(node, 'modifiers');
    if (!modifiers) return false;
    return this.findNamedChild(modifiers, 'access_modifier') !== null;
  }

  private collectImportPath(node: TreeSitterSyntaxNode): string {
    const parts: string[] = [];
    for (const child of namedChildrenOf(node)) {
      // The path field is a flat run of identifiers and operator identifiers
      // joined by anonymous `.` tokens; namespace selectors are separate.
      if (child.type === 'identifier' || child.type === 'operator_identifier') {
        parts.push(child.text);
      }
    }
    return parts.join('.');
  }

  private ln(source: string, offset: number): number {
    return lineOf(source, offset);
  }
}
