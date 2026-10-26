// @code-analyzer/analyzer — Pipeline Phase: Embed
// Uses @agentix-e/embed-code-node (nomic-embed-code ONNX) when available.
// Falls back to deterministic hash-based embeddings when ONNX is unavailable.

import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';

import { simpleHash } from '../phase-helpers.js';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import type { PipelinePhaseId, PipelineContext, GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Embed helpers
// ---------------------------------------------------------------------------

export interface EmbeddingResult {
  nodeId: number;
  embedding: number[];
  /**
   * Which backend produced this vector.
   *
   * `deterministic` means a hash-seeded pseudo-random vector, not a semantic embedding — adequate for exercising a
   * pipeline, useless for similarity. The field exists because the fallback used to be silent: a caller could not
   * tell a real nomic-embed-code vector from a hash PRNG, which is the same defect as an empty consumer list that
   * does not say whether it looked.
   */
  backend: EmbeddingBackendName;
}

/**
 * Which vector space a set of embeddings lives in.
 *
 * **Three names, because three code paths produce vectors and only two of them are interchangeable with each other.**
 * `onnx` and `api` are different models (nomic-embed-code and Zhipu `embedding-3`); `deterministic` is a hash of the
 * text. **A cosine between two of these spaces is noise**, so the name travels with the index and the query side is
 * built from it - see `createQueryEmbedder`.
 */
export type EmbeddingBackendName = 'onnx' | 'api' | 'deterministic';

/** An embedder plus the name of the space it produces. */
export interface NamedEmbedder {
  embedder: Embedder;
  backend: 'onnx' | 'api';
}

/** The ONNX embedder contract consumed by `generateEmbeddings`. */
export interface Embedder {
  embed: (text: string) => Promise<Float32Array>;
  embedBatch: (texts: string[]) => Promise<Float32Array[]>;
  dispose: () => Promise<void>;
}

/**
 * Generate embeddings for every embeddable graph node.
 *
 * The ONNX backend is loaded through the injectable `loadEmbedder` factory
 * (defaulting to `loadRealEmbedder`). When the backend is unavailable — the
 * ~137MB model is not bundled in CI — the factory resolves to null and a
 * deterministic hash-based fallback is used instead.
 */
/** How much of a doc comment is embedded. **A paragraph, not a file** - see the note in `generateEmbeddings`. */
const MAX_DOCSTRING_CHARS = 600;
/** How much of a symbol's own source is embedded. **One body, not the whole file.** */
const MAX_BODY_CHARS = 600;

/**
 * What goes into one symbol's vector.
 *
 * **A function rather than a block inside `generateEmbeddings`, because the composition is the thing under
 * measurement.** The paraphrase corpus answers 0.4747 recall@20 with `label · name · signature · body`, and the miss
 * list is topical - questions about ArkUI decorators, tree-sitter parsing and taint sinks that share no word with any
 * identifier. **A path is the cheapest topical signal a repository has**, and comparing two compositions requires that
 * both be produced by the same code path rather than by a copy inside a test.
 */
export interface EmbeddingTextOptions {
  /**
   * Whether the file's path joins the text. **On, because it was measured on.** On the paraphrase corpus - 99 questions
   * written from doc comments that are then stripped from the index - adding the path moved the product's fused column
   * from **0.4747 to 0.5657 recall@20** and MRR from 0.2271 to 0.2470, with every other variable held: same corpus,
   * same questions, same model, same weight. The misses the path answers are topical (ArkUI decorators, tree-sitter
   * parsing, taint sinks), which is the kind of gap a directory name closes and an identifier cannot.
   *
   * **The alternative is still reachable**, because a measurement that cannot go back cannot show what it gained:
   * `paraphrase-search.test.ts` keeps the path-free composition as its control column.
   */
  includePath?: boolean;
}

/** The text one symbol's vector is built from. */
export function embeddingText(
  node: GraphNode,
  options: EmbeddingTextOptions = {},
  limits: { body?: number; docstring?: number } = {},
): string {
  // **The doc comment is the only natural-language text a repository has about a symbol, and it was not being
  // embedded.** The vector for `extractCalls` was built from `Function extractCalls(source: string)` alone, so a user
  // asking "extract method calls from source" was comparing a description against an identifier and a type list -
  // and on `pallets/flask` that lost. Bounded here rather than at the call site so a measurement can vary it.
  const maxDocstring = limits.docstring ?? MAX_DOCSTRING_CHARS;
  const maxBody = limits.body ?? MAX_BODY_CHARS;

  const textParts: string[] = [node.label, node.name];
  // **The path before the name**, so the topical signal is at the head of the string where a truncated input keeps it.
  if (options.includePath !== false && node.filePath)
    textParts.push(node.filePath.split('/').join(' '));
  const signature = node.properties.signature;
  if (signature) textParts.push(signature);
  // **The body before the doc comment**, because a question about behaviour is answered by what the code does - and
  // on the paraphrase corpus the three fields above produced a vector that could not. Bounded for the same reason.
  const body = node.properties?.['body'];
  if (typeof body === 'string' && body.length > 0) textParts.push(body.slice(0, maxBody));
  if (node.docstring) textParts.push(node.docstring.slice(0, maxDocstring));

  return textParts.filter((part) => part.length > 0).join(' ');
}

export async function generateEmbeddings(
  nodes: Map<number, GraphNode>,
  /**
   * **The loader answers with the name of the space its vectors live in**, not only with the vectors.
   *
   * It used to resolve to a bare `Embedder | null`, so every vector it produced was labelled `onnx` - including the ones
   * from the Zhipu endpoint, whose backend the index then reported incorrectly, and including the ones a caller injected
   * in a test. **A vector whose space is unnamed cannot be compared with anything**, and the comparison it broke was the
   * one the whole semantic half depends on.
   */
  loadEmbedder: () => Promise<NamedEmbedder | null> = defaultEmbedderLoader,
  /**
   * **Which composition of a symbol becomes its text.** Defaults to the product's, so a caller that does not care gets
   * the shipped behaviour; the measurement passes the alternative it is comparing.
   */
  textOptions: EmbeddingTextOptions = {},
): Promise<{
  results: EmbeddingResult[];
  backend: EmbeddingBackendName;
  reason: string | null;
}> {
  const results: EmbeddingResult[] = [];

  // Collect embeddable nodes
  const embeddable: Array<{ nodeId: number; text: string }> = [];
  for (const [nodeId, node] of nodes) {
    // Skip structural and nameless nodes
    if (node.label === 'File' || node.label === 'Folder' || node.label === 'Project') continue;
    if (!node.name) continue;

    embeddable.push({ nodeId, text: embeddingText(node, textOptions) });
  }

  if (embeddable.length === 0) return { results, backend: 'deterministic', reason: null };

  // Try the real ONNX backend from @agentix-e/embed-code-node
  let embedder: Embedder | null = null;

  // **The reason is kept, because a fallback that happens silently is indistinguishable from success.** The phase
  // has a deterministic embedding that works, so `success` is honest - but "which backend did this run use, and why"
  // is a question a measurement of this pipeline has to be able to answer, and swallowing the error made it
  // unanswerable. In this repository `loadEmbedder()` always throws: the published `@agentix-e/embed-code-node`
  // declares `files: ['dist', 'models']` and ships no `models/`, so `createFromPackage()` cannot find
  // `nomic-embed-code-v1.5.int8.onnx` or the `tokenizer.json` beside it, on any machine.
  let backendUnavailableReason: string | null = null;
  let backendName: 'onnx' | 'api' = 'onnx';
  try {
    const loaded = await loadEmbedder();
    embedder = loaded?.embedder ?? null;
    if (loaded) backendName = loaded.backend;
  } catch (error) {
    backendUnavailableReason = error instanceof Error ? error.message : String(error);
  }

  if (embedder) {
    // ONNX backend is active — use real nomic-embed-code embeddings
    try {
      // Batch embed for throughput
      const texts = embeddable.map((e) => e.text);
      const vectors = await embedder.embedBatch(texts);
      for (let i = 0; i < embeddable.length; i++) {
        const vector = vectors[i];
        if (vector) {
          results.push({
            nodeId: embeddable[i]!.nodeId,
            embedding: Array.from(vector),
            backend: backendName,
          });
        }
      }
    } catch {
      // Per-node fallback if batch fails
      for (const { nodeId, text } of embeddable) {
        try {
          const vec = await embedder.embed(text);
          results.push({ nodeId, embedding: Array.from(vec), backend: backendName });
        } catch {
          results.push({ nodeId, embedding: deterministicEmbed(text), backend: 'deterministic' });
        }
      }
    } finally {
      try {
        await embedder.dispose();
      } catch {
        // Ignore cleanup errors
      }
    }
  } else {
    // Deterministic fallback for every node
    for (const { nodeId, text } of embeddable) {
      results.push({ nodeId, embedding: deterministicEmbed(text), backend: 'deterministic' });
    }
  }

  // **Which backend ran, and why**, travelling out with the results so the phase can record it.
  //
  // **The answer is taken from the vectors, not from whether something was thrown.** A loader that *returns* null
  // leaves `backendUnavailableReason` unset, so `backendUnavailableReason ? 'deterministic' : 'onnx'` reported **`onnx`
  // for a run in which every vector came from the hash fallback** - the exact confusion the field exists to prevent,
  // and the one that lets a lexical or synthetic figure be quoted as a semantic one. The reason is filled in from the
  // loaders' own record of why they resolved to nothing.
  if (!embedder) backendUnavailableReason ??= embedderUnavailableReason();
  return {
    results,
    // **The aggregate is read from the vectors, and it knows about all three names.** It used to be
    // `every(r => r.backend === 'onnx') ? 'onnx' : 'deterministic'` - so **a run in which every vector came from the API
    // was reported as `deterministic`**, which then made the query side build a hash embedder against an API index: two
    // spaces again, this time created by the label. A mixed run reports the weakest space it holds and says why.
    backend: singleBackend(results),
    reason: backendUnavailableReason,
  };
}

/** The one backend every vector in the run came from, or `deterministic` when the run mixed them. */
function singleBackend(results: EmbeddingResult[]): EmbeddingBackendName {
  if (results.length === 0) return 'deterministic';
  const names = new Set(results.map((result) => result.backend));
  const only = names.size === 1 ? [...names][0] : undefined;
  return only ?? 'deterministic';
}

/**
 * Dynamically load the real ONNX embedder.
 * Uses `createFromPackage()` which loads the model bundled with the npm package.
 * Returns null if the model or ONNX runtime is unavailable.
 *
 * NOTE: Requires @agentix-e/embed-code-node with bundled ONNX model (~137MB).
 * When the model file is not checked into the repository, `createFromPackage()`
 * throws and this resolves to null so callers fall back deterministically.
 */
/** Why the last `loadRealEmbedder()` produced nothing, or null when it produced an embedder. */
let lastEmbedderFailure: string | null = null;

/**
 * Why the real embedder could not be loaded, or `null` if it could.
 *
 * **The `catch` here used to swallow the error and return `null`**, which left every caller knowing *that* there was no
 * embedder and nothing about *why*. **The reports written on top of it called the result "intermittent"** - three
 * times, across three pieces of documentation - and a single probe printing the error settled it in one line:
 *
 *     Error: Tokenizer not found: …/@agentix-e+embed-code-node@0.1.1/…/models/tokenizer.json
 *
 * **The model file is not installed. It does not succeed on some runs and fail on others; it always fails**, and every
 * conclusion drawn from "intermittent" was drawn from that absence. **A failure that cannot say why is a failure
 * somebody will explain instead of reading.**
 */
export function embedderUnavailableReason(): string | null {
  return lastEmbedderFailure;
}

/**
 * The embedder this pipeline should use, in the order the backends can actually run.
 *
 * **ONNX first, because it needs no network and no key** - and **the API second, because the ONNX model is not shipped
 * and the API needs only a key.** **The order is a consequence of what each one requires, not of preference**, and
 * **the name of the backend that won is returned**, so an artifact can record which one produced its vectors.
 *
 * **The reason from the losing backend is kept when neither wins**, because **"no embedder" is a conclusion and the
 * reason is the evidence for it.**
 */
export async function loadEmbedder(
  // **Both loaders are parameters with the production defaults**, which is the same seam `generateEmbeddings` already
  // takes for the ONNX factory - and for the same reason: **whether a 137MB model or an API key is present is a fact
  // about the machine, so a test cannot reach either success arm by writing code.** With the seam, "the ONNX backend
  // won", "the API backend won" and "neither did" are three ordinary cases.
  loadOnnx: () => Promise<Embedder | null> = loadRealEmbedder,
  loadApi?: () => Promise<{ embedder: Embedder; backend: 'api' } | null>,
): Promise<{
  embedder: Embedder;
  backend: 'onnx' | 'api';
} | null> {
  const onnx = await loadOnnx();
  if (onnx) return { embedder: onnx, backend: 'onnx' };

  const { loadApiEmbedder } = await import('./embed-api.js');
  const api = await (loadApi ?? loadApiEmbedder)();
  if (api) return api;

  // **Both reasons are recorded**, because a single message would name one backend's failure and hide the other's.
  const onnxReason = lastEmbedderFailure ?? 'the ONNX embedder returned null without a reason';
  const { apiEmbedderUnavailableReason } = await import('./embed-api.js');
  const apiReason =
    apiEmbedderUnavailableReason() ?? 'the API embedder returned null without a reason';
  lastEmbedderFailure = `onnx: ${onnxReason} · api: ${apiReason}`;
  return null;
}

export async function loadRealEmbedder(
  // **The import is a parameter with the production default**, for the same reason `loadEmbedder`'s two loaders are:
  // **`createFromPackage()` needs a 137MB model that the published package declares and does not ship**, so neither of
  // its arms - the one that succeeds, and the one that says which file is missing - can be reached by writing code on
  // any machine. With the seam both are ordinary cases, and production still performs the real import: the default is
  // the code that runs.
  importEmbedder: () => Promise<unknown> = () => import('@agentix-e/embed-code-node'),
): Promise<Embedder | null> {
  try {
    const module = (await importEmbedder()) as { NodeEmbedder?: unknown };
    const { NodeEmbedder } = module;

    // Try createFromPackage first (bundled model), fall back to create({ modelPath })
    try {
      // **One assertion, not two**: `NodeEmbedder` arrives as `unknown` from the module object, so the intermediate
      // `as unknown` was a no-op the type checker reports as unnecessary.
      const nodeEmbedder = NodeEmbedder as {
        createFromPackage: () => Promise<Embedder>;
      };
      const embedder = await nodeEmbedder.createFromPackage();
      lastEmbedderFailure = null;
      return embedder;
    } catch (err) {
      // **The message is kept rather than discarded.** `Tokenizer not found` names the file that is missing, and
      // nothing else in the system did.
      lastEmbedderFailure = `createFromPackage failed: ${err instanceof Error ? err.message : String(err)}`;
      return null;
    }
  } catch (err) {
    lastEmbedderFailure = `@agentix-e/embed-code-node could not be imported: ${err instanceof Error ? err.message : String(err)}`;
    return null;
  }
}

function deterministicEmbed(text: string, dimension: number = 768): number[] {
  const embedding = new Array<number>(dimension);
  // Use a deterministic hash to seed the embedding
  const seed = simpleHash(text, 9973);

  // Generate reproducible pseudo-random values seeded from text
  let state = seed;
  for (let i = 0; i < dimension; i++) {
    state = ((state << 5) - state + 0x6b8b4567) | 0;
    embedding[i] = ((state >>> 0) / 0xffffffff) * 2 - 1; // Map to [-1, 1]
  }

  // Normalize to unit length. The LCG output above is never exactly zero
  // (0.5 maps to a non-integer state), so the norm is always > 0 — the
  // guard would be dead and is omitted.
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  for (let i = 0; i < dimension; i++) {
    embedding[i] = embedding[i]! / norm;
  }

  return embedding;
}

/**
 * The production loader: ONNX first, then the endpoint, and **the name of the winner travels with the vectors**.
 *
 * **The order is a consequence of what each needs, not of preference** - and the name is what this function exists to
 * keep, because the two backends are two different vector spaces.
 */
export async function defaultEmbedderLoader(
  // **The chain is a parameter with the production default**, because on a machine with neither a model file nor a key
  // the other arm cannot be reached by writing code - the same reason `loadEmbedder` takes its two loaders. With the
  // seam, "the chain found a backend" and "it found none" are two ordinary cases.
  load: () => Promise<{ embedder: Embedder; backend: 'onnx' | 'api' } | null> = loadEmbedder,
): Promise<NamedEmbedder | null> {
  const loaded = await load();
  return loaded ? { embedder: loaded.embedder, backend: loaded.backend } : null;
}

/** A query embedder, named by the space it produces. */
export interface QueryEmbedder {
  embed: (text: string) => Promise<Float32Array>;
  backend: EmbeddingBackendName;
  dispose: () => Promise<void>;
}

/**
 * Build the embedder that turns a **query** into a vector in the same space as the index.
 *
 * **This is the invariant the semantic half was missing.** `docstring-search` embedded the index with hash vectors and
 * the query with the Zhipu endpoint and compared them with a cosine, which is a comparison between two unrelated spaces:
 * **the figure it produced was 0.638 against 1.000 for the lexical list**, and the vector half was not weak - it was
 * incoherent. The rule is therefore enforced here rather than described in a comment: **if the space the loader offers
 * is not the space the index holds, this returns `null`** and the caller reports that the semantic half is unavailable
 * instead of publishing a number computed across a mismatch.
 */
export async function createQueryEmbedder(
  indexBackend: EmbeddingBackendName,
  loader: () => Promise<{ embedder: Embedder; backend: 'onnx' | 'api' } | null> = loadEmbedder,
): Promise<QueryEmbedder | null> {
  if (indexBackend === 'deterministic') {
    // **The hash vector is reproducible from the text alone**, so a query can join the index's space without a model -
    // which is what makes the semantic path exercisable in a test and usable offline.
    return {
      embed: async (text: string) => Float32Array.from(deterministicEmbed(text)),
      backend: 'deterministic',
      dispose: async () => undefined,
    };
  }

  const loaded = await loader();
  if (!loaded) return null;
  if (loaded.backend !== indexBackend) {
    // **Two models, one index**: refuse rather than compare. The reason is left in `embedderUnavailableReason()` for a
    // caller that reports why the semantic half is off.
    lastEmbedderFailure = `the index holds ${indexBackend} vectors and the only embedder available is ${loaded.backend}`;
    await loaded.embedder.dispose();
    return null;
  }
  return {
    embed: (text: string) => loaded.embedder.embed(text),
    backend: loaded.backend,
    dispose: () => loaded.embedder.dispose(),
  };
}

// ---------------------------------------------------------------------------
// Phase 18: embed — Generate vector embeddings for graph nodes
// ---------------------------------------------------------------------------

export class EmbedPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'embed';
  readonly dependencies: PipelinePhaseId[] = ['dump'];
  readonly description = 'Generate vector embeddings for graph nodes';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { embeddingsGenerated: 0 } };
      }

      const {
        results: embeddings,
        backend,
        reason: backendReason,
      } = await generateEmbeddings(ctx.graph.nodes, defaultEmbedderLoader);

      // Store embeddings in node properties, **with the name of the space they live in**.
      //
      // **The name belongs on the data, not only in `phaseData`.** A consumer that reads this graph later - the MCP
      // server, a report, another process - has the vectors and needs the one fact that makes them usable: which model
      // produced them. `phaseData` dies with the run, so a search that had to consult it could only ever be wired inside
      // the pipeline, which is why **nothing outside the benchmark had ever registered these vectors at all**.
      for (const { nodeId, embedding, backend: nodeBackend } of embeddings) {
        // nodeId came from the nodes iteration inside generateEmbeddings and the
        // graph is not mutated in between, so get() always returns the node.
        const node = ctx.graph.nodes.get(nodeId)!;
        node.properties = {
          ...node.properties,
          embedding,
          embeddingBackend: nodeBackend,
        };
      }

      // **Which backend, and why** - readable by whoever measures this pipeline. A fallback that happens
      // silently is indistinguishable from success, and "which embeddings does this index hold" is a
      // question a measurement of the pipeline has to be able to answer.
      ctx.phaseData.set('embedBackend', { backend, reason: backendReason });

      ctx.phaseData.set('embed', { embeddingsGenerated: embeddings.length });
      return {
        phaseId: this.id,
        status: 'success',
        output: { embeddingsGenerated: embeddings.length },
      };
    } catch (err) {
      this.logger.error(
        'Phase execution failed',
        err instanceof Error ? err : new Error(String(err)),
        { phaseId: this.id, filePath: ctx?.rootPath },
      );
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
