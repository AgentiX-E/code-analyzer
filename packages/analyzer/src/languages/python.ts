// @code-analyzer/analyzer — Python Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import {
  collectCLikeTaintSanitizers,
  collectCLikeTaintSinks,
  collectCLikeTaintSources,
} from './base-c-like.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type {
  TaintSanitizer,
  TaintSink,
  TaintSource,
  TreeSitterLanguage,
  TreeSitterSyntaxNode,
} from './tree-sitter-base.js';
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
          properties: { baseClasses, filePath: this.filePath },
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
    } else if (nodeType === 'expression_statement') {
      // Check for triple-quoted string (docstring)
      for (const child of namedChildrenOf(node)) {
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

    for (const child of childrenOf(node)) {
      this.walkAndCapture(child, captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_statement') {
      const line = node.startPosition.row + 1;
      for (const child of namedChildrenOf(node)) {
        if (child.type === 'dotted_name') {
          imports.push({
            source: child.text,
            names: [child.text],
            type: 'named',
            lineNumber: line,
          });
        } else {
          // aliased_import — the only other named-child type in an import_statement
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
      for (const child of namedChildrenOf(node)) {
        // No `continue` guard is needed here: `fromNode` is null iff the
        // statement has no dotted_name child, so `child.type === 'dotted_name'
        // && !fromNode` can never be true.
        if (child.type === 'aliased_import') {
          const id = this.findNamedChild(child, 'identifier');
          if (id) names.push(id.text);
        } else if (child.type === 'dotted_name' && fromNode && child !== fromNode) {
          names.push(child.text);
        }
      }
      if (source) {
        imports.push({
          source,
          names: names.length > 0 ? names : [source],
          type: 'named',
          lineNumber: line,
        });
      }
      return;
    }

    for (const child of childrenOf(node)) {
      this.walkForImports(child, imports);
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
  // Taint sources and sinks. The base class parses and recurses but recognises nothing, and only five providers
  // override it — none of them Python, which is where a web application's untrusted input most often arrives.
  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    collectCLikeTaintSources(node, sources, PYTHON_TAINT_NODES);
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    collectCLikeTaintSinks(node, sinks, PYTHON_TAINT_NODES);
  }

  // Sanitizers. Nothing in this family recognised one before, so every finding was reported unsanitized.
  protected override walkForSanitizers(
    node: TreeSitterSyntaxNode,
    sanitizers: TaintSanitizer[],
  ): void {
    // Python's own node names, not the C-family default: a Python call is a `call`, not a `call_expression`, so the
    // default made this walk match nothing. JavaScript and TypeScript use the default legitimately.
    collectCLikeTaintSanitizers(node, sanitizers, PYTHON_TAINT_NODES);
  }
}
