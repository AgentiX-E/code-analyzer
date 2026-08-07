// @code-analyzer/analyzer — CFG Module
// Public API for Control Flow Graph construction, dominator analysis,
// and dataflow analysis.

export type { BasicBlock, ControlFlowGraph } from './cfg-types.js';
export { CfgBuilder } from './cfg-builder.js';
export {
  computeDominators,
  computeImmediateDominators,
  buildDominatorTree,
  computeDominanceFrontiers,
  findBackEdges,
  findNaturalLoops,
} from './dominators.js';
export {
  computeReachingDefinitions,
  computeLiveVariables,
  detectUnreachableCode,
  detectDeadStores,
  computeAvailableExpressions,
} from './dataflow.js';
