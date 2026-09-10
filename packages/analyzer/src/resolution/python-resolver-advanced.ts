// @code-analyzer/analyzer — Advanced Python Type Resolver
// Extends the base TypeResolverBase to provide:
//   1. Type annotations (def foo(x: int) -> str)
//   2. Generic types (List[T], Dict[K,V], Optional[T], Union[A,B])
//   3. Class inheritance (class Foo(Bar))
//   4. Protocol types (class SupportsClose(Protocol))
//   5. Decorator type transformation (@dataclass, @overload)
//
// Uses tree-sitter-python AST for structural extraction and falls back
// to regex-based parsing.

import Parser from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import type { TypeInfo } from '../resolution/type-registry.js';
import {
  TypeResolverBase,
  type ResolvedType,
  type TypeContext,
} from '../resolution/type-resolver-base.js';

// ---------------------------------------------------------------------------
// Lazy language loader
// ---------------------------------------------------------------------------

let PythonLanguage: unknown;

/**
 * Lazily load the tree-sitter-python grammar. The grammar is a direct dependency
 * of the analyzer, so the require never throws and this always returns
 * a truthy grammar object. A falsy result is only reachable through the
 * injectable grammar loader (test seam).
 */
function loadPythonLanguage(): unknown {
  if (PythonLanguage) return PythonLanguage;
  // tree-sitter-python is a direct dependency of the analyzer, so this
  // require never throws in the bundled runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PythonLanguage = require('tree-sitter-python');
  return PythonLanguage;
}

// ---------------------------------------------------------------------------
// PythonAdvancedResolver
// ---------------------------------------------------------------------------

export class PythonAdvancedResolver extends TypeResolverBase {
  readonly language = 'python';
  private source = '';
  private filePath = '';
  private typeCache = new Map<string, ResolvedType>();
  private readonly loadGrammar: () => unknown;

  /**
   * @param loadGrammar Injectable grammar loader (test seam). Defaults to the
   *   lazy `loadPythonLanguage` helper. Returns the grammar language object
   *   or null to trigger regex fallback extraction.
   */
  constructor(loadGrammar: () => unknown = loadPythonLanguage) {
    super();
    this.loadGrammar = loadGrammar;
  }

  // -----------------------------------------------------------------------
  // TypeResolverBase implementation
  // -----------------------------------------------------------------------

  async resolveType(typeName: string, context: TypeContext): Promise<ResolvedType | null> {
    const normalized = this.normalizeTypeName(typeName);

    // Check cache
    const cached = this.typeCache.get(normalized);
    if (cached) return cached;

    let resolved: ResolvedType | null = null;

    // 1. Built-in Python primitives
    if (this.isPythonPrimitive(normalized)) {
      resolved = this.mapPythonPrimitive(normalized);
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 2. Generic types: List[T], Dict[K,V], Optional[T], Union[A,B], etc.
    resolved = this.resolvePythonGeneric(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 3. Union types (Union[A, B] or A | B syntax for Python 3.10+)
    resolved = this.resolvePythonUnion(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 4. Optional types
    resolved = this.resolvePythonOptional(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 5. Function types from annotations
    resolved = this.resolvePythonCallable(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 6. Type alias / external lookup
    if (context.resolveExternal) {
      resolved = context.resolveExternal(normalized);
      if (resolved) {
        this.typeCache.set(normalized, resolved);
        return resolved;
      }
    }

    this.typeCache.set(normalized, this.unknownType(normalized));
    return null;
  }

  getAllTypes(): Map<string, ResolvedType> {
    return new Map(this.typeCache);
  }

  // -----------------------------------------------------------------------
  // Legacy compatibility
  // -----------------------------------------------------------------------

  extractTypes(source: string, filePath: string): TypeInfo[] {
    this.source = source;
    this.filePath = filePath;

    const language = this.loadGrammar();
    if (!language) {
      return this.fallbackExtractTypes(source, filePath);
    }

    const parser = new Parser();
    parser.setLanguage(language as Parser.Language);
    const tree = parser.parse(source);
    const types: TypeInfo[] = [];

    this.walkAST(tree.rootNode, source, types);
    return types;
  }

  // -----------------------------------------------------------------------
  // Type resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve Python generic types:
   *   List[T], Dict[K,V], Tuple[T,...], Set[T], FrozenSet[T],
   *   Iterable[T], Iterator[T], Sequence[T], Mapping[K,V],
   *   MutableMapping[K,V], DefaultDict[K,V], Counter[T],
   *   Type[T], Literal[...], Final[T], ClassVar[T]
   */
  private resolvePythonGeneric(typeName: string, _context: TypeContext): ResolvedType | null {
    // Support both old-style Generic[T] and new-style list[int] (Python 3.9+)
    const match = typeName.match(/^(\w+)\s*\[\s*(.+?)\s*\]$/);
    if (!match) return null;

    const base = match[1]!;
    const argsStr = match[2]!;

    // Route Optional/Union/Callable to their dedicated handlers
    if (base === 'Optional') return null;
    if (base === 'Union') return null;
    if (base === 'Callable') return null;

    const args = this.splitTopLevelCommas(argsStr);
    const resolvedArgs = args.map((a) => this.makePythonUnresolved(a.trim()));

    const handlers: Record<string, (resolvedArgs: ResolvedType[]) => ResolvedType | null> = {
      List: (a) => (a.length === 1 ? this.genericType('List', a) : null),
      list: (a) => (a.length === 1 ? this.genericType('list', a) : null),
      Dict: (a) => (a.length === 2 ? this.genericType('Dict', a) : null),
      dict: (a) => (a.length === 2 ? this.genericType('dict', a) : null),
      Tuple: (a) => this.genericType('Tuple', a),
      tuple: (a) => this.genericType('tuple', a),
      Set: (a) => (a.length === 1 ? this.genericType('Set', a) : null),
      set: (a) => (a.length === 1 ? this.genericType('set', a) : null),
      FrozenSet: (a) => (a.length === 1 ? this.genericType('FrozenSet', a) : null),
      frozenset: (a) => (a.length === 1 ? this.genericType('frozenset', a) : null),
      Iterable: (a) => (a.length === 1 ? this.genericType('Iterable', a) : null),
      Iterator: (a) => (a.length === 1 ? this.genericType('Iterator', a) : null),
      Sequence: (a) => (a.length === 1 ? this.genericType('Sequence', a) : null),
      Mapping: (a) => (a.length === 2 ? this.genericType('Mapping', a) : null),
      MutableMapping: (a) => (a.length === 2 ? this.genericType('MutableMapping', a) : null),
      Type: (a) => (a.length === 1 ? this.genericType('Type', a) : null),
      Literal: (a) => this.genericType('Literal', a),
      Final: (a) => (a.length === 1 ? this.genericType('Final', a) : null),
      ClassVar: (a) => (a.length === 1 ? this.genericType('ClassVar', a) : null),
      Deque: (a) => (a.length === 1 ? this.genericType('Deque', a) : null),
    };

    if (handlers[base]) {
      const result = handlers[base]!(resolvedArgs);
      if (result) return result;
    }

    // Unknown generic — return a descriptor anyway
    return {
      name: `${base}[${resolvedArgs.map((a) => a.name).join(', ')}]`,
      kind: 'generic',
      genericArgs: resolvedArgs,
    };
  }

  /**
   * Resolve Python Union types: Union[A, B] or A | B (Python 3.10+)
   */
  resolvePythonUnion(typeName: string, _context: TypeContext): ResolvedType | null {
    // union[A, B] - use the underlying types
    const unionMatch = typeName.match(/^\s*(?:Union)\s*\[\s*(.+?)\s*\]\s*$/);
    if (unionMatch) {
      const args = this.splitTopLevelCommas(unionMatch[1]!);
      const parts = args.map((a) => this.makePythonUnresolved(a.trim()));
      return this.unionType(parts);
    }

    // Python 3.10+ union syntax: A | B
    const parts = this.splitTopLevelPythonUnions(typeName);
    if (parts.length > 1) {
      const resolved = parts.map((p) => this.makePythonUnresolved(p.trim()));
      return this.unionType(resolved);
    }

    return null;
  }

  /**
   * Resolve Python Optional types: Optional[T]
   */
  resolvePythonOptional(typeName: string, _context: TypeContext): ResolvedType | null {
    const match = typeName.match(/^\s*(?:Optional)\s*\[\s*(.+?)\s*\]\s*$/);
    if (!match) return null;

    const inner = this.makePythonUnresolved(match[1]!.trim());
    return {
      ...inner,
      isNullable: true,
      name: `Optional[${inner.name}]`,
    };
  }

  /**
   * Resolve Python Callable type: Callable[[Arg1, Arg2], ReturnType]
   */
  resolvePythonCallable(typeName: string, _context: TypeContext): ResolvedType | null {
    // PEP 484 Callable syntax: Callable[[int, str], bool]
    const match = typeName.match(/^\s*Callable\s*\[\s*\[([^\]]*)\]\s*,\s*(.+?)\s*\]\s*$/);
    if (!match) return null;

    const argsStr = match[1]!.trim();
    const returnStr = match[2]!.trim();

    const paramTypes = argsStr
      ? argsStr.split(',').map((a) => this.makePythonUnresolved(a.trim()))
      : [];
    const returnType = this.makePythonUnresolved(returnStr);

    return {
      name: `Callable[[${paramTypes.map((p) => p.name).join(', ')}], ${returnType.name}]`,
      kind: 'function',
      parameterTypes: paramTypes,
      returnType,
    };
  }

  /**
   * Resolve Python protocol types: class Foo(Protocol)
   * Handles structural subtyping via typing.Protocol.
   */
  resolveProtocolType(_typeName: string, _context: TypeContext): ResolvedType | null {
    // Protocol types are just object types with protocol semantics
    // This is communicated via the base class "Protocol"
    return null; // Resolved by the class extraction in walkAST
  }

  /**
   * Parse Python decorators and transform the type accordingly.
   * @dataclass → auto-generates __init__ with all annotated fields
   * @overload → marks function as overloaded variant
   * @staticmethod / @classmethod → changes method binding
   */
  resolveDecoratorTransform(decorators: string[], originalType: ResolvedType): ResolvedType {
    let transformed = { ...originalType };
    const members = { ...(transformed.members || {}) };

    for (const dec of decorators) {
      const name = dec.replace(/^@/, '').trim().split('(')[0]!.trim();

      if (name === 'dataclass' || name === 'dataclasses.dataclass') {
        // Auto-generate __init__ and __repr__ etc.
        members['__init__'] = this.functionType('__init__', [], this.primitive('None'));
      }

      if (name === 'overload') {
        transformed = {
          ...transformed,
          documentation:
            (transformed.documentation || '') +
            '\n@overload: this function has multiple signatures',
        };
      }

      if (name === 'property') {
        // Properties act as computed attributes
        transformed.kind = 'object';
      }

      if (name === 'abstractmethod' || name === 'abc.abstractmethod') {
        // Marked as abstract
      }

      if (name === 'final') {
        // PEP 591: Final decorator
      }
    }

    return { ...transformed, members };
  }

  // -----------------------------------------------------------------------
  // AST Walking
  // -----------------------------------------------------------------------

  private walkAST(node: SyntaxNode, source: string, types: TypeInfo[]): void {
    const nt = node.type;

    if (nt === 'class_definition') {
      types.push(this.extractClass(node, source));
    }

    if (nt === 'function_definition' || nt === 'decorated_definition') {
      const info = this.extractTopLevelFunction(node, source);
      if (info) types.push(info);
    }

    if (nt === 'expression_statement') {
      const info = this.extractTypeAlias(node, source);
      if (info) types.push(info);
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAST(node.child(i), source, types);
    }
  }

  // -----------------------------------------------------------------------
  // Extractors
  // -----------------------------------------------------------------------

  private extractClass(node: SyntaxNode, _source: string): TypeInfo {
    // A class_definition always carries its name as a direct `identifier` child.
    const name = this.childText(node, 'identifier')!;

    const qn = `file:${this.filePath}:${name}`;
    const exported = !name.startsWith('_');
    const baseTypes = this.extractBaseTypes(node);
    const decorators = this.extractDecorators(node);
    const isAbstract =
      decorators.some(
        (d) => d.includes('abstractmethod') || d.includes('ABC') || d.includes('ABCMeta'),
      ) || baseTypes.some((b) => b === 'ABC' || b === 'ABCMeta' || b === 'abc.ABC');
    const isDataclass = decorators.some((d) => d.includes('dataclass'));
    const isProtocol = baseTypes.includes('Protocol');

    const members = new Map();
    // tree-sitter-python wraps a class body in a `block` node.
    const body = this.findChild(node, 'block')!;

    // Add __init__ params as members for dataclasses
    if (isDataclass) {
      this.extractDataclassFields(body, members);
    }

    this.extractClassMembers(body, _source, members);

    return {
      name,
      qualifiedName: qn,
      filePath: this.filePath,
      kind: isProtocol ? 'interface' : 'class',
      members,
      baseTypes,
      implementedInterfaces: isProtocol ? [name] : [],
      typeParameters: [],
      returnType: null,
      parameterTypes: [],
      isExported: exported,
      isAbstract,
      decorators,
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  private extractTopLevelFunction(node: SyntaxNode, _source: string): TypeInfo | null {
    let actualNode = node;
    if (node.type === 'decorated_definition') {
      const inner = this.findChild(node, 'function_definition');
      if (inner) actualNode = inner;
    }

    const name = this.childText(actualNode, 'identifier');
    if (!name) return null;

    const qn = `file:${this.filePath}:${name}`;
    const exported = !name.startsWith('_');
    const isAsync = this.hasAsyncModifier(actualNode);
    const paramTypes = this.extractParamTypes(actualNode);

    let returnType: string | null = null;
    // tree-sitter-python places the `->` return annotation as a direct `type`
    // child of the function_definition node.
    const retAnn = this.findChild(actualNode, 'type');
    if (retAnn) {
      returnType = retAnn.text;
    }

    const decorators = this.extractDecorators(actualNode);

    return {
      name,
      qualifiedName: qn,
      filePath: this.filePath,
      kind: 'function',
      members: new Map(),
      baseTypes: [],
      implementedInterfaces: [],
      typeParameters: [],
      returnType,
      parameterTypes: paramTypes,
      isExported: exported,
      isAbstract: false,
      decorators,
      isAsync: isAsync || undefined,
      location: {
        startLine: actualNode.startPosition.row + 1,
        endLine: actualNode.endPosition.row + 1,
      },
    };
  }

  private extractTypeAlias(node: SyntaxNode, _source: string): TypeInfo | null {
    const assignment = this.findChildAll(node, 'assignment');
    if (!assignment) return null;

    const lhs = assignment.child(0)!;
    // Dotted attribute targets (a.b = ...) are member writes, not type aliases.
    if (lhs.type !== 'identifier') return null;
    const varName = lhs.text;
    const rhs = assignment.child(2)!;

    // Check if this is a type annotation (colon) or value assignment (equals)
    const sep = assignment.child(1);
    if (sep && (sep.text === ':' || sep.type === ':')) {
      // Type annotation: x: int
      const typeText = rhs.text;
      return {
        name: varName,
        qualifiedName: `file:${this.filePath}:${varName}`,
        filePath: this.filePath,
        kind: 'variable',
        members: new Map(),
        baseTypes: [],
        implementedInterfaces: [],
        typeParameters: [],
        returnType: typeText,
        parameterTypes: [],
        isExported: !varName.startsWith('_'),
        isAbstract: false,
        decorators: [],
        location: {
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        },
      };
    }

    // Detect TypeAlias = SomeType patterns
    if (
      rhs.type === 'identifier' ||
      rhs.type === 'attribute' ||
      rhs.type === 'generic_type' ||
      rhs.type === 'call' ||
      rhs.type === 'subscript' ||
      rhs.type === 'string' ||
      rhs.type === 'none'
    ) {
      return {
        name: varName,
        qualifiedName: `file:${this.filePath}:${varName}`,
        filePath: this.filePath,
        kind: rhs.text === 'None' ? 'variable' : 'type',
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
      };
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Member Extraction
  // -----------------------------------------------------------------------

  private extractClassMembers(body: SyntaxNode, _source: string, members: Map<string, any>): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);

      if (child.type === 'function_definition' || child.type === 'decorated_definition') {
        let methodNode = child;
        if (child.type === 'decorated_definition') {
          // A decorated_definition may wrap either a function or a nested class;
          // only the former is a method.
          const inner = this.findChild(child, 'function_definition');
          if (inner) methodNode = inner;
        }

        const mName = this.childText(methodNode, 'identifier');
        if (!mName || (mName.startsWith('__') && mName.endsWith('__'))) continue;

        const isStatic = this.hasDecorator(methodNode, 'staticmethod');
        const isAsync = this.hasAsyncModifier(methodNode);
        const paramTypes = this.extractParamTypes(methodNode);

        let retType = 'None';
        // tree-sitter-python uses a `type` node for the `->` return annotation.
        const retNode = this.findChild(methodNode, 'type');
        if (retNode) {
          retType = retNode.text;
        }

        members.set(mName, {
          name: mName,
          type: `(${paramTypes.join(', ')}) => ${retType}`,
          visibility: mName.startsWith('__')
            ? 'private'
            : mName.startsWith('_')
              ? 'protected'
              : 'public',
          isStatic,
          isOptional: false,
          isAsync,
          parameterTypes: paramTypes,
          returnType: retType,
        });
      }

      if (child.type === 'expression_statement') {
        const assignment = this.findChildAll(child, 'assignment');
        if (assignment) {
          const lhs = assignment.child(0)!;
          // Dotted attribute targets (a.b = ...) are member writes, not fields.
          if (lhs.type === 'identifier') {
            const attrName = lhs.text;
            // Check if this is a type annotation (colon) or value assignment (equals)
            const sep = assignment.child(1)!;
            if (sep.text === ':' || sep.type === ':') {
              // Type-annotated attribute: x: int
              const attrType = assignment.child(2)!.text;
              members.set(attrName, {
                name: attrName,
                type: attrType,
                visibility: attrName.startsWith('__')
                  ? 'private'
                  : attrName.startsWith('_')
                    ? 'protected'
                    : 'public',
                isStatic: true,
                isOptional: false,
                isAsync: false,
                parameterTypes: [],
                returnType: attrType,
              });
            } else {
              // Regular assignment: x = value
              const attrType = assignment.child(2)!.text;
              members.set(attrName, {
                name: attrName,
                type: attrType,
                visibility: attrName.startsWith('__')
                  ? 'private'
                  : attrName.startsWith('_')
                    ? 'protected'
                    : 'public',
                isStatic: true,
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
  }

  /**
   * Extract dataclass fields from __init__ or annotated class attributes.
   */
  private extractDataclassFields(body: SyntaxNode, members: Map<string, any>): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);

      // Annotated assignment: name: Type = default
      if (child.type === 'expression_statement') {
        // tree-sitter-python uses 'assignment' node for x: int
        const assignment = this.findChildAll(child, 'assignment');
        if (assignment) {
          const sep = assignment.child(1)!;
          if (sep.text === ':' || sep.type === ':') {
            const lhs = assignment.child(0)!;
            // Dotted attributes (a.b = ...) are not dataclass fields.
            if (lhs.type === 'identifier') {
              const attrType = assignment.child(2)!.text;
              members.set(lhs.text, {
                name: lhs.text,
                type: attrType,
                visibility: 'public',
                isStatic: false,
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
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private makePythonUnresolved(name: string): ResolvedType {
    const trimmed = name.trim();
    if (trimmed === 'None') return { name: 'None', kind: 'primitive', isNullable: true };
    if (this.isPythonPrimitive(trimmed)) return this.mapPythonPrimitive(trimmed);
    return { name: trimmed, kind: 'unknown' };
  }

  private isPythonPrimitive(name: string): boolean {
    const primitives = new Set([
      'int',
      'float',
      'complex',
      'bool',
      'str',
      'bytes',
      'bytearray',
      'memoryview',
      'None',
      'Any',
    ]);
    return primitives.has(name);
  }

  private mapPythonPrimitive(name: string): ResolvedType {
    const map: Record<string, { name: string; kind: ResolvedType['kind'] }> = {
      int: { name: 'int', kind: 'primitive' },
      float: { name: 'float', kind: 'primitive' },
      complex: { name: 'complex', kind: 'primitive' },
      bool: { name: 'bool', kind: 'primitive' },
      str: { name: 'str', kind: 'primitive' },
      bytes: { name: 'bytes', kind: 'primitive' },
      bytearray: { name: 'bytearray', kind: 'primitive' },
      None: { name: 'None', kind: 'primitive' },
      Any: { name: 'Any', kind: 'unknown' },
    };
    const entry = map[name];
    return entry ? { ...entry, isNullable: name === 'None' } : { name, kind: 'primitive' };
  }

  private splitTopLevelPythonUnions(typeName: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < typeName.length; i++) {
      const ch = typeName[i]!;
      if (ch === '[') depth++;
      else if (ch === ']') depth--;
      else if (ch === '|' && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) result.push(trimmed);
        current = '';
        continue;
      }
      current += ch;
    }
    const trimmed = current.trim();
    if (trimmed) result.push(trimmed);
    return result;
  }

  private extractBaseTypes(node: SyntaxNode): string[] {
    const bases: string[] = [];
    // Base classes live in the `argument_list` node; a base-less class
    // (class Foo:) has no argument_list and must yield an empty list.
    const superclass = this.findChild(node, 'argument_list');
    if (!superclass) return bases;
    for (let i = 0; i < superclass.childCount; i++) {
      const child = superclass.child(i);
      if (child.type === 'identifier' || child.type === 'attribute') {
        bases.push(child.text);
      }
      // Handle generic base: class Foo(Generic[T]) — the base name is the
      // text before the type-argument bracket (works for qualified names too).
      if (child.type === 'generic_type' || child.type === 'subscript') {
        bases.push(child.text.split('[')[0]!);
      }
    }
    return bases;
  }

  private extractParamTypes(node: SyntaxNode): string[] {
    const paramTypes: string[] = [];
    // Every function_definition carries a `parameters` node, even for no-arg
    // functions (it wraps an empty `()`).
    const params = this.findChild(node, 'parameters')!;

    for (let i = 0; i < params.childCount; i++) {
      const p = params.child(i);
      if (
        p.type === 'typed_parameter' ||
        p.type === 'typed_default_parameter' ||
        p.type === 'identifier' ||
        p.type === 'default_parameter'
      ) {
        // Skip 'self' / 'cls'
        const paramName = p.type === 'identifier' ? p.text : this.childText(p, 'identifier')!;
        if (paramName === 'self' || paramName === 'cls') continue;

        const typeNode = this.findChild(p, 'type');
        paramTypes.push(typeNode ? typeNode.text : 'Any');
      }
    }
    return paramTypes;
  }

  private extractDecorators(node: SyntaxNode): string[] {
    const decs: string[] = [];
    // Callers always pass a declaration node (never the root), so a parent exists.
    const parent = node.parent!;
    let foundSelf = false;
    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i)!;
      if (child === node) {
        foundSelf = true;
        continue;
      }
      if (!foundSelf && child.type === 'decorator') decs.push(child.text);
    }
    return decs;
  }

  private hasDecorator(node: SyntaxNode, decoratorName: string): boolean {
    return this.extractDecorators(node).some((d) => d.includes(decoratorName));
  }

  /**
   * Detect the `async` modifier. tree-sitter-python represents `async` as an
   * anonymous token child of the function_definition, which `findChild` (that
   * only walks named children) cannot see. Scan all children instead.
   */
  private hasAsyncModifier(node: SyntaxNode): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === 'async') return true;
    }
    return false;
  }

  private childText(node: SyntaxNode, type: string): string | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c && c.type === type && c.text) return c.text;
    }
    return null;
  }

  private findChild(node: SyntaxNode, type: string): SyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c && c.type === type) return c;
    }
    return null;
  }

  private findChildAll(node: SyntaxNode, type: string): SyntaxNode | null {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.type === type) return c;
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Fallback regex-based extraction
  // -----------------------------------------------------------------------

  private fallbackExtractTypes(source: string, filePath: string): TypeInfo[] {
    const types: TypeInfo[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;

    // Classes with inheritance
    const classRx = /(?:@\w+\s*\([^)]*\)\s*\n\s*)*class\s+(\w+)(?:\(([^)]*)\))?:/g;
    let m: RegExpExecArray | null;
    while ((m = classRx.exec(source)) !== null) {
      const bases = m[2]
        ? m[2]
            .split(',')
            .map((b) => b.trim())
            .filter(Boolean)
        : [];
      const isProtocol = bases.some((b) => b === 'Protocol');
      types.push({
        name: m[1]!,
        qualifiedName: `file:${filePath}:${m[1]}`,
        filePath,
        kind: isProtocol ? 'interface' : 'class',
        members: new Map(),
        baseTypes: bases,
        implementedInterfaces: isProtocol ? [m[1]!] : [],
        typeParameters: [],
        returnType: null,
        parameterTypes: [],
        isExported: !m[1]!.startsWith('_'),
        isAbstract: false,
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    // Functions with type annotations
    const funcRx =
      /(?:@\w+\s*\n\s*)*(?:async\s+)?def\s+(\w+)\(([^)]*)\)(?:\s*->\s*(\w+(?:\[\w+(?:,\s*\w+)*\])?))?/g;
    while ((m = funcRx.exec(source)) !== null) {
      const params = m[2]
        ? m[2].split(',').map((p) => {
            const parts = p.trim().split(':');
            return parts.length > 1 ? parts[1]!.trim() : 'Any';
          })
        : [];
      types.push({
        name: m[1]!,
        qualifiedName: `file:${filePath}:${m[1]}`,
        filePath,
        kind: 'function',
        members: new Map(),
        baseTypes: [],
        implementedInterfaces: [],
        typeParameters: [],
        returnType: m[3] || null,
        parameterTypes: params,
        isExported: !m[1]!.startsWith('_'),
        isAbstract: false,
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    return types;
  }
}
