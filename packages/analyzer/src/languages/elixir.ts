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
    } catch {
      /* v8 ignore next -- @preserve -- grammar is bundled, require never throws */
      return null;
    }
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    if (node.type === 'call') {
      // Detect def, defp, defmacro, defmodule, use, import, alias. A remote or
      // anonymous call (`String.upcase("x")`, `(fn -> 0 end).()`) has no direct
      // `identifier` child, so `target` is null and the node is skipped.
      const target = this.findNamedChild(node, 'identifier');
      if (target) {
        if (target.text === 'defmodule') {
          const args = this.findNamedChild(node, 'arguments')!;
          const modName = this.extractModuleName(args);
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
        } else if (target.text === 'def' || target.text === 'defp' || target.text === 'defmacro') {
          // Extract the function name from the arguments child. tree-sitter-elixir
          // emits four shapes (see findFunctionName). Operator definitions such as
          // `def a + b` carry no plain name and are intentionally skipped.
          const args = this.findNamedChild(node, 'arguments')!;
          const funcNameNode = this.findFunctionName(args);
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
        } else if (target.text === 'use' || target.text === 'import' || target.text === 'alias') {
          // use/import/alias Module — treat as import. A dotted multi-alias or a
          // quoted/atom module (`alias Foo.{A, B}`, `use :foo`) yields no clean
          // module name and is skipped.
          const args = this.findNamedChild(node, 'arguments')!;
          const modName = this.extractModuleName(args);
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

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'call') {
      const target = this.findNamedChild(node, 'identifier');
      if (
        target &&
        (target.text === 'import' ||
          target.text === 'use' ||
          target.text === 'alias' ||
          target.text === 'require')
      ) {
        const args = this.findNamedChild(node, 'arguments')!;
        const modName = this.extractModuleName(args);
        if (modName) {
          imports.push({
            source: modName,
            names: [modName],
            type: 'named',
            lineNumber: node.startPosition.row + 1,
          });
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
      if (target) {
        if (target.text === 'def' || target.text === 'defmacro') {
          // Public function/macro: the name lives in the arguments child.
          const args = this.findNamedChild(node, 'arguments')!;
          const funcNameNode = this.findFunctionName(args);
          if (funcNameNode && funcNameNode.text === symbolName) return true;
        } else if (target.text === 'defmodule') {
          const args = this.findNamedChild(node, 'arguments')!;
          const modName = this.extractModuleName(args);
          if (modName === symbolName) return true;
        }
        // defp/defmacrop are private and never exported.
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }
    return false;
  }

  // Fallbacks
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

  /**
   * Locate the function-name identifier within a `def`/`defp`/`defmacro`
   * call's `arguments` node. tree-sitter-elixir emits four shapes:
   *   - no params:            arguments > identifier            (`def hello`)
   *   - params:               arguments > call > identifier     (`def hello(x)`)
   *   - params + guard:       arguments > binary_operator > call > identifier
   *                            (`def hello(x) when ...`)
   *   - no params + guard:    arguments > binary_operator > identifier
   *                            (`def hello when ...`)
   * Operator definitions (`def a + b`) carry no plain name and return null.
   */
  private findFunctionName(args: TreeSitterSyntaxNode): TreeSitterSyntaxNode | null {
    const direct = this.findNamedChild(args, 'identifier');
    if (direct) return direct;

    const call = this.findNamedChild(args, 'call');
    if (call) return this.findNamedChild(call, 'identifier');

    const when = this.findNamedChild(args, 'binary_operator');
    if (when && this.isWhenClause(when)) {
      const head = when.namedChild(0);
      if (head.type === 'identifier') return head;
      if (head.type === 'call') return this.findNamedChild(head, 'identifier');
    }
    return null;
  }

  /** Whether a binary_operator node is a `when` guard clause. */
  private isWhenClause(node: TreeSitterSyntaxNode): boolean {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i).type === 'when') return true;
    }
    return false;
  }

  /**
   * Extract a dotted module name from an `arguments` node. Module names are
   * `alias` leaves (anonymous, no children) or, for a parameterless `def`
   * checked through checkExported, a bare `identifier`. Anything else (a
   * quoted/atom module, or a dotted multi-alias) yields null.
   */
  private extractModuleName(argsNode: TreeSitterSyntaxNode): string | null {
    const parts: string[] = [];
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const child = argsNode.namedChild(i);
      if (child.type === 'identifier' || child.type === 'alias') {
        parts.push(child.text);
      }
    }
    return parts.length > 0 ? parts.join('.') : null;
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
