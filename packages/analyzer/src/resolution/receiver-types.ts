// @code-analyzer/analyzer — what a receiver *is*, so a call written on it can be resolved.
//
// **A call site writes a receiver and a graph stores a declaration, and until now the resolver only knew the spelling.**
// `self.get(k)` resolves in the enclosing class because `self` is the object itself; `request.args.get(k)` does not,
// because `request` is somebody else's. Two widened rules were measured in iteration 42 and both refused: allowing any
// receiver added 55 edges on flask and 0 were right, and allowing a receiver rooted in the enclosing object added 12
// on werkzeug and 0 were right. What the two cases differ in is not the receiver's spelling but the receiver's
// **type** - `this.index` is a field of type `InvertedIndex` - and that is what this module reads out of a file's
// declarations.
//
// The facts are declared, not inferred: a field with a type annotation, a parameter with one, a method's enclosing
// class. A receiver whose type is not written down reaches nothing here, which is the same discipline the rest of the
// resolver follows - a missing edge is recoverable, a wrong one is inherited by everything downstream.

import type { NodeLabel } from '@code-analyzer/shared';

/** A declaration a name can point at, in the coordinates the resolver uses. */
export interface Declared {
  readonly nodeId: number;
  readonly label: NodeLabel;
}

/**
 * How many arguments a member admits, over every declaration of its name in one class.
 *
 * **Java decides an overload by arity before it looks at a type**, so the count is the part of a signature that needs
 * no type system — and it is the part a name-only resolver is missing. `format(x)` in `CompositeFormat` names the base
 * class's one-parameter method, while the class declares two three-parameter ones; `preVisitDirectory` passes two
 * arguments to a class that declares a one-parameter `accept`. Both were answered by name, and both were wrong.
 *
 * **Three numbers rather than one, because a language can make an argument optional.** A parameter with a default, a
 * TypeScript `?` and a rest parameter are three different statements: the first two lower `required`, the third removes
 * the upper bound. A declaration the walk could not read is absent from the map, and an absent fact is not a refusal -
 * the same rule every other optional fact in this module follows.
 */
export interface DeclaredArity {
  /** How many arguments a call must pass. */
  readonly required: number;
  /** How many parameters the declaration writes. */
  readonly parameters: number;
  /** Whether a call may pass more than `parameters` — `String... parts`, `...rest`, `*args`. */
  readonly variadic: boolean;
}

/** What one file says about the types its declarations have. */
export interface FileTypes {
  /** `Class.field` → the field's declared type, simple name only. */
  readonly fields: Map<string, string>;
  /** `Class.method/parameter` → the parameter's declared type. */
  readonly parameters: Map<string, string>;
  /** `Class.method/name` → the type a local binding was declared, constructed or aliased to. */
  readonly locals: Map<string, string>;
  /**
   * `Class.method` (or a bare function name) → the type its declaration says it returns.
   *
   * **A call in the middle of a receiver is a hop, and what it holds is written on the callee.** The declared types
   * this module already read answer what a *name* holds; nothing answered what an *expression* holds, so
   * `QueueInputStream.builder().get()` and `Archive.store.find(key).next()` ended at the first call. The type is the
   * one the declaration states - not one inferred from the body - for the same reason a field with no annotation is
   * not a fact: a missing edge is recoverable and a wrong one is inherited by everything downstream.
   */
  readonly returns: Map<string, string>;
  /**
   * The same keys as `fields`/`parameters`/`locals`, for the declarations whose annotation is an **array**.
   *
   * **A collection is not its element, and the two are read at different places.** `leaves: Leaf[]` says nothing about
   * `this.leaves.m()` — an array declares no `disconnect` — so the array is refused by `simpleTypeName` and kept
   * separately, for the one construct that removes the container: `for (const leaf of this.leaves)`.
   */
  readonly elements: Map<string, string>;
  /** `Class.method` → the class that holds it, for the `this`/`self` receiver. */
  readonly classOfFunction: Map<string, string>;
  /** `Class` → the class's own declaration. */
  readonly classes: Map<string, Declared>;
  /** `Class` → its members by name. */
  readonly members: Map<string, Map<string, Declared>>;
  /** `Class` → the simple names of the classes it extends, in declaration order. */
  readonly bases: Map<string, readonly string[]>;
  /**
   * `Class\u0000member` → the arity of each declaration the class writes under that name.
   *
   * **A name a class overloads is one name and several signatures**, and the resolver above this one answers by name.
   * This is the fact that lets it ask the second question - does *this* call fit any of them - so a class that
   * declares `format(Object, StringBuffer, FieldPosition)` stops answering a one-argument `format(x)`.
   */
  readonly arity: Map<string, AritySet>;
}

/**
 * The prefix a provider writes in front of a loop variable's *iterable*, so the reader can tell a type from a path.
 *
 * `for (const leaf of this.leaves)` binds `leaf` to no type the syntax names; the type is `this.leaves`' element. The
 * provider records the path it saw, and the reader resolves it against the declarations of the file — which is the same
 * walk a receiver takes, asked one hop earlier.
 */
export const ELEMENT_OF = '@elementOf:';

/**
 * The one declaration shape this module reads.
 *
 * **Structural, so it takes a symbol and nothing else** - which is what lets the test suite state a fact without a
 * parser, and what keeps the phase from having to hand over its graph.
 */
export interface TypedDeclaration {
  readonly name: string;
  readonly kind: NodeLabel;
  readonly containerName?: string;
  readonly properties: Record<string, unknown>;
  /** The graph node, or `undefined` when the declaration has none - a field is not always inserted as one. */
  readonly nodeId?: number;
  /**
   * The line the declaration starts on, which is the second half of its identity.
   *
   * **A name is not a declaration when a class overloads it.** `Failable` declares `accept` eleven times, each with a
   * parameter called `consumer` and a different type for it; filed by name, the eleven answers disagree and the name
   * is refused. The line tells them apart, and a call site inside one of them can name it because the span it sits in
   * is the span of that declaration.
   */
  readonly startLine?: number;
}

/** How a declaration is spelled in the keys that need more than a class and a name. */
export function ownerKeyOf(containerName: string | undefined, name: string): string {
  return containerName === undefined || containerName.length === 0
    ? name
    : `${containerName}.${name}`;
}

/**
 * The class a declaration sits in, read from wherever its language files it.
 *
 * **`containerName` is the graph's answer and it is empty for every Python method.** `def run(self)` inside
 * `class Holder` is emitted as a plain `Function` with no container, so the resolver has read line spans instead since
 * iteration 41 - which is right for deciding scope and useless for naming a class. The provider knows the class
 * syntactically, so it records it as `enclosingClass` on the declaration, and this is the one place that decides which
 * of the two answers a key is built from.
 *
 * A property that is not a non-empty string is not a name, and a declaration nobody filed is a declaration with no
 * class - both answers are `undefined` rather than a guess.
 */
export function containerOf(declaration: {
  readonly containerName?: string;
  readonly properties?: Record<string, unknown>;
}): string | undefined {
  // **`enclosingClass` wins when a provider filed one, because it answers a narrower question.** `containerName` is
  // whatever encloses the declaration - for a closure inside a method that is the method - and a class is what the
  // resolver needs to ask about a member. A provider that files `enclosingClass` has answered "which class" explicitly;
  // one that does not (`TypeScriptProvider` puts the class in `containerName`) is read from `containerName`.
  const filed = declaration.properties?.['enclosingClass'];
  if (typeof filed === 'string' && filed.length > 0) return filed;
  if (typeof declaration.containerName === 'string' && declaration.containerName.length > 0) {
    return declaration.containerName;
  }
  return undefined;
}

/** Types whose members are built into the language, and which are therefore never a class in the graph. */
const PRIMITIVES = new Set([
  'string',
  'number',
  'boolean',
  'any',
  'unknown',
  'void',
  'never',
  'object',
  'symbol',
  'bigint',
  'null',
  'undefined',
  'Array',
  'Map',
  'Set',
  'Promise',
  'Record',
  'Partial',
  'Readonly',
  'Date',
  'RegExp',
  'Error',
  'JSON',
  'Function',
  'Object',
  'String',
  'Number',
  'Boolean',
  // **A Java declaration names seven primitives, and none of them is a class the graph holds.** They reach this list
  // rather than being filtered by the provider, because "what the source says" and "what a call can be written on"
  // are different questions and only the second one belongs to the resolver.
  'byte',
  'short',
  'int',
  'long',
  'float',
  'double',
  'char',
]);

/** Values that occupy a union without being the type of anything a call can be written on. */
const NOTHING: ReadonlySet<string> = new Set([
  'null',
  'undefined',
  'void',
  'never',
  'false',
  'true',
]);

/**
 * A type annotation reduced to the one name the resolver can look up, or `undefined` when it is not a name.
 *
 * **A union of one is not a union.** `condition: Condition | null` and `subscriber: false | SubscriptionSet` are how
 * both of this product's TypeScript corpora spell "absent, or this" - and the code that calls a member on such a field
 * compiles only because a guard narrowed it first. The annotation is what a declaration says; the call site is proof
 * that the narrowing happened, because a member was reached through it. So the members that are *values* rather than
 * types are dropped, and a single survivor is the type. **Two survivors are still two answers** (`Readable | Writable`,
 * `string | Buffer`) and are refused, because picking one is the guess this module exists to avoid.
 *
 * **A generic names its head.** `Deque<CommandItem>` is a `Deque`; the argument says what it holds, not what it is.
 * Stripping the argument list and then consulting the primitive list answers both `Deque<CommandItem>` (a class) and
 * `Map<string, number>` (a builtin that has no declaration to find a member in). An **array** is refused rather than
 * reduced: `Index[]` is "many", and `items.push(…)` written on it is a call on the container, not on `Index`.
 */
export function simpleTypeName(annotation: unknown): string | undefined {
  if (typeof annotation !== 'string') return undefined;
  const text = onlyMemberOf(annotation.trim());
  if (text === undefined) return undefined;
  // **An intersection is not one type** and an optional marker is a `?` that also spells an optional *property* in
  // the same grammars, so one rule cannot serve both meanings.
  if (text.includes('&') || text.endsWith('?')) return undefined;
  const head = headOfGeneric(text);
  if (head.includes('[')) return undefined;
  const segments = head.split(/[.\s:]+/).filter(Boolean);
  const last = segments.pop();
  if (last === undefined || !/^[A-Za-z_$][\w$]*$/.test(last)) return undefined;
  // A primitive has no declaration to find a member in.
  if (PRIMITIVES.has(last)) return undefined;
  // **A package-qualified name keeps its package, because the package is what decides which class it is.**
  // `IOUtils.copy(final java.io.ByteArrayOutputStream outputStream)` writes the JDK's class out in full, and the
  // checkout declares a *different* `ByteArrayOutputStream` in `org.apache.commons.io.output` — so reducing the name to
  // its last segment answered `outputStream.writeTo(…)` with the checkout's class and claimed an edge that runs
  // elsewhere. A qualifier is a package when every segment of it is lowercase, which is a convention rather than a
  // law, and the one every language that writes a qualified name follows: `Map.Entry` and `Zod.ZodString` are nested
  // names and keep the old reading, while `java.io.X` and `org.apache.X` name a package the lookup can check.
  const qualifier = segments;
  if (qualifier.length === 0) return last;
  return qualifier.every((segment) => /^[a-z_][\w$]*$/.test(segment))
    ? `${qualifier.join('.')}.${last}`
    : last;
}

/**
 * The element type of an annotation that names an array, or `undefined` — the one reduction `simpleTypeName` refuses.
 *
 * **`Leaf[]` and `Array<Leaf>` are the same fact in two spellings**, and both are refused as a *type*: `this.leaves` is
 * a collection and a collection declares none of `Leaf`'s members. The element is what a `for…of` binding holds, so the
 * reduction is kept beside the refusal rather than inside it — an array read as its element would answer
 * `this.leaves.disconnect()`, which is the class of defect the receiver arm exists to avoid.
 */
export function elementTypeName(annotation: unknown): string | undefined {
  if (typeof annotation !== 'string') return undefined;
  const text = annotation.trim();
  const braced = /^(?:Readonly<)?(?:Array|ReadonlyArray)<(.+)>$/.exec(text);
  if (braced?.[1] !== undefined) return simpleTypeName(braced[1]);
  return text.endsWith('[]') ? simpleTypeName(text.slice(0, -2)) : undefined;
}

/** The one member of a union that is a type rather than a value, or `undefined` when there is not exactly one. */
function onlyMemberOf(text: string): string | undefined {
  if (text.length === 0) return undefined;
  const parts = splitTopLevel(text, '|').map((part) => part.trim());
  if (parts.length === 1) return parts[0];
  const types = parts.filter((part) => part.length > 0 && !NOTHING.has(part));
  return types.length === 1 ? types[0] : undefined;
}

/** A type name with its generic argument list removed: `Deque<CommandItem>` is a `Deque`. */
function headOfGeneric(text: string): string {
  const open = topLevelIndex(text, '<');
  return open === -1 ? text : text.slice(0, open).trim();
}

/** The index of a character outside every bracket group, or `-1`. */
function topLevelIndex(text: string, wanted: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (depth === 0 && character === wanted) return index;
    if (character === '<' || character === '[' || character === '(') depth++;
    else if (character === '>' || character === ']' || character === ')') depth--;
  }
  return -1;
}

/**
 * The parts of a comma- or pipe-separated list, split where the separator is not inside a bracket group.
 *
 * **`Map<string, number>` is one part and not two**, and a base list `A<X, Y>, B` is two bases and not three. A
 * separator inside an argument list is part of the argument list.
 */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '<' || character === '[' || character === '(') depth++;
    else if (character === '>' || character === ']' || character === ')') depth--;
    else if (character === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Build one file's type facts from its declarations.
 *
 * **Every fact comes from a declared annotation**, which is why a field with no type declares nothing: `this.store`
 * whose type nobody wrote is exactly the case where a resolution would be a guess.
 */
export function buildFileTypes(declarations: readonly TypedDeclaration[]): FileTypes {
  const fields = new Map<string, string>();
  const parameters = new Map<string, string>();
  const locals = new Map<string, string>();
  const returns = new Map<string, string>();
  const elements = new Map<string, string>();
  const classOfFunction = new Map<string, string>();
  const classes = new Map<string, Declared>();
  const members = new Map<string, Map<string, Declared>>();
  const bases = new Map<string, readonly string[]>();
  const arity = new Map<string, AritySet>();

  const declare = (className: string, name: string, declaration: TypedDeclaration): void => {
    if (declaration.nodeId === undefined) return;
    let bucket = members.get(className);
    if (bucket === undefined) {
      bucket = new Map();
      members.set(className, bucket);
    }
    const entry = { nodeId: declaration.nodeId, label: declaration.kind };
    // **A name already refused stays refused.** The third declaration of a name two kinds of declaration claim says
    // nothing about the first two, and resurrecting it would make the answer depend on the order of the walk.
    if (bucket.has(`${name}\u0000ambiguous`)) return;
    const known = bucket.get(name);
    // **Two declarations of one name are one name, and the last one is the one that runs.** `redis/ioredis@5.4.2`
    // declares `info` eleven times on the `RedisCommander` interface and `cluster` forty-two - overload signatures,
    // which are one member with several shapes. Refusing the name meant every `this.info(…)`, `this.cluster(…)`,
    // `this.quit(…)` and `this.readonly(…)` in that checkout resolved to nothing, which is what an overload costs
    // when a resolver treats a spelling as an identity.
    //
    // **Two kinds under one name are still two answers.** A method and a field that share a spelling are different
    // things to read, so the name is dropped rather than one of them being picked - the same refusal, for the same
    // reason, as before.
    if (known !== undefined && known.label !== declaration.kind) {
      bucket.delete(name);
      bucket.set(`${name}\u0000ambiguous`, entry);
      return;
    }
    bucket.set(name, entry);
  };

  for (const declaration of declarations) {
    const container = containerOf(declaration);
    const parameterOwner = declaration.properties['parameterOwner'];
    const parameterType = simpleTypeName(declaration.properties['parameterType']);

    if (
      declaration.kind === 'Class' ||
      declaration.kind === 'Struct' ||
      declaration.kind === 'Interface' ||
      // **An enum is a type, and it declares members.** `JavaVersion` in `apache/commons-lang` is an enum with
      // `atLeast`/`atMost` on it, and `SystemUtils` calls both on a field declared with that type - so leaving enums
      // out of this branch left the class index without a `JavaVersion` at all and the two calls unresolvable, for
      // no reason the language states. A Kotlin or TypeScript enum is the same shape.
      declaration.kind === 'Enum'
    ) {
      if (declaration.nodeId !== undefined) {
        // **A type can be written twice, and the class is the half with bodies.** `redis/ioredis@5.4.2` declares
        // `class Redis extends Commander` and, nine hundred lines later, `interface Redis extends Transaction {}` -
        // declaration merging, in the language's own vocabulary. Whichever is written last used to win this map, and
        // the interface always is; the entry a caller reaches should be the one that can hold a member.
        const known = classes.get(declaration.name);
        if (known === undefined || declaration.kind !== 'Interface') {
          classes.set(declaration.name, { nodeId: declaration.nodeId, label: declaration.kind });
        }
      }
      // **A field's type is filed on the class, not as a symbol of its own.** The provider records the annotations it
      // read during its walk and hands them back as one property, so a file of 200 fields adds no 200 nodes and no
      // 200 symbols competing with the functions of the file for a search query.
      for (const [field, annotation] of stringEntriesOf(declaration.properties['fieldTypes'])) {
        const fieldType = simpleTypeName(annotation);
        if (fieldType !== undefined) fields.set(`${declaration.name}.${field}`, fieldType);
        const elementType = elementTypeName(annotation);
        if (elementType !== undefined) {
          elements.set(`${declaration.name}.${field}`, elementType);
        }
      }
      // **A class's bases are how a member it does not declare still belongs to it.** `Flask.__init__` calls
      // `self.add_url_rule(...)`, and `add_url_rule` is declared on `App` in `flask/sansio/app.py` - so a lookup that
      // stops at the class the call is written in answers nothing for the largest single group of inherited calls in
      // any object-oriented codebase. Only a class extends; an interface is a contract with no body to reach.
      //
      // **And the two halves of a merged type contribute to one list, not to two.** The class names `Commander`, the
      // interface names `Transaction`, and replacing the first with the second answered `this.defineCommand(…)` with
      // nothing at all - the members of `Redis` were reachable only if a reader kept both.
      // **A contract is not a base, and `implements` is the clause that proves it.** The provider records the
      // interfaces a class names - Java's `super_interfaces`, TypeScript's `implements_clause` - and reading them as
      // bases looked like free recall: `class Command implements Respondable` would let a call find the contract's
      // members. Measured on `redis/ioredis@5.4.2`, it cost **seven wrong edges and earned none**: `this.reject(err)`
      // inside `Command` resolved to `types.ts|reject`, the abstract declaration, when the member that runs is the
      // field on the class. An interface declares no body to reach, so a call that lands on one lands nowhere -
      // the walk reads `extends` alone, which is the one clause that carries an implementation.
      const inherited = baseNamesOf(declaration.properties['baseClasses']);
      if (inherited.length > 0) {
        const known = bases.get(declaration.name) ?? [];
        const merged = [...known, ...inherited.filter((base) => !known.includes(base))];
        bases.set(declaration.name, merged);
      }
      continue;
    }

    // **A parameter belongs to the function that declares it, and it is filed under that function's key** - whether
    // the function is a method of a class or stands at module level, which is the only difference between the two
    // blocks below.
    if (typeof parameterOwner === 'string' && parameterType !== undefined) {
      // **An overload is one name and two signatures, so two parameters of one name can be two types.** A call site
      // names `Class.method` and nothing more, so a map keyed by it cannot say which overload's `builder` a receiver
      // is - and letting the later declaration win answered with `StringBuilder` for a receiver declared
      // `StrBuilder`, on the strength of the order of the walk. Two types are two answers, and the name is dropped;
      // the two declarations agreeing is one fact and stays.
      const parameterKey = `${parameterOwner}\u0000${declaration.name}`;
      const knownParameter = parameters.get(parameterKey);
      if (knownParameter === undefined) parameters.set(parameterKey, parameterType);
      else if (knownParameter !== parameterType) parameters.delete(parameterKey);
    }
    if (typeof parameterOwner === 'string') {
      const elementType = elementTypeName(declaration.properties['parameterType']);
      if (elementType !== undefined) {
        elements.set(`${parameterOwner}\u0000${declaration.name}`, elementType);
      }
    }

    const callable =
      declaration.kind === 'Method' ||
      declaration.kind === 'Constructor' ||
      declaration.kind === 'Function';

    // **A local is filed under the function that declares it**, which is the same key a parameter is filed under - so
    // the walk that answers `self.m()` and the walk that answers `_this.m()` ask one question of one place. Filed
    // before the container is required, because a module-level function has no container and declares locals all the
    // same: `connect()` at the top of a file is where ioredis keeps `_this`.
    if (callable) {
      const ownerKey = declarationKeyOf(
        ownerKeyOf(container, declaration.name),
        declaration.startLine,
      );
      // **What the declaration says it returns, in the same key space a call site can build.** `void` and an
      // unannotated declaration state no type a member can be looked up in, and `simpleTypeName` refuses both.
      const declaredReturn = simpleTypeName(declaration.properties['returnType']);
      if (declaredReturn !== undefined) {
        returns.set(ownerKeyOf(container, declaration.name), declaredReturn);
      }
      for (const [name, type] of stringEntriesOf(declaration.properties['localTypes'])) {
        // **A loop binding records the iterable, not a type**, and the path is kept verbatim for the reader to resolve:
        // reducing it here would file the *last segment* of `this.leaves` as though it were a class.
        if (type.startsWith(ELEMENT_OF)) {
          locals.set(`${ownerKey}\u0000${name}`, type);
          continue;
        }
        const localType = simpleTypeName(type);
        if (localType !== undefined) locals.set(`${ownerKey}\u0000${name}`, localType);
        const elementType = elementTypeName(type);
        if (elementType !== undefined) elements.set(`${ownerKey}\u0000${name}`, elementType);
      }
    }

    if (container === undefined || container.length === 0) continue;

    if (callable) {
      classOfFunction.set(ownerKeyOf(container, declaration.name), container);
      declare(container, declaration.name, declaration);
      recordArity(arity, container, declaration);
      continue;
    }

    const fieldType = simpleTypeName(declaration.properties['fieldType']);
    if (fieldType !== undefined) fields.set(`${container}.${declaration.name}`, fieldType);
  }

  return {
    fields,
    parameters,
    locals,
    elements,
    returns,
    classOfFunction,
    classes,
    members,
    bases,
    arity,
  };
}

/**
 * A declaration's identity: its name, and the line it starts on when the caller knows it.
 *
 * **A name alone is an identity only where a class does not overload it.** `Failable.accept` is eleven declarations
 * that all take a parameter called `consumer`, and `ObjectUtils.identityToString` is two that take a `builder` of two
 * different types - so a map keyed by name has to choose between answering with one declaration's fact and refusing
 * both, and iteration 58 chose refusal. The line is what a call site can compare against, because the call sits inside
 * exactly one of them.
 */
function declarationKeyOf(ownerKey: string, startLine: number | undefined): string {
  return startLine === undefined ? ownerKey : `${ownerKey}\u0000${startLine}`;
}

/** The name half of a declaration key, which is what a caller who only knows the name can build. */
function nameKeyOf(declarationKey: string): string {
  const cut = declarationKey.indexOf('\u0000');
  return cut === -1 ? declarationKey : declarationKey.slice(0, cut);
}

/**
 * File one declaration's arity, **merged with every other declaration of the same name in the same class**.
 *
 * **An overload set admits a call if any of its members does.** `f()` and `f(a, b)` together admit zero, one and two
 * arguments only if a two-parameter declaration exists; the set is what the call is checked against, not whichever
 * declaration the walk happened to read last.
 */
function recordArity(
  arity: Map<string, AritySet>,
  container: string,
  declaration: TypedDeclaration,
): void {
  mergeArity(arity, `${container}\u0000${declaration.name}`, declaration);
}

/** Add one declaration's arity to the set filed under a key. */
function mergeArity(
  arity: Map<string, AritySet>,
  key: string,
  declaration: TypedDeclaration,
): void {
  const written = countOf(declaration.properties['parameterCount']);
  if (written === undefined) return;
  // **A declaration that counts its parameters and not its required ones requires all of them.** The two are written
  // together by every provider that writes either; a fact that states one alone is stating the stricter reading.
  const required = countOf(declaration.properties['requiredParameters']) ?? written;
  arity.set(key, [
    ...(arity.get(key) ?? []),
    {
      parameters: written,
      required,
      variadic: declaration.properties['variadic'] === 'true',
    },
  ]);
}

/**
 * What one file's declarations of a name admit, **whoever in the file declares them**.
 *
 * **The name-based arms ask the file, so the answer has to be the file's.** A same-file arm resolves `format` to a
 * declaration the file holds without asking which class holds it, and the arity of that answer is the only thing that
 * can say whether the call fits: `CompositeFormat.reformat` writes `format(parseObject(input))`, the file declares
 * `format` with three parameters, and the call that runs is the base class's one-parameter method.
 *
 * **Merged across the file rather than per class, because the arm being checked is file-scoped.** The merge can only
 * make the set admit more than one class would, which is the conservative direction: it refuses a claim only when
 * nothing in the file could be running.
 */
export function fileArityOf(declarations: readonly TypedDeclaration[]): Map<string, AritySet> {
  const arity = new Map<string, AritySet>();
  for (const declaration of declarations) {
    if (
      declaration.kind !== 'Method' &&
      declaration.kind !== 'Function' &&
      declaration.kind !== 'Constructor'
    ) {
      continue;
    }
    mergeArity(arity, declaration.name, declaration);
  }
  return arity;
}

/**
 * Everything one class - or one file - declares under a name, as a list of arities.
 *
 * **A set of ranges, and not one range.** `f()` and `f(a, b)` admit zero arguments and two, and *not* one: merging the
 * two into the range `0..2` would admit a call neither declaration takes, which is the shape of an overload set read
 * wrongly. Each declaration is checked on its own and the call is admitted if any of them takes it.
 */
export type AritySet = readonly DeclaredArity[];

/**
 * Whether a declaration set admits a call that passes this many arguments.
 *
 * **An absent fact is not a refusal**, which is the rule every optional fact in this module follows: a name this file
 * declares no countable declaration of - a variable, a class, a function whose grammar states no parameter list -
 * answers exactly as it did before this rule existed.
 */
export function admitsArguments(
  declared: AritySet | undefined,
  argumentCount: number | undefined,
): boolean {
  if (declared === undefined || declared.length === 0 || argumentCount === undefined) return true;
  return declared.some(
    (arity) =>
      argumentCount >= arity.required && (arity.variadic || argumentCount <= arity.parameters),
  );
}

/** A property a provider wrote as a count, or `undefined` when it wrote none. */
function countOf(written: unknown): number | undefined {
  if (typeof written !== 'string') return undefined;
  const parsed = Number.parseInt(written, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * The `name → type` pairs a provider wrote as one JSON blob on a declaration.
 *
 * **One property rather than a symbol per field**, and the measurement behind that is in the provider: 13 891 `Property`
 * nodes cost the search index 0.9894 -> 0.9748 MRR for facts the resolver could already read off the declarations.
 */
function stringEntriesOf(blob: unknown): [string, string][] {
  if (typeof blob !== 'string' || blob.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    // A property that is not the JSON this module wrote is a property this module does not read.
    return [];
  }
  if (parsed === null || typeof parsed !== 'object') return [];
  return Object.entries(parsed as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
}

/**
 * The base classes a class names, as simple names.
 *
 * **A base may carry arguments, and the arguments are not part of the name.** `class Child extends Base<number>` names
 * `Base`; a rule that tested the whole text against an identifier pattern found no such name and recorded **no base at
 * all**, which silently removed the whole inheritance chain behind every generic base in a TypeScript codebase. The
 * separators are read at the top level for the same reason: `extends Mapper<A, B>, Guard` is two bases, not three.
 */
function baseNamesOf(blob: unknown): string[] {
  if (typeof blob !== 'string' || blob.length === 0) return [];
  return splitTopLevel(blob, ',')
    .map((name) => headOfGeneric(name.trim()))
    .filter((name) => SIMPLE_NAME.test(name));
}

/** A receiver written as a construction: `new Name(…)`, with the argument list the only thing after the name. */
const CONSTRUCTED_RECEIVER = /^new\s+((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\s*\([\s\S]*\)$/;

/** A name a class could be filed under: no dots, no generics, no punctuation. */
const SIMPLE_NAME = /^[A-Za-z_$][\w$]*$/;

/** A receiver's type, as far as the declarations can say. */
export interface ReceiverType {
  /** The class whose member the call names. */
  readonly className: string;
  /** Where the walk started, recorded so each shape can be scored on its own. */
  readonly via: 'thisField' | 'parameter' | 'local' | 'class';
  /**
   * The file the type's name was written in, when a hop left the file the call sits in.
   *
   * **A name is written inside a class, and a class is a file.** `UnsynchronizedByteArrayInputStream.builder()`
   * declares its return type as `Builder`, and that is the nested `Builder` of the file that declares `builder` - not
   * whichever `Builder` the whole checkout is ambiguous about. Resolving the name where the call sits answers nothing,
   * and the five calls that follow the factory on `apache/commons-io` were unanswered for it.
   */
  readonly declaredIn?: string;
}

/** Receivers that name the object the call is written inside. `super` is deliberately absent - see below. */
const OWN_SCOPE: ReadonlySet<string> = new Set(['this', 'self', 'cls', '$this']);

/**
 * Everything a receiver is read against: the file that writes it, and every class the graph knows.
 *
 * **Two sources, because two questions are asked.** The base of a receiver is a name written in this file - `this`, a
 * parameter, a local - so its owner keys and its local types come from the file. Every hop after the base names a field
 * of a class that may live anywhere, so a hop is a lookup in the index and the answer is read out of *that* class's
 * file. Keeping the two apart is what lets `this.redis.condition.subscriber.add(...)` cross three files.
 */
export interface ReceiverLookup {
  readonly index: ClassIndex;
  readonly origin?: LookupOrigin;
  /**
   * The functions enclosing the call, **innermost first**.
   *
   * **A list and not a name, because a local is visible to the functions it is nested in.** `const _this = this` in
   * `connect` and `_this.flushQueue(...)` inside a callback in `connect` are the same binding, and a nested *named*
   * function would be a second owner key with the binding still in scope. Walking outward is what a scope does.
   */
  readonly owners: readonly string[];
}

/**
 * The type of the object a call is written on.
 *
 * **A receiver is a base and a path, and every step of it is a declaration that was read.** The base is `this`, a
 * parameter, or a local bound to `new`, to an annotation, or to `this` itself; each hop reads a field of the class the
 * previous hop landed on. `this.redis.condition.subscriber.add(...)` is four declarations deep - a parameter property,
 * a contract's field, a union, a field type - and it is a shape `redis/ioredis` writes eleven times.
 *
 * **A hop with no annotation ends the walk**, and that is the property that makes this a resolver rather than a guess:
 * the arity of a path is the number of facts somebody wrote down.
 *
 * **`super` is refused here on purpose.** The base-chain arm starts its walk at the base because that is what the
 * keyword means; answering `super.x` with the enclosing class would hand the caller the very override it skips.
 */
export function receiverTypeOf(lookup: ReceiverLookup, receiver: string): ReceiverType | undefined {
  // **A receiver may be a construction, and then the type is the one it names.** `new HashCodeBuilder().append(v)` is
  // how the builder idiom is written in every Java codebase, and `new X(…)` states the class twice - once as the thing
  // built and once as what the call is written on. A construction with a body (`new X() { … }`) names an anonymous
  // class with no declaration to point at, so it is refused, and so is the `new` of an incomplete edit.
  const constructed = CONSTRUCTED_RECEIVER.exec(receiver);
  if (constructed?.[1] !== undefined) {
    const className = constructed[1].split('.').pop();
    return className === undefined || !SIMPLE_NAME.test(className)
      ? undefined
      : { className, via: 'local' };
  }
  // **A receiver is split where the dots are not inside brackets.** `Archive.store.find(a.b)` writes one hop that
  // contains a dot, and a splitter that cut at every `.` saw three hops and ended the walk on the second -
  // `find(a` names nothing. The brackets are the grammar's own way of saying "this belongs together".
  const [base, ...hops] = splitReceiver(receiver);
  if (base === undefined || base.length === 0) return undefined;
  const own =
    lookup.origin?.file === undefined ? undefined : lookup.index.files.get(lookup.origin.file);

  const start = startOf(lookup, own, base, hops.length === 0);
  if (start === undefined) return undefined;
  let current = start.className;
  // **The scope a name is read in changes as the walk crosses files.** The first hop is a member of the class the
  // call sits in, so the call site's own file decides; every hop after that reads a member of a class declared
  // elsewhere, so the *declaring* file is the scope the name it returns was written in.
  let scope = lookup.origin;
  for (const hop of hops) {
    // **A hop is a member name or a call on one, and the two are read from the same declarations.** `store` asks the
    // class for a field; `builder()` asks it for a method and takes what that method declares it returns.
    const here: ReceiverLookup = { index: lookup.index, origin: scope, owners: lookup.owners };
    const called = calledNameOf(hop);
    const next =
      called === undefined
        ? declaredFieldOf(here, current, hop)
        : declaredReturnOf(here, current, called);
    if (next === undefined) return undefined;
    const declared = locateClass(lookup.index, current, scope);
    if (declared !== undefined) scope = { ...lookup.origin, file: declared.file };
    current = next;
  }
  return {
    className: current,
    via: start.via,
    ...(scope?.file === lookup.origin?.file || scope?.file === undefined
      ? {}
      : { declaredIn: scope.file }),
  };
}

/** Where a walk starts: the receiver's base resolved against the declarations that spell it. */
function startOf(
  lookup: ReceiverLookup,
  own: FileTypes | undefined,
  base: string,
  bare: boolean,
): ReceiverType | undefined {
  if (OWN_SCOPE.has(base)) {
    const enclosing = firstOf(
      lookup.owners,
      (owner) => own && own.classOfFunction.get(nameKeyOf(owner)),
    );
    if (enclosing !== undefined) {
      // **`this.m()` is the same-file arm's case and not this module's.** What a bare own-scope receiver names is a
      // member of the enclosing class, which is the question that arm already asks of the class chain - with evidence.
      return bare ? undefined : { className: enclosing, via: 'thisField' };
    }
    // **A `self` in a function that belongs to no class**, which is how TypeScript written in the callback style hands
    // an object around: `function connectHandler(self: Redis)`. The parameter's annotation is the only thing that says
    // what `self` is, and it scored 0 of 18 claims for the deleted global-name arm on `redis/ioredis`.
    const parameter = declaredUnder(own?.parameters, lookup.owners, base);
    return parameter === undefined ? undefined : { className: parameter, via: 'parameter' };
  }
  const local = declaredUnder(own?.locals, lookup.owners, base);
  if (local !== undefined) return valueOf(lookup, own, local, 'local');
  const parameter = declaredUnder(own?.parameters, lookup.owners, base);
  if (parameter !== undefined) return valueOf(lookup, own, parameter, 'parameter');
  // **A bare name may also be a field of the class the call is written in**, which is how Java uses a shared constant:
  // `ESCAPE_CSV.translate(writer, input)` writes no `this` because a static member needs none. The lookup comes last
  // because Java's own scoping puts a local and a parameter ahead of a field with the same name, and a rule that
  // preferred the field would answer a call with a declaration the name does not mean.
  const enclosing = firstOf(
    lookup.owners,
    (owner) => own && own.classOfFunction.get(nameKeyOf(owner)),
  );
  const field = enclosing === undefined ? undefined : own?.fields.get(`${enclosing}.${base}`);
  if (field !== undefined) return valueOf(lookup, own, field, 'thisField');
  // **A receiver may be rooted at a class, and then the walk starts at that class.** `QueueInputStream.builder()`
  // asks a class for a static factory; `JavaVersion.CURRENT` asks one for a constant. The lookup comes last because
  // every other reading of the name is narrower - a local, a parameter and a field all shadow a type in the languages
  // this resolves - and it answers nothing for a receiver that is only the class's name, which is a call the arms
  // above have already had their turn at.
  if (bare) return undefined;
  const named = locateClass(lookup.index, base, lookup.origin);
  return named === undefined ? undefined : { className: named.name, via: 'class' };
}

/**
 * The receiver split at the dots that are not inside a bracket group.
 *
 * **`QueueInputStream.builder().setBlockingQueue(q).get()` has one hop and not four.** A splitter that cut at every
 * dot divided `setBlockingQueue(q).get` into `setBlockingQueue(q)`, and the walk ended on a name that is not a member
 * of anything. Every bracket a call, an index or a generic can open is a group the separator cannot cross.
 */
function splitReceiver(receiver: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < receiver.length; index++) {
    const character = receiver[index];
    if (character === '(' || character === '[' || character === '{' || character === '<') depth++;
    else if (character === ')' || character === ']' || character === '}' || character === '>')
      depth--;
    else if (character === '.' && depth === 0) {
      parts.push(receiver.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(receiver.slice(start));
  return parts;
}

/**
 * The member a hop calls, or `undefined` when the hop names one rather than calling it.
 *
 * **`builder()` is a call and `builder` is a field**, and the difference decides which declaration answers. A hop
 * whose parentheses do not close at the end is not a call this resolver can attribute - the receiver of a call being
 * edited - so it answers nothing rather than the segment before the bracket.
 */
function calledNameOf(hop: string): string | undefined {
  const trimmed = hop.trim();
  if (!trimmed.endsWith(')')) return undefined;
  const open = trimmed.indexOf('(');
  if (open <= 0) return undefined;
  const name = trimmed.slice(0, open);
  return SIMPLE_NAME.test(name) ? name : undefined;
}

/**
 * What a recorded value means: a type, or a path whose *element* is the type.
 *
 * **A loop binding is the second shape.** `for (const leaf of this.leaves)` holds no annotation, so the provider wrote
 * the iterable down and the reader resolves it here — `this.leaves` is a field of the enclosing class, `all` is a local
 * or a parameter, and either way the answer is that declaration's element type. A path this rule cannot resolve leaves
 * the variable untyped, which is the same answer a variable with no annotation has always had.
 */
function valueOf(
  lookup: ReceiverLookup,
  own: FileTypes | undefined,
  recorded: string,
  via: ReceiverType['via'],
): ReceiverType | undefined {
  if (!recorded.startsWith(ELEMENT_OF)) return { className: recorded, via };
  return elementOfPath(lookup, own, recorded.slice(ELEMENT_OF.length));
}

/** The element type of the declaration a loop's iterable path names. */
function elementOfPath(
  lookup: ReceiverLookup,
  own: FileTypes | undefined,
  path: string,
): ReceiverType | undefined {
  const [base, ...hops] = path.split('.');
  if (base === undefined || base.length === 0) return undefined;
  if (OWN_SCOPE.has(base)) {
    // `this.leaves` — one field of the enclosing class, and no deeper: a second hop would have to be typed itself, and
    // the loop variable is written at a site that says nothing about it.
    const field = hops.length === 1 ? hops[0] : undefined;
    if (field === undefined) return undefined;
    const enclosing = firstOf(
      lookup.owners,
      (owner) => own && own.classOfFunction.get(nameKeyOf(owner)),
    );
    const element =
      enclosing === undefined ? undefined : own?.elements.get(`${enclosing}.${field}`);
    return element === undefined ? undefined : { className: element, via: 'thisField' };
  }
  if (hops.length > 0) return undefined;
  // A bare name is a local or a parameter, and both are filed under the same owner key - so this is one lookup, and
  // the answer does not have to say which of the two it was: `for (const x of items)` iterates what `items` is.
  const element = declaredUnder(own?.elements, lookup.owners, base);
  return element === undefined ? undefined : { className: element, via: 'local' };
}

/** The first owner key, innermost first, that answers with something other than nothing. */
function firstOf(
  owners: readonly string[],
  ask: (owner: string) => string | undefined,
): string | undefined {
  for (const owner of owners) {
    const answer = ask(owner);
    if (answer !== undefined) return answer;
  }
  return undefined;
}

/** How one `name → type` map is keyed: by the owner that declares it, then by the name. */
function key(owner: string, name: string): string {
  return `${owner}\u0000${name}`;
}

/**
 * The first declaration in the chain that states a type for a name — **the innermost one that does.**
 *
 * **Two keys are tried per owner, and the order between them is the whole rule.** An owner that carries a line is a
 * declaration, and the map a provider filed it in is keyed by that declaration: `Failable.accept\u000012` states a
 * `consumer` of one type and `Failable.accept\u000040` another, and the call site sits inside exactly one of them. The
 * name-keyed entry is the fallback for a provider that files no line - every Python and TypeScript parameter is one -
 * and for a declaration whose fact was written before this key existed.
 */
function declaredUnder(
  map: Map<string, string> | undefined,
  owners: readonly string[],
  name: string,
): string | undefined {
  if (map === undefined) return undefined;
  for (const owner of owners) {
    const exact = map.get(key(owner, name));
    if (exact !== undefined) return exact;
    const bare = map.get(key(nameKeyOf(owner), name));
    if (bare !== undefined) return bare;
  }
  return undefined;
}

/**
 * The type a class declares one of its methods to return, wherever that class lives.
 *
 * **Only the class's own declarations are read, and not its bases'.** A method inherited from a base is the base's
 * declaration, and a walk that followed it would answer with a type the base states for a call the subclass makes -
 * the same distinction the `inherited` arm draws at the call site. A return type nobody wrote is not a fact, which is
 * why an unannotated method ends the walk instead of continuing with a guess.
 */
function declaredReturnOf(
  lookup: ReceiverLookup,
  className: string,
  method: string,
): string | undefined {
  const located = locateClass(lookup.index, className, lookup.origin);
  if (located === undefined) return undefined;
  return lookup.index.files.get(located.file)?.returns.get(`${located.name}.${method}`);
}

/** The type a class declares one of its fields to have, wherever that class lives. */
function declaredFieldOf(
  lookup: ReceiverLookup,
  className: string,
  field: string,
): string | undefined {
  const located = locateClass(lookup.index, className, lookup.origin);
  if (located === undefined) return undefined;
  return lookup.index.files.get(located.file)?.fields.get(`${located.name}.${field}`);
}

/**
 * Every class the graph knows, by simple name **and** by file.
 *
 * **A simple name is not a class.** `flask/app.py` calls `self._find_error_handler(...)`, which `App` declares in
 * `flask/sansio/app.py` - and the same checkout vendors an example that declares another `App`, so an index by simple
 * name alone marks the name ambiguous and refuses every such call. The import is what decides it: the file says which
 * `App` it means, and that statement is evidence in the same sense an import is evidence for a call.
 *
 * **So both answers are kept.** By file, because that is where a class is; by simple name, for the case where the
 * lookup's own file says nothing and exactly one class in the graph carries it. The order is: the file's own classes,
 * then the classes of the files it imports, then the unique global one - and a name two imports both provide is
 * refused, because that is the case with no evidence in it.
 */
export interface ClassIndex {
  /** Simple name → the class that declares it, or `ambiguous` when more than one file does. */
  readonly classes: Map<string, LocatedClass | 'ambiguous'>;
  /** Every file's own type facts, which is where members and bases are read from. */
  readonly files: Map<string, FileTypes>;
}

/** A class, the file that declares it, and the name it is filed under there. */
export interface LocatedClass {
  readonly file: string;
  readonly name: string;
  readonly declared: Declared;
}

/** Where a lookup is written: the file, the files it imports, and the names those imports publish. */
export interface LookupOrigin {
  readonly file?: string;
  readonly imported?: ReadonlySet<string>;
  /**
   * A name this file imports → **the file that finally declares it**, with the import chain already walked.
   *
   * **Stronger evidence than `imported`, and it is the only evidence for a package.** A file that writes
   * `from werkzeug.wrappers import Request` imports `wrappers/__init__.py`, which declares no `Request` at all - it
   * publishes one it imported from `wrappers/request.py`. `imported` can only say "these files are related to this
   * one", and in a checkout that also declares `Request` in `sansio/` that is not enough to pick either. The name is
   * what the import binds, so the name is what the map is keyed by.
   */
  readonly published?: ReadonlyMap<string, string>;
  /**
   * Whether an unqualified name may be answered by the file's **own directory**, which is Java's package rule.
   *
   * **A package is a directory and nothing else**, and the language resolves a simple type name through it before any
   * other file: `Streams.java` calling `Functions.asPredicate(…)` reaches `lang3/Functions.java` although the checkout
   * declares a second `Functions` in `lang3/function/`. The flag is on the origin rather than read from the language
   * here because this module is handed declarations, not files - and because the rule is a *language's*, so a
   * TypeScript lookup must not inherit it.
   */
  readonly packageScope?: boolean;
}

export function createClassIndex(): ClassIndex {
  return { classes: new Map(), files: new Map() };
}

/**
 * The extensions a **stub** is written with: a file that restates a module's types and declares no body.
 *
 * `.pyi` is Python's, and the three TypeScript ones are `.d.ts` plus the pair the compiler introduced with the module
 * system. A stub is not a second module: `pallets/werkzeug@3.0.3` ships one beside almost every file, and both halves
 * declare `class Headers`.
 */
const STUB_SUFFIX = /\.(pyi|d\.ts|d\.mts|d\.cts)$/;

/** The file name, which is the only part of a path the stub rule reads. */
function fileNameOf(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('/') + 1);
}

/** Whether a file is a stub rather than the module it restates. */
function isStubFile(filePath: string): boolean {
  return STUB_SUFFIX.test(fileNameOf(filePath));
}

/**
 * The name a module and its stub share: `headers.py` and `headers.pyi` are both `headers`, and so are `index.d.ts`
 * and `index.mts`.
 */
function stemOf(filePath: string): string {
  const name = fileNameOf(filePath);
  const stub = STUB_SUFFIX.exec(name);
  if (stub !== null) return name.slice(0, stub.index);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

/** The directory a file is in, or the empty string for a path with no separator. */
function directoryOf(filePath: string): string {
  const cut = filePath.lastIndexOf('/');
  return cut === -1 ? '' : filePath.slice(0, cut);
}

/**
 * Whether `stub` is `module`'s stub - **the same directory and the same stem, one a restatement of the other**.
 *
 * **The sibling requirement is the evidence.** A stub is by definition written beside the module it describes, so
 * `src/werkzeug/datastructures/headers.pyi` says something about `…/headers.py` and `vendor/headers.pyi` says nothing
 * about `src/types/headers.py`. Without it, this rule would be "the name in any `.pyi` is weaker than the name in any
 * source file", which merges two unrelated classes and answers a call with a method that does not run.
 */
function isStubOfModule(stub: string, module: string): boolean {
  return (
    isStubFile(stub) &&
    !isStubFile(module) &&
    directoryOf(stub) === directoryOf(module) &&
    stemOf(stub) === stemOf(module)
  );
}

/**
 * Fold one file's classes into the index, **marking a name a second file also declares as ambiguous**.
 *
 * **A stub is the exception, because it is not a second declaration.** `pallets/werkzeug@3.0.3` declares `class
 * Headers` in `datastructures/headers.py` and again in `datastructures/headers.pyi`, and treating those as two classes
 * made **33 class names in that one checkout** unanswerable - so `self.headers.get(...)` in `sansio/response.py` and
 * `sansio/request.py`, whose annotation `headers: Headers` sits four lines above the class, resolved to nothing. The
 * class is the half with bodies, which is the rule `buildFileTypes` already applies to the class-and-interface pair
 * one file can merge under one name; the difference here is only which half is findable from the file name.
 *
 * **Order-independent on purpose.** A directory walk may reach either file first, and a rule that answered only when
 * the module came first would be describing the filesystem rather than the types.
 */
export function mergeClassIndex(index: ClassIndex, types: FileTypes, filePath: string): void {
  index.files.set(filePath, types);
  for (const [className, declared] of types.classes) {
    const known = index.classes.get(className);
    if (known === undefined) {
      index.classes.set(className, { file: filePath, name: className, declared });
      continue;
    }
    // **Two answers already, or the same one twice.** An ambiguous name stays ambiguous and a repeated file changes
    // nothing: both are states this fold has already decided.
    if (known === 'ambiguous' || known.file === filePath) continue;
    // This file is the stub of the class already indexed, so it contributes no class.
    if (isStubOfModule(filePath, known.file)) continue;
    // The class already indexed was the stub, and this file is the module it restates: the body wins.
    if (isStubOfModule(known.file, filePath)) {
      index.classes.set(className, { file: filePath, name: className, declared });
      continue;
    }
    index.classes.set(className, 'ambiguous');
  }
}

/**
 * The class a name means, from where the lookup is written - or `undefined` when the evidence does not decide.
 *
 * **A qualified name is answered only by the class that lives in the package it names.** `java.io.ByteArrayOutputStream`
 * and `org.apache.commons.io.output.ByteArrayOutputStream` are two classes with one simple name, and the checkout holds
 * the second: read as a simple name, the JDK type in `IOUtils.copy`'s signature answered a call that runs elsewhere.
 * The package is checked against the file path, which is where a package is a directory in every language this parses.
 */
function locateClass(
  index: ClassIndex,
  className: string,
  origin: LookupOrigin | undefined,
): LocatedClass | undefined {
  const cut = className.lastIndexOf('.');
  if (cut === -1) return locateSimpleClass(index, className, origin);
  const simple = className.slice(cut + 1);
  const found = locateSimpleClass(index, simple, origin);
  return found !== undefined && declaredInPackage(found.file, className) ? found : undefined;
}

/**
 * Whether a file is the class a package-qualified name states.
 *
 * **The comparison is on the path's tail**, because a checkout's source root is not something this module knows: the
 * file `…/src/main/java/org/apache/commons/io/output/ByteArrayOutputStream.java` is
 * `org.apache.commons.io.output.ByteArrayOutputStream` for any root, and a class that lives elsewhere shares nothing
 * with that name but its last segment.
 */
function declaredInPackage(file: string, qualified: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  const dot = normalized.lastIndexOf('.');
  const stem = dot > normalized.lastIndexOf('/') ? normalized.slice(0, dot) : normalized;
  return stem.endsWith(`/${qualified.split('.').join('/')}`);
}

/** The class a name means when the name is simple — the walk that has always answered this question. */
function locateSimpleClass(
  index: ClassIndex,
  className: string,
  origin: LookupOrigin | undefined,
): LocatedClass | undefined {
  const own = ownClassOf(index, origin?.file, className);
  if (own !== undefined) return own;
  // **The name the file imported, before any file the file imports.** A package publishes a name it does not
  // declare, so the second loop below cannot see it; and the answer here is a statement about *this* name rather than
  // about a neighbourhood, which is why it is asked first.
  const published = ownClassOf(index, origin?.published?.get(className), className);
  if (published !== undefined) return published;
  const imported: LocatedClass[] = [];
  for (const file of origin?.imported ?? []) {
    const found = ownClassOf(index, file, className);
    if (found !== undefined) imported.push(found);
  }
  if (imported.length === 1) return imported[0];
  if (imported.length > 1) return undefined;
  // **The package, which the language reads before any file it does not name.** A Java simple name is resolved in the
  // enclosing type, then a single-type import, then the package the file is written in - and the product had the
  // first two and a whole-graph fallback that refuses a name two files declare, one of which is often the file's own
  // neighbour. Measured on `apache/commons-lang@3.14.0`: 54 construction sites and every `Functions.asPredicate(…)`
  // call were unanswered for want of this step alone.
  if (origin?.packageScope === true) {
    const ownPackage = classInPackageOf(index, origin.file, className);
    if (ownPackage !== undefined) return ownPackage;
  }
  const global = index.classes.get(className);
  return global === undefined || global === 'ambiguous' ? undefined : global;
}

/**
 * The class a name means **inside the directory the calling file sits in**, or `undefined`.
 *
 * **Two files in one directory that both declare the name is the same ambiguity one level down**, and the answer is
 * the same: no answer. A stub is not a second declaration - a `.pyi` beside its module is that module restated - but
 * that rule belongs to the file-name walk in `mergeClassIndex` and this lookup reads a package's classes as they were
 * filed, so a Java package (which has no stubs) is the only caller.
 */
export function classInPackageOf(
  index: ClassIndex,
  file: string | undefined,
  className: string,
): LocatedClass | undefined {
  if (file === undefined) return undefined;
  const directory = directoryOf(file);
  let found: LocatedClass | undefined;
  for (const [path, types] of index.files) {
    if (path === file || directoryOf(path) !== directory) continue;
    const declared = types.classes.get(className);
    if (declared === undefined) continue;
    if (found !== undefined) return undefined;
    found = { file: path, name: className, declared };
  }
  return found;
}

/** The class a file itself declares under a name, or `undefined`. */
function ownClassOf(
  index: ClassIndex,
  file: string | undefined,
  className: string,
): LocatedClass | undefined {
  if (file === undefined) return undefined;
  const declared = index.files.get(file)?.classes.get(className);
  return declared === undefined ? undefined : { file, name: className, declared };
}

/**
 * The class a name denotes from where the lookup is written, or `undefined` when no class carries that name.
 *
 * **A name an import binds may be a type, and a type is not a module.** `apache/commons-lang`'s `ObjectUtils` imports
 * `lang3.stream.Streams` and writes `Streams.of(values).filter(…)`; read as a member of the *module* the import bound,
 * `filter` answered from that class's own file - `Streams.forEach`, `Streams.map`, `Streams.collect` and six more, none
 * of which is what runs, because the receiver is the `Stream` that `of` returned. The question "is this name a class"
 * is the one that separates `Streams` from `z` in `colinhacks/zod`, where `import * as z` binds a module and `z.parse`
 * really is that module's export.
 */
export function classNamed(
  index: ClassIndex,
  className: string,
  origin?: LookupOrigin,
): LocatedClass | undefined {
  return locateClass(index, className, origin);
}

/**
 * The member a class declares under a name, or `undefined` when it declares none, two, or is not found.
 *
 * **`argumentCount` is the call's, and it is what turns a name into a signature.** Omitted, the question is the one
 * this function has always asked - "does the class declare this name" - and a caller that cannot count arguments (a
 * deferred `Type::method`, a splat) gets exactly the old answer.
 */
export function classMemberOf(
  index: ClassIndex,
  className: string,
  memberName: string,
  origin?: LookupOrigin,
  argumentCount?: number,
): Declared | undefined {
  return lookupMember(index, className, memberName, origin, false, argumentCount);
}

/**
 * The member one of a class's bases declares under a name - `super().m()` and `super.m()`.
 *
 * **A `super` call never runs the class's own override**, so starting the walk at the class itself would answer with
 * the very declaration the keyword exists to skip: `def m(self): super().m()` inside `Child` would point at `Child.m`,
 * and a recursive edge would stand where the base's method is what runs.
 */
export function baseMemberOf(
  index: ClassIndex,
  className: string,
  memberName: string,
  origin?: LookupOrigin,
  argumentCount?: number,
): Declared | undefined {
  return lookupMember(index, className, memberName, origin, true, argumentCount);
}

/**
 * The walk itself: the nearest declaration of a name among a class and its bases, breadth first.
 *
 * **The nearest, because a subclass that overrides a base's method is the method the call runs.** Two bases at one
 * distance that both declare it answer nothing - a class with two parents that both declare `run` has no answer at
 * this resolver's disposal, and picking one would be a coin toss written into the graph. The visited set is what makes
 * a malformed cycle finite rather than a hang.
 */
function lookupMember(
  index: ClassIndex,
  className: string,
  memberName: string,
  origin: LookupOrigin | undefined,
  skipOwnClass: boolean,
  argumentCount?: number,
): Declared | undefined {
  const start = locateClass(index, className, origin);
  if (start === undefined) return undefined;
  const visited = new Set<string>();
  /** Take the classes not yet walked, and mark them; a cycle ends here rather than in a hang. */
  const fresh = (candidates: readonly LocatedClass[]): LocatedClass[] =>
    candidates.filter((candidate) => {
      const key = keyOf(candidate);
      if (visited.has(key)) return false;
      visited.add(key);
      return true;
    });
  if (skipOwnClass) visited.add(keyOf(start));
  let frontier = fresh(skipOwnClass ? basesOf(index, start) : [start]);
  while (frontier.length > 0) {
    const answers: Declared[] = [];
    const next: LocatedClass[] = [];
    for (const candidate of frontier) {
      const own = ownMemberOf(index, candidate, memberName, argumentCount);
      if (own !== undefined) answers.push(own);
      next.push(...basesOf(index, candidate));
    }
    if (answers.length === 1) return answers[0];
    if (answers.length > 1) return undefined;
    frontier = fresh(next);
  }
  return undefined;
}

/**
 * Whether a class's declarations of a name admit a call of this arity.
 *
 * **A class that declares the name but none of its signatures does not answer the call, and the walk keeps going.**
 * That is what an overload set means in Java: `Sub` declaring `f(int)` says nothing about `f(1, 2)`, and a `Base` that
 * declares `f(int, int)` is where that call runs. Answering nothing at all would be the other defensible reading, and
 * it is wrong for the same reason the arm above reads bases at all.
 */

/** A class's identity in the walk, which is the file it lives in and the name it is filed under. */
function keyOf(located: LocatedClass): string {
  return `${located.file}\u0000${located.name}`;
}

/** A class's own declaration of a name, with no notion of inheritance. */
function ownMemberOf(
  index: ClassIndex,
  located: LocatedClass,
  memberName: string,
  argumentCount?: number,
): Declared | undefined {
  const file = index.files.get(located.file);
  const bucket = file?.members.get(located.name);
  if (bucket === undefined) return undefined;
  // **The signature is checked before the name is answered**, because a class that declares `format(Object,
  // StringBuffer, FieldPosition)` is not the class a one-argument `format(x)` runs.
  if (!admitsArguments(file?.arity.get(`${located.name}\u0000${memberName}`), argumentCount)) {
    return undefined;
  }
  if (bucket.has(`${memberName}\u0000ambiguous`)) return undefined;
  return bucket.get(memberName);
}

/** A class's bases, as located classes, in declaration order. */
function basesOf(index: ClassIndex, located: LocatedClass): LocatedClass[] {
  const out: LocatedClass[] = [];
  for (const base of index.files.get(located.file)?.bases.get(located.name) ?? []) {
    const found = locateClass(index, base, { file: located.file });
    if (found !== undefined) out.push(found);
  }
  return out;
}
