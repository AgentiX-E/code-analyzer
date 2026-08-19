// @code-analyzer/analyzer — Python Type Resolver
// Hybrid LSP approach: extracts type information from tree-sitter-python AST
// without spawning an external language server process.

import Parser from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import type { TypeInfo, TypeMember, TypeVisibility } from './type-registry.js';

// Lazy import
let PythonLanguage: unknown;

/**
 * Lazily load the tree-sitter-python grammar. Returns the grammar language
 * object, or null if the native binding fails to load. Callers fall back to
 * regex extraction in that case.
 */
function loadPythonLanguage(): unknown {
  if (PythonLanguage) return PythonLanguage;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    PythonLanguage = require('tree-sitter-python');
    return PythonLanguage;
  } catch {
    /* v8 ignore next -- @preserve native module load failure is untestable */
    return null;
  }
}

// ---------------------------------------------------------------------------
// PythonTypeResolver
// ---------------------------------------------------------------------------

export class PythonTypeResolver {
  private filePath = '';
  private readonly loadGrammar: () => unknown;

  /**
   * @param loadGrammar Injectable grammar loader (test seam). Defaults to the
   *   lazy tree-sitter-python loader; returning null triggers regex fallback.
   */
  constructor(loadGrammar: () => unknown = loadPythonLanguage) {
    this.loadGrammar = loadGrammar;
  }

  /**
   * Extract all type definitions from a Python source file.
   */
  extractTypes(source: string, filePath: string): TypeInfo[] {
    this.filePath = filePath;

    const language = this.loadGrammar();
    if (!language) {
      return this.fallbackExtractTypes(source, filePath);
    }

    const parser = new Parser();
    parser.setLanguage(language as Parser.Language);
    const tree = parser.parse(source);
    const types: TypeInfo[] = [];

    this.walkForTypes(tree.rootNode, source, types);

    return types;
  }

  // -------------------------------------------------------------------------
  // AST Walking
  // -------------------------------------------------------------------------

  private walkForTypes(node: SyntaxNode, source: string, types: TypeInfo[]): void {
    const nt = node.type;

    // Class definition
    if (nt === 'class_definition') {
      const info = this.extractClass(node, source);
      /* v8 ignore next -- @preserve -- extractClass always returns a TypeInfo */
      if (info) types.push(info);
    }

    // Function definition (top-level only)
    if (nt === 'function_definition' || nt === 'decorated_definition') {
      const parent = node.parent;
      if (parent && (parent.type === 'module' || parent.type === 'source_file')) {
        const info = this.extractFunction(node, source);
        if (info) types.push(info);
      }
    }

    // Top-level assignment (potentially a type alias or module-level variable)
    if (nt === 'expression_statement' && this.isTopLevel(node)) {
      const assignment = this.findChild(node, 'assignment');
      if (assignment) {
        const lhs = assignment.child(0);
        if (lhs && lhs.type === 'identifier') {
          const varName = lhs.text;
          const qualifiedName = `file:${this.filePath}:${varName}`;

          // Check if it's a type alias (TypeAlias = SomeType)
          const rhs = assignment.child(2);
          if (
            rhs &&
            (rhs.type === 'identifier' ||
              rhs.type === 'attribute' ||
              rhs.type === 'generic_type' ||
              rhs.type === 'call')
          ) {
            types.push({
              name: varName,
              qualifiedName,
              filePath: this.filePath,
              kind: 'variable',
              members: new Map(),
              baseTypes: [],
              implementedInterfaces: [],
              typeParameters: [],
              returnType: rhs.text,
              parameterTypes: [],
              isExported: !varName.startsWith('_'),
              isAbstract: false,
              decorators: [],
              location: {
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
              },
            });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForTypes(node.child(i), source, types);
    }
  }

  // -------------------------------------------------------------------------
  // Extractors
  // -------------------------------------------------------------------------

  private extractClass(node: SyntaxNode, _source: string): TypeInfo | null {
    const name = this.findChildText(node, 'identifier');
    /* v8 ignore next -- @preserve -- class_definition always carries a name */
    if (!name) return null;

    const containerName = this.findContainerName(node);
    const qualifiedName = containerName
      ? `${containerName}.${name}`
      : `file:${this.filePath}:${name}`;

    const isExported = !name.startsWith('_');

    // Base classes (inheritance)
    const baseTypes: string[] = [];
    const superclass =
      this.findChild(node, 'superclasses') || this.findChild(node, 'argument_list');
    if (superclass) {
      for (let i = 0; i < superclass.childCount; i++) {
        const child = superclass.child(i);
        if (child.type === 'identifier' || child.type === 'attribute') {
          baseTypes.push(child.text);
        }
      }
    }

    // Decorators
    const decorators = this.extractDecorators(node, _source);

    // Class body — members
    const members = new Map<string, TypeMember>();
    const body = this.findChild(node, 'block');
    /* v8 ignore next -- @preserve -- class_definition always has a block body */
    if (body) {
      this.extractClassMembers(body, _source, members);
    }

    // Check for @dataclass or ABC
    const isAbstract = decorators.some((d) => d.includes('abstractmethod') || d.includes('ABC'));

    return {
      name,
      qualifiedName,
      filePath: this.filePath,
      kind: 'class',
      members,
      baseTypes,
      implementedInterfaces: [],
      typeParameters: [],
      returnType: null,
      parameterTypes: [],
      isExported,
      isAbstract,
      decorators,
      location: {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      },
    };
  }

  private extractFunction(node: SyntaxNode, _source: string): TypeInfo | null {
    // Handle decorated_definition: unwrap to the actual function
    let actualNode = node;
    if (node.type === 'decorated_definition') {
      const inner = this.findChild(node, 'function_definition');
      if (inner) actualNode = inner;
    }

    const name = this.findChildText(actualNode, 'identifier');
    /* v8 ignore next -- @preserve -- function declaration always carries a name */
    if (!name) return null;

    // extractFunction only runs on top-level functions (walkForTypes skips
    // nested ones), so there is never a container to qualify against.
    const qualifiedName = `file:${this.filePath}:${name}`;

    const isExported = !name.startsWith('_');
    const isAsync = this.hasToken(actualNode, 'async');

    // Parameters with type annotations
    const paramTypes: string[] = [];
    const params = this.findChild(actualNode, 'parameters');
    /* v8 ignore next -- @preserve -- function_definition always has parameters */
    if (params) {
      for (let i = 0; i < params.childCount; i++) {
        const p = params.child(i);
        if (
          p.type === 'typed_parameter' ||
          p.type === 'typed_default_parameter' ||
          p.type === 'identifier' ||
          p.type === 'default_parameter'
        ) {
          // Try to find type annotation
          const typeNode = this.findChild(p, 'type');
          paramTypes.push(typeNode ? typeNode.text : 'Any');
        }
      }
    }

    // Return type: tree-sitter-python annotates the `->` return with a `type`
    // node (there is no `return_type` node).
    let returnType: string | null = null;
    const returnAnnotation = this.findChild(actualNode, 'type');
    if (returnAnnotation) {
      returnType = returnAnnotation.text;
    }

    // Decorators live on the decorated_definition that wraps `actualNode`.
    const decorators = this.extractDecorators(actualNode, _source);

    return {
      name,
      qualifiedName,
      filePath: this.filePath,
      kind: 'function',
      members: new Map(),
      baseTypes: [],
      implementedInterfaces: [],
      typeParameters: [],
      returnType,
      parameterTypes: paramTypes,
      isExported,
      isAbstract: false,
      decorators,
      isAsync: isAsync || undefined,
      location: {
        startLine: actualNode.startPosition.row + 1,
        endLine: actualNode.endPosition.row + 1,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Class Members
  // -------------------------------------------------------------------------

  private extractClassMembers(
    body: SyntaxNode,
    _source: string,
    members: Map<string, TypeMember>,
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);

      // Method (function_definition inside class)
      if (child.type === 'function_definition' || child.type === 'decorated_definition') {
        let methodNode = child;
        if (child.type === 'decorated_definition') {
          const inner = this.findChild(child, 'function_definition');
          /* v8 ignore next -- @preserve -- a decorated method always wraps a function */
          if (inner) methodNode = inner;
        }

        const methodName = this.findChildText(methodNode, 'identifier');
        if (!methodName || (methodName.startsWith('__') && methodName.endsWith('__'))) {
          continue; // Skip dunder methods
        }

        const isStatic = this.hasDecorator(methodNode, 'staticmethod');
        const isAsync = this.hasToken(methodNode, 'async');

        // First parameter check for 'self' or 'cls' → instance/class method
        const params = this.findChild(methodNode, 'parameters');
        let paramTypes: string[] = [];
        /* v8 ignore next -- @preserve -- a method always has parameters */
        if (params) {
          const paramNodes = params.namedChildren;
          paramTypes = paramNodes
            .filter((p) => p.type !== 'comment')
            .map((p) => {
              const typeNode = this.findChild(p, 'type');
              return typeNode ? typeNode.text : 'Any';
            });
        }

        let returnType = 'None';
        // tree-sitter-python annotates the `->` return with a `type` node.
        const returnNode = this.findChild(methodNode, 'type');
        if (returnNode) {
          returnType = returnNode.text;
        }

        const methodType = `(${paramTypes.join(', ')}) => ${returnType}`;

        members.set(methodName, {
          name: methodName,
          type: methodType,
          visibility:
            methodName.startsWith('_') && !methodName.startsWith('__')
              ? 'protected'
              : methodName.startsWith('__')
                ? 'private'
                : 'public',
          isStatic,
          isOptional: false,
          isAsync,
          parameterTypes: paramTypes,
          returnType,
        });
      }

      // Class attribute assignment
      if (child.type === 'expression_statement') {
        const assignment = this.findChild(child, 'assignment');
        if (assignment) {
          const lhs = assignment.child(0);
          if (lhs && lhs.type === 'identifier') {
            const attrName = lhs.text;
            const rhs = assignment.child(2);
            /* v8 ignore next -- @preserve -- an assignment always has a RHS */
            const attrType = rhs ? rhs.text : 'Any';

            members.set(attrName, {
              name: attrName,
              type: attrType,
              visibility:
                attrName.startsWith('_') && !attrName.startsWith('__')
                  ? 'protected'
                  : attrName.startsWith('__')
                    ? 'private'
                    : 'public',
              isStatic: true, // Class-level attributes are static by default in Python
              isOptional: false,
              isAsync: false,
              parameterTypes: [],
              returnType: attrType,
            });
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private findChildText(node: SyntaxNode, type: string): string | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === type) return child.text;
    }
    return null;
  }

  private findChild(node: SyntaxNode, type: string): SyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === type) return child;
    }
    return null;
  }

  /** Check for an anonymous keyword token (e.g. `async`) among raw children. */
  private hasToken(node: SyntaxNode, token: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i).type === token) return true;
    }
    return false;
  }

  private findContainerName(node: SyntaxNode): string | null {
    let current: SyntaxNode | null = node.parent;
    while (current) {
      if (current.type === 'class_definition') {
        const name = this.findChildText(current, 'identifier');
        /* v8 ignore next -- @preserve -- class_definition always carries a name */
        if (name) {
          const parentContainer = this.findContainerName(current);
          return parentContainer ? `${parentContainer}.${name}` : name;
        }
      }
      current = current.parent;
    }
    return null;
  }

  private extractDecorators(node: SyntaxNode, _source: string): string[] {
    // Python decorators are preceding sibling nodes
    const parent = node.parent;
    /* v8 ignore next -- @preserve -- declaration nodes always have a parent */
    if (!parent) return [];

    const decorators: string[] = [];
    let foundSelf = false;

    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i);
      /* v8 ignore next -- @preserve -- index is bounded by childCount */
      if (!child) continue;
      if (child === node) {
        foundSelf = true;
        continue;
      }
      if (!foundSelf && child.type === 'decorator') {
        decorators.push(child.text);
      }
    }

    return decorators;
  }

  private hasDecorator(node: SyntaxNode, decoratorName: string): boolean {
    const decorators = this.extractDecorators(node, '');
    return decorators.some((d) => d.includes(decoratorName));
  }

  private isTopLevel(node: SyntaxNode): boolean {
    const parent = node.parent;
    /* v8 ignore next -- @preserve -- declarations always have a parent */
    if (!parent) return true;
    return parent.type === 'module' || parent.type === 'source_file';
  }

  // -------------------------------------------------------------------------
  // Fallback
  // -------------------------------------------------------------------------

  private fallbackExtractTypes(source: string, filePath: string): TypeInfo[] {
    const types: TypeInfo[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;

    // Class definitions
    const classRegex = /class\s+(\w+)(?:\((.*?)\))?:/g;
    let m: RegExpExecArray | null;
    while ((m = classRegex.exec(source)) !== null) {
      const name = m[1]!;
      const bases = m[2]
        ? m[2]
            .split(/\s*,\s*/)
            .map((b) => b.trim())
            .filter(Boolean)
        : [];
      types.push({
        name,
        qualifiedName: `file:${filePath}:${name}`,
        filePath,
        kind: 'class',
        members: new Map(),
        baseTypes: bases,
        implementedInterfaces: [],
        typeParameters: [],
        returnType: null,
        parameterTypes: [],
        isExported: !name.startsWith('_'),
        isAbstract: false,
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    // Function definitions
    const funcRegex = /(?:async\s+)?def\s+(\w+)\(([^)]*)\)(?:\s*->\s*(\w+))?/g;
    while ((m = funcRegex.exec(source)) !== null) {
      const name = m[1]!;
      const params = m[2]
        ? m[2]
            .split(',')
            .map((p) => p.trim().split(':')[0]?.trim())
            .filter(Boolean)
        : [];
      const returnType = m[3] || null;

      types.push({
        name,
        qualifiedName: `file:${filePath}:${name}`,
        filePath,
        kind: 'function',
        members: new Map(),
        baseTypes: [],
        implementedInterfaces: [],
        typeParameters: [],
        returnType,
        parameterTypes: params,
        isExported: !name.startsWith('_'),
        isAbstract: false,
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    return types;
  }
}
