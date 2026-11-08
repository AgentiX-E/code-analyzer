// @code-analyzer/analyzer — Elixir Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { lineOf } from './line-index.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

/**
 * The names Elixir spells as a call and means as a declaration.
 *
 * **`def`, `if` and `case` are all `call` nodes**, because a macro is a function, so a walk that files every call node
 * as a call site files the declaration syntax as one. This is the list of the ones a reader would not call a call: the
 * definition macros, the imports, the module attribute, and the control-flow forms that expand into a function the
 * programmer never wrote. A call to any other name is a call.
 */
/** The macros that define a function, whose head parses as a call to the function being defined. */
const ELIXIR_DEFINITION_MACROS: ReadonlySet<string> = new Set([
  'def',
  'defp',
  'defmacro',
  'defmacrop',
  'defdelegate',
  'defguard',
]);

const ELIXIR_KEYWORD_CALLS: ReadonlySet<string> = new Set([
  'def',
  'defp',
  'defmacro',
  'defmacrop',
  'defmodule',
  'defprotocol',
  'defimpl',
  'defdelegate',
  'defstruct',
  'defexception',
  'defguard',
  'defguardp',
  'use',
  'import',
  'alias',
  'require',
  'quote',
  'case',
  'cond',
  'if',
  'unless',
  'for',
  'with',
  'try',
  'receive',
  'raise',
  'throw',
  'super',
  'fn',
  'unquote',
  'doc',
  'moduledoc',
]);

const ELIXIR_EXTENSIONS = ['.ex', '.exs'];
const ELIXIR_GLOBS = ['**/*.ex', '**/*.exs'];

export class ElixirProvider extends TreeSitterBaseProvider {
  readonly language = 'elixir';
  readonly displayName = 'Elixir';
  readonly extensions = ELIXIR_EXTENSIONS;
  readonly globs = ELIXIR_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-elixir is a direct dependency of the analyzer, so this
    // require never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('tree-sitter-elixir') as TreeSitterLanguage;
  }

  /** The documentation a `@doc` or `@moduledoc` attribute states, waiting for the declaration it documents. */
  private pendingDoc: string | null = null;

  /** The pending documentation this declaration took, which is cleared as it is read. */
  private consumedDoc: string | null = null;

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    // **Elixir documents a function with an attribute rather than a comment.** `@doc "Greets."` is a `unary_operator`
    // over a call to `doc`, so no grammar here has a comment node to hand the base class's attach pass — the text is
    // in the attribute, and the declaration it documents is the next one written.
    if (node.type === 'unary_operator' && /^@(module)?doc\b/.test(node.text)) {
      const text = node.text.replace(/^@(module)?doc\s*/, '');
      this.pendingDoc = text;
      captures.push({
        tag: CAPTURE_TAGS.DOCSTRING,
        text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: text,
        properties: { filePath: this.filePath },
      });
    }

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
            // The attribute belongs to the declaration written under it, and only to that one.
            this.consumedDoc = this.pendingDoc;
            this.pendingDoc = null;
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
                ...(this.consumedDoc === null ? {} : { docstring: this.consumedDoc }),
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
        } else if (!ELIXIR_KEYWORD_CALLS.has(target.text) && !this.isDefinitionHead(node)) {
          // **The fourth walk with no arm for a call, and the one where the arm already existed and pointed the other
          // way.** Every `call` node in this grammar is a function application — `def` is a call to the `def` macro and
          // `helper(name)` is a call to a function — so the walk dispatched on the keyword and skipped the rest. What
          // separates them is a list of names the language reserves, and a call to one of those is a declaration.
          this.emitCallCapture(node, captures);
        }
      } else {
        // A remote call writes the module and the function as one `dot` child: `Enum.map(list, …)` has no plain
        // `identifier` of its own, which is why the first version of this walk saw none of them.
        const remote = namedChildrenOf(node)[0];
        if (remote?.type === 'dot' || remote?.type === 'anonymous_function') {
          this.emitCallCapture(node, captures);
        }
      }
    }

    for (const child of childrenOf(node)) {
      this.walkAndCapture(child, captures);
    }
  }

  /**
   * The name an Elixir call names: the last segment of `Enum.map`, or the plain name of `helper`.
   *
   * A remote call's callee text is `Enum.map` — the module is not a symbol in the graph and the function is.
   */
  protected override extractCallName(node: TreeSitterSyntaxNode): string | undefined {
    const callee = namedChildrenOf(node)[0];
    if (callee === undefined) return undefined;
    const text = callee.text;
    const dot = text.lastIndexOf('.');
    return dot < 0 ? text : text.slice(dot + 1);
  }

  /** **A call whose callee is written `Module.function` is a method call**, which is what carries the receiver. */
  protected override isMethodCall(node: TreeSitterSyntaxNode): boolean {
    const callee = namedChildrenOf(node)[0];
    return callee?.type === 'dot';
  }

  /**
   * The argument list of an Elixir call, which is `arguments` but written without parentheses often enough that the
   * node may hold none: `helper name` passes one and `helper` passes none, and the grammar says which.
   */
  protected override argumentCountOf(node: TreeSitterSyntaxNode): number | undefined {
    const list = namedChildrenOf(node).find((child) => child.type === 'arguments');
    return list === undefined ? undefined : namedChildrenOf(list).length;
  }
  /**
   * Whether this call node is the **head of a definition** rather than a call.
   *
   * `def a(name) do … end` parses the head `a(name)` as a call in its own right, so a walk that files every call node
   * records the function being defined as a call to itself — with the argument count of its own parameter list. The
   * shape is unambiguous: the node sits in the `arguments` of a call to one of the definition macros.
   */
  private isDefinitionHead(node: TreeSitterSyntaxNode): boolean {
    const argumentsNode = node.parent;
    if (argumentsNode === null || argumentsNode.type !== 'arguments') return false;
    const call = argumentsNode.parent;
    if (call === null || call.type !== 'call') return false;
    const keyword = this.findNamedChild(call, 'identifier');
    return keyword !== null && ELIXIR_DEFINITION_MACROS.has(keyword.text);
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

    for (const child of childrenOf(node)) {
      this.walkForImports(child, imports);
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

    for (const child of childrenOf(node)) {
      if (this.checkExported(child, symbolName)) return true;
    }
    return false;
  }

  // Fallbacks
  public override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
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

  public override fallbackExtractImports(source: string): ParsedImport[] {
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

  public override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`defp\\s+${s}\\b`).test(source)) return false;
    return new RegExp(`(?:def|defmacro|defmodule)\\s+${s}\\b`).test(source);
  }

  // Helpers
  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (const child of namedChildrenOf(node)) {
      if (child.type === type) return child;
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
    for (const child of childrenOf(node)) {
      if (child.type === 'when') return true;
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
    for (const child of namedChildrenOf(argsNode)) {
      if (child.type === 'identifier' || child.type === 'alias') {
        parts.push(child.text);
      }
    }
    return parts.length > 0 ? parts.join('.') : null;
  }

  private ln(source: string, offset: number): number {
    return lineOf(source, offset);
  }
}
