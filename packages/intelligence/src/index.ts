// @code-analyzer/intelligence — Stubs

export class HybridSearchEngine {
  async search(_options: Record<string, unknown>): Promise<unknown[]> { return []; }
}
export class EmbeddingEngine {
  async embedCode(_code: string): Promise<Float32Array> { return new Float32Array(768); }
  async embedBatch(_codes: string[]): Promise<Float32Array[]> { return []; }
}
export class CodeReviewEngine {
  async reviewDiff(_projectId: string, _diffRange: unknown): Promise<unknown> { return {}; }
  async reviewFile(_projectId: string, _filePaths: string[]): Promise<unknown> { return {}; }
}
export class ChangeDetector {
  async detectChanges(_projectId: string, _diff: unknown[]): Promise<unknown[]> { return []; }
}
export class ImpactAnalyzer {
  async analyze(_projectId: string, _changes: unknown[]): Promise<unknown> { return {}; }
}
export class MinHashSimilarity {
  computeFingerprint(_node: unknown): string { return ''; }
}
export class MemoryCompressor {
  async compress(_messages: unknown[], _config: unknown): Promise<unknown[]> { return _messages; }
}
