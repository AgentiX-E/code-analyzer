// @code-analyzer/analyzer — Layer 3 Analysis Engine
// Provides pipeline orchestration, language parsing, scope resolution, and knowledge graph construction.

// Pipeline
export { PipelineOrchestrator } from './pipeline/orchestrator.js';
export type {
  PipelineResult,
  PhaseResult,
  PhaseError,
  ValidationResult,
  ValidationError,
} from './pipeline/orchestrator.js';

export {
  createAllPhases,
  ScanPhase,
  StructurePhase,
  ParsePhase,
  MarkdownPhase,
  ConfigPhase,
  CrossFilePhase,
  ScopeResolutionPhase,
  RoutesPhase,
  ToolsPhase,
  DependencyInjectionPhase,
  PruneLocalSymbolsPhase,
  CommunitiesPhase,
  ProcessesPhase,
  TestsPhase,
  DumpPhase,
  SimilarityPhase,
  SemanticPhase,
  EmbedPhase,
} from './pipeline/phases.js';
export type {
  ExecutablePhase,
  PhaseExecutionResult,
} from './pipeline/phases.js';

// Languages
export type { LanguageProvider, ParsedImport } from './languages/provider.js';
export { TypeScriptProvider } from './languages/typescript.js';
export { PythonProvider } from './languages/python.js';
export { GoProvider } from './languages/go.js';
export { JavaScriptProvider } from './languages/javascript.js';

// Parser
export { UnifiedParser } from './parser/unified-parser.js';

// Resolution
export { ScopeResolver } from './resolution/scope-resolver.js';
export type {
  ResolvedReference,
  ResolvedCall,
  ResolvedImport,
} from './resolution/scope-resolver.js';

// Graph
export { GraphBuilder } from './graph/graph-builder.js';
export type { IntegrityReport } from './graph/graph-builder.js';
