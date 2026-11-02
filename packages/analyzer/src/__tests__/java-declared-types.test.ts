// The types a Java file declares, and what the resolver does with them.
//
// **Half of a Java call is a receiver, and a receiver's type is what decides where the call goes.** `set.contains(c)`
// in `CharSetUtils` reaches `CharSet.contains` only if somebody wrote down that `set` is a `CharSet`. The Python
// provider learned to emit these facts in iteration 46 and the TypeScript one in 45, and **Java emitted none of them**
// - so `receiverType` was not an arm that scored badly on Java, it was an arm that could not fire. Measured on
// `apache/commons-lang@3.14.0` against the javac oracle: **400 of 2 302 expected pairs unanswered**, and the samples
// are all of one shape - a call written on a field, a parameter or a local whose type the source states in full.
//
// The facts are the ones Java writes and nothing else:
//
//   `private final String name;`      a field's declared type, filed on the class
//   `void run(Widget w)`              a parameter's declared type, filed on the method
//   `Foo f = new Foo();`              a local's declared type
//   `var g = new Bar();`              a local's type, which is the type of what it is built from
//   `class A extends B implements C`  the two clauses that make a member belong to a class it does not declare
//
// **Nothing is inferred from a call site.** A local assigned from a method's return value has no type here, which is
// the discipline the resolver applies everywhere: a missing edge is recoverable, a wrong one is inherited by
// everything downstream.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { JavaProvider } from '../languages/java.js';
import { buildFileTypes } from '../resolution/receiver-types.js';

const HOLDER = `package demo;

class Holder extends Base implements Contract {
    private final CharSet characterSet = new CharSet();
    private static int counter, other;

    void run(Widget widget, String... parts) {
        Foo built = new Foo();
        var inferred = new Bar();
        int one, two;
        characterSet.contains('x');
    }
}
`;

/** The captures one Java source produces. */
function capturesOf(source = HOLDER): ReturnType<JavaProvider['parse']> {
  return new JavaProvider().parse(source, 'Holder.java');
}

/** The one definition capture with this name and tag. */
function definitionOf(
  name: string,
  tag: string,
  source = HOLDER,
): ReturnType<JavaProvider['parse']>[number] | undefined {
  return capturesOf(source).find((capture) => capture.name === name && capture.tag === tag);
}

/** The `name → type` blob a capture carries, parsed. */
function blobOf(
  capture: { properties?: Record<string, unknown> } | undefined,
): Record<string, string> {
  // **`typeof` narrowing rather than a stringification**: a property that is not the JSON this provider wrote is a
  // property this test does not read, and `String(undefined)` would answer `"undefined"` and throw from `JSON.parse`.
  const written = capture?.properties?.['fieldTypes'] ?? capture?.properties?.['localTypes'];
  return typeof written === 'string' ? (JSON.parse(written) as Record<string, string>) : {};
}

describe('a Java class declares the type of each of its fields', () => {
  it('files every declarator of a field declaration, including the second one', () => {
    const declared = definitionOf('Holder', CAPTURE_TAGS.CLASS_DEF);
    // `private static int counter, other;` is one declaration and two fields, and a reader that took the first
    // declarator would file `counter` and silently lose `other`.
    expect(blobOf(declared)).toEqual({ characterSet: 'CharSet', counter: 'int', other: 'int' });
  });

  it('carries both clauses that make a member belong to a class it does not declare', () => {
    const declared = definitionOf('Holder', CAPTURE_TAGS.CLASS_DEF);
    expect(declared?.properties?.['baseClasses']).toBe('Base');
    expect(declared?.properties?.['interfaces']).toBe('Contract');
  });
});

describe('a Java method declares the type of each of its parameters', () => {
  it('files a parameter under the class and the method that declare it', () => {
    const parameter = definitionOf('widget', CAPTURE_TAGS.VARIABLE_DEF);
    expect(parameter?.properties?.['parameterType']).toBe('Widget');
    // **The key is `Class.method`, because a call site knows the class and not the file** - the same key the class
    // index uses, so one lookup answers both halves of the question.
    expect(parameter?.properties?.['parameterOwner']).toBe('Holder.run');
  });

  it('reads the type of a spread parameter, whose name lives in a declarator', () => {
    const parameter = definitionOf('parts', CAPTURE_TAGS.VARIABLE_DEF);
    expect(parameter?.properties?.['parameterType']).toBe('String');
    expect(parameter?.properties?.['parameterIndex']).toBe('1');
  });
});

describe('a Java method declares the type of each of its locals', () => {
  it('files a declared local and an inferred one under the method that declares it', () => {
    const method = definitionOf('run', CAPTURE_TAGS.METHOD_DEF);
    const locals = blobOf(method);
    expect(locals['built']).toBe('Foo');
    // `var g = new Bar()` names no type at all; what it *is*, is what it was built from.
    expect(locals['inferred']).toBe('Bar');
    // `int one, two;` is two bindings, and a primitive is recorded as the source wrote it - refusing it is the
    // resolver's job, because "a primitive has no member to find" is a fact about types and not about syntax.
    expect(locals['one']).toBe('int');
    expect(locals['two']).toBe('int');
  });
});

describe('a declaration the language forbids from having a key gets none', () => {
  it('files no local from an initializer block, which belongs to no method', () => {
    // **`static { int y = 2; }` declares a binding no call can name.** It is inside a class and inside no method, so
    // the key a call site builds - `Class.method` - has no second half to build, and inventing one would file `y`
    // where a lookup for some method's local would find it.
    const initializer = `package demo;\nclass Blk { { int a = 1; } static { Foo b = new Foo(); } }\n`;
    const block = definitionOf('Blk', CAPTURE_TAGS.CLASS_DEF, initializer);
    // The class still carries its fields' types and none of the block's locals, because a class has no local section.
    expect(block?.properties?.['fieldTypes']).toBeUndefined();
  });

  it('files a member of an anonymous body under the type that owns the body', () => {
    // **A body nobody named cannot be asked for, so the climb answers the nearest type that has a name** - and for
    // `new Object() { int inner = 1; }` inside `Outer` that is `Outer`. The fact is a name no call site can write:
    // `Outer.inner` does not exist, so no compilable source reaches this entry and the resolver never reads it. It is
    // recorded here as the limitation it is, with the alternative that was refused: a second climb to the nearest body
    // would cost a branch no Java source can reach, to buy a name nothing can spell.
    const anonymous = `package demo;\nclass Outer { Object o = new Object() { int inner = 1; }; }\n`;
    const outer = definitionOf('Outer', CAPTURE_TAGS.CLASS_DEF, anonymous);
    expect(blobOf(outer)).toEqual({ o: 'Object', inner: 'int' });
  });
});

describe('two declarations of one name, and the type they disagree about', () => {
  it('drops a field two declarations give different types', () => {
    // **A name with two answers has none.** `int x; String x;` does not compile, and the file being edited is exactly
    // when a reader meets it - so the provider keeps the first declaration and drops the name rather than letting the
    // order of the walk decide what `x` is.
    const disagreeing = `package demo;\nclass Two { int x; String x; }\n`;
    expect(blobOf(definitionOf('Two', CAPTURE_TAGS.CLASS_DEF, disagreeing))).toEqual({});
  });

  it('keeps a field two declarations agree about', () => {
    // The other half of the same rule, and the half that must not be lost with it: a redeclaration that says the
    // same thing is the same fact written twice.
    const agreeing = `package demo;\nclass Twice { int x; int x; }\n`;
    expect(blobOf(definitionOf('Twice', CAPTURE_TAGS.CLASS_DEF, agreeing))).toEqual({ x: 'int' });
  });

  it('drops a local two declarations in one method give different types', () => {
    const disagreeing = `package demo;\nclass Loc { void run() { int a = 1; String a = "s"; } }\n`;
    expect(blobOf(definitionOf('run', CAPTURE_TAGS.METHOD_DEF, disagreeing))).toEqual({});
  });

  it('keeps a local two declarations in one method agree about', () => {
    const agreeing = `package demo;\nclass Loc2 { void run() { int a = 1; int a = 2; } }\n`;
    expect(blobOf(definitionOf('run', CAPTURE_TAGS.METHOD_DEF, agreeing))).toEqual({ a: 'int' });
  });
});

describe('a local is found from wherever it is written', () => {
  it('climbs from a nested block to the method that owns it', () => {
    // **A local is not always a child of the method body**: `if (x) { Foo f = new Foo(); }` puts a block between the
    // declaration and the method, and a resolver that read the parent once would file `f` under no method at all.
    const nested = `package demo;\nclass Nest { void run() { if (true) { for (int i = 0; i < 2; i++) { Foo f = new Foo(); } } } }\n`;
    expect(blobOf(definitionOf('run', CAPTURE_TAGS.METHOD_DEF, nested))).toEqual({
      f: 'Foo',
      i: 'int',
    });
  });

  it("files a constructor's parameters and locals under the constructor", () => {
    // A constructor is a method with a key and no return type, and the key is `Class.Class` - the same shape a
    // `this(…)` chain would ask for.
    const constructor = `package demo;\nclass Ctor { Ctor(Widget w) { Foo f = new Foo(); } }\n`;
    expect(
      definitionOf('w', CAPTURE_TAGS.VARIABLE_DEF, constructor)?.properties?.['parameterOwner'],
    ).toBe('Ctor.Ctor');
    expect(blobOf(definitionOf('Ctor', CAPTURE_TAGS.CONSTRUCTOR_DEF, constructor))).toEqual({
      f: 'Foo',
    });
  });
});

describe('the facts reach the resolver in the coordinates it reads', () => {
  it('builds a file whose classes, fields, parameters and locals are all typed', () => {
    const types = buildFileTypes(
      capturesOf().map((capture) => ({
        name: String(capture.name ?? ''),
        kind: labelOf(String(capture.tag)),
        containerName: capture.containerName,
        properties: capture.properties ?? {},
        nodeId: 1,
      })),
    );

    expect(types.fields.get('Holder.characterSet')).toBe('CharSet');
    expect(types.parameters.get('Holder.run\u0000widget')).toBe('Widget');
    expect(types.locals.get('Holder.run\u0000built')).toBe('Foo');
    // **A primitive is not a class**, and the refusal happens in the resolver rather than in the provider.
    expect(types.locals.get('Holder.run\u0000one')).toBeUndefined();
  });
});

/** The graph label a capture tag becomes, for the kinds this fixture writes. */
function labelOf(tag: string): 'Class' | 'Method' | 'Function' | 'Variable' {
  switch (tag) {
    case CAPTURE_TAGS.CLASS_DEF:
      return 'Class';
    case CAPTURE_TAGS.METHOD_DEF:
      return 'Method';
    case CAPTURE_TAGS.VARIABLE_DEF:
      return 'Variable';
    default:
      return 'Function';
  }
}
