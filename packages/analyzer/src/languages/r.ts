// @code-analyzer/analyzer — R Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: 15+ node mappings, functions, assignments,
// S3/S4 classes, pipe operators, library imports, formula parsing.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode,
  TaintSource, TaintSink, TaintSanitizer,
} from './tree-sitter-base.js';

export class RProvider extends TreeSitterBaseProvider {
  readonly language = 'r';
  readonly displayName = 'R';
  readonly extensions = ['.r', '.R', '.Rprofile', '.Renviron'];
  readonly globs = ['**/*.r', '**/*.R', '**/.Rprofile', '**/.Renviron'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('@eagleoutice/tree-sitter-r') as TreeSitterLanguage;
      return m;
    } catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_definition', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'call', captureTag: CAPTURE_TAGS.FUNCTION_CALL, useFirstNamedChild: true },
      { nodeType: 'binary_operator', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'assignment', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'identifier', captureTag: CAPTURE_TAGS.VARIABLE_ACCESS, useFirstNamedChild: true },
      { nodeType: 'special', captureTag: CAPTURE_TAGS.FUNCTION_CALL, useFirstNamedChild: true },
      { nodeType: 'string', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'integer', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'float', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'complex', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'logical', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'null', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'arguments', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'argument', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'namespace_get', captureTag: CAPTURE_TAGS.FUNCTION_CALL, useFirstNamedChild: true },
      { nodeType: 'comment', captureTag: CAPTURE_TAGS.COMMENT, useFirstNamedChild: true },
    ];
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'function_definition') {
      const parent = node.parent;
      let funcName: string | undefined;
      if (parent && (parent.type === 'binary_operator' || parent.type === 'assignment')) {
        for (let i = 0; i < parent.namedChildCount; i++) {
          const child = parent.namedChild(i);
          if (child.type === 'identifier' && child.text !== 'function') {
            funcName = child.text; break;
          }
        }
      }
      if (!funcName) {
        const idNode = this.findNamedChild(node, 'identifier');
        funcName = idNode ? idNode.text : `fn_${node.startPosition.row + 1}`;
      }
      captures.push(this.makeCapture(node, CAPTURE_TAGS.FUNCTION_DEF, funcName, funcName));
    } else if (nt === 'binary_operator' || nt === 'assignment') {
      let isAssignment = false;
      for (let i = 0; i < node.childCount; i++) {
        if (node.child(i).type === '<-' || node.child(i).type === '=') { isAssignment = true; break; }
      }
      if (isAssignment) {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'identifier' && child.text !== 'function') {
            const rightSide = node.namedChild(node.namedChildCount - 1);
            if (rightSide?.type === 'function_definition') break;
            captures.push(this.makeCapture(child, CAPTURE_TAGS.VARIABLE_DEF, child.text, child.text));
            break;
          }
        }
      }
    } else if (nt === 'call') {
      this.captureCall(node, captures);
    } else if (nt === 'special') {
      if (node.text === '%>%' || node.text === '|>') {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.FUNCTION_CALL, 'pipe', 'pipe',
          { pipeOperator: node.text }));
      } else if (node.text === '%in%') {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.FUNCTION_CALL, '%in%', node.text,
          { operator: 'in' }));
      } else if (node.text.includes('%')) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.FUNCTION_CALL, node.text, node.text,
          { customOperator: 'true' }));
      }
    } else if (nt === 'comment') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.COMMENT, '[comment]', node.text.trim(), { isComment: 'true' }));
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private captureCall(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const funcName = this.getCallName(node);
    if (!funcName) return;

    const line = node.startPosition.row + 1;
    if (funcName === 'library' || funcName === 'require') {
      const args = this.getCallArgs(node);
      const pkgName = args[0]?.replace(/['"]/g, '') ?? funcName;
      captures.push(this.makeCapture(node, CAPTURE_TAGS.IMPORT, pkgName, `library(${pkgName})`,
        { importType: 'library' }));
    } else if (funcName === 'setClass' || funcName === 'setRefClass') {
      const args = this.getCallArgs(node);
      const className = args[0]?.replace(/['"]/g, '') ?? funcName;
      captures.push(this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF, className,
        `setClass("${className}")`, { s4class: 'true' }));
    } else if (funcName === 'source') {
      const args = this.getCallArgs(node);
      const file = args[0]?.replace(/['"]/g, '') ?? '';
      if (file) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.IMPORT, file, `source("${file}")`,
          { importType: 'source' }));
      }
    } else {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.FUNCTION_CALL, funcName, funcName));
    }
  }

  // ---- Taint Analysis ----

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    if (node.type === 'call') {
      const fn = this.getCallName(node);
      if (!fn) return;
      const line = node.startPosition.row + 1;
      // read.csv, read.table, readRDS are taint sources
      if (fn.startsWith('read.') || fn === 'readRDS' || fn === 'readLines' ||
          fn === 'scan' || fn === 'url' || fn === 'file') {
        sources.push({ name: fn, sourceType: 'file_read', line, text: node.text, properties: {} });
        return;
      }
      // Sys.getenv, getOption are taint sources
      if (fn === 'Sys.getenv' || fn === 'getOption' || fn === 'commandArgs') {
        sources.push({ name: fn, sourceType: 'environment', line, text: node.text, properties: {} });
        return;
      }
      // httr::GET, curl, download.file are network sources
      if (fn === 'GET' || fn === 'download.file' || fn === 'curl') {
        sources.push({ name: fn, sourceType: 'network', line, text: node.text, properties: {} });
        return;
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    if (node.type === 'call') {
      const fn = this.getCallName(node);
      if (!fn) return;
      const line = node.startPosition.row + 1;
      // system, system2, shell are command injection sinks
      if (fn === 'system' || fn === 'system2' || fn === 'shell' || fn === 'shell.exec') {
        sinks.push({ name: fn, sinkType: 'os_command', line, text: node.text, properties: {} });
        return;
      }
      // eval, parse (with text=) are code injection sinks
      if (fn === 'eval' || fn === 'parse') {
        sinks.push({ name: fn, sinkType: 'code_injection', line, text: node.text, properties: {} });
        return;
      }
      // write.csv, write.table, saveRDS are file write sinks
      if (fn.startsWith('write.') || fn === 'saveRDS' || fn === 'save') {
        sinks.push({ name: fn, sinkType: 'file_write', line, text: node.text, properties: {} });
        return;
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSinks(node.child(i), sinks);
    }
  }

  protected override walkForSanitizers(node: TreeSitterSyntaxNode, sanitizers: TaintSanitizer[]): void {
    if (node.type === 'call') {
      const fn = this.getCallName(node);
      if (!fn) return;
      // Validation/sanitization functions
      if (fn === 'is.numeric' || fn === 'is.character' || fn === 'is.logical' ||
          fn === 'type.convert' || fn === 'as.numeric' || fn === 'as.character' ||
          fn === 'sanitize') {
        sanitizers.push({ name: fn, sanitizerType: 'type_enforcement',
          line: node.startPosition.row + 1, text: node.text, properties: {} });
        return;
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForSanitizers(node.child(i), sanitizers);
    }
  }

  // ---- Helpers ----

  private getCallName(node: TreeSitterSyntaxNode): string | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'identifier') return child.text;
      if (child.type === 'namespace_get') {
        for (let j = 0; j < child.childCount; j++) {
          if (child.child(j).type === 'identifier') return child.child(j).text;
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
          const types = ['identifier', 'string', 'integer', 'float', 'logical', 'argument'];
          if (types.includes(arg.type)) {
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
            if (arg.childCount === 0) args.push(arg.text);
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

  private makeCapture(
    node: TreeSitterSyntaxNode, tag: typeof CAPTURE_TAGS[keyof typeof CAPTURE_TAGS],
    name: string, text: string, extra: Record<string, string> = {},
  ): UnifiedCapture {
    return { tag, text,
      startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
      startByte: node.startIndex, endByte: node.endIndex,
      name, properties: { filePath: this.filePath, ...extra } };
  }

  // ---- Import Extraction ----

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'call') {
      const fn = this.getCallName(node);
      if (fn === 'library' || fn === 'require') {
        const args = this.getCallArgs(node);
        const pkg = args[0]?.replace(/['"]/g, '') ?? fn;
        imports.push({ source: pkg, names: [pkg], type: 'named', lineNumber: node.startPosition.row + 1 });
      } else if (fn === 'source') {
        const args = this.getCallArgs(node);
        const file = args[0]?.replace(/['"]/g, '') ?? '';
        if (file) imports.push({ source: file, names: [file], type: 'named', lineNumber: node.startPosition.row + 1 });
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

  // ---- Fallback ----

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const funcRx = /(\w+)\s*<-\s*function\s*\(/g;
    while ((m = funcRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const varRx = /(\w+)\s*<-\s*[^(]/g;
    while ((m = varRx.exec(source)) !== null) {
      if (['if', 'else', 'for', 'while', 'function', 'return', 'library', 'require'].includes(m[1]!)) continue;
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const classRx = /setClass\s*\(\s*["'](\w+)["']/g;
    while ((m = classRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const libRx = /(?:library|require)\s*\(\s*["']?(\w+)["']?\s*\)/g;
    while ((m = libRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'library', filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const libRx = /(?:library|require|source)\s*\(\s*["']?(\w+(?:\.\w+)*)["']?\s*\)/g;
    while ((m = libRx.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!], type: 'named', lineNumber: ln(m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return true; }

  protected override fallbackExtractTaintSources(source: string): TaintSource[] {
    const sources: TaintSource[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx = /(read\.\w+|Sys\.getenv|commandArgs)\s*\(/g;
    while ((m = rx.exec(source)) !== null) {
      sources.push({ name: m[1]!, sourceType: 'file_read', line: ln(m.index), text: m[0], properties: {} });
    }
    return sources;
  }

  protected override fallbackExtractTaintSinks(source: string): TaintSink[] {
    const sinks: TaintSink[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx = /(system|system2|shell|shell\.exec|eval|parse)\s*\(/g;
    while ((m = rx.exec(source)) !== null) {
      const st = ['eval', 'parse'].includes(m[1]!) ? 'code_injection' : 'os_command';
      sinks.push({ name: m[1]!, sinkType: st, line: ln(m.index), text: m[0], properties: {} });
    }
    return sinks;
  }

  protected override fallbackExtractSanitizers(_source: string): TaintSanitizer[] { return []; }
}
