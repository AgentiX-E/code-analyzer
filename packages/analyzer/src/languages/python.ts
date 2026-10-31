// @code-analyzer/analyzer — Python Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { collectCLikeTaint } from './base-c-like.js';
import { PYTHON_CONSTANTS } from './constant-fold.js';
import { PYTHON_CONTAINERS } from './container-calls.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import { ownerKeyOf } from '../resolution/receiver-types.js';

import type { ConstantDialect } from './constant-fold.js';
import type { ContainerDialect } from './container-calls.js';
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
  /**
   * The field annotations read during the current parse, by class name.
   *
   * **Cleared at the end of every parse**, in `decorateCaptures`, which is the last step a file's captures pass
   * through. A provider instance is reused across files, so a map that outlives its file would file one module's
   * fields onto another module's class. **The key admits `undefined`** because it is read with the name a capture
   * carries, and a capture can carry none - a miss, which is the right answer and needs no guard.
   */
  private readonly classFieldTypes = new Map<string | undefined, Map<string, string>>();

  /** The names a method receives its own object under, which is what makes an annotated attribute a field. */
  private static readonly SELF_NAMES: ReadonlySet<string> = new Set(['self', 'cls']);

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
    // **A parameter's type is filed under the function that declares it**, and for a method that key is the class and
    // the method - `Holder.run` - because the call site that reads it knows the class and not the file.
    const ownerName = this.findNamedChild(node, 'identifier')?.text;
    const enclosing = this.findContainerNode(node);
    const owner =
      ownerName === undefined ? undefined : ownerKeyOf(this.nameOf(enclosing), ownerName);
    for (const [parameterIndex, parameter] of namedChildrenOf(list).entries()) {
      const direct = ['identifier'].includes(parameter.type) ? parameter : undefined;
      const wrapped =
        direct ?? namedChildrenOf(parameter).find((c) => ['identifier'].includes(c.type));
      if (!wrapped) continue;
      // `other: Other` is a `typed_parameter` whose `type` child is the annotation; `*args` and `**kwargs` carry
      // none, and a parameter that says nothing is a parameter this provider cannot type.
      const parameterType =
        parameter.type === 'typed_parameter'
          ? this.findNamedChild(parameter, 'type')?.text
          : undefined;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: wrapped.text,
        startLine: wrapped.startPosition.row + 1,
        endLine: wrapped.endPosition.row + 1,
        startByte: wrapped.startIndex,
        endByte: wrapped.endIndex,
        name: wrapped.text,
        // **The position, which is the only handle a call site has on a parameter.** The caller passes argument 1;
        // the callee's argument 1 is whatever it declared second.
        properties: {
          filePath: this.filePath,
          parameterIndex: String(parameterIndex),
          ...(owner === undefined ? {} : { parameterOwner: owner }),
          ...(parameterType === undefined ? {} : { parameterType }),
        },
      });
    }
  }

  /** The name a container node declares, or `undefined` when it has none. */
  private nameOf(container: TreeSitterSyntaxNode | null): string | undefined {
    return container === null ? undefined : this.extractContainerName(container);
  }

  /**
   * The class a function is declared inside, however many functions sit between it and the class.
   *
   * **The nearest ancestor that is a class, not the nearest ancestor.** `def handler(): ...` inside
   * `Flask.handle_http_exception` has a container - the method - and reading that container's name filed every call in
   * the nested function as belonging to a class called `handle_http_exception`, so `self._find_error_handler(...)`
   * inside it resolved to nothing. A closure is still a method's closure, and the class the call is written on is the
   * one an `self.` receiver means.
   */
  private enclosingClassOf(node: TreeSitterSyntaxNode): string | undefined {
    let current = node.parent ?? null;
    while (current !== null) {
      if (current.type === 'class_definition') return this.nameOf(current);
      current = current.parent ?? null;
    }
    return undefined;
  }

  /**
   * Whether a function declaration sits between this node and the class that encloses it.
   *
   * **`local: Index = None` inside a method annotates a local variable, and `index: Index` in a class body declares a
   * field.** The two are the same node type with the same `type` child, and the difference is exactly which scope the
   * statement is in - so the climb stops at the first function it meets and the answer decides whether the fact is the
   * class's or nobody's.
   */
  private declaredInsideFunction(node: TreeSitterSyntaxNode): boolean {
    let current = node.parent ?? null;
    while (current !== null) {
      if (current.type === 'function_definition') return true;
      if (current.type === 'class_definition') return false;
      current = current.parent ?? null;
    }
    return false;
  }

  /**
   * The field an annotated assignment declares, if it declares one.
   *
   * **Python writes a field's type in two places.** A class body may annotate it (`index: Index`), and a method may
   * annotate the attribute it assigns (`self.cache: Cache = Cache()`); the second is how a class whose `__init__`
   * assigns everything says what its fields are, and it is the shape the flask and werkzeug codebases are written in.
   * `Holder.other: Index = ...` inside a method annotates *another* class's field and is refused: this parse knows
   * what the assignment says and not what `Holder` is.
   */
  private declaredFieldOf(
    node: TreeSitterSyntaxNode,
  ): { className: string; field: string; annotation: string } | undefined {
    const left = namedChildrenOf(node)[0];
    if (left === undefined) return undefined;
    const annotation = this.findNamedChild(node, 'type')?.text ?? this.constructorCallOf(node);
    if (annotation === undefined) return undefined;
    const className = this.nameOf(this.findContainerNode(node));
    if (className === undefined) return undefined;

    if (left.type === 'identifier') {
      // A class body's statement is the class's; a method's is the method's.
      return this.declaredInsideFunction(node)
        ? undefined
        : { className, field: left.text, annotation };
    }
    if (left.type !== 'attribute') return undefined;

    // `self.cache` and `cls.cache` are the class's own fields; `holder.cache` is somebody else's and this parse cannot
    // say which. The attribute's name is its last identifier, because `self.a.b` is an attribute of `a`.
    const parts = namedChildrenOf(left).filter((child) => child.type === 'identifier');
    const object = parts[0];
    const attribute = parts[parts.length - 1];
    if (object === undefined || attribute === undefined || parts.length !== 2) return undefined;
    if (!PythonProvider.SELF_NAMES.has(object.text)) return undefined;
    return { className, field: attribute.text, annotation };
  }

  /**
   * The class named by the call an assignment makes, or `undefined` when it makes none.
   *
   * **`self.index = InvertedIndex()` states the field's type as plainly as an annotation does**, and Python written
   * before annotations existed says it that way and no other. Only a bare name is read - `Foo.bar()` and
   * `make_index()` are a member call and a factory, and neither says what the field *is* - and **the resolver is what
   * decides whether the name is a class**, because only it holds the index: a name no class carries resolves nothing
   * and costs nothing.
   */
  private constructorCallOf(node: TreeSitterSyntaxNode): string | undefined {
    const call = namedChildrenOf(node).find((child) => child.type === 'call');
    if (call === undefined) return undefined;
    return this.findNamedChild(call, 'identifier')?.text;
  }

  /** Record the annotation an assignment declares, on the class it belongs to. */
  private captureFieldAnnotation(node: TreeSitterSyntaxNode): void {
    const declared = this.declaredFieldOf(node);
    if (declared === undefined) return;
    let fields = this.classFieldTypes.get(declared.className);
    if (fields === undefined) {
      fields = new Map();
      this.classFieldTypes.set(declared.className, fields);
    }
    // **The first declaration wins and a second one with a different type drops the name**, on the same rule the
    // resolver applies to every other name: a field two annotations disagree about has no type.
    if (fields.has(declared.field) && fields.get(declared.field) !== declared.annotation) {
      fields.delete(declared.field);
      return;
    }
    fields.set(declared.field, declared.annotation);
  }

  /**
   * File the facts that belong to more than the node they were read from.
   *
   * **A field's type is a fact about its class, and the graph stores it there** - one property, no node per field, for
   * the reason iteration 45 measured on TypeScript: a symbol per field competes with the functions of the file for a
   * search query and cost the product's own docstring search 0.0145 MRR.
   */
  protected override decorateCaptures(captures: UnifiedCapture[]): UnifiedCapture[] {
    const decorated = captures.map((capture) => {
      if (capture.tag !== CAPTURE_TAGS.CLASS_DEF) return capture;
      // **The map is keyed by `string` and read with whatever the capture carries.** A capture with no name is a class
      // this parse could not identify, and asking the map for `undefined` is a miss - which is the answer, and the
      // reason this is a lookup rather than a guard: a branch for a state no walk produces is a branch nobody runs.
      const fields = this.classFieldTypes.get(capture.name);
      if (fields === undefined || fields.size === 0) return capture;
      return {
        ...capture,
        properties: {
          ...capture.properties,
          fieldTypes: JSON.stringify(Object.fromEntries(fields)),
        },
      };
    });
    this.classFieldTypes.clear();
    return decorated;
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_definition') {
      this.emitParameterDefs(node, captures);
    }

    if (nodeType === 'function_definition') {
      const nameNode = this.findNamedChild(node, 'identifier');
      const enclosingClass = this.enclosingClassOf(node);
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: {
            filePath: this.filePath,
            // **The class a method is declared in, which the graph does not record for Python.** `def run(self)` is
            // emitted as a plain `Function` with an empty container, and the resolver has read line spans instead since
            // iteration 41 - right for deciding scope, and useless for naming the class a `self.` call is written on.
            ...(enclosingClass === undefined ? {} : { enclosingClass }),
            ...docstringProperty(node),
          },
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
        // **The argument each name sits in**, because a callee's summary is a statement about an argument position
        // and `f(a + b, c)` passes two arguments while reading three names.
        for (const [argIndex, argument] of namedChildrenOf(args).entries()) {
          for (const name of this.namesIn(argument)) {
            captures.push({
              tag: CAPTURE_TAGS.VARIABLE_ACCESS,
              text: name.text,
              startLine: name.startPosition.row + 1,
              endLine: name.endPosition.row + 1,
              startByte: name.startIndex,
              endByte: name.endIndex,
              name: name.text,
              properties: { filePath: this.filePath, argIndex: String(argIndex) },
            });
          }
        }
      }
    } else if (nodeType === 'return_statement') {
      // **The only place a value leaves a function, and nothing recorded it.** Without this arm a callee's returns
      // read no names, so "does this parameter reach a return" could not be asked and every caller had to assume the
      // answer was yes.
      const value = node.child(1);
      if (value) this.captureReturnAccesses(node, this.namesIn(value), captures);
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
      // **An annotated assignment is also where a field's type is written**, which is the fact a `self.field.call()`
      // needs and which nothing else in this walk reads.
      this.captureFieldAnnotation(node);
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

  protected override containerDialect(): ContainerDialect {
    return PYTHON_CONTAINERS;
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
