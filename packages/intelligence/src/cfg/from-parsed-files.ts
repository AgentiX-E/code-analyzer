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

import { buildOccurrences, buildStatementFacts } from './statement-facts.js';

import type { ExtractedSanitizer, ExtractedSink, ExtractedSource } from './statement-facts.js';
import type { BindingEntry, FunctionCfg } from './types.js';
import type { CallSite, ParsedFile, SymbolDefinition, UnifiedCapture } from '@code-analyzer/shared';

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
  extraction?: ReadonlyMap<
    string,
    { sources: readonly ExtractedSource[]; sinks: readonly ExtractedSink[]; sanitizers?: readonly ExtractedSanitizer[] }
  >,
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
      const { bindings, stmtFacts } = buildStatementFacts(captures, symbol.startLine, endLine);

      // Sources and sinks come from the provider extraction rather than the captures, and are joined to the bindings
      // just derived, by line. A file the extraction found nothing in simply contributes nothing.
      const perFile = extraction?.get(parsed.filePath);
      const occurrences = buildOccurrences(
        perFile?.sources ?? [],
        perFile?.sinks ?? [],
        perFile?.sanitizers ?? [],
        bindings,
        symbol.startLine,
      );

      out.set(symbol.qualifiedName, {
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
        stmtFacts: {
          ...stmtFacts,
          sourceSites: occurrences.sourceSites,
          sinkSites: occurrences.sinkSites,
          sanitizerSites: occurrences.sanitizerSites,
        },
        entryIndex: 0,
        exitIndex: 0,
        callSites: attachArgumentBindings(
          callSites.get(symbol.qualifiedName) ?? [],
          captures,
          bindings,
          symbol.startLine,
          endLine,
        ),
      });
    }
  }

  return out;
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
): CallSite[] {
  if (sites.length === 0) return [];

  const bindingByName = new Map<string, number>();
  for (const binding of bindings) bindingByName.set(binding.name, binding.index);

  // Argument reads, per line, in document order.
  const accessesByLine = new Map<number, string[]>();
  for (const capture of captures) {
    if (capture.tag !== CAPTURE_TAGS.VARIABLE_ACCESS || !capture.name) continue;
    if (capture.startLine < startLine || capture.startLine > endLine) continue;
    const names = accessesByLine.get(capture.startLine) ?? [];
    names.push(capture.name);
    accessesByLine.set(capture.startLine, names);
  }

  return sites.map((site) => {
    const names = accessesByLine.get(site.line);
    if (!names || names.length === 0) return site;
    return { ...site, argBindings: names.map((name) => bindingByName.get(name) ?? -1) };
  });
}
