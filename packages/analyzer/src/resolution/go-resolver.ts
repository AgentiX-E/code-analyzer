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

function loadGoLanguage(): boolean {
  if (GoLanguage) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    GoLanguage = require('tree-sitter-go');
    return true;
  } catch {
    return false;
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

    if (!loadGoLanguage()) {
      return this.fallbackExtractTypes(source, filePath);
    }

    const parser = new Parser();
    parser.setLanguage(GoLanguage as Parser.Language);
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
      if (info) types.push(info);
    }

    if (nt === 'method_declaration') {
      const info = this.extractMethod(node, source);
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
      if (!child) continue;

      if (child.type === 'type_spec') {
        const name = this.childText(child, 'type_identifier');
        if (!name) continue;

        const qn = `file:${this.filePath}:${name}`;
        const exported = name[0] === name[0]?.toUpperCase();
        let kind: TypeInfo['kind'] = 'type';
        let members = new Map<string, TypeMember>();
        let baseTypes: string[] = [];
        const typeParams: string[] = [];

        // Look for struct_type, interface_type directly as named children of type_spec
        const structNode = this.findChild(child, 'struct_type');
        const interfaceNode = this.findChild(child, 'interface_type');
        const genericNode = this.findChild(child, 'generic_type');

        if (structNode) {
          kind = 'class'; // Go struct
          members = this.extractStructFields(structNode, name);
        } else if (interfaceNode) {
          kind = 'interface';
          members = this.extractInterfaceMethods(interfaceNode);
          // Register interface for satisfaction checking
          this.interfaceCache.set(name, {
            name,
            package: '',
            methods: this.extractInterfaceSigs(interfaceNode),
            embeddedInterfaces: [],
          });
        } else if (genericNode) {
          kind = 'type';
          this.extractGenericParams(child, typeParams);
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
    if (!name) return null;

    const qn = `file:${this.filePath}:${name}`;
    const exported = name[0] === name[0]?.toUpperCase();
    const typeParams = this.extractFuncGenericParams(node);

    // Parameters
    const paramTypes: string[] = [];
    const paramList = this.findChild(node, 'parameter_list');
    if (paramList) {
      this.extractGoParams(paramList, paramTypes);
    }

    // Results
    let returnType: string | null = null;
    const resultList = this.findChild(node, 'result');
    if (resultList) {
      const resParams: string[] = [];
      this.extractGoParams(resultList, resParams);
      returnType = resParams.length === 0 ? 'void' :
        resParams.length === 1 ? resParams[0]! :
        `(${resParams.join(', ')})`;
    }

    // Check for receiver (method)
    let baseType = '';
    const receiver = this.findChild(node, 'parameter_list');
    if (receiver && node.type === 'method_declaration') {
      // First param is the receiver
    }

    return {
      name, qualifiedName: qn, filePath: this.filePath, kind: 'function',
      members: new Map(), baseTypes: baseType ? [baseType] : [],
      implementedInterfaces: [], typeParameters: typeParams,
      returnType, parameterTypes: paramTypes,
      isExported: exported, isAbstract: false, decorators: [],
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  private extractMethod(node: SyntaxNode, _source: string): TypeInfo | null {
    const name = this.childText(node, 'field_identifier');
    if (!name) return null;

    const qn = `file:${this.filePath}:${name}`;
    const exported = name[0] === name[0]?.toUpperCase();

    // Get receiver type
    let receiverType = '';
    const paramList = this.findChild(node, 'parameter_list');
    if (paramList) {
      const firstParam = paramList.child(0);
      if (firstParam) {
        const typeNode = this.findChild(firstParam, 'type');
        if (typeNode) {
          receiverType = typeNode.text.replace(/^\*/, '').trim();
        }
      }
    }

    // Parameters after receiver
    const paramTypes: string[] = [];
    if (paramList && paramList.childCount > 1) {
      for (let i = 1; i < paramList.childCount; i++) {
        const p = paramList.child(i);
        if (p) {
          const typeNode = this.findChild(p, 'type');
          if (typeNode) paramTypes.push(typeNode.text);
        }
      }
    }

    let returnType: string | null = null;
    const result = this.findChild(node, 'result');
    if (result) {
      const resParams: string[] = [];
      this.extractGoParams(result, resParams);
      returnType = resParams.join(', ') || 'void';
    }

    return {
      name, qualifiedName: qn, filePath: this.filePath, kind: 'function',
      members: new Map(), baseTypes: receiverType ? [receiverType] : [],
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

      // Get type
      const typeNode = this.findChild(child, 'type');
      const fieldType = typeNode ? typeNode.text : 'unknown';

      // Get struct tag
      const tagNode = this.findChild(child, 'raw_string_literal');
      let tagValue = '';
      if (tagNode) {
        tagValue = tagNode.text;
      }

      // If no explicit field name, this is an embedded type
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

      // Parse tags
      const parsedTags = tagValue ? this.parseStructTags(tagValue) : [];

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
      if (!child) continue;

      if (child.type === 'method_spec') {
        const name = this.childText(child, 'field_identifier');
        if (!name) continue;

        // Parameters
        const paramTypes: string[] = [];
        const paramList = this.findChild(child, 'parameter_list');
        if (paramList) this.extractGoParams(paramList, paramTypes);

        // Results
        let returnType = 'void';
        const result = this.findChild(child, 'result');
        if (result) {
          const resParams: string[] = [];
          this.extractGoParams(result, resParams);
          returnType = resParams.join(', ') || 'void';
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
      if (!child || child.type !== 'method_spec') continue;

      const name = this.childText(child, 'field_identifier');
      if (!name) continue;

      const params: GoParam[] = [];
      const paramList = this.findChild(child, 'parameter_list');
      if (paramList) params.push(...this.extractGoSigParams(paramList));

      const results: GoParam[] = [];
      const result = this.findChild(child, 'result');
      if (result) results.push(...this.extractGoSigParams(result));

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
    // Structural compatibility check
    if (a === b) return true;
    if (a === 'any' || b === 'any') return true;
    // Check if both are interfaces (structural matching)
    if (a.startsWith('interface') || b.startsWith('interface')) return true;
    return false;
  }

  private extractGoParams(paramList: SyntaxNode, result: string[]): void {
    for (let i = 0; i < paramList.childCount; i++) {
      const child = paramList.child(i);
      if (!child) continue;
      const typeNode = this.findChild(child, 'type');
      if (typeNode) {
        result.push(typeNode.text);
      } else if (child.type === 'type_identifier') {
        result.push(child.text);
      }
    }
  }

  private extractGoSigParams(paramList: SyntaxNode): GoParam[] {
    const params: GoParam[] = [];
    for (let i = 0; i < paramList.childCount; i++) {
      const child = paramList.child(i);
      if (!child) continue;

      // Go params: identifier type or just type
      const identifiers = child.children.filter(
        (c) => c.type === 'identifier' || c.type === 'type_identifier',
      );
      const typeNode = this.findChild(child, 'type');

      const paramType = typeNode ? typeNode.text :
        (identifiers.length > 0 ? identifiers[identifiers.length - 1]!.text : 'unknown');

      const paramName = identifiers.length > 0 ? identifiers[0]!.text : '';

      params.push({ name: paramName, type: paramType });
    }
    return params;
  }

  private extractGenericParams(node: SyntaxNode, result: string[]): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === 'type_parameter_declaration') {
        for (let j = 0; j < child.childCount; j++) {
          const tp = child.child(j);
          if (tp && (tp.type === 'type_identifier' || tp.type === 'identifier')) {
            result.push(tp.text);
          }
        }
      }
    }
  }

  private extractFuncGenericParams(node: SyntaxNode): string[] {
    const params: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === 'type_parameters') {
        for (let j = 0; j < child.childCount; j++) {
          const tp = child.child(j);
          if (tp && (tp.type === 'type_identifier' || tp.type === 'identifier')) {
            params.push(tp.text);
          }
        }
      }
    }
    return params;
  }

  private childText(node: SyntaxNode, type: string): string | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c && c.type === type && c.text) return c.text;
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
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
