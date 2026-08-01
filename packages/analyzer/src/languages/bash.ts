// @code-analyzer/analyzer — Bash/Shell Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: functions, variables, conditionals, loops, heredocs, source imports.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

export class BashProvider extends TreeSitterBaseProvider {
  readonly language = 'bash';
  readonly displayName = 'Bash/Shell';
  readonly extensions = ['.sh', '.bash', '.zsh', '.ksh'];
  readonly globs = ['**/*.sh', '**/*.bash', '**/*.zsh', '**/*.ksh'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { const m = require('tree-sitter-bash') as TreeSitterLanguage; return m; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_definition', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'word' },
      { nodeType: 'variable_assignment', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'variable_name' },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    // Function definition: function_name() { ... } or function name { ... }
    if (nt === 'function_definition') {
      let funcName = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'word') { funcName = child.text; break; }
      }
      if (funcName) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_DEF,
          text: funcName,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: funcName,
          properties: { filePath: this.filePath },
        });
      }
    }

    // Variable assignment: NAME=VALUE or export NAME=VALUE
    if (nt === 'variable_assignment') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'variable_name') {
          captures.push({
            tag: CAPTURE_TAGS.VARIABLE_DEF,
            text: child.text,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: child.startIndex,
            endByte: child.endIndex,
            name: child.text,
            properties: { filePath: this.filePath },
          });
        }
      }
    }

    // Command: any shell command (detect calls to other scripts/functions)
    if (nt === 'command') {
      const cmdName = this.getCommandName(node);
      if (cmdName && !['if', 'for', 'while', 'case', 'echo', 'cd', 'exit', 'return', 'export', 'local', 'readonly', 'declare', 'unset', 'alias'].includes(cmdName)) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_CALL,
          text: cmdName,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: cmdName,
          properties: { filePath: this.filePath },
        });
      }
    }

    // Source/include: source file.sh or . file.sh
    if (nt === 'command') {
      const cmdName = this.getCommandName(node);
      if (cmdName === 'source' || cmdName === '.') {
        // Find the argument (file path)
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'word' && child.text !== 'source' && child.text !== '.') {
            captures.push({
              tag: CAPTURE_TAGS.IMPORT,
              text: child.text,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startByte: child.startIndex,
              endByte: child.endIndex,
              name: child.text,
              properties: { importType: 'source', filePath: this.filePath },
            });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private getCommandName(node: TreeSitterSyntaxNode): string | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'command_name') {
        // command_name may contain 'word' or 'variable_name'
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);
          if (sub.type === 'word') return sub.text;
        }
        return child.text;
      }
      if (child.type === 'word') {
        return child.text;
      }
    }
    return undefined;
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'command') {
      const cmdName = this.getCommandName(node);
      if (cmdName === 'source' || cmdName === '.') {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'word' && child.text !== 'source' && child.text !== '.') {
            imports.push({ source: child.text, names: [child.text], type: 'named', lineNumber: node.startPosition.row + 1 });
          }
        }
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(_node: TreeSitterSyntaxNode, _symbolName: string): boolean {
    return true; // Shell functions are globally visible
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const funcRegex = /(?:function\s+)?(\w+)\s*\(\s*\)\s*\{/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const varRegex = /(?:export\s+|local\s+|readonly\s+)?(\w+)=/g;
    while ((m = varRegex.exec(source)) !== null) {
      if (['if', 'for', 'while', 'case', 'select', 'do', 'done', 'then', 'else', 'fi'].includes(m[1]!)) continue;
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const srcRegex = /(?:source|\.)\s+["']?([\w./-]+)["']?/g;
    while ((m = srcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'source', filePath } });
    }
    const pipeRegex = /(\w+)\s*\|/g;
    while ((m = pipeRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_CALL, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const srcRegex = /(?:source|\.)\s+["']?([\w./-]+)["']?/g;
    while ((m = srcRegex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!], type: 'named', lineNumber: ln(m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, _symbolName: string): boolean {
    return true;
  }
}
