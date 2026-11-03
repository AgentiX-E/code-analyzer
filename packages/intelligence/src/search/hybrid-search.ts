// @code-analyzer/intelligence — Hybrid Search Engine
// Combines BM25 text search with vector semantic search using Reciprocal Rank Fusion.

import { basename, extname } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';

import { DataflowSearchEngine, type DataflowPath } from './dataflow-search.js';
import { sortByScoreThenIdentity } from './ranking.js';

import type { GraphNode, SearchOptions, NodeLabel } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Search-specific interfaces
// ---------------------------------------------------------------------------

/** Internal ranked result with a single score dimension */
export interface RankedResult {
  node: GraphNode;
  score: number;
}

/** Combined search result with per-source scores */
export interface HybridSearchResult {
  node: GraphNode;
  bm25Score: number;
  vectorScore: number;
  combinedScore: number;
}

/** Filters applied during search */
interface SearchFilters {
  labels?: NodeLabel[];
  filePattern?: string;
  isExported?: boolean;
  minComplexity?: number;
  maxComplexity?: number;
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/**
 * The name a document is indexed under: **the symbol's path through the code, never the machine's.**
 *
 * Qualified names carry the file system, in three shapes taken from one corpus - `project:<id>:file:<absolute
 * path>:<symbol>` for a symbol, `file:<absolute path>` for a file, `folder:<absolute path>` for a directory - and the
 * index used to take them verbatim. **So the retrieval figure was a property of where the repository lived**: the same
 * corpus, analysed twice through two roots, reported lexical MRR **0.9819** at `/workspace/repos/code-analyzer` and
 * **0.9796** through a longer symlink. Not a difference of ranking: a difference of vocabulary.
 *
 * The path is also search noise of the worst kind. `runner`, `work` and `repos` appear in **every** document, so a
 * query for any of them matches the whole graph and cannot be told from a real one by a reader looking at the scores.
 *
 * **What is kept is the part a developer would say out loud**: the file's own name and the symbol -
 * `file:arkts:ArkTSProvider`. Every directory is dropped, not only the ones above the analysed root, because the index
 * is not told where the root is and a name that is *sometimes* relative would be worse than one that never is. **The
 * price is that a directory is no longer a search word**, and that price is already paid twice over: `SearchOptions`
 * has a `filePattern` for asking about paths, and `ranking.ts` still breaks ties on the qualified name, which a caller
 * that reached this point already holds in full.
 */
export function indexableName(node: Pick<GraphNode, 'qualifiedName'>): string {
  const parts = node.qualifiedName
    .split(':')
    .map((part) => (part.startsWith('/') ? basename(part, extname(part)) : part));
  // **The workspace is not part of a name**, and dropping it is also what makes the two scopes comparable.
  return parts[0] === 'project' ? parts.slice(2).join(':') : parts.join(':');
}

/**
 * The part of a document's name that says **where** it lives rather than **what it is called**: the file and the
 * container, with the declared name removed.
 *
 * **A name and its path are different evidence and used to be one bag of tokens.** `Parser.sanitize` living in
 * `sanitize.ts` mentions `sanitize` twice — once because it is declared, once because of the file it is declared in —
 * and BM25 summed them, so a file called after a symbol promoted every symbol in it. Splitting the field is what lets
 * the declaration outweigh the directory it sits in.
 */
export function indexablePath(node: Pick<GraphNode, 'qualifiedName'>): string {
  const name = indexableName(node);
  const colon = name.lastIndexOf(':');
  const tail = name.slice(colon + 1);
  const dot = tail.lastIndexOf('.');
  // **A qualified name that carries no container keeps its whole tail**, because a file is not declared inside
  // anything: `file:types` is a path and dropping `types` would leave the file with no name at all.
  return dot === -1 ? name : `${name.slice(0, colon + 1)}${tail.slice(0, dot)}`;
}

/** A file's own name without its directory or extension, which is the one word a reader uses to find a page. */
function fileStemOf(node: Pick<GraphNode, 'filePath'>): string {
  const path = node.filePath ?? '';
  return basename(path, extname(path));
}

/** Tokenize an identifier string by splitting on camelCase, snake_case, and kebab-case boundaries.
 * Example: "getUserProfile" -> ["get", "user", "profile"]
 * Example: "process_request" -> ["process", "request"]
 * Example: "my-component" -> ["my", "component"]
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  // Replace separators with spaces
  const withSpaces = text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMCamel
    // **`:` is a separator because `indexableName` joins with it**: a qualified name is `file:types:ZodType`,
    // and without this the index held `file:types` as one word, so a query for `types` matched nothing and a query
    // for `file` matched every document that had a path at all.
    .replace(/[_\-.:/]+/g, ' ') // snake_case, kebab-case, dot.separated, qualified names, paths
    .replace(/\s+/g, ' ')
    .trim();

  return withSpaces
    .split(' ')
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// BM25 Implementation
// ---------------------------------------------------------------------------

/**
 * BM25 ranking function.
 * k1: term frequency saturation parameter (default 1.2).
 * b: document length normalization parameter (default 0.75).
 */
/**
 * **An exact name match multiplies the BM25 score, because BM25 alone cannot tell "this is the symbol" from "this document
 * mentions the term".**
 *
 * **The retrieval measurement showed it**: `SEARCH-RECALL 0.95 (38/40)`, and **both misses were interface names in a
 * corpus that held thirty copies of them** - **`NodeProperties` and `KnowledgeGraph`**. **Thirty identical documents
 * score within rounding of each other**, so **which twenty land in the top-k is decided by tie order**, and **the two
 * long names lost that order to shorter ones**.
 *
 * **A term-frequency model ranks documents; a lookup answers a query.** **When the query IS the name, the second
 * question is the one being asked**, and **a multiplier is how that is said without discarding the ranking** - the
 * matches that are not exact keep their relative order.
 *
 * **The value is 4**: **large enough to lift an exact match over a document that repeats the term many times**, and
 * **small enough that an exact match on a rare name does not outrank a substantially better non-exact one by orders of
 * magnitude**.
 */
const EXACT_NAME_BOOST = 4;

const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * The four things a document's text is made of, **indexed apart**.
 *
 * `name` is what a developer would say out loud, `path` is where it lives, `signature` is how it is called, `docstring`
 * is what it does. A single bag of all four cannot tell a declaration from a directory — and the difference is the whole
 * reason a paraphrase query works or does not.
 */
export type IndexedField = 'name' | 'path' | 'signature' | 'docstring';

/** Every field, in a fixed order, so a score cannot depend on the order a map happens to iterate. */
export const INDEXED_FIELDS: readonly IndexedField[] = ['name', 'path', 'signature', 'docstring'];

/**
 * How much one field counts, and how strongly its own length is normalised.
 *
 * **The two are separate because they mean different things.** A weight says *this field is evidence*; a length
 * normalisation says *a longer field is not a better field*. A signature is longer than a name as a matter of grammar,
 * so normalising both against the document average — which is what one bag does — scores a well-documented function
 * below a terse one for the same declaration.
 */
/**
 * The languages whose text is **prose**: a heading, a list item, a blockquote, an inline code span.
 *
 * **A documentation provider has no identifiers to offer**, so it files a sentence where a name goes - `markdown.ts`
 * emits `## Understanding the Spring Petclinic application` as a `CLASS_DEF` and every list item as a `VARIABLE_DEF`,
 * which is the right shape for "find the page about X" and the wrong shape for "find the code that does X". Once the
 * name field stopped being length-normalised, **`spring-petclinic`'s README out-ranked every Java class in the
 * repository for a natural-language question** - measured on the cross-repository QA suite, which went from a context
 * with graph neighbours to a context of README sentences and no neighbours at all.
 *
 * **A sentence is what a doc comment is, so it is filed where doc comments are filed.** What stays in the path field is
 * the file's own name - `readme`, `contributing` - because that is the one word a reader does use to find a page. The
 * qualified name cannot serve: a prose node's container is the sentence itself, so
 * `file:/w/README.md:Understanding the owner controller` would leave the sentence in the path field and the whole split
 * would be undone one field over.
 */
const PROSE_LANGUAGES: ReadonlySet<string> = new Set(['markdown', 'pdf']);

export interface FieldWeighting {
  readonly weight: Readonly<Record<IndexedField, number>>;
  readonly lengthNormalisation: Readonly<Record<IndexedField, number>>;
}

/**
 * **The weighting the product ships, chosen by measurement rather than by taste.**
 *
 * `name` is worth more than everything written about it, because a query that names a symbol is asking for that symbol;
 * `b: 0.3` on the name field says a long identifier is not a worse identifier — the reason a name is long is that the
 * thing it names is specific, which is the opposite of the reason a document is long. **The values come from the sweep
 * recorded in `benchmarks/paraphrase-search.json`**, which measured them on one half of the pinned question set and
 * reported the other half, so the figure that ships is a figure from questions the choice never saw.
 */
export const DEFAULT_FIELD_WEIGHTING: FieldWeighting = {
  // **A name token is worth two path tokens and one signature token.** The file a symbol lives in is evidence that it
  // is talked about; the name is evidence that it is the thing being asked for.
  weight: { name: 1, path: 0.5, signature: 1, docstring: 1 },
  // **`b` is 0 on the name field, which means a long identifier is not a worse identifier.** The other three keep the
  // classical value, because their length *is* verbosity: a long doc comment is a chatty one.
  lengthNormalisation: { name: 0, path: BM25_B, signature: BM25_B, docstring: BM25_B },
};

/**
 * How much one semantic rank counts against one lexical rank in the fusion.
 *
 * **1 until a measurement says otherwise**, which is the old behaviour spelled out rather than assumed - and the number
 * `docstring-search.test.ts` sweeps. **A weight chosen by taste is a second ranking function nobody measured.**
 */
const DEFAULT_VECTOR_WEIGHT = 1;

interface DocEntry {
  nodeId: number;
  node: GraphNode;
  /** Per field, the term frequencies this document carries. */
  terms: Record<IndexedField, Map<string, number>>;
  /** Per field, how many tokens the field holds - the length BM25F normalises against. */
  lengths: Record<IndexedField, number>;
}

class InvertedIndex {
  /** term -> list of (nodeId, tf) */
  private readonly index = new Map<string, Array<{ nodeId: number; tf: number }>>();
  private readonly docs = new Map<number, DocEntry>();
  private readonly fieldTotalLength: Record<IndexedField, number> = {
    name: 0,
    path: 0,
    signature: 0,
    docstring: 0,
  };
  private readonly fieldAvgLength: Record<IndexedField, number> = {
    name: 0,
    path: 0,
    signature: 0,
    docstring: 0,
  };

  constructor(private readonly weighting: FieldWeighting = DEFAULT_FIELD_WEIGHTING) {}

  addDocument(node: GraphNode): void {
    const nodeId = node.id;

    const prose = PROSE_LANGUAGES.has(node.language ?? '');
    const text: Record<IndexedField, string> = {
      name: prose ? '' : (node.name ?? ''),
      path: prose ? fileStemOf(node) : indexablePath(node),
      signature: node.signature ?? '',
      // **The prose's own text is what it says**, so a documentation node is still found by a question about it - at the
      // weight a doc comment carries, which is the weight of documentation rather than the weight of a declaration.
      docstring: prose
        ? [node.name, node.docstring]
            .filter((part) => typeof part === 'string' && part !== '')
            .join('\n')
        : (node.docstring ?? ''),
    };

    const terms = {} as Record<IndexedField, Map<string, number>>;
    const lengths = {} as Record<IndexedField, number>;
    /** Every distinct term of the document, in the order first met, so the postings list is built once per term. */
    const everywhere = new Map<string, number>();

    for (const field of INDEXED_FIELDS) {
      const tokens = tokenize(text[field]);
      const tf = new Map<string, number>();
      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
        everywhere.set(token, (everywhere.get(token) ?? 0) + 1);
      }
      terms[field] = tf;
      lengths[field] = tokens.length;
      this.fieldTotalLength[field] += tokens.length;
    }

    this.docs.set(nodeId, { nodeId, node, terms, lengths });

    // **One postings entry per term per document**, carrying the whole-document frequency: the field split happens at
    // scoring time, where the weights are, and a posting list split four ways would quadruple the walk for a query word
    // that most documents carry in one field only.
    for (const [term, freq] of everywhere) {
      const postings = this.index.get(term);
      if (postings) {
        postings.push({ nodeId, tf: freq });
      } else {
        this.index.set(term, [{ nodeId, tf: freq }]);
      }
    }
  }

  removeDocument(nodeId: number): void {
    const doc = this.docs.get(nodeId);
    if (!doc) return;

    // **The distinct terms of the document, not the terms per field**: a word written in two fields has one postings
    // entry, so walking the fields would try to delete it twice and the second delete would find no entry to remove.
    const distinct = new Set<string>();
    for (const field of INDEXED_FIELDS) {
      for (const term of doc.terms[field].keys()) distinct.add(term);
      this.fieldTotalLength[field] -= doc.lengths[field];
    }
    for (const term of distinct) {
      // Every term here is guaranteed to have a non-empty postings list containing this node: addDocument writes the
      // two together, and a term is deleted as soon as its postings list is drained. So both the postings lookup and the
      // nodeId search below always resolve.
      const postings = this.index.get(term)!;
      const idx = postings.findIndex((p) => p.nodeId === nodeId);
      postings.splice(idx, 1);
      if (postings.length === 0) this.index.delete(term);
    }

    this.docs.delete(nodeId);
  }

  buildIndex(store: InMemoryGraphStore): void {
    // Use getAllNodes to get full GraphNode objects for complete indexing
    const nodes = store.getAllNodes();
    for (const node of nodes) {
      this.addDocument(node);
    }
    this.recomputeAvg();
  }

  private recomputeAvg(): void {
    for (const field of INDEXED_FIELDS) {
      this.fieldAvgLength[field] =
        this.docs.size > 0 ? this.fieldTotalLength[field] / this.docs.size : 0;
    }
  }

  /**
   * Score a document against a query, in the BM25F form of the ranking function.
   *
   * **One term frequency per field, normalised per field, then summed** - which is the whole difference from BM25. With
   * a single field at weight 1 and `b` equal to `BM25_B`, the expression below is algebraically the classical one, and
   * `hybrid-search.test.ts` asserts that on numbers rather than on the algebra.
   */
  scoreDocument(query: string, doc: DocEntry): number {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return 0;

    let score = 0;
    const N = this.docs.size;
    const { weight, lengthNormalisation } = this.weighting;

    for (const term of queryTerms) {
      const postings = this.index.get(term);
      if (!postings) continue;
      // postings is always non-empty: `removeDocument` deletes a term from the index once its postings list is drained,
      // so `df >= 1` here.
      const df = postings.length;

      let saturated = 0;
      for (const field of INDEXED_FIELDS) {
        const tf = doc.terms[field].get(term) ?? 0;
        if (tf === 0) continue;
        const w = weight[field];
        if (w === 0) continue;
        const b = lengthNormalisation[field];
        const avg = this.fieldAvgLength[field];
        // **A field every document leaves empty has no average to normalise against**, and dividing by it would make
        // the score a function of how many documents happen to be indexed.
        const norm = avg > 0 ? 1 - b + (b * doc.lengths[field]) / avg : 1;
        saturated += (w * tf) / norm;
      }
      if (saturated === 0) continue;

      // BM25 IDF: log(1 + (N - df + 0.5) / (df + 0.5))
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += (idf * (BM25_K1 + 1) * saturated) / (BM25_K1 + saturated);
    }

    // **And the exact match is the answer to the question the query asked.**
    const nodeName = doc.node.name;
    if (typeof nodeName === 'string' && nodeName.toLowerCase() === query.trim().toLowerCase()) {
      score *= EXACT_NAME_BOOST;
    }

    return score;
  }

  /**
   * Search using BM25 and return ranked results.
   */
  search(query: string, filters?: SearchFilters): RankedResult[] {
    const candidates = new Set<number>();

    // Get candidate documents by finding postings for query terms
    const queryTerms = tokenize(query);
    for (const term of queryTerms) {
      const postings = this.index.get(term);
      if (postings) {
        for (const p of postings) {
          candidates.add(p.nodeId);
        }
      }
    }

    // If no candidates, search all docs as fallback
    if (candidates.size === 0) {
      for (const nodeId of this.docs.keys()) {
        candidates.add(nodeId);
      }
    }

    const results: RankedResult[] = [];

    for (const nodeId of candidates) {
      // `candidates` only contains node IDs present in `docs` (built from
      // index postings and docs.keys(), both subsets of docs), so get() always
      // resolves here.
      const doc = this.docs.get(nodeId)!;

      // Apply filters
      if (!this.passesFilters(doc.node, filters)) continue;

      const score = this.scoreDocument(query, doc);
      if (score > 0) {
        results.push({ node: doc.node, score });
      }
    }

    // Score descending, and a tie broken by the node's own name rather than by the order the walk produced.
    return sortByScoreThenIdentity(results, (result) => result.score);
  }

  private passesFilters(node: GraphNode, filters?: SearchFilters): boolean {
    if (!filters) return true;

    if (filters.labels && filters.labels.length > 0) {
      if (!filters.labels.includes(node.label)) return false;
    }

    if (filters.filePattern) {
      if (!node.filePath) return false;
      const regex = new RegExp(filters.filePattern.replace(/\*/g, '.*'), 'i');
      if (!regex.test(node.filePath)) return false;
    }

    if (filters.isExported !== undefined) {
      if (node.isExported !== filters.isExported) return false;
    }

    if (filters.minComplexity !== undefined) {
      if (node.complexity === null || node.complexity < filters.minComplexity) return false;
    }

    if (filters.maxComplexity !== undefined) {
      if (node.complexity !== null && node.complexity > filters.maxComplexity) return false;
    }

    return true;
  }

  /** Number of indexed documents */
  get documentCount(): number {
    return this.docs.size;
  }

  /** Clear the index */
  clear(): void {
    this.index.clear();
    this.docs.clear();
    for (const field of INDEXED_FIELDS) {
      this.fieldTotalLength[field] = 0;
      this.fieldAvgLength[field] = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Vector Search
// ---------------------------------------------------------------------------

type EmbeddingLookupFn = (nodeId: number) => Float32Array | null;
type EmbedContentFn = (content: string) => Promise<Float32Array>;

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// Hybrid Search Engine
// ---------------------------------------------------------------------------

export class HybridSearchEngine {
  private readonly index: InvertedIndex;
  private getEmbeddingForNode: EmbeddingLookupFn | null = null;
  private embedContent: EmbedContentFn | null = null;
  private initialized = false;
  /**
   * `weighting` is an argument and not a constant **so that the product's choice and a measurement's candidate are the
   * same code path**: the sweep in `paraphrase-search.test.ts` builds an engine per configuration, and the only thing
   * that differs between the row that ships and the rows that do not is this object.
   */
  constructor(
    private store: InMemoryGraphStore,
    weighting: FieldWeighting = DEFAULT_FIELD_WEIGHTING,
  ) {
    this.index = new InvertedIndex(weighting);
  }

  /**
   * Initialize the search engine by building the inverted index.
   */
  initialize(): void {
    this.index.buildIndex(this.store);
    this.initialized = true;
  }

  /**
   * Register embedding functions for vector search support.
   */
  registerEmbeddings(lookupFn: EmbeddingLookupFn, contentFn?: EmbedContentFn): void {
    this.getEmbeddingForNode = lookupFn;
    this.embedContent = contentFn ?? null;
  }

  /**
   * Hybrid BM25 + vector search with Reciprocal Rank Fusion (k=60).
   */
  async search(options: SearchOptions): Promise<HybridSearchResult[]> {
    if (!this.initialized) {
      this.initialize();
    }

    const filters: SearchFilters = {
      labels: options.labels,
      filePattern: options.filePath,
    };

    // BM25 search (synchronous) — serves as candidate pre-filter
    const bm25Results = this.bm25Search(options.query, filters);

    // Vector search (async, requires embeddings)
    // Only compute vector similarity for BM25 candidates, not all nodes
    const topK = options.limit ?? 20;
    const canVectorSearch = this.getEmbeddingForNode && this.embedContent;

    let vectorResults: RankedResult[] = [];
    if (canVectorSearch) {
      // **The semantic list is not restricted to the lexical candidates, because that restriction is what made this
      // engine not hybrid.** It scored vectors only for nodes BM25 had already found - so a query whose words appear in
      // no identifier, which is the entire case semantic search exists for, could never surface anything new, and the
      // only thing left for the vector half to do was reshuffle a list it could not extend. Measured on this repository
      // with the real embedding endpoint: **recall@20 0.638 with vectors, 1.000 without.**
      vectorResults = await this.vectorSearch(options.query, topK, null);
    }

    // Fuse results
    return this.fuseResults(bm25Results, vectorResults, 60, options.limit ?? undefined);
  }

  /**
   * BM25 text search using an inverted index built from node names and signatures.
   */
  bm25Search(query: string, filters?: SearchFilters): RankedResult[] {
    return this.index.search(query, filters);
  }

  /**
   * Vector semantic search.
   * Requires embeddings to be pre-computed and the embedContent function to be registered.
   * When candidateIds is provided, only those nodes are scored (much faster).
   * Falls back to top-K sampling of all nodes when no candidates are available.
   */
  async vectorSearch(
    query: string,
    topK: number,
    candidateIds?: number[] | null,
    /**
     * **A vector the caller already has, instead of one embedded from `query`.**
     *
     * The query side is not always one string: an expanded query is the mean of the question and a hypothesis, and a
     * caller that measures two compositions of the same question would otherwise have to register a different embedder
     * per call. **The vector is scored against the index as it is** - there is no second space here, because the caller
     * produced it with the backend the index recorded.
     */
    queryVector?: Float32Array | null,
  ): Promise<RankedResult[]> {
    const results: RankedResult[] = [];

    if (!this.getEmbeddingForNode || (!this.embedContent && !queryVector)) {
      return results;
    }

    // Compute query embedding
    const queryEmbedding = queryVector ?? (await this.embedContent!(query));

    // Determine which nodes to score
    let nodesToScore: GraphNode[];
    if (candidateIds && candidateIds.length > 0) {
      // Score only BM25 candidates for efficiency
      nodesToScore = [];
      for (const id of candidateIds) {
        const node = this.store.getNode(id);
        if (node) nodesToScore.push(node);
      }
    } else {
      // No candidates — score all nodes (fallback for cold start)
      nodesToScore = this.store.getAllNodes();
    }

    // **There is no cap, because a cap here is a recall ceiling nobody declared.** There was one at 1 000 nodes, which
    // on a repository of 1 926 files silently excluded two thirds of the index from semantic search - and the figure it
    // produced was published as the retriever's. A cosine per node is a dot product: 50 000 nodes of 768 dimensions is
    // ~38 M multiply-adds, which is milliseconds. **The cost of scoring everything is smaller than the cost of lying
    // about it.**
    for (const node of nodesToScore) {
      const nodeEmbedding = this.getEmbeddingForNode(node.id);
      if (!nodeEmbedding) continue;

      const similarity = cosineSimilarity(queryEmbedding, nodeEmbedding);
      if (similarity > 0) {
        results.push({ node, score: similarity });
      }
    }

    // Similarity descending, ties broken by identity: a cosine of two vectors is arithmetic, and equal cosines are
    // therefore equal on every machine, so the order among them has to come from the corpus.
    return sortByScoreThenIdentity(results, (result) => result.score).slice(0, topK);
  }

  /**
   * Reciprocal Rank Fusion: combines BM25 and vector results.
   * k parameter controls the significance of rank position (default 60).
   */
  fuseResults(
    bm25Results: RankedResult[],
    vectorResults: RankedResult[],
    k: number = 60,
    limit?: number,
    /**
     * **How much a semantic rank counts against a lexical one.**
     *
     * **Reciprocal rank fusion is scale-free, and that is exactly why an unweighted fusion can lose.** A lexical rank 1
     * scores `1/61`; the same node at semantic rank 20 that lexical never saw scores `1/81`, and a *wrong* node that is
     * semantic rank 1 costs only `1/61` on top of wherever lexical put it. With two lists of equal authority the fused
     * order is a compromise between them, and a compromise with a worse list is a worse list. **The weight is the
     * measurement's job to set, not mine**: `docstring-search.test.ts` sweeps it and publishes every column.
     */
    vectorWeight: number = DEFAULT_VECTOR_WEIGHT,
  ): HybridSearchResult[] {
    const combined = new Map<number, HybridSearchResult>();

    // Score BM25 results by reciprocal rank
    for (let i = 0; i < bm25Results.length; i++) {
      const r = bm25Results[i]!;
      const rrfScore = 1 / (k + i + 1); // rank starts at 1
      const existing = combined.get(r.node.id);
      if (existing) {
        // Duplicate node id within the BM25 list (only possible via a direct
        // `fuseResults` call) — accumulate RRF score rather than overwriting.
        existing.bm25Score = r.score;
        existing.combinedScore += rrfScore;
      } else {
        combined.set(r.node.id, {
          node: r.node,
          bm25Score: r.score,
          vectorScore: 0,
          combinedScore: rrfScore,
        });
      }
    }

    // Score vector results by reciprocal rank
    for (let i = 0; i < vectorResults.length; i++) {
      const r = vectorResults[i]!;
      const rrfScore = vectorWeight / (k + i + 1);
      const existing = combined.get(r.node.id);
      if (existing) {
        // Node already present from BM25 — merge its vector score into the
        // combined entry (the normal case when vector search is restricted to
        // BM25 candidates).
        existing.vectorScore = r.score;
        existing.combinedScore += rrfScore;
      } else {
        combined.set(r.node.id, {
          node: r.node,
          bm25Score: 0,
          vectorScore: r.score,
          combinedScore: rrfScore,
        });
      }
    }

    // **Combined score descending, then identity.** Fusion is the step where ties are most common: two documents that
    // BM25 scored identically get identical reciprocal ranks, and the fused list would otherwise inherit the walk order
    // through the insertion order of `combined`.
    const resultsArray = sortByScoreThenIdentity(
      Array.from(combined.values()),
      (r) => r.combinedScore,
    );

    if (limit !== undefined && limit > 0) {
      return resultsArray.slice(0, limit);
    }

    return resultsArray;
  }

  /**
   * Add or update a node in the inverted index.
   */
  refreshNode(node: GraphNode): void {
    this.index.removeDocument(node.id);
    this.index.addDocument(node);
  }

  /**
   * Remove a node from the inverted index.
   */
  removeNode(nodeId: number): void {
    this.index.removeDocument(nodeId);
  }

  /**
   * Rebuild the entire inverted index from the store.
   */
  rebuildIndex(): void {
    this.index.clear();
    this.index.buildIndex(this.store);
  }

  /** Number of indexed documents */
  get documentCount(): number {
    return this.index.documentCount;
  }

  // -------------------------------------------------------------------------
  // Dataflow Search (5th Dimension)
  // -------------------------------------------------------------------------

  /**
   * Perform dataflow/taint-tracking search.
   * Finds paths from sources to sinks in the knowledge graph.
   * This is the 5th search dimension alongside BM25, Vector, Graph, and Regex.
   */
  dataflowSearch(options?: {
    maxDepth?: number;
    maxPaths?: number;
    entryPoints?: string[];
  }): DataflowPath[] {
    const engine = new DataflowSearchEngine(this.store);

    if (options?.entryPoints && options.entryPoints.length > 0) {
      const report = engine.taintAnalysis(options.entryPoints, options.maxDepth ?? 10);
      return report.paths;
    }

    return engine.findPaths({
      maxDepth: options?.maxDepth ?? 10,
      maxPaths: options?.maxPaths ?? 100,
    });
  }

  /**
   * Find all sinks reachable from a specific source node.
   */
  dataflowReachableSinks(sourceNodeId: number, maxDepth: number = 10) {
    const engine = new DataflowSearchEngine(this.store);
    return engine.findReachableSinks(sourceNodeId, maxDepth);
  }
}
