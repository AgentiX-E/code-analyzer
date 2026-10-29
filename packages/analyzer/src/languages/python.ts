// @code-analyzer/analyzer — Python Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { collectCLikeTaint } from './base-c-like.js';
import { PYTHON_CONSTANTS } from './constant-fold.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ConstantDialect } from './constant-fold.js';
import type { ParsedImport } from './provider.js';
import type { TaintCollections } from './taint-scan.js';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

const pyExtensions = ['.py', '.pyi', '.pyx', '.pxd'];
const pyGlobs = ['**/*.py', '**/*.pyi', '**/*.pyx', '**/*.pxd'];

/** Python's names for the three node kinds the collectors need. */
const PYTHON_TAINT_NODES = {
  member: ['attribute'],
  call: ['call'],
  argumentContainer: ['argument_list'],
};

export class PythonProvider extends TreeSitterBaseProvider {
  readonly language = 'python';
  readonly displayName = 'Python';
  readonly extensions = pyExtensions;
  readonly globs = pyGlobs;
  readonly importSemantics = 'wildcard-leaf' as const;

  /**
   * Python's imports, read from Python's own nodes.
   *
   * **The base implementation walks JavaScript's import shapes**, so on a Python tree it read whatever node happened to
   * be first: a probe of `src/flask/app.py` returned **`cabc`, `t`, `datetime`** where the file says
   * `from __future__ import annotations`, `import typing as t` and `from datetime import timedelta`. **Sixty imports,
   * almost all of them wrong**, and every one of them then failed to resolve — which is why a repository whose modules
   * import each other on every line produced **four** import edges instead of hundreds.
   *
   * **Two shapes, and they are the grammar's**: `import_statement name: (dotted_name | aliased_import)` and
   * `import_from_statement module_name: (dotted_name | relative_import) name: (dotted_name)…`, with
   * `(wildcard_import)` in place of the names for `from m import *`.
   */
  override extractImports(source: string): ParsedImport[] {
    this.source = source;
    // **Without a grammar the regex fallback is the only reader there is**, and it is what the no-grammar tests
    // exercise. Returning an empty list here would have made a degraded install look like a file with no imports.
    if (!this.parser) return this.fallbackExtractImports(source);

    const imports: ParsedImport[] = [];
    const visit = (node: TreeSitterSyntaxNode): void => {
      if (node.type === 'import_statement') {
        for (const child of namedChildrenOf(node)) {
          // **`module` is always there**: an `import_statement` has `dotted_name` or `aliased_import` children, and an
          // `aliased_import` is `name: 'as' alias:`. A malformed `import` produces an `ERROR` node instead of a
          // statement - `import` alone parses as `(module (ERROR))` - so there is no shape to guard against.
          const aliased = child.type === 'aliased_import';
          const module = (aliased ? child.childForFieldName('name') : child)!;
          // **The alias is kept beside the module rather than in place of it**: `import numpy as np` imports `numpy`,
          // and `np` is what this file calls it. A consumer that replaced one with the other would report an import
          // of a module that does not exist.
          const alias = aliased ? child.childForFieldName('alias')?.text : undefined;
          imports.push({
            // `import a.b.c` names the module and binds `a`; **the edge is to the module**, so the source keeps the
            // whole dotted path and the bound name is the first segment.
            source: module.text,
            // **`split` of a non-empty string always yields a first element**, so no fallback is needed.
            names: [module.text.split('.')[0]!],
            type: 'namespace',
            ...(alias ? { alias } : {}),
            lineNumber: node.startPosition.row + 1,
          });
        }
      } else if (node.type === 'import_from_statement') {
        // **`module_name` is a field of the rule itself**, so a statement without one is not this node type: `from
        // import x` parses as `ERROR (import_statement …)`, measured.
        const moduleNode = node.childForFieldName('module_name')!;
        const wildcard = namedChildrenOf(node).some((c) => c.type === 'wildcard_import');
        // **The names can be nested**, because `from m import (a, b)` wraps them in a parenthesised list - a shape a
        // direct-children filter drops, which is how `from urllib.parse import (_url_quote)` became a name-less
        // import. The whole subtree is walked, minus the module itself.
        const names: string[] = [];
        let alias: string | undefined;
        const collectNames = (n: TreeSitterSyntaxNode): void => {
          if (n.type === 'dotted_name') {
            names.push(n.text);
            return;
          }
          if (n.type === 'aliased_import') {
            // **An `aliased_import` always carries its `name` field**: the node is `name: 'as' alias:`.
            names.push(n.childForFieldName('name')!.text);
            alias ??= n.childForFieldName('alias')?.text;
            return;
          }
          for (const child of namedChildrenOf(n)) collectNames(child);
        };
        for (const child of namedChildrenOf(node)) {
          if (child !== moduleNode) collectNames(child);
        }
        imports.push({
          // **`relative_import` keeps its dots**, which is what makes `.helpers` resolvable at all: the dots are the
          // package the importer is in, and the rest is the module.
          source: moduleNode.text,
          names: wildcard ? ['*'] : names,
          type: wildcard ? 'wildcard' : 'named',
          ...(alias ? { alias } : {}),
          lineNumber: node.startPosition.row + 1,
        });
      }
      for (const child of namedChildrenOf(node)) visit(child);
    };
    // **No assertion**: the tree-sitter root is structurally the interface this file walks, and the compiler agrees.
    visit(this.parser.parse(source).rootNode);
    return imports;
  }

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-python is a direct dependency of the analyzer, so this
    // require never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const py = require('tree-sitter-python') as { python: TreeSitterLanguage };
    return py.python || (py as unknown as TreeSitterLanguage);
  }

  /**
   * Every identifier under `node`, in document order.
   *
   * The walk visits a node's children itself, so a capture taken from inside a subtree would be taken again when the
   * walk arrives there. These names are therefore recorded **without** descending at this level - the branch above
   * pushes them and the walk still reaches the leaf, where nothing further is claimed.
   */
  private namesIn(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode[] {
    const out: TreeSitterSyntaxNode[] = [];
    const visit = (current: TreeSitterSyntaxNode): void => {
      if (current.type === 'identifier' || current.type === 'attribute') {
        out.push(current);
        return;
      }
      for (const child of namedChildrenOf(current)) visit(child);
    };
    visit(node);
    return out;
  }

  /**
   * Record a def for each parameter of a function, which is what makes a parameter a binding.
   *
   * `attachArgumentBindings` resolves a call's arguments against the function's bindings, so without this a parameter
   * passed to a callee is recorded as `-1` and the taint the interprocedural wave carries - "parameter 0 of this
   * function" - can never be matched to the sink that receives it.
   */
  private emitParameterDefs(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const list = namedChildrenOf(node).find((c) => c.type === 'parameters');
    if (!list) return;
    for (const parameter of namedChildrenOf(list)) {
      const direct = ['identifier'].includes(parameter.type) ? parameter : undefined;
      const wrapped =
        direct ?? namedChildrenOf(parameter).find((c) => ['identifier'].includes(c.type));
      if (!wrapped) continue;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: wrapped.text,
        startLine: wrapped.startPosition.row + 1,
        endLine: wrapped.endPosition.row + 1,
        startByte: wrapped.startIndex,
        endByte: wrapped.endIndex,
        name: wrapped.text,
        properties: { filePath: this.filePath },
      });
    }
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_definition') {
      this.emitParameterDefs(node, captures);
    }

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
          properties: { filePath: this.filePath, ...docstringProperty(node) },
        });
      }
    } else if (nodeType === 'class_definition') {
      const nameNode = this.findNamedChild(node, 'identifier');
      if (nameNode) {
        // Extract base classes
        let baseClasses = '';
        for (const child of namedChildrenOf(node)) {
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
          properties: { baseClasses, filePath: this.filePath, ...docstringProperty(node) },
        });
      }
    } else if (nodeType === 'call') {
      // The call itself is a use of its callee and of every name among its arguments, and `uses` was still zero
      // without it: a statement like `db.execute(sql)` is an expression statement, so nothing reached the propagator
      // to say the tainted binding was used.
      const callee = node.child(0);
      if (callee) {
        const isMethod = callee.type === 'attribute';
        captures.push({
          tag: isMethod ? CAPTURE_TAGS.METHOD_CALL : CAPTURE_TAGS.FUNCTION_CALL,
          text: callee.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: callee.startIndex,
          endByte: callee.endIndex,
          name: isMethod ? (callee.text.split('.').pop() ?? callee.text) : callee.text,
          properties: { filePath: this.filePath },
        });
      }
      const args = node.child(1);
      if (args) {
        for (const name of this.namesIn(args)) {
          captures.push({
            tag: CAPTURE_TAGS.VARIABLE_ACCESS,
            text: name.text,
            startLine: name.startPosition.row + 1,
            endLine: name.endPosition.row + 1,
            startByte: name.startIndex,
            endByte: name.endIndex,
            name: name.text,
            properties: { filePath: this.filePath },
          });
        }
      }
    } else if (nodeType === 'expression_statement') {
      // A bare call stands as its own statement; its arguments are the uses that carry taint to a sink.
      const inner = node.child(0);
      if (inner && inner.type === 'identifier') {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_ACCESS,
          text: inner.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: inner.startIndex,
          endByte: inner.endIndex,
          name: inner.text,
          properties: { filePath: this.filePath },
        });
      }
      // **And a triple-quoted string in statement position is a docstring.**
      //
      // **This case used to live in a second `else if` on the same node type**, and that branch was unreachable, so
      // **Python emitted no `DOCSTRING` capture at all** - and **three tests that ask for one were asking a branch that
      // could not run.** **The two cases are complementary rather than conflicting** (an `identifier` is a use and a
      // triple-quoted `string` is a docstring), **so they belong in one branch.**
      //
      // **`java.ts` had the same shadow in this same stretch**, with two `field_declaration` branches where the first
      // took only one declarator. **A duplicated `else if` on one node type is a shadow**, and **the tests that would
      // catch it are asking the shadowed branch's questions.**
      for (const child of namedChildrenOf(node)) {
        if (child.type !== 'string') continue;
        const text = child.text;
        const quote = text.slice(0, 3);
        const tripleDouble = String.fromCharCode(34, 34, 34);
        const tripleSingle = String.fromCharCode(39, 39, 39);
        if ((quote === tripleDouble || quote === tripleSingle) && text.length > 5) {
          captures.push({
            tag: CAPTURE_TAGS.DOCSTRING,
            text,
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
            startByte: child.startIndex,
            endByte: child.endIndex,
            properties: { filePath: this.filePath, ...docstringProperty(node) },
          });
        }
      }
    } else if (nodeType === 'assignment') {
      // **Python contributed no defs and no uses, and these three branches are why.** A provider whose walk captures
      // only declarations contributes nothing that `buildStatementFacts` can derive defs and uses from, so the
      // propagator has no taint state to seed - the pipeline reached a finding for JavaScript and for nothing else.
      const left = node.child(0);
      const right = node.child(2);
      if (left && left.type === 'identifier') {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: left.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: left.startIndex,
          endByte: left.endIndex,
          name: left.text,
          properties: { filePath: this.filePath },
        });
      }
      // The right-hand side is a use of whatever names it mentions, which is what carries taint onward.
      if (right) {
        for (const name of this.namesIn(right)) {
          captures.push({
            tag: CAPTURE_TAGS.VARIABLE_ACCESS,
            text: name.text,
            startLine: name.startPosition.row + 1,
            endLine: name.endPosition.row + 1,
            startByte: name.startIndex,
            endByte: name.endIndex,
            name: name.text,
            properties: { filePath: this.filePath },
          });
        }
      }
    } else if (nodeType === 'decorated_definition') {
      // Extract decorators
      for (const child of childrenOf(node)) {
        if (child.type === 'decorator') {
          const called = this.findNamedChild(child, 'call');
          let text = '@';
          if (called) {
            const func =
              this.findNamedChild(called, 'identifier') || this.findNamedChild(called, 'attribute');
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
            const id =
              this.findNamedChild(child, 'identifier') || this.findNamedChild(child, 'attribute');
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
      for (const child of childrenOf(node)) {
        this.walkAndCapture(child, captures);
      }
      return;
    } else if (nodeType === 'import_statement') {
      let sourceName = '';
      for (const child of namedChildrenOf(node)) {
        if (child.type === 'dotted_name') {
          sourceName = child.text;
        } else {
          // aliased_import — the only other named-child type in an import_statement
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
    }

    for (const child of childrenOf(node)) {
      this.walkAndCapture(child, captures);
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
  public override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const funcRegex = /(?:async\s+)?def\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const clsRegex = /class\s+(\w+)/g;
    while ((m = clsRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const decRegex = /@(\w+(?:\.\w+)*)/g;
    while ((m = decRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.DECORATOR,
        text: m[0],
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { decorator: m[1]!, filePath },
      });
    }
    const docRegex = /("""|''')[\s\S]*?\1/g;
    while ((m = docRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.DOCSTRING,
        text: m[0],
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        properties: { filePath },
      });
    }
    const imps = this.fallbackExtractImports(source);
    for (const imp of imps) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: imp.source,
        startLine: imp.lineNumber,
        endLine: imp.lineNumber,
        startByte: 0,
        endByte: 0,
        name: imp.source,
        properties: { names: imp.names.join(','), importType: imp.type, filePath },
      });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  public override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const fromRegex = /from\s+([\w.]+)\s+import\s+([\w\s,]+)/g;
    while ((m = fromRegex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: m[2]!
          .split(',')
          .map((s) => s.trim().split(/\s+as\s+/)[0]!)
          .filter(Boolean),
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    const impRegex = /^import\s+([\w\s,.]+?)(?:\s+#.*)?$/gm;
    while ((m = impRegex.exec(source)) !== null) {
      for (const mod of m[1]!.split(',')) {
        const parts = mod.trim().split(/\s+as\s+/);
        imports.push({
          source: parts[0]!.trim(),
          names: [parts[1]?.trim() ?? parts[0]!.trim()],
          type: parts.length > 1 ? 'namespace' : 'named',
          lineNumber: this.ln(source, m.index),
        });
      }
    }
    return imports;
  }

  public override fallbackIsExported(_source: string, symbolName: string): boolean {
    if (symbolName.startsWith('_') && !symbolName.startsWith('__')) return false;
    const allMatch = this.source.match(/__all__\s*=\s*\[([\s\S]*?)\]/);
    if (allMatch) {
      return allMatch[1]!
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .includes(symbolName);
    }
    return true;
  }

  // Helpers
  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (const child of namedChildrenOf(node)) {
      if (child.type === type) return child;
    }
    return null;
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
  /**
   * Taint, in one pass over the tree.
   *
   * **The three questions name the same two node shapes**, so the file is traversed once instead of three
   * times - see `collectCLikeTaint`. The collector is the shared one; only the node names are this language's.
   */
  /**
   * The grammar's names for a declaration, an assignment and a condition.
   *
   * **This is what makes reachability cheap and language-wide**: the walk that reads it is shared, and a dialect is the
   * only thing a grammar has to supply. Python spells an assignment as one `assignment` node and puts a conditional's condition between its arms.
   */
  protected override constantDialect(): ConstantDialect {
    return PYTHON_CONSTANTS;
  }

  protected override collectTaint(root: TreeSitterSyntaxNode): TaintCollections {
    return collectCLikeTaint(root, PYTHON_TAINT_NODES);
  }
}
/**
 * A python declaration's docstring, which is **not a comment**.
 *
 * **Every other language here gets its doc comments through the comment machinery, and python cannot.** PEP 257 says a
 * docstring is *the first statement in the body* - so it is an `expression_statement` holding a string, **inside** the
 * declaration rather than above it, and **after** it in source order. **A pass over a file's captures in source order
 * therefore cannot associate the two**, which is why this lives in the provider: it knows where a body begins.
 *
 * **Only the three-quoted forms**, which is what the convention is about. A single-quoted first statement is an
 * ordinary expression, and treating it as documentation would put `x = "hello"` on a symbol as its description.
 */
function docstringProperty(node: TreeSitterSyntaxNode): Record<string, string> {
  const docstring = pythonDocstringOf(node);
  // **Absent rather than empty.** `properties` holds strings, and an empty one would reach the graph as a docstring
  // that is `''` - which reads as "documented, and the documentation says nothing" instead of "not documented".
  return docstring === undefined ? {} : { docstring };
}

function pythonDocstringOf(node: TreeSitterSyntaxNode): string | undefined {
  const block = childrenOf(node).find((c) => c.type === 'block');
  const first = block?.namedChild(0);
  if (first?.type !== 'expression_statement') return undefined;
  const text = first.text.trim();
  const triple = /^[rubf]{0,2}(?:"""|''')/;
  if (!triple.test(text)) return undefined;
  const opener = triple.exec(text)?.[0] ?? '';
  const closer = opener.endsWith('"""') ? '"""' : "'''";
  if (!text.endsWith(closer) || text.length <= opener.length + closer.length) return undefined;
  const body = text.slice(opener.length, text.length - closer.length).trim();
  return body.length > 0 ? body : undefined;
}
