// @code-analyzer/analyzer — Python Advanced Resolver Tests
// Covers the remaining generic handlers, decorator transforms, AST extraction
// (methods/fields/aliases/decorators), and the regex fallback path.

import { describe, it, expect } from 'vitest';
import { PythonAdvancedResolver } from '../resolution/python-resolver-advanced.js';
import type { TypeContext, ResolvedType } from '../resolution/type-resolver-base.js';

function makeResolver(): PythonAdvancedResolver {
  return new PythonAdvancedResolver();
}

function makeContext(filePath = '/test.py'): TypeContext {
  return { filePath, imports: [] };
}

// ====================================================================
// Generic handlers
// ====================================================================

describe('PythonAdvancedResolver — generic handlers', () => {
  it.each([
    ['List', 'List[int]'],
    ['list', 'list[int]'],
    ['Dict', 'Dict[str, int]'],
    ['dict', 'dict[str, int]'],
    ['Tuple', 'Tuple[int, str]'],
    ['tuple', 'tuple[int, str]'],
    ['Set', 'Set[int]'],
    ['set', 'set[int]'],
    ['FrozenSet', 'FrozenSet[int]'],
    ['frozenset', 'frozenset[int]'],
    ['Iterable', 'Iterable[str]'],
    ['Iterator', 'Iterator[str]'],
    ['Sequence', 'Sequence[str]'],
    ['Mapping', 'Mapping[str, int]'],
    ['MutableMapping', 'MutableMapping[str, int]'],
    ['Type', 'Type[str]'],
    ['Final', 'Final[int]'],
    ['ClassVar', 'ClassVar[int]'],
    ['Deque', 'Deque[int]'],
    ['Literal', 'Literal["a", "b"]'],
  ])('resolves %s[...] as a generic type', async (base, typeName) => {
    const result = await makeResolver().resolveType(typeName, makeContext());
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('generic');
    expect(result!.name).toContain(base);
  });

  it('falls through to a generic type on arity mismatch', async () => {
    const result = await makeResolver().resolveType('List[int, str]', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('List[int, str]');
  });

  it.each([
    ['list', 'list[int, str]'],
    ['Dict', 'Dict[str]'],
    ['dict', 'dict[str]'],
    ['Set', 'Set[int, str]'],
    ['set', 'set[int, str]'],
    ['FrozenSet', 'FrozenSet[int, str]'],
    ['frozenset', 'frozenset[int, str]'],
    ['Iterable', 'Iterable[int, str]'],
    ['Iterator', 'Iterator[int, str]'],
    ['Sequence', 'Sequence[int, str]'],
    ['Mapping', 'Mapping[str]'],
    ['MutableMapping', 'MutableMapping[str]'],
    ['Type', 'Type[int, str]'],
    ['Final', 'Final[int, str]'],
    ['ClassVar', 'ClassVar[int, str]'],
    ['Deque', 'Deque[int, str]'],
  ])('falls through to generic on %s arity mismatch', async (base, typeName) => {
    const result = await makeResolver().resolveType(typeName, makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toContain(base);
  });

  it('resolves a non-handler generic (Foo[Bar])', async () => {
    const result = await makeResolver().resolveType('Foo[Bar]', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('Foo[Bar]');
  });

  it('resolves Callable[[], bool] with empty arg list', async () => {
    const result = await makeResolver().resolveType('Callable[[], bool]', makeContext());
    expect(result!.kind).toBe('function');
    expect(result!.parameterTypes).toEqual([]);
  });

  it('returns the cached instance on a second resolve', async () => {
    const resolver = makeResolver();
    const a = await resolver.resolveType('List[int]', makeContext());
    const b = await resolver.resolveType('List[int]', makeContext());
    expect(a).toBe(b);
  });

  it('delegates to the external resolver when a match is found', async () => {
    const result = await makeResolver().resolveType('ExternalThing', {
      filePath: '/test.py',
      imports: [],
      resolveExternal: () => ({ name: 'External', kind: 'object' }),
    });
    expect(result!.name).toBe('External');
  });

  it('returns null when the external resolver has no match', async () => {
    const result = await makeResolver().resolveType('ExternalThing', {
      filePath: '/test.py',
      imports: [],
      resolveExternal: () => null,
    });
    expect(result).toBeNull();
  });
});

// ====================================================================
// Decorator transforms
// ====================================================================

describe('PythonAdvancedResolver — decorator transforms', () => {
  const baseType = (): ResolvedType => ({ name: 'X', kind: 'class' });

  it('adds __init__ for @dataclass', () => {
    const result = makeResolver().resolveDecoratorTransform(['@dataclass'], baseType());
    expect(result.members!['__init__']).toBeDefined();
  });

  it('adds __init__ for @dataclasses.dataclass', () => {
    const result = makeResolver().resolveDecoratorTransform(['@dataclasses.dataclass'], baseType());
    expect(result.members!['__init__']).toBeDefined();
  });

  it('appends overload documentation for @overload', () => {
    const result = makeResolver().resolveDecoratorTransform(['@overload'], baseType());
    expect(result.documentation).toContain('@overload');
  });

  it('marks @property as an object type', () => {
    const result = makeResolver().resolveDecoratorTransform(['@property'], baseType());
    expect(result.kind).toBe('object');
  });

  it('leaves @abstractmethod and @final unchanged', () => {
    const result = makeResolver().resolveDecoratorTransform(
      ['@abstractmethod', '@final'],
      baseType(),
    );
    expect(result.kind).toBe('class');
    expect(result.members).toEqual({});
  });
});

// ====================================================================
// AST extraction
// ====================================================================

describe('PythonAdvancedResolver.extractTypes', () => {
  it('extracts a class method with its return type annotation', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      ['class Calc:', '    def add(self, a: int) -> int:', '        return a'].join('\n'),
      '/test.py',
    );
    const cls = types.find((t) => t.name === 'Calc')!;
    const method = cls.members.get('add')!;
    expect(method.returnType).toBe('int');
    expect(method.parameterTypes).toEqual(['int']);
    expect(method.visibility).toBe('public');
  });

  it('extracts a method with no return annotation as None', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      ['class C:', '    def work(self):', '        pass'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.get('work')!.returnType).toBe('None');
  });

  it('extracts a decorated function with its decorator', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      ['@staticmethod', 'def helper():', '    pass'].join('\n'),
      '/test.py',
    );
    const fn = types.find((t) => t.name === 'helper')!;
    expect(fn.decorators).toContain('@staticmethod');
  });

  it('extracts a class with dataclass fields', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      ['@dataclass', 'class Point:', '    x: int', '    y: int = 5'].join('\n'),
      '/test.py',
    );
    const cls = types.find((t) => t.name === 'Point')!;
    expect(cls.decorators).toContain('@dataclass');
    expect(cls.members.get('x')!.type).toBe('int');
    expect(cls.members.get('y')!.type).toBe('int');
  });

  it('extracts a class attribute with a type annotation', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      ['class Config:', '    count: int = 0'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.get('count')!.type).toBe('int');
  });

  it('extracts a type alias (Name = Type)', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('Name = str', '/test.py');
    const alias = types.find((t) => t.name === 'Name')!;
    expect(alias.kind).toBe('type');
    expect(alias.returnType).toBe('str');
  });

  it('extracts a type-annotated variable (x: int)', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('count: int', '/test.py');
    const v = types.find((t) => t.name === 'count')!;
    expect(v.kind).toBe('variable');
    expect(v.returnType).toBe('int');
  });

  it('extracts a class with generic base and Protocol detection', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      ['from typing import Generic, Protocol', 'class Repo(Protocol):', '    pass'].join('\n'),
      '/test.py',
    );
    const repo = types.find((t) => t.name === 'Repo')!;
    expect(repo.kind).toBe('interface');
  });

  it('skips dunder methods like __init__', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      ['class C:', '    def __init__(self):', '        pass'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.has('__init__')).toBe(false);
  });

  it('extracts a class value-assignment attribute', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(['class C:', '    count = 5'].join('\n'), '/test.py');
    expect(types[0]!.members.get('count')!.type).toBe('5');
  });

  it('extracts a generic base from class Foo(Generic[T])', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      ['from typing import Generic', 'class Box(Generic[T]):', '    pass'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.baseTypes).toEqual(['Generic']);
  });

  it('does not extract a plain value assignment as a type alias', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('x = 5', '/test.py');
    expect(types.find((t) => t.name === 'x')).toBeUndefined();
  });

  it('resolves Optional[None] as nullable', async () => {
    const result = await makeResolver().resolveType('Optional[None]', makeContext());
    expect(result!.isNullable).toBe(true);
    expect(result!.name).toBe('Optional[None]');
  });

  it('returns null for resolveProtocolType (handled by class extraction)', () => {
    expect(makeResolver().resolveProtocolType('Foo', makeContext())).toBeNull();
  });

  it('extracts private/protected methods by name-mangling convention', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      [
        'class C:',
        '    def __secret(self):',
        '        pass',
        '    def _hidden(self):',
        '        pass',
      ].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.get('__secret')!.visibility).toBe('private');
    expect(types[0]!.members.get('_hidden')!.visibility).toBe('protected');
  });

  it('extracts private/protected class attributes', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      ['class C:', '    __secret = 5', '    _hidden: int = 0'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.get('__secret')!.visibility).toBe('private');
    expect(types[0]!.members.get('_hidden')!.visibility).toBe('protected');
  });

  it('extracts a None alias as a variable kind', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('Maybe = None', '/test.py');
    expect(types[0]!.kind).toBe('variable');
  });

  it('resolves memoryview as a primitive fallback', async () => {
    const result = await makeResolver().resolveType('memoryview', makeContext());
    expect(result!.kind).toBe('primitive');
    expect(result!.name).toBe('memoryview');
  });
});

// ====================================================================
// Fallback extraction (injected grammar loader)
// ====================================================================

describe('PythonAdvancedResolver — fallback extraction', () => {
  const makeFallback = (): PythonAdvancedResolver => new PythonAdvancedResolver(() => null);

  it('extracts classes with inheritance via regex', () => {
    const types = makeFallback().extractTypes('class Dog(Animal):\n    pass', '/test.py');
    const dog = types.find((t) => t.name === 'Dog')!;
    expect(dog.kind).toBe('class');
    expect(dog.baseTypes).toEqual(['Animal']);
  });

  it('extracts a Protocol class as an interface via regex', () => {
    const types = makeFallback().extractTypes(
      'class SupportsClose(Protocol):\n    pass',
      '/test.py',
    );
    expect(types[0]!.kind).toBe('interface');
  });

  it('extracts functions with annotations via regex', () => {
    const types = makeFallback().extractTypes(
      'def greet(name: str) -> str:\n    return name',
      '/test.py',
    );
    const fn = types.find((t) => t.name === 'greet')!;
    expect(fn.parameterTypes).toEqual(['str']);
    expect(fn.returnType).toBe('str');
  });

  it('extracts a function without annotations via regex', () => {
    const types = makeFallback().extractTypes('def noop(x):\n    return x', '/test.py');
    expect(types[0]!.parameterTypes).toEqual(['Any']);
    expect(types[0]!.returnType).toBeNull();
  });

  it('extracts a class without bases and a no-arg function via regex', () => {
    const types = makeFallback().extractTypes(
      'class Simple:\n    pass\n\ndef noop():\n    pass',
      '/test.py',
    );
    const cls = types.find((t) => t.name === 'Simple')!;
    expect(cls.baseTypes).toEqual([]);
    const fn = types.find((t) => t.name === 'noop')!;
    expect(fn.parameterTypes).toEqual([]);
  });
});
