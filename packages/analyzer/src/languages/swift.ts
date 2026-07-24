// @code-analyzer/analyzer — Swift Tree-sitter Provider (with regex fallback)

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const SWIFT_EXTENSIONS = ['.swift'];
const SWIFT_GLOBS = ['**/*.swift'];

export class SwiftProvider extends TreeSitterBaseProvider {
  readonly language = 'swift';
  readonly displayName = 'Swift';
  readonly extensions = SWIFT_EXTENSIONS;
  readonly globs = SWIFT_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-swift') as TreeSitterLanguage;
    } catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_declaration', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'class_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'type_identifier' },
      { nodeType: 'struct_declaration', captureTag: CAPTURE_TAGS.STRUCT_DEF, nameChildType: 'type_identifier' },
      { nodeType: 'protocol_declaration', captureTag: CAPTURE_TAGS.INTERFACE_DEF, nameChildType: 'type_identifier' },
      { nodeType: 'enum_declaration', captureTag: CAPTURE_TAGS.ENUM_DEF, nameChildType: 'type_identifier' },
      { nodeType: 'extension_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'type_identifier' },
    ];
  }

  // ---- Import extraction (tree-sitter AST) ----

  /**
   * Walk the AST to find and extract Swift import statements.
   * Swift imports are parsed as `import_declaration` nodes in the tree-sitter AST.
   *
   * Syntax handled:
   *   import Foundation                     // simple module
   *   import UIKit.UIViewController          // submodule
   *   import class UIKit.UIView              // scoped class import
   *   import func Darwin.sqrt                // scoped function import
   */
  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_declaration') {
      this.extractSwiftImport(node, imports);
      return; // Don't recurse into import children
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  /**
   * Extract import details from a Swift `import_declaration` AST node.
   * Collects identifier parts to build the module path and extracts
   * the final segment as the import name.
   */
  private extractSwiftImport(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    const lineNumber = node.startPosition.row + 1;

    // Collect all identifier parts (e.g. UIKit, UIViewController for import UIKit.UIViewController)
    const parts: string[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (
        child.type === 'type_identifier' ||
        child.type === 'identifier' ||
        child.type === 'simple_identifier'
      ) {
        parts.push(child.text);
      }
    }

    if (parts.length === 0) return;

    const sourcePath = parts.join('.');
    const lastName = parts[parts.length - 1]!;
    imports.push({ source: sourcePath, names: [lastName], type: 'named', lineNumber });
  }

  // Fallbacks
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Functions: func name(params) -> ReturnType { }
    const funcRegex = /func\s+(\w+)\s*\(/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Classes: class Name: SuperClass { }
    const clRegex = /class\s+(\w+)\s*(?::\s*(\w+))?/g;
    while ((m = clRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `class ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { baseClasses: m[2] ?? '', filePath } });
    }

    // Structs: struct Name: Protocol { }
    const stRegex = /struct\s+(\w+)\s*(?::\s*(\w+))?/g;
    while ((m = stRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.STRUCT_DEF, text: `struct ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { baseClasses: m[2] ?? '', filePath } });
    }

    // Protocols (interfaces): protocol Name { }
    const protRegex = /protocol\s+(\w+)/g;
    while ((m = protRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.INTERFACE_DEF, text: `protocol ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Enums: enum Name: Type { }
    const enumRegex = /enum\s+(\w+)/g;
    while ((m = enumRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.ENUM_DEF, text: `enum ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Extensions: extension Type: Protocol { }
    const extRegex = /extension\s+(\w+)/g;
    while ((m = extRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `extension ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { isExtension: 'true', filePath } });
    }

    // Variables: var/let name: Type = value
    const varRegex = /(?:var|let)\s+(\w+)\s*(?::\s*[^\n=]+)?\s*=/g;
    while ((m = varRegex.exec(source)) !== null) {
      const tag = m[0].startsWith('let') ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;
      captures.push({ tag, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Imports: import Foundation
    const impRegex = /import\s+(\w+)/g;
    while ((m = impRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;

    // import ModuleName
    // import class Module.Submodule
    const impRegex = /import\s+(?:class\s+|func\s+|typealias\s+|struct\s+|enum\s+|protocol\s+|let\s+|var\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = impRegex.exec(source)) !== null) {
      const parts = m[1]!.split('.');
      imports.push({ source: m[1]!, names: [parts[parts.length - 1]!], type: 'named', lineNumber: this.ln(source, m.index) });
    }

    return imports;
  }

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    // Swift: public/internal modifiers; top-level declarations are internal by default
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:public|open)\\s+func\\s+${s}\\b|(?:public|open)\\s+class\\s+${s}\\b|(?:public|open)\\s+struct\\s+${s}\\b|(?:public|open)\\s+var\\s+${s}\\b|(?:public|open)\\s+let\\s+${s}\\b`).test(source);
  }

  // ---- Utility helpers ----

  /**
   * Find the first named child with the given type.
   */
  protected findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  /**
   * Recursively search for a descendant node with the given type.
   */
  protected findDeepChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    if (node.type === type) return node;
    for (let i = 0; i < node.namedChildCount; i++) {
      const result = this.findDeepChild(node.namedChild(i), type);
      if (result) return result;
    }
    return null;
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
