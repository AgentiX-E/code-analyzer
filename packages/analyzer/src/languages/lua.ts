// @code-analyzer/analyzer — Lua Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const LUA_EXTENSIONS = ['.lua'];
const LUA_GLOBS = ['**/*.lua'];

export class LuaProvider extends TreeSitterBaseProvider {
  readonly language = 'lua';
  readonly displayName = 'Lua';
  readonly extensions = LUA_EXTENSIONS;
  readonly globs = LUA_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-lua') as TreeSitterLanguage;
    } /* v8 ignore next */
    catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_statement', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'variable_declaration', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'identifier' },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_statement' || nodeType === 'local_function_statement') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'identifier' || child.type === 'dot_index_expression' ||
            child.type === 'method_index_expression') {
          const name = child.type === 'identifier' ? child.text : this.extractCompoundName(child);
          if (name) {
            const isLocal = (nodeType as string) === 'local_function_statement' || (nodeType as string) === 'local_variable_declaration';
            captures.push({
              tag: CAPTURE_TAGS.FUNCTION_DEF,
              text: name,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startByte: child.startIndex,
              endByte: child.endIndex,
              name,
              properties: { isLocal: String(isLocal), filePath: this.filePath },
            });
          }
          break;
        }
      }
    } else if (nodeType === 'function_call') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'identifier') {
          captures.push({
            tag: CAPTURE_TAGS.FUNCTION_CALL,
            text: child.text,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: child.startIndex,
            endByte: child.endIndex,
            name: child.text,
            properties: { filePath: this.filePath },
          });
          break;
        }
      }
    } else if (nodeType === 'require_call' || nodeType === 'function_call') {
      // Detect require("module") as imports
      const firstNamed = node.namedChild(0);
      if (firstNamed && firstNamed.type === 'identifier' && firstNamed.text === 'require') {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'string') {
            const path = child.text.replace(/^["']|["']$/g, '');
            captures.push({
              tag: CAPTURE_TAGS.IMPORT,
              text: path,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startByte: child.startIndex,
              endByte: child.endIndex,
              name: path,
              properties: { filePath: this.filePath },
            });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'function_call') {
      const firstNamed = node.namedChild(0);
      if (firstNamed && firstNamed.type === 'identifier' && firstNamed.text === 'require') {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'string') {
            const path = child.text.replace(/^["']|["']$/g, '');
            imports.push({
              source: path,
              names: [path.split('.').pop() ?? path],
              type: 'named',
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    if (node.type === 'function_statement' || node.type === 'local_function_statement') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        const name = child.type === 'identifier' ? child.text : this.extractCompoundName(child);
        if (name === symbolName) {
          return node.type !== 'local_function_statement';
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }
    return false;
  }

  // Fallbacks
  /* v8 ignore next */
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Function definitions: function name(...) or local function name(...)
    const funcRegex = /(?:local\s+)?function\s+([\w:.]+)\s*\(/g;
    while ((m = funcRegex.exec(source)) !== null) {
      const isLocal = source.slice(m.index, m.index + m[0].length).includes('local');
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isLocal: String(isLocal), filePath },
      });
    }

    // Table-based function: function table.method(...) or function table:method(...)
    const tableFuncRegex = /function\s+([\w.]+)[.:](\w+)\s*\(/g;
    while ((m = tableFuncRegex.exec(source)) !== null) {
      const fullName = `${m[1]!}.${m[2]!}`;
      captures.push({
        tag: CAPTURE_TAGS.METHOD_DEF,
        text: fullName,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: fullName,
        containerName: m[1]!,
        properties: { filePath },
      });
    }

    // Require statements
    const requireRegex = /require\s*\(?\s*["']([^"']+)["']\s*\)?/g;
    while ((m = requireRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { importType: 'named', filePath },
      });
    }

    // Variable assignments: local name = value
    const localVarRegex = /local\s+(\w+)\s*=/g;
    while ((m = localVarRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isLocal: 'true', filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  /* v8 ignore next */
  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const requireRegex = /require\s*\(?\s*["']([^"']+)["']\s*\)?/g;
    while ((m = requireRegex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  /* v8 ignore next */
  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`local\\s+function\\s+${s}\\b`).test(source)) return false;
    return new RegExp(`function\\s+${s}\\b`).test(source);
  }

  // Helpers
  private extractCompoundName(node: TreeSitterSyntaxNode): string | null {
    const parts: string[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'identifier') parts.push(child.text);
      else if (child.type === 'string') parts.push(child.text.replace(/^["']|["']$/g, ''));
    }
    return parts.length > 0 ? parts.join('.') : null;
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
