// @code-analyzer/intelligence — the reachability primitive under every taint question
//
// **One walk, several questions.** Forward reachability over def→use facts is asked by two subsystems that were
// previously answering it separately: the taint propagator (which asks "did this value reach a sink") and the
// inter-procedural summary builder (which asks "can this parameter reach a return"). The two questions differ only in
// what they do with a reached statement, so the walk lives here and each question supplies its own hooks.
//
// A hook earns its place by being a *question about the same relation*, not by being convenient:
//
//   - `onUse` sees every statement a value is delivered to. The propagator reports a finding there; the summary
//     builder records that a return hands the value back.
//   - `onDefinition` sees the edge from a statement to the name it writes, and may **stop** it or **add** to the
//     exclusions it carries. This is how a call's summary refines what the caller's name inherits - the one thing a
//     reachability walk cannot answer on its own, because it is a fact about the callee.
//   - `onDeadEnd` sees a value consumed by a statement that writes no name. That is not a finding and not an error: it
//     is where a value can vanish without a trace, which is exactly the state a summary must not claim to understand.
//
// **The relation itself is read from two optional facts on the CFG**, and both are optional in the conservative
// direction: a definition the file's arithmetic decides does not carry a value, and a line no path reaches is not read.

import type {
  DefUseFact,
  DefinitionSite,
  FunctionCfg,
  SanitizerOccurrence,
  TaintSourceOccurrence,
} from '../cfg/types.js';

/** Kinds of taint sinks, as an open vocabulary: what a sink neutralises is named by its kind. */
export type SinkKind = string;

/** The key convention this walk and `computeReachingDefinitions` share. */
const STRIDE = 1024;

/** A tainted value: one binding, at one program point, carrying one source and one exclusion set. */
export interface ReachState {
  /** Binding index carrying the value. */
  readonly bindingIdx: number;
  /** Program point the binding was defined at. */
  readonly point: { blockIndex: number; stmtIndex: number; line: number };
  /** Sink kinds neutralised on every path to here. */
  readonly exclusions: ReadonlySet<SinkKind>;
  /** The occurrence that introduced the value. */
  readonly source: TaintSourceOccurrence;
  /** Blocks traversed from the origin, for path reporting. */
  readonly viaBlocks: readonly number[];
}

/** One edge from a statement to the name it writes. */
export interface DefinitionEdge {
  /** The value being carried into the definition. */
  readonly state: ReachState;
  /** Statement index of the definition. */
  readonly stmtIndex: number;
  /** 1-based line of the definition. */
  readonly line: number;
  /** Binding the statement writes. */
  readonly bindingIdx: number;
}

/** What a hook wants done with a definition edge. */
export interface DefinitionVerdict {
  /** Whether the value stops at this statement rather than reaching the name it writes. */
  readonly stop?: boolean;
  /** Kinds this edge neutralises, added to the ones the value already excludes. */
  readonly neutralized?: ReadonlySet<SinkKind>;
}

/** The questions a caller asks of the walk. */
export interface ReachHooks {
  /** Called once per use site a value is delivered to. */
  readonly onUse: (state: ReachState, use: DefUseFact) => void;
  /** Called before a written name inherits the value. Absent means every definition inherits. */
  readonly onDefinition?: (edge: DefinitionEdge) => DefinitionVerdict | undefined;
  /** Called when a statement consumes the value and writes no name at all. */
  readonly onDeadEnd?: (state: ReachState, use: DefUseFact) => void;
}

/** Limits and side tables the walk needs. */
export interface ReachOptions {
  /** Neutralisers, by statement index. A neutraliser on a statement runs before the statement's own call does. */
  readonly sanitizers: ReadonlyMap<number, readonly SanitizerOccurrence[]>;
  /** Worklist bound, so a pathological fixture cannot spin. */
  readonly maxIterations: number;
}

/** What the walk did, so a caller can report on it. */
export interface ReachOutcome {
  /** Number of def→use facts the walk read. */
  readonly factsProcessed: number;
  /** Worklist passes spent. */
  readonly iterations: number;
  /** How many times a neutraliser added a kind the value did not already exclude. */
  readonly sanitizerKills: number;
}

/**
 * Whether a neutraliser applies to the value being carried.
 *
 * **Three answers, three analyses.** A neutraliser that names the value applies only when the value is one of its
 * arguments — `encodeForHTML(param)` does not clean `bar` in the same call. One that names nothing but *was* read has
 * literal arguments only, and literals carry no value that is being tracked, so it cleans nothing. One whose arguments
 * could not be read has no answer to give, and the statement-level reading stays for it.
 */
export function cleansValue(
  occurrence: SanitizerOccurrence,
  carriedName: string | undefined,
): boolean {
  const names = occurrence.neutralizedNames;
  if (names === undefined) return true;
  if (carriedName === undefined) return names.size === 0;
  return names.has(carriedName);
}

/**
 * Every sink kind neutralised on one statement **for the value named `carriedName`**.
 *
 * A neutraliser that names its arguments contributes only when one of them is the value being carried; one whose
 * arguments could not be read contributes always, because the statement-level reading is the one every provider before
 * this could express.
 */
export function neutralizedAt(
  sanitizers: ReadonlyMap<number, readonly SanitizerOccurrence[]>,
  key: number,
  carriedName: string | undefined,
): Set<string> {
  const kinds = new Set<string>();
  for (const occurrence of sanitizers.get(key) ?? []) {
    if (!cleansValue(occurrence, carriedName)) continue;
    for (const kind of occurrence.neutralizedKinds) kinds.add(kind);
  }
  return kinds;
}

/** The name a binding was declared as, which is what a neutraliser names. */
function nameOf(cfg: FunctionCfg, bindingIdx: number): string | undefined {
  return cfg.bindings[bindingIdx]?.name;
}

function keyOf(block: number, stmt: number): number {
  return block * STRIDE + stmt;
}

/** Definitions a statement writes. */
function definitionsAt(
  cfg: FunctionCfg,
  blockIndex: number,
  stmtIndex: number,
): readonly DefinitionSite[] {
  return cfg.stmtFacts.defs.get(keyOf(blockIndex, stmtIndex)) ?? [];
}

/**
 * Def→use facts bucketed by **the binding and the statement that wrote it**.
 *
 * **The binding is part of the key and it has to be.** A key of the statement alone returns the uses of every name that
 * statement wrote, so seeding `param` also delivered `request`'s value wherever `request` was read on the same
 * statement — two parameters declared on one signature line share a statement index, and the walk then answered for the
 * wrong argument. It is the same confusion `BindingEntry.parameterIndex` exists to prevent, one level down.
 */
function indexFacts(facts: readonly DefUseFact[]): Map<string, DefUseFact[]> {
  const index = new Map<string, DefUseFact[]>();
  for (const fact of facts) {
    const key = `${fact.bindingIdx}:${fact.def.blockIndex}:${fact.def.stmtIndex}`;
    const bucket = index.get(key);
    if (bucket) bucket.push(fact);
    else index.set(key, [fact]);
  }
  return index;
}

/**
 * Walk every value from its seeds to the statements it reaches.
 *
 * **Monotone in the exclusion set**: a state is reprocessed only when it arrives carrying strictly fewer exclusions,
 * which is the only direction that makes it more dangerous. A state that arrives *more* neutralised than one already
 * processed is dropped, so the worklist always terminates and each statement is visited at most once per exclusion
 * count.
 */
export function propagate(
  cfg: FunctionCfg,
  defUseFacts: readonly DefUseFact[],
  seeds: readonly ReachState[],
  hooks: ReachHooks,
  options: ReachOptions,
): ReachOutcome {
  const byDefinition = indexFacts(defUseFacts);
  const constantDefs = cfg.stmtFacts.constantDefs;
  const deadLines = cfg.stmtFacts.unreachableLines;

  const worklist: ReachState[] = seeds.map((seed) => ({ ...seed, viaBlocks: [...seed.viaBlocks] }));
  const processed = new Map<string, number>();
  let factsProcessed = 0;
  let iterations = 0;
  let sanitizerKills = 0;

  while (worklist.length > 0 && iterations < options.maxIterations) {
    iterations++;
    const state = worklist.shift()!;

    const stateKey = `${state.bindingIdx}:${state.point.blockIndex}:${state.point.stmtIndex}`;
    const previous = processed.get(stateKey);
    if (previous !== undefined && previous <= state.exclusions.size) continue;
    processed.set(stateKey, state.exclusions.size);

    const uses = byDefinition.get(
      `${state.bindingIdx}:${state.point.blockIndex}:${state.point.stmtIndex}`,
    );
    if (!uses || uses.length === 0) continue;
    factsProcessed += uses.length;

    for (const use of uses) {
      // **A use on a line nothing reaches delivers nothing**, and its sink - if it has one - is not reported.
      if (deadLines?.has(use.use.line) === true) continue;

      // **A neutraliser on this statement runs before the call on it does.** `db.query(escape(req.body.id))` is one
      // statement: the sink and the neutraliser are both filed there, and the neutraliser is the inner expression.
      // The exclusions were accumulated *after* the sink was checked, so a statement that neutralised its own argument
      // reported the flow as live - which is what a report full of already-safe code looks like.
      //
      // **One place decides what a neutraliser cleans**, and this is a caller of it rather than a second copy: the
      // question "does this occurrence clean the value being carried" is asked here, when the seeds are built, and by
      // `neutralizedAt`. Two copies of it drifted apart once already.
      const here = neutralizedAt(
        options.sanitizers,
        keyOf(use.use.blockIndex, use.use.stmtIndex),
        nameOf(cfg, state.bindingIdx),
      );
      let exclusions = state.exclusions;
      const addsKind = [...here].some((kind) => !state.exclusions.has(kind));
      if (addsKind) {
        const widened = new Set(state.exclusions);
        for (const kind of here) widened.add(kind);
        exclusions = widened;
        sanitizerKills++;
      }

      const carried: ReachState =
        exclusions === state.exclusions ? state : { ...state, exclusions };
      hooks.onUse(carried, use);

      const definitions = definitionsAt(cfg, use.use.blockIndex, use.use.stmtIndex);
      if (definitions.length === 0) {
        hooks.onDeadEnd?.(carried, use);
        continue;
      }

      for (const definition of definitions) {
        // **A definition the file's arithmetic decides carries nothing**, because there is nothing in it to carry.
        if (constantDefs?.get(definition.point.stmtIndex)?.has(definition.bindingIdx) === true)
          continue;

        const verdict = hooks.onDefinition?.({
          state: carried,
          stmtIndex: definition.point.stmtIndex,
          line: use.use.line,
          bindingIdx: definition.bindingIdx,
        });
        if (verdict?.stop === true) continue;

        let inherited = exclusions;
        if (verdict?.neutralized !== undefined && verdict.neutralized.size > 0) {
          const merged = new Set(exclusions);
          for (const kind of verdict.neutralized) merged.add(kind);
          inherited = merged;
        }

        const next: ReachState = {
          bindingIdx: definition.bindingIdx,
          point: {
            blockIndex: use.use.blockIndex,
            stmtIndex: definition.point.stmtIndex,
            line: use.use.line,
          },
          exclusions: inherited,
          source: state.source,
          viaBlocks: [...state.viaBlocks, use.use.blockIndex],
        };

        const nextKey = `${next.bindingIdx}:${next.point.blockIndex}:${next.point.stmtIndex}`;
        const seen = processed.get(nextKey);
        if (seen === undefined || next.exclusions.size < seen) worklist.push(next);
      }
    }
  }

  return { factsProcessed, iterations, sanitizerKills };
}
