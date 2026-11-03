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
  ELEMENT_OF,
  elementTypeName,
  mergeClassIndex,
  ownerKeyOf,
  receiverTypeOf,
  simpleTypeName,
} from '../resolution/receiver-types.js';

import type { ReceiverLookup, TypedDeclaration } from '../resolution/receiver-types.js';

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
    // **A qualified name keeps the qualifier when the qualifier is a package**, because the package is what decides
    // which class the name means: `java.io.ByteArrayOutputStream` is not the checkout's `ByteArrayOutputStream`.
    expect(simpleTypeName('pkg.Index')).toBe('pkg.Index');
    expect(simpleTypeName('typing.Protocol')).toBe('typing.Protocol');
    // A qualifier that is not a package - a nested type, a module written in camel case - keeps the old reading.
    expect(simpleTypeName('Outer.Inner')).toBe('Inner');
  });

  it('strips the members of a union that are values rather than types', () => {
    // **`T | null` is how both TypeScript corpora spell "absent, or this"**, and the code that calls a member on such a
    // field compiles only because a guard narrowed it first - so the annotation is the declaration and the call site is
    // the proof. One survivor is the type; the members that are not values are not.
    expect(simpleTypeName('Index | null')).toBe('Index');
    expect(simpleTypeName('null | Index')).toBe('Index');
    expect(simpleTypeName('false | Index')).toBe('Index');
    expect(simpleTypeName('Index | undefined | null')).toBe('Index');
    // Two types is still two answers, and picking one is the guess this module exists to avoid.
    expect(simpleTypeName('Index | Registry')).toBeUndefined();
    expect(simpleTypeName('string | Buffer')).toBeUndefined();
    expect(simpleTypeName('Readable & Writable')).toBeUndefined();
  });

  it('reduces a generic to its head, and refuses everything else that is not a name', () => {
    // **A generic names its head.** `Deque<CommandItem>` is a `Deque`; the argument says what it holds.
    expect(simpleTypeName('Deque<Index>')).toBe('Deque');
    expect(simpleTypeName('Deque<Index<Item>>')).toBe('Deque');
    // A builtin's head has no declaration to find a member in, however it is spelled.
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

  it('drops a parameter two declarations of one method disagree about', () => {
    // **An overload is one name and two signatures, and a call site names neither.** `ObjectUtils` declares
    // `identityToString(StringBuilder, Object)` and `identityToString(StrBuilder, Object)`, so a parameter map keyed
    // by `Class.method` had one `builder` and whichever declaration the walk reached last - and the call at the end
    // was resolved against the other overload's type. Measured: the answer was `StringBuilder` for a receiver
    // declared `StrBuilder`, on the strength of the declaration order alone. Two types are two answers, so the name
    // is dropped, exactly as a field two declarations disagree about is dropped.
    const overloaded = buildFileTypes([
      declaration('Method', 'identityToString', 'ObjectUtils', {}, 30),
      declaration(
        'Variable',
        'builder',
        undefined,
        { parameterOwner: 'ObjectUtils.identityToString', parameterType: 'StrBuilder' },
        31,
      ),
      declaration(
        'Variable',
        'builder',
        undefined,
        { parameterOwner: 'ObjectUtils.identityToString', parameterType: 'StringBuilder' },
        32,
      ),
    ]);
    expect(overloaded.parameters.has('ObjectUtils.identityToString\u0000builder')).toBe(false);
    // The same name with the same type twice is one fact, and overloads that agree stay answerable.
    const agreeing = buildFileTypes([
      declaration('Method', 'run', 'Holder', {}, 33),
      declaration(
        'Variable',
        'widget',
        undefined,
        { parameterOwner: 'Holder.run', parameterType: 'Widget' },
        34,
      ),
      declaration(
        'Variable',
        'widget',
        undefined,
        { parameterOwner: 'Holder.run', parameterType: 'Widget' },
        35,
      ),
    ]);
    expect(agreeing.parameters.get('Holder.run\u0000widget')).toBe('Widget');
  });

  it('remembers which class holds a method, so `this` can be answered', () => {
    expect(facts.classOfFunction.get('Holder.run')).toBe('Holder');
  });

  it('answers a class that declares one name twice with the declaration that runs', () => {
    const overloaded = buildFileTypes([
      declaration('Class', 'Holder', undefined, {}, 1),
      declaration('Method', 'run', 'Holder', {}, 2),
      declaration('Method', 'run', 'Holder', {}, 3),
    ]);
    // Two signatures of one method are one method, and the last is the one with the body.
    expect(overloaded.members.get('Holder')?.get('run')).toEqual({ nodeId: 3, label: 'Method' });
  });

  it('refuses one name a method and a nested function both claim', () => {
    // **The one shape that really is two answers.** Python files a `def` nested inside a method under the *class* the
    // method belongs to, so `def run(self): def run(): …` puts a `Function` and a `Method` on one name - two
    // different things to call, and neither is picked.
    const ambiguous = buildFileTypes([
      declaration('Class', 'Holder', undefined, {}, 1),
      declaration('Method', 'run', 'Holder', {}, 2),
      declaration('Function', 'run', 'Holder', {}, 3),
    ]);
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
  /** The file the receivers below are written in, indexed so a hop can cross into it. */
  const FILE = '/holder.ts';
  const facts = buildFileTypes([
    declaration('Class', 'Holder', undefined, {}, 1),
    declaration('Method', 'run', 'Holder', {}, 2),
    declaration('Property', 'index', 'Holder', { fieldType: 'Index | null' }, 3),
    declaration('Property', 'store', 'Holder', { fieldType: 'Archive' }, 4),
    declaration('Class', 'Index', undefined, {}, 5),
    declaration('Class', 'Archive', undefined, {}, 6),
    declaration('Property', 'inner', 'Archive', { fieldType: 'Index' }, 7),
    declaration(
      'Variable',
      'self',
      undefined,
      { parameterOwner: 'connect', parameterType: 'Index' },
      8,
    ),
    // A local, filed on the function that declares it: an annotation, a `new`, and an alias of `this`.
    declaration(
      'Function',
      'connect',
      undefined,
      { localTypes: '{"chosen":"Index","constructed":"Index","_this":"Holder"}' },
      9,
    ),
    declaration('Function', 'helper', 'Holder', {}, 10),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, facts, FILE);
  const at = (owners: readonly string[]): ReceiverLookup => ({
    index,
    origin: { file: FILE },
    owners,
  });

  it('reads a field of the enclosing object', () => {
    expect(receiverTypeOf(at(['Holder.run']), 'this.index')).toEqual({
      className: 'Index',
      via: 'thisField',
    });
  });

  it('reads a parameter of the calling function', () => {
    // `self` in a function that belongs to no class: the annotation is the only evidence, and it is enough.
    expect(receiverTypeOf(at(['connect']), 'self')).toEqual({
      className: 'Index',
      via: 'parameter',
    });
  });

  it('walks a path, reading each hop out of the class the previous one named', () => {
    // **Two hops, two declarations.** `this.store` is an `Archive`, and `Archive.inner` is an `Index`; nothing but the
    // two annotations says so, and either one missing ends the walk.
    expect(receiverTypeOf(at(['Holder.run']), 'this.store.inner')).toEqual({
      className: 'Index',
      via: 'thisField',
    });
    expect(receiverTypeOf(at(['Holder.run']), 'this.store.missing')).toBeUndefined();
    expect(receiverTypeOf(at(['Holder.run']), 'this.index.inner')).toBeUndefined();
  });

  it('reads a local the function declared, innermost owner first', () => {
    expect(receiverTypeOf(at(['connect']), 'chosen')).toEqual({ className: 'Index', via: 'local' });
    expect(receiverTypeOf(at(['connect']), 'constructed')).toEqual({
      className: 'Index',
      via: 'local',
    });
    // `const _this = this` is filed as the enclosing class, so the alias answers with the class itself.
    expect(receiverTypeOf(at(['connect']), '_this')).toEqual({ className: 'Holder', via: 'local' });
    // **A nested owner is asked before the one that holds the binding**, and the binding is still visible from inside.
    expect(receiverTypeOf(at(['Holder.helper', 'connect']), '_this')).toEqual({
      className: 'Holder',
      via: 'local',
    });
  });

  it('declines every shape whose type nobody wrote down', () => {
    // A receiver that is not the enclosing object and not a parameter is somebody else's object.
    expect(receiverTypeOf(at(['Holder.run']), 'request.args')).toBeUndefined();
    // A hop with no annotation ends the walk rather than guessing.
    expect(receiverTypeOf(at(['Holder.run']), 'this.unknown')).toBeUndefined();
    // `this.m()` is the same-file arm's case: the enclosing class is already the scope it looks in.
    expect(receiverTypeOf(at(['Holder.run']), 'this')).toBeUndefined();
    // An owner nobody declared has no enclosing class and no parameters.
    expect(receiverTypeOf(at(['connect']), 'nobody')).toBeUndefined();
    // A field read outside any function has no enclosing class to be a field of.
    expect(receiverTypeOf(at([]), 'this.index')).toBeUndefined();
    // The empty receiver is not a receiver.
    expect(receiverTypeOf(at(['Holder.run']), '')).toBeUndefined();
    // A file the index never saw declares no types, which is the same answer as no annotation.
    expect(
      receiverTypeOf({ index, origin: { file: '/elsewhere.ts' }, owners: [] }, 'x'),
    ).toBeUndefined();
  });

  it('refuses `super`, because the base-chain arm is the one that starts at the base', () => {
    expect(receiverTypeOf(at(['Holder.run']), 'super.index')).toBeUndefined();
  });
});

/**
 * **A loop variable holds no annotation, so the provider records the iterable and the reader resolves it.**
 *
 * `for (const leaf of this.leaves)` names the collection nowhere else: the syntax says what is iterated, and the element
 * is what the binding holds. The provider writes the path down behind `ELEMENT_OF` — reducing it there would file the
 * last segment of `this.leaves` as a class called `leaves` — and this module resolves it against the same declarations a
 * receiver is resolved against, one hop earlier. The hop count is the rule: the loop site states one path and nothing
 * about what that path's own fields are typed, so a second hop is refused rather than guessed.
 */
describe('a binding recorded as the element of a path', () => {
  const FILE = '/leaves.ts';
  const facts = buildFileTypes([
    declaration(
      'Class',
      'Tree',
      undefined,
      { fieldTypes: '{"leaves":"Leaf[]","branches":"Branch[]"}' },
      1,
    ),
    declaration('Method', 'prune', 'Tree', {}, 2),
    declaration('Class', 'Leaf', undefined, {}, 3),
    declaration('Method', 'disconnect', 'Leaf', {}, 4),
    // Every path the rule has to answer or refuse: a field, a field one hop too deep, the object itself, an array
    // nobody annotated, and no path at all.
    declaration(
      'Method',
      'sweep',
      'Tree',
      {
        localTypes: JSON.stringify({
          leaf: `${ELEMENT_OF}this.leaves`,
          deep: `${ELEMENT_OF}this.leaves.child`,
          object: `${ELEMENT_OF}this`,
          absent: `${ELEMENT_OF}this.unknown`,
          empty: ELEMENT_OF,
        }),
      },
      5,
    ),
    // A module-level function: the loop binds a parameter's element, and there is no class to read a field from.
    declaration(
      'Variable',
      'items',
      undefined,
      { parameterOwner: 'drain', parameterType: 'Leaf[]' },
      6,
    ),
    declaration(
      'Function',
      'drain',
      undefined,
      {
        localTypes: JSON.stringify({
          leaf: `${ELEMENT_OF}items`,
          deep: `${ELEMENT_OF}items.child`,
          orphan: `${ELEMENT_OF}this.leaves`,
        }),
      },
      7,
    ),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, facts, FILE);
  const at = (owners: readonly string[]): ReceiverLookup => ({
    index,
    origin: { file: FILE },
    owners,
  });

  it('reads the element of a field of the enclosing object', () => {
    expect(receiverTypeOf(at(['Tree.sweep']), 'leaf')).toEqual({
      className: 'Leaf',
      via: 'thisField',
    });
  });

  it('reads the element of a parameter the function declares', () => {
    // **A bare name is a local or a parameter, and both are filed under one owner key** — so the answer does not have
    // to say which of the two it was: `for (const x of items)` iterates what `items` is.
    expect(receiverTypeOf(at(['drain']), 'leaf')).toEqual({ className: 'Leaf', via: 'local' });
  });

  it('refuses a path deeper than the one hop the loop site states', () => {
    expect(receiverTypeOf(at(['Tree.sweep']), 'deep')).toBeUndefined();
    expect(receiverTypeOf(at(['drain']), 'deep')).toBeUndefined();
  });

  it('refuses an iterable that is not a field of one name, or that has no element', () => {
    // `for (const x of this)` iterates the object itself, which is not a field.
    expect(receiverTypeOf(at(['Tree.sweep']), 'object')).toBeUndefined();
    // An array nobody annotated has no element, which is the same answer as no annotation at all.
    expect(receiverTypeOf(at(['Tree.sweep']), 'absent')).toBeUndefined();
    // **A module-level function has no enclosing class**, so `this.leaves` names no field of one.
    expect(receiverTypeOf(at(['drain']), 'orphan')).toBeUndefined();
    // A path with no base at all is not a path.
    expect(receiverTypeOf(at(['Tree.sweep']), 'empty')).toBeUndefined();
  });

  it('answers a lookup that names no file, out of the index alone', () => {
    // **A receiver read with no origin has no own file**, which is the state every hop after the first one is in: the
    // class it landed on may live anywhere, and the index is the only thing that knows where.
    expect(receiverTypeOf({ index, owners: ['Tree.sweep'] }, 'this.leaves')).toBeUndefined();
    expect(receiverTypeOf({ index, owners: ['Tree.sweep'] }, 'leaf')).toBeUndefined();
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

  it('reads a name from the one file the lookup imports, and refuses two', () => {
    // **A name the file does not declare is decided by what the file imports**, and this is the arm that states it:
    // one imported file that declares the name is evidence, two are the case with no evidence in it. The lookup's own
    // file declares neither, so the answer can only come from the imports.
    const index = createClassIndex();
    mergeClassIndex(
      index,
      buildFileTypes([
        declaration('Class', 'Index', undefined, {}, 1),
        declaration('Method', 'build', 'Index', {}, 2),
      ]),
      'src/a/index.ts',
    );
    mergeClassIndex(
      index,
      buildFileTypes([
        declaration('Class', 'Index', undefined, {}, 3),
        declaration('Method', 'build', 'Index', {}, 4),
      ]),
      'src/b/index.ts',
    );
    expect(
      classMemberOf(index, 'Index', 'build', {
        file: 'caller.ts',
        imported: new Set(['src/a/index.ts']),
      }),
    ).toEqual({ nodeId: 2, label: 'Method' });
    // Two imports that both provide the name is a coin toss, and a coin toss is not a resolution.
    expect(
      classMemberOf(index, 'Index', 'build', {
        file: 'caller.ts',
        imported: new Set(['src/a/index.ts', 'src/b/index.ts']),
      }),
    ).toBeUndefined();
  });

  it('refuses a member two bases declare at the same distance', () => {
    // **A class with two parents that both declare `run` has no answer at this resolver's disposal**, and picking one
    // would write the pick order into the graph. The nearest declaration wins only when there is one of them.
    const index = createClassIndex();
    mergeClassIndex(
      index,
      buildFileTypes([
        declaration('Class', 'A', undefined, {}, 1),
        declaration('Method', 'run', 'A', {}, 2),
        declaration('Class', 'B', undefined, {}, 3),
        declaration('Method', 'run', 'B', {}, 4),
        declaration('Class', 'C', undefined, { baseClasses: 'A,B' }, 5),
      ]),
      'src/c.ts',
    );
    expect(classMemberOf(index, 'C', 'run')).toBeUndefined();
  });

  /**
   * **A stub is a restatement, not a rival declaration.**
   *
   * `pallets/werkzeug@3.0.3` ships a `.pyi` beside almost every module, and both files declare `class Headers`. The
   * index saw two files claiming one name and refused every member of it - so **33 class names in that one checkout**
   * were unanswerable, and every `self.headers.get(...)` in `sansio/response.py` and `sansio/request.py` resolved to
   * nothing while the annotation saying what `headers` is sat in the file being ignored. A stub has no bodies: the
   * class is the half that does, which is the same rule `buildFileTypes` already applies to a class and an interface
   * that merge under one name.
   */
  describe('a stub beside a module', () => {
    it('answers from the module when the module was indexed first', () => {
      const index = createClassIndex();
      mergeClassIndex(
        index,
        buildFileTypes([
          declaration('Class', 'Headers', undefined, {}, 1),
          declaration('Method', 'get', 'Headers', {}, 2),
        ]),
        'src/werkzeug/datastructures/headers.py',
      );
      // The stub declares the same class and no body, so it answers nothing of its own.
      mergeClassIndex(
        index,
        buildFileTypes([
          declaration('Class', 'Headers', undefined, {}, 3),
          declaration('Method', 'get', 'Headers', {}, 4),
        ]),
        'src/werkzeug/datastructures/headers.pyi',
      );
      expect(classMemberOf(index, 'Headers', 'get')).toEqual({ nodeId: 2, label: 'Method' });
    });

    it('answers from the module when the stub was indexed first', () => {
      // **The order is the filesystem's, not the rule's**, and a rule that only worked when the module came first
      // would answer a directory walk rather than a question about types.
      const index = createClassIndex();
      mergeClassIndex(
        index,
        buildFileTypes([
          declaration('Class', 'Headers', undefined, {}, 3),
          declaration('Method', 'get', 'Headers', {}, 4),
        ]),
        'src/werkzeug/datastructures/headers.pyi',
      );
      mergeClassIndex(
        index,
        buildFileTypes([
          declaration('Class', 'Headers', undefined, {}, 1),
          declaration('Method', 'get', 'Headers', {}, 2),
        ]),
        'src/werkzeug/datastructures/headers.py',
      );
      expect(classMemberOf(index, 'Headers', 'get')).toEqual({ nodeId: 2, label: 'Method' });
    });

    it('still refuses a stub of a different module, and two modules', () => {
      // **The stub has to be *this module's***. A name in `vendor/headers.pyi` says nothing about `types/headers.py`,
      // and reading them as one class would be the coincidence this module refuses everywhere else.
      const index = createClassIndex();
      mergeClassIndex(
        index,
        buildFileTypes([declaration('Class', 'Headers', undefined, {}, 1)]),
        'src/types/headers.py',
      );
      mergeClassIndex(
        index,
        buildFileTypes([declaration('Class', 'Headers', undefined, {}, 2)]),
        'vendor/headers.pyi',
      );
      expect(classMemberOf(index, 'Headers', 'get')).toBeUndefined();
      // Two stubs are two stubs: neither is the half with bodies.
      const stubs = createClassIndex();
      mergeClassIndex(
        stubs,
        buildFileTypes([declaration('Class', 'Headers', undefined, {}, 1)]),
        'src/a/headers.pyi',
      );
      mergeClassIndex(
        stubs,
        buildFileTypes([declaration('Class', 'Headers', undefined, {}, 2)]),
        'src/b/headers.pyi',
      );
      expect(classMemberOf(stubs, 'Headers', 'get')).toBeUndefined();
    });

    it('answers from a stub whose module is not in the checkout', () => {
      // **A library shipped as stubs alone is a class with no other half**, and the rule is about which of two
      // declarations is the body, not about refusing every `.pyi`.
      const index = createClassIndex();
      mergeClassIndex(
        index,
        buildFileTypes([
          declaration('Class', 'Headers', undefined, {}, 1),
          declaration('Method', 'get', 'Headers', {}, 2),
        ]),
        'types/headers.pyi',
      );
      expect(classMemberOf(index, 'Headers', 'get')).toEqual({ nodeId: 2, label: 'Method' });
    });

    it('reads the same rule for TypeScript’s declaration files', () => {
      // `.d.ts` is the same construct in the language the product is written in, and `.d.mts`/`.d.cts` are the two
      // extensions the compiler introduced with the module system - all three restate a module rather than rival it.
      const index = createClassIndex();
      mergeClassIndex(
        index,
        buildFileTypes([declaration('Class', 'Index', undefined, {}, 1)]),
        'src/index.d.ts',
      );
      mergeClassIndex(
        index,
        buildFileTypes([
          declaration('Class', 'Index', undefined, {}, 2),
          declaration('Method', 'build', 'Index', {}, 3),
        ]),
        'src/index.ts',
      );
      expect(classMemberOf(index, 'Index', 'build')).toEqual({ nodeId: 3, label: 'Method' });
      const esm = createClassIndex();
      mergeClassIndex(
        esm,
        buildFileTypes([
          declaration('Class', 'Index', undefined, {}, 1),
          declaration('Method', 'build', 'Index', {}, 2),
        ]),
        'src/index.mts',
      );
      mergeClassIndex(
        esm,
        buildFileTypes([declaration('Class', 'Index', undefined, {}, 3)]),
        'src/index.d.mts',
      );
      expect(classMemberOf(esm, 'Index', 'build')).toEqual({ nodeId: 2, label: 'Method' });
    });

    it('matches a module and its stub at the root, and a name with no extension', () => {
      // **The rule reads the file name, not the depth of the path, and not the shape of an extension.** A root-level
      // `headers.pyi` is the stub of a root-level `headers.py` - a directory with no name is still one directory - and
      // a module whose file carries no extension has a stem that is its whole name. Both answers come from the same
      // two functions, and neither of them assumes a separator or a dot is there.
      const flat = createClassIndex();
      mergeClassIndex(
        flat,
        buildFileTypes([
          declaration('Class', 'Headers', undefined, {}, 1),
          declaration('Method', 'get', 'Headers', {}, 2),
        ]),
        'headers.pyi',
      );
      mergeClassIndex(
        flat,
        buildFileTypes([
          declaration('Class', 'Headers', undefined, {}, 3),
          declaration('Method', 'get', 'Headers', {}, 4),
        ]),
        'headers',
      );
      // The half with bodies is the answer, and it is here the one whose name carries no dot.
      expect(classMemberOf(flat, 'Headers', 'get')).toEqual({ nodeId: 4, label: 'Method' });
    });
  });

  /**
   * **A member written twice is one name, because a call writes a name.**
   *
   * `redis/ioredis@5.4.2` declares `info` eleven times and `cluster` forty-two - overload signatures on the
   * `RedisCommander` interface - and `colinhacks/zod` declares `ContractTable.info` twice the same way. Every one of
   * those names was filed as `@ambiguous`, so `this.info(…)` and `this.cluster(…)` resolved to nothing. The last
   * declaration of one kind is the one that runs, which is why an overload block ends with the body it describes.
   */
  it('files a member declared twice under one name as one member', () => {
    const facts = buildFileTypes([
      declaration('Class', 'Commander', undefined, {}, 1),
      declaration('Method', 'info', 'Commander', {}, 2),
      declaration('Method', 'info', 'Commander', {}, 3),
      declaration('Method', 'get', 'Commander', {}, 4),
    ]);
    expect(facts.members.get('Commander')?.get('info')).toEqual({ nodeId: 3, label: 'Method' });
    expect(facts.members.get('Commander')?.get('get')).toEqual({ nodeId: 4, label: 'Method' });
  });

  it('still refuses one name that two kinds of declaration claim', () => {
    // A method and a function of the same name are two different things to call, and a call naming it has no answer.
    const facts = buildFileTypes([
      declaration('Class', 'Commander', undefined, {}, 1),
      declaration('Method', 'info', 'Commander', {}, 2),
      declaration('Function', 'info', 'Commander', {}, 3),
    ]);
    expect(facts.members.get('Commander')?.get('info')).toBeUndefined();
    expect(facts.members.get('Commander')?.has('info\u0000ambiguous')).toBe(true);
    // **And the refusal holds through the index**, which is where a call actually asks: the marker is what stops a
    // refused name from being read back as a member with no node.
    const index = createClassIndex();
    mergeClassIndex(index, facts, 'commander.ts');
    expect(classMemberOf(index, 'Commander', 'info')).toBeUndefined();
    // And a third declaration does not undo the refusal.
    const later = buildFileTypes([
      declaration('Class', 'Commander', undefined, {}, 1),
      declaration('Method', 'info', 'Commander', {}, 2),
      declaration('Function', 'info', 'Commander', {}, 3),
      declaration('Method', 'info', 'Commander', {}, 4),
    ]);
    expect(later.members.get('Commander')?.get('info')).toBeUndefined();
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
    const index = createClassIndex();
    mergeClassIndex(index, facts, 'holder.py');
    const at = { index, origin: { file: 'holder.py' }, owners: ['Holder.run'] };
    // **And the call it makes resolvable is the one this whole rule exists for.** `self.index.build()` in Python is
    // exactly `this.index.buildIndex()` in TypeScript: the field's type decides which `build` the call names.
    expect(receiverTypeOf(at, 'self.index')).toEqual({ className: 'Index', via: 'thisField' });
    // A field nobody annotated is still not a fact, whatever the class carries.
    expect(receiverTypeOf(at, 'self.store')).toBeUndefined();
  });
});

describe('a receiver Java writes without `this`', () => {
  /** `Holder` declares a static field of a type it does not own, which is how Java writes a shared translator. */
  const FILE = '/CharSetUtils.java';
  const facts = buildFileTypes([
    declaration(
      'Class',
      'CharSetUtils',
      undefined,
      { fieldTypes: '{"escapeCsv":"Translator"}' },
      1,
    ),
    declaration('Method', 'apply', 'CharSetUtils', {}, 2),
    declaration('Class', 'Translator', undefined, {}, 3),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, facts, FILE);
  const at: ReceiverLookup = { index, origin: { file: FILE }, owners: ['CharSetUtils.apply'] };

  it('reads a bare name as the field of the class the call is written in', () => {
    // **`ESCAPE_CSV.translate(w, s)` is the shape a static field is used in, and a rule that only looked at locals and
    // parameters answered nothing.** On `apache/commons-lang` that was 17 of 307 missed pairs, all of them written on
    // a field the class declares three lines above the call.
    // **The receiver is the field alone.** `ESCAPE_CSV.translate(w, s)` writes a receiver of one segment and a method
    // name the call site already carries, so the bare form is the shape and not a degenerate one.
    expect(receiverTypeOf(at, 'escapeCsv')).toEqual({ className: 'Translator', via: 'thisField' });
  });

  it('still answers nothing for a name nothing declares', () => {
    expect(receiverTypeOf(at, 'unknown.method')).toBeUndefined();
    // A field of the class is not a name the *file* declares at module level, so a call outside the class sees nothing.
    expect(
      receiverTypeOf({ index, origin: { file: FILE }, owners: ['free'] }, 'escapeCsv'),
    ).toBeUndefined();
  });
});

describe('a call written on what a construction returns', () => {
  const FILE = '/builder.ts';
  const facts = buildFileTypes([
    declaration('Class', 'HashCodeBuilder', undefined, {}, 1),
    declaration('Method', 'append', 'HashCodeBuilder', {}, 2),
    declaration('Class', 'Reader', undefined, {}, 3),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, facts, FILE);
  const at: ReceiverLookup = { index, origin: { file: FILE }, owners: ['Reader.hash'] };

  it('reads the class the receiver is built from', () => {
    // **`new HashCodeBuilder().append(v)` names its type twice and its receiver once.** Eleven of
    // `apache/commons-lang`'s missed pairs are this shape, and the evidence is the construction the receiver writes.
    expect(receiverTypeOf(at, 'new HashCodeBuilder()')).toEqual({
      className: 'HashCodeBuilder',
      via: 'local',
    });
    expect(receiverTypeOf(at, 'new HashCodeBuilder(17, 37)')).toEqual({
      className: 'HashCodeBuilder',
      via: 'local',
    });
  });

  it('refuses a construction whose class is not a simple name', () => {
    // An anonymous class body names no type this resolver can call a member on.
    expect(receiverTypeOf(at, 'new HashCodeBuilder() { }')).toBeUndefined();
    expect(receiverTypeOf(at, 'new')).toBeUndefined();
  });
});

describe('a contract a class implements is not part of its chain', () => {
  const CONTRACT = '/Contract.java';
  const HANDLER = '/Handler.java';
  const BASE = '/Base.java';
  const contractFacts = buildFileTypes([
    declaration('Interface', 'Contract', undefined, {}, 10),
    declaration('Method', 'handle', 'Contract', {}, 11),
  ]);
  const baseFacts = buildFileTypes([
    declaration('Class', 'Base', undefined, {}, 14),
    declaration('Method', 'handle', 'Base', {}, 15),
  ]);
  const handlerFacts = buildFileTypes([
    declaration('Class', 'Handler', undefined, { interfaces: 'Contract' }, 12),
    declaration('Method', 'run', 'Handler', {}, 13),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, contractFacts, CONTRACT);
  mergeClassIndex(index, baseFacts, BASE);
  mergeClassIndex(index, handlerFacts, HANDLER);

  it('refuses a member that only an implemented interface declares', () => {
    // **A contract was tried as a base, and the measurement threw it out.** Reading the clause looked like free
    // recall - `class Command implements Respondable` would let `this.reject(err)` find the contract's `reject` - and
    // on `redis/ioredis@5.4.2` it cost **seven wrong edges and earned none**: every one of the seven pointed at
    // `types.ts|reject` or `types.ts|resolve`, the abstract declaration in the contract, when the member that runs is
    // a field on the class that no node exists for. An interface declares no body to reach, so the walk reads
    // `extends` alone - the one clause that carries an implementation.
    expect(classMemberOf(index, 'Handler', 'handle', { file: HANDLER })).toBeUndefined();
  });

  it('still answers with a member a superclass declares', () => {
    // The distinction the test above rests on is the clause and not the mood: the same name, reached through
    // `extends`, is a body the subclass inherits.
    const extendsFacts = buildFileTypes([
      declaration('Class', 'Sub', undefined, { baseClasses: 'Base' }, 16),
      declaration('Method', 'run', 'Sub', {}, 17),
    ]);
    mergeClassIndex(index, extendsFacts, '/Sub.java');
    expect(classMemberOf(index, 'Sub', 'handle', { file: '/Sub.java' })).toEqual({
      nodeId: 15,
      label: 'Method',
    });
  });
});

/**
 * **A call in the middle of a receiver is a hop with a type, and the type is the one the callee declares.**
 *
 * `QueueInputStream.builder().setBlockingQueue(q).get()` is how a builder is written in every language that has one:
 * the receiver names a *call*, not a field, and the only thing that says what the call holds is the declaration of
 * what it calls. Iteration 58 measured the alternative first - refusing every receiver containing a call - and the
 * measurement threw it out: it removed 8 wrong claims on `apache/commons-lang` and cost 9 true ones across three
 * other checkouts, because a fluent chain genuinely ends at a member of the class the factory returns.
 */
describe('a hop that is a call, answered by the return type it declares', () => {
  const FILE = '/builder.java';
  const facts = buildFileTypes([
    declaration('Class', 'QueueInputStream', undefined, {}, 1),
    declaration('Method', 'builder', 'QueueInputStream', { returnType: 'Builder' }, 2),
    declaration('Method', 'open', 'QueueInputStream', { returnType: 'void' }, 3),
    declaration('Method', 'untold', 'QueueInputStream', {}, 4),
    declaration('Class', 'Builder', undefined, {}, 5),
    declaration('Method', 'setBlockingQueue', 'Builder', { returnType: 'Builder<T>' }, 6),
    declaration('Method', 'get', 'Builder', {}, 7),
    declaration('Class', 'Archive', undefined, {}, 8),
    declaration('Method', 'find', 'Archive', { returnType: 'Index' }, 10),
    declaration('Class', 'Index', undefined, {}, 11),
    declaration('Method', 'next', 'Index', {}, 12),
    declaration('Class', 'Holder', undefined, {}, 13),
    declaration('Method', 'run', 'Holder', {}, 14),
    declaration('Property', 'archive', 'Holder', { fieldType: 'Archive' }, 15),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, facts, FILE);
  const at = (owners: readonly string[] = []): ReceiverLookup => ({
    index,
    origin: { file: FILE },
    owners,
  });

  it('files what a declaration says it returns, and refuses the two shapes that state no type', () => {
    expect(facts.returns.get('QueueInputStream.builder')).toBe('Builder');
    // A generic return type names its head, exactly as a field's annotation does.
    expect(facts.returns.get('Builder.setBlockingQueue')).toBe('Builder');
    // `void` is a type no member can be called on, and a declaration that writes none states nothing.
    expect(facts.returns.has('QueueInputStream.open')).toBe(false);
    expect(facts.returns.has('QueueInputStream.untold')).toBe(false);
  });

  it('walks a fluent chain, one declared return type per hop', () => {
    // **The class the factory is written on is where the walk starts**, and it is evidence rather than a guess: a
    // receiver whose root names a class asks that class for the member.
    expect(receiverTypeOf(at(), 'QueueInputStream.builder()')).toEqual({
      className: 'Builder',
      via: 'class',
    });
    expect(receiverTypeOf(at(), 'QueueInputStream.builder().setBlockingQueue(q)')).toEqual({
      className: 'Builder',
      via: 'class',
    });
  });

  it('walks through a field and then through a call, which is the same walk one hop apart', () => {
    // `this.archive.find(a.b)` is what makes the split of a receiver a question of its own: the argument
    // contains no dot here, but `find(a.b)` would break a splitter that cut at every `.` it saw.
    expect(receiverTypeOf(at(['Holder.run']), 'this.archive.find(a.b)')).toEqual({
      className: 'Index',
      via: 'thisField',
    });
  });

  it('ends the walk at a call whose return type nobody declared', () => {
    expect(receiverTypeOf(at(), 'QueueInputStream.untold()')).toBeUndefined();
    expect(receiverTypeOf(at(), 'QueueInputStream.open()')).toBeUndefined();
    // A member the class does not declare has no return type to read, and the walk does not guess one.
    expect(receiverTypeOf(at(), 'QueueInputStream.missing()')).toBeUndefined();
  });

  it('keeps a construction and a class root apart, because only one of them is written with `new`', () => {
    expect(receiverTypeOf(at(), 'new Builder()')).toEqual({ className: 'Builder', via: 'local' });
    // A bare class name is not a receiver with a member on it; the class itself is the answer, not a call on it.
    expect(receiverTypeOf(at(), 'Builder')).toBeUndefined();
  });
});

/**
 * **An enum is a type, and the product filed none of them.**
 *
 * `java.time.DayOfWeek` and `JavaVersion` declare methods and constants that every call on them reaches, and
 * `buildFileTypes` read `Class`, `Struct` and `Interface` - so `JavaVersion` had no entry in the class index at all.
 * Measured on `apache/commons-lang@3.14.0`: `SystemUtils.isJavaVersionAtLeast` and `isJavaVersionAtMost` both call
 * `atLeast`/`atMost` on a field declared `JavaVersion`, and both pairs were unanswered for that reason alone.
 */
/**
 * **A name is written inside a class, and a class is a file.**
 *
 * `UnsynchronizedByteArrayInputStream.builder()` declares its return type as `Builder`, and the `Builder` that name
 * means is the nested class of the file that declares `builder` — not whichever `Builder` the checkout is ambiguous
 * about, which on `apache/commons-io` is every `Builder` there is. Resolving the name where the call sits answered
 * nothing, and **five calls that follow the factory were unanswered for it**: `setByteArray`, `setOffset`, `setLength`
 * and the `get()` that ends the chain, twice over.
 */
describe('a type name read where it was written, not where the call sits', () => {
  const CALLER = '/output/Writer.java';
  const PROVIDER = '/input/Reader.java';
  const ELSEWHERE = '/other/Builder.java';
  const index = createClassIndex();
  mergeClassIndex(
    index,
    buildFileTypes([
      declaration('Class', 'Reader', undefined, {}, 1),
      declaration('Method', 'builder', 'Reader', { returnType: 'Builder' }, 2),
      declaration('Class', 'Builder', undefined, {}, 3),
      declaration('Method', 'setByteArray', 'Builder', { returnType: 'Builder' }, 4),
      declaration('Method', 'get', 'Builder', { returnType: 'InputStream' }, 5),
    ]),
    PROVIDER,
  );
  // A second `Builder` in a third file, which is what makes the simple name ambiguous everywhere else.
  mergeClassIndex(
    index,
    buildFileTypes([
      declaration('Class', 'Builder', undefined, {}, 6),
      declaration('Method', 'setByteArray', 'Builder', { returnType: 'Builder' }, 7),
    ]),
    ELSEWHERE,
  );
  // **The call site imports nothing**, which is the shape that makes the simple name ambiguous: `Reader` is still
  // findable because exactly one class in the checkout carries it, and `Builder` is not, because two do.
  const at = (): ReceiverLookup => ({ index, origin: { file: CALLER }, owners: [] });

  it('reads the return type in the file that declares the factory', () => {
    expect(receiverTypeOf(at(), 'Reader.builder()')).toEqual({
      className: 'Builder',
      via: 'class',
      declaredIn: PROVIDER,
    });
    // The hop after it is answered by that `Builder`, because the name means the one the factory wrote.
    expect(receiverTypeOf(at(), 'Reader.builder().setByteArray(buffer)')).toEqual({
      className: 'Builder',
      via: 'class',
      declaredIn: PROVIDER,
    });
  });

  it('answers the member where the name was read, and nowhere else', () => {
    // The scope is the fact the arm needs: at the call site the name has two answers, and the resolver is right to
    // refuse; in the file the name is a fact.
    expect(classMemberOf(index, 'Builder', 'setByteArray', at().origin)).toBeUndefined();
    expect(classMemberOf(index, 'Builder', 'setByteArray', { file: PROVIDER })).toEqual({
      nodeId: 4,
      label: 'Method',
    });
  });
});

describe('an enum declares members like any other type', () => {
  const FILE = '/JavaVersion.java';
  const facts = buildFileTypes([
    declaration('Enum', 'JavaVersion', undefined, {}, 21),
    declaration('Method', 'atLeast', 'JavaVersion', {}, 22),
    declaration('Class', 'SystemUtils', undefined, {}, 23),
    declaration('Property', 'version', 'SystemUtils', { fieldType: 'JavaVersion' }, 24),
    declaration('Method', 'check', 'SystemUtils', {}, 25),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, facts, FILE);

  it('files an enum where a class is filed, so a call on one can be answered', () => {
    expect(facts.classes.get('JavaVersion')).toEqual({ nodeId: 21, label: 'Enum' });
    expect(classMemberOf(index, 'JavaVersion', 'atLeast', { file: FILE })).toEqual({
      nodeId: 22,
      label: 'Method',
    });
  });

  it('reads a field declared with the enum as a receiver of that type', () => {
    expect(
      receiverTypeOf(
        { index, origin: { file: FILE }, owners: ['SystemUtils.check'] },
        'this.version',
      ),
    ).toEqual({ className: 'JavaVersion', via: 'thisField' });
  });
});

/**
 * **A Java name is answered by its own package before any other file, and the product had no such rule.**
 *
 * The language's own order is: the enclosing type, a single-type import, then the package. The graph had the first
 * two and the whole-graph fallback, and the fallback refuses a name two files declare - so `Functions.asPredicate(…)`
 * in `Streams.java` resolved to nothing because `apache/commons-lang` declares two classes called `Functions` in two
 * different packages, one of which is the file's own.
 */
describe('a name answered by the package it sits in', () => {
  const index = createClassIndex();
  const here = '/proj/pkg/Streams.java';
  const sibling = '/proj/pkg/Functions.java';
  const elsewhere = '/proj/other/Functions.java';
  mergeClassIndex(
    index,
    buildFileTypes([
      declaration('Class', 'Functions', undefined, {}, 31),
      declaration('Method', 'asPredicate', 'Functions', {}, 32),
    ]),
    sibling,
  );
  mergeClassIndex(
    index,
    buildFileTypes([
      declaration('Class', 'Functions', undefined, {}, 33),
      declaration('Method', 'asPredicate', 'Functions', {}, 34),
    ]),
    elsewhere,
  );
  mergeClassIndex(
    index,
    buildFileTypes([declaration('Class', 'Streams', undefined, {}, 35)]),
    here,
  );

  it('answers a class the package declares, where the whole graph has two answers', () => {
    expect(
      classMemberOf(index, 'Functions', 'asPredicate', { file: here, packageScope: true }),
    ).toEqual({ nodeId: 32, label: 'Method' });
  });

  it('refuses the same question without the package, because two files carry the name', () => {
    // The evidence is the language's, not the resolver's: TypeScript has no such rule, so the origin says whether
    // the question may be asked at all.
    expect(classMemberOf(index, 'Functions', 'asPredicate', { file: here })).toBeUndefined();
  });

  it('refuses a name the package itself declares twice', () => {
    // Two files in one directory that both declare the name is the same ambiguity one directory down, and picking
    // one of them would make the answer depend on the order of the walk.
    mergeClassIndex(
      index,
      buildFileTypes([
        declaration('Class', 'Twice', undefined, {}, 36),
        declaration('Method', 'anything', 'Twice', {}, 38),
      ]),
      '/proj/pkg/Twice.java',
    );
    mergeClassIndex(
      index,
      buildFileTypes([declaration('Class', 'Twice', undefined, {}, 37)]),
      '/proj/pkg/AlsoTwice.java',
    );
    expect(
      classMemberOf(index, 'Twice', 'anything', { file: here, packageScope: true }),
    ).toBeUndefined();
  });
});

// **A name is not a signature.** `format(x)` written in a class that declares `format(Object, StringBuffer,
// FieldPosition)` names the base class's method, and `notExists(path)` names a declaration that writes two parameters
// and lets a call pass one. Both are statements about a *declaration*, and neither can be read off a spelling.
describe('a class answers a call by its signature', () => {
  const FILE = '/src/demo/Composite.java';
  const facts = buildFileTypes([
    declaration('Class', 'Composite', undefined, {}, 1),
    declaration(
      'Method',
      'format',
      'Composite',
      { parameterCount: '3', requiredParameters: '3' },
      2,
    ),
    declaration(
      'Method',
      'parseObject',
      'Composite',
      { parameterCount: '2', requiredParameters: '2' },
      3,
    ),
    declaration(
      'Method',
      'notExists',
      'Composite',
      { parameterCount: '2', requiredParameters: '1', variadic: 'true' },
      4,
    ),
    declaration('Method', 'reset', 'Composite', { parameterCount: '0' }, 5),
    declaration(
      'Method',
      'reset',
      'Composite',
      { parameterCount: '2', requiredParameters: '2' },
      6,
    ),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, facts, FILE);
  const origin = { file: FILE };

  it('refuses a declaration no call of that arity can reach', () => {
    // `format(parseObject(input))` passes one argument and the class declares three; the call runs the *base* class's
    // method, which the checkout does not hold.
    expect(classMemberOf(index, 'Composite', 'format', origin, 1)).toBeUndefined();
    expect(classMemberOf(index, 'Composite', 'format', origin, 3)).toEqual({
      nodeId: 2,
      label: 'Method',
    });
  });

  it('answers the old question when the caller cannot count arguments', () => {
    // A deferred `Type::method` and a call being edited state no arity, and an unknown fact is not a refusal.
    expect(classMemberOf(index, 'Composite', 'format', origin)).toEqual({
      nodeId: 2,
      label: 'Method',
    });
  });

  it('lets a variadic declaration admit fewer arguments than it writes', () => {
    // `notExists(Path, LinkOption...)` is called as `notExists(path)` throughout `apache/commons-io`.
    expect(classMemberOf(index, 'Composite', 'notExists', origin, 1)).toEqual({
      nodeId: 4,
      label: 'Method',
    });
    expect(classMemberOf(index, 'Composite', 'notExists', origin, 2)).toBeDefined();
    expect(classMemberOf(index, 'Composite', 'notExists', origin, 3)).toBeDefined();
  });

  it('admits a call any declaration of the overload set admits', () => {
    // **An overload set is checked as a set.** `reset()` and `reset(a, b)` together admit zero and two, and one
    // argument is a call neither of them takes.
    expect(classMemberOf(index, 'Composite', 'reset', origin, 0)).toBeDefined();
    expect(classMemberOf(index, 'Composite', 'reset', origin, 2)).toBeDefined();
    expect(classMemberOf(index, 'Composite', 'reset', origin, 1)).toBeUndefined();
  });

  it('refuses nothing it knows nothing about', () => {
    // A class that declares the name with no counted declaration answers exactly as it did before this rule existed.
    const unknown = buildFileTypes([
      declaration('Class', 'Bare', undefined, {}, 1),
      declaration('Method', 'run', 'Bare', {}, 2),
    ]);
    const bare = createClassIndex();
    mergeClassIndex(bare, unknown, '/src/demo/Bare.java');
    expect(classMemberOf(bare, 'Bare', 'run', { file: '/src/demo/Bare.java' }, 7)).toEqual({
      nodeId: 2,
      label: 'Method',
    });
  });
});

// **A package is what a qualified name means.** `java.io.ByteArrayOutputStream` and
// `org.apache.commons.io.output.ByteArrayOutputStream` share a simple name and nothing else, and the checkout holds one
// of them - so a call written on the JDK's type was answered by the checkout's class.
describe('a package-qualified name', () => {
  const OUTPUT = '/src/main/java/org/apache/commons/io/output/ByteArrayOutputStream.java';
  const facts = buildFileTypes([
    declaration('Class', 'ByteArrayOutputStream', undefined, {}, 1),
    declaration('Method', 'writeTo', 'ByteArrayOutputStream', { parameterCount: '1' }, 2),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, facts, OUTPUT);
  const origin = { file: '/src/main/java/org/apache/commons/io/IOUtils.java' };

  it('keeps its package when it is read as a type', () => {
    // **A lowercase qualifier is a package**, which is the convention every language that writes a qualified name
    // follows; `Map.Entry` and `Zod.ZodString` are nested names and keep their last segment.
    expect(simpleTypeName('java.io.ByteArrayOutputStream')).toBe('java.io.ByteArrayOutputStream');
    expect(simpleTypeName('org.apache.commons.io.output.ByteArrayOutputStream')).toBe(
      'org.apache.commons.io.output.ByteArrayOutputStream',
    );
    expect(simpleTypeName('Map.Entry')).toBe('Entry');
    expect(simpleTypeName('Zod.ZodString')).toBe('ZodString');
  });

  it('is answered only by the class that lives in that package', () => {
    expect(
      classMemberOf(index, 'java.io.ByteArrayOutputStream', 'writeTo', origin, 1),
    ).toBeUndefined();
    expect(
      classMemberOf(
        index,
        'org.apache.commons.io.output.ByteArrayOutputStream',
        'writeTo',
        origin,
        1,
      ),
    ).toEqual({ nodeId: 2, label: 'Method' });
  });

  it('is answered by a simple name in the same way it always was', () => {
    expect(classMemberOf(index, 'ByteArrayOutputStream', 'writeTo', origin, 1)).toEqual({
      nodeId: 2,
      label: 'Method',
    });
  });
});

// **An overload is one name and several declarations, and each declares its own parameters.** `Failable.accept` takes a
// `consumer` of ten different types across eleven declarations; filed by name, the ten answers disagree and the name is
// dropped, which is what made every `consumer.accept(…)` in that class unanswerable.
describe('a parameter of an overloaded method', () => {
  const FILE = '/src/demo/Failable.java';
  const facts = buildFileTypes([
    declaration('Class', 'Failable', undefined, {}, 1),
    { ...declaration('Method', 'accept', 'Failable', {}, 2), startLine: 10 },
    { ...declaration('Method', 'accept', 'Failable', {}, 3), startLine: 40 },
    declaration(
      'Variable',
      'consumer',
      undefined,
      { parameterOwner: 'Failable.accept\u000010', parameterType: 'FailableConsumer' },
      4,
    ),
    declaration(
      'Variable',
      'consumer',
      undefined,
      { parameterOwner: 'Failable.accept\u000040', parameterType: 'FailableBiConsumer' },
      5,
    ),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, facts, FILE);
  const at = (owners: readonly string[]): ReceiverLookup => ({
    index,
    origin: { file: FILE },
    owners,
  });

  it('is read from the declaration the call sits inside', () => {
    expect(receiverTypeOf(at(['Failable.accept\u000010']), 'consumer')?.className).toBe(
      'FailableConsumer',
    );
    expect(receiverTypeOf(at(['Failable.accept\u000040']), 'consumer')?.className).toBe(
      'FailableBiConsumer',
    );
  });

  it('answers nothing for a caller that names no declaration', () => {
    // **A name two declarations disagree about is still two answers.** The line is what tells them apart, and a caller
    // that does not state one gets the refusal this module has always given rather than whichever came last.
    expect(receiverTypeOf(at(['Failable.accept']), 'consumer')).toBeUndefined();
  });
});

describe('a receiver that roots at a class, and one that roots at a call', () => {
  const ENUM_FILE = 'src/main/java/org/apache/commons/io/IOCase.java';
  const CALLER_FILE = 'src/main/java/org/apache/commons/io/FilenameUtils.java';

  // **A constant of an enum is of the enum's type, and the language says so without a field declaration.**
  // `IOCase.SYSTEM.checkEquals(…)` names a receiver through a constant that `enum IOCase { SYSTEM(…) }` declares, and
  // before this rule the walk asked `SYSTEM` for a field of `FilenameUtils` and found nothing.
  const enumFacts = buildFileTypes([
    declaration('Enum', 'IOCase', undefined, { fieldTypes: '{"SYSTEM":"IOCase"}' }, 1),
    declaration('Method', 'checkEquals', 'IOCase', {}, 2),
  ]);
  const callerFacts = buildFileTypes([
    declaration('Class', 'FilenameUtils', undefined, {}, 3),
    declaration('Method', 'directoryContains', 'FilenameUtils', {}, 4),
    // **A factory's return type is a nested class of the file that declares it**, which is what `is(a)` answers with.
    declaration('Interface', 'ComparableChecker', undefined, {}, 5),
    declaration('Method', 'greaterThanOrEqualTo', 'ComparableChecker', {}, 6),
    declaration('Class', 'ComparableUtils', undefined, {}, 7),
    declaration('Method', 'is', 'ComparableUtils', { returnType: 'ComparableChecker' }, 8),
    declaration('Method', 'ge', 'ComparableUtils', {}, 9),
    declaration('Method', 'size', 'ComparableUtils', {}, 10),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, enumFacts, ENUM_FILE);
  mergeClassIndex(index, callerFacts, CALLER_FILE);
  const at = (owners: readonly string[], file = CALLER_FILE): ReceiverLookup => ({
    index,
    origin: { file },
    owners,
  });

  it('reads a constant of an enum as a value of the enum', () => {
    // **The walk crosses into the enum's own file**, because that is where the constant's type is written - so the
    // answer says both what the receiver is and where that declaration lives.
    expect(receiverTypeOf(at(['FilenameUtils.directoryContains']), 'IOCase.SYSTEM')).toEqual({
      className: 'IOCase',
      via: 'class',
      declaredIn: ENUM_FILE,
    });
  });

  it('reads a factory call as the type it returns', () => {
    // **`is(a).greaterThanOrEqualTo(b)` is one receiver and two declarations.** The base is a call, and what it hands
    // back is what its declaration says - so the member is looked up in `ComparableChecker` and not in the class the
    // call is written in.
    expect(receiverTypeOf(at(['ComparableUtils.ge']), 'is(a)')).toEqual({
      className: 'ComparableChecker',
      via: 'call',
    });
  });

  it('reads the outer instance a qualified this names', () => {
    // **`Outer.this.m()` is the enclosing instance, and the qualifier is its class.** The nested class writes the
    // qualifier precisely because its own `this` is not what the member belongs to.
    expect(receiverTypeOf(at(['ComparableUtils.ge']), 'ComparableUtils.this')).toEqual({
      className: 'ComparableUtils',
      via: 'class',
    });
  });

  it('answers nothing for a call whose return type nobody wrote', () => {
    // **A factory that states no type hands back nothing this module can read**, and `size` is a method whose
    // declaration writes no return type - so the walk ends rather than guessing the enclosing class.
    expect(receiverTypeOf(at(['ComparableUtils.ge']), 'size()')).toBeUndefined();
    // A qualified this whose qualifier is not a class the index can find is the same refusal.
    expect(receiverTypeOf(at(['ComparableUtils.ge']), 'SomewhereElse.this')).toBeUndefined();
  });
});

describe('a type parameter and the bound it declares', () => {
  const FILE = 'src/main/java/org/apache/commons/io/function/UncheckedIOBaseStream.java';
  const facts = buildFileTypes([
    declaration(
      'Class',
      'UncheckedIOBaseStream',
      undefined,
      // **`S extends IOBaseStream<T, S, B>` says every `S` is an `IOBaseStream`**, which is the whole reason the
      // class can call `delegate.close()` without knowing what it wraps.
      { typeParameters: '{"S":"IOBaseStream<T, S, B>","B":"BaseStream<T, B>"}' },
      1,
    ),
    declaration('Property', 'delegate', 'UncheckedIOBaseStream', { fieldType: 'S' }, 2),
    declaration(
      'Variable',
      'wrapped',
      undefined,
      { parameterOwner: 'UncheckedIOBaseStream.close', parameterType: 'S' },
      3,
    ),
    declaration('Method', 'close', 'UncheckedIOBaseStream', {}, 4),
    // **`interface IOBaseStream<T, S extends IOBaseStream<T, S, B>, B>` writes the same bound in the base**, and a
    // hop's type is read where *its* declaration is written - one class at a time, never the caller's.
    declaration(
      'Interface',
      'IOBaseStream',
      undefined,
      { typeParameters: '{"S":"IOBaseStream<T, S, B>"}' },
      5,
    ),
    declaration('Method', 'close', 'IOBaseStream', {}, 6),
    // **`unwrap()` is declared `S unwrap()`**, so the hop's type is the same parameter the field holds.
    declaration('Method', 'unwrap', 'IOBaseStream', { returnType: 'S' }, 7),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, facts, FILE);
  const at = (owners: readonly string[]): ReceiverLookup => ({
    index,
    origin: { file: FILE },
    owners,
  });

  it('reads a field whose type is a parameter as the type the parameter extends', () => {
    expect(receiverTypeOf(at(['UncheckedIOBaseStream.close']), 'delegate')).toEqual({
      className: 'IOBaseStream',
      via: 'thisField',
    });
  });

  it('reads a parameter whose type is a parameter the same way', () => {
    expect(receiverTypeOf(at(['UncheckedIOBaseStream.close']), 'wrapped')).toEqual({
      className: 'IOBaseStream',
      via: 'parameter',
    });
  });

  it('walks a hop whose type is a parameter', () => {
    // **The bound is read where the type variable was written**, so a hop out of the same field answers with the
    // bound's member rather than with a class named `S`.
    expect(
      receiverTypeOf(at(['UncheckedIOBaseStream.close']), 'delegate.unwrap()')?.className,
    ).toBe('IOBaseStream');
  });

  it('leaves a name that is not a parameter of the declaring class alone', () => {
    // A type parameter is scoped to the class that writes it: `S` outside that class is a class named `S`, and this
    // module does not invent a bound for it.
    expect(receiverTypeOf(at(['ComparableUtils.ge']), 'delegate')).toBeUndefined();
  });
});

// **A cast writes the type where the receiver is, and nothing else does.** `((MutableBoolean) obj).booleanValue()` is
// how `equals` reaches the value of an object it has just tested, and the cast is the only statement of what `obj` is:
// a receiver read as a name finds no binding at all, so five `equals` methods on `apache/commons-lang@3.14.0` answered
// nothing while the type was written two characters to the left of the call.
describe('a receiver written as a cast', () => {
  const FILE = 'src/main/java/org/apache/commons/lang3/mutable/MutableBoolean.java';
  const facts = buildFileTypes([
    declaration('Class', 'MutableBoolean', undefined, {}, 1),
    declaration('Method', 'booleanValue', 'MutableBoolean', {}, 2),
    declaration('Method', 'equals', 'MutableBoolean', { parameterType: 'Object' }, 3),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, facts, FILE);
  const at: ReceiverLookup = { index, origin: { file: FILE }, owners: ['MutableBoolean.equals'] };

  it('reads the type the cast names', () => {
    expect(receiverTypeOf(at, '((MutableBoolean) obj)')).toEqual({
      className: 'MutableBoolean',
      via: 'cast',
    });
  });

  it('reads a cast with one pair of brackets, and a qualified cast', () => {
    expect(receiverTypeOf(at, '(MutableBoolean) value')).toEqual({
      className: 'MutableBoolean',
      via: 'cast',
    });
    // A primitive cast names no class, and a class nobody declared is not one either.
    expect(receiverTypeOf(at, '((long) value)')).toBeUndefined();
    expect(receiverTypeOf(at, '((Absent) value)')).toBeUndefined();
  });

  it('refuses a bracketed expression, which states no type at all', () => {
    // **`(a + b).m()` is arithmetic, not a cast**, and reading the first token as a class name would answer every
    // parenthesised receiver with whatever the graph happens to declare under that spelling.
    expect(receiverTypeOf(at, '((a + b))')).toBeUndefined();
    expect(receiverTypeOf(at, '(value)')).toBeUndefined();
  });
});

// **A call states its own types, and a chain that states them is read in that order.** `AbstractFileFilter` owns
// `accept(File)` and `accept(File, String)`; `IOFileFilter` declares `accept(Path, BasicFileAttributes)` as a default
// method. `preVisitDirectory(Path, BasicFileAttributes)` calls `accept(dir, attributes)`, and an arity-only walk answers
// the class's own two-argument method - an edge javac does not have. The types pick the contract's declaration, and when
// no declaration in the chain states a matching signature the arity answers exactly as it did before, so the rule can
// only add an answer and never withdraw one.
describe('a call is answered by the types it passes', () => {
  const ABSTRACT = 'src/main/java/org/apache/commons/io/filefilter/AbstractFileFilter.java';
  const CONTRACT = 'src/main/java/org/apache/commons/io/filefilter/IOFileFilter.java';
  const abstractFacts = buildFileTypes([
    declaration('Class', 'AbstractFileFilter', undefined, { interfaces: 'IOFileFilter' }, 1),
    declaration(
      'Method',
      'accept',
      'AbstractFileFilter',
      { parameterCount: '1', requiredParameters: '1', parameterTypes: '["File"]' },
      2,
    ),
    declaration(
      'Method',
      'accept',
      'AbstractFileFilter',
      { parameterCount: '2', requiredParameters: '2', parameterTypes: '["File","String"]' },
      3,
    ),
    declaration('Method', 'preVisitDirectory', 'AbstractFileFilter', { parameterCount: '2' }, 4),
  ]);
  const contractFacts = buildFileTypes([
    declaration('Interface', 'IOFileFilter', undefined, {}, 5),
    // **A contract's method is written and not implemented**, and the one that is implemented here is the default.
    declaration(
      'Method',
      'accept',
      'IOFileFilter',
      {
        parameterCount: '2',
        requiredParameters: '2',
        parameterTypes: '["Path","BasicFileAttributes"]',
        hasBody: 'true',
      },
      6,
    ),
  ]);
  const index = createClassIndex();
  mergeClassIndex(index, abstractFacts, ABSTRACT);
  mergeClassIndex(index, contractFacts, CONTRACT);
  const origin = { file: ABSTRACT };

  it('answers the declaration whose parameter types the call passes', () => {
    expect(
      classMemberOf(index, 'AbstractFileFilter', 'accept', origin, 2, [
        'Path',
        'BasicFileAttributes',
      ]),
    ).toEqual({ nodeId: 6, label: 'Method' });
  });

  it('keeps the arity answer when the call states no types', () => {
    // **The old question, asked exactly as before.** A call being edited and a deferred `Type::method` state no types,
    // and an unknown fact is not a refusal.
    expect(classMemberOf(index, 'AbstractFileFilter', 'accept', origin, 2)).toEqual({
      nodeId: 3,
      label: 'Method',
    });
  });

  it('answers the class’s own declaration when that is the one the types fit', () => {
    // The same chain, the same arity, and a different pair of types: the answer is the nearer declaration, because the
    // rule orders the walk and does not prefer a contract.
    expect(
      classMemberOf(index, 'AbstractFileFilter', 'accept', origin, 2, ['File', 'String']),
    ).toEqual({
      nodeId: 3,
      label: 'Method',
    });
  });

  it('withdraws nothing when no declaration in the chain states a matching signature', () => {
    // **A type this reader cannot place is not a refusal of the call.** `Widget` is a name no declaration in the chain
    // writes, so the typed walk finds nothing and the arity answers - which is the answer the graph gave before this
    // rule existed. That is how the rule stays additive.
    expect(
      classMemberOf(index, 'AbstractFileFilter', 'accept', origin, 2, ['Path', 'Widget']),
    ).toEqual({
      nodeId: 3,
      label: 'Method',
    });
  });

  it('reads a parameter of type Object as accepting anything, and prefers the declaration that names the type', () => {
    const facts = buildFileTypes([
      declaration('Class', 'Printer', undefined, {}, 1),
      declaration(
        'Method',
        'print',
        'Printer',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["Object"]' },
        2,
      ),
      declaration(
        'Method',
        'print',
        'Printer',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["File"]' },
        3,
      ),
    ]);
    const only = createClassIndex();
    mergeClassIndex(only, facts, '/src/demo/Printer.java');
    // A `String` argument fits the `Object` declaration alone, and that one answer is the one the call runs.
    expect(
      classMemberOf(only, 'Printer', 'print', { file: '/src/demo/Printer.java' }, 1, ['String']),
    ).toEqual({ nodeId: 2, label: 'Method' });
    // **Both fit a `File` and only one of them is what runs.** `Object` accepts anything; the declaration that names
    // the argument's own type is the more specific one, and specificity is how the language orders two that both fit.
    expect(
      classMemberOf(only, 'Printer', 'print', { file: '/src/demo/Printer.java' }, 1, ['File']),
    ).toEqual({ nodeId: 3, label: 'Method' });
  });

  it('refuses two declarations that fit equally well', () => {
    // **A subclass of two bases that both declare the name is the case specificity cannot order.** Both matches widen,
    // neither names the argument, and picking one would be the coin toss this module refuses.
    const facts = buildFileTypes([
      declaration('Class', 'Widget', undefined, {}, 1),
      declaration('Class', 'File', undefined, {}, 2),
      declaration('Class', 'Both', undefined, { baseClasses: 'Widget,File' }, 3),
      declaration(
        'Method',
        'accept',
        'Widget',
        { parameterCount: '1', parameterTypes: '["Widget"]' },
        4,
      ),
      declaration(
        'Method',
        'accept',
        'File',
        { parameterCount: '1', parameterTypes: '["File"]' },
        5,
      ),
    ]);
    const only = createClassIndex();
    mergeClassIndex(only, facts, '/src/demo/Both.java');
    expect(
      classMemberOf(only, 'Both', 'accept', { file: '/src/demo/Both.java' }, 1, ['Both']),
    ).toBeUndefined();
  });

  it('reads a parameter of a type variable as a parameter of its bound', () => {
    // **`<T> void add(T item)` states no class**, and a call that passes a `Widget` is not refused by that: the
    // declaration cannot say what it does not write.
    const facts = buildFileTypes([
      declaration('Class', 'Bag', undefined, {}, 1),
      declaration(
        'Method',
        'add',
        'Bag',
        {
          parameterCount: '1',
          requiredParameters: '1',
          parameterTypes: '["T"]',
          typeParameters: '',
        },
        2,
      ),
    ]);
    const only = createClassIndex();
    mergeClassIndex(only, facts, '/src/demo/Bag.java');
    expect(
      classMemberOf(only, 'Bag', 'add', { file: '/src/demo/Bag.java' }, 1, ['Widget']),
    ).toEqual({
      nodeId: 2,
      label: 'Method',
    });
  });
});

// **A collection's type argument is the element it hands out, and `forEach` is where it hands it.**
// `List<FileAlterationListener> listeners` beside `listeners.forEach(listener -> …)` is how `commons-io` notifies eight
// listeners, and the lambda's parameter states no type at all - the container does. The two halves of the rule are the
// same fact read from two places: `List<X>` has an element, and a binding written as the element of a path takes it.
describe('the element of a collection, which is the type argument it writes', () => {
  it('reads the one type argument of a container as its element', () => {
    // **The head names the container and the argument names what it holds.** An array is the same fact in another
    // spelling, and `Map<K, V>` is not: two arguments are two elements, and neither of them is what iteration hands out.
    expect(elementTypeName('List<Leaf>')).toBe('Leaf');
    expect(elementTypeName('Iterable<Leaf>')).toBe('Leaf');
    expect(elementTypeName('Collection<Leaf>')).toBe('Leaf');
    expect(elementTypeName('Set<Leaf>')).toBe('Leaf');
    expect(elementTypeName('Deque<Leaf>')).toBe('Leaf');
    expect(elementTypeName('Stream<Leaf>')).toBe('Leaf');
    expect(elementTypeName('Optional<Leaf>')).toBe('Leaf');
    expect(elementTypeName('Leaf[]')).toBe('Leaf');
    expect(elementTypeName('Array<Leaf>')).toBe('Leaf');
    // Two type arguments are a pair, and a container that holds nothing a call can be written on holds no element.
    expect(elementTypeName('Map<String, Leaf>')).toBeUndefined();
    expect(elementTypeName('List<String>')).toBeUndefined();
    expect(elementTypeName('List')).toBeUndefined();
  });

  it('answers a lambda parameter with the element of the collection it is passed to', () => {
    const facts = buildFileTypes([
      declaration(
        'Class',
        'Observer',
        undefined,
        { fieldTypes: '{"listeners":"List<Listener>"}' },
        1,
      ),
      declaration(
        'Method',
        'fire',
        'Observer',
        { localTypes: '{"listener":"@elementOf:listeners"}' },
        2,
      ),
      declaration('Interface', 'Listener', undefined, {}, 3),
      declaration('Method', 'onStart', 'Listener', {}, 4),
    ]);
    const index = createClassIndex();
    mergeClassIndex(index, facts, '/src/demo/Observer.java');
    // **The binding is the lambda's and the type is the field's**, so the walk reports `thisField`: what it answered
    // with is a declaration of the class, reached through the collection the lambda was passed to.
    expect(
      receiverTypeOf(
        { index, origin: { file: '/src/demo/Observer.java' }, owners: ['Observer.fire'] },
        'listener',
      ),
    ).toEqual({ className: 'Listener', via: 'thisField' });
  });
});

describe('a hop names a member of the class or of a base, because that is what a member is', () => {
  it('reads what an inherited getter returns', () => {
    // **`this.getStyle().getNullText()` is how `ReflectionToStringBuilder.toString` reads its style**, and `getStyle`
    // is declared one class up. The hop walk asked only the class the call was written in, so the whole receiver was
    // refused and the edge was missing - the same sentence the call walk is built on, forgotten one hop earlier.
    const facts = buildFileTypes([
      declaration('Class', 'Child', undefined, { baseClasses: 'Base' }, 1),
      declaration('Method', 'read', 'Child', { returnType: 'Style' }, 2),
      declaration('Class', 'Base', undefined, {}, 3),
      declaration('Method', 'getStyle', 'Base', { returnType: 'Style' }, 4),
      declaration('Class', 'Style', undefined, {}, 5),
      declaration('Method', 'getNullText', 'Style', { returnType: 'String' }, 6),
    ]);
    const index = createClassIndex();
    mergeClassIndex(index, facts, '/src/demo/Child.java');
    expect(
      receiverTypeOf(
        { index, origin: { file: '/src/demo/Child.java' }, owners: ['Child.read'] },
        'this.getStyle()',
      ),
    ).toEqual({ className: 'Style', via: 'thisField' });
  });

  it('reads an inherited field, which is the other half of the same walk', () => {
    const facts = buildFileTypes([
      declaration('Class', 'Child', undefined, { baseClasses: 'Base' }, 1),
      declaration('Class', 'Base', undefined, {}, 2),
      declaration('Field', 'delegate', 'Base', { fieldType: 'Engine' }, 3),
      declaration('Class', 'Engine', undefined, {}, 4),
      // **The caller is declared, because the walk starts at the class the call is written in** and only a declaration
      // can say which class that is.
      declaration('Method', 'run', 'Child', { returnType: 'void' }, 5),
    ]);
    const index = createClassIndex();
    mergeClassIndex(index, facts, '/src/demo/Child.java');
    expect(
      receiverTypeOf(
        { index, origin: { file: '/src/demo/Child.java' }, owners: ['Child.run'] },
        'this.delegate',
      ),
    ).toEqual({ className: 'Engine', via: 'thisField' });
  });

  it('does not follow a contract, which declares no body and no field', () => {
    // **`implements` is the clause that promises an implementation**, not the one that carries one - the refusal that
    // took contracts out of the call walk, applied one hop earlier.
    const facts = buildFileTypes([
      declaration('Class', 'Child', undefined, { interfaces: 'Engine' }, 1),
      declaration('Interface', 'Engine', undefined, {}, 2),
      declaration('Method', 'start', 'Engine', { returnType: 'Gear' }, 3),
      declaration('Class', 'Gear', undefined, {}, 4),
      declaration('Method', 'run', 'Child', { returnType: 'void' }, 5),
    ]);
    const index = createClassIndex();
    mergeClassIndex(index, facts, '/src/demo/Child.java');
    expect(
      receiverTypeOf(
        { index, origin: { file: '/src/demo/Child.java' }, owners: ['Child.run'] },
        'this.start()',
      ),
    ).toBeUndefined();
  });
});

describe('a generic factory names its result by naming its argument', () => {
  it('binds the return variable from the argument that fills it', () => {
    // **`<T extends FileVisitor> T visitFileTree(T visitor, Path path)`** states its result twice: as a variable in the
    // return position and as that same variable in the first parameter. `PathUtils.cleanDirectory` then writes
    // `visitFileTree(CountingPathVisitor.withLongCounters(), directory).getPathCounters()` - five edges on
    // `apache/commons-io@2.16.1`, all of them refused because a type variable names no class.
    const facts = buildFileTypes([
      declaration('Class', 'PathUtils', undefined, {}, 1),
      declaration(
        'Method',
        'visitFileTree',
        'PathUtils',
        {
          returnType: 'T',
          parameterCount: '2',
          requiredParameters: '2',
          parameterTypes: '["T","Path"]',
        },
        2,
      ),
      declaration('Class', 'CountingPathVisitor', undefined, {}, 3),
      declaration(
        'Method',
        'withLongCounters',
        'CountingPathVisitor',
        { returnType: 'CountingPathVisitor' },
        4,
      ),
      declaration(
        'Method',
        'getPathCounters',
        'CountingPathVisitor',
        { returnType: 'PathCounters' },
        5,
      ),
      // **The caller is declared**, because the walk starts at the class the call is written in.
      declaration('Method', 'cleanDirectory', 'PathUtils', { returnType: 'PathCounters' }, 6),
    ]);
    const index = createClassIndex();
    mergeClassIndex(index, facts, '/src/demo/PathUtils.java');
    expect(
      receiverTypeOf(
        {
          index,
          origin: { file: '/src/demo/PathUtils.java' },
          owners: ['PathUtils.cleanDirectory'],
        },
        'visitFileTree(CountingPathVisitor.withLongCounters(), directory)',
      ),
    ).toEqual({ className: 'CountingPathVisitor', via: 'call' });
  });

  it('refuses a call whose filling argument states no type', () => {
    // The argument is a name nobody annotated, so the variable has no value here - and a guess would be inherited by
    // every member the receiver is then asked for.
    const facts = buildFileTypes([
      declaration('Class', 'PathUtils', undefined, {}, 1),
      declaration(
        'Method',
        'visitFileTree',
        'PathUtils',
        {
          returnType: 'T',
          parameterCount: '2',
          requiredParameters: '2',
          parameterTypes: '["T","Path"]',
        },
        2,
      ),
      declaration('Class', 'CountingPathVisitor', undefined, {}, 3),
      declaration('Method', 'cleanDirectory', 'PathUtils', { returnType: 'PathCounters' }, 4),
    ]);
    const index = createClassIndex();
    mergeClassIndex(index, facts, '/src/demo/PathUtils.java');
    expect(
      receiverTypeOf(
        {
          index,
          origin: { file: '/src/demo/PathUtils.java' },
          owners: ['PathUtils.cleanDirectory'],
        },
        'visitFileTree(visitor, directory)',
      ),
      // **A variable nobody filled is still the declaration's answer**, and no class of that name exists - so nothing
      // is looked up in it, which is the same refusal one step later rather than a guess dressed as a type.
    ).toEqual({ className: 'T', via: 'call' });
  });

  it('leaves a declaration whose return type names no variable alone', () => {
    const facts = buildFileTypes([
      declaration('Class', 'PathUtils', undefined, {}, 1),
      declaration('Method', 'open', 'PathUtils', { returnType: 'Stream' }, 2),
      declaration('Method', 'cleanDirectory', 'PathUtils', { returnType: 'PathCounters' }, 3),
    ]);
    const index = createClassIndex();
    mergeClassIndex(index, facts, '/src/demo/PathUtils.java');
    expect(
      receiverTypeOf(
        {
          index,
          origin: { file: '/src/demo/PathUtils.java' },
          owners: ['PathUtils.cleanDirectory'],
        },
        'open()',
      ),
    ).toEqual({ className: 'Stream', via: 'call' });
  });
});

describe('the type a functional parameter hands a lambda', () => {
  it('reads the type argument at the position the single abstract method writes', () => {
    // **`forEachObserver(observer -> observer.data(value))`** passes a lambda to a method of the class it is written in,
    // and `forEachObserver` declares `FailableConsumer<Observer, IOException>`. The interface's only abstract method is
    // `accept(T)`, `T` is its first of two type parameters, and `Observer` is what fills it - three edges on
    // `apache/commons-io@2.16.1`, each one a call to `Observer.data` or `Observer.error`.
    const facts = buildFileTypes([
      declaration('Class', 'Observable', undefined, {}, 1),
      declaration(
        'Method',
        'note',
        'Observable',
        { localTypes: '{"observer":"@elementOf:forEachObserver"}' },
        2,
      ),
      declaration(
        'Method',
        'forEachObserver',
        'Observable',
        {
          parameterCount: '1',
          requiredParameters: '1',
          parameterTypes: '["FailableConsumer<Observer, IOException>"]',
        },
        3,
      ),
      declaration(
        'Interface',
        'FailableConsumer',
        undefined,
        { typeParameters: '{"E":"Exception"}', typeParameterNames: '["T","E"]' },
        4,
      ),
      declaration(
        'Method',
        'accept',
        'FailableConsumer',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["T"]' },
        5,
      ),
      declaration('Method', 'andThen', 'FailableConsumer', { hasBody: 'true' }, 6),
      declaration('Interface', 'Observer', undefined, {}, 7),
      declaration('Method', 'data', 'Observer', {}, 8),
    ]);
    // **The local is written against the path the provider records**, which for a bare call is the callee's name.
    const index = createClassIndex();
    mergeClassIndex(index, facts, '/src/demo/Observable.java');
    expect(
      receiverTypeOf(
        { index, origin: { file: '/src/demo/Observable.java' }, owners: ['Observable.note'] },
        'observer',
      ),
    ).toEqual({ className: 'Observer', via: 'parameter' });
  });

  it('refuses an interface with two abstract methods, which no lambda can fill', () => {
    const facts = buildFileTypes([
      declaration('Class', 'Holder', undefined, {}, 1),
      declaration(
        'Method',
        'note',
        'Holder',
        { localTypes: '{"handler":"@elementOf:register"}' },
        2,
      ),
      declaration(
        'Method',
        'register',
        'Holder',
        {
          parameterCount: '1',
          requiredParameters: '1',
          parameterTypes: '["Pair<Listener, Engine>"]',
        },
        3,
      ),
      declaration('Interface', 'Pair', undefined, { typeParameterNames: '["A","B"]' }, 4),
      declaration(
        'Method',
        'first',
        'Pair',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["A"]' },
        5,
      ),
      declaration(
        'Method',
        'second',
        'Pair',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["B"]' },
        6,
      ),
      declaration('Interface', 'Listener', undefined, {}, 7),
    ]);
    const index = createClassIndex();
    mergeClassIndex(index, facts, '/src/demo/Holder.java');
    expect(
      receiverTypeOf(
        { index, origin: { file: '/src/demo/Holder.java' }, owners: ['Holder.note'] },
        'handler',
      ),
    ).toBeUndefined();
  });
});

describe('a path that names no declaration answers nothing', () => {
  it('refuses a lambda element taken from a method the class only inherits', () => {
    // **`forEach(listener -> …)` inside a class that is a list** records the callee's name, and the class declares no
    // `forEach` of its own - the method is `ArrayList`'s. A path is resolved where the declarations are, so the answer
    // is the same nothing the receiver walk gives for a name the file does not hold.
    const facts = buildFileTypes([
      declaration('Class', 'Holder', undefined, {}, 1),
      declaration(
        'Method',
        'fire',
        'Holder',
        { localTypes: '{"listener":"@elementOf:forEach"}' },
        2,
      ),
      declaration('Interface', 'Listener', undefined, {}, 3),
    ]);
    const index = createClassIndex();
    mergeClassIndex(index, facts, '/src/demo/Holder.java');
    expect(
      receiverTypeOf(
        { index, origin: { file: '/src/demo/Holder.java' }, owners: ['Holder.fire'] },
        'listener',
      ),
    ).toBeUndefined();
  });

  it('reads the parameter of a call the class does declare, in whatever order the file lists them', () => {
    // The same path, answered - because the declaration is there.
    const facts = buildFileTypes([
      declaration('Class', 'Holder', undefined, {}, 1),
      declaration(
        'Method',
        'fire',
        'Holder',
        { localTypes: '{"listener":"@elementOf:forEach"}' },
        2,
      ),
      declaration(
        'Method',
        'forEach',
        'Holder',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["Consumer<Listener>"]' },
        3,
      ),
      declaration('Interface', 'Consumer', undefined, { typeParameterNames: '["T"]' }, 4),
      declaration(
        'Method',
        'accept',
        'Consumer',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["T"]' },
        5,
      ),
      declaration('Interface', 'Listener', undefined, {}, 6),
    ]);
    const index = createClassIndex();
    mergeClassIndex(index, facts, '/src/demo/Holder.java');
    expect(
      receiverTypeOf(
        { index, origin: { file: '/src/demo/Holder.java' }, owners: ['Holder.fire'] },
        'listener',
      ),
    ).toEqual({ className: 'Listener', via: 'parameter' });
  });
});

describe('the shapes these rules refuse, stated rather than assumed', () => {
  const build = (facts: TypedDeclaration[], file = '/src/demo/Child.java') => {
    const index = createClassIndex();
    mergeClassIndex(index, buildFileTypes(facts), file);
    return { index, origin: { file }, owners: ['Child.run'] };
  };

  it('ignores a type-parameter list that is not a list of names', () => {
    // **A blob this reader did not write is a fact it does not have.** `typeParameterNames` is written by the provider as
    // a JSON array; anything else names no position, so the functional rule answers nothing rather than guessing one.
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration('Method', 'run', 'Child', { localTypes: '{"handler":"@elementOf:register"}' }, 2),
      declaration(
        'Method',
        'register',
        'Child',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["Pair<A, B>"]' },
        3,
      ),
      declaration('Interface', 'Pair', undefined, { typeParameterNames: '{"A":"B"}' }, 4),
    ]);
    expect(receiverTypeOf(lookup, 'handler')).toBeUndefined();
  });

  it('ignores a parameter list that is not a JSON array, and one that holds a non-string', () => {
    // The same refusal for `parameterTypes`, in the two shapes a blob can take: an object, and a mixed array.
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration(
        'Method',
        'register',
        'Child',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '{"a":1}' },
        2,
      ),
      declaration(
        'Method',
        'other',
        'Child',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '[1,"B"]' },
        3,
      ),
      declaration('Method', 'run', 'Child', { returnType: 'void' }, 4),
    ]);
    expect(classMemberOf(lookup.index, 'Child', 'register', undefined, 1)).toBeDefined();
    expect(classMemberOf(lookup.index, 'Child', 'other', undefined, 1)).toBeDefined();
  });

  it('ignores a parameter count that is not a count', () => {
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration('Method', 'run', 'Child', { parameterCount: '-1' }, 2),
      declaration('Method', 'other', 'Child', { parameterCount: 'many' }, 3),
    ]);
    // A count nobody can read is a fact nobody has, so the name still answers - by the old rule, which knows no better.
    expect(classMemberOf(lookup.index, 'Child', 'run', undefined, 99)).toBeDefined();
    expect(classMemberOf(lookup.index, 'Child', 'other', undefined, 99)).toBeDefined();
  });

  it('names no element for a head that is not in the graph, or that has no type arguments', () => {
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration('Method', 'run', 'Child', { localTypes: '{"a":"@elementOf:widenA"}' }, 2),
      declaration(
        'Method',
        'widenA',
        'Child',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["Predicate<Leaf>"]' },
        3,
      ),
      declaration(
        'Method',
        'widenB',
        'Child',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["Plain"]' },
        4,
      ),
      declaration('Interface', 'Leaf', undefined, {}, 5),
    ]);
    // `Predicate` is a library interface: this reader cannot see its abstract method, so it answers nothing.
    expect(receiverTypeOf(lookup, 'a')).toBeUndefined();
  });

  it('refuses a path whose callee declares no parameter type at all', () => {
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration('Method', 'run', 'Child', { localTypes: '{"a":"@elementOf:act"}' }, 2),
      declaration('Method', 'act', 'Child', {}, 3),
    ]);
    expect(receiverTypeOf(lookup, 'a')).toBeUndefined();
  });

  it('refuses a generic factory whose call states no argument list', () => {
    // `walk` written without brackets is a receiver under edit, and a call this reader cannot read is not one it answers.
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration('Method', 'run', 'Child', { returnType: 'void' }, 2),
      declaration(
        'Method',
        'walk',
        'Child',
        { returnType: 'T', parameterCount: '1', requiredParameters: '1', parameterTypes: '["T"]' },
        3,
      ),
    ]);
    expect(receiverTypeOf(lookup, 'walk')).toBeUndefined();
  });

  it('refuses a generic factory whose call passes nothing', () => {
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration('Method', 'run', 'Child', { returnType: 'void' }, 2),
      declaration(
        'Method',
        'walk',
        'Child',
        { returnType: 'T', parameterCount: '1', requiredParameters: '1', parameterTypes: '["T"]' },
        3,
      ),
    ]);
    // **The declaration's own answer stands, and it names no class** - so nothing is looked up in it, which is the same
    // refusal one step later rather than a guess dressed as a type.
    expect(receiverTypeOf(lookup, 'walk()')).toEqual({ className: 'T', via: 'call' });
  });

  it('stops a hop chain at a member that is declared nowhere in it', () => {
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration('Method', 'run', 'Child', { returnType: 'void' }, 2),
    ]);
    expect(receiverTypeOf(lookup, 'this.missing')).toBeUndefined();
    expect(receiverTypeOf(lookup, 'this.missing()')).toBeUndefined();
  });

  it('refuses a base chain that is not in the graph at all', () => {
    const lookup = build([
      declaration('Class', 'Child', undefined, { baseClasses: 'Absent' }, 1),
      declaration('Method', 'run', 'Child', { returnType: 'void' }, 2),
    ]);
    expect(receiverTypeOf(lookup, 'this.anything')).toBeUndefined();
  });
});

describe('the grammar of a written type, read exactly', () => {
  const build = (facts: TypedDeclaration[], file = '/src/demo/Child.java') => {
    const index = createClassIndex();
    mergeClassIndex(index, buildFileTypes(facts), file);
    return { index, origin: { file }, owners: ['Child.run'] };
  };

  it('names no element for a parameter whose type is not generic at all', () => {
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration('Method', 'run', 'Child', { localTypes: '{"a":"@elementOf:act"}' }, 2),
      declaration(
        'Method',
        'act',
        'Child',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["Plain"]' },
        3,
      ),
    ]);
    expect(receiverTypeOf(lookup, 'a')).toBeUndefined();
  });

  it('names no element for an interface with no type parameters', () => {
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration('Method', 'run', 'Child', { localTypes: '{"a":"@elementOf:act"}' }, 2),
      declaration(
        'Method',
        'act',
        'Child',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["Handler<Leaf>"]' },
        3,
      ),
      declaration('Interface', 'Handler', undefined, {}, 4),
      declaration('Interface', 'Leaf', undefined, {}, 5),
    ]);
    expect(receiverTypeOf(lookup, 'a')).toBeUndefined();
  });

  it('names no element for an interface whose members are not indexed', () => {
    // A declaration with no node id is not a member a call can point at, so the interface's abstract method cannot be
    // read - and a parameter that cannot be read names no position.
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration('Method', 'run', 'Child', { localTypes: '{"a":"@elementOf:act"}' }, 2),
      declaration(
        'Method',
        'act',
        'Child',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["Handler<Leaf>"]' },
        3,
      ),
      declaration('Interface', 'Handler', undefined, { typeParameterNames: '["T"]' }, 4),
      declaration(
        'Method',
        'accept',
        'Handler',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["T"]' },
        5,
      ),
      declaration('Interface', 'Leaf', undefined, {}, 6),
    ]);
    // The abstract method is read and the position is found, so the element is the type argument the call site wrote.
    expect(receiverTypeOf(lookup, 'a')).toEqual({ className: 'Leaf', via: 'parameter' });
  });

  it('answers the first type argument of a call whose declaration fills it at position zero', () => {
    // `Consumer<Leaf>` - one type parameter, one abstract method taking it. The `? super Leaf` spelling is unwrapped,
    // because a wildcard's bound is the type it stands for.
    const lookup = build([
      declaration('Class', 'Child', undefined, {}, 1),
      declaration('Method', 'run', 'Child', { localTypes: '{"a":"@elementOf:act"}' }, 2),
      declaration(
        'Method',
        'act',
        'Child',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["Sink<? super Leaf>"]' },
        3,
      ),
      declaration('Interface', 'Sink', undefined, { typeParameterNames: '["T"]' }, 4),
      declaration(
        'Method',
        'accept',
        'Sink',
        { parameterCount: '1', requiredParameters: '1', parameterTypes: '["T"]' },
        5,
      ),
      declaration('Interface', 'Leaf', undefined, {}, 6),
    ]);
    expect(receiverTypeOf(lookup, 'a')).toEqual({ className: 'Leaf', via: 'parameter' });
  });

  it('stops a base chain that loops rather than walking it forever', () => {
    // **A malformed checkout can write `class A extends B` and `class B extends A`**, and the visited set is what makes
    // that finite rather than a hang. The answer is the member neither declares: nothing.
    const file = '/src/demo/Loop.java';
    const index = createClassIndex();
    mergeClassIndex(
      index,
      buildFileTypes([
        declaration('Class', 'Loop', undefined, { baseClasses: 'Back' }, 1),
        declaration('Class', 'Back', undefined, { baseClasses: 'Loop' }, 2),
        declaration('Method', 'run', 'Loop', { returnType: 'void' }, 3),
      ]),
      file,
    );
    expect(
      receiverTypeOf({ index, origin: { file }, owners: ['Loop.run'] }, 'this.anything'),
    ).toBeUndefined();
  });
});
