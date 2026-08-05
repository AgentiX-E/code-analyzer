// @code-analyzer/intelligence — Type Representation
// Tagged union type system inspired by CBM's CBMType (30+ type kinds).
// Represents types found in 12+ programming languages through a unified
// TypeScript discriminated union, enabling cross-language type inference
// and import-aware cross-file type resolution.
//
// Architecture: Two-layer (CBM model)
//   Phase 1: Tree-sitter extraction → CBMImport[], CBMDefinition[]
//   Phase 2: Per-file LSP resolution → expression types, call resolution
//   Phase 3: Cross-file LSP with project-wide shared registry

// ---------------------------------------------------------------------------
// Language Enum
// ---------------------------------------------------------------------------

/** Supported languages for per-language type resolution strategies. */
export type LspLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'java'
  | 'kotlin'
  | 'csharp'
  | 'rust'
  | 'php'
  | 'ruby'
  | 'cpp'
  | 'perl';

// ---------------------------------------------------------------------------
// Type Representation — Tagged Union
// ---------------------------------------------------------------------------

/** A named type: `string`, `MyClass`, `Array<T>` */
export interface NamedType {
  readonly kind: 'named';
  readonly name: string;
  readonly isBuiltin: boolean;
}

/** A type parameter: `T`, `K`, `V` */
export interface TypeParamType {
  readonly kind: 'typeParam';
  readonly name: string;
  readonly constraint?: TypeRep;
}

/** A union type: `string | number` */
export interface UnionType {
  readonly kind: 'union';
  readonly members: readonly TypeRep[];
}

/** An intersection type: `A & B` */
export interface IntersectionType {
  readonly kind: 'intersection';
  readonly members: readonly TypeRep[];
}

/** A function type: `(a: T, b: U) => R` */
export interface FuncType {
  readonly kind: 'func';
  readonly params: readonly FuncParam[];
  readonly returnType: TypeRep;
  readonly isAsync: boolean;
  readonly typeParams: readonly string[];
}

/** A function parameter. */
export interface FuncParam {
  readonly name: string;
  readonly type: TypeRep;
  readonly isOptional: boolean;
  readonly isRest: boolean;
}

/** A generic/template type: `Array<T>`, `Map<K, V>` */
export interface TemplateType {
  readonly kind: 'template';
  readonly base: TypeRep;
  readonly typeArgs: readonly TypeRep[];
}

/** A literal type: `"hello"`, `42`, `true` */
export interface LiteralType {
  readonly kind: 'literal';
  readonly value: string | number | boolean;
  readonly literalKind: 'string' | 'number' | 'boolean';
}

/** A conditional type: `T extends U ? X : Y` */
export interface ConditionalType {
  readonly kind: 'conditional';
  readonly checkType: TypeRep;
  readonly extendsType: TypeRep;
  readonly trueType: TypeRep;
  readonly falseType: TypeRep;
  readonly inferName?: string;
}

/** An indexed access type: `T[K]`, `T['key']` */
export interface IndexedAccessType {
  readonly kind: 'indexedAccess';
  readonly objectType: TypeRep;
  readonly indexType: TypeRep;
}

/** A keyof type: `keyof T` */
export interface KeyofType {
  readonly kind: 'keyof';
  readonly objectType: TypeRep;
}

/** A mapped type: `{ [K in keyof T]: V }` */
export interface MappedType {
  readonly kind: 'mapped';
  readonly typeParam: string;
  readonly constraint: TypeRep;
  readonly valueType: TypeRep;
  readonly readonly: boolean;
  readonly optional: boolean;
}

/** An object literal type: `{ x: number; y: string }` */
export interface ObjectLiteralType {
  readonly kind: 'objectLiteral';
  readonly properties: readonly ObjectProp[];
  readonly callSignatures: readonly FuncType[];
}

/** An object property. */
export interface ObjectProp {
  readonly name: string;
  readonly type: TypeRep;
  readonly isOptional: boolean;
  readonly isReadonly: boolean;
}

/** A tuple type: `[string, number]` */
export interface TupleType {
  readonly kind: 'tuple';
  readonly elements: readonly TypeRep[];
}

/** An array type: `T[]` or `Array<T>` */
export interface ArrayType {
  readonly kind: 'array';
  readonly elementType: TypeRep;
}

/** A Promise-like type: `Promise<T>` */
export interface PromiseType {
  readonly kind: 'promise';
  readonly valueType: TypeRep;
}

/** An infer type (from conditional type `infer`): `infer R` */
export interface InferType {
  readonly kind: 'infer';
  readonly name: string;
}

/** The unknown type. */
export interface UnknownType {
  readonly kind: 'unknown';
}

/** The any type (explicit). */
export interface AnyType {
  readonly kind: 'any';
}

/** The void type. */
export interface VoidType {
  readonly kind: 'void';
}

/** The never type. */
export interface NeverType {
  readonly kind: 'never';
}

/** Unified type representation. */
export type TypeRep =
  | NamedType
  | TypeParamType
  | UnionType
  | IntersectionType
  | FuncType
  | TemplateType
  | LiteralType
  | ConditionalType
  | IndexedAccessType
  | KeyofType
  | MappedType
  | ObjectLiteralType
  | TupleType
  | ArrayType
  | PromiseType
  | InferType
  | UnknownType
  | AnyType
  | VoidType
  | NeverType;

// ---------------------------------------------------------------------------
// Built-in Types
// ---------------------------------------------------------------------------

export const BUILTINS = {
  string: { kind: 'named' as const, name: 'string', isBuiltin: true },
  number: { kind: 'named' as const, name: 'number', isBuiltin: true },
  boolean: { kind: 'named' as const, name: 'boolean', isBuiltin: true },
  symbol: { kind: 'named' as const, name: 'symbol', isBuiltin: true },
  bigint: { kind: 'named' as const, name: 'bigint', isBuiltin: true },
  undefined: { kind: 'named' as const, name: 'undefined', isBuiltin: true },
  null: { kind: 'named' as const, name: 'null', isBuiltin: true },
  void: { kind: 'void' as const },
  unknown: { kind: 'unknown' as const },
  any: { kind: 'any' as const },
  never: { kind: 'never' as const },
  object: { kind: 'named' as const, name: 'object', isBuiltin: true },
  function: { kind: 'named' as const, name: 'Function', isBuiltin: true },
  array: { kind: 'named' as const, name: 'Array', isBuiltin: true },
  promise: { kind: 'named' as const, name: 'Promise', isBuiltin: true },
  map: { kind: 'named' as const, name: 'Map', isBuiltin: true },
  set: { kind: 'named' as const, name: 'Set', isBuiltin: true },
  date: { kind: 'named' as const, name: 'Date', isBuiltin: true },
  regexp: { kind: 'named' as const, name: 'RegExp', isBuiltin: true },
  error: { kind: 'named' as const, name: 'Error', isBuiltin: true },
} as const;

// ---------------------------------------------------------------------------
// Type Builders — Convenience factories
// ---------------------------------------------------------------------------

export const t = {
  named: (name: string, isBuiltin = false): NamedType =>
    ({ kind: 'named', name, isBuiltin }),

  typeParam: (name: string, constraint?: TypeRep): TypeParamType =>
    ({ kind: 'typeParam', name, constraint }),

  union: (...members: TypeRep[]): UnionType =>
    ({ kind: 'union', members }),

  intersection: (...members: TypeRep[]): IntersectionType =>
    ({ kind: 'intersection', members }),

  func: (params: FuncParam[], returnType: TypeRep, opts?: { isAsync?: boolean; typeParams?: string[] }): FuncType =>
    ({ kind: 'func', params, returnType, isAsync: opts?.isAsync ?? false, typeParams: opts?.typeParams ?? [] }),

  template: (base: TypeRep, ...typeArgs: TypeRep[]): TemplateType =>
    ({ kind: 'template', base, typeArgs }),

  param: (name: string, type: TypeRep, opts?: { isOptional?: boolean; isRest?: boolean }): FuncParam =>
    ({ name, type, isOptional: opts?.isOptional ?? false, isRest: opts?.isRest ?? false }),

  literal: (value: string | number | boolean, literalKind?: 'string' | 'number' | 'boolean'): LiteralType => ({
    kind: 'literal',
    value,
    literalKind: literalKind ?? (typeof value as 'string' | 'number' | 'boolean'),
  }),

  array: (elementType: TypeRep): ArrayType =>
    ({ kind: 'array', elementType }),

  promise: (valueType: TypeRep): PromiseType =>
    ({ kind: 'promise', valueType }),

  tuple: (...elements: TypeRep[]): TupleType =>
    ({ kind: 'tuple', elements }),

  objectLiteral: (properties: ObjectProp[]): ObjectLiteralType =>
    ({ kind: 'objectLiteral', properties, callSignatures: [] }),

  prop: (name: string, type: TypeRep, opts?: { isOptional?: boolean; isReadonly?: boolean }): ObjectProp =>
    ({ name, type, isOptional: opts?.isOptional ?? false, isReadonly: opts?.isReadonly ?? false }),

  indexedAccess: (objectType: TypeRep, indexType: TypeRep): IndexedAccessType =>
    ({ kind: 'indexedAccess', objectType, indexType }),

  keyof: (objectType: TypeRep): KeyofType =>
    ({ kind: 'keyof', objectType }),

  mapped: (typeParam: string, constraint: TypeRep, valueType: TypeRep): MappedType =>
    ({ kind: 'mapped', typeParam, constraint, valueType, readonly: false, optional: false }),

  conditional: (checkType: TypeRep, extendsType: TypeRep, trueType: TypeRep, falseType: TypeRep): ConditionalType =>
    ({ kind: 'conditional', checkType, extendsType, trueType, falseType }),

  infer: (name: string): InferType =>
    ({ kind: 'infer', name }),
} as const;

// ---------------------------------------------------------------------------
// Type Utilities
// ---------------------------------------------------------------------------

/** Display a type as a human-readable string (for diagnostics). */
export function typeToString(type: TypeRep): string {
  switch (type.kind) {
    case 'named': return type.name;
    case 'typeParam': return type.constraint ? `${type.name} extends ${typeToString(type.constraint)}` : type.name;
    case 'union': return type.members.map(typeToString).join(' | ');
    case 'intersection': return type.members.map(typeToString).join(' & ');
    case 'func': {
      const params = type.params.map((p) => `${p.name}${p.isOptional ? '?' : ''}: ${typeToString(p.type)}`).join(', ');
      const ret = typeToString(type.returnType);
      return type.isAsync ? `(${params}) => Promise<${ret}>` : `(${params}) => ${ret}`;
    }
    case 'template': return `${typeToString(type.base)}<${type.typeArgs.map(typeToString).join(', ')}>`;
    case 'literal': return typeof type.value === 'string' ? `"${type.value}"` : String(type.value);
    case 'conditional': return `${typeToString(type.checkType)} extends ${typeToString(type.extendsType)} ? ${typeToString(type.trueType)} : ${typeToString(type.falseType)}`;
    case 'indexedAccess': return `${typeToString(type.objectType)}[${typeToString(type.indexType)}]`;
    case 'keyof': return `keyof ${typeToString(type.objectType)}`;
    case 'mapped': return `{ [${type.typeParam} in ${typeToString(type.constraint)}]: ${typeToString(type.valueType)} }`;
    case 'objectLiteral': {
      const props = type.properties.map((p) => `${p.isReadonly ? 'readonly ' : ''}${p.name}${p.isOptional ? '?' : ''}: ${typeToString(p.type)}`).join('; ');
      return `{ ${props} }`;
    }
    case 'tuple': return `[${type.elements.map(typeToString).join(', ')}]`;
    case 'array': return `Array<${typeToString(type.elementType)}>`;
    case 'promise': return `Promise<${typeToString(type.valueType)}>`;
    case 'infer': return `infer ${type.name}`;
    case 'unknown': return 'unknown';
    case 'any': return 'any';
    case 'void': return 'void';
    case 'never': return 'never';
  }
}
