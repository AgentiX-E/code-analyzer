// @code-analyzer/analyzer — Stubs
// Full implementation: Iteration 1

export class PipelineOrchestrator {
  async run(_config: Record<string, unknown>): Promise<void> {}
}
export class UnifiedParser {
  async parseFile(_path: string): Promise<unknown> { return {}; }
}
export class ScopeResolver {
  async resolve(_files: unknown[]): Promise<unknown[]> { return []; }
}
export class GraphBuilder {
  async build(_ctx: unknown): Promise<unknown> { return {}; }
}
export interface LanguageProvider {
  readonly language: string;
  readonly extensions: string[];
}
