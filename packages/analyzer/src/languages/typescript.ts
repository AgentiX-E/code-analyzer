// @code-analyzer/analyzer — TypeScript Tree-sitter Provider
// Replaces regex-based parsing with tree-sitter AST for 99.9%+ accuracy.

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { collectCLikeTaint } from './base-c-like.js';
import { C_FAMILY_CONSTANTS } from './constant-fold.js';
import { MEMBER_CALLEE_CONTAINERS } from './container-calls.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { cursorNode, walkPreOrder } from './syntax-cursor.js';
import { CALL_NODE_TYPES, TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ConstantDialect } from './constant-fold.js';
import type { ContainerDialect } from './container-calls.js';
import type { ParsedImport } from './provider.js';
import type { TaintCollections } from './taint-scan.js';
import type {
  NodeTypeMapping,
  TreeSitterLanguage,
  TreeSitterSyntaxNode,
} from './tree-sitter-base.js';
import type { UnifiedCapture, CaptureTag } from '@code-analyzer/shared';

const tsExtensions = ['.ts', '.tsx', '.mts', '.cts'];
const tsGlobs = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.d.ts'];

/**
 * The node types this language has anything to say about.
 *
 * **Every other type in a file is skipped for the price of one `Set.has`**, which is what lets the walk read the tree
 * through a cursor instead of materialising it. The set is built from the mapping table plus the types whose arms do
 * not go through a mapping: `lexical_declaration` carries the `const`/`let` bindings, `import_statement` is a capture
 * of its own, `arrow_function` is named by the declarator above it, the parameter arm hangs off the two declarations
 * that can own parameters, and `return_statement` is the only place a value leaves a function.
 *
 * **`return_statement` was in the arm and not in this set**, so the arm never ran: the walk never stopped at a return,
 * no name was recorded as leaving, and every TypeScript callee answered "no return reads this parameter" — the one
 * answer a summary must not give by accident. An arm outside the set is a comment, not code.
 */
function captureTypesFor(mappings: NodeTypeMapping[]): ReadonlySet<string> {
  const types = new Set<string>(CALL_NODE_TYPES);
  for (const mapping of mappings) types.add(mapping.nodeType);
  types.add('lexical_declaration');
  types.add('import_statement');
  types.add('arrow_function');
  types.add('function_declaration');
  types.add('method_definition');
  types.add('return_statement');
  return types;
}

export class TypeScriptProvider extends TreeSitterBaseProvider {
  readonly language: string = 'typescript';
  readonly displayName: string = 'TypeScript';
  readonly extensions: string[] = tsExtensions;
  readonly globs: string[] = tsGlobs;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-typescript is a direct dependency of the analyzer, so this
    // require never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tsGrammar = require('tree-sitter-typescript') as {
      typescript: TreeSitterLanguage;
      tsx: TreeSitterLanguage;
    };
    return tsGrammar.typescript;
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      {
        nodeType: 'function_declaration',
        captureTag: CAPTURE_TAGS.FUNCTION_DEF,
        nameChildType: 'identifier',
      },
      {
        nodeType: 'arrow_function',
        captureTag: CAPTURE_TAGS.FUNCTION_DEF,
        nameChildType: 'identifier',
      },
      {
        nodeType: 'class_declaration',
        captureTag: CAPTURE_TAGS.CLASS_DEF,
        nameChildType: 'type_identifier',
      },
      {
        nodeType: 'method_definition',
        captureTag: CAPTURE_TAGS.METHOD_DEF,
        nameChildType: 'property_identifier',
      },
      {
        nodeType: 'interface_declaration',
        captureTag: CAPTURE_TAGS.INTERFACE_DEF,
        nameChildType: 'type_identifier',
      },
      {
        nodeType: 'type_alias_declaration',
        captureTag: CAPTURE_TAGS.TYPE_DEF,
        nameChildType: 'type_identifier',
      },
      {
        nodeType: 'enum_declaration',
        captureTag: CAPTURE_TAGS.ENUM_DEF,
        nameChildType: 'identifier',
      },
      {
        nodeType: 'variable_declaration',
        captureTag: CAPTURE_TAGS.VARIABLE_DEF,
        nameChildType: 'identifier',
      },
      { nodeType: 'decorator', captureTag: CAPTURE_TAGS.DECORATOR, useFirstNamedChild: true },
      { nodeType: 'comment', captureTag: CAPTURE_TAGS.DOCSTRING, useFirstNamedChild: true },
    ];
  }

  // ---- Override walk-and-capture for TypeScript-specific logic ----

  /**
   * Every identifier under `node`, in document order.
   *
   * **A cursor pass, because this is asked once per call argument** - and an argument is often an expression with a
   * dozen nodes in it, of which at most a few are identifiers. The nodes it does collect are materialised; the rest are
   * a string comparison each.
   */
  private namesIn(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode[] {
    const out: TreeSitterSyntaxNode[] = [];
    walkPreOrder(node, (type, _depth, cursor) => {
      if (type === 'identifier') out.push(cursorNode<TreeSitterSyntaxNode>(cursor));
    });
    return out;
  }

  /**
   * Every capture this language emits, from **one cursor pass**.
   *
   * **The walk this replaced materialised every node in the file in order to compare its type against a mapping
   * table.** A file of 700 lines holds about 6 000 nodes and emits about 60 captures, so 99 % of that materialisation
   * was spent deciding not to look. Measured on this repository's own TypeScript, the capture and import walks were
   * **18 % of a full index** between them.
   *
   * **The set below is what makes it cheap**: a node whose type is not in it costs one `Set.has` and no node object,
   * which is the only way a cursor is faster than the array it replaces - a cursor that yields nodes is twice as slow.
   */
  protected override walkAndCapture(root: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const mappings = this.getNodeMappings();
    const wanted = this.captureTypes(mappings);

    walkPreOrder(root, (nodeType, _depth, cursor) => {
      if (!wanted.has(nodeType)) return;
      this.captureNode(cursorNode<TreeSitterSyntaxNode>(cursor), nodeType, mappings, captures);
    });
  }

  /**
   * The node types this walk stops at.
   *
   * **A dialect that sees productions this grammar does not adds them here**, and its arms go in `captureExtra`.
   * Splitting the set from the arms is what keeps the walk a traversal: a type outside the set is never materialised.
   */
  protected captureTypes(mappings: NodeTypeMapping[]): ReadonlySet<string> {
    return captureTypesFor(mappings);
  }

  /**
   * A dialect's own arms, applied to every node this walk stops at, before the TypeScript ones.
   *
   * **This is a hook rather than an override of the walk** because the walk no longer calls itself: a subclass that
   * replaced the walk was reached once per node through dynamic dispatch, and a subclass that replaces this is reached
   * the same way - which is the property ArkTS's four cases exist to check.
   */
  protected captureExtra(
    _node: TreeSitterSyntaxNode,
    _nodeType: string,
    _captures: UnifiedCapture[],
  ): void {
    // TypeScript itself has nothing beyond its mapping table.
  }

  /**
   * What this language has to say about one node.
   *
   * **Separated from the walk so the walk is a traversal and nothing else.** The arms below are unchanged - this is the
   * body the recursive walk ran, with the recursion removed and the two values it used to read from the node handed to
   * it instead.
   */
  private captureNode(
    node: TreeSitterSyntaxNode,
    nodeType: string,
    mappings: NodeTypeMapping[],
    captures: UnifiedCapture[],
  ): void {
    this.captureExtra(node, nodeType, captures);

    for (const mapping of mappings) {
      if (nodeType === mapping.nodeType) {
        // Special handling for method_definition: skip if name is 'constructor'
        if (nodeType === 'method_definition') {
          const nameChild = this.findNamedChild(node, 'property_identifier');
          if (nameChild && nameChild.text === 'constructor') {
            // Emit as constructor instead
            captures.push(this.buildCapture(node, CAPTURE_TAGS.CONSTRUCTOR_DEF, nameChild));
            break;
          }
        }

        // Special handling for variable_declaration (var / ambient declare var)
        if (nodeType === 'variable_declaration') {
          // tree-sitter-typescript emits `variable_declaration` only for `var`
          // (and ambient `declare var`); `const`/`let` produce `lexical_declaration`.
          // Every named child is a `variable_declarator`, so the tag is always
          // VARIABLE_DEF and declarators can be iterated directly.
          for (const declarator of namedChildrenOf(node)) {
            // The first named child is the binding name. Destructuring
            // (`var { a, b } = obj`) yields an object/array pattern instead of an
            // identifier, so it is skipped rather than mislabeling the RHS value.
            const nameChild = declarator.namedChild(0);
            if (nameChild.type === 'identifier') {
              captures.push(this.buildCapture(node, CAPTURE_TAGS.VARIABLE_DEF, nameChild));
            }
          }
          break;
        }

        // Special handling for arrow_function
        if (nodeType === 'arrow_function') {
          // Arrow functions are only named when bound to a `variable_declarator`
          // (e.g. `const f = () => {}`); callbacks (`.map(...)`) and IIFEs are
          // skipped because their parent is not a variable_declarator.
          const parent = node.parent;
          if (parent && parent.type === 'variable_declarator') {
            // Destructured names (`const { a } = () => {}`) leave no identifier,
            // so the name child may be absent.
            const nameChild = this.findNamedChild(parent, 'identifier');
            if (nameChild) {
              const cap = this.buildCapture(node, CAPTURE_TAGS.FUNCTION_DEF, nameChild);
              cap.properties = {
                ...cap.properties,
                arrow: 'true',
                async: String(node.text.includes('async')),
              };
              captures.push(cap);
            }
          }
          break;
        }

        // Special handling for comment (only JSDoc-style)
        if (nodeType === 'comment') {
          if (node.text.startsWith('/**')) {
            captures.push(this.buildCapture(node, CAPTURE_TAGS.DOCSTRING, node));
          }
          break;
        }

        // Default handling
        this.emitCapture(node, mapping, captures);
        break;
      }
    }

    // Also handle lexical_declaration
    if (nodeType === 'lexical_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        // `lexical_declaration` (`const`/`let`) holds only `variable_declarator`
        // children. The first named child of each declarator is the binding name;
        // destructuring yields an object/array pattern instead of an identifier.
        const child = node.namedChild(i);
        const nameChild = child.namedChild(0);
        const valueChild = child.namedChild(1); // value expression
        if (nameChild.type === 'identifier') {
          const isArrow = valueChild?.type === 'arrow_function';
          if (!isArrow) {
            const isConst = node.text.startsWith('const');
            const tag = isConst ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;
            captures.push(this.buildCapture(node, tag, nameChild));
          }
        }
      }
    }

    // Handle import_statement as capture
    // **A parameter is a binding too, and nothing recorded it.** `attachArgumentBindings` resolves a call's
    // arguments against the function's bindings, so a parameter passed to a callee - `inner(x)` inside
    // `function inner(x) { db.query(x) }` - was written as `-1` and could never be matched to the taint the wave
    // carries as "parameter 0 of inner". Emitting a def per parameter is what puts it in that map.
    if (nodeType === 'function_declaration' || nodeType === 'method_definition') {
      // **A declaration of either kind always carries `formal_parameters`.** Error recovery replaces the whole
      // declaration with an `ERROR` node rather than handing one over without a parameter list, so the arm reads the
      // lists it finds instead of guarding for a shape the grammar cannot produce.
      for (const params of namedChildrenOf(node).filter(
        (child) => child.type === 'formal_parameters',
      )) {
        for (const [parameterIndex, parameter] of namedChildrenOf(params).entries()) {
          // **A TypeScript parameter is always wrapped** - `required_parameter` or `optional_parameter` - so the name
          // is a child and never the node itself; a bare `identifier` parameter is the JavaScript grammar's shape, and
          // it is `JavaScriptProvider` that reads it. A destructured parameter has no name of its own and is skipped.
          const parameterName = namedChildrenOf(parameter).find((c) => c.type === 'identifier');
          if (parameterName) {
            // **The position, so a call site's argument can be matched to it.** `buildCapture` has no place for a
            // property, so the two fields it needs are composed here rather than added to a helper every other caller
            // would then have to ignore.
            captures.push({
              ...this.buildCapture(parameterName, CAPTURE_TAGS.VARIABLE_DEF, parameterName),
              properties: { filePath: this.filePath, parameterIndex: String(parameterIndex) },
            });
          }
        }
      }
    }

    // **The use side, which TypeScript never emitted.** It recorded a definition, a constant and a call, and nothing
    // that says a name is *used* - so the pipeline had a definition and no use to follow and produced no finding.
    if (nodeType === 'call_expression') {
      // **A call expression always has its callee and its argument list** - the type says so, and `foo` / `foo(` parse
      // to an `ERROR` node rather than to a call missing either - so both children are read rather than checked.
      const callee = node.child(0);
      const isMethod = callee.type === 'member_expression';
      captures.push(
        this.buildCapture(
          node,
          isMethod ? CAPTURE_TAGS.METHOD_CALL : CAPTURE_TAGS.FUNCTION_CALL,
          callee,
        ),
      );
      const args = node.child(1);
      // **Every name in an argument, not only the ones written bare.** `db.query(id + suffix)` passes taint through
      // an expression, and recording only the direct identifier children left the sink statement contributing no use -
      // a flow that stops one statement before the sink.
      for (const [argIndex, argument] of namedChildrenOf(args).entries()) {
        for (const name of this.namesIn(argument)) {
          // **The argument the name sits in.** A template literal with two substitutions is ONE argument, and without
          // this its two names were counted as two - so the taint was held to be at a position the callee has no
          // parameter for, and the flow reached no sink.
          captures.push({
            ...this.buildCapture(name, CAPTURE_TAGS.VARIABLE_ACCESS, name),
            properties: { filePath: this.filePath, argIndex: String(argIndex) },
          });
        }
      }
    }

    if (nodeType === 'return_statement') {
      // **The only place a value leaves a function.** Nothing in this provider recorded a return either, so a
      // callee's returns read no names and the caller had to assume every argument reached every result. A bare
      // `return;` names nothing, which is why the list of names can be empty and needs no guard.
      const value = namedChildrenOf(node)[0];
      if (value !== undefined) this.captureReturnAccesses(node, this.namesIn(value), captures);
    }

    if (nodeType === 'import_statement') {
      captures.push(this.buildImportCapture(node));
    }

    // Also capture call expressions (AST-based call sites)
    if (this.isCallNodeType(nodeType)) {
      this.emitCallCapture(node, captures);
    }
  }

  // ---- Import extraction ----

  /**
   * Imports, from **one cursor pass**.
   *
   * **The same change as the capture walk, for the same reason**: a file holds a handful of import statements among
   * thousands of nodes, and the walk materialised all of them to find out. Measured at **13.7 % of a full index**.
   *
   * **A static import is not descended into**, which is what the early `return` in the recursive version said: the
   * depth it was entered at is recorded, and every node below that depth is skipped until the walk climbs back out.
   */
  protected override walkForImports(root: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    /** The depth of the import statement being skipped, or -1 when nothing is being skipped. */
    let insideImport = -1;

    walkPreOrder(root, (type, depth, cursor) => {
      if (insideImport >= 0) {
        if (depth > insideImport) return;
        insideImport = -1;
      }

      if (type === 'import_statement') {
        this.extractTypeScriptImport(cursorNode<TreeSitterSyntaxNode>(cursor), imports);
        insideImport = depth;
        return;
      }

      // Dynamic imports: `import('x')` is a call whose callee is the `import` keyword.
      if (type === 'call_expression') {
        const node = cursorNode<TreeSitterSyntaxNode>(cursor);
        for (const child of childrenOf(node)) {
          if (child.type === 'import') {
            this.extractDynamicImport(node, imports);
            break;
          }
        }
      }
    });
  }

  private extractTypeScriptImport(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    let sourcePath = '';
    let importType: 'named' | 'default' | 'namespace' = 'named';
    const names: string[] = [];

    for (const child of childrenOf(node)) {
      if (child.type === 'string') {
        // Extract path from string like 'foo' or "foo"
        const raw = child.text;
        sourcePath = raw.slice(1, -1);
      }

      if (child.type === 'import_clause') {
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);

          if (sub.type === 'namespace_import') {
            importType = 'namespace';
            // namespace_import (`* as ns`) always carries exactly one identifier.
            const nameNode = this.findDeepChild(sub, 'identifier');
            names.push(nameNode!.text);
          } else if (sub.type === 'named_imports') {
            importType = 'named';
            for (let k = 0; k < sub.childCount; k++) {
              const spec = sub.child(k);
              if (spec.type === 'import_specifier') {
                // An import_specifier holds the imported name and, when aliased
                // (`{ foo as bar }`), a trailing local alias — both `identifier`
                // nodes. Record the trailing identifier (the local binding),
                // matching the regex fallback. A malformed alias (`{ foo as }`)
                // leaves an empty trailing identifier, which is skipped.
                const nameNode = spec.namedChild(spec.namedChildCount - 1);
                if (nameNode.text) names.push(nameNode.text);
              }
            }
          } else {
            // The only remaining import_clause child type is `identifier` (default import).
            importType = 'default';
            names.push(sub.text);
          }
        }
      }
    }

    // Side-effect-only imports (`import 'x'` or `import {} from 'x'`) carry no
    // names and are intentionally skipped.
    if (sourcePath && names.length > 0) {
      imports.push({
        source: sourcePath,
        names,
        type: importType,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractDynamicImport(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    for (const child of childrenOf(node)) {
      if (child.type === 'arguments') {
        // Dynamic imports may be non-literal (`import(specifier)`), in which
        // case the arguments hold an identifier rather than a `string`.
        const strNode = this.findDeepChild(child, 'string');
        if (strNode) {
          imports.push({
            source: strNode.text.slice(1, -1),
            names: [],
            type: 'default',
            lineNumber: node.startPosition.row + 1,
          });
        }
      }
    }
  }

  // ---- Export detection ----

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    // export statement
    if (node.type === 'export_statement') {
      // Check if any declaration inside exports this symbol
      for (const child of childrenOf(node)) {
        if (child.type === 'export_clause') {
          for (let j = 0; j < child.childCount; j++) {
            const spec = child.child(j);
            if (spec.type === 'export_specifier') {
              // `export { foo as bar }` holds two identifiers (local name and
              // alias); either may be the symbol the caller is looking for.
              // export_specifier children are always `identifier` nodes.
              for (let k = 0; k < spec.namedChildCount; k++) {
                const nameNode = spec.namedChild(k);
                if (nameNode.text === symbolName) return true;
              }
            }
          }
        }

        // export default / export const / export interface / ... — the exported
        // declaration is a direct child of the export_statement.
        const declTypes = [
          'function_declaration',
          'class_declaration',
          'interface_declaration',
          'type_alias_declaration',
          'enum_declaration',
          'lexical_declaration',
          'variable_declaration',
        ];
        if (declTypes.includes(child.type)) {
          let nameNode =
            this.findNamedChild(child, 'identifier') ||
            this.findNamedChild(child, 'type_identifier');
          // export const x = 1 → lexical_declaration → variable_declarator → identifier
          if (!nameNode) {
            // lexical/variable_declaration always nests its binding in a variable_declarator.
            const declarator = this.findDeepChild(child, 'variable_declarator');
            nameNode = this.findNamedChild(declarator!, 'identifier');
          }
          if (nameNode && nameNode.text === symbolName) return true;
        }
      }
      return false; // Don't keep recursing
    }

    // tree-sitter-typescript always wraps exported declarations in an
    // `export_statement` (verified for top-level, namespace, module, and ambient
    // declarations), so a bare declaration never carries an `export` prefix.
    // Recurse into children to find symbols nested inside non-export nodes.
    for (const child of childrenOf(node)) {
      if (this.checkExported(child, symbolName)) return true;
    }

    return false;
  }

  // ---- Helpers ----

  private buildCapture(
    node: TreeSitterSyntaxNode,
    tag: CaptureTag,
    nameNode: TreeSitterSyntaxNode,
  ): UnifiedCapture {
    let containerName: string | undefined;
    const container = this.findContainerNode(node);
    if (container) {
      const cn =
        this.findNamedChild(container, 'type_identifier') ||
        this.findNamedChild(container, 'identifier');
      if (cn) containerName = cn.text;
    }

    // **`attachDocComment` because this method replaced the base's capture path.** The provider overrides
    // `walkAndCapture` and builds its captures here, so the base's `emitCapture` never runs for this language - and the
    // doc-comment mechanism lived there and reached nothing. **One call, and every declaration this provider emits
    // carries the comment above it.**
    return this.attachDocComment({
      tag,
      text: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: nameNode.startIndex,
      endByte: nameNode.endIndex,
      name: nameNode.text,
      containerName,
      properties: { filePath: this.filePath },
    });
  }

  private buildImportCapture(node: TreeSitterSyntaxNode): UnifiedCapture {
    let sourcePath = '';
    for (const child of childrenOf(node)) {
      if (child.type === 'string') {
        sourcePath = child.text.slice(1, -1);
        break;
      }
    }

    return {
      tag: CAPTURE_TAGS.IMPORT,
      text: sourcePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: node.startIndex,
      endByte: node.endIndex,
      name: sourcePath,
      properties: { filePath: this.filePath, importType: 'named', names: '' },
    };
  }

  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (const child of namedChildrenOf(node)) {
      if (child.type === type) return child;
    }
    return null;
  }

  private findDeepChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    if (node.type === type) return node;
    for (let i = 0; i < node.namedChildCount; i++) {
      const result = this.findDeepChild(node.namedChild(i), type);
      if (result) return result;
    }
    return null;
  }

  // ---- Fallback (regex-based) ----

  public override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];

    // Function declarations
    const funcRegex = /\b(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = funcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: match[1]!,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Classes
    const classRegex = /(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)/g;
    while ((match = classRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${match[1]!}`,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Interfaces
    const ifaceRegex = /(?:export\s+)?interface\s+(\w+)/g;
    while ((match = ifaceRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `interface ${match[1]!}`,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Type aliases
    const typeRegex = /(?:export\s+)?type\s+(\w+)/g;
    while ((match = typeRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.TYPE_DEF,
        text: `type ${match[1]!}`,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Enums
    const enumRegex = /(?:export\s+)?(?:const\s+)?enum\s+(\w+)/g;
    while ((match = enumRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${match[1]!}`,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Arrow functions
    const arrowRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
    while ((match = arrowRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: match[1]!,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { arrow: 'true', filePath },
      });
    }

    // Variables
    const varRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=\n]+)?\s*=(?![^=]*=>)/g;
    while ((match = varRegex.exec(source)) !== null) {
      captures.push({
        tag: match[0].includes('const') ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF,
        text: match[1]!,
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Imports as captures
    const parsed = this.fallbackExtractImports(source);
    for (const imp of parsed) {
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

    // Decorators
    const decRegex = /@(\w+(?:\([\s\S]*?\))?)/g;
    while ((match = decRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.DECORATOR,
        text: match[0],
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: match[1]!.split('(')[0],
        properties: { decorator: match[1]!.split('(')[0]!, filePath },
      });
    }

    // JSDoc
    const docRegex = /\/\*\*([\s\S]*?)\*\//g;
    while ((match = docRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.DOCSTRING,
        text: match[0],
        startLine: this.lineFromOffset(source, match.index),
        endLine: this.lineFromOffset(source, match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        properties: { filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  public override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const regex =
      /import\s+(?:type\s+)?(?:(\*)\s+as\s+(\w+)|(\{[\s\S]*?\})|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      const path = match[5]!;
      const line = this.lineFromOffset(source, match.index);
      if (match[2]) {
        imports.push({ source: path, names: [match[2]], type: 'namespace', lineNumber: line });
      } else if (match[3]) {
        const names = this.parseNamedImports(match[3]);
        imports.push({ source: path, names, type: 'named', lineNumber: line });
      } else {
        // The regex alternation always captures exactly one group; the remaining
        // case is the default import (capture group 4).
        imports.push({ source: path, names: [match[4]!], type: 'default', lineNumber: line });
      }
    }

    // Dynamic imports
    const dynRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynRegex.exec(source)) !== null) {
      imports.push({
        source: match[1]!,
        names: [],
        type: 'default',
        lineNumber: this.lineFromOffset(source, match.index),
      });
    }
    return imports;
  }

  public override fallbackIsExported(source: string, symbolName: string): boolean {
    const patterns = [
      new RegExp(
        `export\\s+(?:default\\s+)?(?:function|class|const|let|var|interface|type|enum|abstract\\s+class)\\s+${escapeRegex(symbolName)}\\b`,
      ),
      new RegExp(`export\\s*\\{[^}]*\\b${escapeRegex(symbolName)}\\b[^}]*\\}`),
    ];
    return patterns.some((p) => p.test(source));
  }

  private lineFromOffset(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }

  private parseNamedImports(braceContent: string): string[] {
    const names: string[] = [];
    const regex = /(\w+)(?:\s+as\s+(\w+))?/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(braceContent)) !== null) {
      names.push(match[2] ?? match[1]!);
    }
    return names;
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
   * only thing a grammar has to supply. This grammar shares the C-family vocabulary.
   */
  protected override constantDialect(): ConstantDialect {
    return C_FAMILY_CONSTANTS;
  }

  protected override containerDialect(): ContainerDialect {
    return MEMBER_CALLEE_CONTAINERS;
  }

  protected override collectTaint(root: TreeSitterSyntaxNode): TaintCollections {
    return collectCLikeTaint(root);
  }
}

/* escapeRegex is shared with the regex fallback's fallbackIsExported. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
