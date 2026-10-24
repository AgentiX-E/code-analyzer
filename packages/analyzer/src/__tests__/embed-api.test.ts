// The API embedding backend, exercised against a real HTTP server rather than a mocked `fetch`.
//
// **Every branch in this file is a way a provider can answer**, and the module exists because the first run against the
// real endpoint returned **2048** floats where the graph holds **768** — a defect a mock could not surface, because a
// mock returns whatever shape it was written to return. So the cases below are a local server that answers the way a
// provider does: with a wrong count, with an error envelope, with the wrong width, with an empty vector, with a status
// code, and — once — correctly.
//
// **The protocol is what is under test**, not a function: the request body must ask for `dimensions: 768`, the vectors
// must be normalised, and the response order must be restored from `index` because the endpoint is not obliged to
// preserve it.

import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  apiEmbedderUnavailableReason,
  loadApiEmbedder,
  resolveApiConfig,
} from '../pipeline/phases/embed-api.js';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

interface Recorded {
  body: { input?: string[]; model?: string; dimensions?: number };
  authorization?: string;
}

/** A server that answers with the handler's body and status, and records every request it received. */
async function withServer(
  handler: (body: Recorded['body'], index: number) => { status: number; json: unknown },
  run: (endpoint: string, recorded: Recorded[]) => Promise<void>,
): Promise<void> {
  const recorded: Recorded[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (chunk) => (raw += String(chunk)));
    req.on('end', () => {
      const parsed = raw ? (JSON.parse(raw) as Recorded['body']) : {};
      recorded.push({ body: parsed, authorization: req.headers.authorization });
      const { status, json } = handler(parsed, recorded.length - 1);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}/embeddings`, recorded);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * A response with `count` vectors of `width`, each one-hot at the position of its own index.
 *
 * **One-hot rather than constant**, because normalisation divides a constant vector back to the same unit vector for
 * every scale - so `[1,1,…]` and `[2,2,…]` normalise identically and a test could not tell an order swap from a
 * correct pairing.
 */
function vectors(count: number, width: number, reverse = false): unknown {
  const data = Array.from({ length: count }, (_, i) => ({
    index: i,
    embedding: Array.from({ length: width }, (_unused, j) => (j === i ? 1 : 0)),
  }));
  return { data: reverse ? [...data].reverse() : data };
}

const KEY = 'test-key';
const env = (endpoint: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ZHIPU_API_KEY: KEY,
  ZHIPU_EMBEDDING_ENDPOINT: endpoint,
  ...extra,
});

afterEach(() => {
  // Each load writes the module's last-failure record; clearing it keeps one case from explaining another.
  apiEmbedderUnavailableReason();
});

describe('the embedding protocol', () => {
  it('asks for the width the graph holds and normalises what comes back', async () => {
    await withServer(
      (body) => ({ status: 200, json: vectors(body.input?.length ?? 0, 768) }),
      async (endpoint, recorded) => {
        const loaded = await loadApiEmbedder(env(endpoint));

        expect(loaded?.backend).toBe('api');
        // **`dimensions` is sent**, because the endpoint's default is 2048 and the graph holds 768.
        expect(recorded[0]!.body.dimensions).toBe(768);
        expect(recorded[0]!.body.model).toBe('embedding-3');
        expect(recorded[0]!.authorization).toBe(`Bearer ${KEY}`);

        // **Both entry points of the returned embedder**, because a caller uses `embed` for a single query as often
        // as `embedBatch` for a run - and a wrapper that only ever worked in batch would fail the interactive path.
        const [vector] = await loaded!.embedder.embedBatch(['a']);
        const single = await loaded!.embedder.embed('a');
        expect(single[0]).toBe(vector![0]);
        await loaded!.embedder.dispose();
        // **Unit length**, so a cosine comparison is a dot product and the vectors are comparable with the ONNX ones.
        const norm = Math.sqrt([...vector!].reduce((sum, v) => sum + v * v, 0));
        expect(norm).toBeCloseTo(1, 5);
      },
    );
  });

  it('restores the request order from the response index', async () => {
    // The probe is one text; the real request is two, and its answer arrives reversed on purpose.
    await withServer(
      (body) => {
        const count = body.input?.length ?? 0;
        return { status: 200, json: vectors(count, 768, count === 2) };
      },
      async (endpoint) => {
        const loaded = await loadApiEmbedder(env(endpoint));
        const [first, second] = await loaded!.embedder.embedBatch(['a', 'b']);

        // The response arrived reversed; each vector belongs to the text at its `index`, so the first text keeps the
        // vector that is one-hot at 0 and the second the one that is one-hot at 1.
        expect(first![0]).toBe(1);
        expect(second![0]).toBe(0);
      },
    );
  });

  it('splits a batch larger than the endpoint accepts into several requests', async () => {
    await withServer(
      (body) => ({ status: 200, json: vectors(body.input?.length ?? 0, 768) }),
      async (endpoint, recorded) => {
        const loaded = await loadApiEmbedder(env(endpoint));
        const texts = Array.from({ length: 17 }, (_, i) => `text ${i}`);
        const out = await loaded!.embedder.embedBatch(texts);

        expect(out).toHaveLength(17);
        // One probe + one request for 16 + one for the remaining 1.
        expect(recorded).toHaveLength(3);
        expect(recorded[1]!.body.input).toHaveLength(16);
        expect(recorded[2]!.body.input).toHaveLength(1);
      },
    );
  });
});

describe('the answers that are not embeddings', () => {
  it('reports a status code rather than treating it as an embedding', async () => {
    await withServer(
      () => ({ status: 429, json: { message: 'quota exceeded' } }),
      async (endpoint) => {
        const loaded = await loadApiEmbedder(env(endpoint));

        expect(loaded).toBeNull();
        expect(apiEmbedderUnavailableReason()).toMatch(/429/);
      },
    );
  });

  it('reports the error envelope the endpoint returns with a 200', async () => {
    await withServer(
      () => ({ status: 200, json: { error: { message: 'invalid api key' } } }),
      async (endpoint) => {
        expect(await loadApiEmbedder(env(endpoint))).toBeNull();
        expect(apiEmbedderUnavailableReason()).toMatch(/invalid api key/);
      },
    );
  });

  it('refuses a response with the wrong number of vectors', async () => {
    // **A wrong count is a failure, not a partial success**: pairing the wrong vector with a text produces a number
    // nobody can trace back to this line.
    await withServer(
      () => ({ status: 200, json: vectors(2, 768) }),
      async (endpoint) => {
        expect(await loadApiEmbedder(env(endpoint))).toBeNull();
        expect(apiEmbedderUnavailableReason()).toMatch(/expected 1 embeddings and received 2/);
      },
    );
  });

  it('refuses an empty vector', async () => {
    await withServer(
      () => ({ status: 200, json: { data: [{ index: 0, embedding: [] }] } }),
      async (endpoint) => {
        expect(await loadApiEmbedder(env(endpoint))).toBeNull();
        expect(apiEmbedderUnavailableReason()).toMatch(/empty/);
      },
    );
  });

  it('refuses the width the model defaults to instead of the one requested', async () => {
    // **The defect that only the real endpoint produced**: 2048 floats against a 768-wide graph, discovered a layer
    // up in the search engine as `Vector dimension mismatch` — a message that names the symptom, not the request.
    await withServer(
      () => ({ status: 200, json: vectors(1, 2048) }),
      async (endpoint) => {
        expect(await loadApiEmbedder(env(endpoint))).toBeNull();
        expect(apiEmbedderUnavailableReason()).toMatch(/2048 floats and 768 were requested/);
      },
    );
  });

  it('is absent, rather than broken, when the key is not set', async () => {
    expect(await loadApiEmbedder({})).toBeNull();
    expect(apiEmbedderUnavailableReason()).toBe('ZHIPU_API_KEY is not set');
  });

  it('treats a blank key as absent', async () => {
    expect(await loadApiEmbedder({ ZHIPU_API_KEY: '   ' })).toBeNull();
    expect(apiEmbedderUnavailableReason()).toBe('ZHIPU_API_KEY is not set');
  });
});

/**
 * A server that answers with a status and **no body at all**, and one that answers and then drops the connection.
 *
 * **Both are ordinary things a provider does under load**: a gateway returns `502` with nothing in it, and a connection
 * is cut after the headers. The first decides whether the message a user sees names a status alone or a status and a
 * colon with nothing after it; **the second is the only way `response.text()` can reject**, which is the arm that keeps
 * a truncated body from becoming an exception the caller has to handle.
 */
async function withRawServer(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
  run: (endpoint: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => handle(req, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}/embeddings`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('an answer whose body is missing or cut off', () => {
  it('names the status alone when the body is empty', async () => {
    // **No trailing colon and no `: ` prefix**, because a message that ends in a colon reads as if something were cut
    // off from it — which is exactly the state a `502` with no body is already in.
    await withRawServer(
      (_req, res) => {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end();
      },
      async (endpoint) => {
        expect(await loadApiEmbedder(env(endpoint))).toBeNull();
        expect(apiEmbedderUnavailableReason()).toMatch(/HTTP 502$/);
      },
    );
  });

  it('reports the status when the connection is cut before the body arrives', async () => {
    // **A dropped connection is not a dropped answer**: the status arrived, so the status is what the message says.
    await withRawServer(
      (_req, res) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.write('{"error":');
        setTimeout(() => res.destroy(), 5);
      },
      async (endpoint) => {
        expect(await loadApiEmbedder(env(endpoint))).toBeNull();
        expect(apiEmbedderUnavailableReason()).toMatch(/HTTP 500/);
      },
    );
  });
});

describe('answers that carry no usable index or no vectors at all', () => {
  it('keeps the order it was given when no entry carries an index', async () => {
    // **`index` is optional in the response**, and a provider that omits it is answering in request order by
    // definition — sorting on a value that is not there would reorder the vectors arbitrarily.
    await withRawServer(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [{ embedding: Array.from({ length: 768 }, (_v, i) => (i === 0 ? 1 : 0)) }],
          }),
        );
      },
      async (endpoint) => {
        const loaded = await loadApiEmbedder(env(endpoint));

        const [vector] = await loaded!.embedder.embedBatch(['a']);
        expect(vector![0]).toBe(1);
      },
    );
  });

  it('refuses a response that carries no data field at all', async () => {
    await withServer(
      () => ({ status: 200, json: {} }),
      async (endpoint) => {
        expect(await loadApiEmbedder(env(endpoint))).toBeNull();
        expect(apiEmbedderUnavailableReason()).toMatch(/expected 1 embeddings and received 0/);
      },
    );
  });

  it('normalises a zero vector to zero rather than to NaN', async () => {
    // **A provider can return an all-zero embedding**, and dividing it by its own norm is where that becomes `NaN` in
    // every component — a vector that poisons every cosine comparison downstream without failing anywhere.
    await withServer(
      () => ({ status: 200, json: { data: [{ index: 0, embedding: new Array(768).fill(0) }] } }),
      async (endpoint) => {
        const loaded = await loadApiEmbedder(env(endpoint));

        const [vector] = await loaded!.embedder.embedBatch(['a']);
        expect(vector!.every((v) => v === 0)).toBe(true);
        expect(Number.isNaN(vector![0])).toBe(false);
      },
    );
  });
});

describe('the configuration a run resolves', () => {
  it('uses the verified defaults when only the key is present', async () => {
    // **The defaults are the measurement**, not a convenience: this endpoint, this model, and this width are the three
    // facts every published embedding figure was produced with.
    const config = resolveApiConfig({ ZHIPU_API_KEY: 'k' });

    expect(config).toEqual({
      endpoint: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
      model: 'embedding-3',
      dimensions: 768,
    });
  });

  it('lets an override win, including a numeric width given as text', async () => {
    const config = resolveApiConfig({
      ZHIPU_EMBEDDING_ENDPOINT: 'http://127.0.0.1:1/x',
      ZHIPU_EMBEDDING_MODEL: 'other-model',
      ZHIPU_EMBEDDING_DIMENSIONS: '1024',
    });

    expect(config).toEqual({
      endpoint: 'http://127.0.0.1:1/x',
      model: 'other-model',
      dimensions: 1024,
    });
  });
});
