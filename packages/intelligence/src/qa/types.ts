// @code-analyzer/intelligence — the shapes a grounded answer is made of
//
// **A question answered from a codebase is a set of claims, and every claim has to name the code it came from.**
// That is the whole difference between this surface and a chat window over a repository: the answer is not the
// model's prose, it is the model's prose **plus the blocks it is allowed to be about**. So the types here are
// deliberately narrow - a block is a place in a file, a citation is a pointer to a block, and an answer is a list of
// claims each carrying pointers.
//
// **Nothing in this file reads a model.** The retrieval, the context, the parse and the verification are all
// deterministic functions of (question, index, provider); a caller with no provider gets the same context and no
// prose, which is a result rather than a failure.

import type { NodeLabel, RelationshipType } from '@code-analyzer/shared';

/**
 * One numbered piece of code the model is allowed to talk about.
 *
 * **`id` is the citation, and it is 1-based** because the prompt numbers blocks the way a reader numbers a footnote.
 * **The id is assigned after ordering**, so it is stable for a given (question, index) pair and a test can assert on
 * it rather than on a string.
 */
export interface ContextBlock {
  /** 1-based citation id. **The only identifier the prompt shows.** */
  id: number;
  /** The graph node this block is. Kept so a caller can jump back into the graph. */
  nodeId: number;
  name: string;
  qualifiedName: string;
  label: NodeLabel;
  /** Absolute or workspace-relative path, as the index recorded it. **Null blocks are dropped before numbering.** */
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  signature: string | null;
  /** A bounded excerpt of the body. **Bounded by the assembler, not by the prompt.** */
  body: string | null;
  /**
   * How the block entered the context.
   *
   * **`retrieved` means the question found it; `graph` means a retrieved block led to it.** The distinction is the
   * product's claim - that structure adds context a bag of words cannot - so it is recorded per block and counted in
   * the result rather than asserted in a page.
   */
  origin: 'retrieved' | 'graph';
  /** For a `graph` block, the edge that reached it and **the citation id of the block it was reached from**. */
  reachedBy: { relation: RelationshipType; from: number } | null;
  /** The fusion or expansion score, when there is one. **Null for a block added only as structure.** */
  score: number | null;
}

/** A pointer from a claim to a block. **`id` must exist in the context**, which is what `verify` checks. */
export interface Citation {
  id: number;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  name: string;
}

/** What the verification found. **Reported whether or not anything was wrong.** */
export interface GroundingReport {
  /** Citation ids the answer used that the context does not contain. **Any entry here is a hallucination.** */
  unknownIds: number[];
  /** Blocks the answer cited, deduplicated, in citation order. */
  cited: Citation[];
  /** Blocks offered to the model and never cited. */
  uncited: number[];
  /**
   * Whether every claim that named a block named one that exists.
   *
   * **A claim with no citation is not automatically ungrounded** - a good answer says "this file has no tests" without
   * pointing at a line - so this reports the citation half only, and `abstained` reports the other.
   */
  allCitationsResolve: boolean;
}

/**
 * Every reason an answer can be missing.
 *
 * **A tuple rather than a bare union**, because the set is part of the surface: a tool renders it, a client switches on
 * it, and a test asserts that every path through `askCodebase` returns a member of *this* list rather than a string
 * that reads like one. `AbstainReason` is derived from it, so the two cannot drift.
 */
export const ABSTAIN_REASONS = [
  'no-blocks-retrieved',
  'no-provider',
  'provider-failed',
  'empty-answer',
  'no-grounded-claim',
] as const;

/** Why an answer is empty, when it is. **A reason rather than an exception**, because every caller has a fallback. */
export type AbstainReason = (typeof ABSTAIN_REASONS)[number];

/** The result of asking one question. */
export interface AnswerResult {
  question: string;
  /** The prose, or an empty string when `abstained` is set. */
  answer: string;
  /** The blocks the model was shown, in citation order. **Present even when abstained**, so a caller can show them. */
  context: ContextBlock[];
  /** The blocks the answer actually cited. */
  citations: Citation[];
  /**
   * The distinct files the answer rests on, in the order they first appear.
   *
   * **This is the field a bug-localisation measurement reads**, and it is derived from citations rather than parsed
   * out of prose: a file the model mentions in a sentence but did not cite is not an answer.
   */
  files: string[];
  /**
   * The distinct files the *context* touches, in block order.
   *
   * **A second field rather than a fallback**, because the two are different claims: `files` is what the answer
   * rested on and `retrievedFiles` is what retrieval offered. A measurement that wants the retrieval arm reads the
   * second, one that wants the answer arm reads the first, and neither has to infer which it got from a note.
   */
  retrievedFiles: string[];
  grounding: GroundingReport;
  /** Set when there is no answer, with the reason. **`null` means an answer was produced.** */
  abstained: AbstainReason | null;
  /** Free-form detail for a reader debugging a run; never used by a gate. */
  notes: string[];
  /** Counts, so a page can report what the graph contributed without re-deriving it. */
  stats: {
    retrieved: number;
    fromGraph: number;
    contextChars: number;
    latencyMs: number;
  };
}

/** How much context the assembler may build. **Every bound is explicit, because a prompt is a budget.** */
export interface ContextOptions {
  /** Blocks offered to the model. **Default 12.** */
  maxBlocks?: number;
  /**
   * Characters of body per block. **Default 800.**
   *
   * **A file-level question needs a signature and a shape, not a transcription**; 800 characters is enough for a
   * function's first statements and small enough that twelve blocks still fit a prompt.
   */
  excerptChars?: number;
  /** Graph neighbours added per retrieved block. **Default 2, and 0 disables expansion entirely.** */
  neighboursPerHit?: number;
  /**
   * Relations followed when expanding.
   *
   * **Ordered, and the order is the priority** when the neighbour budget is smaller than the number of edges: a
   * caller asking what a change breaks wants callers before it wants the containing folder.
   */
  relations?: RelationshipType[];
  /** Total characters of context. **Default 12 000**, which is roughly 3 000 tokens. */
  maxChars?: number;
}

/** Options for one `ask` call. */
export interface AskOptions extends ContextOptions {
  /** How many candidates retrieval returns before the assembler trims to `maxBlocks`. **Default 60.** */
  retrieveLimit?: number;
  /** Ask a model for the prose. **False returns the context and no answer**, which is the retrieval-only arm. */
  generate?: boolean;
  /** Reorder the fused list listwise before assembling. **Default true when a provider is present.** */
  rerank?: boolean;
  /** Completion budget for the answer. **Default 700 tokens.** */
  maxAnswerTokens?: number;
  /** Wall-clock budget for the completion. **Default 60 s.** */
  timeoutMs?: number;
}
