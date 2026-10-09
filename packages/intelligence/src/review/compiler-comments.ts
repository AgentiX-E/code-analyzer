// The compiler's diagnostics, in the shape the review stream already speaks.
//
// **The wiring that turns an audited gap into a finding.** The capability landed in `packages/analyzer` and **produced
// nothing a reviewer would see** - which is **the seventh time this stretch has found a fact that existed and was one
// connection short.** This is the connection: a converter that sits **beside `standardsToComments`**, because it is
// the same job on a different source.
//
// **And it quotes the code the way every other comment does**, through the same `existingCode` convention the
// grounding judge checks - **which matters more here than anywhere**: a compiler diagnostic is **the one finding in
// this product that is not produced by a heuristic**, so **the gate that removes ungrounded comments must be able to
// check it too**, and it can, because **the line it points at is in the file it names.**

import type { ReviewComment } from '@code-analyzer/shared';

// **From the package's entry, not its internals.**
import type { CompilerDiagnostic } from '@code-analyzer/analyzer';

/** How many lines either side of the diagnostic the comment quotes, matching `toReviewComment`. */
const CONTEXT = 3;

/**
 * Turns compiler diagnostics into review comments.
 *
 * **`sourceFor` returns the file's lines or null**, and **a diagnostic whose file is not available is skipped rather
 * than quoted from nothing** - because **a comment with an `existingCode` it cannot support is exactly what the
 * grounding judge removes**, and **producing one here would be producing work for the gate.**
 */
export function compilerToComments(
  diagnostics: readonly CompilerDiagnostic[],
  sourceFor: (filePath: string) => string[] | null,
): ReviewComment[] {
  const comments: ReviewComment[] = [];

  for (const diagnostic of diagnostics) {
    const lines = sourceFor(diagnostic.filePath);
    if (lines === null) continue;

    const start = Math.max(1, diagnostic.line);
    const end = Math.min(lines.length, start + CONTEXT);
    // **The quotation is the lines the compiler pointed at**, zero-indexed here because `lines` is.
    const quoted = lines.slice(start - 1, end).join('\n');
    if (quoted.trim().length === 0) continue;

    comments.push({
      path: diagnostic.filePath,
      // **The compiler's own words, with its code**, because a reader looks `TS2322` up and **a paraphrase would be
      // our sentence about theirs.**
      content: `[compiler/${diagnostic.code}] ${diagnostic.message}`,
      existingCode: quoted,
      suggestionCode: undefined,
      startLine: start,
      endLine: end,
      // **A type error is a bug**, not a style opinion - and **a warning becomes the lowest severity that is still a
      // finding**, so a caller ranking by category does not have to know where it came from.
      category: 'bug',
      severity: diagnostic.severity === 'error' ? 'high' : 'low',
      filtered: false,
      // **The id carries the code and the location**, so **two runs over the same file produce the same id** and a
      // caller can dedupe across a rebase.
      id: `compiler-${diagnostic.code}-${diagnostic.filePath}-${diagnostic.line}-${diagnostic.column}`,
      createdAt: new Date().toISOString(),
    });
  }

  return comments;
}
