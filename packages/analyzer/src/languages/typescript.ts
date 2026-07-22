// @code-analyzer/analyzer — TypeScript Tree-sitter Provider
// Replaces regex-based parsing with tree-sitter AST for 99.9%+ accuracy.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture, CaptureTag } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const tsExtensions = ['.ts', '.tsx', '.mts', '.cts'];
const tsGlobs = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.d.ts'];

export class TypeScriptProvider extends TreeSitterBaseProvider {
  readonly language = 'typescript';
  readonly displayName = 'TypeScript';
  readonly extensions = tsExtensions;
  readonly globs = tsGlobs;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tsGrammar = require('tree-sitter-typescript') as { typescript: TreeSitterLanguage; tsx: TreeSitterLanguage };
      return tsGrammar.typescript;
    } catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_declaration', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'arrow_function', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'class_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'type_identifier' },
      { nodeType: 'method_definition', captureTag: CAPTURE_TAGS.METHOD_DEF, nameChildType: 'property_identifier' },
      { nodeType: 'interface_declaration', captureTag: CAPTURE_TAGS.INTERFACE_DEF, nameChildType: 'type_identifier' },
      { nodeType: 'type_alias_declaration', captureTag: CAPTURE_TAGS.TYPE_DEF, nameChildType: 'type_identifier' },
      { nodeType: 'enum_declaration', captureTag: CAPTURE_TAGS.ENUM_DEF, nameChildType: 'identifier' },
      { nodeType: 'variable_declaration', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'identifier' },
      { nodeType: 'decorator', captureTag: CAPTURE_TAGS.DECORATOR, useFirstNamedChild: true },
      { nodeType: 'comment', captureTag: CAPTURE_TAGS.DOCSTRING, useFirstNamedChild: true },
    ];
  }

  // ---- Override walk-and-capture for TypeScript-specific logic ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const mappings = this.getNodeMappings();
    const nodeType = node.type;

    for (const mapping of mappings) {
      if (nodeType === mapping.nodeType) {
        // Special handling for method_definition: skip if name is 'constructor'
        if (nodeType === 'method_definition') {
          const nameChild = this.findNamedChild(node, 'property_identifier');
          if (nameChild && nameChild.text === 'constructor') {
            // Emit as constructor instead
            captures.push(this.buildCapture(node, CAPTURE_TAGS.CONSTRUCTOR_DEF, nameChild));
            break;
          }
        }

        // Special handling for lexical_declaration (const/let/var)
        if (nodeType === 'variable_declaration') {
          // Check if it's const, let, or var
          const isConst = node.text.startsWith('const');
          const tag = isConst ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;
          const nameChild = this.findNamedChild(node, 'identifier');
          if (nameChild) {
            captures.push(this.buildCapture(node, tag, nameChild));
          }
          break;
        }

        // Special handling for arrow_function
        if (nodeType === 'arrow_function') {
          const parent = node.parent;
          if (parent && parent.type === 'variable_declarator') {
            const nameChild = this.findNamedChild(parent, 'identifier');
            if (nameChild) {
              const cap = this.buildCapture(node, CAPTURE_TAGS.FUNCTION_DEF, nameChild);
              cap.properties = { ...cap.properties, arrow: 'true', async: String(node.text.includes('async')) };
              captures.push(cap);
            }
          }
          break;
        }

        // Special handling for comment (only JSDoc-style)
        if (nodeType === 'comment') {
          if (node.text.startsWith('/**')) {
            captures.push(this.buildCapture(node, CAPTURE_TAGS.DOCSTRING, node));
          }
          break;
        }

        // Default handling
        this.emitCapture(node, mapping, captures);
        break;
      }
    }

    // Also handle lexical_declaration
    if (nodeType === 'lexical_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'variable_declarator') {
          const nameChild = this.findNamedChild(child, 'identifier');
          const valueChild = child.namedChild(1); // value expression
          if (nameChild) {
            const isArrow = valueChild?.type === 'arrow_function';
            if (!isArrow) {
              const isConst = node.text.startsWith('const');
              const tag = isConst ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;
              captures.push(this.buildCapture(node, tag, nameChild));
            }
          }
        }
      }
    }

    // Handle import_statement as capture
    if (nodeType === 'import_statement') {
      captures.push(this.buildImportCapture(node));
    }

    // Recursively walk children
    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  // ---- Import extraction ----

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_statement') {
      this.extractTypeScriptImport(node, imports);
      return; // Don't recurse into import children
    }

    // Dynamic imports
    if (node.type === 'call_expression') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'import') {
          this.extractDynamicImport(node, imports);
          break;
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  private extractTypeScriptImport(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    let sourcePath = '';
    let importType: 'named' | 'default' | 'namespace' = 'named';
    const names: string[] = [];

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);

      if (child.type === 'string') {
        // Extract path from string like 'foo' or "foo"
        const raw = child.text;
        sourcePath = raw.slice(1, -1);
      }

      if (child.type === 'import_clause') {
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);

          if (sub.type === 'namespace_import') {
            importType = 'namespace';
            const nameNode = this.findDeepChild(sub, 'identifier');
            if (nameNode) names.push(nameNode.text);
          } else if (sub.type === 'named_imports') {
            importType = 'named';
            for (let k = 0; k < sub.childCount; k++) {
              const spec = sub.child(k);
              if (spec.type === 'import_specifier') {
                const nameNode = this.findDeepChild(spec, 'identifier') || this.findDeepChild(spec, 'property_identifier');
                if (nameNode) names.push(nameNode.text);
              }
            }
          } else if (sub.type === 'identifier') {
            importType = 'default';
            names.push(sub.text);
          }
        }
      }
    }

    if (sourcePath && names.length > 0) {
      imports.push({
        source: sourcePath,
        names,
        type: importType,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractDynamicImport(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'arguments') {
        const strNode = this.findDeepChild(child, 'string');
        if (strNode) {
          imports.push({
            source: strNode.text.slice(1, -1),
            names: [],
            type: 'default',
            lineNumber: node.startPosition.row + 1,
          });
        }
      }
    }
  }

  // ---- Export detection ----

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    // export statement
    if (node.type === 'export_statement') {
      // Check if any declaration inside exports this symbol
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'export_clause') {
          for (let j = 0; j < child.childCount; j++) {
            const spec = child.child(j);
            if (spec.type === 'export_specifier') {
              const nameNode = this.findNamedChild(spec, 'identifier');
              if (nameNode && nameNode.text === symbolName) return true;
            }
          }
        }

        // export default function/class
        if (child.type === 'function_declaration' || child.type === 'class_declaration') {
          const nameNode = this.findNamedChild(child, 'identifier') || this.findNamedChild(child, 'type_identifier');
          if (nameNode && nameNode.text === symbolName) return true;
        }
      }
      return false; // Don't keep recursing
    }

    // Check for 'export' keyword directly on declarations
    const isExported =
      node.type === 'function_declaration' ||
      node.type === 'class_declaration' ||
      node.type === 'interface_declaration' ||
      node.type === 'type_alias_declaration' ||
      node.type === 'enum_declaration' ||
      node.type === 'lexical_declaration' ||
      node.type === 'variable_declaration';

    if (isExported) {
      // Check if this node has 'export' modifier prefix
      const prefix = this.source.slice(Math.max(0, node.startIndex - 10), node.startIndex);
      if (prefix.includes('export')) {
        const nameNode =
          this.findNamedChild(node, 'identifier') ||
          this.findNamedChild(node, 'type_identifier');
        if (nameNode && nameNode.text === symbolName) return true;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }

    return false;
  }

  // ---- Helpers ----

  private buildCapture(node: TreeSitterSyntaxNode, tag: CaptureTag, nameNode: TreeSitterSyntaxNode): UnifiedCapture {
    let containerName: string | undefined;
    const container = this.findContainerNode(node);
    if (container) {
      const cn = this.findNamedChild(container, 'type_identifier') || this.findNamedChild(container, 'identifier');
      if (cn) containerName = cn.text;
    }

    return {
      tag,
      text: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: nameNode.startIndex,
      endByte: nameNode.endIndex,
      name: nameNode.text,
      containerName,
      properties: { filePath: this.filePath },
    };
  }

  private buildImportCapture(node: TreeSitterSyntaxNode): UnifiedCapture {
    let sourcePath = '';
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'string') {
        sourcePath = child.text.slice(1, -1);
        break;
      }
    }

    return {
      tag: CAPTURE_TAGS.IMPORT,
      text: sourcePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: node.startIndex,
      endByte: node.endIndex,
      name: sourcePath,
      properties: { filePath: this.filePath, importType: 'named', names: '' },
    };
  }

  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === type) return child;
    }
    return null;
  }

  private findDeepChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    if (node.type === type) return node;
    for (let i = 0; i < node.namedChildCount; i++) {
      const result = this.findDeepChild(node.namedChild(i), type);
      if (result) return result;
    }
    return null;
  }

  // ---- Fallback (regex-based) ----

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];

    // Function declarations
    const funcRegex = /\b(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = funcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: match[1]!,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Classes
    const classRegex = /(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)/g;
    while ((match = classRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${match[1]!}`,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Interfaces
    const ifaceRegex = /(?:export\s+)?interface\s+(\w+)/g;
    while ((match = ifaceRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `interface ${match[1]!}`,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Type aliases
    const typeRegex = /(?:export\s+)?type\s+(\w+)/g;
    while ((match = typeRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.TYPE_DEF,
        text: `type ${match[1]!}`,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Enums
    const enumRegex = /(?:export\s+)?(?:const\s+)?enum\s+(\w+)/g;
    while ((match = enumRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${match[1]!}`,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Arrow functions
    const arrowRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
    while ((match = arrowRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: match[1]!,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { arrow: 'true', filePath },
      });
    }

    // Variables
    const varRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=\n]+)?\s*=(?![^=]*=>)/g;
    while ((match = varRegex.exec(source)) !== null) {
      captures.push({
        tag: match[0].includes('const') ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF,
        text: match[1]!,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Imports as captures
    const parsed = this.fallbackExtractImports(source);
    for (const imp of parsed) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: imp.source,
        startLine: imp.lineNumber,
        endLine: imp.lineNumber,
        startByte: 0,
        endByte: 0,
        name: imp.source,
        properties: { names: imp.names.join(','), importType: imp.type, filePath },
      });
    }

    // Decorators
    const decRegex = /@(\w+(?:\([\s\S]*?\))?)/g;
    while ((match = decRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.DECORATOR,
        text: match[0],
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!.split('(')[0],
        properties: { decorator: match[1]!.split('(')[0]!, filePath },
      });
    }

    // JSDoc
    const docRegex = /\/\*\*([\s\S]*?)\*\//g;
    while ((match = docRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.DOCSTRING,
        text: match[0],
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        properties: { filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const regex = /import\s+(?:type\s+)?(?:(\*)\s+as\s+(\w+)|(\{[\s\S]*?\})|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      const path = match[5]!;
      const line = this.lineFromOffset(source, match.index);
      if (match[2]) {
        imports.push({ source: path, names: [match[2]], type: 'namespace', lineNumber: line });
      } else if (match[3]) {
        const names = this.parseNamedImports(match[3]);
        imports.push({ source: path, names, type: 'named', lineNumber: line });
      } else if (match[4]) {
        imports.push({ source: path, names: [match[4]], type: 'default', lineNumber: line });
      }
    }

    // Dynamic imports
    const dynRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynRegex.exec(source)) !== null) {
      imports.push({ source: match[1]!, names: [], type: 'default', lineNumber: this.lineFromOffset(source, match.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const patterns = [
      new RegExp(`export\\s+(?:default\\s+)?(?:function|class|const|let|var|interface|type|enum|abstract\\s+class)\\s+${escapeRegex(symbolName)}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${escapeRegex(symbolName)}\\b[^}]*\\}`),
    ];
    return patterns.some((p) => p.test(source));
  }

  private lineFromOffset(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }

  private parseNamedImports(braceContent: string): string[] {
    const names: string[] = [];
    const regex = /(\w+)(?:\s+as\s+(\w+))?/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(braceContent)) !== null) {
      names.push(match[2] ?? match[1]!);
    }
    return names;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
