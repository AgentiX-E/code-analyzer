// @code-analyzer/intelligence — what the model is allowed to read
//
// **A retrieval hit is a symbol; a question is about a situation.** "Why does the login form lose the return path?"
// names no identifier, so the lexical half finds the form and the semantic half finds the redirect helper, and
// **neither of them finds the caller that forgot to pass the argument** - which is the answer. The graph knows it,
// because that caller has a `CALLS` edge into the helper.
//
// So the context is built in two passes:
//
// 1. **Retrieved** - the ranked hits, as they came.
// 2. **Structural** - for each hit, a bounded number of neighbours reached by a named relation, recorded with the
//    edge that reached them.
//
// **Two properties are enforced here rather than trusted to the caller.**
//
// * **The context is finite and its size is declared.** Every bound is a parameter with a default, and the assembled
//   characters are counted into the result. A prompt that silently grew with the repository would make the
//   measurement of the prompt meaningless.
// * **The context is deterministic.** Ranking ties are broken by node identity, neighbours are ordered by
//   (relation priority, edge id), and the numbering is assigned after ordering. Two runs over one index produce the
//   same blocks in the same order - which is what makes a citation id mean something.

import {
  EDGE_CALLS,
  EDGE_CONTAINS,
  EDGE_EXTENDS,
  EDGE_IMPLEMENTS,
  EDGE_IMPORTS,
  EDGE_TESTS,
} from '@code-analyzer/shared';

import type { ContextBlock, ContextOptions } from './types.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphEdge, GraphNode, NodeLabel, RelationshipType } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Which direction of an edge holds the interesting end
// ---------------------------------------------------------------------------

/**
 * The direction that leads to the *other* thing a reader would want next.
 *
 * **A relation name fixes the meaning of an edge, not the usefulness of its endpoints.** `CALLS` runs caller → callee,
 * and for "who is affected by this change" the interesting end is the *caller*, which is the `in` direction; for
 * "what does this depend on" it is the callee. The table records the choice per relation so it is reviewable, and
 * `in` is the default because the dominant question about a symbol is who else touches it.
 */
const EXPANSION_DIRECTION: Partial<Record<RelationshipType, 'in' | 'out'>> = {
  // Callers: the answer to "what breaks".
  [EDGE_CALLS]: 'in',
  // Subclasses and implementors: the answer to "what else changes shape".
  [EDGE_EXTENDS]: 'in',
  [EDGE_IMPLEMENTS]: 'in',
  // Tests: the answer to "what proves it still works".
  [EDGE_TESTS]: 'in',
  // Members and dependencies: the answer to "what is inside / what does it need".
  [EDGE_CONTAINS]: 'out',
  [EDGE_IMPORTS]: 'in',
};

/**
 * The relations followed, in priority order, when a caller does not name any.
 *
 * **Priority is not decoration**: the neighbour budget is usually smaller than the number of edges a hub node has, and
 * an arbitrary subset of a hub's edges is worse than a stated preference.
 */
export const DEFAULT_EXPANSION_RELATIONS: RelationshipType[] = [
  EDGE_CALLS,
  EDGE_IMPLEMENTS,
  EDGE_EXTENDS,
  EDGE_TESTS,
  EDGE_CONTAINS,
  EDGE_IMPORTS,
];

/** Labels that answer a question in prose. **A `Folder` block would be a line of a path and nothing else.** */
const EXPLAINABLE_LABELS: ReadonlySet<NodeLabel> = new Set<NodeLabel>([
  'Function',
  'Method',
  'Constructor',
  'Class',
  'Interface',
  'Trait',
  'Struct',
  'Enum',
  'TypeAlias',
  'Component',
  'Module',
  'File',
  'Config',
  'Route',
  'Tool',
  'Test',
  'Variable',
  'Property',
  'InfraResource',
  'Contract',
  'Sink',
  'DataSource',
]);

export const DEFAULT_CONTEXT_OPTIONS: Required<Omit<ContextOptions, 'relations'>> & {
  relations: RelationshipType[];
} = {
  maxBlocks: 12,
  excerptChars: 800,
  neighboursPerHit: 2,
  relations: DEFAULT_EXPANSION_RELATIONS,
  maxChars: 12_000,
};

// ---------------------------------------------------------------------------
// Excerpts
// ---------------------------------------------------------------------------

/** Where a node's body text lives, across the providers that record one. **First hit wins.** */
const BODY_KEYS = ['body', 'text', 'content', 'source', 'snippet', 'raw', 'value'] as const;

/**
 * The text of a node, or `null` when the provider recorded none.
 *
 * **`docstring` is deliberately not a body.** It is the documentation *about* the code, and a context built mostly of
 * docstrings answers a question from the comments - which is exactly the shortcut `paraphrase-search` exists to
 * measure, and exactly what a reader does not want when the comment is stale.
 */
export function nodeBody(node: GraphNode): string | null {
  for (const key of BODY_KEYS) {
    const value = node.properties[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

/**
 * Cut a body to the budget **on a line boundary**, with a marker that says it was cut.
 *
 * **A half-line of code is worse than no line**: a reader cannot tell whether the expression ended, and a model
 * quoting it back produces a claim about code that does not exist. So the cut happens at the last newline that fits,
 * and when there is none the whole excerpt is dropped rather than truncated mid-token.
 */
export function excerpt(body: string | null, limit: number): string | null {
  if (!body) return null;
  if (body.length <= limit) return body;
  const window = body.slice(0, limit);
  const lastNewline = window.lastIndexOf('\n');
  if (lastNewline <= 0) return null;
  return `${window.slice(0, lastNewline)}\n… (truncated)`;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/** A retrieved candidate, as the assembler receives it. **`score` is whatever the retriever ranked on.** */
export interface RetrievedCandidate {
  node: GraphNode;
  score: number;
}

/**
 * Rank by score, then by node identity.
 *
 * **Two nodes with the same score are equal on every machine**, so the order among them cannot come from the order the
 * store happened to iterate in - that is how a published figure starts moving between runs on the same input.
 */
export function rankCandidates(candidates: RetrievedCandidate[]): RetrievedCandidate[] {
  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.node.id - right.node.id;
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Where a block came from, for the neighbours pass. */
interface Origin {
  origin: 'retrieved' | 'graph';
  reachedBy: { relation: RelationshipType; from: number } | null;
}

function blockOf(
  node: GraphNode,
  id: number,
  score: number | null,
  from: Origin,
  chars: number,
): ContextBlock {
  return {
    id,
    nodeId: node.id,
    name: node.name,
    qualifiedName: node.qualifiedName,
    label: node.label,
    filePath: node.filePath!,
    startLine: node.startLine,
    endLine: node.endLine,
    language: node.language,
    signature: node.signature,
    body: excerpt(nodeBody(node), chars),
    origin: from.origin,
    reachedBy: from.reachedBy,
    score,
  };
}

/** Count what a block costs against the character budget. **The path and the signature are part of the prompt.** */
export function blockCost(block: ContextBlock): number {
  return (
    block.filePath.length +
    block.qualifiedName.length +
    (block.signature?.length ?? 0) +
    (block.body?.length ?? 0) +
    40
  );
}

/**
 * The nodes a retrieved block leads to, in a stated order.
 *
 * **Deduplicated against what is already in the context**, because a neighbour of two hits is one block, and repeating
 * it would spend the budget twice on the same code. **Skipped when it has no file path**, because a citation that
 * cannot name a place is not a citation.
 */
export function neighboursOf(
  store: InMemoryGraphStore,
  nodeId: number,
  relations: RelationshipType[],
  limit: number,
  seen: ReadonlySet<number>,
): Array<{ node: GraphNode; relation: RelationshipType }> {
  const found: Array<{ node: GraphNode; relation: RelationshipType }> = [];
  if (limit <= 0) return found;

  for (const relation of relations) {
    if (found.length >= limit) break;
    const direction = EXPANSION_DIRECTION[relation] ?? 'in';
    const edges: GraphEdge[] = store.getEdgesForNode(nodeId, relation, direction);
    // **Edge id order**, because an index hands back insertion order and insertion order is a fact about the run.
    const ordered = [...edges].sort((left, right) => left.id - right.id);
    for (const edge of ordered) {
      if (found.length >= limit) break;
      const otherId = direction === 'out' ? edge.targetId : edge.sourceId;
      if (otherId === nodeId || seen.has(otherId)) continue;
      if (found.some((entry) => entry.node.id === otherId)) continue;
      const other = store.getNode(otherId);
      if (!other || !other.filePath) continue;
      if (!EXPLAINABLE_LABELS.has(other.label)) continue;
      found.push({ node: other, relation });
    }
  }
  return found;
}

/**
 * Build the numbered context.
 *
 * **Retrieved blocks are placed first, in rank order, and structural blocks after them**, because the ordering is the
 * priority the character budget spends by: if the twelve slots fill, what is lost is the far end of the graph rather
 * than the answer the question found.
 *
 * **A block with no file path is dropped rather than numbered**, which is the invariant every citation downstream
 * relies on.
 */
export function assembleContext(
  store: InMemoryGraphStore,
  candidates: RetrievedCandidate[],
  options: ContextOptions = {},
): ContextBlock[] {
  const settings = { ...DEFAULT_CONTEXT_OPTIONS, ...options };
  const relations = options.relations ?? DEFAULT_EXPANSION_RELATIONS;

  const blocks: ContextBlock[] = [];
  const seen = new Set<number>();
  let chars = 0;

  const admit = (node: GraphNode, score: number | null, from: Origin): boolean => {
    if (seen.has(node.id)) return false;
    if (!node.filePath) return false;
    if (!EXPLAINABLE_LABELS.has(node.label)) return false;
    if (blocks.length >= settings.maxBlocks) return false;
    const block = blockOf(node, blocks.length + 1, score, from, settings.excerptChars);
    const cost = blockCost(block);
    // **The budget is checked before the block is numbered**, so an over-budget block never acquires an id that a
    // citation could then refer to and the answer could then cite as if it had been shown.
    if (chars + cost > settings.maxChars) return false;
    chars += cost;
    blocks.push(block);
    seen.add(node.id);
    return true;
  };

  const ranked = rankCandidates(candidates);
  for (const candidate of ranked) {
    admit(candidate.node, candidate.score, { origin: 'retrieved', reachedBy: null });
  }

  // **Neighbours are gathered from the retrieved blocks actually admitted**, not from every candidate: expanding a
  // block the budget dropped would cite code the model never saw. **The parent's citation id is what is recorded**,
  // because a reader - and a model - follows `[7]`, not a node identity that appears nowhere in the prompt.
  const retrieved = blocks.filter((block) => block.origin === 'retrieved');
  for (const parent of retrieved) {
    for (const neighbour of neighboursOf(
      store,
      parent.nodeId,
      relations,
      settings.neighboursPerHit,
      seen,
    )) {
      admit(neighbour.node, null, {
        origin: 'graph',
        reachedBy: { relation: neighbour.relation, from: parent.id },
      });
    }
  }

  return blocks;
}

/** Total characters the context costs. **Reported in the result so a page can quote it.** */
export function contextChars(blocks: ContextBlock[]): number {
  return blocks.reduce((sum, block) => sum + blockCost(block), 0);
}

/**
 * The distinct files a block list touches, in first-appearance order.
 *
 * **Derived from the blocks rather than from prose**, so the same function serves the citation-derived file set and
 * the retrieval-only arm of a measurement - one definition of "the files this answer rests on".
 */
export function filesOf(blocks: ContextBlock[]): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(block.filePath)) continue;
    seen.add(block.filePath);
    files.push(block.filePath);
  }
  return files;
}
