// @code-analyzer/analyzer — Pipeline barrel export
export { PipelineOrchestrator } from './orchestrator.js';
export type {
  PipelineResult,
  PhaseResult,
  PhaseError,
  ValidationResult,
  ValidationError,
} from './orchestrator.js';

export {
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
  createAllPhases,
} from './phases.js';
export type { ExecutablePhase, PhaseExecutionResult } from './phases.js';
