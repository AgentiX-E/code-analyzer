// @code-analyzer/mcp — Ask the codebase
//
// **The tool an agent calls when it has a question rather than a search term.** Every other querying tool answers
// "here are nodes that match"; this one answers "here is what the code does, and here is the block each claim came
// from". An agent that has been handed three matching symbols still has to open three files to answer its user; this
// removes that round trip, which is the whole point of putting the surface behind MCP.
//
// **The answer is returned with its evidence, always** - the context blocks, the citations, the blocks the answer did
// not use, and the ids it cited that do not exist. A caller that does not trust the prose can read the blocks; a
// caller that does not want to pay for a completion passes `generate: false` and gets the retrieval alone.
//
// **Nothing here decides the vendor.** The provider comes from the context, which got it from `createLLMProvider`, so
// a deployment that registers another vendor changes one registry rather than this file.

import { HybridSearchEngine, askCodebase } from '@code-analyzer/intelligence';

import { ToolContextImpl } from './tool-context.js';

import type { ToolResult } from './registry.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { AnswerResult } from '@code-analyzer/intelligence';

export const askCodebaseSchema = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description:
        'A question about the indexed code, in natural language. E.g. "how is the session token parsed and where is it used?"',
    },
    projectId: {
      type: 'string',
      description:
        'Restrict the answer to one indexed project. Omit to ask across every repository in the store, which is the cross-repository case.',
    },
    maxBlocks: {
      type: 'number',
      description: 'How many code blocks to put in front of the model (default: 12, maximum: 40).',
    },
    generate: {
      type: 'boolean',
      description:
        'Whether to ask a model for prose (default: true). False returns the retrieved context and no answer, which costs nothing and is useful for showing a reader the evidence.',
    },
    rerank: {
      type: 'boolean',
      description:
        'Whether to reorder the retrieved blocks with a model before answering (default: true).',
    },
    scope: {
      type: 'string',
      enum: ['auto', 'workspace'],
      description:
        'Whether a repository named in the question narrows the answer to it (default: auto). Pass "workspace" to search every indexed repository even when the question names one.',
    },
  },
  required: ['question'],
};

interface AskCodebaseParams {
  question: string;
  projectId?: string;
  maxBlocks?: number;
  generate?: boolean;
  rerank?: boolean;
  scope?: string;
}

/** What the tool hands back. **A shape rather than a string of prose**, because every field is separately useful. */
export interface AskCodebaseResponse {
  question: string;
  answer: string;
  /** `null` when an answer was produced; otherwise why there is none. */
  abstained: string | null;
  citations: Array<{ id: number; filePath: string; startLine: number | null; name: string }>;
  files: string[];
  retrievedFiles: string[];
  /** The repository the answer was narrowed to, or `null` when the whole workspace was searched. */
  scope: { projectId: string; because: string } | null;
  grounding: { unknownIds: number[]; uncited: number[]; allCitationsResolve: boolean };
  context: Array<{
    id: number;
    name: string;
    qualifiedName: string;
    label: string;
    filePath: string;
    startLine: number | null;
    origin: string;
    reachedBy: string | null;
  }>;
  notes: string[];
  stats: AnswerResult['stats'];
}

/** Reduce an answer to what a client needs to act on, **keeping every block's place so a claim can be followed**. */
export function toResponse(result: AnswerResult): AskCodebaseResponse {
  return {
    question: result.question,
    answer: result.answer,
    abstained: result.abstained,
    citations: result.citations.map((citation) => ({
      id: citation.id,
      filePath: citation.filePath,
      startLine: citation.startLine,
      name: citation.name,
    })),
    files: result.files,
    retrievedFiles: result.retrievedFiles,
    scope: result.scope,
    grounding: {
      unknownIds: result.grounding.unknownIds,
      uncited: result.grounding.uncited,
      allCitationsResolve: result.grounding.allCitationsResolve,
    },
    context: result.context.map((block) => ({
      id: block.id,
      name: block.name,
      qualifiedName: block.qualifiedName,
      label: block.label,
      filePath: block.filePath,
      startLine: block.startLine,
      origin: block.origin,
      reachedBy: block.reachedBy
        ? `${block.reachedBy.relation} from [${String(block.reachedBy.from)}]`
        : null,
    })),
    notes: result.notes,
    stats: result.stats,
  };
}

/**
 * Answer a question from the indexed code.
 *
 * **The semantic engine is used when the index holds vectors and the lexical one otherwise**, through
 * `getSemanticSearchEngine()`, which reports which it gave rather than silently degrading - the same rule the rest of
 * the tool surface follows.
 */
export async function askCodebaseTool(
  args: Record<string, unknown>,
  storeOrContext?: unknown,
): Promise<ToolResult> {
  const params = args as unknown as AskCodebaseParams;
  const question = params.question;

  if (typeof question !== 'string' || question.trim().length === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'question is required' }, null, 2) }],
      isError: true,
    };
  }

  const context = ToolContextImpl.isToolContext(storeOrContext) ? storeOrContext : null;
  const store: InMemoryGraphStore | null = context
    ? context.store
    : storeOrContext instanceof Object && 'getAllNodes' in (storeOrContext as object)
      ? (storeOrContext as InMemoryGraphStore)
      : null;

  if (!store) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { error: 'no graph store is available: index a repository first' },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  const { engine } = context
    ? await context.getSemanticSearchEngine()
    : { engine: lexicalEngine(store) };

  const provider = context?.getLLMProvider?.() ?? null;

  const result = await askCodebase({
    question,
    store,
    search: engine,
    ...(provider ? { provider } : {}),
    ...(typeof params.projectId === 'string' ? { projectId: params.projectId } : {}),
    options: {
      ...(typeof params.maxBlocks === 'number'
        ? { maxBlocks: Math.min(Math.max(params.maxBlocks, 1), 40) }
        : {}),
      ...(params.generate === false ? { generate: false } : {}),
      ...(params.rerank === false ? { rerank: false } : {}),
      ...(params.scope === 'workspace' ? { scope: 'workspace' as const } : {}),
    },
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(toResponse(result), null, 2) }],
  };
}

/**
 * The lexical engine over a bare store.
 *
 * **Built here rather than refused**, because a caller that passed a store and no context is a caller that indexed a
 * repository through another path; an error would make the tool unusable from exactly the clients that use the rest of
 * the surface that way.
 */
function lexicalEngine(store: InMemoryGraphStore): HybridSearchEngine {
  const engine = new HybridSearchEngine(store);
  engine.initialize();
  return engine;
}
