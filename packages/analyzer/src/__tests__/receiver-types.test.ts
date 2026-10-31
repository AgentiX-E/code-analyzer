// @code-analyzer/analyzer — the receiver's type, stated as facts rather than measured through a parser.
//
// **The module exists because a name-level rule could not tell two calls apart.** Iteration 42 measured two widened
// rules for the same-file arm and both added edges without adding a correct one; what separated `this.index.buildIndex()`
// from `request.args.get(key)` was never the receiver's spelling. These cases state what the module will and will not
// conclude, so the rule can be reviewed without a corpus and the corpus figure can be trusted when it moves.

import { describe, expect, it } from 'vitest';

import {
  buildFileTypes,
  classMemberOf,
  containerOf,
  createClassIndex,
  mergeClassIndex,
  ownerKeyOf,
  receiverTypeOf,
  simpleTypeName,
} from '../resolution/receiver-types.js';

import type { TypedDeclaration } from '../resolution/receiver-types.js';

/** A declaration with a node id, which is what makes it a member a call can point at. */
function declaration(
  kind: TypedDeclaration['kind'],
  name: string,
  containerName: string | undefined,
  properties: Record<string, unknown>,
  nodeId: number,
): TypedDeclaration {
  return { kind, name, containerName, properties, nodeId };
}

describe('a type annotation reduced to a name', () => {
  it('keeps a name and refuses everything that is not one', () => {
    expect(simpleTypeName('Index')).toBe('Index');
    expect(simpleTypeName('  Index ')).toBe('Index');
    expect(simpleTypeName('pkg.Index')).toBe('Index');
    // A protocol or module-qualified name keeps its last segment, which is the name the graph stores.
    expect(simpleTypeName('typing.Protocol')).toBe('Protocol');
  });

  it('refuses the shapes where one name would be a guess', () => {
    // A union is two answers, and picking one is the guess this module exists to avoid.
    expect(simpleTypeName('Index | null')).toBeUndefined();
    expect(simpleTypeName('Readable & Writable')).toBeUndefined();
    // A container's members are not this module's business, and its head names a builtin.
    expect(simpleTypeName('Map<string, number>')).toBeUndefined();
    // An element type wearing brackets is not the type of the receiver.
    expect(simpleTypeName('Index[]')).toBeUndefined();
    // An optional type may be absent at the call site.
    expect(simpleTypeName('Index?')).toBeUndefined();
    // A primitive has no declaration to find a member in.
    expect(simpleTypeName('string')).toBeUndefined();
    expect(simpleTypeName('number')).toBeUndefined();
    // An annotation that is not text at all is not an annotation.
    expect(simpleTypeName(undefined)).toBeUndefined();
    expect(simpleTypeName(42)).toBeUndefined();
    expect(simpleTypeName('   ')).toBeUndefined();
  });
});

describe('one file, read for the types its declarations carry', () => {
  const facts = buildFileTypes([
    declaration('Class', 'Index', undefined, {}, 1),
    declaration('Method', 'buildIndex', 'Index', {}, 2),
    declaration('Class', 'Holder', undefined, {}, 3),
    declaration('Method', 'run', 'Holder', {}, 4),
    declaration('Property', 'index', 'Holder', { fieldType: 'Index' }, 5),
    declaration('Property', 'store', 'Holder', { fieldType: 'Map<string, number>' }, 6),
    // A parameter is filed under the function that declares it, which is what `parameterOwner` records.
    declaration(
      'Variable',
      'self',
      undefined,
      { parameterOwner: 'connectHandler', parameterType: 'Holder' },
      7,
    ),
    declaration('Function', 'connectHandler', undefined, {}, 8),
  ]);

  it('reads the field types a class carries, and only when they are names', () => {
    const fromClass = buildFileTypes([
      declaration(
        'Class',
        'Holder',
        undefined,
        {
          fieldTypes: JSON.stringify({
            index: 'Index',
            store: 'Map<string, number>',
            count: 'number',
          }),
        },
        1,
      ),
      declaration('Method', 'run', 'Holder', {}, 2),
    ]);
    expect(fromClass.fields.get('Holder.index')).toBe('Index');
    // A container, and a primitive: neither is a name a member can be looked up in.
    expect(fromClass.fields.has('Holder.store')).toBe(false);
    expect(fromClass.fields.has('Holder.count')).toBe(false);
  });

  it('ignores a class property that is not the JSON it wrote', () => {
    // A property of the wrong shape is a property this module does not read, rather than a parse that throws.
    for (const blob of ['not json', '', '[]', 'null', '{"index":7}']) {
      const types = buildFileTypes([
        declaration('Class', 'Holder', undefined, { fieldTypes: blob }, 1),
      ]);
      expect(types.fields.size).toBe(0);
    }
  });

  it('files a field under its class, and only when its type is a name', () => {
    expect(facts.fields.get('Holder.index')).toBe('Index');
    // `Map<string, number>` is not a name, so the field is not a fact anybody can resolve through.
    expect(facts.fields.has('Holder.store')).toBe(false);
  });

  it('files a parameter under the function that declares it', () => {
    expect(facts.parameters.get('connectHandler\u0000self')).toBe('Holder');
  });

  it('remembers which class holds a method, so `this` can be answered', () => {
    expect(facts.classOfFunction.get('Holder.run')).toBe('Holder');
  });

  it('refuses a class that declares one name twice', () => {
    const ambiguous = buildFileTypes([
      declaration('Class', 'Holder', undefined, {}, 1),
      declaration('Method', 'run', 'Holder', {}, 2),
      declaration('Method', 'run', 'Holder', {}, 3),
    ]);
    // Two members with one name is a name this class cannot answer for, and both are dropped.
    expect(ambiguous.members.get('Holder')?.get('run')).toBeUndefined();
  });

  it('drops a member whose declaration has no node, because a call could not point at it', () => {
    const factsWithoutNode = buildFileTypes([
      declaration('Class', 'Holder', undefined, {}, 1),
      { kind: 'Method', name: 'run', containerName: 'Holder', properties: {} },
    ]);
    expect(factsWithoutNode.members.get('Holder')?.get('run')).toBeUndefined();
  });
});

describe('the type of the object a call is written on', () => {
  const facts = buildFileTypes([
    declaration('Class', 'Holder', undefined, {}, 1),
    declaration('Method', 'run', 'Holder', {}, 2),
    declaration('Property', 'index', 'Holder', { fieldType: 'Index' }, 3),
    declaration(
      'Variable',
      'self',
      undefined,
      { parameterOwner: 'connect', parameterType: 'Index' },
      4,
    ),
  ]);

  it('reads a field of the enclosing object', () => {
    expect(receiverTypeOf(facts, 'this.index', 'Holder.run')).toEqual({
      className: 'Index',
      via: 'thisField',
    });
  });

  it('reads a parameter of the calling function', () => {
    expect(receiverTypeOf(facts, 'self', 'connect')).toEqual({
      className: 'Index',
      via: 'parameter',
    });
  });

  it('declines every shape whose type nobody wrote down', () => {
    // A receiver that is not the enclosing object and not a parameter is somebody else's object.
    expect(receiverTypeOf(facts, 'request.args', 'Holder.run')).toBeUndefined();
    // A chain two deep needs the type of `args`, not of `request`.
    expect(receiverTypeOf(facts, 'this.index.store', 'Holder.run')).toBeUndefined();
    // `this.m()` is the same-file arm's case: the enclosing class is already the scope it looks in.
    expect(receiverTypeOf(facts, 'this', 'Holder.run')).toBeUndefined();
    // A receiver with no type on the field it names is not a guess this module makes.
    expect(receiverTypeOf(facts, 'this.helper', 'Holder.run')).toBeUndefined();
    // An owner nobody declared has no enclosing class and no parameters.
    expect(receiverTypeOf(facts, 'self', undefined)).toBeUndefined();
    // A field read outside any function has no enclosing class to be a field of.
    expect(receiverTypeOf(facts, 'this.index', undefined)).toBeUndefined();
    // The empty receiver is not a receiver.
    expect(receiverTypeOf(facts, '', 'Holder.run')).toBeUndefined();
    // A file that declared nothing declares no types, which is the same answer as no annotation.
    expect(receiverTypeOf(undefined, 'this.index', 'Holder.run')).toBeUndefined();
  });
});

describe('the classes the graph knows, and what a name with two answers means', () => {
  it('answers a member of a class one file declares', () => {
    const index = createClassIndex();
    mergeClassIndex(
      index,
      buildFileTypes([
        declaration('Class', 'Index', undefined, {}, 1),
        declaration('Method', 'buildIndex', 'Index', {}, 2),
      ]),
      'index.ts',
    );
    expect(classMemberOf(index, 'Index', 'buildIndex')).toEqual({ nodeId: 2, label: 'Method' });
    // A class that declares no such member is not a class this call belongs to.
    expect(classMemberOf(index, 'Index', 'query')).toBeUndefined();
    // A class name nobody declared has no members either.
    expect(classMemberOf(index, 'Absent', 'buildIndex')).toBeUndefined();
  });

  it('answers nothing for a class it has indexed no members for', () => {
    // A class whose every member was dropped - declared twice, or with no node - is a name with no answer.
    const index = createClassIndex();
    mergeClassIndex(
      index,
      buildFileTypes([declaration('Class', 'Index', undefined, {}, 1)]),
      'index.ts',
    );
    expect(classMemberOf(index, 'Index', 'buildIndex')).toBeUndefined();
  });

  it('drops a class name two files both declare', () => {
    const index = createClassIndex();
    mergeClassIndex(
      index,
      buildFileTypes([
        declaration('Class', 'Index', undefined, {}, 1),
        declaration('Method', 'buildIndex', 'Index', {}, 2),
      ]),
      'src/index.ts',
    );
    mergeClassIndex(
      index,
      buildFileTypes([
        declaration('Class', 'Index', undefined, {}, 3),
        declaration('Method', 'buildIndex', 'Index', {}, 4),
      ]),
      'src/legacy/index.ts',
    );
    // A simple name two classes carry has no answer, and neither does any member of it.
    expect(classMemberOf(index, 'Index', 'buildIndex')).toBeUndefined();
  });

  it('spells a declaration the way the graph does', () => {
    expect(ownerKeyOf('Holder', 'run')).toBe('Holder.run');
    expect(ownerKeyOf(undefined, 'connect')).toBe('connect');
    expect(ownerKeyOf('', 'connect')).toBe('connect');
  });
});

// **A method's class is a fact every language has and only some of them file on the declaration.** TypeScript puts a
// method inside `class_declaration` and the capture carries `containerName`; Python's `def run(self)` is emitted as a
// plain `Function` with no container at all, and the resolver has worked around that since iteration 41 by reading line
// spans. The receiver's-type rule needs the class by *name*, so the provider records it where the graph does not:
// a property, `enclosingClass`, which `containerOf` reads when `containerName` is absent.
describe('the class a declaration belongs to, when the language files it elsewhere', () => {
  it('prefers the class a provider filed over the container the graph carries', () => {
    // **The two answers are not the same question.** `containerName` is what encloses the declaration, and for a closure
    // inside a method that is the method: `def handler()` in `Flask.handle_http_exception` once filed every call in the
    // closure under a class called `handle_http_exception`, so `self._find_error_handler(...)` inside it resolved to
    // nothing. A provider that files `enclosingClass` has answered "which class", which is the question being asked.
    expect(containerOf({ containerName: 'handler', properties: { enclosingClass: 'Flask' } })).toBe(
      'Flask',
    );
    // With no class filed, the container is the answer - which is how TypeScript states it.
    expect(containerOf({ containerName: 'Holder', properties: {} })).toBe('Holder');
  });

  it('reads the property a language files it in', () => {
    expect(containerOf({ properties: { enclosingClass: 'Holder' } })).toBe('Holder');
    // An empty container is an answer of "none", which is what every Python capture carries today.
    expect(containerOf({ containerName: '', properties: { enclosingClass: 'Holder' } })).toBe(
      'Holder',
    );
  });

  it('answers nothing when neither says so, or when the property is not a name', () => {
    expect(containerOf({ properties: {} })).toBeUndefined();
    expect(containerOf({ properties: { enclosingClass: 7 } })).toBeUndefined();
    expect(containerOf({ properties: { enclosingClass: '' } })).toBeUndefined();
  });

  it('files a method under its class from the property alone', () => {
    // The Python shape: no container, one property, and the class declared in the same file.
    const facts = buildFileTypes([
      declaration('Class', 'Holder', undefined, { fieldTypes: '{"index":"Index"}' }, 1),
      declaration('Function', 'run', undefined, { enclosingClass: 'Holder' }, 2),
      declaration('Class', 'Index', undefined, {}, 3),
      declaration('Function', 'build', undefined, { enclosingClass: 'Index' }, 4),
    ]);
    expect(facts.classOfFunction.get('Holder.run')).toBe('Holder');
    // **And the call it makes resolvable is the one this whole rule exists for.** `self.index.build()` in Python is
    // exactly `this.index.buildIndex()` in TypeScript: the field's type decides which `build` the call names.
    expect(receiverTypeOf(facts, 'self.index', 'Holder.run')).toEqual({
      className: 'Index',
      via: 'thisField',
    });
    // A field nobody annotated is still not a fact, whatever the class carries.
    expect(receiverTypeOf(facts, 'self.store', 'Holder.run')).toBeUndefined();
  });
});
