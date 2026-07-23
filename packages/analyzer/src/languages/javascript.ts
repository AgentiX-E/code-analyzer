// @code-analyzer/analyzer — JavaScript Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const jsExtensions = ['.js', '.jsx', '.mjs', '.cjs'];
const jsGlobs = ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'];

export class JavaScriptProvider extends TreeSitterBaseProvider {
  readonly language = 'javascript';
  readonly displayName = 'JavaScript';
  readonly extensions = jsExtensions;
  readonly globs = jsGlobs;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-javascript') as TreeSitterLanguage;
    } catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_declaration', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'arrow_function', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'class_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'identifier' },
      { nodeType: 'method_definition', captureTag: CAPTURE_TAGS.METHOD_DEF, nameChildType: 'property_identifier' },
      { nodeType: 'variable_declaration', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'identifier' },
      { nodeType: 'comment', captureTag: CAPTURE_TAGS.DOCSTRING, useFirstNamedChild: true },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_declaration') {
      const nameNode = this.findNamedChild(node, 'identifier');
      const isAsync = node.text.includes('async');
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { async: String(isAsync), filePath: this.filePath },
        });
      }
    } else if (nodeType === 'arrow_function') {
      const parent = node.parent;
      if (parent?.type === 'variable_declarator') {
        const nameNode = this.findNamedChild(parent, 'identifier');
        if (nameNode) {
          captures.push({
            tag: CAPTURE_TAGS.FUNCTION_DEF,
            text: nameNode.text,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: nameNode.startIndex,
            endByte: nameNode.endIndex,
            name: nameNode.text,
            properties: { arrow: 'true', async: String(node.text.includes('async')), filePath: this.filePath },
          });
        }
      }
    } else if (nodeType === 'class_declaration') {
      const nameNode = this.findNamedChild(node, 'identifier');
      if (nameNode) {
        const baseClasses = this.extractExtends(node);
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
    } else if (nodeType === 'method_definition') {
      const nameNode = this.findNamedChild(node, 'property_identifier');
      if (nameNode) {
        const container = this.findContainerNode(node);
        let containerName: string | undefined;
        if (container) {
          const cn = this.findNamedChild(container, 'identifier');
          if (cn) containerName = cn.text;
        }

        const tag = nameNode.text === 'constructor' ? CAPTURE_TAGS.CONSTRUCTOR_DEF : CAPTURE_TAGS.METHOD_DEF;
        captures.push({
          tag,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          containerName,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'lexical_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'variable_declarator') {
          const nameNode = this.findNamedChild(child, 'identifier');
          const valueChild = child.namedChild(1);
          if (nameNode && valueChild?.type !== 'arrow_function') {
            const isConst = node.text.startsWith('const');
            const tag = isConst ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;
            captures.push({
              tag,
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
      }
    } else if (nodeType === 'comment') {
      if (node.text.startsWith('/**')) {
        captures.push({
          tag: CAPTURE_TAGS.DOCSTRING,
          text: node.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'import_statement') {
      let sourcePath = '';
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'string') {
          sourcePath = child.text.slice(1, -1);
          break;
        }
      }
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: sourcePath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: sourcePath,
        properties: { filePath: this.filePath },
      });
    }

    // JSX component detection
    if (nodeType === 'arrow_function' || nodeType === 'function_declaration') {
      const hasJSX = node.text.includes('<') && (node.text.includes('/>') || node.text.includes('</'));
      const nameNode = node.type === 'function_declaration'
        ? this.findNamedChild(node, 'identifier')
        : node.parent?.type === 'variable_declarator' ? this.findNamedChild(node.parent, 'identifier') : null;

      if (nameNode && hasJSX && nameNode.text[0] === nameNode.text[0]?.toUpperCase()) {
        captures.push({
          tag: CAPTURE_TAGS.COMPONENT_PROPS,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { isComponent: 'true', filePath: this.filePath },
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_statement') {
      let sourcePath = '';
      let importType: 'named' | 'default' | 'namespace' = 'named';
      const names: string[] = [];

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'string') {
          sourcePath = child.text.slice(1, -1);
        }
        if (child.type === 'import_clause') {
          for (let j = 0; j < child.childCount; j++) {
            const sub = child.child(j);
            if (sub.type === 'namespace_import') {
              importType = 'namespace';
              const id = this.findDeepChild(sub, 'identifier');
              if (id) names.push(id.text);
            } else if (sub.type === 'named_imports') {
              importType = 'named';
              for (let k = 0; k < sub.childCount; k++) {
                const spec = sub.child(k);
                if (spec.type === 'import_specifier') {
                  const id = this.findDeepChild(spec, 'identifier') || this.findDeepChild(spec, 'property_identifier');
                  if (id) names.push(id.text);
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
        imports.push({ source: sourcePath, names, type: importType, lineNumber: node.startPosition.row + 1 });
      }
      return;
    }

    // require() calls
    if (node.type === 'call_expression') {
      for (let i = 0; i < node.childCount; i++) {
        if (node.child(i).type === 'identifier' && node.child(i).text === 'require') {
          for (let j = 0; j < node.childCount; j++) {
            const arg = node.child(j);
            if (arg.type === 'arguments') {
              const strNode = this.findDeepChild(arg, 'string');
              if (strNode) {
                const path = strNode.text.slice(1, -1);
                const parent = node.parent;
                const names: string[] = [];
                if (parent?.type === 'variable_declarator') {
                  const id = this.findNamedChild(parent, 'identifier');
                  if (id) names.push(id.text);
                }
                imports.push({ source: path, names: names.length > 0 ? names : [path], type: 'default', lineNumber: node.startPosition.row + 1 });
              }
            }
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    if (node.type === 'export_statement') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'export_clause') {
          for (let j = 0; j < child.childCount; j++) {
            const spec = child.child(j);
            if (spec.type === 'export_specifier') {
              const id = this.findNamedChild(spec, 'identifier');
              if (id?.text === symbolName) return true;
            }
          }
        }
        if (child.type === 'function_declaration' || child.type === 'class_declaration') {
          const id = this.findNamedChild(child, 'identifier');
          if (id?.text === symbolName) return true;
        }
      }
      return false;
    }

    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }
    return false;
  }

  // Fallbacks
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const funcRegex = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: this.lineOff(source, m.index), endLine: this.lineOff(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const arrRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
    while ((m = arrRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: this.lineOff(source, m.index), endLine: this.lineOff(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { arrow: 'true', filePath } });
    }
    const clRegex = /(?:export\s+(?:default\s+)?)?class\s+(\w+)/g;
    while ((m = clRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `class ${m[1]!}`, startLine: this.lineOff(source, m.index), endLine: this.lineOff(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const vrRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=(?![^=]*=>)/g;
    while ((m = vrRegex.exec(source)) !== null) {
      captures.push({ tag: m[0].includes('const') ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: this.lineOff(source, m.index), endLine: this.lineOff(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const imps = this.fallbackExtractImports(source);
    for (const imp of imps) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: imp.source, startLine: imp.lineNumber, endLine: imp.lineNumber, startByte: 0, endByte: 0, name: imp.source, properties: { names: imp.names.join(','), importType: imp.type, filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const regex = /import\s+(?:(\*)\s+as\s+(\w+)|(\{[\s\S]*?\})|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(source)) !== null) {
      const p = m[5]!, l = this.lineOff(source, m.index);
      if (m[2]) imports.push({ source: p, names: [m[2]], type: 'namespace', lineNumber: l });
      else if (m[3]) {
        const nm: string[] = []; const nr = /(\w+)/g; let n: RegExpExecArray | null;
        while ((n = nr.exec(m[3]))) nm.push(n[1]!);
        imports.push({ source: p, names: nm, type: 'named', lineNumber: l });
      } else if (m[4]) imports.push({ source: p, names: [m[4]], type: 'default', lineNumber: l });
    }
    // require()
    const rqRx = /(?:const|let|var)\s+(?:(\{[\s\S]*?\})|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = rqRx.exec(source)) !== null) {
      const p = m[3]!, l = this.lineOff(source, m.index);
      if (m[1]) {
        const nm: string[] = []; const nr = /(\w+)/g; let n: RegExpExecArray | null;
        while ((n = nr.exec(m[1]))) nm.push(n[1]!);
        imports.push({ source: p, names: nm, type: 'named', lineNumber: l });
      } else if (m[2]) imports.push({ source: p, names: [m[2]], type: 'default', lineNumber: l });
    }
    return imports;
  }

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`module\\.exports\\s*=\\s*${s}\\b|exports\\.${s}\\s*=|export\\s*\\{[^}]*\\b${s}\\b[^}]*\\}|export\\s+default\\s+(?:function|class)\\s+${s}\\b|export\\s+(?:const|let|var|function|class)\\s+${s}\\b`).test(source);
  }

  // Helpers
  private extractExtends(node: TreeSitterSyntaxNode): string {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i).type === 'class_heritage') {
        for (let j = 0; j < node.child(i).childCount; j++) {
          const h = node.child(i).child(j);
          if (h.type === 'extends_clause') {
            const id = this.findDeepChild(h, 'identifier');
            if (id) return id.text;
          }
        }
      }
    }
    return '';
  }

  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  private findDeepChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    if (node.type === type) return node;
    for (let i = 0; i < node.namedChildCount; i++) {
      const r = this.findDeepChild(node.namedChild(i), type);
      if (r) return r;
    }
    return null;
  }

  private lineOff(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
