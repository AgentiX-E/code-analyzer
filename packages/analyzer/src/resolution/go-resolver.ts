// @code-analyzer/analyzer — Go Type Resolver
// Provides type resolution for Go source files:
//   1. Struct tags — parse `json:"name" validate:"required"`
//   2. Interface satisfaction — detect which structs implement which interfaces
//   3. Embedded types — handle struct embedding/composition
//   4. Generic type inference — func Foo[T any](...) (Go 1.18+)
//
// Uses tree-sitter-go AST for structural extraction with regex fallback.

import Parser from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import type { TypeInfo, TypeMember, TypeVisibility } from '../resolution/type-registry.js';
import {
  TypeResolverBase,
  type ResolvedType,
  type TypeContext,
} from '../resolution/type-resolver-base.js';

// ---------------------------------------------------------------------------
// Lazy language loader
// ---------------------------------------------------------------------------

let GoLanguage: unknown;

/**
 * Lazily load the tree-sitter-go grammar. Returns the grammar language object,
 * or null if the native binding fails to load (e.g. binary incompatibility).
 * Callers fall back to regex extraction in that case.
 */
function loadGoLanguage(): unknown {
  if (GoLanguage) return GoLanguage;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    GoLanguage = require('tree-sitter-go');
    return GoLanguage;
  } catch {
    /* v8 ignore next -- @preserve native module load failure is untestable */
    return null;
  }
}

// ---------------------------------------------------------------------------
// GoStructTag — Parsed representation of a struct tag
// ---------------------------------------------------------------------------

export interface GoStructTag {
  /** The key (e.g. "json", "validate") */
  key: string;
  /** The raw value string */
  value: string;
  /** Parsed options (comma-separated parts beyond name) */
  options: string[];
  /** The field name override (first part of the tag value before comma) */
  fieldName?: string;
}

// ---------------------------------------------------------------------------
// GoInterfaceInfo — Interface satisfaction tracking
// ---------------------------------------------------------------------------

interface GoInterfaceInfo {
  name: string;
  package: string;
  methods: Map<string, GoMethodSig>;
  embeddedInterfaces: string[];
}

interface GoMethodSig {
  name: string;
  params: GoParam[];
  results: GoParam[];
}

interface GoParam {
  name: string;
  type: string;
}

// ---------------------------------------------------------------------------
// GoResolver
// ---------------------------------------------------------------------------

export class GoResolver extends TypeResolverBase {
  readonly language = 'go';
  private source = '';
  private filePath = '';
  private typeCache = new Map<string, ResolvedType>();
  private interfaceCache = new Map<string, GoInterfaceInfo>();
  private readonly loadGrammar: () => unknown;

  /**
   * @param loadGrammar Injectable grammar loader (test seam). Defaults to the
   *   lazy `loadGoLanguage` helper. Returns the grammar language object or
   *   null to trigger regex fallback extraction.
   */
  constructor(loadGrammar: () => unknown = loadGoLanguage) {
    super();
    this.loadGrammar = loadGrammar;
  }

  // -----------------------------------------------------------------------
  // TypeResolverBase implementation
  // -----------------------------------------------------------------------

  async resolveType(typeName: string, context: TypeContext): Promise<ResolvedType | null> {
    const normalized = this.normalizeTypeName(typeName);

    const cached = this.typeCache.get(normalized);
    if (cached) return cached;

    let resolved: ResolvedType | null = null;

    // 1. Go built-in primitives
    if (this.isGoPrimitive(normalized)) {
      resolved = this.mapGoPrimitive(normalized);
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 2. Slice / array / map types: []T, [N]T, map[K]V
    resolved = this.resolveGoCollection(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 3. Pointer types: *T
    resolved = this.resolveGoPointer(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 4. Channel types: chan T, <-chan T, chan<- T
    resolved = this.resolveGoChannel(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 5. Function types: func(A, B) C
    resolved = this.resolveGoFuncType(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 6. External resolution
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
  // Legacy compatibility: extract TypeInfo for pipeline
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
  // Struct tag parsing
  // -----------------------------------------------------------------------

  /**
   * Parse Go struct tags.
   *
   * Input: `json:"name,omitempty" validate:"required,min=3"`
   * Output:
   *   [
   *     { key: "json", value: "name,omitempty", fieldName: "name", options: ["omitempty"] },
   *     { key: "validate", value: "required,min=3", fieldName: "required", options: ["min=3"] }
   *   ]
   */
  parseStructTags(rawTag: string): GoStructTag[] {
    const tags: GoStructTag[] = [];

    // Remove the surrounding backticks
    let cleaned = rawTag.trim();
    if (cleaned.startsWith('\u0060') && cleaned.endsWith('\u0060')) {
      cleaned = cleaned.slice(1, -1);
    }

    // Match key:"value" pairs
    const tagRegex = /(\w+)\s*:\s*"([^"]*)"/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(cleaned)) !== null) {
      const key = match[1]!;
      const rawValue = match[2]!;

      // Split by comma: first part is name, rest are options
      const parts = rawValue.split(',').map((p) => p.trim()).filter(Boolean);
      const fieldName = parts.length > 0 && !parts[0]!.startsWith('=') ? parts[0] : undefined;
      const options = fieldName ? parts.slice(1) : parts;

      tags.push({ key, value: rawValue, fieldName, options });
    }

    return tags;
  }

  // -----------------------------------------------------------------------
  // Interface satisfaction detection
  // -----------------------------------------------------------------------

  /**
   * Determine if a struct satisfies an interface.
   * Go uses structural subtyping — a struct implements an interface
   * if it has all the methods the interface requires.
   */
  checkInterfaceSatisfaction(
    _structName: string,
    structMethods: Map<string, GoMethodSig>,
    _interfaceName: string,
    ifaceInfo: GoInterfaceInfo,
  ): boolean {
    // Check all required methods of the interface
    for (const [methodName, ifaceMethod] of ifaceInfo.methods) {
      const structMethod = structMethods.get(methodName);
      if (!structMethod) return false;

      // Check parameter count
      if (structMethod.params.length !== ifaceMethod.params.length) return false;

      // Check parameter types (structural match)
      for (let i = 0; i < ifaceMethod.params.length; i++) {
        if (structMethod.params[i]!.type !== ifaceMethod.params[i]!.type) {
          // Allow implicit interface type matching
          if (!this.typesCompatible(structMethod.params[i]!.type, ifaceMethod.params[i]!.type)) {
            return false;
          }
        }
      }

      // Check result types
      if (structMethod.results.length !== ifaceMethod.results.length) return false;
      for (let i = 0; i < ifaceMethod.results.length; i++) {
        if (structMethod.results[i]!.type !== ifaceMethod.results[i]!.type) {
          if (!this.typesCompatible(structMethod.results[i]!.type, ifaceMethod.results[i]!.type)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Find all interfaces satisfied by a given struct.
   */
  findSatisfiedInterfaces(
    structMethods: Map<string, GoMethodSig>,
  ): string[] {
    const satisfied: string[] = [];
    for (const [ifaceName, ifaceInfo] of this.interfaceCache) {
      if (this.checkInterfaceSatisfaction(ifaceName, structMethods, ifaceName, ifaceInfo)) {
        satisfied.push(ifaceName);
      }
    }
    return satisfied;
  }

  // -----------------------------------------------------------------------
  // Type resolution helpers
  // -----------------------------------------------------------------------

  private resolveGoCollection(typeName: string, _context: TypeContext): ResolvedType | null {
    // Slice: []T
    const sliceMatch = typeName.match(/^\[\]\s*(.+)$/);
    if (sliceMatch) {
      const elem = this.makeGoUnresolved(sliceMatch[1]!);
      return {
        name: `[]${elem.name}`,
        kind: 'generic',
        genericArgs: [elem],
        documentation: `Slice of ${elem.name}`,
      };
    }

    // Array: [N]T
    const arrayMatch = typeName.match(/^\[(\d+)\]\s*(.+)$/);
    if (arrayMatch) {
      const elem = this.makeGoUnresolved(arrayMatch[2]!);
      return {
        name: `[${arrayMatch[1]}]${elem.name}`,
        kind: 'generic',
        genericArgs: [elem],
        documentation: `Array of ${arrayMatch[1]} ${elem.name}`,
      };
    }

    // Map: map[K]V
    const mapMatch = typeName.match(/^map\s*\[\s*(.+?)\s*\]\s*(.+)$/);
    if (mapMatch) {
      const key = this.makeGoUnresolved(mapMatch[1]!);
      const val = this.makeGoUnresolved(mapMatch[2]!);
      return {
        name: `map[${key.name}]${val.name}`,
        kind: 'generic',
        genericArgs: [key, val],
        documentation: `Map from ${key.name} to ${val.name}`,
      };
    }

    return null;
  }

  private resolveGoPointer(typeName: string, _context: TypeContext): ResolvedType | null {
    if (!typeName.startsWith('*')) return null;
    const inner = this.makeGoUnresolved(typeName.substring(1).trim());
    return {
      name: `*${inner.name}`,
      kind: 'generic',
      genericArgs: [inner],
      isNullable: true,
      documentation: `Pointer to ${inner.name}`,
    };
  }

  private resolveGoChannel(typeName: string, _context: TypeContext): ResolvedType | null {
    // chan T
    let match = typeName.match(/^chan\s+(.+)$/);
    if (match) {
      const elem = this.makeGoUnresolved(match[1]!);
      return { name: `chan ${elem.name}`, kind: 'generic', genericArgs: [elem] };
    }
    // <-chan T (receive-only)
    match = typeName.match(/^<-chan\s+(.+)$/);
    if (match) {
      const elem = this.makeGoUnresolved(match[1]!);
      return { name: `<-chan ${elem.name}`, kind: 'generic', genericArgs: [elem] };
    }
    // chan<- T (send-only)
    match = typeName.match(/^chan<-\s*(.+)$/);
    if (match) {
      const elem = this.makeGoUnresolved(match[1]!);
      return { name: `chan<- ${elem.name}`, kind: 'generic', genericArgs: [elem] };
    }
    return null;
  }

  private resolveGoFuncType(typeName: string, _context: TypeContext): ResolvedType | null {
    const match = typeName.match(/^func\s*\(([^)]*)\)(?:\s*\(([^)]*)\)|\s+(\S+))$/);
    if (!match) return null;

    const paramsStr = match[1]!.trim();
    const resultsStr = (match[2] || match[3] || '').trim();

    const paramTypes: ResolvedType[] = [];
    if (paramsStr) {
      for (const p of paramsStr.split(',')) {
        const trimmed = p.trim();
        // Go params: "name type" or just "type"
        const parts = trimmed.split(/\s+/);
        const typeStr = parts.length > 1 ? parts[parts.length - 1]! : parts[0]!;
        paramTypes.push(this.makeGoUnresolved(typeStr));
      }
    }

    let returnType = this.primitive('void');
    if (resultsStr) {
      returnType = this.makeGoUnresolved(resultsStr);
    }

    return {
      name: typeName,
      kind: 'function',
      parameterTypes: paramTypes,
      returnType,
    };
  }

  // -----------------------------------------------------------------------
  // AST Walking
  // -----------------------------------------------------------------------

  private walkAST(node: SyntaxNode, source: string, types: TypeInfo[]): void {
    const nt = node.type;

    if (nt === 'type_declaration') {
      this.extractTypeDeclaration(node, source, types);
      return; // Children handled by extractor
    }

    if (nt === 'function_declaration') {
      const info = this.extractFunction(node, source);
      /* v8 ignore next -- @preserve -- extractFunction always returns a TypeInfo for a function_declaration */
      if (info) types.push(info);
    }

    if (nt === 'method_declaration') {
      const info = this.extractMethod(node, source);
      /* v8 ignore next -- @preserve -- extractMethod always returns a TypeInfo for a method_declaration */
      if (info) types.push(info);
    }

    if (nt === 'var_declaration' || nt === 'const_declaration') {
      // Skip for now, could extract package-level variables
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAST(node.child(i), source, types);
    }
  }

  private extractTypeDeclaration(node: SyntaxNode, _source: string, types: TypeInfo[]): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      /* v8 ignore next -- @preserve -- index is bounded by childCount */
      if (!child) continue;

      if (child.type === 'type_spec') {
        const name = this.childText(child, 'type_identifier');
        /* v8 ignore next -- @preserve -- type_spec always has a type_identifier */
        if (!name) continue;

        const qn = `file:${this.filePath}:${name}`;
        const exported = name[0] === name[0]?.toUpperCase();
        let kind: TypeInfo['kind'] = 'type';
        let members = new Map<string, TypeMember>();
        let baseTypes: string[] = [];
        const typeParams: string[] = [];

        // Generic type params (Go 1.18+) — type_parameter_list on the type_spec.
        this.extractGenericParams(child, typeParams);

        // Look for struct_type / interface_type as named children of type_spec.
        const structNode = this.findChild(child, 'struct_type');
        const interfaceNode = this.findChild(child, 'interface_type');

        if (structNode) {
          kind = 'class'; // Go struct
          members = this.extractStructFields(structNode, name);
        } else if (interfaceNode) {
          kind = 'interface';
          members = this.extractInterfaceMethods(interfaceNode);
          // Register interface for satisfaction checking.
          this.interfaceCache.set(name, {
            name,
            package: '',
            methods: this.extractInterfaceSigs(interfaceNode),
            embeddedInterfaces: this.extractEmbeddedInterfaces(interfaceNode),
          });
        }

        types.push({
          name, qualifiedName: qn, filePath: this.filePath, kind,
          members, baseTypes, implementedInterfaces: [],
          typeParameters: typeParams, returnType: null, parameterTypes: [],
          isExported: exported, isAbstract: false, decorators: [],
          location: {
            startLine: child.startPosition.row + 1,
            endLine: child.endPosition.row + 1,
          },
        });
      }
    }
  }

  private extractFunction(node: SyntaxNode, _source: string): TypeInfo | null {
    const name = this.childText(node, 'identifier');
    /* v8 ignore next -- @preserve -- function_declaration always has an identifier */
    if (!name) return null;

    const qn = `file:${this.filePath}:${name}`;
    const exported = name[0] === name[0]?.toUpperCase();
    const typeParams = this.extractFuncGenericParams(node);

    const paramLists = this.collectParamLists(node);

    // Parameters (first parameter_list)
    const paramTypes: string[] = [];
    /* v8 ignore next -- @preserve -- every function declaration has a parameter_list */
    if (paramLists[0]) {
      this.extractGoParams(paramLists[0], paramTypes);
    }

    // Results: a second parameter_list (multi-result) or a direct type node.
    const returnType = this.extractResultType(node, paramLists, 1);

    return {
      name, qualifiedName: qn, filePath: this.filePath, kind: 'function',
      members: new Map(), baseTypes: [],
      implementedInterfaces: [], typeParameters: typeParams,
      returnType, parameterTypes: paramTypes,
      isExported: exported, isAbstract: false, decorators: [],
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  private extractMethod(node: SyntaxNode, _source: string): TypeInfo | null {
    const name = this.childText(node, 'field_identifier');
    /* v8 ignore next -- @preserve -- method_declaration always has a field_identifier */
    if (!name) return null;

    const qn = `file:${this.filePath}:${name}`;
    const exported = name[0] === name[0]?.toUpperCase();

    // paramLists[0] = receiver, paramLists[1] = params, paramLists[2] = results.
    const paramLists = this.collectParamLists(node);

    // Receiver type (strip the leading `*` from pointer receivers).
    let receiverType = '';
    /* v8 ignore next -- @preserve -- method_declaration always has a receiver */
    if (paramLists[0]) {
      const recvParams: string[] = [];
      this.extractGoParams(paramLists[0], recvParams);
      /* v8 ignore next -- @preserve -- receiver always carries a type */
      if (recvParams.length > 0) {
        receiverType = recvParams[0]!.replace(/^\*/, '').trim();
      }
    }

    // Parameters after the receiver.
    const paramTypes: string[] = [];
    /* v8 ignore next -- @preserve -- method always has a parameter_list */
    if (paramLists[1]) {
      this.extractGoParams(paramLists[1], paramTypes);
    }

    const returnType = this.extractResultType(node, paramLists, 2);

    return {
      name, qualifiedName: qn, filePath: this.filePath, kind: 'function',
      members: new Map(), baseTypes: [receiverType],
      implementedInterfaces: [], typeParameters: [],
      returnType, parameterTypes: paramTypes,
      isExported: exported, isAbstract: false, decorators: [],
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  // -----------------------------------------------------------------------
  // Struct / Interface Extraction
  // -----------------------------------------------------------------------

  /**
   * Extract struct fields including embedded types and struct tags.
   */
  private extractStructFields(structNode: SyntaxNode, _structName: string): Map<string, TypeMember> {
    const members = new Map<string, TypeMember>();
    const body = this.findChild(structNode, 'field_declaration_list');
    /* v8 ignore next -- @preserve -- struct_type always has a field_declaration_list */
    if (!body) return members;

    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child || child.type !== 'field_declaration') continue;

      // Get field name(s) — Go allows "a, b, c int"
      const fieldNames: string[] = [];
      for (let j = 0; j < child.childCount; j++) {
        const c = child.child(j);
        if (c && c.type === 'field_identifier') {
          fieldNames.push(c.text);
        }
      }

      // Get type — tree-sitter-go has no `type` wrapper; the type is one of
      // type_identifier / pointer_type / qualified_type / slice_type / etc.
      const typeNode = this.findTypeNode(child);
      /* v8 ignore next -- @preserve -- every field declaration has a type node */
      const fieldType = typeNode ? typeNode.text : 'unknown';

      // If no explicit field name, this is an embedded type (e.g. `io.Reader`).
      if (fieldNames.length === 0 && typeNode) {
        const embeddedType = typeNode.text;
        members.set(embeddedType, {
          name: embeddedType,
          type: embeddedType,
          visibility: 'public',
          isStatic: false,
          isOptional: false,
          isAsync: false,
          parameterTypes: [],
          returnType: embeddedType,
        });
        continue;
      }

      for (const fname of fieldNames) {
        const isExported = fname[0] === fname[0]?.toUpperCase();
        const visibility: TypeVisibility = isExported ? 'public' : 'private';

        members.set(fname, {
          name: fname,
          type: fieldType,
          visibility,
          isStatic: false,
          isOptional: false,
          isAsync: false,
          parameterTypes: [],
          returnType: fieldType,
        });
      }
    }

    return members;
  }

  /**
   * Extract interface methods for TypeInfo.
   */
  private extractInterfaceMethods(interfaceNode: SyntaxNode): Map<string, TypeMember> {
    const members = new Map<string, TypeMember>();
    for (let i = 0; i < interfaceNode.childCount; i++) {
      const child = interfaceNode.child(i);
      /* v8 ignore next -- @preserve -- index is bounded by childCount */
      if (!child) continue;

      // tree-sitter-go represents interface methods as `method_elem`
      // (embedded interfaces are `type_elem`).
      if (child.type === 'method_elem') {
        const name = this.childText(child, 'field_identifier');
        /* v8 ignore next -- @preserve -- method_elem always has a field_identifier */
        if (!name) continue;

        const paramLists = this.collectParamLists(child);

        // Parameters
        const paramTypes: string[] = [];
        /* v8 ignore next -- @preserve -- method_elem always has a params parameter_list */
        if (paramLists[0]) this.extractGoParams(paramLists[0], paramTypes);

        // Results: a second parameter_list, or a direct type node.
        let returnType = 'void';
        if (paramLists[1]) {
          const resParams: string[] = [];
          this.extractGoParams(paramLists[1], resParams);
          returnType = resParams.join(', ') || 'void';
        } else {
          const typeNode = this.findTypeNode(child);
          if (typeNode) returnType = typeNode.text;
        }

        members.set(name, {
          name, type: `(${paramTypes.join(', ')}) => ${returnType}`,
          visibility: 'public', isStatic: false, isOptional: false, isAsync: false,
          parameterTypes: paramTypes, returnType,
        });
      }
    }

    return members;
  }

  /**
   * Extract interface method signatures for satisfaction checking.
   */
  private extractInterfaceSigs(interfaceNode: SyntaxNode): Map<string, GoMethodSig> {
    const methods = new Map<string, GoMethodSig>();
    for (let i = 0; i < interfaceNode.childCount; i++) {
      const child = interfaceNode.child(i);
      if (!child || child.type !== 'method_elem') continue;

      const name = this.childText(child, 'field_identifier');
      /* v8 ignore next -- @preserve -- method_elem always has a field_identifier */
      if (!name) continue;

      const paramLists = this.collectParamLists(child);

      const params: GoParam[] = [];
      /* v8 ignore next -- @preserve -- method_elem always has a params parameter_list */
      if (paramLists[0]) params.push(...this.extractGoSigParams(paramLists[0]));

      const results: GoParam[] = [];
      if (paramLists[1]) {
        results.push(...this.extractGoSigParams(paramLists[1]));
      } else {
        const typeNode = this.findTypeNode(child);
        if (typeNode) results.push({ name: '', type: typeNode.text });
      }

      methods.set(name, { name, params, results });
    }
    return methods;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private makeGoUnresolved(name: string): ResolvedType {
    const trimmed = name.trim();
    if (this.isGoPrimitive(trimmed)) return this.mapGoPrimitive(trimmed);
    return { name: trimmed, kind: 'unknown' };
  }

  private isGoPrimitive(name: string): boolean {
    const primitives = new Set([
      'bool', 'byte', 'complex128', 'complex64', 'error',
      'float32', 'float64', 'int', 'int8', 'int16', 'int32', 'int64',
      'rune', 'string', 'uint', 'uint8', 'uint16', 'uint32', 'uint64',
      'uintptr', 'nil', 'any', 'comparable', 'true', 'false',
      'iota', 'void',
    ]);
    return primitives.has(name);
  }

  private mapGoPrimitive(name: string): ResolvedType {
    return { name, kind: 'primitive', isNullable: name === 'nil' };
  }

  private typesCompatible(a: string, b: string): boolean {
    // Structural compatibility check. Only invoked after an exact-match
    // comparison in checkInterfaceSatisfaction, so `a !== b` here.
    if (a === 'any' || b === 'any') return true;
    // Check if both are interfaces (structural matching)
    if (a.startsWith('interface') || b.startsWith('interface')) return true;
    return false;
  }

  private extractGoParams(paramList: SyntaxNode, result: string[]): void {
    for (let i = 0; i < paramList.childCount; i++) {
      const child = paramList.child(i);
      /* v8 ignore next -- @preserve -- index is bounded by childCount */
      if (!child) continue;
      // Each parameter is a parameter_declaration wrapping a type node
      // (type_identifier / slice_type / pointer_type / qualified_type / ...).
      const typeNode = this.findTypeNode(child);
      if (typeNode) result.push(typeNode.text);
    }
  }

  private extractGoSigParams(paramList: SyntaxNode): GoParam[] {
    const params: GoParam[] = [];
    for (let i = 0; i < paramList.childCount; i++) {
      const child = paramList.child(i);
      /* v8 ignore next -- @preserve -- index is bounded by childCount */
      if (!child) continue;

      const typeNode = this.findTypeNode(child);
      // Skip anonymous tokens (parens, commas) — they carry no type node.
      if (!typeNode) continue;

      const paramName = this.childText(child, 'identifier') ?? '';
      params.push({ name: paramName, type: typeNode.text });
    }
    return params;
  }

  private extractGenericParams(node: SyntaxNode, result: string[]): void {
    const tpList = this.findChild(node, 'type_parameter_list');
    if (!tpList) return;
    for (let i = 0; i < tpList.childCount; i++) {
      const child = tpList.child(i);
      if (child && child.type === 'type_parameter_declaration') {
        const name = this.childText(child, 'identifier');
        /* v8 ignore next -- @preserve -- type_parameter_declaration always has an identifier */
        if (name) result.push(name);
      }
    }
  }

  private extractFuncGenericParams(node: SyntaxNode): string[] {
    const params: string[] = [];
    const tpList = this.findChild(node, 'type_parameter_list');
    if (!tpList) return params;
    for (let i = 0; i < tpList.childCount; i++) {
      const child = tpList.child(i);
      if (child && child.type === 'type_parameter_declaration') {
        const name = this.childText(child, 'identifier');
        /* v8 ignore next -- @preserve -- type_parameter_declaration always has an identifier */
        if (name) params.push(name);
      }
    }
    return params;
  }

  /** Extract embedded interface names (type_elem) from an interface_type. */
  private extractEmbeddedInterfaces(interfaceNode: SyntaxNode): string[] {
    const embedded: string[] = [];
    for (let i = 0; i < interfaceNode.childCount; i++) {
      const c = interfaceNode.child(i);
      if (c && c.type === 'type_elem') {
        const typeNode = this.findTypeNode(c);
        /* v8 ignore next -- @preserve -- type_elem always carries a type node */
        if (typeNode) embedded.push(typeNode.text);
      }
    }
    return embedded;
  }

  /**
   * Extract the result type(s) of a function/method declaration.
   *
   * @param node The function_declaration or method_declaration.
   * @param paramLists All parameter_list children, in source order.
   * @param resultIndex Index of the result parameter_list (1 for functions —
   *   params at 0; 2 for methods — receiver at 0, params at 1).
   */
  private extractResultType(
    node: SyntaxNode,
    paramLists: SyntaxNode[],
    resultIndex: number,
  ): string | null {
    const resultList = paramLists[resultIndex];
    if (resultList) {
      const resParams: string[] = [];
      this.extractGoParams(resultList, resParams);
      if (resParams.length === 0) return null;
      if (resParams.length === 1) return resParams[0]!;
      return `(${resParams.join(', ')})`;
    }
    // Single result — a direct type node (e.g. `int`, `error`, `*T`).
    const typeNode = this.findTypeNode(node);
    return typeNode ? typeNode.text : null;
  }

  /** Collect all parameter_list children of a declaration, in source order. */
  private collectParamLists(node: SyntaxNode): SyntaxNode[] {
    const lists: SyntaxNode[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c && c.type === 'parameter_list') lists.push(c);
    }
    return lists;
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

  /**
   * Node types that tree-sitter-go uses to represent a *declaration* type
   * (field type, parameter type, result type). Unlike tree-sitter-typescript,
   * Go has no generic `type` wrapper node — the type is one of these concrete
   * node types directly.
   */
  private static readonly TYPE_NODES = new Set([
    'type_identifier',
    'pointer_type',
    'slice_type',
    'array_type',
    'map_type',
    'channel_type',
    'function_type',
    'qualified_type',
    'generic_type',
    'parenthesized_type',
  ]);

  /** Find the first named child that represents a Go type. */
  private findTypeNode(node: SyntaxNode): SyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c && GoResolver.TYPE_NODES.has(c.type)) return c;
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Fallback regex-based extraction
  // -----------------------------------------------------------------------

  private fallbackExtractTypes(source: string, filePath: string): TypeInfo[] {
    const types: TypeInfo[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;

    // Type definitions: type Foo struct { ... }
    const typeRx = /type\s+(\w+)(?:\[([^\]]+)\])?\s+(struct|interface)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = typeRx.exec(source)) !== null) {
      const name = m[1]!;
      const kind = m[3] === 'interface' ? 'interface' : 'class';
      const typeParams = m[2] ? m[2].split(',').map((p) => p.trim()) : [];

      types.push({
        name, qualifiedName: `file:${filePath}:${name}`, filePath, kind,
        members: new Map(), baseTypes: [], implementedInterfaces: [],
        typeParameters: typeParams, returnType: null, parameterTypes: [],
        isExported: name[0] === name[0]?.toUpperCase(), isAbstract: false,
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    // Function declarations
    const funcRx = /func\s+(?:\(([^)]*)\)\s+)?(\w+)\s*\(/g;
    while ((m = funcRx.exec(source)) !== null) {
      const name = m[2]!;
      types.push({
        name, qualifiedName: `file:${filePath}:${name}`, filePath, kind: 'function',
        members: new Map(), baseTypes: m[1] ? [m[1].replace(/^\*/, '')] : [],
        implementedInterfaces: [], typeParameters: [],
        returnType: null, parameterTypes: [],
        isExported: name[0] === name[0]?.toUpperCase(), isAbstract: false,
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    return types;
  }
}
