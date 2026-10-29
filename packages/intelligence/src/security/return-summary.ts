// What a function hands back, per argument position.
//
// **This is the fact that turns "every call taints its result" into a claim.** `bar = helper(param)` writes `bar` from a
// statement that read `param`, and the propagator's conservative reading is that `bar` inherits it — sound, and useless
// in any codebase where a getter or a builder sits between the input and the sink. The only place the answer exists is
// inside the callee, so the callee has to be asked: *can this parameter reach a return, and if so, having passed through
// what?*
//
// A summary is per **argument position**, not per name, because that is the only thing a call site agrees with. The
// caller passes argument 1; the callee's argument 1 is whatever it declared second (`BindingEntry.parameterIndex`).
//
// **`known` is the difference between a fact and a gap.** A provider that cannot read a grammar's returns reports
// `null`, and a summary built from `null` says nothing at all: "no return reads this parameter" is a statement only
// where the returns were read in the first place.

import { TaintPropagator } from './taint-propagator.js';

import type {
  DefUseFact,
  FunctionCfg,
  TaintReturnFlow,
  TaintSourceOccurrence,
} from '../cfg/types.js';

/** What one argument position can hand back. */
export interface ParameterReturn {
  /** The lines a value from this position can leave by; empty when it cannot leave at all. */
  readonly lines: ReadonlySet<number>;
  /** Sink kinds neutralised on every path from the parameter to a return - the escaping a callee applies. */
  readonly neutralized: ReadonlySet<string>;
}

/** A function's return behaviour, as far as the file's own facts decide it. */
export interface ReturnSummary {
  /** Whether the function's returns were read at all. False means nothing may be concluded from this summary. */
  readonly known: boolean;
  /** One entry per parameter position. A position with no entry is not a parameter of this function. */
  readonly byParameter: ReadonlyMap<number, ParameterReturn>;
  /** What the function's own sources can hand back, which no argument can explain. */
  readonly ownSource: ParameterReturn;
  /**
   * Categories of the sources those returns hand back.
   *
   * **A callee that reads the input itself is a source for its caller**, and this set is the only place that fact
   * survives: the caller passed a request object, not a value, so nothing on its side can say the result is tainted.
   * Empty means the function returns no source of its own, which is a different statement from "nobody looked".
   */
  readonly ownCategories: ReadonlySet<string>;
  /**
   * Argument positions whose value disappeared into a call that writes no name.
   *
   * **These are the positions a "no" cannot be given for.** A value that reaches `map.put("k", param)` is not lost to
   * the program, only to this model: the collection hands it back through a `get` that no def→use edge connects, and
   * declaring the argument clean because the walk saw nothing is how a real vulnerability goes quiet. Measured: 104 of
   * the corpus's true positives were exactly this, and every one of them was a value written into a map.
   */
  readonly lost: ReadonlySet<number>;
  /** Whether a value the function read for itself disappeared the same way. */
  readonly ownLost: boolean;
}

/** The summary of a function whose returns nobody read, which concludes nothing. */
export const UNKNOWN_RETURNS: ReturnSummary = {
  known: false,
  byParameter: new Map(),
  ownSource: { lines: new Set(), neutralized: new Set() },
  ownCategories: new Set(),
  lost: new Set(),
  ownLost: false,
};

/**
 * Summarize one function's returns against each of its argument positions.
 *
 * **One propagation run, with every parameter seeded at once.** Each parameter is seeded as a source of its own, with
 * its own binding index, so the flows come back labelled by position rather than by name — and a parameter's source is
 * the one kind of source that seeds exactly one definition, which is what makes two parameters declared on the same
 * line distinguishable at all.
 *
 * The run is **unrefined**: it does not consult other functions' summaries, so it over-approximates what a parameter
 * reaches. That is the safe direction here — an over-approximated carry means a caller keeps a flow it might not need,
 * whereas an under-approximated one would silence a real one.
 */
export function summarizeReturns(
  cfg: FunctionCfg,
  defUseFacts: readonly DefUseFact[],
): ReturnSummary {
  const returnLines = cfg.stmtFacts.returnLines;
  if (returnLines === undefined) return UNKNOWN_RETURNS;

  const parameters = cfg.parameterBindings ?? [];
  const occurrences: TaintSourceOccurrence[] = [];
  for (const [position, bindingIdx] of parameters.entries()) {
    const declaration = cfg.bindings[bindingIdx];
    if (!declaration) continue;
    occurrences.push({
      bindingIdx,
      point: {
        blockIndex: 0,
        stmtIndex: declaration.declLine - cfg.startLine,
        line: declaration.declLine,
      },
      // **A category no provider can produce**, so the walk can tell "a value the function read" from "a value it was
      // handed", and only the second is a position a caller can match.
      category: 'parameter',
      description: `${declaration.name} is argument ${position}`,
      line: declaration.declLine,
    });
  }

  const positionOf = new Map<number, number>();
  for (const [position, bindingIdx] of parameters.entries()) positionOf.set(bindingIdx, position);

  // **Where a value can disappear, and which binding it was.** A statement that reads the value and writes no name is
  // the only place the walk cannot follow it, and the summary records it per position so a caller can refuse to
  // conclude anything from the silence.
  const lost = new Set<number>();
  let ownLost = false;
  // **Only a call can keep a value, and only a line that is not a return can lose it.** `if (param != null)` reads the
  // value and stores nothing, and `return helper(param)` hands it back rather than hiding it - neither is a place the
  // walk failed to follow the value, and treating them as one would disable every summary in the corpus.
  const callLines = new Set((cfg.callSites ?? []).map((call) => call.line));
  const returnsHere = returnLines;

  // **The walk runs even when the function declares no parameters.** It was gated on the parameter sources, and that
  // gate is why "a function that reads the input and returns it" reported nothing at all: with no parameter there were
  // no occurrences to seed, so the propagator never ran, so no return flow was collected — the generative half was empty
  // by construction rather than by policy. The propagator seeds the file's own sources itself, and returns early when
  // there are none, so the unconditional call costs nothing on a function that reads nothing.
  const result: { returnFlows: readonly TaintReturnFlow[] } = new TaintPropagator().analyze(
    cfg,
    defUseFacts,
    {
      extraSources: occurrences.map((occurrence) => ({ occurrence })),
      onLost: (state, use) => {
        if (!callLines.has(use.use.line) || returnsHere.has(use.use.line)) return;
        const position = positionOf.get(state.source.bindingIdx);
        if (position === undefined) ownLost = true;
        else lost.add(position);
      },
    },
  );

  // **One entry per declared position, in position order.** The map a caller reads is derived from this list, so a
  // position a flow resolves to is a position that has an entry: `positionOf` and the entries are built from the same
  // parameter list, and the lookup in the loop below therefore has no missing case to guard.
  const entries: MutableReturn[] = parameters.map(() => ({
    lines: new Set<number>(),
    neutralized: new Set<string>(),
  }));
  const ownSource: MutableReturn = { lines: new Set(), neutralized: new Set() };
  // **The categories, not just the lines.** A caller that receives this value has no source of its own to report, so the
  // category of the one the callee read is what tells it the value is untrusted rather than merely returned.
  const ownCategories = new Set<string>();

  for (const flow of result.returnFlows) {
    const position = positionOf.get(flow.source.bindingIdx);
    if (flow.source.category !== 'parameter') ownCategories.add(flow.source.category);
    const target = position === undefined ? ownSource : entries[position]!;
    target.lines.add(flow.line);
    for (const kind of flow.neutralized) target.neutralized.add(kind);
  }

  return {
    known: true,
    byParameter: new Map(entries.entries()),
    ownSource,
    ownCategories,
    lost,
    ownLost,
  };
}

/** A summary entry under construction. */
interface MutableReturn {
  readonly lines: Set<number>;
  readonly neutralized: Set<string>;
}
