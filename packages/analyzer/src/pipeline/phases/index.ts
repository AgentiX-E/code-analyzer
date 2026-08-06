// @code-analyzer/analyzer — Pipeline Phases barrel

export { ScanPhase } from './scan.js';
export { StructurePhase } from './structure.js';
export { ParsePhase } from './parse.js';
export { MarkdownPhase } from './markdown.js';
export { ConfigPhase } from './config.js';
export { CrossFilePhase } from './cross-file.js';
export { ScopeResolutionPhase } from './scope-resolution.js';
export { RoutesPhase } from './routes.js';
export { ToolsPhase } from './tools.js';
export { DependencyInjectionPhase } from './dependency-injection.js';
export { PruneLocalSymbolsPhase } from './prune-local-symbols.js';
export { CommunitiesPhase } from './communities.js';
export { ProcessesPhase } from './processes.js';
export { TestsPhase } from './tests.js';
export { DumpPhase } from './dump.js';
export { SimilarityPhase } from './similarity.js';
export { SemanticPhase } from './semantic.js';
export { EmbedPhase } from './embed.js';
export { TypeResolutionPhase } from './type-resolution.js';

export type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';

import { ScanPhase } from './scan.js';
import { StructurePhase } from './structure.js';
import { ParsePhase } from './parse.js';
import { MarkdownPhase } from './markdown.js';
import { ConfigPhase } from './config.js';
import { CrossFilePhase } from './cross-file.js';
import { ScopeResolutionPhase } from './scope-resolution.js';
import { RoutesPhase } from './routes.js';
import { ToolsPhase } from './tools.js';
import { DependencyInjectionPhase } from './dependency-injection.js';
import { PruneLocalSymbolsPhase } from './prune-local-symbols.js';
import { CommunitiesPhase } from './communities.js';
import { ProcessesPhase } from './processes.js';
import { TestsPhase } from './tests.js';
import { DumpPhase } from './dump.js';
import { SimilarityPhase } from './similarity.js';
import { SemanticPhase } from './semantic.js';
import { EmbedPhase } from './embed.js';
import { TypeResolutionPhase } from './type-resolution.js';

import type { ExecutablePhase } from '../phase-helpers.js';

export function createAllPhases(): ExecutablePhase[] {
  return [
    new ScanPhase(),
    new StructurePhase(),
    new ParsePhase(),
    new MarkdownPhase(),
    new ConfigPhase(),
    new CrossFilePhase(),
    new ScopeResolutionPhase(),
    new TypeResolutionPhase(),
    new RoutesPhase(),
    new ToolsPhase(),
    new DependencyInjectionPhase(),
    new PruneLocalSymbolsPhase(),
    new CommunitiesPhase(),
    new ProcessesPhase(),
    new TestsPhase(),
    new DumpPhase(),
    new SimilarityPhase(),
    new SemanticPhase(),
    new EmbedPhase(),
  ];
}
