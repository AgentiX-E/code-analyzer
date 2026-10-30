// A call that puts a value into a container, or takes one out of it.
//
// **This module records the syntax; the meaning lives one layer up.** A `put`, an `add` and an `append` are three
// spellings of "this receiver now holds that argument", and a `get`, an `elementAt` and a `toString` are three
// spellings of "this statement receives what the receiver holds". Which spelling means which is a table
// (`CONTAINER_OPERATIONS`), and what to do with the answer is the taint model's business, because a syntax layer that
// decided a value is safe would be the second place that knows what taint is.
//
// **Why it is a fact of its own rather than a reading of the captures.** A `METHOD_CALL` capture carries the method
// name and the receiver, and the arguments arrive as separate `VARIABLE_ACCESS` captures — so the names are there and
// **the keys are not**. `map.put("keyB-72608", param)` and `map.get("keyA-72608")` differ only in a string literal,
// and every OWASP Benchmark case that round-trips a value through a collection differs in exactly that. Without the
// literal the two accesses are indistinguishable, which is why the model that lacked them could only say "this value
// went somewhere I cannot follow".
//
// **Only a simple receiver is recorded.** `this.cache.put(k, v)` and `getMap().put(k, v)` name a container through an
// expression rather than a binding, and following those means modelling fields and call results — a different
// question with a different cost. The absence is deliberate and is what makes the model's guarantee statable: every
// slot it resolves belongs to a local whose every access it saw.

import { namedChildrenOf } from './syntax-children.js';

import type { TreeSitterSyntaxNode } from './tree-sitter-base.js';

/** What a call does to its receiver, in the four ways a container can be used. */
export type ContainerRole = 'write' | 'append' | 'read' | 'read-all' | 'remove' | 'clear';

/** One method name's meaning. */
export interface ContainerOperation {
  /** What the call does with the receiver's contents. */
  readonly role: ContainerRole;
  /** Position of the argument that carries the value being written, or `-1` when the call writes nothing. */
  readonly valueArgument: number;
  /** Position of the argument that names the key or index, or `-1` when the call does not name one. */
  readonly keyArgument: number;
}

/**
 * The method names a container is used through, and what each one means.
 *
 * **A shared vocabulary rather than a per-language one**, because `put` and `get` are `put` and `get` in every grammar
 * this project reads, and a language-specific table would let two languages disagree about what `add` does. A name
 * absent from this table is not a container access as far as this model is concerned: `size()`, `isEmpty()` and
 * `containsKey()` are questions about a container, not uses of its contents.
 *
 * `set` is listed for both `Map.set` and `List.set`; both write the slot the key names, which is the only thing the
 * table has to say.
 *
 * **A `Map` rather than an object literal, and `toString` is why.** An object inherits `toString`, `valueOf`,
 * `constructor` and `hasOwnProperty` from `Object.prototype`, so `name in table` answers true for four method names no
 * container has, and `table[name]` hands back a function rather than an operation. TypeScript says the same thing from
 * the other side: a `toString` property in an object literal annotated as `Record<string, ContainerOperation>` is an
 * override of `Object.prototype.toString`, so its `role` widens to `string` and the literal stops compiling. A `Map`
 * has neither problem, and the lookup is the thing the walk actually does.
 */
export const CONTAINER_OPERATIONS: ReadonlyMap<string, ContainerOperation> = new Map([
  ['put', { role: 'write', valueArgument: 1, keyArgument: 0 }],
  ['putIfAbsent', { role: 'write', valueArgument: 1, keyArgument: 0 }],
  ['set', { role: 'write', valueArgument: 1, keyArgument: 0 }],
  ['replace', { role: 'write', valueArgument: 1, keyArgument: 0 }],
  ['add', { role: 'append', valueArgument: 0, keyArgument: -1 }],
  ['append', { role: 'append', valueArgument: 0, keyArgument: -1 }],
  ['push', { role: 'append', valueArgument: 0, keyArgument: -1 }],
  ['addLast', { role: 'append', valueArgument: 0, keyArgument: -1 }],
  ['get', { role: 'read', valueArgument: -1, keyArgument: 0 }],
  ['getOrDefault', { role: 'read', valueArgument: -1, keyArgument: 0 }],
  ['elementAt', { role: 'read', valueArgument: -1, keyArgument: 0 }],
  ['charAt', { role: 'read', valueArgument: -1, keyArgument: 0 }],
  ['remove', { role: 'remove', valueArgument: -1, keyArgument: 0 }],
  ['removeAt', { role: 'remove', valueArgument: -1, keyArgument: 0 }],
  ['delete', { role: 'remove', valueArgument: -1, keyArgument: 0 }],
  ['clear', { role: 'clear', valueArgument: -1, keyArgument: -1 }],
  ['toString', { role: 'read-all', valueArgument: -1, keyArgument: -1 }],
  // **A receiver that is configured and then executed is a container written and then read.** `pb.command(argList)`
  // stores the command and `pb.start()` runs what was stored, which is `append` followed by `read-all` in every way
  // that matters here - the value's destination is the receiver, and the receiver's contents are what the second call
  // acts on. Measured on OWASP Benchmark: 24 vulnerable `cmdi` cases are written exactly this way, and both names were
  // already sinks, so the engine knew where the danger landed and not how the value got there.
  //
  // **Both entries are inert on a receiver this model has no state for**, which is what keeps `timer.start()` and
  // `Thread.start()` out of it: `start` reads the contents of a container, and a receiver nothing wrote into has none.
  ['command', { role: 'append', valueArgument: 0, keyArgument: -1 }],
  ['start', { role: 'read-all', valueArgument: -1, keyArgument: -1 }],
] as const);

/**
 * One argument of a container call.
 *
 * **A literal and the names it reads are different things and both are kept.** `"keyA-72608"` is a key the model can
 * name exactly; `key` is a key it cannot, and the difference decides whether a slot is resolvable at all. The names
 * are recorded for the value side, where `map.put("k", param)` has to hand `param` to whoever reads that slot.
 */
export interface ContainerArgument {
  /** The literal's text with its quotes removed, when the argument is a literal. */
  readonly literal?: string;
  /** Every name the argument reads, in document order. */
  readonly names: readonly string[];
}

/** One call on a container, as the source spells it. */
export interface ContainerCall {
  /** The line the call's statement begins on, which is the key its facts are filed under. */
  readonly line: number;
  /** The container, by the simple name the code writes. */
  readonly receiver: string;
  /** The method called on it. */
  readonly method: string;
  /** The arguments, in order. */
  readonly args: readonly ContainerArgument[];
}

/**
 * The node and field names one grammar uses for a call on a container.
 *
 * **Two shapes, and the table carries both rather than a subclass per shape.** Java puts the name and the receiver on
 * the call node itself (`method_invocation object: name: arguments:`); JavaScript, TypeScript and Python put a member
 * node under the callee field (`call_expression function: (member_expression object: property:)`). A field name that is
 * empty means the shape does not have it.
 */
export interface ContainerDialect {
  /** Nodes that spell a call. */
  readonly callTypes: readonly string[];
  /** Field of the call that carries the callee, which is the name itself when the grammar has no member node. */
  readonly calleeField: string;
  /** Field of the call that carries the receiver directly, when the grammar has no member node. */
  readonly directReceiverField: string;
  /** Node types that spell `receiver.name`. */
  readonly memberTypes: readonly string[];
  /** Fields of the member node. */
  readonly memberObjectField: string;
  readonly memberNameField: string;
  /** Field of the call that carries the argument list. */
  readonly argumentField: string;
  /** Node types that spell a string literal. */
  readonly stringLiteralTypes: readonly string[];
  /** Node types that spell an integer literal. */
  readonly integerLiteralTypes: readonly string[];
}

/** Java's shape: the receiver and the name are both fields of the call node. */
export const JAVA_CONTAINERS: ContainerDialect = {
  callTypes: ['method_invocation'],
  calleeField: 'name',
  directReceiverField: 'object',
  memberTypes: [],
  memberObjectField: '',
  memberNameField: '',
  argumentField: 'arguments',
  stringLiteralTypes: ['string_literal'],
  integerLiteralTypes: ['decimal_integer_literal', 'hex_integer_literal'],
};

/**
 * The shape JavaScript, TypeScript and every C-family grammar with a member node share: the callee is a
 * `member_expression` whose `object` is the receiver and whose `property` is the name.
 */
export const MEMBER_CALLEE_CONTAINERS: ContainerDialect = {
  callTypes: ['call_expression'],
  calleeField: 'function',
  // A bare `foo()` has an identifier callee and no receiver, which is not a container access.
  directReceiverField: '',
  memberTypes: ['member_expression'],
  memberObjectField: 'object',
  memberNameField: 'property',
  argumentField: 'arguments',
  stringLiteralTypes: ['string', 'template_string'],
  integerLiteralTypes: ['number'],
};

/** Python's spelling: the callee is an `attribute` whose name field is also called `attribute`. */
export const PYTHON_CONTAINERS: ContainerDialect = {
  callTypes: ['call'],
  calleeField: 'function',
  directReceiverField: '',
  memberTypes: ['attribute'],
  memberObjectField: 'object',
  memberNameField: 'attribute',
  argumentField: 'arguments',
  stringLiteralTypes: ['string'],
  integerLiteralTypes: ['integer'],
};

/**
 * Every call on a simple-named container in the tree, in document order.
 *
 * The walk descends into every node: a call inside a lambda or an anonymous class is still a call this file makes, and
 * the consumer divides them by line range exactly as it divides returns.
 */
export function extractContainerCalls(
  root: TreeSitterSyntaxNode,
  dialect: ContainerDialect,
): ContainerCall[] {
  const out: ContainerCall[] = [];
  const visit = (node: TreeSitterSyntaxNode): void => {
    if (dialect.callTypes.includes(node.type)) {
      const call = readCall(node, dialect);
      if (call) out.push(call);
    }
    for (const child of namedChildrenOf(node)) visit(child);
  };
  visit(root);
  return out;
}

/** One call, or `null` when its receiver is not a simple name or its method is not a container operation. */
function readCall(node: TreeSitterSyntaxNode, dialect: ContainerDialect): ContainerCall | null {
  const callee = node.childForFieldName(dialect.calleeField);
  if (callee === null) return null;

  const calleeIsMember = dialect.memberTypes.includes(callee.type);
  // **The receiver and the name come from one of two shapes**, and a grammar names only one of them: reading the
  // other hand's fields would return null on every call.
  const receiver = calleeIsMember
    ? callee.childForFieldName(dialect.memberObjectField)
    : dialect.directReceiverField === ''
      ? null
      : node.childForFieldName(dialect.directReceiverField);
  const name = calleeIsMember ? callee.childForFieldName(dialect.memberNameField) : callee;
  if (receiver === null || name === null) return null;
  // A field read is still a container, but it is not a binding this file owns, so it is outside the model.
  if (receiver.type !== 'identifier') return null;
  // **The method has to be one this model knows**, because a role table entry is what makes the call mean anything;
  // recording the rest would be a list nothing reads.
  if (!CONTAINER_OPERATIONS.has(name.text)) return null;

  const list = node.childForFieldName(dialect.argumentField);
  const args: ContainerArgument[] = [];
  // A call with no argument list at all is a call with no arguments: `toString()` parses as a call whose argument
  // field is an empty `argument_list`, and `sb.toString` without parentheses is not a call.
  for (const argument of list === null ? [] : namedChildrenOf(list)) {
    args.push(readArgument(argument, dialect));
  }

  return {
    line: node.startPosition.row + 1,
    receiver: receiver.text,
    method: name.text,
    args,
  };
}

/** One argument, as a literal when it is one and as the names it reads otherwise. */
function readArgument(node: TreeSitterSyntaxNode, dialect: ContainerDialect): ContainerArgument {
  if (dialect.stringLiteralTypes.includes(node.type))
    return { literal: unquote(node.text), names: [] };
  if (dialect.integerLiteralTypes.includes(node.type)) return { literal: node.text, names: [] };
  return { names: namesUnder(node) };
}

/** Every identifier under `node`, in document order, without descending again where the walk will arrive. */
function namesUnder(node: TreeSitterSyntaxNode): string[] {
  const out: string[] = [];
  const visit = (current: TreeSitterSyntaxNode): void => {
    if (current.type === 'identifier') {
      out.push(current.text);
      return;
    }
    for (const child of namedChildrenOf(current)) visit(child);
  };
  visit(node);
  return out;
}

/**
 * A string literal's text without its quotes.
 *
 * **The quotes are stripped rather than parsed**: the key is an identity, and `"keyA"` and `'keyA'` name the same slot
 * in every grammar here. An escape sequence is left as the source spells it, which is wrong about the value and right
 * about the identity — `"a\u0041"` and `"aA"` are the same key to a JVM and different slots to this model, and that
 * costs precision on a key nobody writes rather than correctness on a key somebody does.
 */
function unquote(text: string): string {
  return text.replace(/^[`'"]+/, '').replace(/[`'"]+$/, '');
}
