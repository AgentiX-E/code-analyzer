// @code-analyzer/analyzer — Groovy Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: classes, methods, closures, traits, GStrings, imports.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

export class GroovyProvider extends TreeSitterBaseProvider {
  readonly language = 'groovy';
  readonly displayName = 'Groovy';
  readonly extensions = ['.groovy', '.gvy', '.gy', '.gsh'];
  readonly globs = ['**/*.groovy', '**/*.gvy', '**/*.gy', '**/*.gsh'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { const m = require('tree-sitter-groovy') as TreeSitterLanguage; return m; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'class_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'identifier' },
      { nodeType: 'method_declaration', captureTag: CAPTURE_TAGS.METHOD_DEF, nameChildType: 'identifier' },
      { nodeType: 'trait_declaration', captureTag: CAPTURE_TAGS.TRAIT_DEF, nameChildType: 'identifier' },
      { nodeType: 'enum_declaration', captureTag: CAPTURE_TAGS.ENUM_DEF, nameChildType: 'identifier' },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    // Class declaration
    if (nt === 'class_declaration') {
      const nameNode = this.findIdent(node);
      if (nameNode) {
        const baseClasses = this.extractGroovyBases(node);
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: `class ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { baseClasses, filePath: this.filePath },
        });
      }
    }

    // Trait declaration
    if (nt === 'trait_declaration') {
      const nameNode = this.findIdent(node);
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.TRAIT_DEF,
          text: `trait ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    }

    // Enum declaration
    if (nt === 'enum_declaration') {
      const nameNode = this.findIdent(node);
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

    // Method declaration
    if (nt === 'method_declaration') {
      // Skip constructors (method name same as class name)
      const nameNode = this.findIdent(node);
      if (nameNode) {
        const container = this.findContainerNode(node);
        const containerName = container ? this.extractContainerName(container) : undefined;
        const isConstructor = containerName === nameNode.text;
        captures.push({
          tag: isConstructor ? CAPTURE_TAGS.CONSTRUCTOR_DEF : CAPTURE_TAGS.METHOD_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          containerName,
          properties: { isConstructor: String(isConstructor), filePath: this.filePath },
        });
      }
    }

    // Field/variable declarations (Groovy: def name = value)
    if (nt === 'field_declaration' || nt === 'variable_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'variable_declarator') {
          const idNode = this.findFirstIdent(child);
          if (idNode) {
            captures.push({
              tag: CAPTURE_TAGS.VARIABLE_DEF,
              text: idNode.text,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: idNode.startIndex,
              endByte: idNode.endIndex,
              name: idNode.text,
              properties: { filePath: this.filePath },
            });
          }
        }
      }
    }

    // Import statement
    if (nt === 'import_declaration') {
      const importPath = node.text.replace(/^import\s+/, '').replace(/;?\s*$/, '').trim();
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: importPath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: importPath,
        properties: { importType: 'named', filePath: this.filePath },
      });
    }

    // Method call
    if (nt === 'method_invocation' || nt === 'call_expression') {
      const callName = this.extractCallName(node);
      if (callName) {
        captures.push({
          tag: CAPTURE_TAGS.METHOD_CALL,
          text: callName,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: callName,
          properties: { filePath: this.filePath },
        });
      }
    }

    // GString
    if (nt === 'gstring' || nt === 'string_interpolation') {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: node.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: `gstring_${node.startPosition.row + 1}`,
        properties: { isGString: 'true', filePath: this.filePath },
      });
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private findIdent(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'identifier' || child.type === 'type_identifier') return child;
    }
    return null;
  }

  private findFirstIdent(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode | null {
    if (node.type === 'identifier' || node.type === 'type_identifier') return node;
    for (let i = 0; i < node.namedChildCount; i++) {
      const result = this.findFirstIdent(node.namedChild(i));
      if (result) return result;
    }
    return null;
  }

  private extractGroovyBases(node: TreeSitterSyntaxNode): string {
    const parts: string[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'superclass' || child.type === 'super_interfaces') {
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);
          if (sub.type === 'identifier' || sub.type === 'type_identifier') {
            parts.push(sub.text);
          }
        }
      }
    }
    return parts.join(',');
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_declaration') {
      const text = node.text.replace(/^import\s+/, '').replace(/;?\s*$/, '').trim();
      const parts = text.split('.');
      imports.push({ source: text, names: [parts[parts.length - 1]!], type: 'named', lineNumber: node.startPosition.row + 1 });
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(_node: TreeSitterSyntaxNode, _symbolName: string): boolean {
    return true; // Groovy defs are visible by default
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const classRegex = /(?:abstract\s+)?class\s+(\w+)/g;
    while ((m = classRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `class ${m[1]}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const traitRegex = /trait\s+(\w+)/g;
    while ((m = traitRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.TRAIT_DEF, text: `trait ${m[1]}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const enumRegex = /enum\s+(\w+)/g;
    while ((m = enumRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.ENUM_DEF, text: `enum ${m[1]}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const funcRegex = /(?:def\s+|(?:void|int|String|boolean|def|Object)\s+)(\w+)\s*\(/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const importRegex = /import\s+(?:static\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = importRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'named', filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const importRegex = /import\s+(?:static\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = importRegex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!.split('.').pop()!], type: 'named', lineNumber: ln(m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, _symbolName: string): boolean {
    return true;
  }
}
