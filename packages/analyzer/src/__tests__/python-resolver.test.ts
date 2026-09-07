import { describe, it, expect } from 'vitest';
import { PythonTypeResolver } from '../resolution/python-resolver.js';

const makeResolver = () => new PythonTypeResolver();
// Inject a loader that returns null to force the regex fallback path.
const makeFallbackResolver = () => new PythonTypeResolver(() => null);

describe('PythonTypeResolver — extraction (tree-sitter)', () => {
  it('extracts a function return type annotation', () => {
    const types = makeResolver().extractTypes('def f() -> int:\n    return 1\n', '/test.py');
    expect(types[0]!.returnType).toBe('int');
  });

  it('extracts a function without a return annotation as null', () => {
    const types = makeResolver().extractTypes('def f():\n    pass\n', '/test.py');
    expect(types[0]!.returnType).toBeNull();
  });

  it('detects an async function via the async token', () => {
    const types = makeResolver().extractTypes('async def f():\n    pass\n', '/test.py');
    expect(types[0]!.isAsync).toBe(true);
  });

  it('extracts decorators from a decorated top-level function', () => {
    const types = makeResolver().extractTypes(
      '@staticmethod\ndef helper():\n    pass\n',
      '/test.py',
    );
    expect(types[0]!.decorators).toContain('@staticmethod');
  });

  it('extracts a method return type annotation', () => {
    const types = makeResolver().extractTypes(
      ['class C:', '    def m(self) -> str:', "        return ''"].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.get('m')!.returnType).toBe('str');
  });

  it('extracts a method without a return annotation as None', () => {
    const types = makeResolver().extractTypes(
      ['class C:', '    def m(self):', '        pass'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.get('m')!.returnType).toBe('None');
  });

  it('detects a static method via the staticmethod decorator', () => {
    const types = makeResolver().extractTypes(
      ['class C:', '    @staticmethod', '    def m():', '        pass'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.get('m')!.isStatic).toBe(true);
  });

  it('detects an async method', () => {
    const types = makeResolver().extractTypes(
      ['class C:', '    async def m(self):', '        pass'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.get('m')!.isAsync).toBe(true);
  });

  it('extracts class base types', () => {
    const types = makeResolver().extractTypes('class C(Base, Mixin):\n    pass\n', '/test.py');
    expect(types[0]!.baseTypes).toEqual(['Base', 'Mixin']);
  });

  it('qualifies a nested class with its enclosing class', () => {
    const types = makeResolver().extractTypes(
      ['class A:', '    class B:', '        pass'].join('\n'),
      '/test.py',
    );
    const b = types.find((t) => t.name === 'B')!;
    expect(b.qualifiedName).toBe('A.B');
  });

  it('extracts decorators from a decorated class', () => {
    const types = makeResolver().extractTypes('@dataclass\nclass Point:\n    x: int\n', '/test.py');
    expect(types[0]!.decorators).toContain('@dataclass');
  });

  it('extracts a top-level type alias (Name = Type)', () => {
    const types = makeResolver().extractTypes('Name = str\n', '/test.py');
    const alias = types.find((t) => t.name === 'Name')!;
    expect(alias.kind).toBe('variable');
    expect(alias.returnType).toBe('str');
  });

  it('extracts a class attribute assignment', () => {
    const types = makeResolver().extractTypes(['class C:', '    x = 5'].join('\n'), '/test.py');
    expect(types[0]!.members.get('x')!.type).toBe('5');
  });

  it('marks a private class as not exported', () => {
    const types = makeResolver().extractTypes('class _Hidden:\n    pass\n', '/test.py');
    expect(types[0]!.isExported).toBe(false);
  });

  it('ignores a top-level expression statement that is not an assignment', () => {
    const types = makeResolver().extractTypes("print('hello')\n", '/test.py');
    expect(types).toEqual([]);
  });

  it('ignores a class-body expression statement that is not an assignment', () => {
    const types = makeResolver().extractTypes(
      ['class C:', "    print('x')"].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.size).toBe(0);
  });

  it('ignores a class attribute whose target is not a plain identifier', () => {
    const types = makeResolver().extractTypes(
      ['class C:', '    self.x = 5'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.size).toBe(0);
  });

  it('qualifies a triply-nested class with the full enclosing chain', () => {
    const types = makeResolver().extractTypes(
      ['class A:', '    class B:', '        class C:', '            pass'].join('\n'),
      '/test.py',
    );
    const c = types.find((t) => t.name === 'C')!;
    expect(c.qualifiedName).toBe('A.B.C');
  });

  it('extracts a subscripted type alias (Name = List[int])', () => {
    const types = makeResolver().extractTypes('Name = List[int]\n', '/test.py');
    const alias = types.find((t) => t.name === 'Name')!;
    expect(alias.kind).toBe('variable');
    expect(alias.returnType).toBe('List[int]');
  });

  it('extracts a dotted type alias (Name = a.b)', () => {
    const types = makeResolver().extractTypes('Name = a.b\n', '/test.py');
    expect(types.find((t) => t.name === 'Name')!.returnType).toBe('a.b');
  });

  it('extracts a call type alias (Name = Foo())', () => {
    const types = makeResolver().extractTypes('Name = Foo()\n', '/test.py');
    expect(types.find((t) => t.name === 'Name')!.returnType).toBe('Foo()');
  });

  it('ignores a top-level dotted assignment target', () => {
    const types = makeResolver().extractTypes('a.b = 5\n', '/test.py');
    expect(types).toEqual([]);
  });

  it('ignores a top-level assignment whose RHS is not a type', () => {
    const types = makeResolver().extractTypes('Count = 5\n', '/test.py');
    expect(types).toEqual([]);
  });

  it('extracts typed, default, and bare parameters from a function', () => {
    const types = makeResolver().extractTypes(
      "def f(a: int, b: str = 'x', c, d=5):\n    pass\n",
      '/test.py',
    );
    expect(types[0]!.parameterTypes).toEqual(['int', 'str', 'Any', 'Any']);
  });

  it('extracts a nested decorated class and skips it as a method', () => {
    const types = makeResolver().extractTypes(
      ['class Outer:', '    @dataclass', '    class Inner:', '        pass'].join('\n'),
      '/test.py',
    );
    const outer = types.find((t) => t.name === 'Outer')!;
    const inner = types.find((t) => t.name === 'Inner')!;
    expect(outer.members.size).toBe(0);
    expect(inner.qualifiedName).toBe('Outer.Inner');
  });

  it('skips dunder methods', () => {
    const types = makeResolver().extractTypes(
      ['class C:', '    def __init__(self):', '        pass'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.size).toBe(0);
  });

  it('extracts a method parameter type annotation', () => {
    const types = makeResolver().extractTypes(
      ['class C:', '    def m(self, x: int) -> str:', '        pass'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.get('m')!.parameterTypes).toEqual(['Any', 'int']);
  });

  it('marks a protected method', () => {
    const types = makeResolver().extractTypes(
      ['class C:', '    def _m(self):', '        pass'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.get('_m')!.visibility).toBe('protected');
  });

  it('marks a private method', () => {
    const types = makeResolver().extractTypes(
      ['class C:', '    def __m(self):', '        pass'].join('\n'),
      '/test.py',
    );
    expect(types[0]!.members.get('__m')!.visibility).toBe('private');
  });

  it('marks a protected class attribute', () => {
    const types = makeResolver().extractTypes(['class C:', '    _x = 5'].join('\n'), '/test.py');
    expect(types[0]!.members.get('_x')!.visibility).toBe('protected');
  });

  it('marks a private class attribute', () => {
    const types = makeResolver().extractTypes(['class C:', '    __x = 5'].join('\n'), '/test.py');
    expect(types[0]!.members.get('__x')!.visibility).toBe('private');
  });

  it('extracts sibling declarations without cross-attributing decorators', () => {
    const types = makeResolver().extractTypes(
      ['class A:', '    pass', 'class B:', '    pass'].join('\n'),
      '/test.py',
    );
    expect(types.map((t) => t.name)).toEqual(['A', 'B']);
    expect(types[1]!.decorators).toEqual([]);
  });
});

describe('PythonTypeResolver — fallback (regex)', () => {
  it('extracts a class with base types', () => {
    const types = makeFallbackResolver().extractTypes(
      'class Foo(Base, Mixin):\n    pass\n',
      '/test.py',
    );
    const foo = types.find((t) => t.name === 'Foo')!;
    expect(foo.kind).toBe('class');
    expect(foo.baseTypes).toEqual(['Base', 'Mixin']);
  });

  it('extracts a class without base types', () => {
    const types = makeFallbackResolver().extractTypes('class Plain:\n    pass\n', '/test.py');
    expect(types.find((t) => t.name === 'Plain')!.baseTypes).toEqual([]);
  });

  it('extracts a function with params and return type', () => {
    const types = makeFallbackResolver().extractTypes(
      'def foo(x, y) -> int:\n    pass\n',
      '/test.py',
    );
    const foo = types.find((t) => t.name === 'foo')!;
    expect(foo.kind).toBe('function');
    expect(foo.parameterTypes).toEqual(['x', 'y']);
    expect(foo.returnType).toBe('int');
  });

  it('extracts an async function without a return type', () => {
    const types = makeFallbackResolver().extractTypes('async def bar():\n    pass\n', '/test.py');
    const bar = types.find((t) => t.name === 'bar')!;
    expect(bar.parameterTypes).toEqual([]);
    expect(bar.returnType).toBeNull();
  });

  it('strips type annotations from fallback params', () => {
    const types = makeFallbackResolver().extractTypes(
      'def f(a: int, b: str):\n    pass\n',
      '/test.py',
    );
    expect(types.find((t) => t.name === 'f')!.parameterTypes).toEqual(['a', 'b']);
  });
});
