// @code-analyzer/intelligence — Real ONNX Backend Tests
// Covers RealEmbeddingBackend delegation, the createRealBackend factory (both
// the success and fallback paths), and the EmbeddingEngine real-backend upgrade.
//
// The @agentix-e/embed-code-node dependency is mocked at the module boundary
// because the real package loads a native ONNX runtime and a ~137MB model that
// is not checked in. Mocking the dependency (not the module under test) lets us
// exercise the delegation and factory logic without those artifacts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeEmbedder } from '@agentix-e/embed-code-node';
import { EmbeddingEngine, RealEmbeddingBackend } from '../embeddings/embedder.js';

// Mock the third-party dependency, NOT the module under test. The real package
// would eagerly load onnxruntime-node and the embedded model on import.
vi.mock('@agentix-e/embed-code-node', () => ({
  NodeEmbedder: {
    create: vi.fn(),
    createFromPackage: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Typed substitute for the NodeEmbedder instance produced by the dependency.
// ---------------------------------------------------------------------------

interface FakeNodeEmbedder {
  embed: (text: string) => Promise<Float32Array>;
  embedBatch: (texts: string[]) => Promise<Float32Array[]>;
  dispose: () => Promise<void>;
  dimensions: number;
  modelInfo: {
    name: string;
    version: string;
    dimensions: number;
    maxSequenceLength: number;
    vocabSize: number;
    quantization: string;
  };
}

function makeFakeNodeEmbedder(overrides: Partial<FakeNodeEmbedder> = {}): FakeNodeEmbedder {
  return {
    embed: async (text: string) => new Float32Array(768).fill(text.length),
    embedBatch: async (texts: string[]) =>
      texts.map((text) => new Float32Array(768).fill(text.length)),
    dispose: async () => undefined,
    dimensions: 768,
    modelInfo: {
      name: 'nomic-embed-code-v1.5',
      version: '1.0.0',
      dimensions: 768,
      maxSequenceLength: 2048,
      vocabSize: 30522,
      quantization: 'int8',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RealEmbeddingBackend — pure delegation over a NodeEmbedderInstance
// ---------------------------------------------------------------------------

describe('RealEmbeddingBackend', () => {
  it('reports backendType "onnx" and the underlying dimensions', () => {
    const backend = new RealEmbeddingBackend(makeFakeNodeEmbedder());
    expect(backend.backendType).toBe('onnx');
    expect(backend.dimensions).toBe(768);
  });

  it('delegates embedCode to the underlying embedder', async () => {
    const embed = vi.fn(async (_text: string) => new Float32Array([1, 2, 3]));
    const backend = new RealEmbeddingBackend(makeFakeNodeEmbedder({ embed }));

    const result = await backend.embedCode('function hello() {}');

    expect(embed).toHaveBeenCalledWith('function hello() {}');
    expect(result).toEqual(new Float32Array([1, 2, 3]));
  });

  it('delegates embedBatch to the underlying embedder', async () => {
    const embedBatch = vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([9, 9])));
    const backend = new RealEmbeddingBackend(makeFakeNodeEmbedder({ embedBatch }));

    const result = await backend.embedBatch(['a', 'b']);

    expect(embedBatch).toHaveBeenCalledWith(['a', 'b']);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual(new Float32Array([9, 9]));
  });

  it('delegates dispose to the underlying embedder', async () => {
    const dispose = vi.fn(async () => undefined);
    const backend = new RealEmbeddingBackend(makeFakeNodeEmbedder({ dispose }));

    await backend.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// createRealBackend + EmbeddingEngine upgrade path (dependency mocked)
// ---------------------------------------------------------------------------

describe('EmbeddingEngine real backend upgrade', () => {
  const createMock = vi.mocked(NodeEmbedder.create);
  const createFromPackageMock = vi.mocked(NodeEmbedder.createFromPackage);

  beforeEach(() => {
    createMock.mockReset();
    createFromPackageMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('upgrades to the onnx backend when createFromPackage succeeds', async () => {
    createFromPackageMock.mockResolvedValue(makeFakeNodeEmbedder() as unknown as NodeEmbedder);

    const engine = new EmbeddingEngine();
    const warning = await engine.initialize();

    expect(warning).toBeNull();
    expect(engine.activeBackend).toBe('onnx');
    expect(engine.initWarning).toBeNull();
    expect(createFromPackageMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('uses NodeEmbedder.create when a modelPath is configured', async () => {
    createMock.mockResolvedValue(makeFakeNodeEmbedder() as unknown as NodeEmbedder);

    const engine = new EmbeddingEngine({
      modelPath: '/tmp/model.onnx',
      tokenizerPath: '/tmp/tokenizer.json',
    });
    await engine.initialize();

    expect(createMock).toHaveBeenCalledWith({
      modelPath: '/tmp/model.onnx',
      tokenizerPath: '/tmp/tokenizer.json',
    });
    expect(createFromPackageMock).not.toHaveBeenCalled();
    expect(engine.activeBackend).toBe('onnx');
  });

  it('routes embedCode through the upgraded real backend', async () => {
    const embed = vi.fn(async (text: string) => new Float32Array(768).fill(text.length));
    createFromPackageMock.mockResolvedValue(
      makeFakeNodeEmbedder({ embed }) as unknown as NodeEmbedder,
    );

    const engine = new EmbeddingEngine();
    await engine.initialize();
    const vector = await engine.embedCode('function real() {}');

    expect(embed).toHaveBeenCalledWith('function real() {}');
    expect(vector.length).toBe(768);
  });

  it('falls back to the mock backend when the factory rejects with an Error', async () => {
    createFromPackageMock.mockRejectedValue(new Error('onnxruntime failed to load'));

    const engine = new EmbeddingEngine();
    const warning = await engine.initialize();

    expect(warning).toContain('ONNX');
    expect(engine.activeBackend).toBe('mock');
  });

  it('coerces a non-Error rejection reason in the catch block', async () => {
    createFromPackageMock.mockRejectedValue('native binding missing');

    const engine = new EmbeddingEngine();
    const warning = await engine.initialize();

    expect(warning).toContain('ONNX');
    expect(engine.activeBackend).toBe('mock');
  });
});
