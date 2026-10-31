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

/** What one file says about the types its declarations have. */
export interface FileTypes {
  /** `Class.field` → the field's declared type, simple name only. */
  readonly fields: Map<string, string>;
  /** `Class.method/parameter` → the parameter's declared type. */
  readonly parameters: Map<string, string>;
  /** `Class.method` → the class that holds it, for the `this`/`self` receiver. */
  readonly classOfFunction: Map<string, string>;
  /** `Class` → the class's own declaration. */
  readonly classes: Map<string, Declared>;
  /** `Class` → its members by name. */
  readonly members: Map<string, Map<string, Declared>>;
  /** `Class` → the simple names of the classes it extends, in declaration order. */
  readonly bases: Map<string, readonly string[]>;
}

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
]);

/**
 * A type annotation reduced to the one name the resolver can look up, or `undefined` when it is not a name.
 *
 * **A container type is not a name either.** `Map<string, number>` has members this module knows nothing about, and
 * `string[]` is an element type wearing brackets; both are dropped rather than reduced to their head, because a
 * lookup of `Map` would find nothing and a lookup of `string` would find the builtin.
 */
export function simpleTypeName(annotation: unknown): string | undefined {
  if (typeof annotation !== 'string') return undefined;
  const text = annotation.trim();
  if (text.length === 0) return undefined;
  // **A union or an intersection is not one type**, and picking its first member is the guess this module exists to
  // avoid. So is an array, an optional marker, and a generic.
  if (
    text.includes('|') ||
    text.includes('&') ||
    text.includes('[') ||
    text.includes('<') ||
    text.endsWith('?')
  ) {
    return undefined;
  }
  const last = text
    .split(/[.\s:]+/)
    .filter(Boolean)
    .pop();
  if (last === undefined || !/^[A-Za-z_$][\w$]*$/.test(last)) return undefined;
  // A primitive has no declaration to find a member in.
  if (PRIMITIVES.has(last)) return undefined;
  return last;
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
  const classOfFunction = new Map<string, string>();
  const classes = new Map<string, Declared>();
  const members = new Map<string, Map<string, Declared>>();
  const bases = new Map<string, readonly string[]>();

  const declare = (className: string, name: string, declaration: TypedDeclaration): void => {
    if (declaration.nodeId === undefined) return;
    let bucket = members.get(className);
    if (bucket === undefined) {
      bucket = new Map();
      members.set(className, bucket);
    }
    // **Two members with one name is not an ambiguity to resolve here** - it is a name this class cannot answer for,
    // and both declarations are dropped rather than one of them being picked.
    if (bucket.has(name) || bucket.has(`${name}\u0000ambiguous`)) {
      bucket.delete(name);
      bucket.set(`${name}\u0000ambiguous`, { nodeId: declaration.nodeId, label: declaration.kind });
      return;
    }
    bucket.set(name, { nodeId: declaration.nodeId, label: declaration.kind });
  };

  for (const declaration of declarations) {
    const container = containerOf(declaration);
    const parameterOwner = declaration.properties['parameterOwner'];
    const parameterType = simpleTypeName(declaration.properties['parameterType']);

    if (
      declaration.kind === 'Class' ||
      declaration.kind === 'Struct' ||
      declaration.kind === 'Interface'
    ) {
      if (declaration.nodeId !== undefined) {
        classes.set(declaration.name, { nodeId: declaration.nodeId, label: declaration.kind });
      }
      // **A field's type is filed on the class, not as a symbol of its own.** The provider records the annotations it
      // read during its walk and hands them back as one property, so a file of 200 fields adds no 200 nodes and no
      // 200 symbols competing with the functions of the file for a search query.
      for (const [field, annotation] of fieldTypesOf(declaration.properties['fieldTypes'])) {
        const fieldType = simpleTypeName(annotation);
        if (fieldType !== undefined) fields.set(`${declaration.name}.${field}`, fieldType);
      }
      // **A class's bases are how a member it does not declare still belongs to it.** `Flask.__init__` calls
      // `self.add_url_rule(...)`, and `add_url_rule` is declared on `App` in `flask/sansio/app.py` - so a lookup that
      // stops at the class the call is written in answers nothing for the largest single group of inherited calls in
      // any object-oriented codebase. Only a class extends; an interface is a contract with no body to reach.
      const inherited = baseNamesOf(declaration.properties['baseClasses']);
      if (inherited.length > 0) bases.set(declaration.name, inherited);
      continue;
    }

    // **A parameter belongs to the function that declares it, and it is filed under that function's key** - whether
    // the function is a method of a class or stands at module level, which is the only difference between the two
    // blocks below.
    if (typeof parameterOwner === 'string' && parameterType !== undefined) {
      parameters.set(`${parameterOwner}\u0000${declaration.name}`, parameterType);
    }

    if (container === undefined || container.length === 0) continue;

    if (
      declaration.kind === 'Method' ||
      declaration.kind === 'Constructor' ||
      declaration.kind === 'Function'
    ) {
      classOfFunction.set(ownerKeyOf(container, declaration.name), container);
      declare(container, declaration.name, declaration);
      continue;
    }

    const fieldType = simpleTypeName(declaration.properties['fieldType']);
    if (fieldType !== undefined) fields.set(`${container}.${declaration.name}`, fieldType);
  }

  return { fields, parameters, classOfFunction, classes, members, bases };
}

/** The `field → annotation` pairs a class carries, whether the provider wrote them as one blob or one symbol each. */
function fieldTypesOf(blob: unknown): [string, string][] {
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
 * **A provider writes them as one comma-separated string, and a class may name none.** A generic argument is not a
 * base (`class Child extends Base<T>` names `Base`), and neither is a name that is not an identifier - the provider has
 * already dropped those, and what is left is read as written.
 */
function baseNamesOf(blob: unknown): string[] {
  if (typeof blob !== 'string' || blob.length === 0) return [];
  return blob
    .split(',')
    .map((name) => name.trim())
    .filter((name) => SIMPLE_NAME.test(name));
}

/** A name a class could be filed under: no dots, no generics, no punctuation. */
const SIMPLE_NAME = /^[A-Za-z_$][\w$]*$/;

/** A receiver's type, as far as the declarations can say. */
export interface ReceiverType {
  /** The class whose member the call names. */
  readonly className: string;
  /** How it was reached, recorded on the edge so the shape can be scored separately. */
  readonly via: 'thisField' | 'parameter';
}

const OWN_SCOPE: ReadonlySet<string> = new Set(['this', 'self', 'cls', '$this', 'super']);

/**
 * The type of the object a call is written on.
 *
 * **Two shapes, and each one is a declaration that was read.** `this.field.m()` needs the field's type; `param.m()`
 * needs the parameter's. Anything else - `a.b.c()`, `request.args.get()`, a receiver whose type nobody wrote -
 * returns nothing, and the call stays unresolved. The own-scope receiver with no field - `this.m()` - is not this
 * module's case: the enclosing class is already the scope the same-file arm resolves in.
 */
export function receiverTypeOf(
  types: FileTypes | undefined,
  receiver: string,
  ownerKey: string | undefined,
): ReceiverType | undefined {
  // A file with no declarations declares no types, which is the same answer as a receiver with no annotation.
  if (types === undefined) return undefined;
  const [base, ...rest] = receiver.split('.');
  if (base === undefined || base.length === 0 || ownerKey === undefined) return undefined;

  if (OWN_SCOPE.has(base)) {
    if (rest.length > 1) return undefined;
    const enclosing = types.classOfFunction.get(ownerKey);
    if (rest.length === 1) {
      if (enclosing === undefined) return undefined;
      const fieldType = types.fields.get(`${enclosing}.${rest[0]}`);
      return fieldType === undefined ? undefined : { className: fieldType, via: 'thisField' };
    }
    // **`this.m()` is the same-file arm's case and not this one**, and the enclosing class is how that arm already
    // answers it. What is left is a bare `self` in a function that belongs to no class - which is how TypeScript code
    // written in the callback style passes an object around: `function connectHandler(self: Redis)`. The parameter's
    // annotation is the only thing that says what `self` is, and it scored **0 of 18 claims** for the global-name arm
    // on `redis/ioredis` before this case existed.
    if (enclosing !== undefined) return undefined;
    const parameterType = types.parameters.get(`${ownerKey}\u0000${base}`);
    return parameterType === undefined ? undefined : { className: parameterType, via: 'parameter' };
  }

  if (rest.length !== 0) return undefined;
  const parameterType = types.parameters.get(`${ownerKey}\u0000${base}`);
  return parameterType === undefined ? undefined : { className: parameterType, via: 'parameter' };
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

/** Where a lookup is written: the file, and the files it imports. */
export interface LookupOrigin {
  readonly file?: string;
  readonly imported?: ReadonlySet<string>;
}

export function createClassIndex(): ClassIndex {
  return { classes: new Map(), files: new Map() };
}

/** Fold one file's classes into the index, **marking a name a second file also declares as ambiguous**. */
export function mergeClassIndex(index: ClassIndex, types: FileTypes, filePath: string): void {
  index.files.set(filePath, types);
  for (const [className, declared] of types.classes) {
    const known = index.classes.get(className);
    if (known !== undefined && known !== 'ambiguous' && known.file !== filePath) {
      index.classes.set(className, 'ambiguous');
      continue;
    }
    index.classes.set(className, { file: filePath, name: className, declared });
  }
}

/** The class a name means, from where the lookup is written - or `undefined` when the evidence does not decide. */
function locateClass(
  index: ClassIndex,
  className: string,
  origin: LookupOrigin | undefined,
): LocatedClass | undefined {
  const own = ownClassOf(index, origin?.file, className);
  if (own !== undefined) return own;
  const imported: LocatedClass[] = [];
  for (const file of origin?.imported ?? []) {
    const found = ownClassOf(index, file, className);
    if (found !== undefined) imported.push(found);
  }
  if (imported.length === 1) return imported[0];
  if (imported.length > 1) return undefined;
  const global = index.classes.get(className);
  return global === undefined || global === 'ambiguous' ? undefined : global;
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

/** The member a class declares under a name, or `undefined` when it declares none, two, or is not found. */
export function classMemberOf(
  index: ClassIndex,
  className: string,
  memberName: string,
  origin?: LookupOrigin,
): Declared | undefined {
  return lookupMember(index, className, memberName, origin, false);
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
): Declared | undefined {
  return lookupMember(index, className, memberName, origin, true);
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
      const own = ownMemberOf(index, candidate, memberName);
      if (own !== undefined) answers.push(own);
      next.push(...basesOf(index, candidate));
    }
    if (answers.length === 1) return answers[0];
    if (answers.length > 1) return undefined;
    frontier = fresh(next);
  }
  return undefined;
}

/** A class's identity in the walk, which is the file it lives in and the name it is filed under. */
function keyOf(located: LocatedClass): string {
  return `${located.file}\u0000${located.name}`;
}

/** A class's own declaration of a name, with no notion of inheritance. */
function ownMemberOf(
  index: ClassIndex,
  located: LocatedClass,
  memberName: string,
): Declared | undefined {
  const bucket = index.files.get(located.file)?.members.get(located.name);
  if (bucket === undefined) return undefined;
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
