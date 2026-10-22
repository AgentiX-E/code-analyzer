// The embedding backend that needs a key rather than a model file.
//
// **Why this exists, and why it is not a second copy of the ONNX path.** `loadRealEmbedder` reads the ONNX model out of
// `@agentix-e/embed-code-node`, and **that package declares `files: ['dist', 'models']` while shipping no `models/`** —
// so `createFromPackage()` **throws on every machine**, and every report written on top of it called the result
// "intermittent" until a probe printed the error. **A backend that cannot run is not a fallback; it is an absence.**
//
// **This one needs `ZHIPU_API_KEY` and nothing else** — no ~137MB model, no native runtime, no per-platform build — and
// **the protocol is the one `scripts/validate-embeddings.ts` already exercised end to end**, so it is reused rather
// than re-invented:
//
//     POST https://open.bigmodel.cn/api/paas/v4/embeddings
//     { "model": "embedding-3", "input": "<text>" | ["<text>", ...], "dimensions": 768 }
//     -> { "data": [ { "embedding": [...], "index": 0 } ] }
//
// **And `dimensions` is sent, because the default is not what the graph holds.** A first run against the real endpoint
// returned **2048** floats and the search engine refused them against the graph's **768** — `Vector dimension
// mismatch: 2048 vs 768` — which is **a defect the mock could not surface and only the real endpoint did.** **So the
// width is requested explicitly and then checked**, because **a provider that ignores the parameter would otherwise
// produce vectors of the wrong shape much further downstream.**
//
// **And it returns null rather than throwing when the key is absent**, because the caller's question is "which backend
// should this run use", and **a missing key is an answer to it rather than an exception.**

import type { Embedder } from './embed.js';

/** The endpoint `validate-embeddings.ts` verified, kept as the default so a caller overrides only deliberately. */
const DEFAULT_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/embeddings';
const DEFAULT_MODEL = 'embedding-3';
/** **The width the graph holds.** Requested from the endpoint and then verified, because the default is 2048. */
const DEFAULT_DIMENSIONS = 768;
/** Zhipu accepts a batch, and a bounded one keeps a single request inside the timeout. */
const MAX_BATCH = 16;
const TIMEOUT_MS = 30_000;

/** One entry of the response's `data` array, as the endpoint returns it. */
interface EmbeddingDatum {
  embedding?: number[];
  index?: number;
}

interface EmbeddingResponse {
  data?: EmbeddingDatum[];
  error?: { message?: string };
}

/**
 * Why the last API embedder could not be built, or `null` when it could.
 *
 * **The same shape as `embedderUnavailableReason`, and for the same reason**: a caller that knows only *that* there was
 * no embedder will explain the absence rather than read it.
 */
let lastApiFailure: string | null = null;

export function apiEmbedderUnavailableReason(): string | null {
  return lastApiFailure;
}

/** Normalise to unit length, so a cosine comparison is a dot product and the vectors are comparable with the ONNX ones. */
function normalize(vector: number[]): Float32Array {
  const out = Float32Array.from(vector);
  let sum = 0;
  for (const v of out) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < out.length; i += 1) out[i] = out[i]! / norm;
  return out;
}

async function embedWithKey(
  texts: string[],
  key: string,
  endpoint: string,
  model: string,
  dimensions: number,
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += MAX_BATCH) {
    const batch = texts.slice(start, start + MAX_BATCH);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: batch, dimensions }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    const payload = (await response.json()) as EmbeddingResponse;
    if (payload.error?.message) throw new Error(payload.error.message);
    const data = payload.data ?? [];
    if (data.length !== batch.length) {
      // **A response with the wrong number of vectors is a failure rather than a partial success**, because pairing the
      // wrong vector with a text produces a number nobody can trace back to this line.
      throw new Error(`expected ${batch.length} embeddings and received ${data.length}`);
    }
    // **Ordered by `index` when it is present**, because the API is not obliged to return them in request order.
    const ordered = data.every((d) => typeof d.index === 'number')
      ? [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      : data;
    for (const datum of ordered) {
      if (!Array.isArray(datum.embedding) || datum.embedding.length === 0) {
        throw new Error('an embedding in the response was empty');
      }
      // **The width is checked here rather than at the search call**, because this is where the provider's answer can
      // still be attributed to the provider. **The first run against the real endpoint failed one layer up**, in the
      // search engine, with `Vector dimension mismatch: 2048 vs 768` - **a message that names the symptom and not the
      // request that caused it.**
      if (datum.embedding.length !== dimensions) {
        throw new Error(
          `the endpoint returned ${datum.embedding.length} floats and ${dimensions} were requested — ` +
            'the model may not support a dimensions parameter, and the graph holds 768',
        );
      }
      out.push(normalize(datum.embedding));
    }
  }
  return out;
}

/**
 * Build an API-backed embedder, or return `null` with a reason when it cannot be built.
 *
 * **`backend` is reported rather than assumed**, so an artifact can say which embedder produced its vectors — **which
 * is the field whose absence let a lexical figure be quoted as a semantic one.**
 */
export async function loadApiEmbedder(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ embedder: Embedder; backend: 'api' } | null> {
  const key = env['ZHIPU_API_KEY'];
  if (!key || key.trim() === '') {
    lastApiFailure = 'ZHIPU_API_KEY is not set';
    return null;
  }
  const endpoint = env['ZHIPU_EMBEDDING_ENDPOINT'] ?? DEFAULT_ENDPOINT;
  const model = env['ZHIPU_EMBEDDING_MODEL'] ?? DEFAULT_MODEL;
  const dimensions = Number(env['ZHIPU_EMBEDDING_DIMENSIONS'] ?? DEFAULT_DIMENSIONS);

  // **A probe request rather than a promise of one**, because a key that is present and rejected must read as a failure
  // here rather than as a failure halfway through an indexing run - **and the probe checks the width for the same
  // reason: a wrong shape discovered after indexing is a wrong shape discovered too late.**
  try {
    await embedWithKey(['probe'], key, endpoint, model, dimensions);
  } catch (error) {
    lastApiFailure = `the embedding endpoint rejected the probe: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  }

  lastApiFailure = null;
  const embedder: Embedder = {
    embed: async (text: string) =>
      (await embedWithKey([text], key, endpoint, model, dimensions))[0]!,
    embedBatch: (texts: string[]) => embedWithKey(texts, key, endpoint, model, dimensions),
    dispose: async () => undefined,
  };
  return { embedder, backend: 'api' };
}
