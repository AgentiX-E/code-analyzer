// @code-analyzer/intelligence — CFG Analysis Module
// Control flow graph analysis tools: post-dominators, control dependence,
// and reaching definitions for PDG construction and taint analysis.

// Types
export type {
  ProgramPoint,
  BasicBlock,
  CfgEdgeKind,
  CfgEdge,
  BindingKind,
  BindingEntry,
  DefinitionSite,
  UseSite,
  TaintSourceOccurrence,
  TaintSinkOccurrence,
  SanitizerOccurrence,
  StatementFacts,
  FunctionCfg,
  DefUseFact,
  CdgLabel,
  ControlDepEdge,
  PostDomTree,
  TaintFlowFinding,
  TaintFunctionResult,
  PdgControlQuery,
  PdgDataQuery,
  PdgQueryResult,
} from './types.js';

// Post-dominators
export { computePostDominators, postDominates, NO_IPDOM } from './post-dominators.js';

// Control Dependence
export { computeControlDependence } from './control-dependence.js';

// Reaching Definitions
export { computeReachingDefinitions } from './reaching-defs.js';
