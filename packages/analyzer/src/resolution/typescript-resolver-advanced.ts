// @code-analyzer/analyzer — Advanced TypeScript Type Resolver
// Extends the base TypeResolverBase to provide:
//   1. Generic type inference (Array<T>, Map<K,V>, Promise<T>, Partial<T>, Record<K,V>)
//   2. Union / intersection types (string | number, A & B)
//   3. Indexed access types (T[K], typeof x)
//   4. Conditional types (T extends U ? X : Y)
//   5. Mapped types ({ [K in keyof T]: V })
//   6. Template literal types (`${prefix}${string}` — basic)
//
// Uses tree-sitter-typescript AST for structural extraction and falls back
// to regex-based parsing for edge cases.

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

let TSLanguage: unknown;

/**
 * Lazily load the tree-sitter-typescript TSX grammar. The grammar is a direct dependency
 * of the analyzer, so the require never throws and this always returns
 * a truthy grammar object. A falsy result is only reachable through the
 * injectable grammar loader (test seam).
 */
function loadTSLanguage(): unknown {
  if (TSLanguage) return TSLanguage;
  // tree-sitter-typescript is a direct dependency of the analyzer, so this
  // require never throws in the bundled runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  TSLanguage = require('tree-sitter-typescript').tsx;
  return TSLanguage;
}

// ---------------------------------------------------------------------------
// TypeScriptAdvancedResolver
// ---------------------------------------------------------------------------

export class TypeScriptAdvancedResolver extends TypeResolverBase {
  readonly language = 'typescript';
  private source = '';
  private filePath = '';
  private typeCache = new Map<string, ResolvedType>();
  private readonly loadGrammar: () => unknown;

  /**
   * @param loadGrammar Injectable grammar loader (test seam). Defaults to the
   *   lazy `loadTSLanguage` helper. Returns the grammar language object or
   *   null to trigger regex fallback extraction.
   */
  constructor(loadGrammar: () => unknown = loadTSLanguage) {
    super();
    this.loadGrammar = loadGrammar;
  }

  // -----------------------------------------------------------------------
  // TypeResolverBase implementation
  // -----------------------------------------------------------------------

  async resolveType(typeName: string, context: TypeContext): Promise<ResolvedType | null> {
    const normalized = this.normalizeTypeName(typeName);

    // Check cache first
    const cached = this.typeCache.get(normalized);
    if (cached) return cached;

    let resolved: ResolvedType | null = null;

    // 1. Primitive types
    if (this.isPrimitive(normalized)) {
      resolved = { name: normalized, kind: 'primitive' };
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 2. Conditional types: T extends U ? X : Y
    resolved = this.resolveConditionalType(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 3. Mapped types: { [K in keyof T]: V }
    resolved = this.resolveMappedType(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 4. Union types: A | B
    resolved = this.resolveUnionType(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 5. Intersection types: A & B
    resolved = this.resolveIntersectionType(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 6. Generic types: Array<T>, Map<K,V>, Promise<T>, Partial<T>, Record<K,V>
    resolved = this.resolveGenericType(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 7. Indexed access types: T[K]
    resolved = this.resolveIndexedAccessType(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 8. Template literal types
    resolved = this.resolveTemplateLiteralType(normalized);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 9. Function types
    resolved = this.resolveFunctionType(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 10. External / cross-file resolution
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
  // Legacy compatibility: extract TypeInfo array for pipeline integration
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
  // Type resolution methods
  // -----------------------------------------------------------------------

  /**
   * Resolve generic types like Array<string>, Map<K,V>, Promise<T>,
   * Partial<T>, Record<K,V>, Readonly<T>, Pick<T,K>, Omit<T,K>,
   * Exclude<T,U>, Extract<T,U>, NonNullable<T>, ReturnType<T>,
   * Parameters<T>, InstanceType<T>, Awaited<T>, Required<T>.
   */
  private resolveGenericType(typeName: string, _context: TypeContext): ResolvedType | null {
    const parsed = this.parseGenericString(typeName);
    if (!parsed) return null;

    const { base, args } = parsed;

    // Map known generic types to their semantic meaning
    const genericHandlers: Record<string, (args: string[]) => ResolvedType | null> = {
      Array: (a) => {
        if (a.length !== 1) return null;
        const elemType = this.makeUnresolved(a[0]!);
        return {
          name: `Array<${elemType.name}>`,
          kind: 'generic',
          genericArgs: [elemType],
          members: {
            length: this.primitive('number'),
            '[index]': elemType,
          },
        };
      },
      ReadonlyArray: (a) => {
        if (a.length !== 1) return null;
        const elemType = this.makeUnresolved(a[0]!);
        return {
          name: `ReadonlyArray<${elemType.name}>`,
          kind: 'generic',
          genericArgs: [elemType],
          members: { length: this.primitive('number'), '[index]': elemType },
        };
      },
      Map: (a) => {
        if (a.length !== 2) return null;
        const keyType = this.makeUnresolved(a[0]!);
        const valType = this.makeUnresolved(a[1]!);
        return {
          name: `Map<${keyType.name}, ${valType.name}>`,
          kind: 'generic',
          genericArgs: [keyType, valType],
          members: {
            size: this.primitive('number'),
            get: this.functionType('get', [keyType], valType),
            set: this.functionType('set', [keyType, valType], this.primitive('void')),
          },
        };
      },
      Set: (a) => {
        if (a.length !== 1) return null;
        const elemType = this.makeUnresolved(a[0]!);
        return {
          name: `Set<${elemType.name}>`,
          kind: 'generic',
          genericArgs: [elemType],
          members: {
            size: this.primitive('number'),
            add: this.functionType('add', [elemType], this.primitive('void')),
          },
        };
      },
      Promise: (a) => {
        if (a.length !== 1) return null;
        const innerType = this.makeUnresolved(a[0]!);
        return {
          name: `Promise<${innerType.name}>`,
          kind: 'generic',
          genericArgs: [innerType],
          members: {
            then: this.functionType('then', [this.unknownType()], this.unknownType()),
            catch: this.functionType('catch', [this.unknownType()], this.unknownType()),
          },
        };
      },
      Partial: (a) => {
        if (a.length !== 1) return null;
        const inner = this.makeUnresolved(a[0]!);
        return {
          name: `Partial<${inner.name}>`,
          kind: 'generic',
          genericArgs: [inner],
          members: {},
        };
      },
      Required: (a) => {
        if (a.length !== 1) return null;
        const inner = this.makeUnresolved(a[0]!);
        return {
          name: `Required<${inner.name}>`,
          kind: 'generic',
          genericArgs: [inner],
          members: {},
        };
      },
      Readonly: (a) => {
        if (a.length !== 1) return null;
        const inner = this.makeUnresolved(a[0]!);
        return {
          name: `Readonly<${inner.name}>`,
          kind: 'generic',
          genericArgs: [inner],
          members: {},
        };
      },
      Pick: (a) => {
        if (a.length < 2) return null;
        const inner = this.makeUnresolved(a[0]!);
        return {
          name: `Pick<${inner.name}>`,
          kind: 'generic',
          genericArgs: [inner],
          members: {},
        };
      },
      Omit: (a) => {
        if (a.length < 2) return null;
        const inner = this.makeUnresolved(a[0]!);
        return {
          name: `Omit<${inner.name}>`,
          kind: 'generic',
          genericArgs: [inner],
          members: {},
        };
      },
      Record: (a) => {
        if (a.length !== 2) return null;
        const keyType = this.makeUnresolved(a[0]!);
        const valType = this.makeUnresolved(a[1]!);
        return {
          name: `Record<${keyType.name}, ${valType.name}>`,
          kind: 'generic',
          genericArgs: [keyType, valType],
          members: {},
        };
      },
      Exclude: (a) => {
        if (a.length !== 2) return null;
        return this.unionType([this.makeUnresolved(a[0]!), this.makeUnresolved(a[1]!)]);
      },
      Extract: (a) => {
        if (a.length !== 2) return null;
        return this.intersectionType([this.makeUnresolved(a[0]!), this.makeUnresolved(a[1]!)]);
      },
      NonNullable: (a) => {
        if (a.length !== 1) return null;
        const inner = this.makeUnresolved(a[0]!);
        return { ...inner, isNullable: false };
      },
      ReturnType: (a) => {
        if (a.length !== 1) return null;
        return this.unknownType(`ReturnType<${a[0]}>`);
      },
      Parameters: (a) => {
        if (a.length !== 1) return null;
        return this.unknownType(`Parameters<${a[0]}>`);
      },
      InstanceType: (a) => {
        if (a.length !== 1) return null;
        return this.unknownType(`InstanceType<${a[0]}>`);
      },
      Awaited: (a) => {
        if (a.length !== 1) return null;
        const inner = this.makeUnresolved(a[0]!);
        return { ...inner, name: `Awaited<${inner.name}>` };
      },
    };

    // Check if the base is a known generic utility type
    if (genericHandlers[base]) {
      const result = genericHandlers[base]!(args);
      if (result) return result;
    }

    // General generic type (user-defined or unknown)
    const resolvedArgs = args.map((a) => this.makeUnresolved(a));
    return {
      name: `${base}<${resolvedArgs.map((a) => a.name).join(', ')}>`,
      kind: 'generic',
      genericArgs: resolvedArgs,
    };
  }

  /**
   * Resolve union types: A | B | C
   */
  resolveUnionType(typeName: string, _context: TypeContext): ResolvedType | null {
    // Check if type contains '|' not inside angle brackets
    const parts = this.splitTopLevelUnions(typeName);
    if (parts.length <= 1) return null;

    const resolvedParts = parts.map((p) => this.makeUnresolved(p.trim()));
    return {
      name: resolvedParts.map((p) => p.name).join(' | '),
      kind: 'union',
      genericArgs: resolvedParts,
    };
  }

  /**
   * Resolve intersection types: A & B
   */
  resolveIntersectionType(typeName: string, _context: TypeContext): ResolvedType | null {
    const parts = this.splitTopLevelIntersections(typeName);
    if (parts.length <= 1) return null;

    const resolvedParts = parts.map((p) => this.makeUnresolved(p.trim()));
    return {
      name: resolvedParts.map((p) => p.name).join(' & '),
      kind: 'intersection',
      genericArgs: resolvedParts,
    };
  }

  /**
   * Resolve indexed access types: T[K], T["prop"]
   */
  private resolveIndexedAccessType(typeName: string, _context: TypeContext): ResolvedType | null {
    const match = typeName.match(
      /^(\w[\w.]*)\s*\[\s*["'\u201C\u201D]?(\w+)["'\u201C\u201D]?\s*\]$/,
    );
    if (!match) return null;

    const baseType = this.makeUnresolved(match[1]!);
    const key = match[2]!;

    return {
      name: `${baseType.name}["${key}"]`,
      kind: 'generic',
      genericArgs: [baseType],
      // The actual type depends on the base type's members, resolved at runtime
    };
  }

  /**
   * Resolve conditional types: T extends U ? X : Y
   */
  private resolveConditionalType(typeName: string, _context: TypeContext): ResolvedType | null {
    // Match: Something extends SomethingElse ? TrueType : FalseType
    const match = typeName.match(/^(\S+)\s+extends\s+(\S+)\s*\?\s*(.+)\s*:\s*(.+)$/);
    if (!match) return null;

    const constraint = match[1]!;
    const conditional = match[2]!;
    const trueBranch = match[3]!.trim();
    const falseBranch = match[4]!.trim();

    // Basic resolution: if constraint is a subtype of conditional, resolve true branch
    // For now, return a conditional type descriptor
    return {
      name: `${constraint} extends ${conditional} ? ${trueBranch} : ${falseBranch}`,
      kind: 'generic',
      genericArgs: [this.makeUnresolved(constraint), this.makeUnresolved(conditional)],
      documentation: `Conditional type: resolves to ${trueBranch} if ${constraint} extends ${conditional}, otherwise ${falseBranch}`,
    };
  }

  /**
   * Resolve mapped types: { [K in keyof T]: V }, { readonly [K in keyof T]?: V }
   */
  private resolveMappedType(typeName: string, _context: TypeContext): ResolvedType | null {
    // Check if this looks like a mapped type inline object
    // Pattern: { [P in keyof T]: ... } or similar
    const match = typeName.match(
      /^\{\s*(?:readonly\s+)?\[\s*(\w+)\s+in\s+keyof\s+(\w+)\s*\](?:\s*\?\s*)?:\s*(.+?)\s*\}$/,
    );
    if (!match) return null;

    const paramName = match[1]!;
    const sourceType = match[2]!;
    const valueType = match[3]!.trim();

    return {
      name: `{ [${paramName} in keyof ${sourceType}]: ${valueType} }`,
      kind: 'generic',
      genericArgs: [this.makeUnresolved(sourceType), this.makeUnresolved(valueType)],
      documentation: `Mapped type: maps each key of ${sourceType} to ${valueType}`,
    };
  }

  /**
   * Resolve template literal types: `${prefix}${string}`
   */
  resolveTemplateLiteralType(typeName: string): ResolvedType | null {
    // Template literal types are enclosed in backticks with ${} interpolations
    if (!typeName.startsWith('\u0060') || !typeName.endsWith('\u0060')) return null;

    const inner = typeName.slice(1, -1); // remove backticks
    return {
      name: typeName,
      kind: 'primitive',
      documentation: `Template literal type: \`${inner}\``,
    };
  }

  /**
   * Resolve function types: (a: string, b: number) => boolean
   */
  resolveFunctionType(typeName: string, _context: TypeContext): ResolvedType | null {
    // Match arrow function type: (params) => ReturnType
    const match = typeName.match(/^\(([^)]*)\)\s*=>\s*(.+)$/);
    if (!match) return null;

    const paramsStr = match[1]!.trim();
    const returnStr = match[2]!.trim();

    let paramTypes: ResolvedType[] = [];
    if (paramsStr) {
      paramTypes = paramsStr.split(',').map((p) => {
        const parts = p.trim().split(':');
        const typeStr = parts.length > 1 ? parts[1]!.trim() : parts[0]!.trim();
        return this.makeUnresolved(typeStr);
      });
    }

    const returnType = this.makeUnresolved(returnStr);
    return {
      name: typeName,
      kind: 'function',
      parameterTypes: paramTypes,
      returnType,
    };
  }

  // -----------------------------------------------------------------------
  // AST Walking (legacy extraction for TypeInfo pipeline)
  // -----------------------------------------------------------------------

  private walkAST(node: SyntaxNode, source: string, types: TypeInfo[]): void {
    const nt = node.type;

    if (nt === 'class_declaration' || nt === 'abstract_class_declaration') {
      types.push(this.extractClass(node, source));
    }
    if (nt === 'interface_declaration') {
      types.push(this.extractInterface(node, source));
    }
    if (nt === 'type_alias_declaration') {
      types.push(this.extractTypeAlias(node, source));
    }
    if (nt === 'enum_declaration') {
      types.push(this.extractEnum(node, source));
    }
    if (nt === 'function_declaration' || nt === 'generator_function_declaration') {
      // Only top-level functions are extracted. TSX wraps exported functions
      // in `export_statement` and leaves non-exported ones directly under
      // `program`; nested function declarations (parented by a
      // `statement_block`) are intentionally skipped.
      const parent = node.parent!;
      if (parent.type === 'program' || parent.type === 'export_statement') {
        types.push(this.extractFunction(node, source));
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAST(node.child(i), source, types);
    }
  }

  // -----------------------------------------------------------------------
  // AST Extractors
  // -----------------------------------------------------------------------

  private extractClass(node: SyntaxNode, _source: string): TypeInfo {
    const name = this.childText(node, 'type_identifier')!;

    const qn = `file:${this.filePath}:${name}`;
    const exported = this.isExported(node);
    const isAbs = node.type === 'abstract_class_declaration';
    const baseTypes = this.extractBaseTypes(node);
    const impls = this.extractImplements(node);
    const typeParams = this.extractTypeParams(node);
    const decorators = this.extractDecorators(node);
    const members = this.extractClassMembers(node);

    return {
      name,
      qualifiedName: qn,
      filePath: this.filePath,
      kind: 'class',
      members,
      baseTypes,
      implementedInterfaces: impls,
      typeParameters: typeParams,
      returnType: null,
      parameterTypes: [],
      isExported: exported,
      isAbstract: isAbs,
      decorators,
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  private extractInterface(node: SyntaxNode, _source: string): TypeInfo {
    const name = this.childText(node, 'type_identifier')!;
    const qn = `file:${this.filePath}:${name}`;
    const baseTypes = this.extractBaseTypes(node);
    const typeParams = this.extractTypeParams(node);
    const members = this.extractInterfaceMembers(node);

    return {
      name,
      qualifiedName: qn,
      filePath: this.filePath,
      kind: 'interface',
      members,
      baseTypes,
      implementedInterfaces: [],
      typeParameters: typeParams,
      returnType: null,
      parameterTypes: [],
      isExported: this.isExported(node),
      isAbstract: false,
      decorators: [],
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  private extractTypeAlias(node: SyntaxNode, _source: string): TypeInfo {
    const name = this.childText(node, 'type_identifier')!;
    const qn = `file:${this.filePath}:${name}`;
    const typeParams = this.extractTypeParams(node);

    return {
      name,
      qualifiedName: qn,
      filePath: this.filePath,
      kind: 'type',
      members: new Map(),
      baseTypes: [],
      implementedInterfaces: [],
      typeParameters: typeParams,
      returnType: null,
      parameterTypes: [],
      isExported: this.isExported(node),
      isAbstract: false,
      decorators: [],
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  private extractEnum(node: SyntaxNode, _source: string): TypeInfo {
    // enum_declaration names the type with an `identifier` (unlike class/
    // interface/type_alias, which use `type_identifier`).
    const name = this.childText(node, 'identifier')!;
    const qn = `file:${this.filePath}:${name}`;
    const members = new Map();
    const body = this.findChild(node, 'enum_body')!;
    for (let i = 0; i < body.childCount; i++) {
      const c = body.child(i);
      if (c.type === 'property_identifier') {
        members.set(c.text, {
          name: c.text,
          type: 'number',
          visibility: 'public',
          isStatic: true,
          isOptional: false,
          isAsync: false,
          parameterTypes: [],
          returnType: 'number',
        });
      }
    }
    return {
      name,
      qualifiedName: qn,
      filePath: this.filePath,
      kind: 'enum',
      members,
      baseTypes: [],
      implementedInterfaces: [],
      typeParameters: [],
      returnType: null,
      parameterTypes: [],
      isExported: this.isExported(node),
      isAbstract: false,
      decorators: [],
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  private extractFunction(node: SyntaxNode, _source: string): TypeInfo {
    const name = this.childText(node, 'identifier')!;
    const qn = `file:${this.filePath}:${name}`;
    const isAsync = this.hasModifier(node, 'async');
    const paramTypes = this.extractParamTypes(node);
    let returnType: string | null = null;
    // tree-sitter-typescript uses type_annotation for the return type.
    const retNode = this.findChild(node, 'type_annotation');
    if (retNode) returnType = retNode.text.replace(/^:\s*/, '').trim();

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
      isExported: this.isExported(node),
      isAbstract: false,
      decorators: [],
      isAsync,
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private makeUnresolved(name: string): ResolvedType {
    return this.isPrimitive(name) ? { name, kind: 'primitive' } : { name, kind: 'unknown' };
  }

  private splitTopLevelUnions(typeName: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < typeName.length; i++) {
      const ch = typeName[i]!;
      if (ch === '<') depth++;
      else if (ch === '>') depth--;
      else if (ch === '|' && depth === 0) {
        const trimmed = current.trim();
        // Skip empty segments that arise from malformed unions (e.g. `A || B`).
        if (trimmed) result.push(trimmed);
        current = '';
        continue;
      }
      current += ch;
    }
    const trimmed = current.trim();
    // Skip a trailing empty segment from a malformed union (e.g. `A | B |`).
    if (trimmed) result.push(trimmed);
    return result;
  }

  private splitTopLevelIntersections(typeName: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < typeName.length; i++) {
      const ch = typeName[i]!;
      if (ch === '<') depth++;
      else if (ch === '>') depth--;
      else if (ch === '&' && depth === 0) {
        const trimmed = current.trim();
        // Skip empty segments that arise from malformed intersections (e.g. `A && B`).
        if (trimmed) result.push(trimmed);
        current = '';
        continue;
      }
      current += ch;
    }
    const trimmed = current.trim();
    // Skip a trailing empty segment from a malformed intersection (e.g. `A & B &`).
    if (trimmed) result.push(trimmed);
    return result;
  }

  private extractBaseTypes(node: SyntaxNode): string[] {
    const bases: string[] = [];
    // Classes use class_heritage > extends_clause; interfaces use
    // extends_type_clause directly (tree-sitter-typescript has no
    // interface_heritage node).
    const heritage = this.findChild(node, 'class_heritage');
    if (heritage) {
      for (let i = 0; i < heritage.childCount; i++) {
        const c = heritage.child(i);
        if (c.type === 'extends_clause') {
          for (let j = 0; j < c.childCount; j++) {
            const ext = c.child(j);
            if (ext.type === 'type_identifier' || ext.type === 'identifier') {
              bases.push(ext.text);
            }
          }
        }
      }
      return bases;
    }
    const extendsType = this.findChild(node, 'extends_type_clause');
    if (extendsType) {
      for (let i = 0; i < extendsType.childCount; i++) {
        const c = extendsType.child(i);
        if (c.type === 'type_identifier' || c.type === 'identifier') {
          bases.push(c.text);
        }
      }
    }
    return bases;
  }

  private extractImplements(node: SyntaxNode): string[] {
    const impls: string[] = [];
    const heritage = this.findChild(node, 'class_heritage');
    if (!heritage) return impls;
    for (let i = 0; i < heritage.childCount; i++) {
      const c = heritage.child(i);
      if (c.type === 'implements_clause') {
        for (let j = 0; j < c.childCount; j++) {
          const imp = c.child(j);
          if (imp.type === 'type_identifier' || imp.type === 'identifier') {
            impls.push(imp.text);
          }
        }
      }
    }
    return impls;
  }

  private extractTypeParams(node: SyntaxNode): string[] {
    const params: string[] = [];
    const tp = this.findChild(node, 'type_parameters');
    if (!tp) return params;
    for (let i = 0; i < tp.childCount; i++) {
      const c = tp.child(i);
      if (c.type === 'type_parameter') {
        params.push(this.childText(c, 'type_identifier')!);
      }
    }
    return params;
  }

  private extractDecorators(node: SyntaxNode): string[] {
    const decs: string[] = [];
    // A decorator is a direct child of the declaration when it is not
    // exported, and a sibling inside `export_statement` when it is exported.
    for (const scope of [node, node.parent!]) {
      for (let i = 0; i < scope.childCount; i++) {
        const c = scope.child(i);
        if (c.type === 'decorator') decs.push(c.text);
      }
    }
    return decs;
  }

  private extractClassMembers(node: SyntaxNode): Map<string, any> {
    const members = new Map();
    const body = this.findChild(node, 'class_body')!;
    this.walkClassMembers(body, members);
    return members;
  }

  private walkClassMembers(node: SyntaxNode, members: Map<string, any>): void {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (
        c.type === 'method_definition' ||
        c.type === 'public_field_definition' ||
        c.type === 'abstract_method_signature'
      ) {
        const name = this.childText(c, 'property_identifier');
        // Computed member names (e.g. `[Symbol.iterator]() {}`) carry a
        // `computed_property_name` but no `property_identifier`.
        if (!name) continue;
        const isStatic = this.hasModifier(c, 'static');
        const isAsync = this.hasModifier(c, 'async');
        const visibility = this.getVisibility(c);
        const paramTypes = this.extractParamTypes(c);
        let returnType = 'void';
        const ret = this.findChild(c, 'type_annotation');
        if (ret) returnType = ret.text.replace(/^:\s*/, '').trim();
        const isField = c.type === 'public_field_definition';
        const mType = isField
          ? ret
            ? returnType
            : 'any'
          : `(${paramTypes.join(', ')}) => ${returnType}`;
        members.set(name, {
          name,
          type: mType,
          visibility,
          isStatic,
          isOptional: false,
          isAsync,
          parameterTypes: paramTypes,
          returnType,
        });
      }
      this.walkClassMembers(c, members);
    }
  }

  private extractInterfaceMembers(node: SyntaxNode): Map<string, any> {
    const members = new Map();
    const body = this.findChild(node, 'interface_body')!;
    this.walkInterfaceMembers(body, members);
    return members;
  }

  private walkInterfaceMembers(node: SyntaxNode, members: Map<string, any>): void {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (
        c.type === 'method_signature' ||
        c.type === 'property_signature' ||
        c.type === 'call_signature'
      ) {
        const name = this.childText(c, 'property_identifier');
        // `call_signature` (and index signatures) carry no property_identifier.
        if (!name) continue;
        const paramTypes = this.extractParamTypes(c);
        let returnType = 'void';
        const ret = this.findChild(c, 'type_annotation');
        if (ret) returnType = ret.text.replace(/^:\s*/, '').trim();
        members.set(name, {
          name,
          type: `(${paramTypes.join(', ')}) => ${returnType}`,
          visibility: 'public',
          isStatic: false,
          isOptional: false,
          isAsync: false,
          parameterTypes: paramTypes,
          returnType,
        });
      }
      this.walkInterfaceMembers(c, members);
    }
  }

  private extractParamTypes(node: SyntaxNode): string[] {
    const types: string[] = [];
    const params = this.findChild(node, 'formal_parameters');
    if (!params) return types;
    for (let i = 0; i < params.childCount; i++) {
      const p = params.child(i);
      if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
        const typeNode = this.findChild(p, 'type_annotation');
        types.push(typeNode ? typeNode.text.replace(/^:\s*/, '') : 'any');
      }
    }
    return types;
  }

  private isExported(node: SyntaxNode): boolean {
    // TSX always wraps exported declarations (including `export default`)
    // in an `export_statement`; non-exported ones sit directly under `program`.
    return node.parent!.type === 'export_statement';
  }

  private childText(node: SyntaxNode, type: string): string | null {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c.type === type && c.text) return c.text;
    }
    return null;
  }

  private findChild(node: SyntaxNode, type: string): SyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c.type === type) return c;
    }
    return null;
  }

  private hasModifier(node: SyntaxNode, modifier: string): boolean {
    // `static`, `async`, `abstract`, and accessor keywords are anonymous
    // tokens that sit directly on the member node.
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i).type === modifier) return true;
    }
    return false;
  }

  private getVisibility(node: SyntaxNode): 'public' | 'protected' | 'private' {
    // Visibility is carried by a single `accessibility_modifier` child whose
    // text is `private`, `protected`, or `public` (default).
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c.type === 'accessibility_modifier') {
        if (c.text === 'private') return 'private';
        if (c.text === 'protected') return 'protected';
        return 'public';
      }
    }
    return 'public';
  }

  // -----------------------------------------------------------------------
  // Fallback regex-based extraction
  // -----------------------------------------------------------------------

  private fallbackExtractTypes(source: string, filePath: string): TypeInfo[] {
    const types: TypeInfo[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;

    // Class declarations
    const classRx =
      /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+(\w+(?:<[^>]+>)?))?(?:\s+implements\s+(.+?))?\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = classRx.exec(source)) !== null) {
      types.push({
        name: m[1]!,
        qualifiedName: `file:${filePath}:${m[1]}`,
        filePath,
        kind: 'class',
        members: new Map(),
        baseTypes: m[2] ? [m[2]] : [],
        implementedInterfaces: m[3]
          ? m[3].split(/\s*,\s*/).map((s) => s.replace(/<[^>]+>/, ''))
          : [],
        typeParameters: [],
        returnType: null,
        parameterTypes: [],
        isExported: source.includes('export'),
        isAbstract: source.includes('abstract'),
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    // Interfaces
    const ifaceRx = /(?:export\s+)?interface\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+(.+?))?\s*\{/g;
    while ((m = ifaceRx.exec(source)) !== null) {
      types.push({
        name: m[1]!,
        qualifiedName: `file:${filePath}:${m[1]}`,
        filePath,
        kind: 'interface',
        members: new Map(),
        baseTypes: m[2] ? m[2].split(/\s*,\s*/).map((s) => s.trim()) : [],
        implementedInterfaces: [],
        typeParameters: [],
        returnType: null,
        parameterTypes: [],
        isExported: source.includes('export'),
        isAbstract: false,
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    // Type aliases
    const typeRx = /(?:export\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=\s*.+/g;
    while ((m = typeRx.exec(source)) !== null) {
      types.push({
        name: m[1]!,
        qualifiedName: `file:${filePath}:${m[1]}`,
        filePath,
        kind: 'type',
        members: new Map(),
        baseTypes: [],
        implementedInterfaces: [],
        typeParameters: [],
        returnType: null,
        parameterTypes: [],
        isExported: source.includes('export'),
        isAbstract: false,
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    return types;
  }
}
