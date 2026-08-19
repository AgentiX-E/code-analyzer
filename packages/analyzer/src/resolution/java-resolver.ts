// @code-analyzer/analyzer — Java Type Resolver
// Provides type resolution for Java source files:
//   1. Generic type inference — List<String>, Map<K, V>
//   2. Interface / abstract class resolution — implements, extends
//   3. Annotation processing — @Override, @Nullable, @NotNull
//   4. Method overloading — resolve which overload is called
//
// Uses tree-sitter-java AST for structural extraction with regex fallback.

import Parser from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import type { TypeInfo, TypeMember } from '../resolution/type-registry.js';
import {
  TypeResolverBase,
  type ResolvedType,
  type TypeContext,
} from '../resolution/type-resolver-base.js';

// ---------------------------------------------------------------------------
// Lazy language loader
// ---------------------------------------------------------------------------

let JavaLanguage: unknown;

/**
 * Lazily load the tree-sitter-java grammar. Returns the grammar language
 * object, or null if the native binding fails to load (e.g. binary
 * incompatibility). Callers fall back to regex extraction in that case.
 */
function loadJavaLanguage(): unknown {
  if (JavaLanguage) return JavaLanguage;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    JavaLanguage = require('tree-sitter-java');
    return JavaLanguage;
  } catch {
    /* v8 ignore next -- @preserve native module load failure is untestable */
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

interface JavaMethodSignature {
  name: string;
  paramTypes: string[];
  returnType: string;
  visibility: 'public' | 'protected' | 'private' | 'package';
  isStatic: boolean;
  isAbstract: boolean;
  isFinal: boolean;
  annotations: string[];
  throwsTypes: string[];
}

interface JavaAnnotation {
  name: string;
  params: Record<string, string>;
}

// ---------------------------------------------------------------------------
// JavaResolver
// ---------------------------------------------------------------------------

export class JavaResolver extends TypeResolverBase {
  readonly language = 'java';
  private source = '';
  private filePath = '';
  private typeCache = new Map<string, ResolvedType>();
  private overloadCache = new Map<string, JavaMethodSignature[]>();
  private readonly loadGrammar: () => unknown;

  /**
   * @param loadGrammar Injectable grammar loader (test seam). Defaults to the
   *   lazy `loadJavaLanguage` helper. Returns the grammar language object or
   *   null to trigger regex fallback extraction.
   */
  constructor(loadGrammar: () => unknown = loadJavaLanguage) {
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

    // 1. Java primitives
    if (this.isJavaPrimitive(normalized)) {
      resolved = this.mapJavaPrimitive(normalized);
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 2. Array types: int[], String[]
    resolved = this.resolveJavaArray(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 3. Generic types: List<String>, Map<K, V>
    resolved = this.resolveJavaGeneric(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 4. Wildcard types: ? extends T, ? super T
    resolved = this.resolveJavaWildcard(normalized, context);
    if (resolved) {
      this.typeCache.set(normalized, resolved);
      return resolved;
    }

    // 5. External lookup
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

  private resolveJavaArray(typeName: string, _context: TypeContext): ResolvedType | null {
    if (!typeName.endsWith('[]')) return null;
    const base = this.makeJavaUnresolved(typeName.slice(0, -2));
    return {
      name: `${base.name}[]`,
      kind: 'generic',
      genericArgs: [base],
      documentation: `Array of ${base.name}`,
    };
  }

  private resolveJavaGeneric(typeName: string, _context: TypeContext): ResolvedType | null {
    const match = typeName.match(/^(\w[\w.]*)\s*<\s*(.+?)\s*>$/);
    if (!match) return null;

    const base = match[1]!;
    const argsStr = match[2]!;
    const args = this.splitTopLevelCommas(argsStr);
    const resolvedArgs = args.map((a) => this.makeJavaUnresolved(a.trim()));

    // Known Java collection types
    const knownCollections = new Set([
      'List', 'Set', 'Map', 'Collection', 'Iterable', 'Iterator',
      'ArrayList', 'LinkedList', 'HashSet', 'TreeSet',
      'HashMap', 'TreeMap', 'LinkedHashMap',
      'Optional', 'Stream', 'Supplier', 'Consumer', 'Function',
      'Predicate', 'BiFunction', 'UnaryOperator',
      'Comparable', 'Comparator',
    ]);

    if (knownCollections.has(base)) {
      const members: Record<string, ResolvedType> = {};
      if (base === 'List' || base === 'ArrayList' || base === 'LinkedList') {
        members['size'] = this.primitive('int');
        members['get'] = this.functionType('get', [this.primitive('int')], this.argAt(resolvedArgs, 0));
        members['add'] = this.functionType('add', [this.argAt(resolvedArgs, 0)], this.primitive('boolean'));
      }
      if (base === 'Map' || base === 'HashMap' || base === 'TreeMap') {
        members['size'] = this.primitive('int');
        members['get'] = this.functionType('get', [this.primitive('Object')], this.argAt(resolvedArgs, 1));
        members['put'] = this.functionType('put', [this.argAt(resolvedArgs, 0), this.argAt(resolvedArgs, 1)], this.argAt(resolvedArgs, 1));
      }
      if (base === 'Set' || base === 'HashSet' || base === 'TreeSet') {
        members['size'] = this.primitive('int');
        members['add'] = this.functionType('add', [this.argAt(resolvedArgs, 0)], this.primitive('boolean'));
      }
      if (base === 'Optional') {
        members['get'] = this.functionType('get', [], this.argAt(resolvedArgs, 0));
        members['isPresent'] = this.functionType('isPresent', [], this.primitive('boolean'));
      }
      if (base === 'Stream') {
        members['collect'] = this.functionType('collect', [this.unknownType()], this.unknownType());
        members['map'] = this.functionType('map', [this.unknownType()], this.unknownType());
        members['filter'] = this.functionType('filter', [this.unknownType()], this.unknownType());
      }

      return {
        name: `${base}<${resolvedArgs.map((a) => a.name).join(', ')}>`,
        kind: 'generic',
        genericArgs: resolvedArgs,
        members: Object.keys(members).length > 0 ? members : undefined,
      };
    }

    return {
      name: `${base}<${resolvedArgs.map((a) => a.name).join(', ')}>`,
      kind: 'generic',
      genericArgs: resolvedArgs,
    };
  }

  private resolveJavaWildcard(typeName: string, _context: TypeContext): ResolvedType | null {
    // ? extends T
    const extendsMatch = typeName.match(/^\?\s+extends\s+(.+)$/);
    if (extendsMatch) {
      const upper = this.makeJavaUnresolved(extendsMatch[1]!);
      return { name: `? extends ${upper.name}`, kind: 'generic', genericArgs: [upper] };
    }

    // ? super T
    const superMatch = typeName.match(/^\?\s+super\s+(.+)$/);
    if (superMatch) {
      const lower = this.makeJavaUnresolved(superMatch[1]!);
      return { name: `? super ${lower.name}`, kind: 'generic', genericArgs: [lower] };
    }

    // Bare ?
    if (typeName === '?') {
      return { name: '?', kind: 'unknown' };
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Annotation processing
  // -----------------------------------------------------------------------

  /**
   * Parse Java annotations from source text.
   *
   * Input: @Override, @Nullable, @NotNull, @SuppressWarnings("unchecked")
   * Output: [{ name: "Override", params: {} }, ...]
   */
  parseAnnotations(annotationNodes: SyntaxNode[], _source: string): JavaAnnotation[] {
    return annotationNodes.map((node) => {
      const text = node.text;
      // Extract name (strip @)
      let name = '';
      const nameMatch = text.match(/@(\w[\w.]*)/);
      /* v8 ignore next -- @preserve -- annotation nodes always begin with '@' */
      if (nameMatch) name = nameMatch[1]!;

      // Extract params
      const params: Record<string, string> = {};
      const parenMatch = text.match(/@\w[\w.]*\((.+)\)/);
      if (parenMatch) {
        const inner = parenMatch[1]!;
        // Simple key=value or just value
        const kvMatch = inner.match(/^\s*(\w+)\s*=\s*(.+)\s*$/);
        if (kvMatch) {
          params[kvMatch[1]!] = kvMatch[2]!.replace(/"/g, '').trim();
        } else {
          params['value'] = inner.replace(/"/g, '').trim();
        }
      }

      return { name, params };
    });
  }

  /**
   * Process common Java annotations and derive type information.
   */
  processAnnotation(annotation: JavaAnnotation): ResolvedType | null {
    switch (annotation.name) {
      case 'Nullable':
      case 'javax.annotation.Nullable':
      case 'org.jetbrains.annotations.Nullable':
        return this.primitive('null', true);

      case 'NotNull':
      case 'javax.validation.constraints.NotNull':
      case 'org.jetbrains.annotations.NotNull':
        return this.primitive('null', false); // Marks non-null

      case 'NonNull':
        return null; // Non-null marker, no type change

      case 'Override':
        return null; // Verification annotation, no type change

      case 'FunctionalInterface':
        return { name: 'FunctionalInterface', kind: 'object' };

      case 'Deprecated':
        return null; // Purely documentation

      case 'SuppressWarnings':
        return null; // Compiler directive

      case 'Entity':
      case 'javax.persistence.Entity':
        return { name: 'Entity', kind: 'object' };

      case 'Repository':
      case 'org.springframework.stereotype.Repository':
        return { name: 'Repository', kind: 'object' };

      case 'Service':
      case 'org.springframework.stereotype.Service':
        return { name: 'Service', kind: 'object' };

      default:
        // Custom annotations
        return {
          name: `@${annotation.name}`,
          kind: 'object',
          members: Object.fromEntries(
            Object.entries(annotation.params).map(([k, v]) => [k, { name: v, kind: 'primitive' } as ResolvedType])
          ),
        };
    }
  }

  // -----------------------------------------------------------------------
  // Method overloading resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve the best matching overload for a method call.
   *
   * @param methodName - The method name being called
   * @param argTypes - The argument types at the call site
   * @returns The best matching overload, or null if no match
   */
  resolveOverload(
    methodName: string,
    argTypes: string[],
  ): JavaMethodSignature | null {
    const overloads = this.overloadCache.get(methodName);
    if (!overloads || overloads.length === 0) return null;

    // Score each overload based on how well arguments match
    let bestMatch: JavaMethodSignature | null = null;
    let bestScore = -1;

    for (const overload of overloads) {
      const score = this.scoreOverloadMatch(overload, argTypes);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = overload;
      }
    }

    return bestMatch;
  }

  /**
   * Score how well a method signature matches the given argument types.
   * Higher score = better match. Returns -1 for incompatible arity.
   */
  scoreOverloadMatch(signature: JavaMethodSignature, argTypes: string[]): number {
    if (signature.paramTypes.length !== argTypes.length) return -1;

    let score = 0;
    for (let i = 0; i < argTypes.length; i++) {
      const paramType = signature.paramTypes[i]!;
      const argType = argTypes[i]!;

      if (paramType === argType) {
        score += 10; // Exact match
      } else if (this.isJavaPrimitive(paramType) && this.isJavaPrimitive(argType)) {
        score += this.primitiveWideningScore(paramType, argType);
      } else if (this.isAssignableCompatible(argType, paramType)) {
        score += 5; // Subtype match
      } else if (argType === 'null') {
        score += 3; // null can match any reference type
      } else {
        score += 1; // Loose match requiring boxing/unboxing
      }
    }

    return score;
  }

  /**
   * Java primitive widening conversion score.
   */
  private primitiveWideningScore(target: string, source: string): number {
    const wideningOrder: Record<string, string[]> = {
      'byte': ['byte'],
      'short': ['byte', 'short'],
      'int': ['byte', 'short', 'int', 'char'],
      'long': ['byte', 'short', 'int', 'long', 'char'],
      'float': ['byte', 'short', 'int', 'long', 'float', 'char'],
      'double': ['byte', 'short', 'int', 'long', 'float', 'double', 'char'],
    };
    const order = wideningOrder[target];
    if (order && order.includes(source)) {
      return 8; // Valid widening
    }
    return 0;
  }

  // -----------------------------------------------------------------------
  // AST Walking
  // -----------------------------------------------------------------------

  private walkAST(node: SyntaxNode, source: string, types: TypeInfo[]): void {
    const nt = node.type;

    if (nt === 'class_declaration') {
      const info = this.extractClass(node, source);
      /* v8 ignore next -- @preserve -- extractClass always returns a TypeInfo for a class_declaration */
      if (info) types.push(info);
    }

    if (nt === 'interface_declaration') {
      const info = this.extractInterface(node, source);
      /* v8 ignore next -- @preserve -- extractInterface always returns a TypeInfo for an interface_declaration */
      if (info) types.push(info);
    }

    if (nt === 'enum_declaration') {
      const info = this.extractEnum(node, source);
      /* v8 ignore next -- @preserve -- extractEnum always returns a TypeInfo for an enum_declaration */
      if (info) types.push(info);
    }

    if (nt === 'annotation_type_declaration') {
      const info = this.extractAnnotationType(node, source);
      /* v8 ignore next -- @preserve -- extractAnnotationType always returns a TypeInfo for an annotation_type_declaration */
      if (info) types.push(info);
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAST(node.child(i), source, types);
    }
  }

  // -----------------------------------------------------------------------
  // Extractors
  // -----------------------------------------------------------------------

  private extractClass(node: SyntaxNode, _source: string): TypeInfo | null {
    const name = this.childText(node, 'identifier');
    /* v8 ignore next -- @preserve -- class_declaration always has an identifier */
    if (!name) return null;

    const qn = `file:${this.filePath}:${name}`;
    const modifiers = this.extractModifiers(node);
    const exported = modifiers.includes('public');
    const isAbstract = modifiers.includes('abstract');
    const isFinal = modifiers.includes('final');
    const annotations = this.extractAnnotations(node);

    // Superclass (extends)
    const baseTypes: string[] = [];
    const superclass = this.findChild(node, 'superclass');
    if (superclass) {
      let scName = this.childText(superclass, 'type_identifier') ||
        this.childText(superclass, 'identifier') ||
        this.childText(superclass, 'scoped_type_identifier');
      // If superclass uses generics (e.g., AbstractList<T>), type_identifier is inside generic_type
      if (!scName) {
        const genericType = this.findChild(superclass, 'generic_type');
        /* v8 ignore next -- @preserve -- a generic superclass always has a generic_type node */
        if (genericType) {
          scName = this.childText(genericType, 'type_identifier');
        }
      }
      /* v8 ignore next -- @preserve -- superclass always resolves to a name */
      if (scName) baseTypes.push(scName);
    }

    // Interfaces (implements)
    const implemented: string[] = [];
    const superInterfaces = this.findChild(node, 'super_interfaces');
    if (superInterfaces) {
      // tree-sitter-java always wraps implemented interfaces in a type_list node.
      const typeList = this.findChild(superInterfaces, 'type_list')!;
      for (let i = 0; i < typeList.childCount; i++) {
        const iface = typeList.child(i);
        let ifaceName: string | null = null;
        if (iface.type === 'type_identifier') {
          ifaceName = iface.text;
        } else if (iface.type === 'generic_type') {
          ifaceName = this.childText(iface, 'type_identifier');
        } else {
          ifaceName = this.childText(iface, 'type_identifier');
        }
        if (ifaceName) implemented.push(ifaceName);
      }
    }

    // Type parameters (generics)
    const typeParams = this.extractTypeParameters(node);

    // Members
    const members = new Map<string, TypeMember>();
    const body = this.findChild(node, 'class_body');
    /* v8 ignore next -- @preserve -- class_declaration always has a class_body */
    if (body) {
      this.extractClassMembers(body, members);
    }

    return {
      name, qualifiedName: qn, filePath: this.filePath, kind: isAbstract ? 'interface' : 'class',
      members, baseTypes, implementedInterfaces: implemented,
      typeParameters: typeParams, returnType: null, parameterTypes: [],
      isExported: exported, isAbstract, decorators: annotations.map((a) => `@${a.name}`),
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  private extractInterface(node: SyntaxNode, _source: string): TypeInfo | null {
    const name = this.childText(node, 'identifier');
    /* v8 ignore next -- @preserve -- interface_declaration always has an identifier */
    if (!name) return null;

    const qn = `file:${this.filePath}:${name}`;
    const exported = this.extractModifiers(node).includes('public');
    const annotations = this.extractAnnotations(node);

    // Extended interfaces
    const baseTypes: string[] = [];
    const extendsClause = this.findChild(node, 'extends_interfaces');
    if (extendsClause) {
      // tree-sitter-java always wraps extended interfaces in a type_list node.
      const typeList = this.findChild(extendsClause, 'type_list')!;
      for (let i = 0; i < typeList.childCount; i++) {
        const c = typeList.child(i);
        if (c.type === 'type_identifier' || c.type === 'identifier') {
          baseTypes.push(c.text);
        } else if (c.type === 'generic_type') {
          const genericName = this.childText(c, 'type_identifier');
          /* v8 ignore next -- @preserve -- generic_type always has a type_identifier */
          if (genericName) baseTypes.push(genericName);
        }
      }
    }

    const typeParams = this.extractTypeParameters(node);
    const members = new Map<string, TypeMember>();
    const body = this.findChild(node, 'interface_body');
    /* v8 ignore next -- @preserve -- interface_declaration always has an interface_body */
    if (body) {
      this.extractInterfaceMembers(body, members);
    }

    return {
      name, qualifiedName: qn, filePath: this.filePath, kind: 'interface',
      members, baseTypes, implementedInterfaces: [],
      typeParameters: typeParams, returnType: null, parameterTypes: [],
      isExported: exported, isAbstract: true, decorators: annotations.map((a) => `@${a.name}`),
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  private extractEnum(node: SyntaxNode, _source: string): TypeInfo | null {
    const name = this.childText(node, 'identifier');
    /* v8 ignore next -- @preserve -- enum_declaration always has an identifier */
    if (!name) return null;

    const qn = `file:${this.filePath}:${name}`;
    const exported = this.extractModifiers(node).includes('public');
    const annotations = this.extractAnnotations(node);

    // Enum constants
    const members = new Map<string, TypeMember>();
    const body = this.findChild(node, 'enum_body');
    /* v8 ignore next -- @preserve -- enum_declaration always has an enum_body */
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const c = body.child(i);
        if (c.type === 'enum_constant') {
          const constName = this.childText(c, 'identifier');
          /* v8 ignore next -- @preserve -- enum_constant always has an identifier */
          if (constName) {
            members.set(constName, {
              name: constName, type: 'enum_constant',
              visibility: 'public', isStatic: true, isOptional: false, isAsync: false,
              parameterTypes: [], returnType: 'enum_constant',
            });
          }
        }
      }
    }

    return {
      name, qualifiedName: qn, filePath: this.filePath, kind: 'enum',
      members, baseTypes: [], implementedInterfaces: [],
      typeParameters: [], returnType: null, parameterTypes: [],
      isExported: exported, isAbstract: false, decorators: annotations.map((a) => `@${a.name}`),
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  private extractAnnotationType(node: SyntaxNode, _source: string): TypeInfo | null {
    const name = this.childText(node, 'identifier');
    /* v8 ignore next -- @preserve -- annotation_type_declaration always has an identifier */
    if (!name) return null;

    const qn = `file:${this.filePath}:${name}`;
    const exported = this.extractModifiers(node).includes('public');

    const members = new Map<string, TypeMember>();
    const body = this.findChild(node, 'annotation_type_body');
    /* v8 ignore next -- @preserve -- annotation_type_declaration always has a body */
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const c = body.child(i);
        if (c.type === 'annotation_type_element_declaration') {
          const elemName = this.childText(c, 'identifier');
          /* v8 ignore next -- @preserve -- element declaration always has an identifier */
          if (elemName) {
            const typeNode = this.findTypeNode(c);
            /* v8 ignore next -- @preserve -- element always has a type; String is a fallback */
            const elemType = typeNode ? typeNode.text : 'String';
            members.set(elemName, {
              name: elemName, type: elemType,
              visibility: 'public', isStatic: true, isOptional: false, isAsync: false,
              parameterTypes: [], returnType: elemType,
            });
          }
        }
      }
    }

    return {
      name, qualifiedName: qn, filePath: this.filePath, kind: 'interface',
      members, baseTypes: [], implementedInterfaces: [],
      typeParameters: [], returnType: null, parameterTypes: [],
      isExported: exported, isAbstract: true, decorators: [],
      location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
    };
  }

  // -----------------------------------------------------------------------
  // Member extraction
  // -----------------------------------------------------------------------

  private extractClassMembers(body: SyntaxNode, members: Map<string, TypeMember>): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      /* v8 ignore next -- @preserve -- index is bounded by childCount */
      if (!child) continue;

      // Method declaration
      if (child.type === 'method_declaration' || child.type === 'constructor_declaration') {
        const mName = this.childText(child, 'identifier');
        /* v8 ignore next -- @preserve -- method/constructor always has an identifier */
        if (!mName) continue;

        const modifiers = this.extractModifiers(child);
        const visibility = modifiers.includes('private') ? 'private' :
          modifiers.includes('protected') ? 'protected' : 'public';
        const isStatic = modifiers.includes('static');
        const paramTypes = this.extractMethodParams(child);
        const returnType = child.type === 'constructor_declaration' ? 'void' :
          this.extractMethodReturn(child);

        // Store method signature for overload resolution
        const sigs = this.overloadCache.get(mName) || [];
        sigs.push({
          name: mName,
          paramTypes,
          returnType,
          visibility: visibility as JavaMethodSignature['visibility'],
          isStatic,
          isAbstract: modifiers.includes('abstract'),
          isFinal: modifiers.includes('final'),
          annotations: this.extractAnnotations(child).map((a) => a.name),
          throwsTypes: [],
        });
        this.overloadCache.set(mName, sigs);

        members.set(mName, {
          name: mName, type: `(${paramTypes.join(', ')}) => ${returnType}`,
          visibility: visibility as 'public' | 'protected' | 'private',
          isStatic, isOptional: false, isAsync: false,
          parameterTypes: paramTypes, returnType,
        });
      }

      // Field declaration
      if (child.type === 'field_declaration') {
        const modifiers = this.extractModifiers(child);
        const visibility = modifiers.includes('private') ? 'private' :
          modifiers.includes('protected') ? 'protected' : 'public';
        const isStatic = modifiers.includes('static');

        const typeNode = this.findTypeNode(child);
        /* v8 ignore next -- @preserve -- field always has a type; Object is a fallback */
        const fieldType = typeNode ? typeNode.text : 'Object';

        for (let j = 0; j < child.childCount; j++) {
          const decl = child.child(j);
          if (decl && decl.type === 'variable_declarator') {
            const fname = this.childText(decl, 'identifier');
            /* v8 ignore next -- @preserve -- variable_declarator always has an identifier */
            if (fname) {
              members.set(fname, {
                name: fname, type: fieldType,
                visibility: visibility as 'public' | 'protected' | 'private',
                isStatic, isOptional: false, isAsync: false,
                parameterTypes: [], returnType: fieldType,
              });
            }
          }
        }
      }
    }
  }

  private extractInterfaceMembers(body: SyntaxNode, members: Map<string, TypeMember>): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      /* v8 ignore next -- @preserve -- index is bounded by childCount */
      if (!child) continue;

      if (child.type === 'method_declaration') {
        const mName = this.childText(child, 'identifier');
        /* v8 ignore next -- @preserve -- interface method always has an identifier */
        if (!mName) continue;

        const paramTypes = this.extractMethodParams(child);
        const returnType = this.extractMethodReturn(child);

        members.set(mName, {
          name: mName,
          type: `(${paramTypes.join(', ')}) => ${returnType}`,
          visibility: 'public',
          isStatic: false,
          isOptional: false,
          isAsync: false,
          parameterTypes: paramTypes,
          returnType,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private makeJavaUnresolved(name: string): ResolvedType {
    const trimmed = name.trim();
    if (this.isJavaPrimitive(trimmed)) return this.mapJavaPrimitive(trimmed);
    return { name: trimmed, kind: 'unknown' };
  }

  /** Return the generic argument at `index`, or an unknown type when absent. */
  private argAt(args: ResolvedType[], index: number): ResolvedType {
    return args[index] ?? this.unknownType();
  }

  private isJavaPrimitive(name: string): boolean {
    const primitives = new Set([
      'boolean', 'byte', 'short', 'int', 'long', 'float', 'double', 'char',
      'void', 'null',
    ]);
    return primitives.has(name);
  }

  private mapJavaPrimitive(name: string): ResolvedType {
    return { name, kind: 'primitive', isNullable: name === 'null' };
  }

  private isAssignableCompatible(from: string, to: string): boolean {
    // Minimal subtype check — real type hierarchy lookups are out of scope.
    // Only invoked after the exact-match branch in scoreOverloadMatch, so
    // `from !== to` here and the identity case needs no special handling.
    if (from === 'Object') return false;
    if (to === 'Object') return true;
    return false;
  }

  private extractModifiers(node: SyntaxNode): string[] {
    const mods: string[] = [];
    const modNode = this.findChild(node, 'modifiers');
    if (!modNode) return mods;
    for (let i = 0; i < modNode.childCount; i++) {
      const c = modNode.child(i);
      /* v8 ignore next -- @preserve -- index is bounded by childCount */
      if (c) mods.push(c.text);
    }
    return mods;
  }

  private extractAnnotations(node: SyntaxNode): JavaAnnotation[] {
    const anns: JavaAnnotation[] = [];
    const modNode = this.findChild(node, 'modifiers');
    if (!modNode) return anns;

    const annotationNodes: SyntaxNode[] = [];
    for (let i = 0; i < modNode.childCount; i++) {
      const c = modNode.child(i);
      if (c && (c.type === 'annotation' || c.type === 'marker_annotation')) {
        annotationNodes.push(c);
      }
    }

    return this.parseAnnotations(annotationNodes, '');
  }

  private extractTypeParameters(node: SyntaxNode): string[] {
    const params: string[] = [];
    const tp = this.findChild(node, 'type_parameters');
    if (!tp) return params;
    for (let i = 0; i < tp.childCount; i++) {
      const c = tp.child(i);
      if (c && c.type === 'type_parameter') {
        const name = this.childText(c, 'type_identifier');
        /* v8 ignore next -- @preserve -- type_parameter always has a type_identifier */
        if (name) params.push(name);
      }
    }
    return params;
  }

  private extractMethodParams(node: SyntaxNode): string[] {
    const paramTypes: string[] = [];
    const formalParams = this.findChild(node, 'formal_parameters');
    /* v8 ignore next -- @preserve -- every method declaration has formal_parameters */
    if (!formalParams) return paramTypes;

    for (let i = 0; i < formalParams.childCount; i++) {
      const param = formalParams.child(i);
      /* v8 ignore next -- @preserve -- index is bounded by childCount */
      if (!param) continue;

      // Varargs are a *sibling* of formal_parameter (spread_parameter), not a
      // child — both must be handled at the same level.
      if (param.type === 'formal_parameter') {
        const typeNode = this.findTypeNode(param);
        /* v8 ignore next -- @preserve -- parameter always has a type; Object is a fallback */
        paramTypes.push(typeNode ? typeNode.text : 'Object');
      } else if (param.type === 'spread_parameter') {
        const typeNode = this.findTypeNode(param);
        /* v8 ignore next -- @preserve -- spread parameter always has a type */
        paramTypes.push(typeNode ? `${typeNode.text}...` : 'Object...');
      }
    }
    return paramTypes;
  }

  private extractMethodReturn(node: SyntaxNode): string {
    // tree-sitter-java has no `type` wrapper; the return type is one of the
    // declaration type nodes directly (array_type text already includes its
    // dimensions, e.g. "int[][]").
    const returnType = this.findTypeNode(node);
    /* v8 ignore next -- @preserve -- method always has a return type; void is a fallback */
    return returnType ? returnType.text : 'void';
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
   * Node types that tree-sitter-java uses to represent a *declaration* type
   * (return type, parameter type, field type). Unlike tree-sitter-typescript,
   * Java has no generic `type` wrapper node — the type is one of these concrete
   * node types directly.
   */
  private static readonly DECLARATION_TYPE_NODES = new Set([
    'void_type',
    'integral_type',
    'floating_point_type',
    'boolean_type',
    'type_identifier',
    'scoped_type_identifier',
    'generic_type',
    'array_type',
  ]);

  /** Find the first named child that represents a Java type declaration. */
  private findTypeNode(node: SyntaxNode): SyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c && JavaResolver.DECLARATION_TYPE_NODES.has(c.type)) return c;
    }
    /* v8 ignore next -- @preserve -- declarations always carry a type node */
    return null;
  }

  // -----------------------------------------------------------------------
  // Fallback regex-based extraction
  // -----------------------------------------------------------------------

  private fallbackExtractTypes(source: string, filePath: string): TypeInfo[] {
    const types: TypeInfo[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;

    // Class declarations (including generics)
    const classRx = /(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+)*class\s+(\w+)(?:<([^>]+)>)?(?:\s+extends\s+([\w.<>,\s]+?))?(?:\s+implements\s+(.+?))?\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = classRx.exec(source)) !== null) {
      const baseType = m[3] ? m[3].replace(/<[^>]+>/, '').split(',')[0]!.trim() : null;
      const impls = m[4] ? m[4].split(',').map((s) => s.replace(/<[^>]+>/, '').trim()) : [];
      const typeParams = m[2] ? m[2].split(',').map((s) => s.trim().split(/\s+/)[0]!).filter(Boolean) : [];
      types.push({
        name: m[1]!, qualifiedName: `file:${filePath}:${m[1]}`, filePath, kind: 'class',
        members: new Map(), baseTypes: baseType ? [baseType] : [],
        implementedInterfaces: impls, typeParameters: typeParams,
        returnType: null, parameterTypes: [],
        isExported: true, isAbstract: false, decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    // Interface declarations
    const ifaceRx = /(?:public\s+)?interface\s+(\w+)(?:<([^>]+)>)?(?:\s+extends\s+(.+?))?\s*\{/g;
    while ((m = ifaceRx.exec(source)) !== null) {
      const bases = m[3] ? m[3].split(',').map((s) => s.trim()) : [];
      const typeParams = m[2] ? m[2].split(',').map((s) => s.trim().split(/\s+/)[0]!).filter(Boolean) : [];
      types.push({
        name: m[1]!, qualifiedName: `file:${filePath}:${m[1]}`, filePath, kind: 'interface',
        members: new Map(), baseTypes: bases, implementedInterfaces: [],
        typeParameters: typeParams, returnType: null, parameterTypes: [],
        isExported: true, isAbstract: true, decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    // Enum declarations
    const enumRx = /(?:public\s+)?enum\s+(\w+)\s*\{/g;
    while ((m = enumRx.exec(source)) !== null) {
      types.push({
        name: m[1]!, qualifiedName: `file:${filePath}:${m[1]}`, filePath, kind: 'enum',
        members: new Map(), baseTypes: [], implementedInterfaces: [],
        typeParameters: [], returnType: null, parameterTypes: [],
        isExported: true, isAbstract: false, decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    return types;
  }
}
