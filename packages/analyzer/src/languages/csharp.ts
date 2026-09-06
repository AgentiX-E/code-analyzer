// @code-analyzer/analyzer — C# Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture, CaptureTag } from '@code-analyzer/shared';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const CSHARP_EXTENSIONS = ['.cs'];
const CSHARP_GLOBS = ['**/*.cs'];

export class CSharpProvider extends TreeSitterBaseProvider {
  readonly language = 'csharp';
  readonly displayName = 'C#';
  readonly extensions = CSHARP_EXTENSIONS;
  readonly globs = CSHARP_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-c-sharp') as TreeSitterLanguage;
    } catch {
      /* v8 ignore next -- @preserve -- grammar is bundled, require never throws */
      return null;
    }
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
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

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
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

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
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

    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Fallbacks — regex extraction used when the grammar is unavailable
  // -----------------------------------------------------------------------

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
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

  protected override fallbackExtractImports(source: string): ParsedImport[] {
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

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
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
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
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
}
