// The far side of the bridge: `FunctionCfg`s built from what the analyser actually has.
//
// Nothing in production constructed one. Every `FunctionCfg` in this repository came from a test fixture, which is
// why a 2,800-line subsystem — the propagator, the reaching-definitions analysis, the PDG builder, the pipeline and
// the solver — had never run on real input.
//
// This builds one per callable symbol: its name, file, line range, and the call sites computed from the resolved
// references. **Its `stmtFacts` is empty.** That is the honest state, not a placeholder to be filled later:

// - `defs` and `uses` need statement-level analysis over `ParsedFile.ast`, which is `unknown` and would need
//   per-language handling. That is a project, not a bridge, and it is recorded as such in the audit.
// - `sourceSites` and `sinkSites` need a source-and-sink model per language.
//
// So the propagator will find no flows through these yet. What becomes true is that `buildFunctionSummary` receives
// real functions with real call sites, and `resolved` becomes a question with an answer.

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { bindingResolver } from './bindings.js';
import { containerFlowOf } from './container-flow.js';
import { buildOccurrences, buildStatementFacts } from './statement-facts.js';

import type { ExtractedSanitizer, ExtractedSink, ExtractedSource } from './statement-facts.js';
import type { BindingEntry, DefinitionSite, FunctionCfg, StatementFacts } from './types.js';
import type { SourceRegion, ConstantFacts, ContainerCall } from '@code-analyzer/analyzer';
import type { CallSite, ParsedFile, SymbolDefinition, UnifiedCapture } from '@code-analyzer/shared';

/** One file's taint-relevant extraction: what the provider saw, and what its arithmetic decides. */
export interface ExtractedFileFacts {
  readonly sources: readonly ExtractedSource[];
  readonly sinks: readonly ExtractedSink[];
  readonly sanitizers?: readonly ExtractedSanitizer[];
  /**
   * The values the file's names can only hold, and the lines a constant condition closes.
   *
   * **Optional, and absent is the neutral answer**: an analysis with no reachability information keeps every
   * definition a may-definition, which is exactly the behaviour that existed before this field did.
   */
  readonly constants?: ConstantFacts;
  /**
   * The lines this file's functions hand a value back from, or `null` when the provider cannot read returns.
   *
   * **`undefined` and `null` are different answers.** `undefined` means nobody asked; a set - even an empty one - means
   * the file was read and these are the lines. Only the second lets a summary say "this function's returns do not
   * read that parameter", which is the fact a caller needs to stop assuming that every call passes its argument
   * through.
   */
  readonly returnLines?: readonly number[] | null;
  /**
   * The calls this file makes on a container it owns, or `null` when the provider cannot read its calls.
   *
   * **Optional, and absent means no container is followed**: every value handed to a collection stays "lost" to the
   * summary, which is the answer that was given before this field existed.
   */
  readonly containerCalls?: readonly ContainerCall[] | null;
  /**
   * The line ranges this file's statements may not run in, or `null` when the provider cannot read its branches.
   *
   * **`undefined` is not `[]`**: absent means no statement can be called unconditional, so every definition stays a
   * may-definition; an empty list means the file has no branch at all, so every definition is a kill.
   */
  readonly conditionalRegions?: readonly SourceRegion[] | null;
  /**
   * The ranges of the statements that compute a value and keep none of it, or `null` when the provider cannot read
   * their shape.
   *
   * **`undefined` is not `[]`, and the two answers are opposites.** An empty list says no statement in this file throws
   * a value away, so every value that leaves the def→use graph left it for good and a callee may say "no". Absent
   * says the shapes could not be read, so a value that vanishes may have gone into a side effect the model cannot see,
   * and the summary keeps the conservative answer.
   */
  readonly discardedValueRegions?: readonly SourceRegion[] | null;
  /**
   * The line ranges of this file's name scopes, or `null` when the provider cannot read its blocks.
   *
   * **A name is not a variable, and this is the fact that separates them.** `String value` inside one loop and
   * `Element value` inside another are two variables sharing a spelling; without this the first one's taint reaches the
   * second one's sink, which was the last two false positives OWASP Benchmark had to offer. Absent or `null` means one
   * variable per name, which is the model that existed before this question was asked.
   */
  readonly scopeRegions?: readonly SourceRegion[] | null;
}

/** Symbol kinds that become a function CFG. Shared with the call-site builder by intent, not by import. */
const CALLABLE_KINDS = new Set(['Function', 'Method', 'ArrowFunction', 'Constructor']);

/**
 * Build one `FunctionCfg` per callable symbol, keyed by qualified name.
 *
 * @param parsedFiles the parsed files, whose symbols give names and line ranges
 * @param callSites call sites keyed by the same qualified names, from `buildCallSites`
 */
export function buildFunctionCfgs(
  parsedFiles: readonly ParsedFile[],
  callSites: ReadonlyMap<string, CallSite[]>,
  extraction?: ReadonlyMap<string, ExtractedFileFacts>,
): Map<string, FunctionCfg> {
  const out = new Map<string, FunctionCfg>();

  for (const parsed of parsedFiles) {
    for (const symbol of parsed.symbols) {
      if (!CALLABLE_KINDS.has(symbol.kind)) continue;
      if (typeof symbol.qualifiedName !== 'string' || symbol.qualifiedName.length === 0) continue;

      const endLine = Math.max(symbol.endLine, symbol.startLine);

      // The captures are on the parsed file rather than in a tree — `ast` carries the provider's capture array, and
      // this is the one place in the taint path that has to reach for it. The cast is required because the field is
      // typed `unknown`, which is honest: nothing guarantees its shape except the parse phase that wrote it.
      const captures = (parsed.ast as UnifiedCapture[] | undefined) ?? [];
      // Sources and sinks come from the provider extraction rather than the captures, and are joined to the bindings
      // derived below, by line. A file the extraction found nothing in simply contributes nothing.
      const perFile = extraction?.get(parsed.filePath);
      const { bindings, stmtFacts } = buildStatementFacts(
        captures,
        symbol.startLine,
        endLine,
        // `?? undefined` rather than `?? []`: a provider that could not answer leaves every definition a maybe, and a
        // provider that answered "no branches" makes every definition a kill. The two are different facts.
        perFile?.conditionalRegions ?? undefined,
        // The same `undefined` distinction as the branches: a provider that answered nothing leaves one binding per
        // name, and a provider that answered `[]` says the function body is the whole scope - which is what Python
        // means and what JavaScript honestly answers while `var` is in the grammar.
        perFile?.scopeRegions ?? undefined,
      );
      const occurrences = buildOccurrences(
        perFile?.sources ?? [],
        perFile?.sinks ?? [],
        perFile?.sanitizers ?? [],
        bindings,
        symbol.startLine,
        // The defs just derived, so a source that writes an existing variable is bound to that variable rather than
        // dropped for want of a declaration on its line.
        stmtFacts.defs,
      );

      const cfg: FunctionCfg = {
        functionName: symbol.name,
        filePath: parsed.filePath,
        startLine: symbol.startLine,
        startColumn: 0,
        // One block spanning the function: without a statement map there is nothing else to say about its shape.
        blocks: [
          {
            index: 0,
            startLine: symbol.startLine,
            endLine,
            statementCount: endLine - symbol.startLine + 1,
            isEntry: true,
            isExit: true,
          },
        ],
        edges: [],
        // Bindings and def/use facts come from the captures, derived by `buildStatementFacts`. **Source and sink
        // sites are still empty** — the capture vocabulary has no source-and-sink tags yet, so the propagator has no
        // sources and produces no findings. That is the half still missing, and it is the only part of this object
        // that is a placeholder.
        bindings,
        stmtFacts: withReachability(
          stmtFacts,
          occurrences,
          bindings,
          perFile?.constants,
          symbol.startLine,
          callSites.get(symbol.qualifiedName) ?? [],
          returnsFor(perFile?.returnLines, symbol.startLine, endLine),
        ),
        // **`BindingEntry.parameterIndex` is the answer when the provider recorded one**, and it is the only answer a
        // call site can agree with: the caller passes argument 1 and the callee's argument 1 is whatever it declared
        // second. The fallback is the signature line, which is right for a one-line declaration and wrong for the
        // wrapped signature every servlet in the corpus uses - there the parameters sit on the *second* line of the
        // declaration and none were found at all.
        parameterBindings: parameterBindingsOf(bindings, symbol.startLine),
        entryIndex: 0,
        exitIndex: 0,
        callSites: attachArgumentBindings(
          callSites.get(symbol.qualifiedName) ?? [],
          captures,
          bindings,
          symbol.startLine,
          endLine,
          // **A call's arguments are the declarations its own line sees.** With two `list`s in one function, the first
          // declaration of the name is not the one at the call.
          perFile?.scopeRegions ?? undefined,
        ),
      };

      // **The container model runs last, because it reads the facts the rest of this function just built** - the defs
      // that say when a receiver is a new object, and the line range that says which calls are this function's. It
      // returns the same object when the file has no container calls, so a repository with none allocates nothing.
      const flow = containerFlowOf(
        cfg,
        perFile?.containerCalls,
        perFile?.conditionalRegions,
        perFile?.scopeRegions ?? undefined,
      );
      out.set(symbol.qualifiedName, {
        ...cfg,
        stmtFacts: flow.stmtFacts,
        containerFollowed: flow.followed,
        // **A `null` region list is not carried as an empty one.** The provider answering `null` means the grammar
        // could not read the statement shapes, and the summary has to keep assuming that a vanishing value may have
        // gone somewhere it cannot see; carrying `[]` instead would turn "unknown" into "nothing discards".
        ...(perFile?.discardedValueRegions == null
          ? {}
          : { discardedValueRegions: perFile.discardedValueRegions }),
      });
    }
  }

  return out;
}

/**
 * Which bindings are this function's parameters, in argument order.
 *
 * **A parameter's position is what a call site agrees with.** The caller passes argument 1; the callee's argument 1 is
 * whatever it declared second. Two rules produce that list, and the first is the one that is right:
 *
 *   1. `BindingEntry.parameterIndex`, which the provider records when it emits the parameter's definition.
 *   2. The signature's first line, which is right for `void m(int a, int b)` and wrong for the wrapped signature every
 *      servlet in the corpus uses - `void doPost(HttpServletRequest request,` on one line and
 *      `HttpServletResponse response)` on the next leaves the parameters on the *second* line, and a rule that looked
 *      only at the first found none of them.
 *
 * The fallback is kept rather than deleted because a provider that cannot say the position still knows more than
 * nothing, and the arity check downstream turns a wrong answer into no answer.
 */
function parameterBindingsOf(bindings: readonly BindingEntry[], startLine: number): number[] {
  const recorded = bindings
    .filter((b) => b.parameterIndex !== undefined)
    .sort((a, b) => (a.parameterIndex ?? 0) - (b.parameterIndex ?? 0));
  if (recorded.length > 0) return recorded.map((b) => b.index);
  return bindings.filter((b) => b.declLine === startLine).map((b) => b.index);
}

/**
 * The statement facts, plus what the file's arithmetic says about which definitions can carry a value at all.
 *
 * **The join is by name and scope, not by line.** A constant is recorded against the callable it was written in and
 * the name it was written to; the definitions it applies to are wherever that name is defined. `String bar;` declares
 * on one line and `bar = (7 * 18) + num > 200 ? "constant" : param` writes on another, and it is the write that folds.
 */
function withReachability(
  stmtFacts: StatementFacts,
  occurrences: Pick<StatementFacts, 'sourceSites' | 'sinkSites' | 'sanitizerSites'>,
  bindings: readonly BindingEntry[],
  constants: ConstantFacts | undefined,
  startLine: number,
  calls: readonly CallSite[],
  returnLines: ReadonlySet<number> | undefined,
): StatementFacts {
  const withSites: StatementFacts = {
    ...stmtFacts,
    ...occurrences,
    ...(returnLines === undefined ? {} : { returnLines }),
  };
  // **No reachability information leaves the facts exactly as they were**, which is the neutral answer: every
  // definition stays a may-definition and nothing is suppressed on a guess.
  if (constants === undefined) return withSites;

  const constantDefs = new Map<number, Set<number>>();
  for (const [stmtIndex, sites] of stmtFacts.defs) {
    const line = startLine + stmtIndex;
    for (const site of sites) {
      if (!isConstantDefinition(bindings, constants, site, startLine, line, calls)) continue;
      const bucket = constantDefs.get(stmtIndex) ?? new Set<number>();
      bucket.add(site.bindingIdx);
      constantDefs.set(stmtIndex, bucket);
    }
  }

  return { ...withSites, constantDefs, unreachableLines: constants.unreachableLines };
}

/**
 * Whether this definition writes a value nothing else can be.
 *
 * **Two ways to be a constant, and they are the same fact from different distances.** The name holds one value because
 * the file's arithmetic says so (`bar = (7 * 18) + num > 200 ? "constant" : param`), or because the value comes from a
 * call to a function whose own returns all fold to one (`bar = new Test().doSomething(request, param)`). The second is
 * the OWASP `helper` shape, and without it the argument's taint is assumed to reach the caller's name.
 */
function isConstantDefinition(
  bindings: readonly BindingEntry[],
  constants: ConstantFacts,
  site: DefinitionSite,
  startLine: number,
  line: number,
  calls: readonly CallSite[],
): boolean {
  const name = bindings[site.bindingIdx]?.name;
  if (name !== undefined && constants.constants.has(`${startLine}:${name}`)) return true;
  if (constants.constantReturns.size === 0) return false;
  return calls.some((call) => call.line === line && constants.constantReturns.has(call.calleeName));
}

/**
 * The returns that belong to one function.
 *
 * A file's return lines are a single set; a function's are the ones inside its own line range. **`undefined` when the
 * provider could not read them, which is not the same as an empty set**: a function with no return at all has been read
 * and hands nothing back, and a function whose returns could not be read is a function nothing may be claimed about.
 */
function returnsFor(
  lines: readonly number[] | null | undefined,
  startLine: number,
  endLine: number,
): ReadonlySet<number> | undefined {
  if (lines === undefined || lines === null) return undefined;
  const own = new Set<number>();
  for (const line of lines) if (line >= startLine && line <= endLine) own.add(line);
  return own;
}

/** Whether a symbol becomes a CFG, so a caller can filter without duplicating the set. */
export function isCallableSymbol(symbol: SymbolDefinition): boolean {
  return CALLABLE_KINDS.has(symbol.kind);
}

/**
 * Fill in each call site's `argBindings` from the captures.
 *
 * `CallSite.argBindings` has said since it was written that an empty array means the positions are **not known**,
 * and that callers must not treat that as "all arguments are -1". Nothing filled it, so every call site was empty
 * and the summary builder hardcoded `argIndex: 0` — the one thing the contract forbids.
 *
 * The arguments of a call are the captures on the call's line that name a binding: the JavaScript provider emits a
 * `VARIABLE_ACCESS` per argument, and `buildStatementFacts` has already turned those names into binding indices. **A
 * binding is only passed at one position, so the index of the first match is that position.**
 *
 * A call whose arguments are not bindings — a literal, an expression — gets -1 at that position, which is what the
 * field documents. `argBindings.length` is therefore the arity, which is what `argCount` reads.
 */
function attachArgumentBindings(
  sites: readonly CallSite[],
  captures: readonly UnifiedCapture[],
  bindings: readonly BindingEntry[],
  startLine: number,
  endLine: number,
  scopes?: readonly SourceRegion[],
): CallSite[] {
  if (sites.length === 0) return [];

  const resolve = bindingResolver(bindings, scopes);

  // Argument reads, per line, in document order.
  //
  // **And the argument each one sits in, where the capture says so.** Document order alone cannot tell a name inside
  // one argument from a second argument, which is what a template literal makes visible: two substitutions in one
  // argument were read as two arguments, and the taint was then looked for at a parameter the callee does not have.
  const accessesByLine = new Map<number, string[]>();
  const argIndexByLine = new Map<number, Map<string, number>>();
  for (const capture of captures) {
    if (capture.tag !== CAPTURE_TAGS.VARIABLE_ACCESS || !capture.name) continue;
    if (capture.startLine < startLine || capture.startLine > endLine) continue;
    const names = accessesByLine.get(capture.startLine) ?? [];
    names.push(capture.name);
    accessesByLine.set(capture.startLine, names);
    const raw = (capture.properties as { argIndex?: string } | undefined)?.argIndex;
    const recorded = raw === undefined ? undefined : Number(raw);
    if (recorded !== undefined) {
      const perLine = argIndexByLine.get(capture.startLine) ?? new Map<string, number>();
      if (!perLine.has(capture.name)) perLine.set(capture.name, recorded);
      argIndexByLine.set(capture.startLine, perLine);
    }
  }

  return sites.map((site) => {
    const names = accessesByLine.get(site.line);
    if (!names || names.length === 0) return site;
    const recorded = argIndexByLine.get(site.line);
    if (recorded && recorded.size > 0) {
      // One entry per distinct argument, in the order the arguments appear.
      const positions = new Map<number, string>();
      for (const name of names) {
        const index = recorded.get(name);
        if (index !== undefined && !positions.has(index)) positions.set(index, name);
      }
      if (positions.size > 0) {
        // **Every binding in the call, each with the argument it sits in.** The first of an argument is what aligns
        // with a parameter; the rest are carried alongside so a taint on any of them can be found by its argument.
        const flat: Array<{ argument: number; name: string }> = [];
        for (const name of names) {
          const argument = recorded.get(name);
          if (argument !== undefined) flat.push({ argument, name });
        }
        const ordered = flat.sort((a, b) => a.argument - b.argument);
        const bindings: number[] = [];
        const argumentsOf: number[] = [];
        for (const entry of ordered) {
          const index = resolve(entry.name, site.line);
          if (index === undefined) continue;
          bindings.push(index);
          argumentsOf.push(entry.argument);
        }
        if (bindings.length > 0) {
          return { ...site, argBindings: bindings, argArguments: argumentsOf };
        }
      }
    }
    return { ...site, argBindings: names.map((name) => resolve(name, site.line) ?? -1) };
  });
}
