// @code-analyzer/core — Error Hierarchy (Stub)

export abstract class CodeAnalyzerError extends Error {
  abstract readonly code: string;
  abstract readonly category: string;
  readonly timestamp: Date = new Date();
  
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
  }
}
