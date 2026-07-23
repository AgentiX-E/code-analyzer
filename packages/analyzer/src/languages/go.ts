// @code-analyzer/analyzer — Go Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const goExtensions = ['.go'];
const goGlobs = ['**/*.go'];

export class GoProvider extends TreeSitterBaseProvider {
  readonly language = 'go';
  readonly displayName = 'Go';
  readonly extensions = goExtensions;
  readonly globs = goGlobs;
  readonly importSemantics = 'wildcard-leaf' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-go') as TreeSitterLanguage;
    } catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_declaration', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'type_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'type_identifier' },
      { nodeType: 'import_declaration', captureTag: CAPTURE_TAGS.IMPORT, useFirstNamedChild: true },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_declaration') {
      const nameNode = this.findChildType(node, 'identifier');
      if (nameNode) {
        const exported = nameNode.text[0] === nameNode.text[0]?.toUpperCase();
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { exported: String(exported), filePath: this.filePath },
        });
      }
    } else if (nodeType === 'type_declaration') {
      // Determine if it's a struct, interface, or type alias
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'type_spec') {
          const nameNode = this.findChildType(child, 'type_identifier');
          if (!nameNode) continue;

          // Check what kind of type
          const structType = this.findChildType(child, 'struct_type');
          const ifaceType = this.findChildType(child, 'interface_type');

          if (structType) {
            captures.push({
              tag: CAPTURE_TAGS.STRUCT_DEF,
              text: `struct ${nameNode.text}`,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: nameNode.startIndex,
              endByte: nameNode.endIndex,
              name: nameNode.text,
              properties: { filePath: this.filePath },
            });
          } else if (ifaceType) {
            captures.push({
              tag: CAPTURE_TAGS.INTERFACE_DEF,
              text: `interface ${nameNode.text}`,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: nameNode.startIndex,
              endByte: nameNode.endIndex,
              name: nameNode.text,
              properties: { filePath: this.filePath },
            });
          } else {
            captures.push({
              tag: CAPTURE_TAGS.TYPE_DEF,
              text: `type ${nameNode.text}`,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: nameNode.startIndex,
              endByte: nameNode.endIndex,
              name: nameNode.text,
              properties: { filePath: this.filePath },
            });
          }
        }
      }
    } else if (nodeType === 'method_declaration') {
      // Find receiver type and method name
      const nameNode = this.findChildType(node, 'field_identifier') || this.findChildType(node, 'identifier');
      let receiverType: string | undefined;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'parameter_list') {
          // Check if it's a receiver (first param list)
          for (let j = 0; j < child.childCount; j++) {
            const p = child.child(j);
            if (p.type === 'parameter_declaration') {
              const typeId = this.findChildType(p, 'type_identifier') || this.findChildType(p, 'pointer_type');
              if (typeId) {
                receiverType = typeId.type === 'pointer_type'
                  ? this.findChildType(typeId, 'type_identifier')?.text
                  : typeId.text;
              }
              break;
            }
          }
          break;
        }
      }
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.METHOD_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          containerName: receiverType,
          properties: { receiverType: receiverType ?? '', filePath: this.filePath },
        });
      }
    } else if (nodeType === 'import_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'import_spec') {
          let path = '';
          let alias: string | undefined;
          for (let j = 0; j < child.childCount; j++) {
            const sub = child.child(j);
            if (sub.type === 'interpreted_string_literal') {
              path = sub.text.slice(1, -1);
            } else if (sub.type === 'package_identifier') {
              alias = sub.text;
            }
          }
          if (path) {
            captures.push({
              tag: CAPTURE_TAGS.IMPORT,
              text: path,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startByte: node.startIndex,
              endByte: node.endIndex,
              name: path,
              properties: { alias: alias ?? '', filePath: this.filePath },
            });
          }
        }
      }
    } else if (nodeType === 'var_declaration' || nodeType === 'const_declaration') {
      const isConst = nodeType === 'const_declaration';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'var_spec' || child.type === 'const_spec') {
          const idNode = this.findChildType(child, 'identifier');
          if (idNode) {
            captures.push({
              tag: isConst ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF,
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
    } else if (nodeType === 'package_clause') {
      const nameNode = this.findChildType(node, 'package_identifier');
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: `package ${nameNode.text}`,
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
    if (node.type === 'import_spec') {
      let path = '';
      let alias: string | undefined;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'interpreted_string_literal') {
          path = child.text.slice(1, -1);
        } else if (child.type === 'package_identifier') {
          alias = child.text;
        }
      }
      if (path) {
        const names = alias ? [alias] : [path.split('/').pop() ?? path];
        imports.push({
          source: path,
          names,
          type: alias ? 'namespace' : 'named',
          lineNumber: node.startPosition.row + 1,
        });
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(_node: TreeSitterSyntaxNode, symbolName: string): boolean {
    if (!symbolName) return false;
    return symbolName[0] === symbolName[0]?.toUpperCase() && symbolName[0] !== symbolName[0]?.toLowerCase();
  }

  // Fallbacks
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;
    const funcRegex = /func\s+(\w+)\s*\(/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const methRegex = /func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(/g;
    while ((m = methRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.METHOD_DEF, text: m[3]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[3]!, containerName: m[2]!, properties: { receiver: m[1]!, receiverType: m[2]!, filePath } });
    }
    const structRegex = /type\s+(\w+)\s+struct/g;
    while ((m = structRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.STRUCT_DEF, text: `struct ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const ifaceRegex = /type\s+(\w+)\s+interface/g;
    while ((m = ifaceRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.INTERFACE_DEF, text: `interface ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const pkgRegex = /^package\s+(\w+)/m;
    m = pkgRegex.exec(source);
    if (m) captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: `package ${m[1]!}`, startLine: 1, endLine: 1, startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    const imps = this.fallbackExtractImports(source);
    for (const imp of imps) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: imp.source, startLine: imp.lineNumber, endLine: imp.lineNumber, startByte: 0, endByte: 0, name: imp.source, properties: { names: imp.names.join(','), importType: imp.type, filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const singleRegex = /import\s+"([^"]+)"/g;
    while ((m = singleRegex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!.split('/').pop() ?? m[1]!], type: 'named', lineNumber: this.ln(source, m.index) });
    }
    const namedRegex = /import\s+(\w+)\s+"([^"]+)"/g;
    while ((m = namedRegex.exec(source)) !== null) {
      imports.push({ source: m[2]!, names: [m[1]!], type: 'namespace', lineNumber: this.ln(source, m.index) });
    }
    const multiRegex = /import\s*\(([\s\S]*?)\)/g;
    while ((m = multiRegex.exec(source)) !== null) {
      const lineRegex = /(?:(\w+)\s+)?"([^"]+)"/g;
      let inner: RegExpExecArray | null;
      while ((inner = lineRegex.exec(m[1]!))) {
        imports.push({ source: inner[2]!, names: [inner[1] ?? inner[2]!.split('/').pop() ?? inner[2]!], type: inner[1] ? 'namespace' : 'named', lineNumber: this.ln(source, m.index) });
      }
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, symbolName: string): boolean {
    if (!symbolName) return false;
    return symbolName[0] === symbolName[0]?.toUpperCase() && symbolName[0] !== symbolName[0]?.toLowerCase();
  }

  private findChildType(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i).type === type) return node.child(i);
    }
    return null;
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
