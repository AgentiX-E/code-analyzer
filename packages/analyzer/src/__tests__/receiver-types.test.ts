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
    expect(simpleTypeName('pkg.Index')).toBe('Index');
    // A protocol or module-qualified name keeps its last segment, which is the name the graph stores.
    expect(simpleTypeName('typing.Protocol')).toBe('Protocol');
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
