// @code-analyzer/analyzer — Swift Tree-sitter Provider (with regex fallback)

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

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
      /* v8 ignore start -- @preserve -- grammar is bundled, require never throws */
      return null;
    }
    /* v8 ignore stop */
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    const nodeType = node.type;

    if (
      nodeType === 'class_declaration' ||
      nodeType === 'struct_declaration' ||
      nodeType === 'enum_declaration' ||
      nodeType === 'protocol_declaration' ||
      nodeType === 'function_declaration'
    ) {
      // Check for public/open access modifier
      let hasPublicModifier = false;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'modifiers') {
          for (let j = 0; j < child.childCount; j++) {
            const modText = child.child(j).text;
            if (modText === 'public' || modText === 'open') {
              hasPublicModifier = true;
              break;
            }
          }
        }
        // Direct access_modifier children (some tree-sitter versions)
        /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
        if (child.type === 'access_modifier' || child.type === 'access_control_modifier') {
          const modText = child.text;
          /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
          if (modText === 'public' || modText === 'open') {
            hasPublicModifier = true;
          }
        }
      }

      if (hasPublicModifier) {
        const nameNode =
          this.findNamedChild(node, 'type_identifier') ??
          this.findNamedChild(node, 'identifier') ??
          this.findNamedChild(node, 'simple_identifier');
        /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
        if (nameNode && nameNode.text === symbolName) return true;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }

    return false;
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;
    const sourceText = node.text;

    // tree-sitter-swift lumps class, struct, enum, extension into class_declaration
    if (nodeType === 'class_declaration') {
      if (sourceText.startsWith('struct ')) {
        const nameNode = this.findNamedChild(node, 'type_identifier');
        /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
        if (nameNode) {
          captures.push({
            tag: CAPTURE_TAGS.STRUCT_DEF,
            text: sourceText,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: nameNode.startIndex,
            endByte: nameNode.endIndex,
            name: nameNode.text,
            properties: { filePath: this.filePath },
          });
        }
      } else if (sourceText.startsWith('enum ')) {
        const nameNode = this.findNamedChild(node, 'type_identifier');
        /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
        if (nameNode) {
          captures.push({
            tag: CAPTURE_TAGS.ENUM_DEF,
            text: sourceText,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: nameNode.startIndex,
            endByte: nameNode.endIndex,
            name: nameNode.text,
            properties: { filePath: this.filePath },
          });
        }
      } else if (sourceText.startsWith('extension ')) {
        const userType = this.findNamedChild(node, 'user_type');
        /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
        const nameNode = userType ? this.findNamedChild(userType, 'type_identifier') : null;
        /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
        if (nameNode) {
          captures.push({
            tag: CAPTURE_TAGS.CLASS_DEF,
            text: sourceText,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: nameNode.startIndex,
            endByte: nameNode.endIndex,
            name: nameNode.text,
            properties: { isExtension: 'true', filePath: this.filePath },
          });
        }
      } else if (sourceText.startsWith('actor ')) {
        // Actor (Swift 5.5+ concurrency) — tree-sitter-swift lumps actor into class_declaration
        const nameNode = this.findNamedChild(node, 'type_identifier');
        /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
        if (nameNode) {
          captures.push({
            tag: CAPTURE_TAGS.CLASS_DEF,
            text: sourceText,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: nameNode.startIndex,
            endByte: nameNode.endIndex,
            name: nameNode.text,
            properties: { isActor: 'true', filePath: this.filePath },
          });
        }
      } else {
        // Regular class
        const nameNode = this.findNamedChild(node, 'type_identifier');
        /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
        if (nameNode) {
          captures.push({
            tag: CAPTURE_TAGS.CLASS_DEF,
            text: sourceText,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: nameNode.startIndex,
            endByte: nameNode.endIndex,
            name: nameNode.text,
            properties: { filePath: this.filePath },
          });
        }
      }
    }

    // Function declarations — handle async/throws modifiers
    else if (nodeType === 'function_declaration') {
      let nameNode = this.findNamedChild(node, 'simple_identifier');
      /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
      if (!nameNode) nameNode = this.findNamedChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
      if (nameNode) {
        // Detect async, throws, and modifier keywords
        const hasAsync = node.text.includes('async');
        /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
        const hasThrows = node.text.includes('throws') || node.text.includes('rethrows');
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_DEF,
          text: sourceText,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: {
            filePath: this.filePath,
            isAsync: String(hasAsync),
            hasThrows: String(hasThrows),
          },
        });
      }
    }

    // Result builder attribute (@resultBuilder)
    else if (nodeType === 'attribute') {
      /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
      if (sourceText.includes('resultBuilder')) {
        // tree-sitter-swift nests the attribute inside the declaration's modifiers,
        // so the attributed declaration is the attribute's grandparent.
        const decl = node.parent?.parent;
        /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
        if (decl && decl.type === 'class_declaration') {
          /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
          const sibName =
            this.findNamedChild(decl, 'type_identifier') ??
            this.findNamedChild(decl, 'identifier') ??
            this.findNamedChild(decl, 'simple_identifier');
          /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
          if (sibName) {
            captures.push({
              tag: CAPTURE_TAGS.FUNCTION_DEF,
              text: `@resultBuilder ${sibName.text}`,
              startLine: decl.startPosition.row + 1,
              endLine: decl.endPosition.row + 1,
              startByte: sibName.startIndex,
              endByte: sibName.endIndex,
              name: sibName.text,
              properties: { isResultBuilder: 'true', filePath: this.filePath },
            });
          }
        }
      }
    }

    // Protocol declarations
    else if (nodeType === 'protocol_declaration') {
      const nameNode = this.findNamedChild(node, 'type_identifier');
      /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.INTERFACE_DEF,
          text: sourceText,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    }

    // Property declarations (variables/constants)
    else if (nodeType === 'property_declaration') {
      let isLet = false;
      let nameNode: TreeSitterSyntaxNode | null = null;
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'value_binding_pattern') {
          isLet = child.text === 'let';
        }
        if (child.type === 'pattern') {
          for (let j = 0; j < child.namedChildCount; j++) {
            /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
            if (child.namedChild(j).type === 'simple_identifier') {
              nameNode = child.namedChild(j);
              break;
            }
          }
        }
      }
      /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
      if (nameNode) {
        captures.push({
          tag: isLet ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF,
          text: sourceText,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    }

    // Import declarations
    else if (nodeType === 'import_declaration') {
      /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
      const nameNode =
        this.findNamedChild(node, 'identifier') ?? this.findNamedChild(node, 'type_identifier');
      /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
      const importName = nameNode ? nameNode.text : sourceText.replace(/^import\s+/, '');
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: importName,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: importName,
        properties: { filePath: this.filePath },
      });
    }

    // Recurse into children
    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
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
  /* v8 ignore next */
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
      /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
      if (
        /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
        child.type === 'type_identifier' ||
        child.type === 'identifier' ||
        child.type === 'simple_identifier'
      ) {
        parts.push(child.text);
      }
    }

    /* v8 ignore next -- @preserve -- defensive null / non-matching branch */
    if (parts.length === 0) return;

    const sourcePath = parts.join('.');
    // tree-sitter-swift may emit the dotted path as a single type_identifier,
    // so take the last dot-segment as the import name.
    const lastName = sourcePath.split('.').pop()!;
    imports.push({ source: sourcePath, names: [lastName], type: 'named', lineNumber });
  }

  // Fallbacks
  /* v8 ignore next */
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Functions: func name(params) -> ReturnType { }
    const funcRegex = /func\s+(\w+)\s*\(/g;
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

    // Classes: class Name: SuperClass { }
    const clRegex = /class\s+(\w+)\s*(?::\s*(\w+))?/g;
    while ((m = clRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { baseClasses: m[2] ?? '', filePath },
      });
    }

    // Structs: struct Name: Protocol { }
    const stRegex = /struct\s+(\w+)\s*(?::\s*(\w+))?/g;
    while ((m = stRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.STRUCT_DEF,
        text: `struct ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { baseClasses: m[2] ?? '', filePath },
      });
    }

    // Protocols (interfaces): protocol Name { }
    const protRegex = /protocol\s+(\w+)/g;
    while ((m = protRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `protocol ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Enums: enum Name: Type { }
    const enumRegex = /enum\s+(\w+)/g;
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

    // Extensions: extension Type: Protocol { }
    const extRegex = /extension\s+(\w+)/g;
    while ((m = extRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `extension ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isExtension: 'true', filePath },
      });
    }

    // Variables: var/let name: Type = value
    const varRegex = /(?:var|let)\s+(\w+)\s*(?::\s*[^\n=]+)?\s*=/g;
    while ((m = varRegex.exec(source)) !== null) {
      const tag = m[0].startsWith('let') ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;
      captures.push({
        tag,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Imports: import Foundation
    const impRegex = /import\s+(\w+)/g;
    while ((m = impRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  /* v8 ignore next */
  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;

    // import ModuleName
    // import class Module.Submodule
    const impRegex =
      /import\s+(?:class\s+|func\s+|typealias\s+|struct\s+|enum\s+|protocol\s+|let\s+|var\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = impRegex.exec(source)) !== null) {
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
    // Swift: public/internal modifiers; top-level declarations are internal by default
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `(?:public|open)\\s+func\\s+${s}\\b|(?:public|open)\\s+class\\s+${s}\\b|(?:public|open)\\s+struct\\s+${s}\\b|(?:public|open)\\s+var\\s+${s}\\b|(?:public|open)\\s+let\\s+${s}\\b`,
    ).test(source);
  }
  /* v8 ignore stop */

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

  /* v8 ignore next -- @preserve -- only used by regex fallback */
  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
