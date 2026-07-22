// @code-analyzer/analyzer — C# Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

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
      const cs = require('tree-sitter-c-sharp') as { csharp: TreeSitterLanguage };
      return cs.csharp || (cs as unknown as TreeSitterLanguage);
    } catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'class_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'identifier' },
      { nodeType: 'interface_declaration', captureTag: CAPTURE_TAGS.INTERFACE_DEF, nameChildType: 'identifier' },
      { nodeType: 'struct_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'identifier' },
      { nodeType: 'enum_declaration', captureTag: CAPTURE_TAGS.ENUM_DEF, nameChildType: 'identifier' },
      { nodeType: 'method_declaration', captureTag: CAPTURE_TAGS.METHOD_DEF, nameChildType: 'identifier' },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'class_declaration') {
      const nameNode = this.findChild(node, 'identifier');
      if (nameNode) {
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
      }
    } else if (nodeType === 'interface_declaration') {
      const nameNode = this.findChild(node, 'identifier');
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
    } else if (nodeType === 'struct_declaration') {
      const nameNode = this.findChild(node, 'identifier');
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: `struct ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { isStruct: 'true', filePath: this.filePath },
        });
      }
    } else if (nodeType === 'enum_declaration') {
      const nameNode = this.findChild(node, 'identifier');
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
      if (nameNode) {
        const container = this.findContainerNode(node);
        let containerName: string | undefined;
        if (container) {
          const cn = this.findChild(container, 'identifier');
          if (cn) containerName = cn.text;
        }
        const tag = nameNode.text === containerName ? CAPTURE_TAGS.CONSTRUCTOR_DEF : CAPTURE_TAGS.METHOD_DEF;
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
    } else if (nodeType === 'property_declaration') {
      const nameNode = this.findChild(node, 'identifier');
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
    } else if (nodeType === 'using_directive') {
      const nameNode = this.findChild(node, 'identifier') || this.findChild(node, 'qualified_name');
      let sourcePath = nameNode ? nameNode.text : '';
      // For qualified names, collect all identifiers
      if (node.type === 'qualified_name') {
        sourcePath = node.text;
      }
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
    } else if (nodeType === 'attribute') {
      const nameNode = this.findChild(node, 'identifier');
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
    if (node.type === 'using_directive') {
      const line = node.startPosition.row + 1;
      let path = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'identifier') path = child.text;
      }
      // For qualified names
      const qn = this.findDeep(node, 'qualified_name');
      if (qn) path = qn.text;
      if (path) {
        imports.push({ source: path, names: [path], type: 'named', lineNumber: line });
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    if (node.type === 'class_declaration' || node.type === 'interface_declaration' ||
        node.type === 'struct_declaration' || node.type === 'enum_declaration' ||
        node.type === 'method_declaration' || node.type === 'property_declaration') {
      const modifierList = this.findChild(node, 'modifier');
      const isPublic = !modifierList || modifierList.text.includes('public');
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
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;
    const clRegex = /(?:public\s+)?(?:static\s+)?(?:abstract\s+)?(?:sealed\s+)?(?:partial\s+)?class\s+(\w+)/g;
    while ((m = clRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `class ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const ifRegex = /(?:public\s+)?interface\s+(\w+)/g;
    while ((m = ifRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.INTERFACE_DEF, text: `interface ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const usings = this.fallbackExtractImports(source);
    for (const u of usings) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: u.source, startLine: u.lineNumber, endLine: u.lineNumber, startByte: 0, endByte: 0, name: u.source, properties: { names: u.names.join(','), importType: u.type, filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const regex = /using\s+(?:static\s+)?([\w.]+)\s*;/g;
    while ((m = regex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!], type: 'named', lineNumber: this.ln(source, m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`public\\s+(?:class|interface|struct|enum)\\s+${s}\\b|public\\s+(?:static\\s+)?\\w+\\s+${s}\\s*[({]`).test(source);
  }

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

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
