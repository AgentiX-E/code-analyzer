// @code-analyzer/analyzer — R Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: functions, assignments, S3/S4 classes, pipe operators, library calls.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

export class RProvider extends TreeSitterBaseProvider {
  readonly language = 'r';
  readonly displayName = 'R';
  readonly extensions = ['.r', '.R', '.Rprofile', '.Renviron'];
  readonly globs = ['**/*.r', '**/*.R', '**/.Rprofile', '**/.Renviron'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { const m = require('@eagleoutice/tree-sitter-r') as TreeSitterLanguage; return m; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_definition', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'call', captureTag: CAPTURE_TAGS.FUNCTION_CALL, useFirstNamedChild: true },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    // Function definition: name <- function(args) { ... }
    if (nt === 'function_definition') {
      // Find name from parent assignment
      const parent = node.parent;
      let funcName: string | undefined;
      if (parent && (parent.type === 'binary_operator' || parent.type === 'assignment')) {
        for (let i = 0; i < parent.namedChildCount; i++) {
          const child = parent.namedChild(i);
          if (child.type === 'identifier' && child.text !== 'function') {
            funcName = child.text;
            break;
          }
        }
      }
      if (!funcName) {
        const idNode = this.findNamedChild(node, 'identifier');
        funcName = idNode ? idNode.text : `fn_${node.startPosition.row + 1}`;
      }
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

    // Assignment: name <- value (binary_operator) or name = value
    if (nt === 'binary_operator') {
      // Check if the operator is <-
      let isAssignment = false;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === '<-' || child.type === '=') {
          isAssignment = true;
          break;
        }
      }
      if (isAssignment) {
        // Get the first identifier (left side of assignment)
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'identifier' && child.text !== 'function') {
            // Check if the right side is a function definition
            const rightSide = node.namedChild(node.namedChildCount - 1);
            if (rightSide?.type === 'function_definition') {
              // Function definition capture will be handled by function_definition handler
              break;
            }
            captures.push({
              tag: CAPTURE_TAGS.VARIABLE_DEF,
              text: child.text,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: child.startIndex,
              endByte: child.endIndex,
              name: child.text,
              properties: { filePath: this.filePath },
            });
            break;
          }
        }
      }
    }

    // Call expressions (function calls, library/require)
    if (nt === 'call') {
      const funcName = this.getCallName(node);
      if (funcName) {
        if (funcName === 'library' || funcName === 'require') {
          // Extract package name from arguments
          const args = this.getCallArgs(node);
          const pkgName = args[0]?.replace(/['"]/g, '') ?? funcName;
          captures.push({
            tag: CAPTURE_TAGS.IMPORT,
            text: pkgName,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: node.startIndex,
            endByte: node.endIndex,
            name: pkgName,
            properties: { importType: 'library', filePath: this.filePath },
          });
        } else if (funcName === 'setClass' || funcName === 'setRefClass') {
          const args = this.getCallArgs(node);
          const className = args[0]?.replace(/['"]/g, '') ?? funcName;
          captures.push({
            tag: CAPTURE_TAGS.CLASS_DEF,
            text: className,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: node.startIndex,
            endByte: node.endIndex,
            name: className,
            properties: { s4class: 'true', filePath: this.filePath },
          });
        } else {
          captures.push({
            tag: CAPTURE_TAGS.FUNCTION_CALL,
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
    }

    // Pipe operator: %>%
    if (nt === 'special') {
      if (node.text === '%>%' || node.text === '|>') {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_CALL,
          text: 'pipe',
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: 'pipe',
          properties: { pipeOperator: node.text, filePath: this.filePath },
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private getCallName(node: TreeSitterSyntaxNode): string | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'identifier') return child.text;
      if (child.type === 'namespace_get') {
        // pkg::func()
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);
          if (sub.type === 'identifier') return sub.text;
        }
      }
    }
    return undefined;
  }

  private getCallArgs(node: TreeSitterSyntaxNode): string[] {
    const args: string[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'arguments') {
        for (let j = 0; j < child.childCount; j++) {
          const arg = child.child(j);
          if (arg.type === 'argument') {
            // Recurse into argument to find the actual value
            for (let k = 0; k < arg.childCount; k++) {
              const sub = arg.child(k);
              if (sub.type === 'identifier') { args.push(sub.text); }
              else if (sub.type === 'string') {
                let t = sub.text;
                if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
                  t = t.slice(1, -1);
                }
                args.push(t);
              }
            }
            // If argument has no children, use its text
            if (arg.childCount === 0) args.push(arg.text);
          } else if (arg.type === 'identifier') {
            args.push(arg.text);
          } else if (arg.type === 'string') {
            let t = arg.text;
            if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
              t = t.slice(1, -1);
            }
            args.push(t);
          }
        }
      }
    }
    return args;
  }

  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'call') {
      const funcName = this.getCallName(node);
      if (funcName === 'library' || funcName === 'require') {
        const args = this.getCallArgs(node);
        const pkg = args[0]?.replace(/['"]/g, '') ?? funcName;
        imports.push({ source: pkg, names: [pkg], type: 'named', lineNumber: node.startPosition.row + 1 });
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(_node: TreeSitterSyntaxNode, _symbolName: string): boolean {
    return true; // R functions are globally visible by default
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const funcRegex = /(\w+)\s*<-\s*function\s*\(/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const varRegex = /(\w+)\s*<-\s*[^(]/g;
    while ((m = varRegex.exec(source)) !== null) {
      if (['if', 'else', 'for', 'while', 'function', 'return', 'library', 'require'].includes(m[1]!)) continue;
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const classRegex = /setClass\s*\(\s*["'](\w+)["']/g;
    while ((m = classRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const libRegex = /(?:library|require)\s*\(\s*["']?(\w+)["']?\s*\)/g;
    while ((m = libRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'library', filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const libRegex = /(?:library|require)\s*\(\s*["']?(\w+)["']?\s*\)/g;
    while ((m = libRegex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!], type: 'named', lineNumber: ln(m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, _symbolName: string): boolean {
    return true;
  }
}
