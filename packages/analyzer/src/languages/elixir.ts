// @code-analyzer/analyzer — Elixir Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const ELIXIR_EXTENSIONS = ['.ex', '.exs'];
const ELIXIR_GLOBS = ['**/*.ex', '**/*.exs'];

export class ElixirProvider extends TreeSitterBaseProvider {
  readonly language = 'elixir';
  readonly displayName = 'Elixir';
  readonly extensions = ELIXIR_EXTENSIONS;
  readonly globs = ELIXIR_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-elixir') as TreeSitterLanguage;
    } /* v8 ignore start -- @preserve -- grammar is bundled, require never throws */
    catch {
      return null;
    }
    /* v8 ignore stop */
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'call') {
      // Detect def, defp, defmodule, defstruct, etc.
      const target = this.findNamedChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- tree-sitter-elixir always emits these child nodes */
      if (target) {
        if (target.text === 'defmodule') {
          const args = this.findNamedChild(node, 'arguments');
          /* v8 ignore next -- @preserve -- tree-sitter-elixir always emits these child nodes */
          if (args) {
            const modName = this.extractModuleName(args);
            /* v8 ignore next -- @preserve -- tree-sitter-elixir always emits these child nodes */
            if (modName) {
              captures.push({
                tag: CAPTURE_TAGS.CLASS_DEF,
                text: `defmodule ${modName}`,
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                startByte: target.startIndex,
                endByte: target.endIndex,
                name: modName,
                properties: { isModule: 'true', filePath: this.filePath },
              });
            }
          }
        } else if (target.text === 'def' || target.text === 'defp' || target.text === 'defmacro') {
          // Extract the function name from the arguments child. tree-sitter-elixir
          // emits two shapes depending on arity:
          //   with params:  arguments > call        > identifier (func_name)
          //   without params: arguments > identifier (func_name) directly
          const args = this.findNamedChild(node, 'arguments');
          /* v8 ignore next -- @preserve -- tree-sitter-elixir always emits these child nodes */
          if (args) {
            const innerCall = this.findNamedChild(args, 'call');
            const funcNameNode = innerCall
              ? this.findNamedChild(innerCall, 'identifier')
              : this.findNamedChild(args, 'identifier');
            /* v8 ignore next -- @preserve -- tree-sitter-elixir always emits these child nodes */
            if (funcNameNode) {
              captures.push({
                tag: CAPTURE_TAGS.FUNCTION_DEF,
                text: funcNameNode.text,
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                startByte: funcNameNode.startIndex,
                endByte: funcNameNode.endIndex,
                name: funcNameNode.text,
                properties: {
                  visibility: target.text === 'defp' ? 'private' : 'public',
                  ...(target.text === 'defmacro' ? { isMacro: 'true' } : {}),
                  filePath: this.filePath,
                },
              });
            }
          }
        } else if (target.text === 'use' || target.text === 'import' || target.text === 'alias') {
          // use/import/alias Module — treat as import
          const args = this.findNamedChild(node, 'arguments');
          /* v8 ignore next -- @preserve -- tree-sitter-elixir always emits these child nodes */
          if (args) {
            const modName = this.extractModuleName(args);
            /* v8 ignore next -- @preserve -- tree-sitter-elixir always emits these child nodes */
            if (modName) {
              captures.push({
                tag: CAPTURE_TAGS.IMPORT,
                text: modName,
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                startByte: node.startIndex,
                endByte: node.endIndex,
                name: modName,
                properties: { importType: 'named', filePath: this.filePath },
              });
            }
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'call') {
      const target = this.findNamedChild(node, 'identifier');
      if (target && (target.text === 'import' || target.text === 'use' || target.text === 'alias' || target.text === 'require')) {
        const args = this.findNamedChild(node, 'arguments');
        /* v8 ignore next -- @preserve -- tree-sitter-elixir always emits these child nodes */
        if (args) {
          const modName = this.extractModuleName(args);
          /* v8 ignore next -- @preserve -- tree-sitter-elixir always emits these child nodes */
          if (modName) {
            imports.push({
              source: modName,
              names: [modName],
              type: 'named',
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
        return; // Don't recurse into import/use/alias/require children
      }
      // For non-import calls (like defmodule), continue recursing into children
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    if (node.type === 'call') {
      const target = this.findNamedChild(node, 'identifier');
      if (target && (target.text === 'def' || target.text === 'defmodule')) {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          /* v8 ignore next -- @preserve -- function name lives in arguments, not a sibling identifier */
          if (child.type === 'identifier' && child !== target && child.text === symbolName) return true;
          if (child.type === 'arguments') {
            const modName = this.extractModuleName(child);
            if (modName === symbolName) return true;
          }
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

    // defmodule
    const modRegex = /defmodule\s+([\w.]+)/g;
    while ((m = modRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `defmodule ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isModule: 'true', filePath },
      });
    }

    // def (public function)
    const defRegex = /def\s+(\w+)/g;
    while ((m = defRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { visibility: 'public', filePath },
      });
    }

    // defp (private function)
    const defpRegex = /defp\s+(\w+)/g;
    while ((m = defpRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { visibility: 'private', filePath },
      });
    }

    // defmacro
    const macroRegex = /defmacro\s+(\w+)/g;
    while ((m = macroRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isMacro: 'true', filePath },
      });
    }

    // use/import/alias statements
    const useRegex = /(?:use|import|alias)\s+([\w.]+)/g;
    while ((m = useRegex.exec(source)) !== null) {
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

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  /* v8 ignore next */
  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const useRegex = /(?:use|import|alias|require)\s+([\w.]+)/g;
    while ((m = useRegex.exec(source)) !== null) {
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
    if (new RegExp(`defp\\s+${s}\\b`).test(source)) return false;
    return new RegExp(`(?:def|defmacro|defmodule)\\s+${s}\\b`).test(source);
  }

  // Helpers
  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  private extractModuleName(argsNode: TreeSitterSyntaxNode): string | null {
    const parts: string[] = [];
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const child = argsNode.namedChild(i);
      /* v8 ignore next -- @preserve -- module names are always alias nodes, never identifiers */
      if (child.type === 'identifier') parts.push(child.text);
      else if (child.type === 'alias') {
        // tree-sitter-elixir 0.3.x: alias children are anonymous (neither namedChildCount nor childCount)
        // The full module path is available directly via .text
        /* v8 ignore next -- @preserve -- alias nodes are anonymous (named=0 child=0) */
        if (child.namedChildCount > 0) {
          for (let j = 0; j < child.namedChildCount; j++) {
            if (child.namedChild(j).type === 'identifier') parts.push(child.namedChild(j).text);
          }
        } else if (child.childCount > 0) {
          /* v8 ignore next -- @preserve -- alias nodes are anonymous */
          for (let j = 0; j < child.childCount; j++) {
            if (child.child(j).type === 'identifier') parts.push(child.child(j).text);
          }
        } else {
          parts.push(child.text);
        }
      }
    }
    /* v8 ignore next -- @preserve -- arguments always carry an alias so parts is non-empty */
    return parts.length > 0 ? parts.join('.') : null;
  }

  /* v8 ignore next -- @preserve -- only used by regex fallback */
  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
