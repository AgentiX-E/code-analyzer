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

import type { PoolEntry } from '../search/file-ranking.js';
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
   *
   * **The coordinate system depends on which indexer built the graph**, and that is stated here because a caller
   * cannot see it from a string: the pipeline is handed a root and joins, so it reports absolute paths, while the
   * cross-repository indexer records what it read and reports repository-relative ones. `toCorpusPath` in
   * `benchmark/lca-instrument.ts` accepts both, and the acceptance test asserts both, because a measurement that
   * assumed one form published 0.0000 in three languages on every instance.
   */
  retrievedFiles: string[];
  /**
   * **The retriever's ranking of files, before the context budget was applied.**
   *
   * A third field rather than a third meaning for one of the other two, because the three are three different claims
   * and a measurement that conflates them publishes a figure about the wrong one:
   *
   * * `rankedFiles` is what the retrieval stage produced, **in rank order, cut only by the retrieval depth**;
   * * `retrievedFiles` is the files of the blocks that survived `maxBlocks` - a context budget, and one that also
   *   admits structural neighbours the retriever never ranked;
   * * `files` is what the answer cited.
   *
   * **Why this had to exist.** The bug-localisation measurement read `retrievedFiles`, which is a list of about ten
   * files on a real repository because forty blocks is a prompt budget and not a ranking; its MAP column was therefore
   * computed over a tenth of the depth the metric reads and the published baselines use. **A budget that belongs to the
   * answer arm was silently truncating the retrieval arm's denominator.**
   */
  rankedFiles: string[];
  /**
   * **The ranking after the file-level arm was fused in**, or the same list when no arm was supplied.
   *
   * A fourth field rather than a fourth meaning for `rankedFiles`, and the distinction is the point of it: `rankedFiles`
   * is what the declaration pool produced, `fusedFiles` is what the product returns when the caller also has a
   * file-level reading. Measured on Long Code Arena, the two instruments win on different bands - the pool on the
   * smallest checkouts, a path and its imports on the 200-500-file ones - so a caller that has both should not have to
   * choose, and a measurement has to be able to tell which of the two a figure came from.
   *
   * **Equal to `rankedFiles` when `AskOptions.fileSignals` is absent**, which is what makes it safe to read
   * unconditionally: a caller that supplies no arm gets the list it always got.
   */
  fusedFiles: string[];
  /**
   * **The pool `rankedFiles` was read from**, one entry per candidate declaration, in rank order.
   *
   * `rankedFiles` is a collapse, and a collapse is a rule: a file's position is derived from the declarations that live
   * in it (`search/file-ranking.ts`), and a reader who has only the file list cannot tell a file that ranked first
   * because one of its declarations did from one that would have ranked first under a different reading of the same
   * evidence. **That distinction is what three iterations of "the answer is in the list but not first" needed**, and it
   * is why the pool is published beside the list rather than kept inside the retriever.
   */
  rankedPool: PoolEntry[];
  grounding: GroundingReport;
  /** Set when there is no answer, with the reason. **`null` means an answer was produced.** */
  abstained: AbstainReason | null;
  /** Free-form detail for a reader debugging a run; never used by a gate. */
  notes: string[];
  /**
   * The repository the answer was restricted to, and why.
   *
   * **`null` means the whole workspace was searched**, which is the correct reading for a question that names no
   * repository or names two. It is a field rather than a note because a measurement has to be able to say which of the
   * two happened without parsing prose.
   */
  scope: ScopeReport | null;
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
   * Slots held back from retrieval for graph neighbours. **Default 3.**
   *
   * **Retrieval always has more candidates than the context has slots** - sixty are ranked and twelve are shown - so a
   * budget with no reservation is filled by retrieval every time and the graph contributes nothing at all. That is not
   * a hypothesis: it is what the fourth acceptance case measured on four real checkouts before this option existed,
   * where the structural half of the context was empty on every question while the edges it needed were in the store.
   *
   * The reservation is expressed in **slots rather than in characters**, because the two failures are different: a
   * character overflow drops the tail of whatever was being added, while an unfilled reservation would leave the prompt
   * short for no reason - so an unused slot falls back to retrieval rather than being wasted. **Zero restores the
   * retrieval-only behaviour**, which is what a measurement of retrieval should ask for.
   */
  structuralBlocks?: number;
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
  /**
   * Whether a repository named in the question restricts the answer to that repository. **Default `auto`.**
   *
   * `auto` reads the names of the projects in the store against the question and scopes when exactly one is named;
   * `workspace` ignores them and searches everything, which is what a caller that wants a cross-repository sweep of a
   * question which happens to mention a repository should ask for.
   */
  scope?: 'auto' | 'workspace';
  /**
   * **File-level rankings to fuse with the declaration one**, in the same coordinate system as the graph's `filePath`.
   *
   * What a caller supplies is a list it already has: `locate` produces one from a checkout too large to index, an agent
   * that has just run `search` produces one from the paths it was shown, and a caller running this product on two
   * revisions produces one from the other revision. The fusion is `reciprocalRankFusion`, at the constant
   * `search/fusion.ts` states and at the weighting the caller gives or the shipped one.
   */
  fileSignals?: {
    /** Paths, best first. **A path the pool did not rank is admitted rather than penalised.** */
    readonly ranked: readonly string[];
    /**
     * Further arms, fused beside `ranked`.
     *
     * **One arm was not enough, and the measurement said so before the code did.** A path-and-imports arm and a
     * whole-body arm read the same checkout and rank its files differently - measured on Long Code Arena, the first
     * beats the analyser's declaration pool by 0.12 on the 200-500-file band and loses to it by 0.15 on the smallest
     * band, and the body arm is the one that runs where the analyser cannot. A caller that has both should not have to
     * choose, so the interface takes a list. Each arm's `name` is what a weight is keyed by and what the contribution
     * report quotes.
     */
    readonly arms?: readonly { readonly name: string; readonly ranked: readonly string[] }[];
    /** The rank constant. **Supplied only by an ablation.** */
    readonly k?: number;
    /** How much each arm counts, keyed by name. **Absent means 1 for every arm.** */
    readonly weights?: Readonly<Record<string, number>>;
  };
}

/** A decision about which repository a question is about. */
export interface ScopeReport {
  projectId: string;
  /** Why the answer was restricted. **Stated, because an implicit restriction that a reader cannot see is a bug.** */
  because: 'named in the question' | 'requested by the caller';
}
