// @code-analyzer/analyzer — Kotlin Tree-sitter Provider (with regex fallback)

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const KOTLIN_EXTENSIONS = ['.kt', '.kts'];
const KOTLIN_GLOBS = ['**/*.kt', '**/*.kts'];

export class KotlinProvider extends TreeSitterBaseProvider {
  readonly language = 'kotlin';
  readonly displayName = 'Kotlin';
  readonly extensions = KOTLIN_EXTENSIONS;
  readonly globs = KOTLIN_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-kotlin') as TreeSitterLanguage;
    } catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'class_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'identifier' },
      { nodeType: 'function_declaration', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'interface_declaration', captureTag: CAPTURE_TAGS.INTERFACE_DEF, nameChildType: 'identifier' },
      { nodeType: 'enum_class', captureTag: CAPTURE_TAGS.ENUM_DEF, nameChildType: 'identifier' },
    ];
  }

  // When tree-sitter grammar is available, use AST walking
  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    // Only used when grammar is loaded — fallback handles otherwise
    const nodeType = node.type;

    if (nodeType === 'class_declaration' || nodeType === 'object_declaration') {
      const nameNode = this.findChild(node, 'identifier');
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: `${nodeType === 'object_declaration' ? 'object' : 'class'} ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'function_declaration') {
      const nameNode = this.findChild(node, 'identifier');
      if (nameNode) {
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
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  // Fallbacks
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Classes
    const clRegex = /(?:data\s+|sealed\s+|abstract\s+|open\s+|inner\s+)*class\s+(\w+)/g;
    while ((m = clRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `class ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Interfaces
    const ifRegex = /interface\s+(\w+)/g;
    while ((m = ifRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.INTERFACE_DEF, text: `interface ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Objects
    const objRegex = /(?:companion\s+)?object\s+(\w+)/g;
    while ((m = objRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `object ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { isObject: 'true', filePath } });
    }

    // Enum classes
    const enumRegex = /enum\s+class\s+(\w+)/g;
    while ((m = enumRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.ENUM_DEF, text: `enum class ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Functions
    const funcRegex = /(?:(?:private|internal|protected|public|override|open|abstract|suspend|inline|operator|infix|tailrec|external)\s+)*fun\s+(?:<[^>]*>\s*)?(\w+)/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Properties (val/var)
    const propRegex = /(?:const\s+)?(?:lateinit\s+)?(?:private\s+|internal\s+|protected\s+)?(?:override\s+)?(?:open\s+)?(?:abstract\s+)?(val|var)\s+(\w+)/g;
    while ((m = propRegex.exec(source)) !== null) {
      const tag = m[1] === 'val' ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;
      captures.push({ tag, text: m[2]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[2]!, properties: { filePath } });
    }

    // Annotations
    const annRegex = /@(\w+)(?:\([\s\S]*?\))?/g;
    while ((m = annRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.DECORATOR, text: m[0], startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { decorator: m[1]!, filePath } });
    }

    // Imports
    const imps = this.fallbackExtractImports(source);
    for (const imp of imps) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: imp.source, startLine: imp.lineNumber, endLine: imp.lineNumber, startByte: 0, endByte: 0, name: imp.source, properties: { names: imp.names.join(','), importType: imp.type, filePath } });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const regex = /import\s+([\w.]+)(?:\.\*)?/g;
    while ((m = regex.exec(source)) !== null) {
      const parts = m[1]!.split('.');
      imports.push({ source: m[1]!, names: [parts[parts.length - 1]!], type: 'named', lineNumber: this.ln(source, m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:class|interface|object|fun|val|var)\\s+${s}\\b`).test(source);
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
