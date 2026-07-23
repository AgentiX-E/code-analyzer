// @code-analyzer/analyzer — Rust Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const RUST_EXTENSIONS = ['.rs'];
const RUST_GLOBS = ['**/*.rs'];

export class RustProvider extends TreeSitterBaseProvider {
  readonly language = 'rust';
  readonly displayName = 'Rust';
  readonly extensions = RUST_EXTENSIONS;
  readonly globs = RUST_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-rust') as TreeSitterLanguage;
    } catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_item', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'struct_item', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'type_identifier' },
      { nodeType: 'trait_item', captureTag: CAPTURE_TAGS.INTERFACE_DEF, nameChildType: 'type_identifier' },
      { nodeType: 'enum_item', captureTag: CAPTURE_TAGS.ENUM_DEF, nameChildType: 'type_identifier' },
      { nodeType: 'use_declaration', captureTag: CAPTURE_TAGS.IMPORT, useFirstNamedChild: true },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_item') {
      const nameNode = this.findChild(node, 'identifier');
      if (nameNode) {
        const isPublic = this.source.slice(Math.max(0, node.startIndex - 5), node.startIndex).includes('pub');
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { isPublic: String(isPublic), filePath: this.filePath },
        });
      }
    } else if (nodeType === 'struct_item') {
      const nameNode = this.findChild(node, 'type_identifier');
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: `struct ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'trait_item') {
      const nameNode = this.findChild(node, 'type_identifier');
      if (nameNode) {
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
      }
    } else if (nodeType === 'enum_item') {
      const nameNode = this.findChild(node, 'type_identifier');
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
    } else if (nodeType === 'impl_item') {
      // impl block - extract type name
      const typeNode = this.findChild(node, 'type_identifier');
      if (typeNode) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: `impl ${typeNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: typeNode.startIndex,
          endByte: typeNode.endIndex,
          name: typeNode.text,
          properties: { isImpl: 'true', filePath: this.filePath },
        });
      }
    } else if (nodeType === 'const_item' || nodeType === 'static_item') {
      const nameNode = this.findChild(node, 'identifier');
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.CONSTANT_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'use_declaration') {
      const scopedId = this.findChild(node, 'scoped_identifier');
      if (scopedId) {
        captures.push({
          tag: CAPTURE_TAGS.IMPORT,
          text: scopedId.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: scopedId.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'attribute_item') {
      // #[derive(Debug)]
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
    if (node.type === 'use_declaration') {
      const line = node.startPosition.row + 1;
      const scopedId = this.findChild(node, 'scoped_identifier');
      if (scopedId) {
        const path = scopedId.text;
        const isWildcard = path.endsWith('*');
        const cleanPath = isWildcard ? path.slice(0, -2) : path;
        const parts = cleanPath.split('::');
        imports.push({
          source: cleanPath,
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
    if (node.type === 'function_item' || node.type === 'struct_item' ||
        node.type === 'trait_item' || node.type === 'enum_item' ||
        node.type === 'impl_item' || node.type === 'const_item' || node.type === 'static_item') {
      const before = this.source.slice(Math.max(0, node.startIndex - 10), node.startIndex);
      const nodeText = this.source.slice(node.startIndex, Math.min(node.startIndex + 20, this.source.length));
      if (before.includes('pub') || nodeText.includes('pub ')) {
        const nameNode = this.findChild(node, 'identifier') || this.findChild(node, 'type_identifier');
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
    const fnRegex = /(?:pub(?:\s*\(\s*crate\s*\))?\s+)?fn\s+(\w+)/g;
    while ((m = fnRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const stRegex = /(?:pub\s+)?struct\s+(\w+)/g;
    while ((m = stRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `struct ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const trRegex = /(?:pub\s+)?trait\s+(\w+)/g;
    while ((m = trRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.INTERFACE_DEF, text: `trait ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const uses = this.fallbackExtractImports(source);
    for (const u of uses) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: u.source, startLine: u.lineNumber, endLine: u.lineNumber, startByte: 0, endByte: 0, name: u.source, properties: { names: u.names.join(','), importType: u.type, filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const regex = /use\s+([\w:]+(?:::[\w*]+)*)\s*;/g;
    while ((m = regex.exec(source)) !== null) {
      const parts = m[1]!.split('::');
      const last = parts[parts.length - 1]!;
      imports.push({ source: m[1]!, names: last === '*' ? [] : [last], type: last === '*' ? 'wildcard' : 'named', lineNumber: this.ln(source, m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`pub\\s+(?:fn|struct|enum|trait|mod|type|const|static|union)\\s+${s}\\b`).test(source);
  }

  private findChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
