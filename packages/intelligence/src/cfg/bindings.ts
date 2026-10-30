// **A name is not a variable**, and this is the one place that decides which variable a spelling means.
//
// The def→use graph is keyed by binding index, and a binding is created per declaration — so the whole question "which
// declaration does this occurrence belong to" is answered here, once, rather than in each of the four places that used
// to answer it with `Map<name, index>` and silently take the first declaration of the name.
//
// **The rule is the language's own**: the innermost scope that contains the occurrence. `String value` inside one loop
// and `Element value` inside another are siblings, so neither contains the other's lines and the first declaration is
// invisible where the second is in force; a declaration in an enclosing block is visible in every block inside it,
// because containment is what visibility is. When a grammar answers no scope regions, every binding of a name is at the
// same scope and `binding.length === 1` short-circuits — which is exactly the behaviour that existed before scopes.

import type { BindingEntry } from './types.js';
import type { SourceRegion } from '@code-analyzer/analyzer';

/** One binding's scope, kept as the region its declaration's line sits in. */
interface ScopedBinding {
  readonly index: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Resolve one occurrence of a name to the binding it means.
 *
 * `line` is the occurrence's own line, which is the only thing that can tell two declarations of one spelling apart.
 * Answers `undefined` for a name no declaration in this function introduces, which is how a field or an outer
 * variable is refused — the analysis then has nothing to say about it rather than something wrong.
 */
export type BindingResolver = (name: string, line: number) => number | undefined;

/**
 * Build the resolver for one function's bindings.
 *
 * `scopes` is the function's own scope regions or `undefined` when the grammar answered nothing; absent means every
 * binding of a name is the same variable, which is the answer this analysis gave before scopes travelled with it.
 */
export function bindingResolver(
  bindings: readonly BindingEntry[],
  scopes: readonly SourceRegion[] | undefined,
): BindingResolver {
  const byName = new Map<string, ScopedBinding[]>();
  for (const binding of bindings) {
    const region = regionOf(binding, scopes);
    const list = byName.get(binding.name) ?? [];
    list.push({ index: binding.index, from: region.from, to: region.to });
    byName.set(binding.name, list);
  }

  return (name, line) => {
    const list = byName.get(name);
    if (list === undefined || list.length === 0) return undefined;
    // **A single binding needs no line.** Most names in most functions are declared once, and asking a question whose
    // answer cannot vary is work nobody asked for.
    if (list.length === 1) return list[0]!.index;

    let best: ScopedBinding | undefined;
    let span = Number.POSITIVE_INFINITY;
    let outermost: ScopedBinding = list[0]!;
    for (const candidate of list) {
      const width = candidate.to - candidate.from;
      if (width > outermost.to - outermost.from) outermost = candidate;
      if (line < candidate.from || line > candidate.to) continue;
      // The first containing candidate wins, then a narrower one replaces it: the widest scope has an infinite width,
      // and `Infinity < Infinity` would have left it unselected.
      if (best === undefined || width < span) {
        best = candidate;
        span = width;
      }
    }
    if (best !== undefined) return best.index;
    // **An occurrence outside every candidate's scope is still attributed to one of them rather than dropped.** The
    // grammars this project reads make that impossible for a local, and a provider whose captures are line-based can
    // still produce it — a parameter emitted on the signature line above the body block, for one. The outermost
    // candidate is the same answer the pre-scope model gave, so the fallback cannot be worse than what it replaced.
    return outermost.index;
  };
}

/** The scope region a binding's declaration sits in, or the whole file when the grammar answered nothing. */
function regionOf(
  binding: BindingEntry,
  scopes: readonly SourceRegion[] | undefined,
): SourceRegion {
  if (scopes === undefined || scopes.length === 0) return WHOLE_FILE;
  let best: SourceRegion | undefined;
  let span = Number.POSITIVE_INFINITY;
  for (const scope of scopes) {
    if (binding.declLine < scope.from || binding.declLine > scope.to) continue;
    const width = scope.to - scope.from;
    if (best === undefined || width < span) {
      best = scope;
      span = width;
    }
  }
  // A declaration outside every region is at the file's own level, which is what `WHOLE_FILE` says.
  return best ?? WHOLE_FILE;
}

/**
 * The region that contains every line, used where no scope was read and for a line no region contains.
 *
 * **Infinite bounds rather than the file's own extent**, because this value is compared by containment and by width
 * against real regions: `-Infinity`..`+Infinity` contains every region and is contained by none, which is exactly the
 * two answers a caller needs from "the outermost scope there is".
 */
export const WHOLE_FILE: SourceRegion = {
  from: Number.NEGATIVE_INFINITY,
  to: Number.POSITIVE_INFINITY,
};
