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
  TypeResolutionPhase,
} from './pipeline/phases/index.js';
export type { ExecutablePhase, PhaseExecutionResult } from './pipeline/phases/index.js';

// Languages
export type { LanguageProvider, ParsedImport } from './languages/provider.js';
/**
 * The taint vocabulary's own types, and the one place a language's words are declared.
 *
 * A consumer of `extractTaintSources` returns `TaintSource[]`, so the type has to be reachable from the package or
 * every caller re-declares its shape. `JAVA_TAINT_VOCABULARY` is exported for the same reason from the other side:
 * a benchmark that wants to know what Java recognises should be able to read the list rather than the source file.
 */
export type { TaintSource, TaintSink, TaintSanitizer } from './languages/tree-sitter-base.js';
export type { TaintVocabulary } from './languages/base-c-like.js';
export { C_LIKE_SANITIZERS, C_LIKE_VOCABULARY } from './languages/base-c-like.js';
export { JAVA_TAINT_VOCABULARY } from './languages/java-taint.js';
export { TypeScriptProvider } from './languages/typescript.js';
export { PythonProvider } from './languages/python.js';
export { GoProvider } from './languages/go.js';
export { JavaScriptProvider } from './languages/javascript.js';
export { JavaProvider } from './languages/java.js';
export { CSharpProvider } from './languages/csharp.js';
export { RustProvider } from './languages/rust.js';
export { KotlinProvider } from './languages/kotlin.js';
export { PhpProvider } from './languages/php.js';
export { RubyProvider } from './languages/ruby.js';
export { SwiftProvider } from './languages/swift.js';
export { CppProvider } from './languages/cpp.js';
export { CProvider } from './languages/c.js';
export { DartProvider } from './languages/dart.js';
export { LuaProvider } from './languages/lua.js';
export { ScalaProvider } from './languages/scala.js';
export { ZigProvider } from './languages/zig.js';
export { ElixirProvider } from './languages/elixir.js';
export { HclProvider } from './languages/hcl.js';
export { DockerfileProvider } from './languages/dockerfile.js';
export { YamlProvider } from './languages/yaml.js';
export { JsonProvider } from './languages/json.js';
export { SqlProvider } from './languages/sql.js';
export { BashProvider } from './languages/bash.js';
export { TomlProvider } from './languages/toml.js';
export { MarkdownProvider } from './languages/markdown.js';
export { HtmlProvider } from './languages/html.js';
export { CssProvider } from './languages/css.js';
export { RProvider } from './languages/r.js';
export { GroovyProvider } from './languages/groovy.js';
export { SvelteProvider } from './languages/svelte.js';
export { ArkTSProvider } from './languages/arkts.js';
export { XmlProvider } from './languages/xml.js';

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

// The capture grouping the parse phase uses to turn a provider's captures into symbols, references and a
// scope tree. Exported because a scan that runs the chain over real files needs the same step - without it
// the CFG has no functions and its finding count means nothing.
export { groupCaptures } from './pipeline/phase-helpers.js';

// Where a file's call sites become the per-function map the taint subsystem reads. Exported for the same
// reason as groupCaptures: a scan over real files has to run the steps the phases run.
export { buildCallSites } from './resolution/call-sites.js';
// **The backend chain, not one backend.** `loadEmbedder` tries ONNX and then the API, and **returns which one won**,
// because **the artifact has to be able to say which embedder produced its vectors** - the field whose absence let a
// lexical figure be quoted as a semantic one.
export {
  loadEmbedder,
  loadRealEmbedder,
  embedderUnavailableReason,
  // **The other half of the same invariant**: an index's vectors and a query's vector have to live in one space, so
  // the query side is built from the name the index recorded rather than from whatever backend happens to be reachable.
  createQueryEmbedder,
  defaultEmbedderLoader,
  embeddingText,
  generateEmbeddings,
} from './pipeline/phases/embed.js';
export type {
  EmbeddingBackendName,
  EmbeddingTextOptions,
  NamedEmbedder,
  QueryEmbedder,
} from './pipeline/phases/embed.js';

// **A parser by language, for callers outside this package.** The cross-repo indexer extracts symbols with its
// own regexes because it could not reach a provider; a provider is exactly what it needs.
export { getOrLoadProvider } from './pipeline/phase-helpers.js';

// **The compiler-evidence capability**, exported because **the review side consumes its output** and **a deep import
// into another package's internals is a coupling nobody can see in a dependency graph.**
export {
  parseTscOutput,
  chooseTypecheckCommand,
  collectCompileEvidence,
} from './evidence/compile-evidence.js';
export type {
  CompilerDiagnostic,
  CompileEvidence,
  CompilerRunner,
} from './evidence/compile-evidence.js';

// **Which values a file's arithmetic decides**, exported because the taint analysis asks the question and this package
// is the only one that can read a syntax tree. The fact travels; the policy stays where the analysis is.
export { evaluateConstant } from './languages/constant-expression.js';
export type {
  ConstantValue,
  ConditionalOrder,
  FoldOptions,
} from './languages/constant-expression.js';
export {
  C_FAMILY_CONSTANTS,
  PYTHON_CONSTANTS,
  extractConstantFacts,
} from './languages/constant-fold.js';
export type { ConstantDialect, ConstantFacts } from './languages/constant-fold.js';
