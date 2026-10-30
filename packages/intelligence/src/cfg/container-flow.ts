// What a container holds at the point a statement reads it.
//
// **This closes the hole the return summary had to leave open.** `bar = helper(param)` in a callee whose body is
// `map.put("keyB", param); bar = map.get("keyB"); return bar` reached the summary as "the parameter is used at a call
// that writes no name", and `ReturnSummary.lost` is the field that says what that means: this model cannot follow the
// value, so no "it does not reach the return" answer may be given. On OWASP Benchmark that single escape hatch was the
// whole remaining false-positive family - 141 of 142, every one of them a safe case whose value round-trips through a
// collection and comes back out clean.
//
// The reading is not a heuristic; it is a bounded model with a stated guarantee:
//
//   **A container whose every access this function made is a call on a binding, whose keys are all literals, holds
//   exactly the values written under those keys.** Write the value under `keyB`, read `keyA`, and the read cannot
//   return the value - not "probably does not", cannot, because both accesses are in the same function and neither the
//   keys nor the receiver escaped the model.
//
// Everything outside that condition degrades in the conservative direction, and each degradation has its own reason:
//
//   - a write under a key this model cannot name puts its value in `unknown`, and every read of that container then
//     receives it: it is in there, and no slot can be pointed at;
//   - a position op and a read that sit in different branches make the positions meaningless, because the op may not
//     have run - so reads fall back to the whole container;
//   - a removal under a key this model cannot name leaves the key in place, because it may still hold the value.
//
// **What replaces the lost value is a use.** A read that resolves to a slot hands the slot's writers to the statement
// as *reads*, so `bar = list.get(1)` becomes a def→use edge from whoever wrote index 1 straight to `bar`. The rest of
// the analysis - reaching definitions, the propagator, the summary - then needs to know nothing about containers:
// there is a def, there is a use, and the flow is the same flow it has always been.

import { CONTAINER_OPERATIONS } from '@code-analyzer/analyzer';

import { bindingResolver } from './bindings.js';

import type { BindingResolver } from './bindings.js';
import type { BindingEntry, FunctionCfg, StatementFacts, UseSite } from './types.js';
import type { SourceRegion, ContainerCall, ContainerRole } from '@code-analyzer/analyzer';

/** The key a value was written under. Strings are map keys; numbers are sequence positions. */
type SlotKey = string | number;

/** One slot's value: the bindings written into it. */
interface Slot {
  readonly names: Set<number>;
}

/**
 * A container's contents, as this function has filled it so far.
 *
 * **One shape or the other, never both**, because a receiver is a map or a list for its whole life: `put` on an
 * `ArrayList` does not compile, and a model that allowed both would have to answer what `get(0)` means on a map.
 */
interface ContainerState {
  readonly kind: 'keyed' | 'sequence';
  readonly slots: Map<SlotKey, Slot>;
  /** Values that went in under a key this model could not name. Every read receives these. */
  unknown: Slot | undefined;
  /** `${stmtIndex}:${bindingIdx}` for every value written into this container, which is what "lost" is decided by. */
  readonly writes: Set<string>;
  /** The branch context of every position-changing call seen so far, or `null` before the first one. */
  positions: string | null;
  /** Whether a position-changing call happened in another branch, which makes the positions unspeakable. */
  unreliable: boolean;
  /** Whether the container itself left this function - returned, or handed to a call that is not a container call. */
  escaped: boolean;
}

/** What the model learned about one function's containers. */
export interface ContainerResolution {
  /** What a resolved read receives, per statement index: the bindings the value in that slot came from. */
  readonly carried: ReadonlyMap<number, ReadonlySet<number>>;
  /** The writes whose value the model followed to a read, so the summary no longer has to call them lost. */
  readonly followed: ReadonlySet<string>;
}

/** No containers read, which is the answer for a function that touches none and the neutral answer for a provider. */
export const NO_CONTAINER_FLOW: ContainerResolution = { carried: new Map(), followed: new Set() };

/** Everything the model needs to know about one function's statements. */
export interface ContainerInputs {
  readonly facts: Pick<StatementFacts, 'defs' | 'uses'>;
  readonly bindings: readonly BindingEntry[];
  readonly calls: readonly ContainerCall[];
  /** The file's branch ranges, which decide whether a position op and a read share a path. */
  readonly regions: readonly SourceRegion[];
  /**
   * The file's name scopes, so a receiver and an argument are the declarations their own line sees.
   *
   * **A container is keyed by name, and two declarations of one spelling are two containers.** Without this the second
   * `list` in a function inherits the first one's contents, and an argument is attributed to whichever declaration of
   * its name happened to be emitted first. Absent means one container per name, which is the model that existed before
   * scopes travelled with the facts.
   */
  readonly scopes?: readonly SourceRegion[];
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Resolve what every container read in one function receives.
 *
 * @param inputs the function's facts, bindings, the file's container calls and branch ranges, and its line range
 */
export function resolveContainerFlow(inputs: ContainerInputs): ContainerResolution {
  const { facts, bindings, calls, regions, scopes, startLine, endLine } = inputs;
  if (calls.length === 0) return NO_CONTAINER_FLOW;

  // **Resolved per line rather than by name**, because `list` may be two containers in one function.
  const resolve = bindingResolver(bindings, scopes);

  const byStatement = new Map<number, ContainerCall[]>();
  for (const call of calls) {
    if (call.line < startLine || call.line > endLine) continue;
    const stmtIndex = call.line - startLine;
    const bucket = byStatement.get(stmtIndex) ?? [];
    bucket.push(call);
    byStatement.set(stmtIndex, bucket);
  }
  if (byStatement.size === 0) return NO_CONTAINER_FLOW;

  const carried = new Map<number, Set<number>>();
  const states = new Map<string, ContainerState>();
  const contexts = new Map<number, string>();
  /** The statements at which a receiver is read *as a container*, which is what separates a read from an escape. */
  const ownStatements = new Map<string, Set<number>>();

  // **Statement order, because a container is a thing that changes.** The CFG has one block, so its statements are the
  // function's lines in order; a read may only see what was written above it.
  for (const stmtIndex of [...byStatement.keys()].sort((a, b) => a - b)) {
    // A receiver written by this statement is a new container: whatever it held is not reachable through the name any
    // more. This is the one reset that needs no knowledge of the value, so it is done before the calls.
    for (const def of facts.defs.get(stmtIndex) ?? []) {
      const name = bindings[def.bindingIdx]?.name;
      if (name !== undefined) states.delete(name);
    }

    for (const call of byStatement.get(stmtIndex)!) {
      const operation = CONTAINER_OPERATIONS.get(call.method);
      // A receiver that is not a binding of this function is a field or an outer variable: it outlives the statement,
      // so nothing here can say what it holds.
      if (resolve(call.receiver, call.line) === undefined) continue;

      // **Every method invoked on the receiver counts as reading it as a container**, whether or not this model knows
      // what the method does. `b.replace(lo, hi, "Chars")` is not in the table and is still a use of the builder -
      // treating it as an escape would say the builder left the function, which it did not.
      const own = ownStatements.get(call.receiver) ?? new Set<number>();
      own.add(stmtIndex);
      ownStatements.set(call.receiver, own);

      const context = contexts.get(stmtIndex) ?? contextOf(startLine + stmtIndex, regions);
      contexts.set(stmtIndex, context);
      if (operation === undefined) {
        mutateUnknown(states.get(call.receiver), call, stmtIndex, resolve);
        continue;
      }
      const state = stateOf(states, call, operation.role);
      applyCall(state, call, operation.role, operation.valueArgument, context, stmtIndex, resolve);

      const read = readOf(state, call, operation.role, context);
      if (read !== null) record(read, stmtIndex, carried);
    }
  }

  // **A container that leaves the function is a container anything can read.** `return list` and `helper(list)` both
  // hand the whole thing to code this model does not see, and "nothing reads slot 1" and "nothing I can see reads
  // slot 1" are the same sentence only to a reader who was not going to claim the value cannot come back.
  for (const [stmtIndex, uses] of facts.uses) {
    for (const use of uses) {
      const name = bindings[use.bindingIdx]?.name;
      if (name === undefined) continue;
      const state = states.get(name);
      if (state === undefined || state.escaped) continue;
      if (!ownStatements.get(name)?.has(stmtIndex)) state.escaped = true;
    }
  }

  // **Every write into a container that never left the function is followed**, whether or not every read was exact.
  // The reason is that a read which was answered with the whole container carries *every* name in it - that is what
  // `unionOf` hands the statement - so the value's exits are all def→use edges either way. What would make a write
  // unfollowed is an exit this function cannot see, and that is the escape test above.
  const followed = new Set<string>();
  for (const state of states.values()) {
    if (state.escaped) continue;
    for (const write of state.writes) followed.add(write);
  }

  return { carried, followed };
}

/**
 * The statement facts, with what each resolved container read receives added as a use.
 *
 * **The uses are added rather than substituted**, because a container is still read: `map.get(k)` reads `map`, and a
 * receiver that is tainted for some other reason - it was passed to a method that filled it - still has to deliver
 * that. What the resolution adds is the second half, the writers whose value the slot actually holds.
 *
 * Returns the same object when there is nothing to add, so a function with no container calls allocates nothing.
 */
export function withContainerUses(
  facts: StatementFacts,
  resolution: ContainerResolution,
  startLine: number,
): StatementFacts {
  if (resolution.carried.size === 0) return facts;

  const uses = new Map(facts.uses);
  for (const [stmtIndex, names] of resolution.carried) {
    const existing = uses.get(stmtIndex) ?? [];
    const already = new Set(existing.map((use) => use.bindingIdx));
    const added: UseSite[] = [];
    for (const bindingIdx of names) {
      if (already.has(bindingIdx)) continue;
      already.add(bindingIdx);
      added.push({
        point: { blockIndex: 0, stmtIndex, line: startLine + stmtIndex },
        bindingIdx,
      });
    }
    if (added.length > 0) uses.set(stmtIndex, [...existing, ...added]);
  }
  return { ...facts, uses };
}

/**
 * The model's answer for one function, from its CFG and the file's container calls.
 *
 * The CFG carries the ids the summary needs - `containerFollowed` - and the uses the propagator needs, so this is the
 * one place the two are joined.
 */
export function containerFlowOf(
  cfg: FunctionCfg,
  calls: readonly ContainerCall[] | null | undefined,
  regions: readonly SourceRegion[] | null | undefined,
  scopes?: readonly SourceRegion[],
): { readonly stmtFacts: StatementFacts; readonly followed: ReadonlySet<string> } {
  if (!calls || calls.length === 0) return { stmtFacts: cfg.stmtFacts, followed: new Set() };
  const resolution = resolveContainerFlow({
    facts: cfg.stmtFacts,
    bindings: cfg.bindings,
    calls,
    regions: regions ?? [],
    ...(scopes === undefined ? {} : { scopes }),
    startLine: cfg.startLine,
    endLine: cfg.blocks[0]?.endLine ?? cfg.startLine,
  });
  return {
    stmtFacts: withContainerUses(cfg.stmtFacts, resolution, cfg.startLine),
    followed: resolution.followed,
  };
}

/** The state a receiver is in, decided by the call that arrives first. */
function stateOf(
  states: Map<string, ContainerState>,
  call: ContainerCall,
  role: ContainerRole,
): ContainerState {
  const existing = states.get(call.receiver);
  if (existing) return existing;
  const fresh: ContainerState = {
    kind: kindOf(call, role),
    slots: new Map(),
    unknown: undefined,
    writes: new Set(),
    positions: null,
    unreliable: false,
    escaped: false,
  };
  states.set(call.receiver, fresh);
  return fresh;
}

/**
 * Whether a receiver is a map or a list, from the one call that reveals it.
 *
 * **The key decides, not the method name.** `set` is `Map.set` and `List.set`; `get` is `Map.get` and `List.get`.
 * What separates them is the key's shape: `get(0)` is a position and `get("keyA")` is a key. `add` and `append` are
 * the only calls whose role settles it on its own, because they are the ones that name no key at all.
 */
function kindOf(call: ContainerCall, role: ContainerRole): 'keyed' | 'sequence' {
  if (role === 'append') return 'sequence';
  const key = call.args[0]?.literal;
  return key !== undefined && isIndex(key) ? 'sequence' : 'keyed';
}

/** Apply one call to its receiver's state. */
function applyCall(
  state: ContainerState,
  call: ContainerCall,
  role: ContainerRole,
  valueArgument: number,
  context: string,
  stmtIndex: number,
  resolve: BindingResolver,
): void {
  if (role === 'write' || role === 'append') {
    writeInto(state, call, role, valueArgument, context, stmtIndex, resolve);
    return;
  }
  if (role === 'clear') {
    // **A clear counts only when it is on every path.** `inSameBranch` answers "is this the same branch as the last
    // position op", and with no previous op it answers *true* — so `if (flag) list.clear();` was read as a clear that
    // had certainly run, which emptied the container and lost every value in it. The question here is not about
    // positions at all: a clear inside any conditional region is a clear that may not have happened, and what the
    // container held then becomes content this model cannot place rather than content it can rule out.
    if (context === '') {
      reset(state);
      return;
    }
    const held = unionOf(state);
    reset(state);
    state.unknown = held;
    return;
  }
  if (role === 'remove') removeFrom(state, call, context);
}

/** Empty a container that was cleared on this path. */
function reset(state: ContainerState): void {
  state.slots.clear();
  state.unknown = undefined;
}

/**
 * A method this model has no meaning for, invoked on a container it models.
 *
 * **It may have mutated the container, and the name alone cannot tell**, so every value it was handed becomes content
 * the model cannot place: absorbed into `unknown`, where every later read receives it, and recorded as a write, because
 * the value now has a destination this function can see.
 *
 * The alternative - treating the call as the container leaving the function - was measured and was wrong:
 * `b.replace(lo, hi, "Chars")` is a call on a builder, and marking the builder escaped made every `StringBuilder`
 * chain in OWASP Benchmark unfollowable.
 */
function mutateUnknown(
  state: ContainerState | undefined,
  call: ContainerCall,
  stmtIndex: number,
  resolve: BindingResolver,
): void {
  if (state === undefined) return;
  const slot: Slot = { names: new Set() };
  for (const argument of call.args) {
    for (const name of argument.names) {
      const index = resolve(name, call.line);
      if (index === undefined) continue;
      slot.names.add(index);
      state.writes.add(`${stmtIndex}:${index}`);
    }
  }
  state.unknown = mergeSlots(state.unknown, slot);
}

/** Write one argument into the slot the call names, or append it when the call names no key. */
function writeInto(
  state: ContainerState,
  call: ContainerCall,
  role: ContainerRole,
  valueArgument: number,
  context: string,
  stmtIndex: number,
  resolve: BindingResolver,
): void {
  const slot = emptySlot();
  for (const name of call.args[valueArgument]?.names ?? []) {
    const index = resolve(name, call.line);
    if (index === undefined) continue;
    slot.names.add(index);
    // **Every write is recorded whether or not a read finds it**, because "no read finds it" is an answer only when
    // every read of this container was exact and the container never left the function - see the post-pass above.
    state.writes.add(`${stmtIndex}:${index}`);
  }

  if (role === 'append') {
    // `add(index, value)` is an insertion, and this model does not shift a sequence it has not counted: the container
    // becomes one whose contents are every value written to it, rather than one whose positions are wrong by one.
    // The same answer covers an append in another branch: it may not have run, so no position after it is known.
    if (call.args.length > 1 || !inSameBranch(state, context)) {
      state.unknown = mergeSlots(state.unknown, slot);
      return;
    }
    state.slots.set(state.slots.size, slot);
    return;
  }

  const key = keyOf(state, call);
  // **A write is applied whatever branch it is in**, because a value that may have been written may have been read:
  // that is a may-fact and no path contradicts it.
  if (key === null) state.unknown = mergeSlots(state.unknown, slot);
  else state.slots.set(key, mergeSlots(state.slots.get(key), slot));
}

/** Remove one slot, shifting a sequence down so that the positions after it keep their meaning. */
function removeFrom(state: ContainerState, call: ContainerCall, context: string): void {
  if (!inSameBranch(state, context)) {
    // **The removal may not have run, so the value may still be there.** Keeping it is the answer that cannot be
    // wrong; deleting it would be a claim about a path this statement is not on.
    if (state.kind === 'sequence') state.unreliable = true;
    return;
  }
  const key = keyOf(state, call);
  if (key === null) return;
  if (state.kind === 'keyed') {
    state.slots.delete(key);
    return;
  }
  const index = Number(key);
  if (!Number.isInteger(index) || index < 0 || index >= state.slots.size) {
    state.unreliable = true;
    return;
  }
  const shifted = new Map<SlotKey, Slot>();
  for (let position = 0; position < state.slots.size; position++) {
    const slot = position === index ? undefined : state.slots.get(position);
    if (slot) shifted.set(shifted.size, slot);
  }
  state.slots.clear();
  for (const [position, slot] of shifted) state.slots.set(position, slot);
}

/**
 * What one read receives, or `null` when the call is not a read.
 *
 * **A keyed container is read whatever branch the statement is in**: `map.get("k")` receives what `map.put("k", v)`
 * wrote whether or not the write's branch ran, and the union of "it did" and "it did not" is the write. A sequence is
 * the opposite - an index means nothing if the appends before it may not have happened - which is why the two paths
 * are not one.
 *
 */
function readOf(
  state: ContainerState,
  call: ContainerCall,
  role: ContainerRole,
  context: string,
): Slot | null {
  if (role === 'read-all') return unionOf(state);
  if (role !== 'read') return null;
  const key = keyOf(state, call);
  // **An unnameable key, an unusable position or an unusable branch means every value ever written.**
  // `map.get(key)` where `key` is a variable can only be answered with the whole container, and answering with less
  // would be a claim about a program this model was not given.
  if (key === null) return unionOf(state);
  if (state.kind === 'sequence' && (state.unreliable || state.positions !== context)) {
    return unionOf(state);
  }
  // Copying rather than merging into the slot: an unnameable write may sit under this key, so every read of it receives
  // that value, but the read itself must not leave it there.
  return unionOfSlots(state.slots.get(key), state.unknown);
}

/**
 * Whether the current call sits on a path a previous position-changing call also ran on.
 *
 * **The first position-changing call decides the branch**, and a second one in a different branch makes the positions
 * unspeakable: `if (a) list.add(x)` followed by `if (b) list.add(y)` leaves `list.get(1)` answering a question about
 * two different lists. Same branch - including both outside every branch - keeps the order meaningful, because a whole
 * `if` body runs or does not run as one.
 */
function inSameBranch(state: ContainerState, context: string): boolean {
  if (state.unreliable) return false;
  if (state.positions === null) {
    state.positions = context;
    return true;
  }
  if (state.positions === context) return true;
  state.unreliable = true;
  return false;
}

/**
 * Every value the container holds, as a slot of its own.
 *
 * **A copy, because a read is a question and not a write.** The obvious implementation merges into the first slot it
 * finds, which hands back an object the container still holds: `map.toString()` would then be followed by
 * `map.get("keyB")` receiving everything, and the guarantee in this file's header - "read `keyA`, and the read
 * *cannot* return the value written under `keyB`" - would quietly become "usually cannot".
 */
function unionOf(state: ContainerState): Slot {
  return unionOfSlots(state.unknown, ...state.slots.values());
}

/** The names in all of these slots, as a slot that is nobody's contents. */
function unionOfSlots(...slots: readonly (Slot | undefined)[]): Slot {
  const merged = emptySlot();
  for (const slot of slots) if (slot) for (const name of slot.names) merged.names.add(name);
  return merged;
}

/** Record what a read receives, as the names the statement now reads. */
function record(read: Slot, stmtIndex: number, carried: Map<number, Set<number>>): void {
  for (const name of read.names) {
    const bucket = carried.get(stmtIndex) ?? new Set<number>();
    bucket.add(name);
    carried.set(stmtIndex, bucket);
  }
}

/**
 * The key a call names, when it names one this model can place.
 *
 * A key that is not a literal is a runtime value, and a runtime value has no slot this model can name. A sequence's
 * key is its position, so it is read as a number; a keyed container's key is the literal's text.
 */
function keyOf(state: ContainerState, call: ContainerCall): SlotKey | null {
  const literal = call.args[0]?.literal;
  if (literal === undefined) return null;
  return state.kind === 'sequence' ? Number(literal) : literal;
}

/** Whether a literal names a sequence position rather than a map key. */
function isIndex(literal: string): boolean {
  return /^-?\d+$/.test(literal);
}

/**
 * The branches a line sits inside, as one string.
 *
 * Nested ranges are both listed, so two statements are compared for *the same set* of branches rather than for depth:
 * an `if` inside an `if` may not run even when the outer one did, and a position op inside it is not comparable with a
 * read at the outer level.
 */
function contextOf(line: number, regions: readonly SourceRegion[]): string {
  let context = '';
  for (const region of regions)
    if (line >= region.from && line <= region.to) context += `${region.from}:${region.to}|`;
  return context;
}

function emptySlot(): Slot {
  return { names: new Set() };
}

/** Two writes to one slot: both values are in it, so both names and both writes are. */
function mergeSlots(existing: Slot | undefined, incoming: Slot): Slot {
  if (existing === undefined) return incoming;
  for (const name of incoming.names) existing.names.add(name);
  return existing;
}
