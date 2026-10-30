// @code-analyzer/intelligence — asking a codebase a question
//
// **The surface this project did not have, and the reason two cells of the competitor matrix were empty.** Every
// component of an answer existed - a hybrid retriever, a listwise reranker, a graph, a provider abstraction, a
// citation checker - and nothing composed them into "here is the answer and here is where it comes from". A user
// story is a composition, so the composition is a module rather than a wiring inside a tool handler.
//
// **The pipeline, in the order the evidence supports:**
//
// 1. **Retrieve** - BM25 and vectors, fused at weight 1, which is the configuration `docstring-search` swept and
//    `paraphrase-search` and CoSQA measured.
// 2. **Rerank** - listwise, over the fused pool, when a provider is present. Measured at +0.15 recall@20 and 2.2× MRR
//    on the paraphrase corpus, which is why it runs by default rather than behind a flag.
// 3. **Assemble** - a bounded, numbered context, with graph neighbours of the hits included and the edge recorded.
// 4. **Answer** - provider-agnostic, with a citation contract and an explicit abstention.
// 5. **Verify** - every citation id is checked against the blocks that were shown.
//
// **Every stage has a behaviour without a provider.** No provider means no rerank and no prose, and the result says
// `no-provider` rather than throwing: the retrieval arm is a legitimate answer, and a caller that wanted prose can see
// why it did not get any.

import { hasGroundedClaim, verifyCitations } from './citations.js';
import { assembleContext, contextChars, filesOf, rankCandidates } from './context.js';
import { answerPrompt } from './prompt.js';
import { HybridSearchEngine } from '../search/hybrid-search.js';
import { rerankCandidates } from '../search/rerank.js';

import type { AnswerResult, AskOptions, ContextBlock, ContextOptions } from './types.js';
import type { LLMProvider } from '../review/llm/provider.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/shared';

/** What `askCodebase` needs. **The store and the engine are separate arguments because a caller may already own both.** */
export interface AskInput {
  question: string;
  store: InMemoryGraphStore;
  search: HybridSearchEngine;
  provider?: LLMProvider | null;
  options?: AskOptions;
  /**
   * Restrict the answer to one project's nodes.
   *
   * **Applied to the candidate list rather than to the BM25 index**, because the index is per store and the filter has
   * to hold for the vector half too - and a hit from another checkout in the same group would answer a question about
   * this one with code that is not here. **A group-wide question leaves it unset**, which is the cross-repository case.
   */
  projectId?: string;
}

/** How many candidates retrieval returns before assembly trims them. **Sixty, because the rerank pool is fifty.** */
const DEFAULT_RETRIEVE_LIMIT = 60;

/**
 * The context for a question, with no model involved.
 *
 * **Exported separately** because the retrieval arm of a measurement - and a tool that wants to show a reader the
 * evidence before spending a completion - needs exactly this and nothing else.
 */
export async function retrieveContext(
  input: Omit<AskInput, 'question'> & { question: string },
): Promise<{
  blocks: ContextBlock[];
  candidates: number;
  rerankApplied: boolean;
  rerankReason: string | null;
}> {
  const options = input.options ?? {};
  const limit = options.retrieveLimit ?? DEFAULT_RETRIEVE_LIMIT;

  const lexical = input.search.bm25Search(input.question);
  const vector = await input.search.vectorSearch(input.question, limit, null);
  const fused = input.search.fuseResults(
    lexical.map((hit) => ({ node: hit.node, score: hit.score })),
    vector.map((hit) => ({ node: hit.node, score: hit.score })),
    60,
    limit,
    1,
  );

  let compacted = rankCandidates(
    fused.map((hit) => ({ node: hit.node, score: hit.combinedScore })),
  );
  let rerankApplied = false;
  let rerankReason: string | null = null;

  // **The project filter runs before the rerank**, so the model is asked to order a list it could be shown rather than
  // a list the caller would then cut - an ordering of four candidates out of sixty is not an ordering of the four.
  if (input.projectId !== undefined) {
    const projectId = input.projectId;
    compacted = compacted.filter((candidate) => candidate.node.projectId === projectId);
  }

  // **Reranking is a reorder of the pool, never a filter**: `rerankCandidates` appends every candidate it was not
  // told about, so a model that names three of sixty cannot lose the other fifty-seven.
  if (options.rerank !== false && input.provider && compacted.length > 1) {
    const result = await rerankCandidates(
      input.question,
      compacted.map((candidate, index) => ({ rank: index + 1, candidate })),
      (entry) => ({
        rank: entry.rank,
        name: entry.candidate.node.name,
        qualifiedName: entry.candidate.node.qualifiedName,
        filePath: entry.candidate.node.filePath,
        signature: entry.candidate.node.signature,
        excerpt:
          typeof entry.candidate.node.properties['body'] === 'string'
            ? entry.candidate.node.properties['body'].slice(0, 240)
            : null,
      }),
      input.provider,
      options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs },
    );
    rerankApplied = result.applied;
    rerankReason = result.reason ?? null;
    if (result.applied) compacted = result.ordered.map((entry) => entry.candidate);
  } else if (options.rerank !== false && !input.provider) {
    rerankReason = 'no LLM provider is configured';
  }

  const contextOptions: ContextOptions = { ...options };
  const blocks = assembleContext(input.store, compacted, contextOptions);
  return { blocks, candidates: fused.length, rerankApplied, rerankReason };
}

/**
 * Ask a question, and check the answer against what it was shown.
 *
 * **The result is never an exception.** A provider that times out, an answer that cites nothing, a repository whose
 * index is empty - each is a stated outcome, because a caller (a tool, a measurement, a CI job) has to be able to
 * report "no answer, and here is why" rather than crash.
 */
export async function askCodebase(input: AskInput): Promise<AnswerResult> {
  const started = Date.now();
  const options = input.options ?? {};
  const notes: string[] = [];

  const { blocks, candidates, rerankApplied, rerankReason } = await retrieveContext(input);
  if (rerankApplied) notes.push('the fused list was reordered by a listwise rerank');
  else if (rerankReason) notes.push(`the fused list kept its order: ${rerankReason}`);

  const base = {
    question: input.question,
    context: blocks,
    retrievedFiles: filesOf(blocks),
  };

  const counters = {
    retrieved: blocks.filter((block) => block.origin === 'retrieved').length,
    fromGraph: blocks.filter((block) => block.origin === 'graph').length,
    contextChars: contextChars(blocks),
  };

  /**
   * Complete a result with the latency this call actually took.
   *
   * **`latencyMs` is stamped once, here, so no branch can report a stale zero** - and the other three counters are
   * copied from `base` rather than re-derived, because re-deriving them per branch is how two branches end up counting
   * different things.
   */
  const finish = (result: Omit<AnswerResult, 'stats'>): AnswerResult => ({
    ...result,
    stats: { ...counters, latencyMs: Date.now() - started },
  });

  const emptyGrounding = verifyCitations('', blocks);

  if (blocks.length === 0) {
    return finish({
      ...base,
      answer: '',
      citations: [],
      files: [],
      grounding: emptyGrounding,
      abstained: 'no-blocks-retrieved',
      notes: [...notes, `${candidates} candidates were retrieved and none had a file to cite`],
    });
  }

  if (options.generate === false) {
    return finish({
      ...base,
      answer: '',
      citations: [],
      files: [],
      grounding: emptyGrounding,
      abstained: 'no-provider',
      notes: [...notes, 'generation was not requested, so this is the retrieval arm'],
    });
  }

  if (!input.provider) {
    return finish({
      ...base,
      answer: '',
      citations: [],
      files: [],
      grounding: emptyGrounding,
      abstained: 'no-provider',
      notes: [...notes, 'no LLM provider is configured'],
    });
  }

  let answer: string;
  try {
    const completion = await input.provider.complete(answerPrompt(input.question, blocks), {
      maxTokens: options.maxAnswerTokens ?? 700,
      temperature: 0,
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    });
    answer = completion.content.trim();
  } catch (error) {
    return finish({
      ...base,
      answer: '',
      citations: [],
      files: [],
      grounding: emptyGrounding,
      abstained: 'provider-failed',
      notes: [
        ...notes,
        `the provider rejected the request: ${error instanceof Error ? error.message : String(error)}`,
      ],
    });
  }

  if (answer.length === 0) {
    return finish({
      ...base,
      answer: '',
      citations: [],
      files: [],
      grounding: emptyGrounding,
      abstained: 'empty-answer',
      notes,
    });
  }

  const grounding = verifyCitations(answer, blocks);
  const files = [...new Set(grounding.cited.map((citation) => citation.filePath))];

  // **An answer with no resolving citation is reported, not discarded.** The prose is still worth reading, and a
  // measurement that silently dropped it would be measuring the citation parser instead of the model.
  const abstained = hasGroundedClaim(grounding) ? null : 'no-grounded-claim';
  if (!grounding.allCitationsResolve) {
    notes.push(
      `the answer cited ${String(grounding.unknownIds.length)} block(s) that do not exist: ${grounding.unknownIds.join(', ')}`,
    );
  }
  if (abstained) notes.push('no claim in the answer pointed at a block that exists');

  return finish({
    ...base,
    answer,
    citations: grounding.cited,
    files,
    grounding,
    abstained,
    notes,
  });
}

/** The nodes a set of paths names, for a caller that has paths and wants symbols. **Order is the file order given.** */
export function nodesForFiles(store: InMemoryGraphStore, files: string[]): GraphNode[] {
  const wanted = new Set(files);
  const found: GraphNode[] = [];
  for (const node of store.getAllNodes()) {
    if (node.filePath && wanted.has(node.filePath) && node.label !== 'Folder') found.push(node);
  }
  return found.sort((left, right) => left.id - right.id);
}
