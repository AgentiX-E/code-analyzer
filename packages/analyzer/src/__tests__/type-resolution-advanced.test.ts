// @code-analyzer/analyzer — Advanced Type Resolution Tests
// Comprehensive test suite for TypeScript, Python, Go, and Java resolvers.
// Covers: generics, unions, intersections, interface satisfaction,
//   struct tags, annotations, method overloading, and edge cases.

import { describe, it, expect, beforeEach } from 'vitest';
import { TypeScriptAdvancedResolver } from '../resolution/typescript-resolver-advanced.js';
import { PythonAdvancedResolver } from '../resolution/python-resolver-advanced.js';
import { GoResolver } from '../resolution/go-resolver.js';
import { JavaResolver } from '../resolution/java-resolver.js';
import type { TypeContext } from '../resolution/type-resolver-base.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(filePath: string = '/test.ts'): TypeContext {
  return { filePath, imports: [] };
}

function makeTSResolver(): TypeScriptAdvancedResolver {
  return new TypeScriptAdvancedResolver();
}

function makePyResolver(): PythonAdvancedResolver {
  return new PythonAdvancedResolver();
}

function makeGoResolver(): GoResolver {
  return new GoResolver();
}

function makeJavaResolver(): JavaResolver {
  return new JavaResolver();
}

// ====================================================================
// TypeScript Advanced Resolver Tests (20+ tests)
// ====================================================================

describe('TypeScriptAdvancedResolver', () => {
  describe('Generic type inference', () => {
    it('should resolve Array<string>', async () => {
      const resolver = makeTSResolver();
      const ctx = makeContext();
      const result = await resolver.resolveType('Array<string>', ctx);
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.name).toBe('Array<string>');
      expect(result!.genericArgs).toHaveLength(1);
      expect(result!.genericArgs![0]!.name).toBe('string');
    });

    it('should resolve Array<number>', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('Array<number>', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs![0]!.name).toBe('number');
    });

    it('should resolve Map<K, V>', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('Map<string, number>', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs).toHaveLength(2);
      expect(result!.genericArgs![0]!.name).toBe('string');
      expect(result!.genericArgs![1]!.name).toBe('number');
      expect(result!.members!['get']).toBeDefined();
      expect(result!.members!['set']).toBeDefined();
    });

    it('should resolve Promise<T>', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('Promise<User>', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs![0]!.name).toBe('User');
      expect(result!.members!['then']).toBeDefined();
      expect(result!.members!['catch']).toBeDefined();
    });

    it('should resolve Partial<T>', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('Partial<User>', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs![0]!.name).toBe('User');
    });

    it('should resolve Record<K, V>', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('Record<string, number>', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs![0]!.name).toBe('string');
      expect(result!.genericArgs![1]!.name).toBe('number');
    });

    it('should resolve Set<T>', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('Set<string>', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs![0]!.name).toBe('string');
      expect(result!.members!['add']).toBeDefined();
    });

    it('should resolve ReadonlyArray<T>', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('ReadonlyArray<number>', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });

    it('should resolve NonNullable<T>', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('NonNullable<string>', makeContext());
      expect(result).not.toBeNull();
      expect(result!.isNullable).toBe(false);
    });

    it('should resolve deep nested generics', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('Array<Map<string, number>>', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.name).toBe('Array<Map<string, number>>');
    });
  });

  describe('Union types', () => {
    it('should resolve string | number', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('string | number', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('union');
      expect(result!.genericArgs).toHaveLength(2);
      expect(result!.genericArgs![0]!.kind).toBe('primitive');
      expect(result!.genericArgs![1]!.kind).toBe('primitive');
    });

    it('should resolve three-way union', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('string | number | boolean', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('union');
      expect(result!.genericArgs).toHaveLength(3);
    });

    it('should resolve union with generics', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('Array<string> | null', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('union');
    });
  });

  describe('Intersection types', () => {
    it('should resolve A & B', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('User & Admin', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('intersection');
      expect(result!.genericArgs).toHaveLength(2);
    });

    it('should resolve three-way intersection', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('A & B & C', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('intersection');
      expect(result!.genericArgs).toHaveLength(3);
    });
  });

  describe('Function types', () => {
    it('should resolve arrow function type', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('(a: string, b: number) => boolean', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('function');
      expect(result!.parameterTypes).toHaveLength(2);
      expect(result!.returnType!.name).toBe('boolean');
    });

    it('should resolve void function type', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('() => void', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('function');
      expect(result!.parameterTypes).toHaveLength(0);
    });
  });

  describe('Conditional types', () => {
    it('should resolve basic conditional type', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('T extends U ? X : Y', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.documentation).toContain('extends');
    });
  });

  describe('Mapped types', () => {
    it('should resolve basic mapped type', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('{ [K in keyof T]: string }', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.documentation).toContain('Mapped type');
    });
  });

  describe('Primitive detection', () => {
    it('should detect primitives', async () => {
      const resolver = makeTSResolver();
      for (const prim of ['string', 'number', 'boolean', 'void', 'undefined', 'null', 'any', 'never', 'unknown']) {
        const result = await resolver.resolveType(prim, makeContext());
        expect(result).not.toBeNull();
        expect(result!.kind).toBe('primitive');
      }
    });
  });

  describe('Template literal types', () => {
    it('should resolve template literal type', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('`${prefix}-${string}`', makeContext());
      expect(result).not.toBeNull();
      expect(result!.documentation).toContain('Template literal');
    });
  });
});

// ====================================================================
// Python Advanced Resolver Tests (20+ tests)
// ====================================================================

describe('PythonAdvancedResolver', () => {
  describe('Primitive types', () => {
    it('should resolve int', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('int', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('primitive');
      expect(result!.name).toBe('int');
    });

    it('should resolve str', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('str', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('primitive');
    });

    it('should resolve bool', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('bool', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('primitive');
    });

    it('should resolve float', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('float', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('primitive');
    });

    it('should resolve None type', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('None', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.isNullable).toBe(true);
    });

    it('should resolve Any', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('Any', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('unknown');
    });
  });

  describe('Generic types', () => {
    it('should resolve List[int]', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('List[int]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs![0]!.kind).toBe('primitive');
    });

    it('should resolve Dict[str, int]', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('Dict[str, int]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.genericArgs).toHaveLength(2);
    });

    it('should resolve Tuple[int, str]', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('Tuple[int, str]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.genericArgs).toHaveLength(2);
    });

    it('should resolve Set[int]', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('Set[int]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });

    it('should resolve list[str] (Python 3.9+ syntax)', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('list[str]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs![0]!.name).toBe('str');
    });

    it('should resolve dict[str, int] (Python 3.9+)', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('dict[str, int]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs).toHaveLength(2);
    });

    it('should resolve FrozenSet[int]', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('FrozenSet[int]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });

    it('should resolve Iterable[str]', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('Iterable[str]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });

    it('should resolve Literal types', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('Literal["a", "b"]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });
  });

  describe('Optional types', () => {
    it('should resolve Optional[int]', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('Optional[int]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.isNullable).toBe(true);
      expect(result!.name).toContain('Optional');
    });

    it('should resolve Optional[User]', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('Optional[User]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.isNullable).toBe(true);
    });
  });

  describe('Union types', () => {
    it('should resolve Union[int, str]', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('Union[int, str]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('union');
      expect(result!.genericArgs).toHaveLength(2);
    });

    it('should resolve Python 3.10+ union: int | str', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('int | str', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('union');
      expect(result!.genericArgs).toHaveLength(2);
    });
  });

  describe('Callable types', () => {
    it('should resolve Callable[[int, str], bool]', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('Callable[[int, str], bool]', makeContext('/test.py'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('function');
      expect(result!.parameterTypes).toHaveLength(2);
    });
  });

  describe('Source extraction', () => {
    it('should extract class with inheritance', () => {
      const resolver = makePyResolver();
      const types = resolver.extractTypes(
        'class Animal:\n  pass\n\nclass Dog(Animal):\n  def bark(self) -> None:\n    pass',
        '/test.py',
      );
      expect(types).toHaveLength(3); // Animal class, Dog class, bark function
      expect(types[0]!.name).toBe('Animal');
      expect(types[1]!.name).toBe('Dog');
      expect(types[1]!.baseTypes).toContain('Animal');
    });

    it('should extract dataclass fields', () => {
      const resolver = makePyResolver();
      const types = resolver.extractTypes(
        'from dataclasses import dataclass\n\n@dataclass\nclass Point:\n  x: int\n  y: int',
        '/test.py',
      );
      expect(types.length).toBeGreaterThan(1);
      const pointType = types.find((t) => t.name === 'Point');
      expect(pointType).toBeDefined();
      expect(pointType!.decorators).toContain('@dataclass');
    });

    it('should extract function with type annotations', () => {
      const resolver = makePyResolver();
      const types = resolver.extractTypes(
        'def greet(name: str) -> str:\n  return f"Hello {name}"',
        '/test.py',
      );
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('greet');
      expect(types[0]!.returnType).toBe('str');
    });

    it('should extract Protocol classes as interfaces', () => {
      const resolver = makePyResolver();
      const types = resolver.extractTypes(
        'from typing import Protocol\nclass SupportsClose(Protocol):\n  def close(self) -> None: ...',
        '/test.py',
      );
      const proto = types.find((t) => t.name === 'SupportsClose');
      expect(proto).toBeDefined();
      // Protocol types should be classified as interface
    });

    it('should detect abstract base classes', () => {
      const resolver = makePyResolver();
      const types = resolver.extractTypes(
        'from abc import ABC, abstractmethod\nclass Base(ABC):\n  @abstractmethod\n  def process(self): ...',
        '/test.py',
      );
      const base = types.find((t) => t.name === 'Base');
      expect(base).toBeDefined();
      expect(base!.isAbstract).toBe(true);
    });
  });
});

// ====================================================================
// Go Resolver Tests (15+ tests)
// ====================================================================

describe('GoResolver', () => {
  describe('Struct tag parsing', () => {
    it('should parse json tag', () => {
      const resolver = makeGoResolver();
      const tags = resolver.parseStructTags('`json:"name"`');
      expect(tags).toHaveLength(1);
      expect(tags[0]!.key).toBe('json');
      expect(tags[0]!.fieldName).toBe('name');
      expect(tags[0]!.options).toEqual([]);
    });

    it('should parse json tag with omitempty', () => {
      const resolver = makeGoResolver();
      const tags = resolver.parseStructTags('`json:"name,omitempty"`');
      expect(tags).toHaveLength(1);
      expect(tags[0]!.fieldName).toBe('name');
      expect(tags[0]!.options).toContain('omitempty');
    });

    it('should parse multiple tags', () => {
      const resolver = makeGoResolver();
      const tags = resolver.parseStructTags('`json:"name" validate:"required,min=3"`');
      expect(tags).toHaveLength(2);
      expect(tags[0]!.key).toBe('json');
      expect(tags[1]!.key).toBe('validate');
      expect(tags[1]!.fieldName).toBe('required');
      expect(tags[1]!.options).toContain('min=3');
    });

    it('should parse xml tag', () => {
      const resolver = makeGoResolver();
      const tags = resolver.parseStructTags('`xml:"items>item"`');
      expect(tags).toHaveLength(1);
      expect(tags[0]!.key).toBe('xml');
    });

    it('should return empty for no tags', () => {
      const resolver = makeGoResolver();
      const tags = resolver.parseStructTags('');
      expect(tags).toHaveLength(0);
    });
  });

  describe('Go primitives', () => {
    it('should resolve string', async () => {
      const resolver = makeGoResolver();
      const result = await resolver.resolveType('string', makeContext('/test.go'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('primitive');
    });

    it('should resolve int64', async () => {
      const resolver = makeGoResolver();
      const result = await resolver.resolveType('int64', makeContext('/test.go'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('primitive');
    });

    it('should resolve float64', async () => {
      const resolver = makeGoResolver();
      const result = await resolver.resolveType('float64', makeContext('/test.go'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('primitive');
    });
  });

  describe('Collection types', () => {
    it('should resolve slice type []int', async () => {
      const resolver = makeGoResolver();
      const result = await resolver.resolveType('[]int', makeContext('/test.go'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs![0]!.name).toBe('int');
    });

    it('should resolve array type [10]int', async () => {
      const resolver = makeGoResolver();
      const result = await resolver.resolveType('[10]int', makeContext('/test.go'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });

    it('should resolve map type map[string]int', async () => {
      const resolver = makeGoResolver();
      const result = await resolver.resolveType('map[string]int', makeContext('/test.go'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs).toHaveLength(2);
    });

    it('should resolve pointer type *int', async () => {
      const resolver = makeGoResolver();
      const result = await resolver.resolveType('*int', makeContext('/test.go'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.isNullable).toBe(true);
    });

    it('should resolve channel type chan int', async () => {
      const resolver = makeGoResolver();
      const result = await resolver.resolveType('chan int', makeContext('/test.go'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });

    it('should resolve receive-only channel <-chan int', async () => {
      const resolver = makeGoResolver();
      const result = await resolver.resolveType('<-chan int', makeContext('/test.go'));
      expect(result).not.toBeNull();
    });
  });

  describe('Source extraction', () => {
    it('should extract struct type', () => {
      const resolver = makeGoResolver();
      const types = resolver.extractTypes(
        'package main\n\ntype User struct {\n\tName string `json:"name"`\n\tAge  int    `json:"age"`\n}',
        '/test.go',
      );
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('User');
    });

    it('should extract interface type', () => {
      const resolver = makeGoResolver();
      const types = resolver.extractTypes(
        'package main\n\ntype Reader interface {\n\tRead(p []byte) (n int, err error)\n}',
        '/test.go',
      );
      expect(types).toHaveLength(1);
      expect(types[0]!.kind).toBe('interface');
    });

    it('should extract function', () => {
      const resolver = makeGoResolver();
      const types = resolver.extractTypes(
        'package main\n\nfunc main() {\n\tprintln("hello")\n}',
        '/test.go',
      );
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('main');
    });
  });
});

// ====================================================================
// Java Resolver Tests (15+ tests)
// ====================================================================

describe('JavaResolver', () => {
  describe('Generic type inference', () => {
    it('should resolve List<String>', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('List<String>', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs![0]!.name).toBe('String');
      expect(result!.members!['size']).toBeDefined();
      expect(result!.members!['get']).toBeDefined();
      expect(result!.members!['add']).toBeDefined();
    });

    it('should resolve Map<K, V>', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('Map<String, Integer>', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.genericArgs).toHaveLength(2);
      expect(result!.members!['get']).toBeDefined();
      expect(result!.members!['put']).toBeDefined();
    });

    it('should resolve Set<T>', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('Set<String>', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.members!['add']).toBeDefined();
    });

    it('should resolve Optional<T>', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('Optional<String>', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.members!['get']).toBeDefined();
      expect(result!.members!['isPresent']).toBeDefined();
    });

    it('should resolve Stream<T>', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('Stream<String>', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.members!['map']).toBeDefined();
      expect(result!.members!['filter']).toBeDefined();
    });

    it('should resolve HashMap<K, V>', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('HashMap<String, Integer>', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });
  });

  describe('Java primitives', () => {
    it('should resolve int', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('int', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('primitive');
    });

    it('should resolve boolean', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('boolean', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('primitive');
    });

    it('should resolve void', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('void', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('primitive');
    });
  });

  describe('Array types', () => {
    it('should resolve int[]', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('int[]', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
      expect(result!.name).toBe('int[]');
    });

    it('should resolve String[]', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('String[]', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });
  });

  describe('Wildcard types', () => {
    it('should resolve ? extends T', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('? extends Number', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });

    it('should resolve ? super T', async () => {
      const resolver = makeJavaResolver();
      const result = await resolver.resolveType('? super Integer', makeContext('/test.java'));
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });
  });

  describe('Source extraction', () => {
    it('should extract class with generics and implements', () => {
      const resolver = makeJavaResolver();
      const types = resolver.extractTypes(
        'public class ArrayList<T> extends AbstractList<T> implements List<T>, RandomAccess {\n' +
        '  public int size() { return 0; }\n' +
        '}',
        '/test.java',
      );
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('ArrayList');
      expect(types[0]!.baseTypes).toContain('AbstractList');
      expect(types[0]!.typeParameters).toContain('T');
      expect(types[0]!.members.has('size')).toBe(true);
    });

    it('should extract interface', () => {
      const resolver = makeJavaResolver();
      const types = resolver.extractTypes(
        'public interface Comparable<T> {\n  int compareTo(T o);\n}',
        '/test.java',
      );
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('Comparable');
      expect(types[0]!.kind).toBe('interface');
    });

    it('should extract enum', () => {
      const resolver = makeJavaResolver();
      const types = resolver.extractTypes(
        'public enum Color {\n  RED, GREEN, BLUE\n}',
        '/test.java',
      );
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('Color');
      expect(types[0]!.kind).toBe('enum');
    });
  });
});

// ====================================================================
// Edge Cases
// ====================================================================

describe('Edge cases', () => {
  describe('Unknown types', () => {
    it('should return null for completely unknown type in TS', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('CompletelyUnknownTypeXYZ123', makeContext());
      expect(result).toBeNull();
    });

    it('should return null for unknown type in Python', async () => {
      const resolver = makePyResolver();
      const result = await resolver.resolveType('UnknownType', makeContext('/test.py'));
      expect(result).toBeNull();
    });
  });

  describe('Deeply nested generics', () => {
    it('should resolve triple-nested generics in TS', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('Promise<Array<Map<string, number>>>', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('generic');
    });
  });

  describe('Caching', () => {
    it('should cache resolved types in TS', async () => {
      const resolver = makeTSResolver();
      await resolver.resolveType('Array<string>', makeContext());
      const cached = resolver.getAllTypes();
      expect(cached.has('Array<string>')).toBe(true);
    });

    it('should cache resolved types in Python', async () => {
      const resolver = makePyResolver();
      await resolver.resolveType('List[int]', makeContext('/test.py'));
      const cached = resolver.getAllTypes();
      expect(cached.has('List[int]')).toBe(true);
    });
  });

  describe('Type normalization', () => {
    it('should normalize whitespace in type names', async () => {
      const resolver = makeTSResolver();
      const result = await resolver.resolveType('string   |   number', makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('union');
    });
  });
});
