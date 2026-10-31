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
  if (typeof declaration.containerName === 'string' && declaration.containerName.length > 0) {
    return declaration.containerName;
  }
  const filed = declaration.properties?.['enclosingClass'];
  return typeof filed === 'string' && filed.length > 0 ? filed : undefined;
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

  return { fields, parameters, classOfFunction, classes, members };
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
 * Every class the graph knows, by simple name, with the members each one declares.
 *
 * **Global, because a field's type is declared in the file that defines the type, not the one that uses it.**
 * `this.index.buildIndex()` in one file names a class declared in another, and a per-file index would answer nothing.
 * **A simple name that two classes carry is dropped**, on the same rule the rest of the resolver uses: a name with
 * two answers has none.
 */
export interface ClassIndex {
  readonly classes: Map<string, Declared | 'ambiguous'>;
  readonly members: Map<string, Map<string, Declared> | 'ambiguous'>;
}

export function createClassIndex(): ClassIndex {
  return { classes: new Map(), members: new Map() };
}

/** Fold one file's classes into the index, **dropping any name a second file also declares**. */
export function mergeClassIndex(index: ClassIndex, types: FileTypes): void {
  for (const [className, declaration] of types.classes) {
    if (index.classes.has(className)) {
      index.classes.set(className, 'ambiguous');
      index.members.set(className, 'ambiguous');
      continue;
    }
    index.classes.set(className, declaration);
    const bucket = types.members.get(className);
    if (bucket !== undefined) index.members.set(className, bucket);
  }
}

/** The member a class declares under a name, or `undefined` when it declares none, two, or is itself ambiguous. */
export function classMemberOf(
  index: ClassIndex,
  className: string,
  memberName: string,
): Declared | undefined {
  if (index.classes.get(className) === 'ambiguous') return undefined;
  const bucket = index.members.get(className);
  if (bucket === undefined || bucket === 'ambiguous') return undefined;
  if (bucket.has(`${memberName}\u0000ambiguous`)) return undefined;
  return bucket.get(memberName);
}
