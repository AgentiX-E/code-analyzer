// @code-analyzer/analyzer — Zig Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const ZIG_EXTENSIONS = ['.zig'];
const ZIG_GLOBS = ['**/*.zig'];

export class ZigProvider extends TreeSitterBaseProvider {
  readonly language = 'zig';
  readonly displayName = 'Zig';
  readonly extensions = ZIG_EXTENSIONS;
  readonly globs = ZIG_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-zig') as TreeSitterLanguage;
    } /* v8 ignore next */
    catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_declaration', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'struct_declaration', captureTag: CAPTURE_TAGS.STRUCT_DEF, nameChildType: 'identifier' },
      { nodeType: 'enum_declaration', captureTag: CAPTURE_TAGS.ENUM_DEF, nameChildType: 'identifier' },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_declaration') {
      const nameNode = this.findNamedChild(node, 'identifier');
      if (nameNode) {
        const isPub = this.source.slice(Math.max(0, node.startIndex - 10), node.startIndex).includes('pub');
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { isPublic: String(isPub), filePath: this.filePath },
        });
      }
    } else if (nodeType === 'struct_declaration') {
      const nameNode = this.findNamedChild(node, 'identifier');
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.STRUCT_DEF,
          text: `struct ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'enum_declaration') {
      const nameNode = this.findNamedChild(node, 'identifier');
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
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    if (node.type === 'function_declaration' || node.type === 'struct_declaration' ||
        node.type === 'enum_declaration' || node.type === 'const_declaration' || node.type === 'variable_declaration') {
      const nameNode = this.findNamedChild(node, 'identifier');
      if (nameNode && nameNode.text === symbolName) {
        const before = this.source.slice(Math.max(0, node.startIndex - 10), node.startIndex);
        return before.includes('pub');
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

    // Function declarations: pub fn name(...) or fn name(...)
    const funcRegex = /(?:pub\s+)?fn\s+(\w+)/g;
    while ((m = funcRegex.exec(source)) !== null) {
      const isPub = m[0]!.startsWith('pub');
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isPublic: String(isPub), filePath },
      });
    }

    // Struct declarations
    const structRegex = /(?:pub\s+)?const\s+(\w+)\s*=\s*struct\b/g;
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

    // Enum declarations
    const enumRegex = /(?:pub\s+)?const\s+(\w+)\s*=\s*enum\b/g;
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

    // @import statements
    const importRegex = /@import\s*\(\s*"([^"]+)"\s*\)/g;
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

    // const declarations (variables)
    const constRegex = /const\s+(\w+)\s*=/g;
    while ((m = constRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // var declarations
    const varRegex = /var\s+(\w+)\s*(?::[^=]+)?\s*=/g;
    while ((m = varRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isMutable: 'true', filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  /* v8 ignore next */
  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const importRegex = /@import\s*\(\s*"([^"]+)"\s*\)/g;
    while ((m = importRegex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  /* v8 ignore next */
  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`pub\\s+(?:fn|const|var)\\s+${s}\\b`).test(source);
  }

  // Helpers
  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
