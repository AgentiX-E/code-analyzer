// @code-analyzer/analyzer — Ruby Tree-sitter Provider (with regex fallback)

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const RUBY_EXTENSIONS = ['.rb'];
const RUBY_GLOBS = ['**/*.rb'];

export class RubyProvider extends TreeSitterBaseProvider {
  readonly language = 'ruby';
  readonly displayName = 'Ruby';
  readonly extensions = RUBY_EXTENSIONS;
  readonly globs = RUBY_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-ruby') as TreeSitterLanguage;
    } catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'method', captureTag: CAPTURE_TAGS.METHOD_DEF, nameChildType: 'identifier' },
      { nodeType: 'class', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'constant' },
      { nodeType: 'module', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'constant' },
      { nodeType: 'singleton_method', captureTag: CAPTURE_TAGS.METHOD_DEF, nameChildType: 'identifier' },
    ];
  }

  // ---- Import extraction (tree-sitter AST) ----

  /**
   * Walk the AST to find and extract Ruby import statements.
   * Ruby uses `require`, `require_relative`, and `load` calls,
   * which are parsed as `call` nodes in the tree-sitter AST.
   *
   * Syntax handled:
   *   require 'json'                  // standard library / gem
   *   require_relative '../lib/foo'   // relative path
   *   load 'config.rb'                // load a file
   */
  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'call') {
      this.extractRubyRequireImport(node, imports);
      return; // Don't recurse into call children
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  /**
   * Extract import details from a Ruby `call` AST node.
   * Checks if the call is to `require`, `require_relative`, or `load`,
   * then extracts the string argument as the import source.
   */
  private extractRubyRequireImport(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    const lineNumber = node.startPosition.row + 1;

    // Find the method identifier (require, require_relative, load)
    let methodName = '';
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'identifier') {
        methodName = child.text;
        break;
      }
    }

    if (methodName !== 'require' && methodName !== 'require_relative' && methodName !== 'load') {
      return;
    }

    // Find the string argument
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);

      if (child.type === 'string') {
        const raw = child.text;
        const path = raw.slice(1, -1); // Remove surrounding quotes
        const name = path.split('/').pop() ?? path;
        imports.push({ source: path, names: [name], type: 'named', lineNumber });
        return;
      }

      // Check inside argument_list for the string
      if (child.type === 'argument_list') {
        for (let j = 0; j < child.namedChildCount; j++) {
          const sub = child.namedChild(j);
          if (sub.type === 'string') {
            const raw = sub.text;
            const path = raw.slice(1, -1);
            const name = path.split('/').pop() ?? path;
            imports.push({ source: path, names: [name], type: 'named', lineNumber });
            return;
          }
        }
      }
    }
  }

  // Fallbacks
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Method definitions: def method_name or def self.method_name
    const methRegex = /def\s+(?:self\.)?(\w+[?!]?)/g;
    while ((m = methRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.METHOD_DEF, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Classes (uppercase start convention)
    const clsRegex = /class\s+([A-Z]\w*)/g;
    while ((m = clsRegex.exec(source)) !== null) {
      let baseClasses = '';
      const afterClass = source.slice(m.index + m[0].length, m.index + m[0].length + 100);
      const extendsMatch = afterClass.match(/<\s*([A-Z]\w*)/);
      if (extendsMatch) baseClasses = extendsMatch[1]!;
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `class ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { baseClasses, filePath } });
    }

    // Modules
    const modRegex = /module\s+([A-Z]\w*)/g;
    while ((m = modRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `module ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { isModule: 'true', filePath } });
    }

    // Constants
    const constRegex = /([A-Z][A-Z_]*[A-Z]\w*)\s*=/g;
    while ((m = constRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CONSTANT_DEF, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // attr_accessor, attr_reader, attr_writer
    const attrRegex = /attr_(?:accessor|reader|writer)\s+:(\w+)/g;
    while ((m = attrRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { isAttribute: 'true', filePath } });
    }

    // Imports (require)
    const impRegex = /require\s+['"]([^'"]+)['"]/g;
    while ((m = impRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;

    // require, require_relative, load
    const reqRegex = /(?:require|require_relative|load)\s+['"]([^'"]+)['"]/g;
    while ((m = reqRegex.exec(source)) !== null) {
      const path = m[1]!;
      const name = path.split('/').pop() ?? path;
      imports.push({ source: path, names: [name], type: 'named', lineNumber: this.ln(source, m.index) });
    }

    return imports;
  }

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    // Ruby: methods are public by default
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Check if any private/protected keyword comes before the method
    const isPrivate = source.includes('private') && source.indexOf('private') < source.indexOf(`def ${symbolName}`);
    return !isPrivate && new RegExp(`def\\s+(?:self\.)?${s}\\b|class\\s+${s}\\b|module\\s+${s}\\b`).test(source);
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
