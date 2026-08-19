// @code-analyzer/analyzer — Java Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  NodeTypeMapping,
  TreeSitterLanguage,
  TreeSitterSyntaxNode,
} from './tree-sitter-base.js';

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

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      {
        nodeType: 'class_declaration',
        captureTag: CAPTURE_TAGS.CLASS_DEF,
        nameChildType: 'identifier',
      },
      {
        nodeType: 'interface_declaration',
        captureTag: CAPTURE_TAGS.INTERFACE_DEF,
        nameChildType: 'identifier',
      },
      {
        nodeType: 'enum_declaration',
        captureTag: CAPTURE_TAGS.ENUM_DEF,
        nameChildType: 'identifier',
      },
      {
        nodeType: 'method_declaration',
        captureTag: CAPTURE_TAGS.METHOD_DEF,
        nameChildType: 'identifier',
      },
      {
        nodeType: 'constructor_declaration',
        captureTag: CAPTURE_TAGS.CONSTRUCTOR_DEF,
        nameChildType: 'identifier',
      },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'class_declaration') {
      const nameNode = this.findChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- a declaration node always carries an identifier child */
      if (nameNode) {
        let baseClasses = '';
        let interfaces = '';
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'superclass') {
            const id = this.findDeep(child, 'type_identifier');
            /* v8 ignore next -- @preserve -- a superclass always carries a type_identifier */
            if (id) baseClasses = id.text;
          } else if (child.type === 'super_interfaces') {
            const ids: string[] = [];
            this._collectTypeIdentifiers(child, ids);
            interfaces = ids.join(',');
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
      }
    } else if (nodeType === 'interface_declaration') {
      const nameNode = this.findChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- a declaration node always carries an identifier child */
      if (nameNode) {
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
      }
    } else if (nodeType === 'enum_declaration') {
      const nameNode = this.findChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- a declaration node always carries an identifier child */
      if (nameNode) {
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
      }
    } else if (nodeType === 'method_declaration') {
      const nameNode = this.findChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- a declaration node always carries an identifier child */
      if (nameNode) {
        const container = this.findContainerNode(node);
        let containerName: string | undefined;
        /* v8 ignore next -- @preserve -- a method is always nested inside a class/interface */
        if (container) {
          const cn = this.findChild(container, 'identifier');
          /* v8 ignore next -- @preserve -- the container always carries an identifier */
          if (cn) containerName = cn.text;
        }
        /* v8 ignore next -- @preserve -- constructors are constructor_declaration, never method_declaration */
        const tag =
          nameNode.text === containerName ? CAPTURE_TAGS.CONSTRUCTOR_DEF : CAPTURE_TAGS.METHOD_DEF;
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
    } else if (nodeType === 'constructor_declaration') {
      const nameNode = this.findChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- a declaration node always carries an identifier child */
      if (nameNode) {
        const container = this.findContainerNode(node);
        let containerName: string | undefined;
        /* v8 ignore next -- @preserve -- a constructor is always nested inside a class */
        if (container) {
          const cn = this.findChild(container, 'identifier');
          /* v8 ignore next -- @preserve -- the container always carries an identifier */
          if (cn) containerName = cn.text;
        }
        captures.push({
          tag: CAPTURE_TAGS.CONSTRUCTOR_DEF,
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
    } else if (nodeType === 'field_declaration') {
      const declarator = this.findChild(node, 'variable_declarator');
      /* v8 ignore next -- @preserve -- a field_declaration always carries a variable_declarator */
      if (declarator) {
        const nameNode = this.findChild(declarator, 'identifier');
        /* v8 ignore next -- @preserve -- a variable_declarator always carries an identifier */
        if (nameNode) {
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
      /* v8 ignore next -- @preserve -- an import_declaration always carries an identifier or scoped_identifier */
      if (parts.length > 0) {
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
      }
    } else if (nodeType === 'annotation') {
      const nameNode = this.findChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- an annotation always carries an identifier child */
      if (nameNode) {
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

      const path = parts.join('.');
      /* v8 ignore next -- @preserve -- an import_declaration always carries an identifier or scoped_identifier */
      if (path) {
        imports.push({
          source: path,
          names: isWildcard ? [] : [parts[parts.length - 1]!],
          type: isWildcard ? 'wildcard' : 'named',
          lineNumber: line,
        });
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    // Check for 'public' modifier on declarations
    if (
      node.type === 'class_declaration' ||
      node.type === 'interface_declaration' ||
      node.type === 'enum_declaration' ||
      node.type === 'method_declaration' ||
      node.type === 'field_declaration' ||
      node.type === 'constructor_declaration'
    ) {
      const prefix = this.source.slice(Math.max(0, node.startIndex - 10), node.startIndex).trim();
      const nodeText = this.source.slice(node.startIndex, node.startIndex + 50);
      const isPublic = prefix.includes('public') || nodeText.trimStart().startsWith('public');
      if (isPublic) {
        const nameNode = this.findChild(node, 'identifier');
        if (nameNode && nameNode.text === symbolName) return true;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }
    return false;
  }

  // Fallbacks
  /* v8 ignore next */
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

  /* v8 ignore next */
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

  /* v8 ignore next */
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

  private findDeep(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    if (node.type === type) return node;
    for (let i = 0; i < node.namedChildCount; i++) {
      const r = this.findDeep(node.namedChild(i), type);
      if (r) return r;
    }
    return null;
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

  private _collectTypeIdentifiers(node: TreeSitterSyntaxNode, result: string[]): void {
    if (node.type === 'type_identifier' || node.type === 'identifier') {
      result.push(node.text);
      return;
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      this._collectTypeIdentifiers(node.namedChild(i), result);
    }
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
