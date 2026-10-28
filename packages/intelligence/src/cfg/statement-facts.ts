// `stmtFacts` and `bindings` from the captures the pipeline already produces.
//
// This was described as "statement-level analysis over an untyped AST" for two days. Reading it found something
// narrower: `ParsedFile.ast` holds the provider's **capture array**, not a tree, and `groupCaptures` already turns
// those captures into symbols and references by switching on `capture.tag`. The tags this needs are in the
// vocabulary:
//
//   definitions  VARIABLE_DEF, CONSTANT_DEF, PROPERTY_DEF
//   uses         VARIABLE_ACCESS, FUNCTION_CALL, METHOD_CALL
//
// So the def/use half of `stmtFacts` is a derivation over data that already flows, and the captures are already
// handled — mapped to `NodeLabel`s and reference kinds, but never to bindings. This module adds that mapping.
//
// **Source and sink sites are not here**, because `CAPTURE_TAGS` has no source-and-sink vocabulary. That half needs
// new tags from the per-language queries, and without them the propagator has no sources, so no findings.

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type {
  BindingEntry,
  DefinitionSite,
  StatementFacts,
  TaintSinkOccurrence,
  SanitizerOccurrence,
  TaintSourceOccurrence,
  UseSite,
} from './types.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

/** The key convention `computeReachingDefinitions` and `TaintPropagator` share. */
const STRIDE = 1024;

/** Captures that introduce a binding. */
const DEFINITION_TAGS: readonly string[] = [
  CAPTURE_TAGS.VARIABLE_DEF,
  CAPTURE_TAGS.CONSTANT_DEF,
  CAPTURE_TAGS.PROPERTY_DEF,
];

/** Captures that read a binding. */
const USE_TAGS: readonly string[] = [CAPTURE_TAGS.VARIABLE_ACCESS];

function isWithin(line: number, startLine: number, endLine: number): boolean {
  return line >= startLine && line <= endLine;
}

/**
 * Derive one function's bindings and statement facts from a file's captures.
 *
 * **`stmtIndex` is the statement's line relative to the function's first line.** The CFG this repository builds has
 * a single block spanning the function, and its `statementCount` is that same span, so a line-relative index is the
 * one convention consistent with the block it keys into — and it is stable under edits above the function, which an
 * ordinal over captures would not be.
 *
 * A capture past `STRIDE` lines into its function is skipped rather than wrapped: `blockIndex * STRIDE + stmtIndex`
 * would otherwise collide with a later block's statement. The guard exists so the collision cannot happen silently.
 *
 * `declColumn` is 0 for every binding: `UnifiedCapture` carries byte offsets rather than columns, and a column
 * invented from an offset would be wrong in a file with tabs.
 */
export function buildStatementFacts(
  captures: readonly UnifiedCapture[],
  startLine: number,
  endLine: number,
): { bindings: BindingEntry[]; stmtFacts: StatementFacts } {
  const bindings: BindingEntry[] = [];
  const byName = new Map<string, number>();
  const defs = new Map<number, DefinitionSite[]>();
  const uses = new Map<number, UseSite[]>();

  const key = (line: number): number | null => {
    const stmtIndex = line - startLine;
    if (stmtIndex < 0 || stmtIndex >= STRIDE) return null;
    return stmtIndex;
  };

  // Definitions first, so a use on the same line as its definition still finds the binding.
  for (const capture of captures) {
    if (!DEFINITION_TAGS.includes(capture.tag)) continue;
    if (!capture.name || !isWithin(capture.startLine, startLine, endLine)) continue;
    if (byName.has(capture.name)) continue;

    const index = bindings.length;
    bindings.push({
      index,
      name: capture.name,
      // Parameters are not among the captures, so every binding is a local. Recorded rather than guessed: a
      // param kind here would claim knowledge this data does not have.
      kind: 'local',
      declLine: capture.startLine,
      declColumn: 0,
      synthetic: false,
    });
    byName.set(capture.name, index);
  }

  for (const capture of captures) {
    if (!DEFINITION_TAGS.includes(capture.tag)) continue;
    if (!capture.name || !isWithin(capture.startLine, startLine, endLine)) continue;
    const bindingIdx = byName.get(capture.name);
    const stmtIndex = key(capture.startLine);
    if (bindingIdx === undefined || stmtIndex === null) continue;

    const sites = defs.get(stmtIndex) ?? [];
    sites.push({
      point: { blockIndex: 0, stmtIndex, line: capture.startLine },
      bindingIdx,
      // **Every definition here is a *may*-definition, because this CFG has one block spanning the whole function.**
      // A must-definition kills the ones before it, which is only sound when the statement is on the only path that
      // reaches the next read. Here nothing knows whether a statement sits inside an `if`: `param = request.getParameter(...)`
      // followed by `if (param == null) param = "";` recorded the guarded assignment as a kill, and the tainted
      // definition it guarded was gone by the time the sink read the name — which is OWASP Benchmark's most common
      // three lines, and the largest single reason a miss shared a function with its source.
      kind: 'may',
    });
    defs.set(stmtIndex, sites);
  }

  for (const capture of captures) {
    if (!USE_TAGS.includes(capture.tag)) continue;
    if (!capture.name || !isWithin(capture.startLine, startLine, endLine)) continue;
    const bindingIdx = byName.get(capture.name);
    const stmtIndex = key(capture.startLine);
    if (bindingIdx === undefined || stmtIndex === null) continue;

    const sites = uses.get(stmtIndex) ?? [];
    sites.push({ point: { blockIndex: 0, stmtIndex, line: capture.startLine }, bindingIdx });
    uses.set(stmtIndex, sites);
  }

  return {
    bindings,
    stmtFacts: {
      defs,
      uses,
      sourceSites: new Map(),
      sinkSites: new Map(),
      sanitizerSites: new Map(),
    },
  };
}

// ---------------------------------------------------------------------------
// Sources and sinks, from the provider extraction
// ---------------------------------------------------------------------------

/**
 * The part of an extracted source this needs.
 *
 * Structural rather than imported: `TaintSource` lives in `@code-analyzer/analyzer`, which this package depends on —
 * so the import would work — but taking only the fields used keeps the join testable without constructing one, and
 * makes it obvious which fields it reads.
 */
export interface ExtractedSource {
  readonly sourceType: string;
  readonly line: number;
  readonly text: string;
}

/** The same for a sink. */
export interface ExtractedSink {
  readonly sinkType: string;
  readonly line: number;
  readonly text: string;
}

/** The same for a sanitizer, whose type names what it neutralises. */
export interface ExtractedSanitizer {
  readonly sanitizerType: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Sources and sinks, keyed the way the propagator reads them.
 *
 * `TaintSourceOccurrence.bindingIdx` is required, and the extraction names the **source expression** rather than the
 * binding that receives it — `process.env.API_KEY`, not `key`. The join is therefore by line: **a source at line N
 * belongs to the binding declared at line N**, which is what `const key = process.env.API_KEY` produces.
 *
 * **A source whose line declares no binding is skipped, not given `-1`.** A taint fact pointing at a binding index
 * that does not exist would send the analysis somewhere arbitrary; a dropped one is a gap the count shows. `sinks`
 * needs no binding, so every extracted sink is kept.
 */
export function buildOccurrences(
  sources: readonly ExtractedSource[],
  sinks: readonly ExtractedSink[],
  sanitizers: readonly ExtractedSanitizer[],
  bindings: readonly BindingEntry[],
  startLine: number,
  /**
   * What each statement defines, keyed by statement index — the same map the CFG carries.
   *
   * **A source's line often declares nothing and writes a variable that already exists.** The corpus that exposed
   * this is OWASP Benchmark's cookie vector:
   *
   *     String param = "";                                             // line 47, declares param
   *     param = java.net.URLDecoder.decode(theCookie.getValue(), "UTF-8");  // line 51, assigns it
   *
   * The source is the `getValue()` on line 51, the binding it taints is `param`, and the only thing that connects
   * them is the def this statement records — the declaration is four lines up. Joining by declaration alone dropped
   * that source, and with it every flow the cookie vectors carry.
   */
  definitions?: ReadonlyMap<number, readonly { readonly bindingIdx: number }[]>,
): {
  sourceSites: Map<number, TaintSourceOccurrence>;
  sinkSites: Map<number, TaintSinkOccurrence>;
  sanitizerSites: Map<number, SanitizerOccurrence>;
} {
  const sourceSites = new Map<number, TaintSourceOccurrence>();
  const sinkSites = new Map<number, TaintSinkOccurrence>();
  const sanitizerSites = new Map<number, SanitizerOccurrence>();

  const bindingAt = new Map<number, number>();
  for (const binding of bindings) bindingAt.set(binding.declLine, binding.index);

  // Where this statement writes a binding that was declared elsewhere. A declaration wins when both exist, because
  // the declaration is the one on the same line by construction.
  const definedAt = new Map<number, number>();
  if (definitions) {
    for (const [stmtIndex, sites] of definitions) {
      const line = startLine + stmtIndex;
      const first = sites[0];
      if (first && !bindingAt.has(line)) definedAt.set(line, first.bindingIdx);
    }
  }

  const stmtIndexFor = (line: number): number | null => {
    const stmtIndex = line - startLine;
    return stmtIndex < 0 || stmtIndex >= STRIDE ? null : stmtIndex;
  };

  for (const source of sources) {
    const stmtIndex = stmtIndexFor(source.line);
    const bindingIdx = bindingAt.get(source.line) ?? definedAt.get(source.line);
    if (stmtIndex === null || bindingIdx === undefined) continue;

    sourceSites.set(stmtIndex, {
      bindingIdx,
      point: { blockIndex: 0, stmtIndex, line: source.line },
      category: source.sourceType,
      description: source.text,
      line: source.line,
    });
  }

  for (const sink of sinks) {
    const stmtIndex = stmtIndexFor(sink.line);
    if (stmtIndex === null) continue;

    sinkSites.set(stmtIndex, {
      point: { blockIndex: 0, stmtIndex, line: sink.line },
      kind: sink.sinkType,
      description: sink.text,
      line: sink.line,
    });
  }

  // Sanitizers need no binding, as sinks do not: what matters is which line they sit on, because the propagator asks
  // whether one lies on the path between a source and a sink.
  for (const sanitizer of sanitizers) {
    const stmtIndex = stmtIndexFor(sanitizer.line);
    if (stmtIndex === null) continue;

    sanitizerSites.set(stmtIndex, {
      point: { blockIndex: 0, stmtIndex, line: sanitizer.line },
      neutralizedKinds: new Set([sanitizer.sanitizerType]),
      description: sanitizer.text,
    });
  }

  return { sourceSites, sinkSites, sanitizerSites };
}
