// @code-analyzer/analyzer — PHP Tree-sitter Provider (with regex fallback)

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

const PHP_EXTENSIONS = ['.php', '.phtml'];
const PHP_GLOBS = ['**/*.php', '**/*.phtml'];

export class PhpProvider extends TreeSitterBaseProvider {
  readonly language = 'php';
  readonly displayName = 'PHP';
  readonly extensions = PHP_EXTENSIONS;
  readonly globs = PHP_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-php') as TreeSitterLanguage;
    } catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_definition', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'name' },
      { nodeType: 'class_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'name' },
      { nodeType: 'interface_declaration', captureTag: CAPTURE_TAGS.INTERFACE_DEF, nameChildType: 'name' },
      { nodeType: 'trait_declaration', captureTag: CAPTURE_TAGS.TRAIT_DEF, nameChildType: 'name' },
      { nodeType: 'enum_declaration', captureTag: CAPTURE_TAGS.ENUM_DEF, nameChildType: 'name' },
      { nodeType: 'method_declaration', captureTag: CAPTURE_TAGS.METHOD_DEF, nameChildType: 'name' },
    ];
  }

  // Fallbacks (primary since tree-sitter-php may not be available)
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Functions
    const funcRegex = /function\s+(\w+)\s*\(/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Classes
    const clRegex = /(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/g;
    while ((m = clRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `class ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Interfaces
    const ifRegex = /interface\s+(\w+)/g;
    while ((m = ifRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.INTERFACE_DEF, text: `interface ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Traits
    const trRegex = /trait\s+(\w+)/g;
    while ((m = trRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.TRAIT_DEF, text: `trait ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Enums (PHP 8.1+)
    const enumRegex = /enum\s+(\w+)/g;
    while ((m = enumRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.ENUM_DEF, text: `enum ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Variables
    const varRegex = /\$(this|\w+)/g;
    const seen = new Set<string>();
    while ((m = varRegex.exec(source)) !== null) {
      const name = m[1]!;
      if (name === 'this' || seen.has(name)) continue;
      seen.add(name);
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: name, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name, properties: { filePath } });
    }

    // Imports
    const imps = this.fallbackExtractImports(source);
    for (const imp of imps) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: imp.source, startLine: imp.lineNumber, endLine: imp.lineNumber, startByte: 0, endByte: 0, name: imp.source, properties: { names: imp.names.join(','), importType: imp.type, filePath } });
    }

    // Doc comments
    const docRegex = /\/\*\*([\s\S]*?)\*\//g;
    while ((m = docRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.DOCSTRING, text: m[0], startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, properties: { filePath } });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;

    // use statements: use Namespace\Class;
    // use Namespace\Class as Alias;
    // use function Namespace\func;
    // use const Namespace\CONST;
    const useRegex = /use\s+(?:function\s+|const\s+)?([\w\\]+)(?:\s+as\s+(\w+))?\s*;/g;
    while ((m = useRegex.exec(source)) !== null) {
      const fullPath = m[1]!;
      const alias = m[2];
      const parts = fullPath.split('\\');
      const name = alias ?? parts[parts.length - 1]!;
      imports.push({ source: fullPath, names: [name], type: 'named', lineNumber: this.ln(source, m.index) });
    }

    // require/include
    const reqRegex = /(?:require|require_once|include|include_once)\s*(?:\(?\s*['"]([^'"]+)['"]\s*\)?)\s*;/g;
    while ((m = reqRegex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!], type: 'default', lineNumber: this.ln(source, m.index) });
    }

    return imports;
  }

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    // PHP: public methods/properties, classes are typically public
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:public\\s+)?function\\s+${s}\\b|class\\s+${s}\\b|interface\\s+${s}\\b|trait\\s+${s}\\b`).test(source);
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
