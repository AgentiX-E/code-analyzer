// @code-analyzer/analyzer — Ruby Tree-sitter Provider (with regex fallback)

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

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

    // require 'gem_name'
    const reqRegex = /require\s+['"]([^'"]+)['"]/g;
    while ((m = reqRegex.exec(source)) !== null) {
      const name = m[1]!.split('/').pop() ?? m[1]!;
      imports.push({ source: m[1]!, names: [name], type: 'named', lineNumber: this.ln(source, m.index) });
    }

    // require_relative '../path'
    const relRegex = /require_relative\s+['"]([^'"]+)['"]/g;
    while ((m = relRegex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!], type: 'named', lineNumber: this.ln(source, m.index) });
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

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
