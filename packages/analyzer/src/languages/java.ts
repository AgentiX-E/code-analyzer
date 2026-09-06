// @code-analyzer/analyzer — Java Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const JAVA_EXTENSIONS = ['.java'];
const JAVA_GLOBS = ['**/*.java'];

export class JavaProvider extends TreeSitterBaseProvider {
  readonly language = 'java';
  readonly displayName = 'Java';
  readonly extensions = JAVA_EXTENSIONS;
  readonly globs = JAVA_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-java') as TreeSitterLanguage;
    } catch {
      /* v8 ignore next -- @preserve -- native grammar module load failure is untestable */
      return null;
    }
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'class_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      let baseClasses = '';
      let interfaces = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
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
      for (let i = 0; i < node.namedChildCount; i++) {
        const declarator = node.namedChild(i);
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
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
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

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_declaration') {
      const line = node.startPosition.row + 1;
      let isWildcard = false;
      const parts: string[] = [];

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.text === '*') isWildcard = true;
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
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

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
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
        for (let i = 0; i < node.namedChildCount; i++) {
          const declarator = node.namedChild(i);
          if (declarator.type !== 'variable_declarator') continue;
          if (this.variableNameNode(declarator).text === symbolName) return true;
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }
    return false;
  }

  // Fallbacks
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
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

  protected override fallbackExtractImports(source: string): ParsedImport[] {
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

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `public\\s+(?:class|interface|enum)\\s+${s}\\b|public\\s+(?:static\\s+)?\\w+\\s+${s}\\b|public\\s+\\w+\\s+${s}\\s*\\(`,
    ).test(source);
  }

  // Helpers
  private findChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
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
    for (let i = 0; i < typeList.namedChildCount; i++) {
      names.push(this.typeBaseName(typeList.namedChild(i)));
    }
    return names.join(',');
  }

  /** Whether a declaration carries a `public` visibility modifier. */
  private hasPublicModifier(node: TreeSitterSyntaxNode): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
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
    for (let i = 0; i < node.namedChildCount; i++) {
      this._collectIdentifiers(node.namedChild(i), result);
    }
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
