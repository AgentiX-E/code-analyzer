// @code-analyzer/analyzer — Python Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const pyExtensions = ['.py', '.pyi', '.pyx', '.pxd'];
const pyGlobs = ['**/*.py', '**/*.pyi', '**/*.pyx', '**/*.pxd'];

export class PythonProvider extends TreeSitterBaseProvider {
  readonly language = 'python';
  readonly displayName = 'Python';
  readonly extensions = pyExtensions;
  readonly globs = pyGlobs;
  readonly importSemantics = 'wildcard-leaf' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const py = require('tree-sitter-python') as { python: TreeSitterLanguage };
      return py.python || (py as unknown as TreeSitterLanguage);
    } catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_definition', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'class_definition', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'identifier' },
      { nodeType: 'decorated_definition', captureTag: CAPTURE_TAGS.DECORATOR, useFirstNamedChild: true },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_definition') {
      const nameNode = this.findNamedChild(node, 'identifier');
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'class_definition') {
      const nameNode = this.findNamedChild(node, 'identifier');
      if (nameNode) {
        // Extract base classes
        let baseClasses = '';
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'argument_list') {
            const bases: string[] = [];
            for (let j = 0; j < child.childCount; j++) {
              const arg = child.child(j);
              if (arg.type === 'identifier') bases.push(arg.text);
            }
            baseClasses = bases.join(',');
            break;
          }
        }
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
    } else if (nodeType === 'decorated_definition') {
      // Extract decorators
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'decorator') {
          const called = this.findNamedChild(child, 'call');
          let text = '@';
          if (called) {
            const func = this.findNamedChild(called, 'identifier') || this.findNamedChild(called, 'attribute');
            text += called.text;
            const name = func ? func.text : called.text.split('(')[0];
            captures.push({
              tag: CAPTURE_TAGS.DECORATOR,
              text,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: child.startIndex,
              endByte: child.endIndex,
              name,
              properties: { decorator: name!, filePath: this.filePath },
            });
          } else {
            const id = this.findNamedChild(child, 'identifier') || this.findNamedChild(child, 'attribute');
            if (id) {
              captures.push({
                tag: CAPTURE_TAGS.DECORATOR,
                text: id.text,
                startLine: child.startPosition.row + 1,
                endLine: child.endPosition.row + 1,
                startByte: child.startIndex,
                endByte: child.endIndex,
                name: id.text,
                properties: { decorator: id.text, filePath: this.filePath },
              });
            }
          }
        }
      }
      // Still process the inner definition
      for (let i = 0; i < node.childCount; i++) {
        this.walkAndCapture(node.child(i), captures);
      }
      return;
    } else if (nodeType === 'import_statement') {
      let sourceName = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'dotted_name') {
          sourceName = child.text;
        } else if (child.type === 'aliased_import') {
          const id = this.findNamedChild(child, 'identifier');
          if (id) sourceName = id.text;
        }
      }
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: sourceName,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: sourceName,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'import_from_statement') {
      let sourceName = '';
      const fromNode = this.findNamedChild(node, 'dotted_name');
      if (fromNode) sourceName = fromNode.text;
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: sourceName,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: sourceName,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'expression_statement') {
      // Check for triple-quoted string (docstring)
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'string') {
          const text = child.text;
          if ((text.startsWith('"""') || text.startsWith("'''")) && text.length > 5) {
            captures.push({
              tag: CAPTURE_TAGS.DOCSTRING,
              text,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: child.startIndex,
              endByte: child.endIndex,
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
    if (node.type === 'import_statement') {
      const line = node.startPosition.row + 1;
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'dotted_name') {
          imports.push({ source: child.text, names: [child.text], type: 'named', lineNumber: line });
        } else if (child.type === 'aliased_import') {
          const alias = this.findNamedChild(child, 'identifier');
          const name = alias ? alias.text : child.text;
          imports.push({ source: name, names: [name], type: 'namespace', lineNumber: line });
        }
      }
      return;
    }

    if (node.type === 'import_from_statement') {
      const line = node.startPosition.row + 1;
      const fromNode = this.findNamedChild(node, 'dotted_name');
      const source = fromNode ? fromNode.text : '';
      const names: string[] = [];
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'dotted_name' && !fromNode) continue;
        if (child.type === 'aliased_import') {
          const id = this.findNamedChild(child, 'identifier');
          if (id) names.push(id.text);
        } else if (child.type === 'dotted_name' && fromNode && child !== fromNode) {
          names.push(child.text);
        }
      }
      if (source) {
        imports.push({ source, names: names.length > 0 ? names : [source], type: 'named', lineNumber: line });
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(_node: TreeSitterSyntaxNode, symbolName: string): boolean {
    // Python: public unless prefixed with single underscore (not dunder)
    if (symbolName.startsWith('_') && !symbolName.startsWith('__')) return false;
    // Check __all__
    if (this.source.includes('__all__')) {
      const match = this.source.match(/__all__\s*=\s*\[([\s\S]*?)\]/);
      if (match) {
        const items = match[1]!.split(',').map((s) => s.trim().replace(/['"]/g, ''));
        return items.includes(symbolName);
      }
    }
    return true;
  }

  // Fallback
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const funcRegex = /(?:async\s+)?def\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const clsRegex = /class\s+(\w+)/g;
    while ((m = clsRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `class ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const decRegex = /@(\w+(?:\.\w+)*)/g;
    while ((m = decRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.DECORATOR, text: m[0], startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { decorator: m[1]!, filePath } });
    }
    const docRegex = /("""|''')[\s\S]*?\1/g;
    while ((m = docRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.DOCSTRING, text: m[0], startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, properties: { filePath } });
    }
    const imps = this.fallbackExtractImports(source);
    for (const imp of imps) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: imp.source, startLine: imp.lineNumber, endLine: imp.lineNumber, startByte: 0, endByte: 0, name: imp.source, properties: { names: imp.names.join(','), importType: imp.type, filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const fromRegex = /from\s+([\w.]+)\s+import\s+([\w\s,]+)/g;
    while ((m = fromRegex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: m[2]!.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!).filter(Boolean), type: 'named', lineNumber: this.ln(source, m.index) });
    }
    const impRegex = /^import\s+([\w\s,.]+?)(?:\s+#.*)?$/gm;
    while ((m = impRegex.exec(source)) !== null) {
      for (const mod of m[1]!.split(',')) {
        const parts = mod.trim().split(/\s+as\s+/);
        imports.push({ source: parts[0]!.trim(), names: [parts[1]?.trim() ?? parts[0]!.trim()], type: parts.length > 1 ? 'namespace' : 'named', lineNumber: this.ln(source, m.index) });
      }
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, symbolName: string): boolean {
    if (symbolName.startsWith('_') && !symbolName.startsWith('__')) return false;
    const allMatch = this.source.match(/__all__\s*=\s*\[([\s\S]*?)\]/);
    if (allMatch) {
      return allMatch[1]!.split(',').map((s) => s.trim().replace(/['"]/g, '')).includes(symbolName);
    }
    return true;
  }

  // Helpers
  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
