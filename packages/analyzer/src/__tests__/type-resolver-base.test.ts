import { describe, it, expect } from 'vitest';
import {
  TypeResolverBase,
  type ResolvedType,
  type TypeContext,
} from '../resolution/type-resolver-base.js';

// Concrete subclass that re-exposes the protected helpers for direct testing.
class TestResolver extends TypeResolverBase {
  readonly language = 'test';

  async resolveType(_name: string, _context: TypeContext): Promise<ResolvedType | null> {
    return null;
  }

  getAllTypes(): Map<string, ResolvedType> {
    return new Map();
  }

  // --- Re-exposed helpers ---
  primitive(name: string, isNullable = false): ResolvedType {
    return super.primitive(name, isNullable);
  }
  objectType(
    name: string,
    members: Record<string, ResolvedType> = {},
    isNullable = false,
  ): ResolvedType {
    return super.objectType(name, members, isNullable);
  }
  genericType(name: string, args: ResolvedType[], isNullable = false): ResolvedType {
    return super.genericType(name, args, isNullable);
  }
  unionType(types: ResolvedType[], isNullable = false): ResolvedType {
    return super.unionType(types, isNullable);
  }
  intersectionType(types: ResolvedType[], isNullable = false): ResolvedType {
    return super.intersectionType(types, isNullable);
  }
  functionType(
    name: string,
    params: ResolvedType[],
    ret: ResolvedType,
    isNullable = false,
  ): ResolvedType {
    return super.functionType(name, params, ret, isNullable);
  }
  unknownType(name = 'unknown'): ResolvedType {
    return super.unknownType(name);
  }
  nullable(type: ResolvedType): ResolvedType {
    return super.nullable(type);
  }
  parseGenericString(typeStr: string): { base: string; args: string[] } | null {
    return super.parseGenericString(typeStr);
  }
  splitTopLevelCommas(input: string): string[] {
    return super.splitTopLevelCommas(input);
  }
  normalizeTypeName(typeName: string): string {
    return super.normalizeTypeName(typeName);
  }
  isPrimitive(typeName: string): boolean {
    return super.isPrimitive(typeName);
  }
}

const make = () => new TestResolver();

describe('TypeResolverBase — type construction helpers', () => {
  it('builds a primitive type', () => {
    expect(make().primitive('string')).toEqual({
      name: 'string',
      kind: 'primitive',
      isNullable: false,
    });
    expect(make().primitive('string', true).isNullable).toBe(true);
  });

  it('builds an object type with and without defaults', () => {
    expect(make().objectType('User')).toEqual({
      name: 'User',
      kind: 'object',
      members: {},
      isNullable: false,
    });
    const members = { id: { name: 'number', kind: 'primitive' as const } };
    expect(make().objectType('User', members, true)).toEqual({
      name: 'User',
      kind: 'object',
      members,
      isNullable: true,
    });
  });

  it('builds a generic type', () => {
    const arg = { name: 'string', kind: 'primitive' as const };
    const t = make().genericType('Array', [arg]);
    expect(t.kind).toBe('generic');
    expect(t.genericArgs).toEqual([arg]);
  });

  it('builds a union type', () => {
    const a = { name: 'string', kind: 'primitive' as const };
    const b = { name: 'number', kind: 'primitive' as const };
    const t = make().unionType([a, b]);
    expect(t.kind).toBe('union');
    expect(t.name).toBe('string | number');
    expect(t.genericArgs).toEqual([a, b]);
  });

  it('builds an intersection type', () => {
    const a = { name: 'A', kind: 'primitive' as const };
    const b = { name: 'B', kind: 'primitive' as const };
    const t = make().intersectionType([a, b], true);
    expect(t.kind).toBe('intersection');
    expect(t.name).toBe('A & B');
    expect(t.isNullable).toBe(true);
  });

  it('builds a function type', () => {
    const p = { name: 'string', kind: 'primitive' as const };
    const r = { name: 'number', kind: 'primitive' as const };
    const t = make().functionType('fn', [p], r);
    expect(t.kind).toBe('function');
    expect(t.parameterTypes).toEqual([p]);
    expect(t.returnType).toEqual(r);
  });

  it('builds an unknown type', () => {
    expect(make().unknownType()).toEqual({ name: 'unknown', kind: 'unknown' });
    expect(make().unknownType('Any').name).toBe('Any');
  });

  it('wraps a type as nullable', () => {
    const base = { name: 'string', kind: 'primitive' as const, isNullable: false };
    const t = make().nullable(base);
    expect(t.isNullable).toBe(true);
    expect(t.name).toBe('string');
  });
});

describe('TypeResolverBase — generic string parsing', () => {
  it('parses a simple generic string', () => {
    expect(make().parseGenericString('Array<string>')).toEqual({ base: 'Array', args: ['string'] });
  });

  it('returns null for a non-generic string', () => {
    expect(make().parseGenericString('string')).toBeNull();
  });

  it('returns null for empty type arguments', () => {
    expect(make().parseGenericString('Foo<>')).toBeNull();
  });

  it('parses nested generics', () => {
    expect(make().parseGenericString('Map<string, Array<number>>')).toEqual({
      base: 'Map',
      args: ['string', 'Array<number>'],
    });
  });
});

describe('TypeResolverBase — comma splitting', () => {
  it('splits top-level commas', () => {
    expect(make().splitTopLevelCommas('string, number')).toEqual(['string', 'number']);
  });

  it('respects nested angle brackets', () => {
    expect(make().splitTopLevelCommas('string, Array<number>')).toEqual([
      'string',
      'Array<number>',
    ]);
  });

  it('handles a trailing comma and empty input', () => {
    expect(make().splitTopLevelCommas('string,')).toEqual(['string']);
    expect(make().splitTopLevelCommas('')).toEqual([]);
  });
});

describe('TypeResolverBase — name normalization and primitive detection', () => {
  it('normalizes whitespace and separators', () => {
    expect(make().normalizeTypeName('  Map < string , number >  ')).toBe('Map<string , number>');
  });

  it('detects primitives case-insensitively', () => {
    expect(make().isPrimitive('string')).toBe(true);
    expect(make().isPrimitive('INT64')).toBe(true);
    expect(make().isPrimitive('MyClass')).toBe(false);
  });
});
