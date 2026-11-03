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
  /**
   * The type each parameter writes, in order — `''` where the declaration writes none.
   *
   * **The count narrows an overload set and the types finish it.** `accept(File, String)` and
   * `accept(Path, BasicFileAttributes)` are two parameters each, and both classes answer the name; only the types say
   * which of them `accept(dir, attributes)` runs. Absent when the declaration writes no type at all, so a grammar with
   * no type system (Python) and a declaration with no parameters reach the arity rule exactly as before.
   */
  readonly types?: readonly string[];
  /** The node this declaration is, so a walk that selects by signature can answer with it. */
  readonly nodeId?: number;
  /** What kind of declaration it is, which a selected answer has to report. */
  readonly label?: NodeLabel;
  /**
   * Whether the declaration writes a body.
   *
   * **A signature is checked against a call; it is not the code that runs.** `redis/ioredis@5.4.2` declares
   * `reject` on the `Respondable` contract and holds the function in a *field* of the class that implements it, so a
   * walk that read the contract's unimplemented declaration as the callee claimed **seven wrong edges**. Only a
   * declaration with a body can be the answer when the walk reaches it through inheritance.
   */
  readonly hasBody: boolean;
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
   * `Class.method` → the element of the array its declaration says it returns.
   *
   * **A method may name a container where `returns` expects a type.** `values()` is declared by the language on every
   * enum, and its type is `IOCase[]`: `simpleTypeName` refuses it, correctly, because an array declares none of the
   * element's members — and the element is exactly what a lambda handed one at a time holds. The field map has kept
   * this reduction beside the refusal since iteration 44; the method map now does too.
   */
  readonly elementReturns: Map<string, string>;
  /**
   * `Class.method` → the type variable its declaration writes in place of a return type, when it writes one.
   *
   * **`<T extends PathVisitor> T visitFileTree(T visitor, Path path)` states its result by naming its argument**, and
   * a map of class names cannot hold `T`: it names no class, so `returns` refuses it and five calls in
   * `apache/commons-io`'s `PathUtils` (`cleanDirectory`, `copyDirectory`, `countDirectory`, `countDirectoryAsBigInteger`,
   * `deleteDirectory`) end at `visitFileTree(...)` with nothing to look `getPathCounters` up in. The variable and the
   * parameter that fills it are both written, so the binding is a fact the source states rather than an inference.
   */
  readonly returnVariables: Map<string, string>;
  /**
   * `Class` → every type parameter it declares, **in the order it declares them.**
   *
   * **A position is what a type argument means.** `FailableConsumer<Observer, IOException>` fills `T` with `Observer`
   * and `E` with `IOException`, and which of the two a lambda is handed is decided by where the interface's single
   * abstract method writes its parameter - `accept(T)` writes the first. `typeParameters` holds only the parameters that
   * carry a bound, so it cannot answer that: `T` is unbounded and is the one that matters.
   */
  readonly typeParameterOrder: Map<string, readonly string[]>;
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

  /**
   * The names of the callables this file declares, so a container can be told apart from a class it does not declare.
   *
   * `classOfFunction` answers *the container a function sits in*, and that container is sometimes another function -
   * which is why the walk out of a nested arrow needs to know which names are declarations of this file at all.
   */
  readonly callables: Set<string>;

  /**
   * The declarations that are handed their own `this`, keyed by the owner key a call site builds - every `function`
   * expression in TypeScript and JavaScript.
   *
   * **An arrow keeps `this` and a `function` expression rebinds it**, and the walk out of a receiver stops at the
   * second: `const onSpawn = function () { this.bump() }` calls the member of whatever the call site binds, which is
   * not the enclosing class and is not anything this file can name.
   *
   * **Keyed by declaration and not by name**, because a class may write both spellings under one identifier - the
   * fixture this rule was written against declares an arrow `read` in one method and a function expression `read` in
   * the next, and a set of names answered `rebinds` for both.
   */
  readonly rebindsThis: Set<string>;

  /** The type each alias names, when its right-hand side names one. `type ZodTypeAny = ZodType<…>`. */
  readonly aliases: Map<string, string>;
  /** `Class` → the class's own declaration. */
  readonly classes: Map<string, Declared>;
  /**
   * `Class` → the class that lexically contains it, when one does.
   *
   * **A class written inside a class is written inside a scope.** Java's member lookup starts at the class the code is
   * written in and walks *outward* through the classes that contain it, so `Builder.setDirectory`'s `toPath(file, null)`
   * names `DeferredFileOutputStream`'s private static method — and `FastDateParser.StrategyParser.letterPattern`'s
   * `getStrategy(c, width, calendar)` names `FastDateParser`'s. Neither is a base of the class the call sits in, so the
   * chain walk above cannot reach either, and the call was answered by nothing.
   */
  readonly outerClasses: Map<string, string>;
  /** `Class` → its members by name. */
  readonly members: Map<string, Map<string, Declared>>;
  /** `Class` → the simple names of the classes it extends, in declaration order. */
  readonly bases: Map<string, readonly string[]>;
  /**
   * `Class` → the simple names of the contracts it implements, in declaration order.
   *
   * **A contract is not a base and it is not nothing.** It declares no field and its methods usually hold no code, so
   * reading it as a base claimed seven wrong edges on `redis/ioredis@5.4.2` and earned none; but a contract's
   * **default** method is code, and `IOFileFilter.accept(Path, BasicFileAttributes)` is the method
   * `AbstractFileFilter.preVisitDirectory` runs. The two clauses are kept apart so each walk reads the one it means.
   */
  readonly contracts: Map<string, readonly string[]>;
  /**
   * `Class\u0000member` → the arity of each declaration the class writes under that name.
   *
   * **A name a class overloads is one name and several signatures**, and the resolver above this one answers by name.
   * This is the fact that lets it ask the second question - does *this* call fit any of them - so a class that
   * declares `format(Object, StringBuffer, FieldPosition)` stops answering a one-argument `format(x)`.
   */
  readonly arity: Map<string, AritySet>;
  /**
   * `Class` → the bound each of its type parameters declares, for the ones that declare one.
   *
   * **A type variable names no class, and its bound names the class it may be.** `UncheckedIOBaseStream<T, S extends
   * IOBaseStream<T, S, B>, B>` declares `private final S delegate` and calls `delegate.close()` — the call runs on
   * whatever `S` is, and the one thing the language guarantees is that it is an `IOBaseStream`. Without this fact the
   * resolver asked for a class named `S`: **13 edges in one file** of `apache/commons-io@2.16.1` - every one of them in
   * `UncheckedIOBaseStream`, and none of them on `commons-lang` - and the same shape in every class that hides a
   * wrapper behind a parameter. Measured with the substitution taken back out: `commons-io` reads 1 624 instead of 1 637.
   *
   * **A parameter with no bound is absent** rather than `Object`. The source writes no bound, so there is no
   * declaration for a member to be looked up in - the same refusal a field with no type gets.
   */
  readonly typeParameters: Map<string, ReadonlyMap<string, string>>;
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
 * The prefix a provider writes in front of the member a name is bound to, so the reader can tell a type from an alias.
 *
 * `const stringType = ZodString.create` binds a name to a class's static function; calling the name returns what calling
 * that member returns. Recorded as a path and resolved here for the same reason `ELEMENT_OF` is: the provider that sees
 * the declaration is not the reader that holds the classes.
 */
export const CALLS_OF = '@calls:';

/** The owner key a binding written outside every function is filed under. */
const MODULE_SCOPE_KEY = '';

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
  if (text.endsWith('[]')) return simpleTypeName(text.slice(0, -2));
  // **A collection is a container too, and its one type argument is what iteration hands out.** `List<FileAlterationListener>`
  // is a `List` - which is why `simpleTypeName` answers the head - and the element is the argument, which is the fact
  // `listeners.forEach(listener -> …)` needs. Two arguments are a pair and not an element: nothing iterates a `Map`
  // as its values, so `Map<String, Leaf>` states no element this reader may answer with.
  const generic = /^([A-Za-z_$][\w$]*)\s*<(.+)>$/.exec(text);
  if (generic?.[1] === undefined || generic[2] === undefined) return undefined;
  if (!SINGLE_ARGUMENT_CONTAINERS.has(generic[1])) return undefined;
  return splitTopLevel(generic[2], ',').length === 1 ? simpleTypeName(generic[2]) : undefined;
}

/**
 * The containers that hold one kind of thing, **which is the whole of what "element" means here.**
 *
 * The JDK's own interfaces and the implementations in daily use, plus the two TypeScript spellings the array branch
 * above already answers. A container whose name is not in this list states no element, and a rule that read any
 * `Head<X>` as `X` would answer `Optional<Foo>` - which is not wrong - and `Supplier<Foo>` - which is.
 */
const SINGLE_ARGUMENT_CONTAINERS: ReadonlySet<string> = new Set([
  'Array',
  'ReadonlyArray',
  'Iterable',
  'Iterator',
  'Collection',
  'List',
  'ArrayList',
  'LinkedList',
  'CopyOnWriteArrayList',
  'Set',
  'HashSet',
  'LinkedHashSet',
  'TreeSet',
  'SortedSet',
  'CopyOnWriteArraySet',
  'Deque',
  'ArrayDeque',
  'Queue',
  'PriorityQueue',
  'Stream',
  'BaseStream',
  'Optional',
  'Sequence',
]);

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
  const elementReturns = new Map<string, string>();
  const returnVariables = new Map<string, string>();
  const typeParameterOrder = new Map<string, readonly string[]>();
  const elements = new Map<string, string>();
  const classOfFunction = new Map<string, string>();
  const callables = new Set<string>();
  const rebindsThis = new Set<string>();
  const aliases = new Map<string, string>();
  const classes = new Map<string, Declared>();
  const outerClasses = new Map<string, string>();
  const members = new Map<string, Map<string, Declared>>();
  const bases = new Map<string, readonly string[]>();
  const contracts = new Map<string, readonly string[]>();
  const arity = new Map<string, AritySet>();
  const typeParameters = new Map<string, Map<string, string>>();

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
      // **A class written inside a class is written inside a scope**, and the class that contains it is a fact the
      // provider read off the syntax. Filed here rather than inferred from line spans, because a span says which class
      // a line sits in and not which class *contains* another one.
      const outer = declaration.properties['outerClass'];
      if (typeof outer === 'string' && outer.length > 0) outerClasses.set(declaration.name, outer);
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
      // **`implements` is filed where it is read and not where it is walked.** The clause names the contracts a class
      // promises to satisfy; only the typed walk opens them, because only a signature match can say that a contract's
      // declaration is the code a call runs.
      const implemented = baseNamesOf(declaration.properties['interfaces']);
      if (implemented.length > 0) {
        const known = contracts.get(declaration.name) ?? [];
        contracts.set(declaration.name, [
          ...known,
          ...implemented.filter((contract) => !known.includes(contract)),
        ]);
      }
      // **A type parameter's bound is the class its name stands for.** `S extends IOBaseStream<T, S, B>` is read
      // here as one fact about `UncheckedIOBaseStream`, and applied wherever a member of that class is typed `S` -
      // the field, the parameter and the return alike, because all three write the same variable.
      // **Every parameter, in order**, because a type argument is read by position and an unbounded parameter is still
      // one of the positions.
      const order = declaration.properties['typeParameterNames'];
      if (typeof order === 'string' && order.length > 0) {
        try {
          // **`unknown`, because a blob is not a fact until it is read as one** - the same discipline `parameterTypesOf`
          // applies, so a payload of the wrong shape is refused rather than trusted by its type.
          const parsed: unknown = JSON.parse(order);
          if (
            Array.isArray(parsed) &&
            parsed.every((name): name is string => typeof name === 'string')
          ) {
            typeParameterOrder.set(declaration.name, parsed);
          }
        } catch {
          // A blob this reader did not write is a fact it does not have, and the rule that needs it answers nothing.
        }
      }
      for (const [parameter, bound] of stringEntriesOf(declaration.properties['typeParameters'])) {
        const declaredBound = simpleTypeName(bound);
        if (declaredBound === undefined) continue;
        const known = typeParameters.get(declaration.name);
        if (known === undefined)
          typeParameters.set(declaration.name, new Map([[parameter, declaredBound]]));
        else known.set(parameter, declaredBound);
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
      // **And what it returns may name a container rather than a type.** The element is filed beside the refusal, for
      // the same reason a field's is: `values()` on an enum returns `IOCase[]`, and the lambda `IOCase.forName` hands
      // that array to is handed one `IOCase` at a time.
      const returnElement = elementTypeName(declaration.properties['returnType']);
      if (returnElement !== undefined) {
        elementReturns.set(ownerKeyOf(container, declaration.name), returnElement);
      }
      // **A return type written as one capital letter is a type variable**, which is the convention every Java
      // codebase follows and the one `fitsSignature` already reads the same way. It is kept apart from `returns`
      // because it names no class: what it stands for is decided at the call site, from the argument that fills it.
      const writtenReturn = declaration.properties['returnType'];
      const variable = typeof writtenReturn === 'string' ? writtenReturn.trim() : '';
      if (/^[A-Z]$/.test(variable)) {
        returnVariables.set(ownerKeyOf(container, declaration.name), variable);
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

    // **A binding written outside every function belongs to the file**, and it is read here rather than per owner
    // because a `FileTypes` is one file: `const stringType = ZodString.create` is visible to every declaration in it.
    for (const [name, type] of stringEntriesOf(declaration.properties['moduleLocals'])) {
      locals.set(`${MODULE_SCOPE_KEY}\u0000${name}`, type);
    }

    if (declaration.kind === 'TypeAlias') {
      const names = declaration.properties['aliasOf'];
      if (typeof names === 'string' && names.length > 0) aliases.set(declaration.name, names);
    }

    if (container === undefined || container.length === 0) continue;

    if (callable) {
      classOfFunction.set(ownerKeyOf(container, declaration.name), container);
      callables.add(declaration.name);
      // **`arrow: 'false'` is a statement and an absent property is not.** A provider that files a method writes no
      // `arrow` at all; the two providers that file a function expression write it explicitly, which is what makes
      // this a fact rather than a default.
      if (declaration.properties['arrow'] === 'false') {
        rebindsThis.add(ownerKeyOf(container, declaration.name));
      }
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
    elementReturns,
    returnVariables,
    typeParameterOrder,
    classOfFunction,
    callables,
    rebindsThis,
    aliases,
    classes,
    outerClasses,
    members,
    bases,
    contracts,
    arity,
    typeParameters,
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
  const types = parameterTypesOf(declaration.properties['parameterTypes']);
  arity.set(key, [
    ...(arity.get(key) ?? []),
    {
      parameters: written,
      required,
      variadic: declaration.properties['variadic'] === 'true',
      ...(types === undefined ? {} : { types }),
      ...(declaration.nodeId === undefined ? {} : { nodeId: declaration.nodeId }),
      label: declaration.kind,
      hasBody: declaration.properties['hasBody'] === 'true',
    },
  ]);
}

/**
 * The parameter types a provider wrote as one JSON array, or `undefined` when it wrote none.
 *
 * **Absent and empty are different facts**, which is why this returns `undefined` for anything that is not an array of
 * strings: a declaration that writes `run()` states no type, and an array of the wrong shape is a blob this reader did
 * not write rather than a list it should trust positionally.
 */
function parameterTypesOf(blob: unknown): readonly string[] | undefined {
  if (typeof blob !== 'string' || blob.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const types = parsed.filter((entry): entry is string => typeof entry === 'string');
  return types.length === parsed.length ? types : undefined;
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

/**
 * A qualified `this` — `Outer.this` — with the class it qualifies.
 *
 * **A bare `this` is not a match and must not be one**: it names the object the call sits inside, which is a field of
 * the enclosing class rather than a class, and it is answered by the branches above this rule.
 */
const OUTER_THIS = /^([A-Za-z_$][\w$.]*)\.this$/;

/**
 * A receiver written as a cast — `((MutableBoolean) obj)`, `(java.io.File) value`.
 *
 * **The cast is the only statement of what the value is**, and it sits where the receiver is: `equals` in
 * `apache/commons-lang@3.14.0` reaches `((MutableBoolean) obj).booleanValue()` five times, once per mutable type, and a
 * walk that reads the base as a *name* asks the file for a binding called `((MutableBoolean) obj)` and finds none. The
 * trailing token is what separates a cast from a bracketed expression - `(a + b)` closes and ends - and the expression
 * after it is not read, because the type is all this rule needs.
 */
const CAST_RECEIVER = /^\(+\s*([A-Za-z_$][\w$.]*)\s*(?:<[^<>]*>)?\s*\)+\s*\S/;

/**
 * How many bounds a type name is followed through before the walk gives up.
 *
 * **A bound may itself be a parameter** — `B extends BaseStream<T, B>` — and a cycle is a program the compiler would
 * reject; the limit states that this reader stops rather than that such a program exists.
 */
const MAX_BOUND_STEPS = 4;

/** A receiver's type, as far as the declarations can say. */
export interface ReceiverType {
  /** The class whose member the call names. */
  readonly className: string;
  /** Where the walk started, recorded so each shape can be scored on its own. */
  readonly via: 'thisField' | 'parameter' | 'local' | 'class' | 'call' | 'cast';
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
  // **A receiver may name an *outer* instance, and the qualifier is that instance's class.** `StrBuilder.this.size()`
  // is how an inner class reaches the object it is nested in - its own `this` is a different object - and the qualifier
  // is written precisely because the member does not belong to the inner class. Reading the `.this` as a member name
  // asked `StrBuilder` for a field called `this`; on `apache/commons-lang@3.14.0` that is **14 call sites over 7 edges**
  // in `StrBuilder`'s own reader, every one of them a method the class declares two dozen lines above. Taken back out,
  // `commons-lang` reads 2 206 instead of 2 213 and the `receiverType` arm 416 instead of 430.
  const outer = OUTER_THIS.exec(receiver);
  // **A receiver is split where the dots are not inside brackets.** `Archive.store.find(a.b)` writes one hop that
  // contains a dot, and a splitter that cut at every `.` saw three hops and ended the walk on the second -
  // `find(a` names nothing. The brackets are the grammar's own way of saying "this belongs together".
  const [base, ...hops] = splitReceiver(outer?.[1] ?? receiver);
  if (base === undefined || base.length === 0) return undefined;
  const own =
    lookup.origin?.file === undefined ? undefined : lookup.index.files.get(lookup.origin.file);

  // **A qualified `this` is an instance and not a bare class name**, so the class branch below is allowed to answer it
  // even when the receiver has no hop after it - the distinction that keeps `Index.m()` for the `static` arm.
  const start = startOf(lookup, own, base, hops.length === 0 && outer === null);
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
    // **The binding is asked first, and it is the narrower question.** A declaration whose return type is `T` states
    // its result by naming a parameter, so `T` alone is not an answer: it is a name the *class* may have bound, which
    // is what `returns` holds and what sent `visitFileTree(…)` to `FileVisitor` - a contract that declares no
    // `getPathCounters`. The argument answers it where the class's bound cannot, and `returns` still answers wherever
    // the variable is not filled at the call site.
    const next =
      called === undefined
        ? declaredFieldOf(here, current, hop)
        : (boundReturnOf(here, current, called, hop) ?? declaredReturnOf(here, current, called));
    if (next === undefined) return undefined;
    const declared = locateClass(lookup.index, current, scope);
    if (declared !== undefined) scope = { ...lookup.origin, file: declared.file };
    // **The member was read out of `current`, so a bound written there is what its type means** - the same rule the
    // base of the walk applies, asked one hop later.
    current = concretise(
      scope?.file === undefined ? undefined : lookup.index.files.get(scope.file),
      current,
      next,
    );
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
  // **A cast names a class, and a class the graph does not hold names nothing.** The lookup comes first so that a
  // bracketed expression whose first token happens to spell a class is still read as the expression it is: `(x)` and
  // `(a + b)` fail the pattern, and `((Absent) x)` passes it and finds no class.
  const cast = CAST_RECEIVER.exec(base);
  if (cast?.[1] !== undefined) {
    const named = locateClass(lookup.index, cast[1], lookup.origin);
    if (named !== undefined) return { className: named.name, via: 'cast' };
  }
  if (OWN_SCOPE.has(base)) {
    const enclosing = enclosingClassOf(lookup, own);
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
  const enclosing = enclosingClassOf(lookup, own);
  // **A type written as a parameter is a name whose declaration is a bound.** `S delegate` says `delegate` holds an
  // `S`, and `S extends IOBaseStream` says what an `S` is - so every branch below answers with the bound rather than
  // with a class named `S`, which no file declares and no member can be found in.
  const bounded = (result: ReceiverType | undefined): ReceiverType | undefined =>
    withBound(own, enclosing, result);
  if (local !== undefined) return bounded(valueOf(lookup, own, local, 'local'));
  const parameter = declaredUnder(own?.parameters, lookup.owners, base);
  if (parameter !== undefined) return bounded(valueOf(lookup, own, parameter, 'parameter'));
  // **A bare name may also be a field of the class the call is written in**, which is how Java uses a shared constant:
  // `ESCAPE_CSV.translate(writer, input)` writes no `this` because a static member needs none. The lookup comes last
  // because Java's own scoping puts a local and a parameter ahead of a field with the same name, and a rule that
  // preferred the field would answer a call with a declaration the name does not mean.
  const field = enclosing === undefined ? undefined : fieldInChain(lookup, own, enclosing, base);
  if (field !== undefined) return bounded(valueOf(lookup, own, field, 'thisField'));
  // **A base may be a call, and what the call returns is what the receiver is.** `is(a).greaterThanOrEqualTo(b)`
  // writes a factory call where a name would go, and the member it calls belongs to `ComparableChecker` - the class
  // `is` declares it returns. On `apache/commons-lang@3.14.0` that is **12 edges**: six in `ComparableUtils` (`ge`,
  // `gt`, `le`, `lt`, `between`, `betweenExclusive`), three in `TypeUtils.unrollVariables`, two in
  // `EventCountCircuitBreaker`, two in `StrTokenizer` and one in `StrBuilder.appendln` - the last of them eighteen call
  // sites on one chain. On `commons-io` it is **4**, all of them `PathUtils.sizeOfDirectory*` reading `Counters`.
  //
  // **Only the class the call sits in answers it.** A method inherited from a base is the base's declaration, and a
  // factory read off an unrelated class is a name this walk has no evidence about; both are the refusal this module
  // gives everywhere else rather than a guess.
  const called = calledNameOf(base);
  if (called !== undefined) {
    // **A function that belongs to no class declares what it returns all the same.** `colinhacks/zod` writes its
    // shorthand constructors as module-level arrows - `const ostring = () => stringType().optional()` - and the walk
    // below only asked a *class* what its method returns, so the receiver was refused for want of an enclosing class
    // that has nothing to do with the question. Four of that corpus's missing edges are this one shape.
    //
    // **The file's own declaration answers here and the class walk answers there**, which is the same split every other
    // rule in this module makes: a module-level name is filed by its own spelling, and a member is filed by its class.
    const returned =
      enclosing === undefined
        ? (own?.returns.get(called) ?? aliasReturnOf(lookup, own, called))
        : (boundReturnOf(lookup, enclosing, called, base) ??
          declaredReturnOf(lookup, enclosing, called));
    if (returned !== undefined) return bounded({ className: returned, via: 'call' });
  }
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
 * What type a name holds at this call site - **the fact a call's argument types are built from.**
 *
 * `accept(dir, attributes)` passes two names whose types the calling declaration states, and the walk that decides
 * which `accept` runs needs those types to compare against the parameter types of each candidate. The order is the
 * language's own: a local shadows a parameter, and both shadow a field. A name that states no type answers `undefined`,
 * which is what keeps an untyped call on the arity rule rather than on a guess.
 */
export function declaredTypeNameOf(lookup: ReceiverLookup, name: string): string | undefined {
  const own =
    lookup.origin?.file === undefined ? undefined : lookup.index.files.get(lookup.origin.file);
  const local = declaredUnder(own?.locals, lookup.owners, name);
  if (local !== undefined) return valueOf(lookup, own, local, 'local')?.className;
  const parameter = declaredUnder(own?.parameters, lookup.owners, name);
  if (parameter !== undefined) return valueOf(lookup, own, parameter, 'parameter')?.className;
  const enclosing = enclosingClassOf(lookup, own);
  const field = enclosing === undefined ? undefined : own?.fields.get(`${enclosing}.${name}`);
  return field === undefined ? undefined : valueOf(lookup, own, field, 'thisField')?.className;
}

/**
 * The class a type name stands for once the bound it is declared with has been read.
 *
 * **A type parameter is not a class and its bound is the class it may be.** The loop follows a chain - `S extends
 * IOBaseStream` where the bound is itself a plain name - and it stops at the first name the class does not declare as
 * a parameter, which is what leaves a real class that happens to share a variable's spelling alone.
 */
function concretise(
  file: FileTypes | undefined,
  className: string | undefined,
  typeName: string,
): string {
  if (className === undefined) return typeName;
  let current = typeName;
  for (let step = 0; step < MAX_BOUND_STEPS; step++) {
    const bound = file?.typeParameters.get(className)?.get(current);
    if (bound === undefined || bound === current) break;
    current = bound;
  }
  return current;
}

/** The same substitution, on an answer the walk has already computed. */
function withBound(
  file: FileTypes | undefined,
  className: string | undefined,
  result: ReceiverType | undefined,
): ReceiverType | undefined {
  if (result === undefined) return undefined;
  const concretised = concretise(file, className, result.className);
  return concretised === result.className ? result : { ...result, className: concretised };
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
    const enclosing = enclosingClassOf(lookup, own);
    const element =
      enclosing === undefined ? undefined : own?.elements.get(`${enclosing}.${field}`);
    return element === undefined ? undefined : { className: element, via: 'thisField' };
  }
  if (hops.length > 0) {
    // **One hop may be a call, and what it returns may be an array.** `Stream.of(Color.values())` hands the lambda one
    // element of what `values()` returns, and the declaration says `Color[]` — a container, whose element is the type.
    // The path is read as a chain so the class may be declared in another file, which is where a base's method lives.
    const method = hops.length === 1 ? hops[0] : undefined;
    if (method === undefined) return undefined;
    const element = alongChain(lookup, base, (file, name) =>
      file?.elementReturns.get(`${name}.${method}`),
    );
    return element === undefined ? undefined : { className: element, via: 'call' };
  }
  // A bare name is a local or a parameter, and both are filed under the same owner key - so this is one lookup, and
  // the answer does not have to say which of the two it was: `for (const x of items)` iterates what `items` is.
  const element = declaredUnder(own?.elements, lookup.owners, base);
  if (element !== undefined) return { className: element, via: 'local' };
  // **A field needs no `this`, and Java writes it without one.** `listeners.forEach(listener -> …)` names a field of the
  // enclosing class, which is filed under the class rather than under the method - so the lookup above, keyed by owner,
  // cannot see it. The fallback is the same one the receiver walk makes: a bare name may be a field of the class the
  // call is written in.
  const enclosing = enclosingClassOf(lookup, own);
  const field = enclosing === undefined ? undefined : own?.elements.get(`${enclosing}.${base}`);
  if (field !== undefined) return { className: field, via: 'thisField' };
  // **A path may name the call the lambda was passed to rather than a container.** `forEachObserver(observer -> …)`
  // writes the element on `forEachObserver`'s own parameter - a `FailableConsumer<Observer, IOException>` - and the
  // declaration says which of the interface's type arguments the lambda is handed. The element is the type the
  // functional interface's single abstract method takes, read as a position in the interface's own type parameters:
  // `accept(T)` names `T`, `T` is the interface's first parameter, and the call site fills it with `Observer`.
  for (const declaration of (enclosing === undefined
    ? undefined
    : own?.arity.get(`${enclosing}\u0000${base}`)) ?? []) {
    const written = declaration.types?.[0];
    const consumed = written === undefined ? undefined : consumedTypeOf(lookup.index, written);
    if (consumed !== undefined) return { className: consumed, via: 'parameter' };
  }
  return undefined;
}

/**
 * The type a single-parameter lambda is handed by a functional interface written as `Head<…>`.
 *
 * **The position is the interface's own statement and not a convention.** `FailableConsumer<T, E>` declares
 * `void accept(T)`; the lambda's parameter is whatever `T` was filled with, and `T` is the interface's first type
 * parameter - so the answer is the *n*-th type argument, where *n* is where the abstract method's parameter sits in the
 * interface's type-parameter list. `Comparator<T>` (`compare(T, T)`) needs two and is refused by the lambda rule
 * before this is asked; a `Weird<A, B>` whose only method takes a `B` would be answered with the argument at
 * position one, which is the fact its declaration states.
 *
 * **The interface has to be in the graph**, because that is where its type parameters and its single abstract method
 * are. A library interface - `java.util.function.Predicate` - is not, and answers nothing: the element rule covers the
 * stream calls that use those, and guessing the first type argument for an interface this reader cannot see would be
 * the convention dressed as evidence.
 */
function consumedTypeOf(index: ClassIndex, written: string): string | undefined {
  const open = written.indexOf('<');
  const close = written.lastIndexOf('>');
  if (open <= 0 || close <= open) return undefined;
  const head = simpleTypeName(written.slice(0, open));
  if (head === undefined) return undefined;
  const argumentsOfType = written
    .slice(open + 1, close)
    .split(',')
    .map((argument) => wildcardInnerOf(argument.trim()));
  const located = index.classes.get(head);
  if (located === undefined || located === 'ambiguous') return undefined;
  const file = index.files.get(located.file);
  const variables = file?.typeParameterOrder.get(located.name);
  if (variables === undefined) return undefined;
  const consumed = firstAbstractParameterOf(index, located);
  const position = consumed === undefined ? -1 : variables.indexOf(consumed);
  const answer = position < 0 ? undefined : argumentsOfType[position];
  return answer === undefined ? undefined : simpleTypeName(answer);
}

/**
 * The type variable an interface's single abstract method takes first, or `undefined` when the interface has none or
 * several.
 *
 * **A body is the difference between a signature and code**, which is the same fact the typed walk reads: `accept(T)` on
 * `FailableConsumer` has none and is what a lambda fills, while `andThen`, `nop` and `asConsumer` beside it are written.
 * Two abstract methods make the interface not a functional interface at all, and there is no single parameter to name.
 */
function firstAbstractParameterOf(index: ClassIndex, located: LocatedClass): string | undefined {
  const file = index.files.get(located.file);
  const bucket = file?.members.get(located.name);
  if (bucket === undefined) return undefined;
  const abstracts = [...bucket.keys()].flatMap((name) =>
    (file?.arity.get(`${located.name}\u0000${name}`) ?? []).filter(
      (declaration) => declaration.label === 'Method' && !declaration.hasBody,
    ),
  );
  const only = abstracts.length === 1 ? abstracts[0] : undefined;
  const written = only?.types?.[0];
  return written === undefined ? undefined : signatureName(written);
}

/** The type name a written type argument states, with a wildcard's bound unwrapped: `? super X` is `X`. */
function wildcardInnerOf(argument: string): string {
  const bounded = /^\?\s*(?:super|extends)\s+(.+)$/.exec(argument);
  return bounded?.[1] ?? argument;
}

/**
 * The class a `this` belongs to, walking outward through the scopes that keep it.
 *
 * **A receiver's `this` is answered by the nearest enclosing class, and the owners a call site carries are already the
 * chain.** `ownersOf` lists every declaration whose span holds the call, innermost first, so the container of each one
 * is a step outward: `Holder.deep` is a method whose container is the class, and `deep.outer` is an arrow whose
 * container is that method.
 *
 * **An arrow keeps `this` and a `function` expression rebinds it**, which is the distinction the walk needs and the
 * reason the previous rule stopped at every function alike. `const connectToNext = async () => { this.iterator.next() }`
 * is an instance method in two pieces - `redis/ioredis@v5.4.2` writes it that way twice, and both edges were unanswered
 * - while `function () { this.bump() }` calls the member of whatever the call site bound, which no file states.
 *
 * **A container this file does not declare is answered last, and not first.** `Legacy.prototype.fetchAll = function ()`
 * augments a class that lives elsewhere; the provider named it and nothing in this file contradicts it, so it is the
 * fallback rather than the stop.
 */
function enclosingClassOf(lookup: ReceiverLookup, own: FileTypes | undefined): string | undefined {
  if (own === undefined) return undefined;
  let fallback: string | undefined;
  for (const owner of lookup.owners) {
    // **The owner is the declaration the call is written in**, so the question "does this scope keep `this`" is asked
    // of it before its container is read: a function expression rebinds, and every scope inside it is a different
    // object's.
    if (own.rebindsThis.has(nameKeyOf(owner))) return undefined;
    const container = own.classOfFunction.get(nameKeyOf(owner));
    if (container === undefined) continue;
    if (own.classes.has(container)) return container;
    if (!own.callables.has(container)) {
      fallback ??= container;
      continue;
    }
    if (own.rebindsThis.has(container)) return undefined;
  }
  return fallback;
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
  // **A name written outside every function is visible to every declaration in the file**, which is the last scope
  // the walk reaches and the only one that is the same wherever the call site is.
  return map.get(key(MODULE_SCOPE_KEY, name));
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
  return alongChain(lookup, className, (file, name) => file?.returns.get(`${name}.${method}`));
}

/**
 * What calling a name bound to a member returns - `const stringType = ZodString.create; stringType()`.
 *
 * **The binding is written and the member is a declaration**, so the answer is the member's declared return type read
 * through the same chain a call on the class would use. `colinhacks/zod@3.23.8` writes its whole shorthand constructor
 * family this way: `const stringType = ZodString.create` beside `const ostring = () => stringType().optional()`, and
 * without this hop neither `ostring` nor the thirteen edges its test files write through `z.string()` resolve.
 *
 * **Only a path of exactly two segments is read.** `build().create` and `a.b.create` name a member of a value whose
 * type the binding does not state, and the refusal is the one this module makes everywhere it would have to guess.
 */
function aliasReturnOf(
  lookup: ReceiverLookup,
  own: FileTypes | undefined,
  name: string,
): string | undefined {
  const recorded = declaredUnder(own?.locals, lookup.owners, name);
  if (recorded === undefined || !recorded.startsWith(CALLS_OF)) return undefined;
  const [className, member, ...rest] = recorded.slice(CALLS_OF.length).split('.');
  if (className === undefined || member === undefined || rest.length > 0) return undefined;
  return declaredReturnOf(lookup, className, member);
}

/** The type a class declares one of its fields to have, wherever that class lives. */
function declaredFieldOf(
  lookup: ReceiverLookup,
  className: string,
  field: string,
): string | undefined {
  return alongChain(lookup, className, (file, name) => file?.fields.get(`${name}.${field}`));
}

/**
 * The nearest class in the chain - the class itself, then its bases - that states a fact about one name.
 *
 * **A member a class does not declare is still a member of the class**, which is the same sentence the call walk is
 * built on, and a *hop* was the one place that forgot it. `this.getStyle().getNullText()` is how
 * `ReflectionToStringBuilder.toString` reads the style it was configured with: `getStyle` is declared on
 * `ToStringBuilder`, the class's base, so the first hop found no declaration and the whole receiver was refused -
 * one edge on `apache/commons-lang@3.14.0`, and the same shape at every call written on an inherited getter.
 *
 * **The chain is `extends` alone.** A contract declares no body and no field, so a hop that landed on one would take
 * its return type for the receiver's type while the code that runs is the implementing class's - the refusal that took
 * contracts out of the call walk in the first place, applied to the walk one hop earlier.
 */
function alongChain(
  lookup: ReceiverLookup,
  className: string,
  ask: (file: FileTypes | undefined, name: string) => string | undefined,
): string | undefined {
  const start = locateClass(lookup.index, className, lookup.origin);
  if (start === undefined) return undefined;
  const visited = new Set<string>();
  let frontier: LocatedClass[] = [start];
  while (frontier.length > 0) {
    const next: LocatedClass[] = [];
    for (const located of frontier) {
      const key = `${located.file}\u0000${located.name}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const answer = ask(lookup.index.files.get(located.file), located.name);
      if (answer !== undefined) return answer;
      next.push(...basesOf(lookup.index, located, false));
    }
    frontier = next;
  }
  return undefined;
}

/**
 * The class a call to a generic factory returns, **from the argument that fills its return variable.**
 *
 * `<T extends PathVisitor> T visitFileTree(T visitor, Path path)` names its result by naming its parameter, so the type
 * the call holds is the type it was handed. Both halves are written at the two ends of one declaration: the return
 * type is the variable, one of the parameter types is that same variable, and the call site supplies the value - so the
 * rule is a substitution and nothing more, with no inference and no ranking of candidates.
 *
 * **The argument is read by the same walk that reads any receiver**, which is what makes the rule compose:
 * `visitFileTree(CountingPathVisitor.withLongCounters(), directory)` passes a *call*, and what that call returns is
 * what the outer call returns. A position whose argument states no type leaves the whole answer `undefined`, in the
 * same "unknown is not a refusal, and it is not an answer either" sense the rest of this module keeps.
 */
function boundReturnOf(
  lookup: ReceiverLookup,
  className: string,
  method: string,
  callText: string,
): string | undefined {
  const located = locateClass(lookup.index, className, lookup.origin);
  if (located === undefined) return undefined;
  const file = lookup.index.files.get(located.file);
  const variable = file?.returnVariables.get(`${located.name}.${method}`);
  if (variable === undefined) return undefined;
  const argumentsOf = argumentTextsOf(callText);
  for (const declaration of file?.arity.get(`${located.name}\u0000${method}`) ?? []) {
    const position = (declaration.types ?? []).findIndex(
      (type) => signatureName(type) === variable,
    );
    const argument = position < 0 ? undefined : argumentsOf[position];
    if (argument === undefined) continue;
    const answered = receiverTypeOf(lookup, argument);
    if (answered !== undefined) return answered.className;
  }
  return undefined;
}

/** The arguments a call writes, split where the commas are not inside brackets. */
function argumentTextsOf(callText: string): string[] {
  const open = callText.indexOf('(');
  const close = callText.lastIndexOf(')');
  if (open === -1 || close <= open) return [];
  const inner = callText.slice(open + 1, close);
  if (inner.trim().length === 0) return [];
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < inner.length; index++) {
    const character = inner[index];
    if (character === '(' || character === '[' || character === '{' || character === '<') depth++;
    else if (character === ')' || character === ']' || character === '}' || character === '>')
      depth--;
    else if (character === ',' && depth === 0) {
      parts.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts;
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
  /**
   * A name this file binds to an import → **the module the import names, whether or not it resolved to a file.**
   *
   * **A binding the walk cannot follow still says where the name comes from.** `Tailer.java` writes
   * `import java.io.ByteArrayOutputStream;` and `try (ByteArrayOutputStream lineBuf = new ByteArrayOutputStream(64))`;
   * the checkout declares a *different* `ByteArrayOutputStream` in `org.apache.commons.io.output`, and the whole-graph
   * fallback answered the resource's type with it - three calls claimed into a class this file never names. Java reads
   * a single-type import before the package and before any global name, so a name the checkout cannot produce is a
   * name that lives outside it.
   *
   * **The module rather than a flag, because the answer needs to be checked and not assumed.** The same file that
   * imports a class from outside the checkout also imports one from inside it under a qualified name -
   * `org.apache.commons.io.file.Counters.PathCounters` names a class `Counters.java` *declares*, and no path conversion
   * finds it. A rule that treated every unresolved import as external would have cost **14 correct edges** there, so
   * the resolver checks the class it found against the module the import names.
   */
  readonly bound?: ReadonlyMap<string, string>;
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
  if (found === undefined) return undefined;
  if (declaredInPackage(found.file, className)) return found;
  // **A qualifier in front of an alias is a namespace and not a package.** `import * as z from "../index"` then
  // `a: z.ZodTypeAny` names a member of a namespace, and the test above reads `z` as a package directory because it is
  // lowercase. The two spellings are told apart by what the file wrote: an **alias** is a statement about a name, and a
  // package that declares one is not a thing this index represents - while `java.io.ByteArrayOutputStream` names a
  // class directly, and the refusal there is the one that keeps the checkout's same-named class out of it.
  const aliased = aliasTargetOf(index, simple, origin);
  return aliased === undefined ? undefined : locateSimpleClass(index, aliased, origin, 1);
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
  depth = 0,
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
  // **A name the file imports is a name the file has already decided**, and the two steps below answer it from a
  // neighbourhood instead of from that decision - so whatever they find has to live where the import says.
  // **The package, which the language reads before any file it does not name.** A Java simple name is resolved in the
  // enclosing type, then a single-type import, then the package the file is written in - and the product had the
  // first two and a whole-graph fallback that refuses a name two files declare, one of which is often the file's own
  // neighbour. Measured on `apache/commons-lang@3.14.0`: 54 construction sites and every `Functions.asPredicate(…)`
  // call were unanswered for want of this step alone.
  const found =
    (origin?.packageScope === true ? classInPackageOf(index, origin.file, className) : undefined) ??
    uniqueGlobalClass(index, className);
  if (found !== undefined) {
    const from = origin?.bound?.get(className);
    return from === undefined || declaredUnderModule(found.file, from) ? found : undefined;
  }
  // **A name that declares no class may still be a name for one.** `export type ZodTypeAny = ZodType<any, any, any>`
  // is how `colinhacks/zod@3.23.8` types the parameters of its own test helpers, and `a.nullable().parse(bad)` named a
  // receiver whose type resolved to nothing. The alias is a declaration the file wrote, and following it is one hop the
  // language performs before it looks for a member - not an inference about a shape.
  if (depth >= MAX_ALIAS_HOPS) return undefined;
  const target = aliasTargetOf(index, className, origin);
  return target === undefined ? undefined : locateSimpleClass(index, target, origin, depth + 1);
}

/** The depth an alias chain is followed before it is a cycle, which no declaration of a type reaches. */
const MAX_ALIAS_HOPS = 4;

/**
 * The type an alias names, read where the lookup is written.
 *
 * **The alias is a file's own statement first**, and a name two files alias differently is the ambiguity this module
 * refuses everywhere: a `type T = A` in one file and `type T = B` in another is not one answer.
 */
function aliasTargetOf(
  index: ClassIndex,
  alias: string,
  origin: LookupOrigin | undefined,
): string | undefined {
  const own = origin?.file === undefined ? undefined : index.files.get(origin.file)?.aliases;
  const direct = own?.get(alias);
  if (direct !== undefined) return direct;
  const published = index.files.get(origin?.published?.get(alias) ?? '')?.aliases.get(alias);
  if (published !== undefined) return published;
  let found: string | undefined;
  for (const file of origin?.imported ?? []) {
    const target = index.files.get(file)?.aliases.get(alias);
    if (target === undefined) continue;
    if (found !== undefined && found !== target) return undefined;
    found = target;
  }
  if (found !== undefined) return found;
  let unique: string | undefined;
  for (const file of index.files.values()) {
    const target = file.aliases.get(alias);
    if (target === undefined) continue;
    if (unique !== undefined && unique !== target) return undefined;
    unique = target;
  }
  return unique;
}

/** The one class in the graph filed under a simple name, or nothing when two files declare it. */
function uniqueGlobalClass(index: ClassIndex, className: string): LocatedClass | undefined {
  const global = index.classes.get(className);
  return global === undefined || global === 'ambiguous' ? undefined : global;
}

/**
 * Whether a class lives in the module a qualified name names — **the longest prefix of the name that is a path.**
 *
 * **A qualified import may name a class a file declares rather than a class in a directory of its own.**
 * `org.apache.commons.io.file.Counters.PathCounters` names the nested `PathCounters` of `Counters.java`, and no
 * conversion of the whole name to a path finds that file. So every prefix is tried, longest first, down to two
 * segments: `java.io.ByteArrayOutputStream` matches nothing in a checkout rooted at `org/apache`, and
 * `…/file/Counters` matches `Counters.java`.
 */
function declaredUnderModule(file: string, qualified: string): boolean {
  // **Only a dotted module names a package this can check.** `./parse`, `@scope/pkg` and `flask` are spellings whose
  // meaning is the resolver's import pass, not a path - and a rule that read them as one would refuse every name they
  // bind on the strength of a spelling it cannot interpret.
  if (!/^[\w$]+(\.[\w$]+)+$/.test(qualified)) return true;
  const segments = qualified.split('.');
  for (let cut = segments.length; cut >= 2; cut--) {
    if (declaredInPackage(file, segments.slice(0, cut).join('.'))) return true;
  }
  return false;
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
  argumentTypes?: readonly (string | undefined)[],
): Declared | undefined {
  return lookupMember(index, className, memberName, origin, false, argumentCount, argumentTypes);
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
  argumentTypes?: readonly (string | undefined)[],
): Declared | undefined {
  return lookupMember(index, className, memberName, origin, true, argumentCount, argumentTypes);
}

/**
 * The walk itself: the nearest declaration of a name among a class and its bases, breadth first.
 *
 * **The nearest, because a subclass that overrides a base's method is the method the call runs.** Two bases at one
 * distance that both declare it answer nothing - a class with two parents that both declare `run` has no answer at
 * this resolver's disposal, and picking one would be a coin toss written into the graph. The visited set is what makes
 * a malformed cycle finite rather than a hang.
 *
 * **And the walk is taken twice when the call states its types.** The first pass reads the chain a class *is* - its
 * bases and the contracts it implements - and answers only a declaration whose parameter types the call can fill; the
 * second reads the chain a class *extends* and answers by arity, exactly as it did before types existed. The order is
 * what makes the rule additive: a signature the chain cannot state falls back to the count, so the typed pass can add an
 * answer and can never withdraw one. `AbstractFileFilter.preVisitDirectory` passes `(Path, BasicFileAttributes)` to
 * `accept`, the class declares `accept(File, String)` and `IOFileFilter` declares `accept(Path, BasicFileAttributes)` -
 * one answer with the types, one wrong one without them.
 */
function lookupMember(
  index: ClassIndex,
  className: string,
  memberName: string,
  origin: LookupOrigin | undefined,
  skipOwnClass: boolean,
  argumentCount?: number,
  argumentTypes?: readonly (string | undefined)[],
): Declared | undefined {
  const start = locateClass(index, className, origin);
  if (start === undefined) return undefined;
  if (argumentTypes !== undefined && argumentTypes.length > 0) {
    const typed = walk(index, start, memberName, skipOwnClass, { argumentTypes });
    // **A tie between two declarations the arguments both fit is a gap in this reader's evidence, not a property of
    // the program** - Java would refuse to compile such a call, so a tie here means the types it could read did not
    // separate them. The count answers, exactly as it did before types existed, and the typed pass keeps its promise:
    // it adds an answer and never withdraws one. The walk stops at the tie rather than reading a base the nearer
    // distance has already ruled on.
    if (typed.answer !== undefined) return typed.answer;
  }
  return walk(index, start, memberName, skipOwnClass, { argumentCount }).answer;
}

/** What one pass found: an answer, or the fact that two declarations at one distance both fit. */
interface WalkResult {
  readonly answer?: Declared;
  readonly ambiguous: boolean;
}

/** A class's identity in the walk, which is the file it lives in and the name it is filed under. */
function keyOf(located: LocatedClass): string {
  return `${located.file}\u0000${located.name}`;
}

/** One breadth-first pass over the chain, answering at the nearest distance that holds exactly one declaration. */
function walk(
  index: ClassIndex,
  start: LocatedClass,
  memberName: string,
  skipOwnClass: boolean,
  ask: {
    readonly argumentCount?: number;
    readonly argumentTypes?: readonly (string | undefined)[];
  },
): WalkResult {
  const typed = ask.argumentTypes !== undefined;
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
  let frontier = fresh(skipOwnClass ? basesOf(index, start, typed) : [start]);
  while (frontier.length > 0) {
    const answers: Declared[] = [];
    const next: LocatedClass[] = [];
    for (const candidate of frontier) {
      const own = ownMemberOf(index, candidate, memberName, ask, typed && candidate !== start);
      // **A class whose own declarations both fit is ambiguous on its own**, and no distance further up can settle it.
      if (own.ambiguous) return { ambiguous: true };
      if (own.answer !== undefined) answers.push(own.answer);
      next.push(...basesOf(index, candidate, typed));
    }
    if (answers.length === 1) return { answer: answers[0]!, ambiguous: false };
    if (answers.length > 1) return { ambiguous: true };
    frontier = fresh(next);
  }
  return { ambiguous: false };
}

/**
 * Whether a class's declarations of a name admit a call of this arity.
 *
 * **A class that declares the name but none of its signatures does not answer the call, and the walk keeps going.**
 * That is what an overload set means in Java: `Sub` declaring `f(int)` says nothing about `f(1, 2)`, and a `Base` that
 * declares `f(int, int)` is where that call runs. Answering nothing at all would be the other defensible reading, and
 * it is wrong for the same reason the arm above reads bases at all.
 */

/** A class's own declaration of a name, with no notion of inheritance. */
function ownMemberOf(
  index: ClassIndex,
  located: LocatedClass,
  memberName: string,
  ask: {
    readonly argumentCount?: number;
    readonly argumentTypes?: readonly (string | undefined)[];
  },
  inherited: boolean,
): WalkResult {
  const file = index.files.get(located.file);
  const bucket = file?.members.get(located.name);
  if (bucket === undefined) return { ambiguous: false };
  const set = file?.arity.get(`${located.name}\u0000${memberName}`);
  // **A typed call is answered by the declaration whose parameters it can fill**, and by nothing else. Two matches are
  // two answers - `print(Object)` and `print(File)` both take a `File` - and this module refuses a name it cannot
  // decide, the same way the arity rule refuses one whose count no declaration admits.
  if (ask.argumentTypes !== undefined) {
    return bySignature(index, located, file, set, ask.argumentTypes, inherited);
  }
  // **The signature is checked before the name is answered**, because a class that declares `format(Object,
  // StringBuffer, FieldPosition)` is not the class a one-argument `format(x)` runs.
  if (!admitsArguments(set, ask.argumentCount)) return { ambiguous: false };
  if (bucket.has(`${memberName}\u0000ambiguous`)) return { ambiguous: false };
  const known = bucket.get(memberName);
  return known === undefined ? { ambiguous: false } : { answer: known, ambiguous: false };
}

/**
 * The one declaration in a class whose parameter types a call can fill, or `undefined` when there is none or several.
 *
 * **A declaration reached through inheritance has to write a body to be the answer.** A contract states a signature and
 * the code lives in the class that implements it; reading `Respondable.reject` as the callee answered a call that runs
 * the class's own field, which is the seven wrong edges that sent contracts out of the chain in the first place. The
 * class the call is written in is exempt, because a call dispatched on a contract really does reach the contract's
 * declaration - that is what the receiver's type means.
 */
function bySignature(
  index: ClassIndex,
  located: LocatedClass,
  file: FileTypes | undefined,
  set: AritySet | undefined,
  argumentTypes: readonly (string | undefined)[],
  inherited: boolean,
): WalkResult {
  const variables = file?.typeParameters.get(located.name);
  const answers = (set ?? []).filter(
    (declaration) =>
      declaration.nodeId !== undefined &&
      declaration.label !== undefined &&
      declaration.types !== undefined &&
      (!inherited || declaration.hasBody) &&
      fitsSignature(index, declaration, argumentTypes, variables),
  );
  if (answers.length === 0) return { ambiguous: false };
  // **The most specific of them, which is the one Java picks.** `print(Object)` and `print(File)` both accept a `File`
  // and only one of them is what runs: the declaration whose parameter names the argument's own type, position by
  // position. Counting the exact positions is the whole of specificity for this reader - a widening declared in the
  // source is the only way a parameter accepts an argument it does not name, and a tie between two declarations is a
  // call this reader still refuses.
  const scored = answers.map((declaration) => ({
    declaration,
    exact: exactPositions(declaration, argumentTypes),
  }));
  const best = Math.max(...scored.map((entry) => entry.exact));
  const winners = scored.filter((entry) => entry.exact === best);
  if (winners.length !== 1) return { ambiguous: true };
  const only = winners[0]!.declaration;
  return { answer: { nodeId: only.nodeId!, label: only.label! }, ambiguous: false };
}

/** How many positions a declaration names the argument's own type at, which is how Java orders two that both fit. */
function exactPositions(
  declaration: DeclaredArity,
  argumentTypes: readonly (string | undefined)[],
): number {
  const parameters = declaration.types ?? [];
  let exact = 0;
  for (let position = 0; position < parameters.length; position++) {
    const parameter = signatureName(parameters[position]);
    const argument = signatureName(argumentTypes[position]);
    if (parameter !== undefined && parameter === argument) exact++;
  }
  return exact;
}

/**
 * Whether a call's argument types fill a declaration's parameter types, **as far as either side states them.**
 *
 * **Only a position both sides write is compared**, and a comparison that finds no relation refuses the declaration.
 * The three shapes that accept anything are the three that name no class: `Object`, a type variable the declaring class
 * writes, and a parameter of one capital letter - the convention every Java codebase follows and the only way a generic
 * container's `add(T)` states that it takes what it is given. A pair this reader can compare and finds unrelated
 * refuses the declaration, which is what turns a walk of three `accept` overloads into one answer.
 *
 * **The comparison is on the written name, not on `simpleTypeName`.** That function answers "can a member be looked up
 * in this type", and it refuses `String`, `int` and `Object` because no declaration of theirs is in the graph - while a
 * signature comparison needs exactly those three: `accept(File, String)` is the declaration a call passing a `String`
 * runs, and refusing to compare the position would leave it out of the answer set.
 */
function fitsSignature(
  index: ClassIndex,
  declaration: DeclaredArity,
  argumentTypes: readonly (string | undefined)[],
  variables: ReadonlyMap<string, string> | undefined,
): boolean {
  const parameters = declaration.types ?? [];
  if (parameters.length !== argumentTypes.length && !declaration.variadic) return false;
  let compared = 0;
  for (let position = 0; position < parameters.length; position++) {
    const parameter = signatureName(parameters[position]);
    const argument = signatureName(argumentTypes[position]);
    if (parameter === undefined || argument === undefined) continue;
    // **A type variable is not a class and cannot refuse a call.** `<T> void add(T item)` states that it takes what it
    // is given; a single capital letter is how every Java codebase spells that variable.
    if (parameter === 'Object' || variables?.has(parameter) === true || /^[A-Z]$/.test(parameter)) {
      compared++;
      continue;
    }
    if (parameter === argument) {
      compared++;
      continue;
    }
    if (!isBaseOf(index, argument, parameter)) return false;
    compared++;
  }
  return compared > 0;
}

/**
 * A type as a signature writes it: the head of a generic, the last segment of a qualified name, and no spread marker.
 *
 * **`File...` is a `File` and `java.io.File` is the same `File`**, and a comparison that read either literally would
 * refuse every varargs call and every fully qualified declaration.
 */
function signatureName(written: string | undefined): string | undefined {
  if (typeof written !== 'string') return undefined;
  const trimmed = written.trim().replace(/\.\.\.$/, '');
  if (trimmed.length === 0) return undefined;
  const head = trimmed.split('<')[0]!.trim();
  const segments = head.split(/[.\s]+/).filter(Boolean);
  const last = segments.pop();
  return last === undefined || !/^[A-Za-z_$][\w$]*$/.test(last) ? undefined : last;
}

/** Whether one class extends another, as far as the graph declares it — the relation a parameter type may widen over. */
function isBaseOf(index: ClassIndex, derived: string, base: string): boolean {
  const start = locateClass(index, derived, undefined);
  if (start === undefined) return false;
  const seen = new Set<string>();
  let frontier: LocatedClass[] = [start];
  while (frontier.length > 0) {
    const next: LocatedClass[] = [];
    for (const candidate of frontier) {
      if (candidate.name === base) return true;
      if (seen.has(keyOf(candidate))) continue;
      seen.add(keyOf(candidate));
      next.push(...basesOf(index, candidate, true));
    }
    frontier = next;
  }
  return false;
}

/**
 * A class's bases, as located classes, in declaration order.
 *
 * **`withContracts` is the difference between the chain a class extends and the chain a class is.** A contract's
 * declaration states a signature and holds no code, so the arity pass reads `extends` alone — that is the measurement
 * that removed `implements` from the walk. The typed pass reads both, because a call whose arguments fit a contract's
 * signature and no class's signature runs the contract's default method, and a default method holds code. The two
 * lists stay in one order: the superclass first, then the contracts in the order they are named.
 */
function basesOf(index: ClassIndex, located: LocatedClass, withContracts = false): LocatedClass[] {
  const file = index.files.get(located.file);
  const named = file?.bases.get(located.name) ?? [];
  const contracts = withContracts ? (file?.contracts.get(located.name) ?? []) : [];
  const out: LocatedClass[] = [];
  for (const base of [...named, ...contracts]) {
    const found = locateClass(index, base, { file: located.file });
    if (found !== undefined) out.push(found);
  }
  return out;
}

/**
 * The type a bare name holds, read from the class it is written in **or from one of that class's bases**.
 *
 * **A field a class does not declare is still a field of the class.** Java's member lookup walks the inheritance chain
 * for a name written without a receiver exactly as it does for one written with `this`, and this module walked it for a
 * *hop* — `this.getStyle().getNullText()` — while a bare name was read off the class's own field map alone. On
 * `apache/commons-io@2.16.1` that is `PeekableInputStream.peek`'s `buffer.getCurrentNumberOfBytes()` and
 * `buffer.peek(…)`: `buffer` is `protected final CircularByteBuffer` on `CircularBufferInputStream`, two edges the
 * oracle holds and the graph claimed nothing for.
 *
 * **The class's own field comes first, and `extends` alone is the chain.** A subclass that shadows a base's field is
 * answered by its own, which is the order the language states; and a contract declares no field, so the contract list
 * has nothing this walk could find in it.
 */
function fieldInChain(
  lookup: ReceiverLookup,
  own: FileTypes | undefined,
  className: string,
  field: string,
): string | undefined {
  const direct = own?.fields.get(`${className}.${field}`);
  if (direct !== undefined) return direct;
  const start = ownClassOf(lookup.index, lookup.origin?.file, className);
  if (start === undefined) return undefined;
  const visited = new Set<string>([keyOf(start)]);
  let frontier = basesOf(lookup.index, start, false);
  while (frontier.length > 0) {
    const next: LocatedClass[] = [];
    for (const located of frontier) {
      const key = keyOf(located);
      if (visited.has(key)) continue;
      visited.add(key);
      const answer = lookup.index.files.get(located.file)?.fields.get(`${located.name}.${field}`);
      if (answer !== undefined) return answer;
      next.push(...basesOf(lookup.index, located, false));
    }
    frontier = next;
  }
  return undefined;
}

/**
 * The classes that lexically contain a class, innermost first — the scope a bare name is looked up in after its own.
 *
 * **Java resolves a simple name in the enclosing type before anything else**, and a class written inside a class is
 * written inside a scope: `Builder.setDirectory`'s `toPath(file, null)` names the private static method of
 * `DeferredFileOutputStream`, the class that contains the builder, and `StrategyParser.letterPattern`'s
 * `getStrategy(c, width, calendar)` names `FastDateParser`'s. A base chain cannot reach either, because neither is a
 * base of the class the call sits in — which is why the walk needs the containment relation rather than another list
 * of names.
 *
 * **The walk is bounded and cycle-safe.** A file cannot express a containment cycle through the grammar, but the index
 * is built from captures rather than from the grammar, and a reader that hangs on a malformed index is not a reader.
 */
export function outerClassesOf(
  index: ClassIndex,
  className: string,
  origin?: LookupOrigin,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([className]);
  let located = locateClass(index, className, origin);
  for (let step = 0; step < MAX_OUTER_STEPS && located !== undefined; step++) {
    const outer = index.files.get(located.file)?.outerClasses.get(located.name);
    if (outer === undefined || seen.has(outer)) break;
    seen.add(outer);
    out.push(outer);
    // **The outer class is declared in the same file as the class it contains**, because that is what "written inside"
    // means in every grammar this index reads; the file is carried rather than searched again.
    located = locateClass(index, outer, { file: located.file });
  }
  return out;
}

/** The depth a lexical containment walk takes before it stops, which no real grammar reaches. */
const MAX_OUTER_STEPS = 8;
